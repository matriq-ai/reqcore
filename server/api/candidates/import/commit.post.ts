/**
 * POST /api/candidates/import/commit
 *
 * Phase 2 of batch PDF import: take the rows the user reviewed/edited in the
 * preview table and persist them. For each row we
 *   1. skip if a candidate with the same email already exists (no overwrite),
 *   2. pull the staged raw bytes (from phase 1) and upload them to Feishu Drive,
 *   3. create the candidate + a `resume` document (storageProvider='feishu'),
 *   4. optionally bind the candidate to a job via an application (status `new`),
 *  all inside one DB transaction per row so a partial failure never leaves a
 *  candidate without its document. If the transaction fails after the Feishu
 *  upload, the orphaned Drive file is deleted.
 *
 * Returns a per-row result so the UI can show created / skipped / error counts.
 */
import { eq, and } from 'drizzle-orm'
import { candidate, document, application, job } from '../../../database/schema'
import { importCommitSchema, type ImportCandidateRow } from '../../../utils/schemas/candidate'
import { getImportStagingFile, deleteImportStagingFile } from '../../../utils/importStaging'
import { uploadToFeishuDrive, deleteFromFeishuDrive } from '../../../utils/feishu'
import { parseDocument } from '../../../utils/resume-parser'
import { sanitizeFilename } from '../../../utils/schemas/document'
import { createRateLimiter } from '../../../utils/rateLimit'

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Too many import requests. Please wait before retrying.',
})

interface CommitResult {
  tempId: string
  status: 'created' | 'skipped_duplicate' | 'error'
  candidateId?: string
  applicationId?: string
  message?: string
}

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505'

export default defineEventHandler(async (event) => {
  await limiter(event)

  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const body = await readValidatedBody(event, importCommitSchema.parse)

  // Rows are processed sequentially: each one does a Feishu upload + a few DB
  // writes, and the batch is capped at 50 by the schema. Sequential keeps the
  // Feishu request rate sane and avoids racing duplicate-email inserts.
  const results: CommitResult[] = []
  for (const row of body.rows) {
    results.push(await commitRow(session, orgId, userId, row))
  }

  const created = results.filter((r) => r.status === 'created').length
  const skipped = results.filter((r) => r.status === 'skipped_duplicate').length
  const errored = results.filter((r) => r.status === 'error').length

  logApiRequest(event, session, 'candidate.import.committed', {
    total: results.length,
    created,
    skipped,
    errored,
  })

  return { results, summary: { created, skipped, errored } }
})

async function commitRow(
  session: { user: { id: string } },
  orgId: string,
  userId: string,
  row: ImportCandidateRow,
): Promise<CommitResult> {
  // 1. Deduplicate by (orgId, email) — never overwrite an existing candidate.
  const existing = await db.query.candidate.findFirst({
    where: and(
      eq(candidate.organizationId, orgId),
      eq(candidate.email, row.email),
    ),
    columns: { id: true },
  })
  if (existing) {
    // Drop the staged file we won't be importing.
    deleteImportStagingFile(orgId, userId, row.tempId)
    return {
      tempId: row.tempId,
      status: 'skipped_duplicate',
      candidateId: existing.id,
      message: 'A candidate with this email already exists',
    }
  }

  // 2. Retrieve the raw bytes staged in phase 1.
  const staged = getImportStagingFile(orgId, userId, row.tempId)
  if (!staged) {
    return {
      tempId: row.tempId,
      status: 'error',
      message: 'Staged file expired or not found — please re-upload',
    }
  }

  // 3. If binding to a job, verify it belongs to this org BEFORE uploading,
  //    so a bad jobId never leaves an orphaned Drive file.
  if (row.jobId) {
    const existingJob = await db.query.job.findFirst({
      where: and(eq(job.id, row.jobId), eq(job.organizationId, orgId)),
      columns: { id: true },
    })
    if (!existingJob) {
      return { tempId: row.tempId, status: 'error', message: 'Selected job not found' }
    }
  }

  // 4. Upload the resume to Feishu Drive.
  let fileToken: string
  try {
    fileToken = await uploadToFeishuDrive(staged.buffer, staged.filename, staged.size)
  } catch (err) {
    logWarn('candidate.import.feishu_upload_failed', {
      temp_id: row.tempId,
      error_message: err instanceof Error ? err.message : String(err),
    })
    return { tempId: row.tempId, status: 'error', message: 'Failed to upload resume to storage' }
  }

  // 5. Re-extract text for parsedContent (staging only carries raw bytes).
  //    Best-effort — a parse failure must not block the import.
  const parsedContent = await parseDocument(staged.buffer, staged.mimeType).catch(() => null)

  // 6. Persist candidate + document (+ optional application) atomically.
  try {
    const result = await db.transaction(async (tx) => {
      const [createdCandidate] = await tx.insert(candidate).values({
        organizationId: orgId,
        firstName: row.firstName,
        lastName: row.lastName,
        displayName: row.displayName ?? null,
        email: row.email,
        phone: row.phone,
        gender: row.gender ?? null,
        dateOfBirth: row.dateOfBirth ?? null,
        quickNotes: row.quickNotes ?? null,
      }).returning({
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      })

      if (!createdCandidate) {
        throw new Error('Failed to create candidate')
      }

      const [createdDocument] = await tx.insert(document).values({
        organizationId: orgId,
        candidateId: createdCandidate.id,
        type: 'resume',
        storageKey: fileToken,
        storageProvider: 'feishu',
        originalFilename: sanitizeFilename(staged.filename),
        mimeType: staged.mimeType,
        sizeBytes: staged.size,
        parsedContent: parsedContent as any,
      }).returning({ id: document.id })

      if (!createdDocument) {
        throw new Error('Failed to create document')
      }

      let applicationId: string | undefined
      if (row.jobId) {
        const [createdApplication] = await tx.insert(application).values({
          organizationId: orgId,
          candidateId: createdCandidate.id,
          jobId: row.jobId,
          status: 'new',
        }).returning({ id: application.id })
        applicationId = createdApplication?.id
      }

      return {
        candidateId: createdCandidate.id,
        documentId: createdDocument.id,
        applicationId,
        name: `${createdCandidate.firstName} ${createdCandidate.lastName}`,
      }
    })

    // Side effects only after the transaction commits.
    recordActivity({
      organizationId: orgId,
      actorId: session.user.id,
      action: 'created',
      resourceType: 'candidate',
      resourceId: result.candidateId,
      metadata: { name: result.name, source: 'batch_import' },
    })
    recordActivity({
      organizationId: orgId,
      actorId: session.user.id,
      action: 'created',
      resourceType: 'document',
      resourceId: result.documentId,
      metadata: { candidateId: result.candidateId, filename: sanitizeFilename(staged.filename), type: 'resume' },
    })
    if (result.applicationId) {
      recordActivity({
        organizationId: orgId,
        actorId: session.user.id,
        action: 'created',
        resourceType: 'application',
        resourceId: result.applicationId,
        metadata: { candidateId: result.candidateId, jobId: row.jobId },
      })
    }

    // Imported successfully — free the staged bytes.
    deleteImportStagingFile(orgId, userId, row.tempId)

    return {
      tempId: row.tempId,
      status: 'created',
      candidateId: result.candidateId,
      applicationId: result.applicationId,
    }
  } catch (err) {
    // DB transaction failed — roll back the resume we already pushed to Feishu.
    await deleteFromFeishuDrive(fileToken).catch((cleanupErr) => {
      logWarn('candidate.import.feishu_orphan_cleanup_failed', {
        file_token: fileToken,
        error_message: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      })
    })

    // A concurrent insert can win the (orgId, email) unique race — treat as duplicate.
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return {
        tempId: row.tempId,
        status: 'skipped_duplicate',
        message: 'A candidate with this email already exists',
      }
    }

    logWarn('candidate.import.commit_failed', {
      temp_id: row.tempId,
      error_message: err instanceof Error ? err.message : String(err),
    })
    return { tempId: row.tempId, status: 'error', message: 'Failed to import candidate' }
  }
}

/**
 * POST /api/candidates/import/parse
 *
 * Phase 1 of batch PDF import: receive multiple resume files, extract text,
 * use AI to identify candidate fields, stage raw bytes in memory, and return
 * preview rows for user confirmation before commit (phase 2).
 */
import { eq, and } from 'drizzle-orm'
import { fileTypeFromBuffer } from 'file-type'
import type { SupportedProvider } from '../../../utils/ai/provider'
import { generateStructuredOutput } from '../../../utils/ai/provider'
import { loadAiConfig } from '../../../utils/ai/loadConfig'
import { parseDocument } from '../../../utils/resume-parser'
import { candidateExtractionSchema, type CandidateExtraction } from '../../../utils/schemas/candidate'
import { saveImportStagingFile } from '../../../utils/importStaging'
import { candidate } from '../../../database/schema'
import { createRateLimiter } from '../../../utils/rateLimit'
import { logError } from '../../../utils/logger'

const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024 // 20MB per file
const IMPORT_MAX_FILES = 20
const IMPORT_AI_CONCURRENCY = 3

// Only PDF and DOCX are supported. Legacy .doc is intentionally excluded:
// file-type reports it as `application/x-cfb`, so it would never match here
// anyway — listing `application/msword` would be a dead entry that misleads.
const PARSEABLE_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Too many import requests. Please wait before retrying.',
})

interface ParseRow {
  tempId: string
  filename: string
  extracted: CandidateExtraction | null
  emailExists: boolean
  parseError?: string
  // Full provider/exception message behind a generic parseError, surfaced in
  // the UI on demand so the user can self-diagnose (e.g. insufficient balance).
  parseErrorDetail?: string
}

const EXTRACTION_SYSTEM_PROMPT = `You are a resume parser. Extract candidate information from the provided resume text.

Extract the following fields (return null if not found):
- firstName: First/given name. For Chinese names, split if possible (e.g., "张" from "张三"); otherwise leave null and use lastName/fullName.
- lastName: Last/family name. For Chinese names that cannot be split, put the full name here. For split names, this is the family name.
- fullName: Full name as written in the resume. Use when firstName/lastName cannot be reliably split.
- email: Email address found in the resume.
- phone: Phone number found in the resume.
- currentTitle: Current job title or position.
- notes: Any additional notes about the candidate from the resume.

Return valid JSON matching the schema.`

export default defineEventHandler(async (event) => {
  await limiter(event)

  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  // Load AI config once (throws 422 if not configured)
  const aiConfig = await loadAiConfig(orgId, { purpose: 'analysis' })

  const providerConfig = {
    provider: aiConfig.provider as SupportedProvider,
    model: aiConfig.model,
    apiKeyEncrypted: aiConfig.apiKeyEncrypted,
    baseUrl: aiConfig.baseUrl,
    maxTokens: aiConfig.maxTokens,
  }

  const form = await readMultipartFormData(event)
  const fileParts = (form ?? []).filter(
    (p) => p.name === 'files' && p.data && p.filename,
  )

  if (fileParts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No files provided' })
  }

  if (fileParts.length > IMPORT_MAX_FILES) {
    throw createError({
      statusCode: 400,
      statusMessage: `Too many files (max ${IMPORT_MAX_FILES})`,
    })
  }

  // Process files in batches of 3 for AI concurrency control
  const results: ParseRow[] = []

  for (let i = 0; i < fileParts.length; i += IMPORT_AI_CONCURRENCY) {
    const batch = fileParts.slice(i, i + IMPORT_AI_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map((part) =>
        processFile(
          { filename: part.filename!, data: part.data! },
          orgId,
          userId,
          providerConfig,
        ),
      ),
    )
    results.push(...batchResults)
  }

  return { rows: results }
})

async function processFile(
  part: { filename: string; data: Buffer },
  orgId: string,
  userId: string,
  providerConfig: {
    provider: SupportedProvider
    model: string
    apiKeyEncrypted: string
    baseUrl?: string | null
    maxTokens: number
  },
): Promise<ParseRow> {
  const tempId = crypto.randomUUID()
  const filename = part.filename

  // Check file size
  if (part.data.length > IMPORT_MAX_FILE_BYTES) {
    return {
      tempId,
      filename,
      extracted: null,
      emailExists: false,
      parseError: 'File too large (max 20MB)',
    }
  }

  // Validate MIME with magic bytes
  const detectedMime = await fileTypeFromBuffer(part.data)
  const mime = detectedMime?.mime

  if (!mime || !PARSEABLE_MIME.has(mime)) {
    return {
      tempId,
      filename,
      extracted: null,
      emailExists: false,
      parseError: 'Unsupported file type',
    }
  }

  // Stage raw bytes (even if extraction fails, user can manually fill fields)
  saveImportStagingFile({
    orgId,
    userId,
    tempId,
    filename,
    mimeType: mime,
    size: part.data.length,
    buffer: part.data,
  })

  // Extract text from document
  const parsed = await parseDocument(part.data, mime)

  if (!parsed?.text) {
    return {
      tempId,
      filename,
      extracted: null,
      emailExists: false,
      parseError: 'Could not extract text',
    }
  }

  // Use AI to extract candidate fields
  let extracted: CandidateExtraction | null = null

  try {
    // Truncate text to first 12000 chars to avoid overly long prompts
    const truncatedText = parsed.text.slice(0, 12000)

    const result = await generateStructuredOutput(providerConfig, {
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt: truncatedText,
      schema: candidateExtractionSchema,
      schemaName: 'CandidateExtraction',
    })

    extracted = result.object
  } catch (err) {
    // Single file failure doesn't crash the whole batch. Log the real cause —
    // the user-facing parseError is generic, so the actual provider error
    // (bad endpoint, auth, unsupported response_format, JSON parse, timeout…)
    // is only visible here.
    logError('candidate.import.ai_extraction_failed', {
      org_id: orgId,
      filename,
      provider: providerConfig.provider,
      model: providerConfig.model,
      error_message: err instanceof Error ? err.message : String(err),
    })
    // Also surface to the server console: PostHog logging is off without
    // POSTHOG_PUBLIC_KEY (e.g. local dev), so logError alone is invisible here.
    console.error(`[import.parse] AI extraction failed for "${filename}":`, err)
    return {
      tempId,
      filename,
      extracted: null,
      emailExists: false,
      parseError: 'AI extraction failed',
      parseErrorDetail:
        err instanceof Error ? (err.statusMessage as string | undefined) ?? err.message : String(err),
    }
  }

  // Check if email already exists
  let emailExists = false
  if (extracted?.email) {
    const emailLower = extracted.email.toLowerCase().trim()
    const existing = await db.query.candidate.findFirst({
      where: and(
        eq(candidate.organizationId, orgId),
        eq(candidate.email, emailLower),
      ),
      columns: { id: true },
    })
    emailExists = !!existing
  }

  return {
    tempId,
    filename,
    extracted,
    emailExists,
  }
}

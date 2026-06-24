import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { document } from '../../../database/schema'
import { downloadFromFeishuDrive } from '../../../utils/feishu'

/**
 * GET /api/documents/:id/preview
 *
 * Stream a PDF document directly through the server for inline preview.
 * The PDF bytes are proxied from S3/MinIO so the iframe loads from the
 * same origin — eliminates cross-origin issues with presigned URLs.
 *
 * Security:
 *   - Auth required, org-scoped
 *   - Document must belong to the authenticated org (prevents IDOR)
 *   - Returns 404 for non-existent or cross-org documents (no information leak)
 *   - Only PDFs allowed for inline preview (DOC/DOCX can contain macros)
 *   - Content-Type forced to application/pdf to prevent MIME confusion
 *   - Content-Disposition: inline allows browser rendering
 *   - X-Frame-Options overridden to SAMEORIGIN for this route only
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { document: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id: documentId } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse)

  // Query scoped by BOTH id AND organizationId — prevents IDOR
  const doc = await db.query.document.findFirst({
    where: and(
      eq(document.id, documentId),
      eq(document.organizationId, orgId),
    ),
    columns: {
      storageKey: true,
      storageProvider: true,
      originalFilename: true,
      mimeType: true,
    },
  })

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  // Only allow inline preview for PDFs — DOC/DOCX can contain macros
  // This check applies to both S3 and Feishu providers
  if (doc.mimeType !== 'application/pdf') {
    throw createError({
      statusCode: 415,
      statusMessage: 'Inline preview is only available for PDF files',
    })
  }

  const encodedFilename = encodeURIComponent(doc.originalFilename)

  let fileBuffer: Buffer
  let contentLength: number

  if (doc.storageProvider === 'feishu') {
    // Fetch from Feishu Drive
    try {
      fileBuffer = await downloadFromFeishuDrive(doc.storageKey)
      contentLength = fileBuffer.length
    } catch (err) {
      throw createError({
        statusCode: 502,
        statusMessage: 'Failed to retrieve document',
      })
    }
  } else {
    // Fetch from S3
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: doc.storageKey,
      }),
    )

    if (!s3Response.Body) {
      throw createError({ statusCode: 500, statusMessage: 'Failed to retrieve document' })
    }

    contentLength = s3Response.ContentLength ?? 0
    fileBuffer = Buffer.from(await s3Response.Body.transformToByteArray())
  }

  // Stream the PDF directly through the server (same-origin for iframe)
  const headers: Record<string, string> = {
    'Content-Type': 'application/pdf',
    // RFC 5987: ASCII fallback + UTF-8 extended filename for international characters
    'Content-Disposition': `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'private, no-store',
    // Override global DENY — allow same-origin framing for preview iframe
    'X-Frame-Options': 'SAMEORIGIN',
    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    // Restrictive CSP — prevent a malicious PDF from loading external resources
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  }

  // Set Content-Length so browsers can render the PDF efficiently
  headers['Content-Length'] = String(contentLength)

  setResponseHeaders(event, headers)

  // Return the file buffer directly (h3 supports Buffer/Uint8Array)
  return fileBuffer
})

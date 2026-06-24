import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiConfig } from '../../../database/schema'
import { setAiConfigDefaultSchema } from '../../../utils/schemas/scoring'

const paramsSchema = z.object({ id: z.string().min(1) })

/**
 * POST /api/ai-config/:id/set-default
 *
 * Claims one or more "default" slots (chatbot, analysis) for this configuration.
 * For each purpose we clear the flag on every row in the organization first,
 * then set it on the chosen row — both inside one transaction.
 *
 * We deliberately avoid a single `set flag = (id = :id)` UPDATE: the partial
 * unique indexes (`ai_config_default_{chatbot,analysis}_idx`, one default per
 * purpose per org) are checked row-by-row and cannot be DEFERRABLE, so a bulk
 * update can transiently leave two rows = true mid-statement and trip the index
 * ("duplicate key violates ai_config_default_analysis_idx"). Clearing first
 * guarantees at most one true row at any point. The unique indexes still act as
 * a DB-level backstop against concurrent set-default requests.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, paramsSchema.parse)
  const body = await readValidatedBody(event, setAiConfigDefaultSchema.parse)

  const existing = await db.query.aiConfig.findFirst({
    where: and(eq(aiConfig.id, id), eq(aiConfig.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'AI configuration not found.' })

  const now = new Date()
  await db.transaction(async (tx) => {
    if (body.purposes.includes('chatbot')) {
      await tx.update(aiConfig)
        .set({ isDefaultChatbot: false, updatedAt: now })
        .where(and(eq(aiConfig.organizationId, orgId), eq(aiConfig.isDefaultChatbot, true)))
      await tx.update(aiConfig)
        .set({ isDefaultChatbot: true, updatedAt: now })
        .where(and(eq(aiConfig.id, id), eq(aiConfig.organizationId, orgId)))
    }
    if (body.purposes.includes('analysis')) {
      await tx.update(aiConfig)
        .set({ isDefaultAnalysis: false, updatedAt: now })
        .where(and(eq(aiConfig.organizationId, orgId), eq(aiConfig.isDefaultAnalysis, true)))
      await tx.update(aiConfig)
        .set({ isDefaultAnalysis: true, updatedAt: now })
        .where(and(eq(aiConfig.id, id), eq(aiConfig.organizationId, orgId)))
    }
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'aiConfig',
    resourceId: id,
    metadata: { setDefault: body.purposes },
  })

  return { success: true }
})

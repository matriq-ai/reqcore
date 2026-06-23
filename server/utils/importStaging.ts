/**
 * In-memory staging store for batch PDF import (phase 1: parse).
 *
 * Phase 1 (parse) extracts text from PDFs and returns preview rows to the user.
 * The raw PDF bytes are held in memory temporarily so phase 2 (commit) can
 * retrieve them for upload to Feishu without the client re-uploading.
 *
 * Keyed by `${orgId}:${userId}:${tempId}` so staged files are strictly
 * scoped to a single user inside a single organisation. A user that is a
 * member of multiple orgs cannot retrieve files staged under a different
 * org's session, even if the temp id is known.
 * Cleared via TTL eviction, on commit success, or on logout (best-effort).
 */

export interface StagedImportFile {
  tempId: string
  userId: string
  orgId: string
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
  expiresAt: number
}

const TTL_MS = 30 * 60 * 1000 // 30 minutes
const MAX_PER_USER = 50

const store = new Map<string, StagedImportFile>()

function key(orgId: string, userId: string, tempId: string) {
  return `${orgId}:${userId}:${tempId}`
}

function evictExpired() {
  const now = Date.now()
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k)
  }
}

export function saveImportStagingFile(input: {
  orgId: string
  userId: string
  tempId: string
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}): void {
  evictExpired()

  const userEntries = Array.from(store.entries())
    .filter(([, v]) => v.userId === input.userId && v.orgId === input.orgId)
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
  while (userEntries.length >= MAX_PER_USER) {
    const oldest = userEntries.shift()
    if (oldest) store.delete(oldest[0])
  }

  store.set(key(input.orgId, input.userId, input.tempId), {
    tempId: input.tempId,
    userId: input.userId,
    orgId: input.orgId,
    filename: input.filename,
    mimeType: input.mimeType,
    size: input.size,
    buffer: input.buffer,
    expiresAt: Date.now() + TTL_MS,
  })
}

export function getImportStagingFile(
  orgId: string,
  userId: string,
  tempId: string,
): StagedImportFile | undefined {
  evictExpired()
  return store.get(key(orgId, userId, tempId))
}

export function deleteImportStagingFile(
  orgId: string,
  userId: string,
  tempId: string,
): void {
  store.delete(key(orgId, userId, tempId))
}

export function clearImportStagingForUser(
  orgId: string,
  userId: string,
): void {
  for (const [k, v] of store) {
    if (v.userId === userId && v.orgId === orgId) store.delete(k)
  }
}

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * GET /api/updates/version
 *
 * Private deployment: this fork no longer tracks the upstream open-source
 * repository's releases, so update checks are disabled. Always reports
 * "no update available" — version updates are managed internally.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const { version: currentVersion } = await readFile(
    resolve(process.cwd(), 'package.json'),
    'utf-8',
  ).then(JSON.parse) as { version: string }

  return {
    currentVersion,
    latestVersion: null as string | null,
    updateAvailable: false,
    releaseUrl: null as string | null,
    releaseNotes: null as string | null,
    publishedAt: null as string | null,
  }
})

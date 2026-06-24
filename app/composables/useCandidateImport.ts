interface CandidateExtraction {
  firstName: string | null
  lastName: string | null
  fullName: string | null
  email: string | null
  phone: string | null
  currentTitle: string | null
  notes: string | null
}

interface ParseRow {
  tempId: string
  filename: string
  extracted: CandidateExtraction | null
  emailExists: boolean
  parseError?: string
  parseErrorDetail?: string
}

interface CommitRow {
  tempId: string
  firstName: string
  lastName: string
  displayName?: string
  email: string
  phone?: string
  jobId?: string
}

interface CommitResult {
  tempId: string
  status: 'created' | 'skipped_duplicate' | 'error'
  candidateId?: string
  applicationId?: string
  message?: string
}

interface CommitSummary {
  total: number
  created: number
  skipped: number
  errored: number
}

interface ImportResult {
  results: CommitResult[]
  summary: CommitSummary
}

export function useCandidateImport() {
  const isParsing = ref(false)
  const isCommitting = ref(false)
  const parseError = ref<string | null>(null)
  const commitError = ref<string | null>(null)
  const rows = ref<ParseRow[]>([])
  const commitResults = ref<ImportResult | null>(null)

  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  async function parseFiles(files: File[]): Promise<void> {
    if (files.length === 0) return

    isParsing.value = true
    parseError.value = null
    rows.value = []
    commitResults.value = null

    try {
      const formData = new FormData()
      for (const file of files) {
        formData.append('files', file)
      }

      const data = await $fetch<{ rows: ParseRow[] }>('/api/candidates/import/parse', {
        method: 'POST',
        body: formData,
      })

      rows.value = data.rows
    } catch (err: any) {
      if (handlePreviewReadOnlyError(err)) return
      parseError.value = err.data?.statusMessage ?? 'Failed to parse files'
      throw err
    } finally {
      isParsing.value = false
    }
  }

  async function commitRows(commitRows: CommitRow[]): Promise<void> {
    if (commitRows.length === 0) return

    isCommitting.value = true
    commitError.value = null

    try {
      const data = await $fetch<ImportResult>('/api/candidates/import/commit', {
        method: 'POST',
        body: { rows: commitRows },
      })

      commitResults.value = data
    } catch (err: any) {
      if (handlePreviewReadOnlyError(err)) return
      commitError.value = err.data?.statusMessage ?? 'Failed to import candidates'
      throw err
    } finally {
      isCommitting.value = false
    }
  }

  function clearRows() {
    rows.value = []
    commitResults.value = null
    parseError.value = null
    commitError.value = null
  }

  return {
    isParsing: readonly(isParsing),
    isCommitting: readonly(isCommitting),
    parseError: readonly(parseError),
    commitError: readonly(commitError),
    rows: readonly(rows),
    commitResults: readonly(commitResults),
    parseFiles,
    commitRows,
    clearRows,
  }
}

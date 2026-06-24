<script setup lang="ts">
import { ArrowLeft, Upload, FileText, Check, X, AlertTriangle, Briefcase, Trash2, ChevronDown } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Import Candidates — Matriq',
  description: 'Batch import candidates from resume files',
})

const localePath = useLocalePath()
const { t } = useI18n()
const { refresh: refreshCandidates } = useCandidates()

const {
  isParsing,
  isCommitting,
  parseError,
  commitError,
  rows,
  commitResults,
  parseFiles,
  commitRows,
  clearRows,
} = useCandidateImport()

// Fetch open jobs
const { data: jobData, status: jobFetchStatus } = useFetch('/api/jobs', {
  key: 'import-job-list',
  query: { status: 'open' },
  headers: useRequestHeaders(['cookie']),
})

const jobs = computed(() => jobData.value?.data ?? [])

// File selection state
const selectedFiles = ref<File[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

// Editable rows with checkboxes
interface EditableRow {
  tempId: string
  filename: string
  firstName: string
  lastName: string
  displayName: string
  email: string
  phone: string
  jobId: string
  selected: boolean
  emailExists: boolean
  parseError?: string
  parseErrorDetail?: string
}

const editableRows = ref<EditableRow[]>([])

// tempIds whose detailed parse error is currently expanded in the status cell
const expandedErrors = ref<Set<string>>(new Set())
function toggleErrorDetail(tempId: string) {
  const next = new Set(expandedErrors.value)
  if (next.has(tempId)) next.delete(tempId)
  else next.add(tempId)
  expandedErrors.value = next
}

function fileToEditableRow(row: import('~~/composables/useCandidateImport').ParseRow): EditableRow {
  return {
    tempId: row.tempId,
    filename: row.filename,
    firstName: row.extracted?.firstName ?? '',
    lastName: row.extracted?.lastName ?? '',
    displayName: row.extracted?.fullName ?? '',
    email: row.extracted?.email ?? '',
    phone: row.extracted?.phone ?? '',
    jobId: '',
    selected: false,
    emailExists: row.emailExists,
    parseError: row.parseError,
    parseErrorDetail: row.parseErrorDetail,
  }
}

async function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length > 0) {
    selectedFiles.value = files
    await parseFiles(files)
    editableRows.value = rows.value.map(fileToEditableRow)
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length > 0) {
    selectedFiles.value = files
    parseFiles(files).then(() => {
      editableRows.value = rows.value.map(fileToEditableRow)
    })
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function removeFile(index: number) {
  selectedFiles.value.splice(index, 1)
  editableRows.value.splice(index, 1)
  if (selectedFiles.value.length === 0) {
    clearRows()
  }
}

function clearAll() {
  selectedFiles.value = []
  editableRows.value = []
  clearRows()
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

// Batch job assignment
const batchJobDropdownOpen = ref(false)
const selectedBatchJobId = ref('')

function applyBatchJob() {
  for (const row of editableRows.value) {
    row.jobId = selectedBatchJobId.value
  }
  batchJobDropdownOpen.value = false
}

// Computed: rows that can be selected (has email and not emailExists)
const selectableRows = computed(() =>
  editableRows.value.filter(row => row.email && !row.emailExists)
)

// Validation: firstName and lastName required
const validationErrors = ref<Record<string, string>>({})

// Helper to get email from editableRows by tempId
function getEmailByTempId(tempId: string): string {
  const row = editableRows.value.find(r => r.tempId === tempId)
  return row?.email ?? ''
}

function validateRow(row: EditableRow): boolean {
  if (!row.firstName.trim()) {
    validationErrors.value[row.tempId] = 'First name is required'
    return false
  }
  if (!row.lastName.trim()) {
    validationErrors.value[row.tempId] = 'Last name is required'
    return false
  }
  delete validationErrors.value[row.tempId]
  return true
}

// Selected count
const selectedCount = computed(() =>
  editableRows.value.filter(row => row.selected && !row.emailExists && row.email).length
)

async function handleImport() {
  const rowsToImport = editableRows.value
    .filter(row => row.selected && row.email && !row.emailExists)
    .filter(row => validateRow(row))

  if (rowsToImport.length === 0) return

  const commitData = rowsToImport.map(row => ({
    tempId: row.tempId,
    firstName: row.firstName.trim(),
    lastName: row.lastName.trim(),
    displayName: row.displayName.trim() || undefined,
    email: row.email.trim().toLowerCase(),
    phone: row.phone.trim() || undefined,
    jobId: row.jobId || undefined,
  }))

  await commitRows(commitData)

  if (commitResults.value) {
    await refreshCandidates()
  }
}

// Navigation after success
const router = useRouter()
watch(commitResults, (results) => {
  if (results && results.summary.errored === 0 && (results.summary.created > 0 || results.summary.skipped > 0)) {
    setTimeout(() => {
      router.push(localePath('/dashboard/candidates'))
    }, 2000)
  }
})
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <!-- Back link -->
    <NuxtLink
      :to="$localePath('/dashboard/candidates')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      {{ t('dashboard.candidates.import.backLink') }}
    </NuxtLink>

    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">
      {{ t('dashboard.candidates.import.title') }}
    </h1>
    <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
      {{ t('dashboard.candidates.import.description') }}
    </p>

    <!-- Parse error -->
    <div
      v-if="parseError"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4"
    >
      {{ parseError }}
    </div>

    <!-- Commit error -->
    <div
      v-if="commitError"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mb-4"
    >
      {{ commitError }}
    </div>

    <!-- File upload area -->
    <div v-if="editableRows.length === 0" class="mb-6">
      <div
        class="relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer"
        :class="isDragging
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
          : 'border-surface-300 dark:border-surface-700 hover:border-brand-400 dark:hover:border-brand-600'"
        @click="fileInputRef?.click()"
        @drop="handleDrop"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
      >
        <input
          ref="fileInputRef"
          type="file"
          accept=".pdf,.docx"
          multiple
          class="hidden"
          @change="handleFileSelect"
        />
        <Upload class="size-10 text-surface-400 mx-auto mb-3" />
        <p class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          {{ t('dashboard.candidates.import.dropzone.title') }}
        </p>
        <p class="text-xs text-surface-500 dark:text-surface-400">
          {{ t('dashboard.candidates.import.dropzone.hint') }}
        </p>
      </div>
    </div>

    <!-- Results view -->
    <div v-else-if="commitResults" class="mb-6">
      <div class="rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6">
        <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
          {{ t('dashboard.candidates.import.results.title') }}
        </h2>

        <!-- Summary -->
        <div class="flex gap-4 mb-4">
          <div class="flex items-center gap-2">
            <Check class="size-5 text-green-600" />
            <span class="text-sm text-surface-700 dark:text-surface-300">
              {{ t('dashboard.candidates.import.results.created', { count: commitResults.summary.created }) }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <AlertTriangle class="size-5 text-yellow-600" />
            <span class="text-sm text-surface-700 dark:text-surface-300">
              {{ t('dashboard.candidates.import.results.skipped', { count: commitResults.summary.skipped }) }}
            </span>
          </div>
          <div v-if="commitResults.summary.errored > 0" class="flex items-center gap-2">
            <X class="size-5 text-red-600" />
            <span class="text-sm text-surface-700 dark:text-surface-300">
              {{ t('dashboard.candidates.import.results.errors', { count: commitResults.summary.errored }) }}
            </span>
          </div>
        </div>

        <!-- Result details -->
        <div class="space-y-2">
          <div
            v-for="result in commitResults.results"
            :key="result.tempId"
            class="flex items-center gap-2 text-sm"
          >
            <template v-if="result.status === 'created'">
              <Check class="size-4 text-green-600 shrink-0" />
              <span class="text-surface-700 dark:text-surface-300">{{ getEmailByTempId(result.tempId) }}</span>
            </template>
            <template v-else-if="result.status === 'skipped_duplicate'">
              <AlertTriangle class="size-4 text-yellow-600 shrink-0" />
              <span class="text-surface-700 dark:text-surface-300">{{ getEmailByTempId(result.tempId) }} — {{ t('dashboard.candidates.import.results.duplicate') }}</span>
            </template>
            <template v-else>
              <X class="size-4 text-red-600 shrink-0" />
              <span class="text-surface-700 dark:text-surface-300">{{ result.message }}</span>
            </template>
          </div>
        </div>

        <div class="mt-4 pt-4 border-t border-surface-200 dark:border-surface-800">
          <NuxtLink
            :to="$localePath('/dashboard/candidates')"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          >
            {{ t('dashboard.candidates.import.results.viewAll') }}
          </NuxtLink>
        </div>
      </div>
    </div>

    <!-- Editable table -->
    <div v-else>
      <!-- Toolbar -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <!-- Batch job dropdown -->
          <div class="relative">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="batchJobDropdownOpen = !batchJobDropdownOpen"
            >
              <Briefcase class="size-4" />
              {{ t('dashboard.candidates.import.batchApplyJob') }}
              <svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div
              v-if="batchJobDropdownOpen"
              class="absolute top-full left-0 mt-1 w-64 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-lg z-10"
            >
              <div class="p-2">
                <select
                  v-model="selectedBatchJobId"
                  class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100"
                >
                  <option value="">{{ t('dashboard.candidates.import.selectJob') }}</option>
                  <option v-for="job in jobs" :key="job.id" :value="job.id">
                    {{ job.title }}
                  </option>
                </select>
                <button
                  v-if="selectedBatchJobId"
                  type="button"
                  class="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
                  @click="applyBatchJob"
                >
                  {{ t('dashboard.candidates.import.apply') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Clear all -->
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            @click="clearAll"
          >
            <Trash2 class="size-4" />
            {{ t('dashboard.candidates.import.clear') }}
          </button>
        </div>

        <!-- Import button -->
        <button
          type="button"
          :disabled="selectedCount === 0 || isCommitting"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          @click="handleImport"
        >
          {{ isCommitting ? t('dashboard.candidates.import.importing') : t('dashboard.candidates.import.importSelected', { count: selectedCount }) }}
        </button>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-800">
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400 w-8">
                <input
                  type="checkbox"
                  :checked="selectedCount === editableRows.filter(r => r.email && !r.emailExists).length && selectedCount > 0"
                  :indeterminate="selectedCount > 0 && selectedCount < editableRows.filter(r => r.email && !r.emailExists).length"
                  class="rounded border-surface-300 dark:border-surface-600"
                  @change="(e) => {
                    const checked = (e.target as HTMLInputElement).checked
                    editableRows.forEach(row => {
                      if (row.email && !row.emailExists) row.selected = checked
                    })
                  }"
                />
              </th>
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400">
                {{ t('dashboard.candidates.import.columns.file') }}
              </th>
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400">
                {{ t('dashboard.candidates.import.columns.firstName') }} *
              </th>
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400">
                {{ t('dashboard.candidates.import.columns.lastName') }} *
              </th>
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400">
                {{ t('dashboard.candidates.import.columns.email') }}
              </th>
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400">
                {{ t('dashboard.candidates.import.columns.phone') }}
              </th>
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400">
                {{ t('dashboard.candidates.import.columns.job') }}
              </th>
              <th class="text-left px-3 py-3 font-medium text-surface-500 dark:text-surface-400">
                {{ t('dashboard.candidates.import.columns.status') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr
              v-for="(row, index) in editableRows"
              :key="row.tempId"
              class="bg-white dark:bg-surface-900"
            >
              <td class="px-3 py-3">
                <input
                  v-model="row.selected"
                  type="checkbox"
                  :disabled="!row.email || row.emailExists"
                  class="rounded border-surface-300 dark:border-surface-600 disabled:opacity-40"
                />
              </td>
              <td class="px-3 py-3">
                <div class="flex items-center gap-2">
                  <FileText class="size-4 text-surface-400 shrink-0" />
                  <span class="text-surface-700 dark:text-surface-300 truncate max-w-[150px]">{{ row.filename }}</span>
                  <button
                    type="button"
                    class="text-surface-400 hover:text-danger-500 transition-colors"
                    @click="removeFile(index)"
                  >
                    <X class="size-3.5" />
                  </button>
                </div>
              </td>
              <td class="px-3 py-3">
                <input
                  v-model="row.firstName"
                  type="text"
                  class="w-full rounded border px-2 py-1 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  :class="validationErrors[row.tempId] && !row.firstName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
                />
              </td>
              <td class="px-3 py-3">
                <input
                  v-model="row.lastName"
                  type="text"
                  class="w-full rounded border px-2 py-1 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  :class="validationErrors[row.tempId] && !row.lastName ? 'border-danger-300' : 'border-surface-300 dark:border-surface-700'"
                />
              </td>
              <td class="px-3 py-3">
                <input
                  v-model="row.email"
                  type="email"
                  class="w-full rounded border border-surface-300 dark:border-surface-700 px-2 py-1 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </td>
              <td class="px-3 py-3">
                <input
                  v-model="row.phone"
                  type="tel"
                  class="w-full rounded border border-surface-300 dark:border-surface-700 px-2 py-1 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </td>
              <td class="px-3 py-3">
                <select
                  v-model="row.jobId"
                  class="w-full rounded border border-surface-300 dark:border-surface-700 px-2 py-1 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">{{ t('dashboard.candidates.import.noJob') }}</option>
                  <option v-for="job in jobs" :key="job.id" :value="job.id">
                    {{ job.title }}
                  </option>
                </select>
              </td>
              <td class="px-3 py-3">
                <div v-if="row.parseError" class="text-red-600 dark:text-red-400 text-xs">
                  <button
                    v-if="row.parseErrorDetail"
                    type="button"
                    class="flex items-center gap-1 hover:underline"
                    @click="toggleErrorDetail(row.tempId)"
                  >
                    <AlertTriangle class="size-3.5 shrink-0" />
                    {{ row.parseError }}
                    <ChevronDown
                      class="size-3.5 shrink-0 transition-transform"
                      :class="{ 'rotate-180': expandedErrors.has(row.tempId) }"
                    />
                  </button>
                  <div v-else class="flex items-center gap-1">
                    <AlertTriangle class="size-3.5 shrink-0" />
                    {{ row.parseError }}
                  </div>
                  <pre
                    v-if="row.parseErrorDetail && expandedErrors.has(row.tempId)"
                    class="mt-1 max-w-xs whitespace-pre-wrap break-words rounded bg-red-50 dark:bg-red-950/40 p-2 text-[11px] leading-snug text-red-700 dark:text-red-300"
                  >{{ row.parseErrorDetail }}</pre>
                </div>
                <div v-else-if="row.emailExists" class="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-xs">
                  <AlertTriangle class="size-3.5" />
                  {{ t('dashboard.candidates.import.status.emailExists') }}
                </div>
                <div v-else-if="row.email" class="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                  <Check class="size-3.5" />
                  {{ t('dashboard.candidates.import.status.ready') }}
                </div>
                <div v-else class="text-surface-400 dark:text-surface-500 text-xs">
                  {{ t('dashboard.candidates.import.status.missingEmail') }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="mt-2 text-xs text-surface-500 dark:text-surface-400">
        {{ t('dashboard.candidates.import.requiredHint') }}
      </p>
    </div>
  </div>
</template>

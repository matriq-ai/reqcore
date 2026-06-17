<script setup lang="ts">
import {
  ArrowLeft,
  Check,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Link2,
  ClipboardCopy,
  Rocket,
  FileEdit,
  ExternalLink,
  PartyPopper,
  Copy,
  Eye,
  Briefcase,
  FileText,
  MessageSquare,
  Brain,
  Sparkles,
  Loader2,
  SlidersHorizontal,
  Lock,
  Upload,
  CircleHelp,
  Share2,
  Globe,
  Mail,
  Users,
  BarChart3,
  Hash,
  Megaphone,
  Building2,
  Search,
} from 'lucide-vue-next'
import { z } from 'zod'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const { t } = useI18n()

useSeoMeta({
  title: 'Create Job — Matriq',
  description: () => t('dashboard.jobs.new.seoDescription'),
})

const localePath = useLocalePath()
const { createJob } = useJobs()
const { track } = useTrack()
const toast = useToast()

type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'number'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'file_upload'

type DraftQuestion = {
  id: string
  label: string
  type: QuestionType
  description?: string | null
  required: boolean
  options?: string[] | null
}

// Wizard state
const currentStep = ref<1 | 2 | 3 | 4>(1)
const steps = computed(() => [
  { id: 1, title: t('dashboard.jobs.new.steps.jobDetails.title'), description: t('dashboard.jobs.new.steps.jobDetails.description') },
  { id: 2, title: t('dashboard.jobs.new.steps.applicationForm.title'), description: t('dashboard.jobs.new.steps.applicationForm.description') },
  { id: 3, title: t('dashboard.jobs.new.steps.aiScoring.title'), description: t('dashboard.jobs.new.steps.aiScoring.description') },
  { id: 4, title: t('dashboard.jobs.new.steps.publish.title'), description: t('dashboard.jobs.new.steps.publish.description') },
])

// Step 1: Job details (API-supported fields)
const form = ref({
  title: '',
  description: '',
  location: '',
  type: 'full_time' as 'full_time' | 'part_time' | 'contract' | 'internship',
  experienceLevel: 'mid' as 'junior' | 'mid' | 'senior' | 'lead',
  remoteStatus: undefined as 'remote' | 'hybrid' | 'onsite' | undefined,
})

// Step 2: Application form (client-only for now)
const applicationForm = ref({
  requireResume: true,
  requireCoverLetter: false,
  questions: [] as DraftQuestion[],
})

// Step 3: AI scoring criteria
type ScoringCriterionDraft = {
  key: string
  name: string
  description: string
  category: 'technical' | 'experience' | 'soft_skills' | 'education' | 'culture' | 'custom'
  maxScore: number
  weight: number
}
const scoringCriteria = ref<ScoringCriterionDraft[]>([])
const scoringMode = ref<'none' | 'premade' | 'ai' | 'custom'>('none')
const selectedTemplate = ref<'standard' | 'technical' | 'non_technical'>('standard')
const isGeneratingCriteria = ref(false)
const showCustomForm = ref(false)
const editingCriterion = ref<ScoringCriterionDraft | null>(null)
const autoScoreOnApply = ref(false)

const customCriterionForm = ref({
  key: '',
  name: '',
  description: '',
  category: 'custom' as ScoringCriterionDraft['category'],
  maxScore: 10,
  weight: 50,
})

const categoryLabels = computed<Record<string, string>>(() => ({
  technical: t('dashboard.jobs.new.scoring.categories.technical'),
  experience: t('dashboard.jobs.new.scoring.categories.experience'),
  soft_skills: t('dashboard.jobs.new.scoring.categories.softSkills'),
  education: t('dashboard.jobs.new.scoring.categories.education'),
  culture: t('dashboard.jobs.new.scoring.categories.culture'),
  custom: t('dashboard.jobs.new.scoring.categories.custom'),
}))

const categoryColorClasses: Record<string, string> = {
  technical: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-800',
  experience: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:ring-purple-800',
  soft_skills: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800',
  education: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800',
  culture: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/50 dark:text-pink-300 dark:ring-pink-800',
  custom: 'bg-surface-50 text-surface-700 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-300 dark:ring-surface-700',
}

async function loadPremadeCriteria(template: 'standard' | 'technical' | 'non_technical') {
  try {
    // Use local pre-made templates (no API call needed)
    const templates: Record<string, ScoringCriterionDraft[]> = {
      standard: [
        { key: 'technical_skills', name: 'Technical Skills', description: 'Evaluate the candidate\'s technical competencies against the job requirements.', category: 'technical', maxScore: 10, weight: 50 },
        { key: 'relevant_experience', name: 'Relevant Experience', description: 'Assess years and quality of experience directly relevant to the role.', category: 'experience', maxScore: 10, weight: 50 },
        { key: 'education_fit', name: 'Education & Certifications', description: 'Evaluate educational background and certifications relevant to the position.', category: 'education', maxScore: 10, weight: 30 },
      ],
      technical: [
        { key: 'core_tech_stack', name: 'Core Tech Stack Match', description: 'How well the candidate\'s technical skills match the primary technologies.', category: 'technical', maxScore: 10, weight: 70 },
        { key: 'system_design', name: 'System Design & Architecture', description: 'Evidence of system design experience and architectural decision-making.', category: 'technical', maxScore: 10, weight: 50 },
        { key: 'engineering_practices', name: 'Engineering Practices', description: 'Testing, CI/CD, code review, and software development lifecycle experience.', category: 'technical', maxScore: 10, weight: 40 },
        { key: 'relevant_experience', name: 'Relevant Experience', description: 'Years and depth of experience in similar roles or domains.', category: 'experience', maxScore: 10, weight: 50 },
        { key: 'leadership_collab', name: 'Leadership & Collaboration', description: 'Evidence of mentoring, tech leadership, and cross-team collaboration.', category: 'soft_skills', maxScore: 10, weight: 30 },
      ],
      non_technical: [
        { key: 'relevant_experience', name: 'Relevant Experience', description: 'Depth and breadth of experience applicable to the role.', category: 'experience', maxScore: 10, weight: 60 },
        { key: 'communication', name: 'Communication Skills', description: 'Evidence of written and verbal communication ability.', category: 'soft_skills', maxScore: 10, weight: 50 },
        { key: 'domain_knowledge', name: 'Domain Knowledge', description: 'Relevant industry or domain expertise.', category: 'experience', maxScore: 10, weight: 40 },
        { key: 'education_fit', name: 'Education & Certifications', description: 'Educational background and certifications relevant to the position.', category: 'education', maxScore: 10, weight: 30 },
        { key: 'culture_fit', name: 'Culture & Values Alignment', description: 'Indicators of alignment with company values and team culture.', category: 'culture', maxScore: 10, weight: 30 },
      ],
    }
    scoringCriteria.value = templates[template] ?? []
    scoringMode.value = 'premade'
  } catch (err: any) {
    toast.error(t('dashboard.jobs.new.toasts.loadTemplateFailed'), { message: err?.data?.statusMessage })
  }
}

async function generateAiCriteria() {
  if (!form.value.title) {
    toast.warning(t('dashboard.jobs.new.toasts.jobTitleRequired.title'), t('dashboard.jobs.new.toasts.jobTitleRequired.message'))
    return
  }
  if (!form.value.description) {
    toast.warning(t('dashboard.jobs.new.toasts.jobDescriptionRequired.title'), t('dashboard.jobs.new.toasts.jobDescriptionRequired.message'))
    return
  }
  isGeneratingCriteria.value = true
  try {
    const result = await $fetch('/api/ai-config/generate-criteria', {
      method: 'POST',
      body: {
        title: form.value.title,
        description: form.value.description,
      },
    })
    scoringCriteria.value = (result.criteria ?? []).map((c: any) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      category: c.category ?? 'custom',
      maxScore: c.maxScore ?? 10,
      weight: c.weight ?? 50,
    }))
    scoringMode.value = 'ai'
    toast.success(t('dashboard.jobs.new.toasts.criteriaGenerated.title'), t('dashboard.jobs.new.toasts.criteriaGenerated.message', { count: scoringCriteria.value.length }))
  } catch (err: any) {
    const statusCode = err?.data?.statusCode ?? err?.statusCode
    const statusMessage = err?.data?.statusMessage ?? ''
    if (statusCode === 422 && statusMessage.includes('AI provider not configured')) {
      toast.add({
        type: 'warning',
        title: t('dashboard.jobs.new.toasts.aiNotConfigured.title'),
        message: t('dashboard.jobs.new.toasts.aiNotConfigured.message'),
        link: { label: t('dashboard.jobs.new.toasts.aiNotConfigured.link'), href: '/dashboard/settings/ai' },
        duration: 10000,
      })
    } else {
      toast.error(t('dashboard.jobs.new.toasts.generateCriteriaFailed.title'), {
        message: t('dashboard.jobs.new.toasts.generateCriteriaFailed.message'),
        details: statusMessage || t('dashboard.jobs.new.toasts.unknownErrorDetail', { statusCode: statusCode ?? 'Unknown' }),
        statusCode,
      })
    }
  } finally {
    isGeneratingCriteria.value = false
  }
}

function addCustomCriterion() {
  const f = customCriterionForm.value
  if (!f.key || !f.name) return

  const keyExists = scoringCriteria.value.some(c => c.key === f.key)
  if (keyExists) {
    toast.warning(t('dashboard.jobs.new.toasts.duplicateCriterion.title'), t('dashboard.jobs.new.toasts.duplicateCriterion.message', { key: f.key }))
    return
  }

  scoringCriteria.value.push({
    key: f.key,
    name: f.name,
    description: f.description,
    category: f.category,
    maxScore: f.maxScore,
    weight: f.weight,
  })
  customCriterionForm.value = { key: '', name: '', description: '', category: 'custom', maxScore: 10, weight: 50 }
  showCustomForm.value = false
  if (scoringMode.value === 'none') scoringMode.value = 'custom'
}

function removeCriterion(key: string) {
  scoringCriteria.value = scoringCriteria.value.filter(c => c.key !== key)
}

function autoGenerateKey(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50)
}

const isSubmitting = ref(false)
const errors = ref<Record<string, string>>({})
const showAddForm = ref(false)
const editingQuestion = ref<DraftQuestion | null>(null)
const linkCopied = ref(false)
const questionActionError = ref<string | null>(null)
const nextQuestionId = ref(1)

// Check if at least one AI provider is configured with a valid API key.
// /api/ai-config returns an array of configurations now (multi-config era).
interface AiConfigCheckRow { hasApiKey: boolean }
const { data: aiConfigData } = useFetch<AiConfigCheckRow[]>('/api/ai-config', { key: 'ai-config-check', headers: useRequestHeaders(['cookie']) })
const isAiConfigured = computed(() => {
  return Array.isArray(aiConfigData.value) && aiConfigData.value.some((c) => c.hasApiKey)
})

// Auto-save to localStorage
const AUTO_SAVE_KEY = 'reqcore-job-draft'

function saveFormToStorage() {
  if (!import.meta.client) return
  try {
    const data = {
      form: form.value,
      applicationForm: applicationForm.value,
      scoringCriteria: scoringCriteria.value,
      scoringMode: scoringMode.value,
      autoScoreOnApply: autoScoreOnApply.value,
      currentStep: currentStep.value,
    }
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(data))
  } catch { /* storage full or unavailable */ }
}

function restoreFormFromStorage() {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (data.form) Object.assign(form.value, data.form)
    if (data.applicationForm) Object.assign(applicationForm.value, data.applicationForm)
    if (data.scoringCriteria) scoringCriteria.value = data.scoringCriteria
    if (data.scoringMode) scoringMode.value = data.scoringMode
    if (data.autoScoreOnApply != null) autoScoreOnApply.value = data.autoScoreOnApply
    if (data.currentStep) currentStep.value = data.currentStep
  } catch { /* corrupted data, ignore */ }
}

function clearFormStorage() {
  if (!import.meta.client) return
  try { localStorage.removeItem(AUTO_SAVE_KEY) } catch { /* ignore */ }
}

onMounted(() => {
  restoreFormFromStorage()
})

// Reset all wizard state to initial values (called when user clicks "New Job" again)
function resetState() {
  currentStep.value = 1
  form.value = {
    title: '',
    description: '',
    location: '',
    type: 'full_time',
    experienceLevel: 'mid',
    remoteStatus: undefined,
  }
  applicationForm.value = {
    requireResume: true,
    requireCoverLetter: false,
    questions: [],
  }
  scoringCriteria.value = []
  scoringMode.value = 'none'
  autoScoreOnApply.value = false
  isPublished.value = false
  createdJobId.value = ''
  createdJobSlug.value = ''
  finalApplicationLink.value = ''
  errors.value = {}
  createdLinks.value = {}
  customBoardLinks.value = []
  clearFormStorage()
}

// Shared signal incremented by AppTopBar when the user is already on this page
const newJobResetSignal = useState('new-job-reset-signal', () => 0)
watch(newJobResetSignal, (next, prev) => {
  if (next > prev) resetState()
})

// Auto-save when step changes or form data changes
watch([currentStep, form, applicationForm, scoringCriteria, scoringMode, autoScoreOnApply], () => {
  saveFormToStorage()
}, { deep: true })

// Notify user when entering step 3 without AI configured
watch(currentStep, (step) => {
  if (step === 3 && !isAiConfigured.value) {
    toast.add({
      type: 'warning',
      title: t('dashboard.jobs.new.toasts.aiIntegrationNotSetUp.title'),
      message: t('dashboard.jobs.new.toasts.aiIntegrationNotSetUp.message'),
      link: { label: t('dashboard.jobs.new.toasts.aiNotConfigured.link'), href: '/dashboard/settings/ai' },
      duration: 10000,
    })
  }
})

// Step 4: Publish & Distribute
const publishChoice = ref<'publish' | 'draft'>('publish')
const isPublished = ref(false)
const createdJobSlug = ref('')
const createdJobId = ref('')
const finalApplicationLink = ref('')
const linkCopiedFinal = ref(false)

// Distribution channels for quick tracking link creation
const distributionChannels = computed(() => [
  { channel: 'linkedin', name: t('dashboard.jobs.new.channels.linkedin.name'), description: t('dashboard.jobs.new.channels.linkedin.description'), category: 'job_board' },
  { channel: 'indeed', name: t('dashboard.jobs.new.channels.indeed.name'), description: t('dashboard.jobs.new.channels.indeed.description'), category: 'job_board' },
  { channel: 'glassdoor', name: t('dashboard.jobs.new.channels.glassdoor.name'), description: t('dashboard.jobs.new.channels.glassdoor.description'), category: 'job_board' },
  { channel: 'ziprecruiter', name: t('dashboard.jobs.new.channels.ziprecruiter.name'), description: t('dashboard.jobs.new.channels.ziprecruiter.description'), category: 'job_board' },
  { channel: 'email', name: t('dashboard.jobs.new.channels.email.name'), description: t('dashboard.jobs.new.channels.email.description'), category: 'outreach' },
  { channel: 'referral', name: t('dashboard.jobs.new.channels.referral.name'), description: t('dashboard.jobs.new.channels.referral.description'), category: 'outreach' },
  { channel: 'career_site', name: t('dashboard.jobs.new.channels.careerSite.name'), description: t('dashboard.jobs.new.channels.careerSite.description'), category: 'outreach' },
  { channel: 'twitter', name: t('dashboard.jobs.new.channels.twitter.name'), description: t('dashboard.jobs.new.channels.twitter.description'), category: 'social' },
  { channel: 'facebook', name: t('dashboard.jobs.new.channels.facebook.name'), description: t('dashboard.jobs.new.channels.facebook.description'), category: 'social' },
  { channel: 'reddit', name: t('dashboard.jobs.new.channels.reddit.name'), description: t('dashboard.jobs.new.channels.reddit.description'), category: 'social' },
])

const channelIcons: Record<string, any> = {
  linkedin: Briefcase,
  indeed: Search,
  glassdoor: Building2,
  ziprecruiter: Megaphone,
  email: Mail,
  referral: Users,
  career_site: Globe,
  twitter: Hash,
  facebook: Users,
  reddit: MessageSquare,
}

// Track created distribution links: channel → { code, url, loading, copied }
const createdLinks = ref<Record<string, { code: string; url: string; loading: boolean; copied: boolean }>>({})

async function createChannelLink(channel: string, channelName: string) {
  if (createdLinks.value[channel]?.code) return
  createdLinks.value[channel] = { code: '', url: '', loading: true, copied: false }
  try {
    const result = await $fetch<{ id: string; code: string }>('/api/tracking-links', {
      method: 'POST',
      body: {
        jobId: createdJobId.value,
        channel,
        name: `${form.value.title} — ${channelName}`,
      },
    })
    const base = `${requestUrl.protocol}//${requestUrl.host}`
    const trackUrl = `${base}/api/public/track/${encodeURIComponent(result.code)}`
    createdLinks.value[channel] = { code: result.code, url: trackUrl, loading: false, copied: false }
    track('tracking_link_created', { channel, source: 'job_wizard' })
  } catch {
    delete createdLinks.value[channel]
    toast.error(t('dashboard.jobs.new.toasts.createTrackingLinkFailed', { name: channelName }))
  }
}

async function copyChannelLink(channel: string) {
  const link = createdLinks.value[channel]
  if (!link?.url) return
  try {
    await navigator.clipboard.writeText(link.url)
    link.copied = true
    setTimeout(() => { link.copied = false }, 2500)
  } catch {
    toast.info(link.url)
  }
}

const createdLinkCount = computed(() =>
  Object.values(createdLinks.value).filter(l => l.code).length + customBoardLinks.value.length
)

// Custom job board links
const customBoardName = ref('')
const customBoardLinks = ref<Array<{ id: string; name: string; channel: string; code: string; url: string; copied: boolean }>>([])
const isCreatingCustomBoard = ref(false)

async function createCustomBoardLink() {
  const name = customBoardName.value.trim()
  if (!name) return
  // Use a slug derived from the custom board name for local dedup only
  const dedupeKey = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}`

  // Prevent duplicates
  if (customBoardLinks.value.some(l => l.channel === dedupeKey)) {
    toast.warning(t('dashboard.jobs.new.toasts.duplicateBoard.title'), t('dashboard.jobs.new.toasts.duplicateBoard.message', { name }))
    return
  }

  isCreatingCustomBoard.value = true
  try {
    const result = await $fetch<{ id: string; code: string }>('/api/tracking-links', {
      method: 'POST',
      body: {
        jobId: createdJobId.value,
        channel: 'custom',
        name: `${form.value.title} — ${name}`,
      },
    })
    const base = `${requestUrl.protocol}//${requestUrl.host}`
    const trackUrl = `${base}/api/public/track/${encodeURIComponent(result.code)}`
    customBoardLinks.value.push({ id: result.id, name, channel: dedupeKey, code: result.code, url: trackUrl, copied: false })
    customBoardName.value = ''
    track('tracking_link_created', { channel: 'custom', customName: name, source: 'job_wizard_custom' })
  } catch {
    toast.error(t('dashboard.jobs.new.toasts.createTrackingLinkFailed', { name }))
  } finally {
    isCreatingCustomBoard.value = false
  }
}

async function copyCustomBoardLink(index: number) {
  const link = customBoardLinks.value[index]
  if (!link?.url) return
  try {
    await navigator.clipboard.writeText(link.url)
    link.copied = true
    setTimeout(() => { link.copied = false }, 2500)
  } catch {
    toast.info(link.url)
  }
}

// Validation (only Step 1 is required to submit)
const formSchema = z.object({
  title: z
    .string()
    .min(1, t('dashboard.jobs.new.validation.titleRequired'))
    .max(200, t('dashboard.jobs.new.validation.titleMaxLength')),
  description: z.string().optional(),
  location: z.string().optional(),
  type: z.enum(['full_time', 'part_time', 'contract', 'internship']),
})

function validateStep1(): boolean {
  const result = formSchema.safeParse(form.value)
  if (!result.success) {
    errors.value = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0]?.toString()
      if (field) errors.value[field] = issue.message
    }
    return false
  }
  errors.value = {}
  return true
}

// Pure check with no side-effects so it never populates errors on its own
const isStep1Valid = computed(() => formSchema.safeParse(form.value).success)

const canGoNext = computed(() => {
  if (currentStep.value === 1) return isStep1Valid.value
  return true
})

function goToStep(step: 1 | 2 | 3 | 4) {
  if (step === currentStep.value) return
  // Validate step 1 before leaving it
  if (currentStep.value === 1 && step > 1 && !validateStep1()) return
  currentStep.value = step
}

function nextStep() {
  if (currentStep.value < 4) {
    if (currentStep.value === 1 && !validateStep1()) return
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 1) currentStep.value--
}

function handleAddQuestion(data: {
  label: string
  type: string
  description?: string
  required: boolean
  options?: string[]
}) {
  applicationForm.value.questions.push({
    id: `draft-${nextQuestionId.value++}`,
    label: data.label,
    type: data.type as QuestionType,
    description: data.description ?? null,
    required: data.required,
    options: data.options ?? null,
  })
  showAddForm.value = false
  questionActionError.value = null
}

function handleUpdateQuestion(data: {
  label: string
  type: string
  description?: string
  required: boolean
  options?: string[]
}) {
  if (!editingQuestion.value) return

  const index = applicationForm.value.questions.findIndex((q) => q.id === editingQuestion.value?.id)
  if (index === -1) return

  const existingQuestion = applicationForm.value.questions[index]
  if (!existingQuestion) return

  applicationForm.value.questions[index] = {
    id: existingQuestion.id,
    label: data.label,
    type: data.type as QuestionType,
    description: data.description ?? null,
    required: data.required,
    options: data.options ?? null,
  }
  editingQuestion.value = null
  questionActionError.value = null
}

function handleDeleteQuestion(questionId: string) {
  const index = applicationForm.value.questions.findIndex((q) => q.id === questionId)
  if (index === -1) return
  applicationForm.value.questions.splice(index, 1)
  if (editingQuestion.value?.id === questionId) {
    editingQuestion.value = null
  }
  questionActionError.value = null
}

function moveQuestion(index: number, direction: 'up' | 'down') {
  const list = applicationForm.value.questions
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= list.length) return
  ;[list[index], list[targetIndex]] = [list[targetIndex]!, list[index]!]
}

function slugifyTitle(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

const requestUrl = useRequestURL()
const applicationLink = computed(() => {
  const base = `${requestUrl.protocol}//${requestUrl.host}`
  const slugBase = slugifyTitle(form.value.title) || 'new-job'
  return `${base}/jobs/${slugBase}-xxxxxxxx/apply`
})

async function copyApplicationLink() {
  try {
    await navigator.clipboard.writeText(applicationLink.value)
    linkCopied.value = true
    setTimeout(() => {
      linkCopied.value = false
    }, 2000)
  } catch {
    // ignore clipboard issues silently
  }
}

async function handleSubmit(mode: 'publish' | 'draft' = publishChoice.value) {
  // Ensure step 1 is valid before submit
  if (!validateStep1()) {
    currentStep.value = 1
    return
  }

  isSubmitting.value = true
  try {
    const created = await createJob({
      title: form.value.title,
      description: form.value.description || undefined,
      location: form.value.location || undefined,
      type: form.value.type,
      experienceLevel: form.value.experienceLevel || undefined,
      remoteStatus: form.value.remoteStatus || undefined,
      requireResume: applicationForm.value.requireResume,
      requireCoverLetter: applicationForm.value.requireCoverLetter,
      autoScoreOnApply: autoScoreOnApply.value,
    })

    track('job_created')

    if (applicationForm.value.questions.length > 0 && created?.id) {
      await Promise.all(
        applicationForm.value.questions.map((question, index) => (
          $fetch(`/api/jobs/${created.id}/questions`, {
            method: 'POST',
            body: {
              label: question.label,
              type: question.type,
              description: question.description || undefined,
              required: question.required,
              options: question.options || undefined,
              displayOrder: index,
            },
          })
        )),
      )
    }

    // Save scoring criteria if any were configured
    if (scoringCriteria.value.length > 0 && created?.id) {
      try {
        await $fetch(`/api/jobs/${created.id}/criteria`, {
          method: 'POST',
          body: {
            criteria: scoringCriteria.value.map((c, i) => ({
              key: c.key,
              name: c.name,
              description: c.description || undefined,
              category: c.category,
              maxScore: c.maxScore,
              weight: c.weight,
              displayOrder: i,
            })),
          },
        })
      } catch {
        // Non-blocking: criteria can be added later from job settings
      }
    }

    if (mode === 'publish' && created?.id) {
      // Publish the job immediately
      await $fetch(`/api/jobs/${created.id}`, {
        method: 'PATCH',
        body: { status: 'open' },
      })

      // Build the real application link
      const base = `${requestUrl.protocol}//${requestUrl.host}`
      const slug = created.slug || created.id
      finalApplicationLink.value = `${base}/jobs/${slug}/apply`
      createdJobSlug.value = slug
      createdJobId.value = created.id

      track('job_published')

      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(finalApplicationLink.value)
        linkCopiedFinal.value = true
        setTimeout(() => { linkCopiedFinal.value = false }, 3000)
      } catch {
        // Clipboard may not be available
      }

      isPublished.value = true
    } else {
      // Saved as draft — go to jobs list
      await navigateTo(localePath('/dashboard/jobs'))
    }
    clearFormStorage()
  } catch (err: any) {
    const statusMessage = err?.data?.statusMessage ?? t('dashboard.jobs.new.toasts.unexpectedError')
    toast.error(t('dashboard.jobs.new.toasts.createJobFailed'), {
      message: statusMessage,
      statusCode: err?.data?.statusCode,
    })
  } finally {
    isSubmitting.value = false
  }
}

async function copyFinalLink() {
  try {
    await navigator.clipboard.writeText(finalApplicationLink.value)
    linkCopiedFinal.value = true
    setTimeout(() => { linkCopiedFinal.value = false }, 3000)
  } catch {
    // fallback: show the link so the user can copy manually
    toast.info(finalApplicationLink.value)
  }
}

const typeOptions = computed(() => [
  { value: 'full_time', label: t('dashboard.jobs.list.types.fullTime') },
  { value: 'part_time', label: t('dashboard.jobs.list.types.partTime') },
  { value: 'contract', label: t('dashboard.jobs.list.types.contract') },
  { value: 'internship', label: t('dashboard.jobs.list.types.internship') },
])

const questionTypeLabels = computed<Record<QuestionType, string>>(() => ({
  short_text: t('dashboard.jobs.new.questionTypes.shortText'),
  long_text: t('dashboard.jobs.new.questionTypes.longText'),
  single_select: t('dashboard.jobs.new.questionTypes.singleSelect'),
  multi_select: t('dashboard.jobs.new.questionTypes.multiSelect'),
  number: t('dashboard.jobs.new.questionTypes.number'),
  date: t('dashboard.jobs.new.questionTypes.date'),
  url: t('dashboard.jobs.new.questionTypes.url'),
  checkbox: t('dashboard.jobs.new.questionTypes.checkbox'),
  file_upload: t('dashboard.jobs.new.questionTypes.fileUpload'),
}))
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <!-- Header with top actions -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
      <div>
        <NuxtLink
          :to="$localePath('/dashboard/jobs')"
          class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-2 transition-colors"
        >
          <ArrowLeft class="size-4" />
          {{ $t('dashboard.jobs.new.backToJobs') }}
        </NuxtLink>
        <h1 class="text-3xl font-bold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.title') }}</h1>
      </div>
      <div v-if="!isPublished" class="flex items-center gap-3">
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          @click="handleSubmit('draft')"
          :disabled="isSubmitting"
        >
          {{ $t('dashboard.jobs.new.saveDraft') }}
        </button>
        <button
          v-if="currentStep < 4"
          type="button"
          :disabled="!canGoNext"
          @click="nextStep"
          class="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {{ $t('dashboard.jobs.new.saveAndContinue') }}
        </button>
      </div>
    </div>

    <!-- Stepper -->
    <div class="mb-10">
      <ol class="flex items-center w-full gap-2">
        <li
          v-for="(step, idx) in steps"
          :key="step.id"
          class="flex items-center flex-1 min-w-0 cursor-pointer"
          @click="goToStep(step.id as typeof currentStep)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <div
              class="flex items-center justify-center size-7 rounded-full border text-xs font-medium shrink-0 transition-all"
              :class="[
                currentStep === step.id
                  ? 'bg-brand-600 text-white border-brand-600 ring-2 ring-brand-100 dark:ring-brand-950'
                  : currentStep > step.id
                    ? 'bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800'
                    : 'bg-white dark:bg-surface-900 text-surface-400 dark:text-surface-500 border-surface-200 dark:border-surface-800'
              ]"
            >
              <span v-if="currentStep > step.id" class="text-xs">&#10003;</span>
              <span v-else>{{ step.id }}</span>
            </div>
            <span
              class="text-xs font-medium truncate hidden sm:inline"
              :class="currentStep >= step.id ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400 dark:text-surface-500'"
            >
              {{ step.title }}
            </span>
          </div>
          <div
            v-if="idx < steps.length - 1"
            class="flex-1 h-0.5 mx-2 rounded-full transition-colors"
            :class="currentStep > step.id ? 'bg-brand-600' : 'bg-surface-200 dark:bg-surface-800'"
          />
        </li>
      </ol>
    </div>

    <!-- Main Layout: Form + Tips -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Left side: Form -->
      <div class="lg:col-span-8 space-y-6">

        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
          <form @submit.prevent="() => handleSubmit()" class="p-6 md:p-8">
            <!-- Step 1: Job details -->
            <section v-if="currentStep === 1" class="space-y-10">
              <!-- Section: Job title and department -->
              <div class="space-y-6">
                <div>
                  <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ $t('dashboard.jobs.new.jobDetails.sectionTitle') }}</h2>
                  <label for="title" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    {{ $t('dashboard.jobs.new.jobDetails.jobTitle') }} <span class="text-danger-500">*</span>
                  </label>
                  <input
                    id="title"
                    v-model="form.title"
                    type="text"
                    :placeholder="$t('dashboard.jobs.new.jobDetails.jobTitlePlaceholder')"
                    class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    :class="errors.title ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                    @blur="validateStep1"
                  />
                  <p v-if="errors.title" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400 font-medium">{{ errors.title }}</p>
                  <p v-else class="mt-1.5 text-xs text-surface-500">{{ $t('dashboard.jobs.new.jobDetails.jobTitleHint') }}</p>
                </div>
              </div>

              <!-- Section: Location -->
              <div class="space-y-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ $t('dashboard.jobs.new.jobDetails.locationSectionTitle') }}</h2>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label for="location" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                      {{ $t('dashboard.jobs.new.jobDetails.officeLocation') }}
                    </label>
                    <input
                      id="location"
                      v-model="form.location"
                      type="text"
                      :placeholder="$t('dashboard.jobs.new.jobDetails.officeLocationPlaceholder')"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors border-surface-300 dark:border-surface-700"
                    />
                  </div>
                  <div>
                    <label for="type" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                      {{ $t('dashboard.jobs.new.jobDetails.workplaceType') }}
                    </label>
                    <select
                      id="type"
                      v-model="form.type"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors bg-white dark:bg-surface-900 border-surface-300 dark:border-surface-700"
                    >
                      <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Section: Experience & Remote -->
              <div class="space-y-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ $t('dashboard.jobs.new.jobDetails.detailsSectionTitle') }}</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label for="experienceLevel" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">{{ $t('dashboard.jobs.new.jobDetails.experienceLevel') }}</label>
                    <select
                      id="experienceLevel"
                      v-model="form.experienceLevel"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    >
                      <option value="junior">{{ $t('dashboard.jobs.list.experience.junior') }}</option>
                      <option value="mid">{{ $t('dashboard.jobs.list.experience.mid') }}</option>
                      <option value="senior">{{ $t('dashboard.jobs.list.experience.senior') }}</option>
                      <option value="lead">{{ $t('dashboard.jobs.list.experience.lead') }}</option>
                    </select>
                  </div>
                  <div>
                    <label for="remoteStatus" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">{{ $t('dashboard.jobs.new.jobDetails.remoteStatus') }}</label>
                    <select
                      id="remoteStatus"
                      v-model="form.remoteStatus"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    >
                      <option :value="undefined">{{ $t('dashboard.jobs.new.jobDetails.remoteNotSpecified') }}</option>
                      <option value="remote">{{ $t('dashboard.jobs.list.remote.remote') }}</option>
                      <option value="hybrid">{{ $t('dashboard.jobs.list.remote.hybrid') }}</option>
                      <option value="onsite">{{ $t('dashboard.jobs.list.remote.onsite') }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Section: Description -->
              <div class="space-y-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ $t('dashboard.jobs.new.jobDetails.descriptionSectionTitle') }}</h2>
                <div>
                  <label for="description" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    {{ $t('dashboard.jobs.new.jobDetails.aboutTheRole') }}
                  </label>
                  <textarea
                    id="description"
                    v-model="form.description"
                    rows="10"
                    :placeholder="$t('dashboard.jobs.new.jobDetails.aboutTheRolePlaceholder')"
                    class="w-full rounded-lg border px-4 py-3 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors border-surface-300 dark:border-surface-700"
                  />
                  <p class="mt-2 text-xs text-surface-500">{{ $t('dashboard.jobs.new.jobDetails.descriptionHint') }}</p>
                </div>
              </div>
            </section>

            <!-- Step 2: Application form -->
            <section v-else-if="currentStep === 2" class="space-y-8">
              <div>
                <p class="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-3">{{ $t('dashboard.jobs.new.applicationForm.sectionLabel') }}</p>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed">
                  {{ $t('dashboard.jobs.new.applicationForm.description') }}
                </p>
              </div>

              <!-- Personal information -->
              <div>
                <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 pb-3 border-b border-surface-100 dark:border-surface-800">{{ $t('dashboard.jobs.new.applicationForm.personalInformation') }}</h2>
                <div class="divide-y divide-surface-100 dark:divide-surface-800">
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.applicationForm.firstName') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800">
                      {{ $t('dashboard.jobs.new.applicationForm.mandatory') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.applicationForm.lastName') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800">
                      {{ $t('dashboard.jobs.new.applicationForm.mandatory') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.applicationForm.email') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800">
                      {{ $t('dashboard.jobs.new.applicationForm.mandatory') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.applicationForm.phone') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2.5 py-1 text-xs font-medium text-surface-600 dark:text-surface-400 ring-1 ring-inset ring-surface-200 dark:ring-surface-700">
                      {{ $t('dashboard.jobs.new.applicationForm.optional') }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Documents -->
              <div>
                <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 pb-3 border-b border-surface-100 dark:border-surface-800">{{ $t('dashboard.jobs.new.applicationForm.documents') }}</h2>
                <div class="divide-y divide-surface-100 dark:divide-surface-800">
                  <!-- Resume -->
                  <div class="flex items-center justify-between py-4 px-1">
                    <div>
                      <div class="flex items-center gap-2">
                        <Upload class="size-4 text-surface-400 dark:text-surface-500" />
                        <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.applicationForm.resume') }}</span>
                      </div>
                      <p class="text-xs text-surface-400 dark:text-surface-500 mt-1 ml-6">{{ $t('dashboard.jobs.new.applicationForm.resumeHint') }}</p>
                    </div>
                    <div class="inline-flex items-center rounded-lg bg-surface-100 dark:bg-surface-800 p-0.5" role="radiogroup" :aria-label="$t('dashboard.jobs.new.applicationForm.resumeRequirementAriaLabel')">
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="applicationForm.requireResume"
                        @click="applicationForm.requireResume = true"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="applicationForm.requireResume
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        {{ $t('dashboard.jobs.new.applicationForm.required') }}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="!applicationForm.requireResume"
                        @click="applicationForm.requireResume = false"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="!applicationForm.requireResume
                          ? 'bg-white dark:bg-surface-700 text-surface-700 dark:text-surface-300 shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        {{ $t('dashboard.jobs.new.applicationForm.off') }}
                      </button>
                    </div>
                  </div>
                  <!-- Cover letter -->
                  <div class="flex items-center justify-between py-4 px-1">
                    <div>
                      <div class="flex items-center gap-2">
                        <FileText class="size-4 text-surface-400 dark:text-surface-500" />
                        <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.applicationForm.coverLetter') }}</span>
                      </div>
                      <p class="text-xs text-surface-400 dark:text-surface-500 mt-1 ml-6">{{ $t('dashboard.jobs.new.applicationForm.coverLetterHint') }}</p>
                    </div>
                    <div class="inline-flex items-center rounded-lg bg-surface-100 dark:bg-surface-800 p-0.5" role="radiogroup" :aria-label="$t('dashboard.jobs.new.applicationForm.coverLetterRequirementAriaLabel')">
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="applicationForm.requireCoverLetter"
                        @click="applicationForm.requireCoverLetter = true"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="applicationForm.requireCoverLetter
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        {{ $t('dashboard.jobs.new.applicationForm.required') }}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="!applicationForm.requireCoverLetter"
                        @click="applicationForm.requireCoverLetter = false"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="!applicationForm.requireCoverLetter
                          ? 'bg-white dark:bg-surface-700 text-surface-700 dark:text-surface-300 shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        {{ $t('dashboard.jobs.new.applicationForm.off') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Screening questions -->
              <div>
                <div class="flex items-center justify-between pb-3 border-b border-surface-100 dark:border-surface-800">
                  <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.applicationForm.screeningQuestions') }}</h2>
                  <span v-if="applicationForm.questions.length > 0" class="text-xs font-medium text-surface-400 dark:text-surface-500 tabular-nums">
                    {{ $t('dashboard.jobs.new.applicationForm.questionsAdded', { count: applicationForm.questions.length }) }}
                  </span>
                </div>

                <div
                  v-if="questionActionError"
                  class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mt-4"
                >
                  {{ questionActionError }}
                  <button class="ml-2 underline" @click="questionActionError = null">{{ $t('dashboard.jobs.new.applicationForm.dismiss') }}</button>
                </div>

                <div v-if="applicationForm.questions.length > 0" class="divide-y divide-surface-100 dark:divide-surface-800">
                  <div
                    v-for="(q, index) in applicationForm.questions"
                    :key="q.id"
                    class="flex items-center gap-3 py-3.5 px-1 group"
                  >
                    <div class="text-surface-300 dark:text-surface-600 cursor-grab">
                      <GripVertical class="size-4" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ q.label }}</span>
                        <span
                          v-if="q.required"
                          class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800"
                        >
                          {{ $t('dashboard.jobs.new.applicationForm.required') }}
                        </span>
                        <span
                          v-else
                          class="inline-flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400 ring-1 ring-inset ring-surface-200 dark:ring-surface-700"
                        >
                          {{ $t('dashboard.jobs.new.applicationForm.optional') }}
                        </span>
                      </div>
                      <div class="flex items-center gap-1.5 mt-0.5 ml-0">
                        <span class="text-xs text-surface-400 dark:text-surface-500">{{ questionTypeLabels[q.type] ?? q.type }}</span>
                        <span v-if="q.description" class="text-xs text-surface-400 dark:text-surface-500 truncate">
                          &middot; {{ q.description }}
                        </span>
                        <span
                          v-if="(q.type === 'single_select' || q.type === 'multi_select') && q.options"
                          class="text-xs text-surface-400 dark:text-surface-500"
                        >
                          &middot; {{ q.options.length }} options
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        :disabled="index === 0"
                        class="rounded p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-30"
                        :title="$t('dashboard.jobs.new.applicationForm.moveUp')"
                        @click="moveQuestion(index, 'up')"
                      >
                        <ChevronUp class="size-4" />
                      </button>
                      <button
                        type="button"
                        :disabled="index === applicationForm.questions.length - 1"
                        class="rounded p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-30"
                        :title="$t('dashboard.jobs.new.applicationForm.moveDown')"
                        @click="moveQuestion(index, 'down')"
                      >
                        <ChevronDown class="size-4" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        :title="$t('common.edit')"
                        @click="editingQuestion = q; showAddForm = false"
                      >
                        <Pencil class="size-4" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1.5 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors"
                        :title="$t('common.delete')"
                        @click="handleDeleteQuestion(q.id)"
                      >
                        <Trash2 class="size-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <p v-else class="text-sm text-surface-400 dark:text-surface-500 py-6 text-center">
                  {{ $t('dashboard.jobs.new.applicationForm.noQuestionsYet') }}
                </p>

                <QuestionForm
                  v-if="editingQuestion"
                  :question="editingQuestion"
                  class="mt-4 mb-2"
                  @save="handleUpdateQuestion"
                  @cancel="editingQuestion = null"
                />

                <QuestionForm
                  v-if="showAddForm && !editingQuestion"
                  class="mt-4 mb-2"
                  @save="handleAddQuestion"
                  @cancel="showAddForm = false"
                />

                <div class="mt-4 flex items-center gap-3">
                  <button
                    v-if="!showAddForm && !editingQuestion"
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-surface-300 dark:border-surface-700 px-3 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-950/30 transition-colors"
                    @click="showAddForm = true"
                  >
                    <Plus class="size-4" />
                    {{ $t('dashboard.jobs.new.applicationForm.addAQuestion') }}
                  </button>
                </div>
              </div>
            </section>

            <!-- Step 3: AI scoring criteria -->
            <section v-else-if="currentStep === 3" class="space-y-8">
              <div>
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 pb-2 border-b border-surface-100 dark:border-surface-800">
                  {{ $t('dashboard.jobs.new.scoring.title') }}
                </h2>
                <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                  {{ $t('dashboard.jobs.new.scoring.description') }}
                </p>
              </div>

              <!-- AI not configured warning -->
              <div v-if="!isAiConfigured" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5">
                <div class="flex items-start gap-3">
                  <Sparkles class="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">{{ $t('dashboard.jobs.new.scoring.aiNotConfiguredTitle') }}</p>
                    <p class="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
                      {{ $t('dashboard.jobs.new.scoring.aiNotConfiguredDescription') }}
                    </p>
                    <NuxtLink
                      :to="$localePath('/dashboard/settings/ai')"
                      class="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline underline-offset-2"
                    >
                      <ExternalLink class="size-3" />
                      {{ $t('dashboard.jobs.new.scoring.goToAiSettings') }}
                    </NuxtLink>
                  </div>
                </div>
              </div>

              <!-- Mode selection cards -->
              <div v-if="scoringCriteria.length === 0" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Pre-made templates -->
                <button
                  type="button"
                  class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md"
                  :class="scoringMode === 'premade'
                    ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                    : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                  @click="scoringMode = 'premade'"
                >
                  <div class="inline-flex items-center justify-center size-10 rounded-lg bg-brand-100 dark:bg-brand-900/50">
                    <Brain class="size-5 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.scoring.modes.premade.label') }}</span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                      {{ $t('dashboard.jobs.new.scoring.modes.premade.description') }}
                    </span>
                  </div>
                </button>

                <!-- AI from job description -->
                <button
                  type="button"
                  :disabled="!isAiConfigured"
                  class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="scoringMode === 'ai'
                    ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                    : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                  @click="generateAiCriteria(); scoringMode = 'ai'"
                >
                  <div class="inline-flex items-center justify-center size-10 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                    <Sparkles class="size-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.scoring.modes.ai.label') }}</span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                      {{ $t('dashboard.jobs.new.scoring.modes.ai.description') }}
                    </span>
                    <span v-if="!isAiConfigured" class="text-[10px] text-amber-600 dark:text-amber-400 mt-1 block">
                      {{ $t('dashboard.jobs.new.scoring.modes.ai.requiresAiSetup') }}
                    </span>
                  </div>
                  <span v-if="isGeneratingCriteria" class="absolute top-3 right-3">
                    <Loader2 class="size-4 text-purple-600 animate-spin" />
                  </span>
                </button>

                <!-- Custom criteria -->
                <button
                  type="button"
                  class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md"
                  :class="scoringMode === 'custom'
                    ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                    : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                  @click="scoringMode = 'custom'; showCustomForm = true"
                >
                  <div class="inline-flex items-center justify-center size-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                    <SlidersHorizontal class="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.scoring.modes.custom.label') }}</span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                      {{ $t('dashboard.jobs.new.scoring.modes.custom.description') }}
                    </span>
                  </div>
                </button>
              </div>

              <!-- Pre-made template selector -->
              <div v-if="scoringMode === 'premade' && scoringCriteria.length === 0" class="space-y-4 mt-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    v-for="tmpl in [
                      { key: 'standard', label: $t('dashboard.jobs.new.scoringTemplates.standard.label'), desc: $t('dashboard.jobs.new.scoringTemplates.standard.description') },
                      { key: 'technical', label: $t('dashboard.jobs.new.scoringTemplates.technical.label'), desc: $t('dashboard.jobs.new.scoringTemplates.technical.description') },
                      { key: 'non_technical', label: $t('dashboard.jobs.new.scoringTemplates.nonTechnical.label'), desc: $t('dashboard.jobs.new.scoringTemplates.nonTechnical.description') },
                    ]"
                    :key="tmpl.key"
                    type="button"
                    class="p-4 rounded-lg border text-left transition-all"
                    :class="selectedTemplate === tmpl.key
                      ? 'border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-950/30'
                      : 'border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="selectedTemplate = tmpl.key; loadPremadeCriteria(tmpl.key)"
                  >
                    <span class="block text-sm font-medium text-surface-900 dark:text-surface-100">{{ tmpl.label }}</span>
                    <span class="text-xs text-surface-500">{{ tmpl.desc }}</span>
                  </button>
                </div>
              </div>

              <!-- Criteria list with weight sliders -->
              <div v-if="scoringCriteria.length > 0" class="space-y-4">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">
                    {{ $t('dashboard.jobs.new.scoring.criteriaConfigured', { count: scoringCriteria.length }) }}
                  </h3>
                  <button
                    type="button"
                    class="text-xs text-danger-600 dark:text-danger-400 hover:underline"
                    @click="scoringCriteria = []; scoringMode = 'none'"
                  >
                    {{ $t('dashboard.jobs.new.scoring.clearAll') }}
                  </button>
                </div>

                <div class="space-y-3">
                  <div
                    v-for="criterion in scoringCriteria"
                    :key="criterion.key"
                    class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all hover:shadow-sm"
                  >
                    <div class="flex items-start justify-between gap-3 mb-3">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">{{ criterion.name }}</span>
                          <span
                            class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset"
                            :class="categoryColorClasses[criterion.category] ?? categoryColorClasses.custom"
                          >
                            {{ categoryLabels[criterion.category] ?? criterion.category }}
                          </span>
                        </div>
                        <p v-if="criterion.description" class="text-xs text-surface-500 dark:text-surface-400 leading-relaxed">
                          {{ criterion.description }}
                        </p>
                      </div>
                      <button
                        type="button"
                        class="rounded p-1 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors shrink-0"
                        :title="$t('dashboard.jobs.new.scoring.remove')"
                        @click="removeCriterion(criterion.key)"
                      >
                        <Trash2 class="size-4" />
                      </button>
                    </div>

                    <!-- Weight slider -->
                    <div class="flex items-center gap-4">
                      <label class="text-xs font-medium text-surface-500 dark:text-surface-400 shrink-0 w-12">{{ $t('dashboard.jobs.new.scoring.weight') }}</label>
                      <input
                        type="range"
                        :min="0"
                        :max="100"
                        v-model.number="criterion.weight"
                        class="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-brand-600 bg-surface-200 dark:bg-surface-700"
                      />
                      <span class="text-xs font-mono font-semibold text-surface-700 dark:text-surface-300 w-8 text-right">
                        {{ criterion.weight }}
                      </span>
                    </div>

                    <div class="flex items-center gap-4 mt-2 text-xs text-surface-400">
                      <span>{{ $t('dashboard.jobs.new.scoring.maxScore', { count: criterion.maxScore }) }}</span>
                      <span>{{ $t('dashboard.jobs.new.scoring.key') }} <code class="rounded bg-surface-100 dark:bg-surface-800 px-1 py-0.5 font-mono text-[10px]">{{ criterion.key }}</code></span>
                    </div>
                  </div>
                </div>

                <!-- Add another criterion -->
                <button
                  v-if="!showCustomForm"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-surface-300 dark:border-surface-700 px-3 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
                  @click="showCustomForm = true"
                >
                  <Plus class="size-4" />
                  {{ $t('dashboard.jobs.new.scoring.addCriterion') }}
                </button>
              </div>

              <!-- Custom criterion form -->
              <div v-if="showCustomForm" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5 space-y-4">
                <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ $t('dashboard.jobs.new.scoring.addCustomCriterion') }}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ $t('dashboard.jobs.new.scoring.form.name') }}</label>
                    <input
                      v-model="customCriterionForm.name"
                      @input="customCriterionForm.key = autoGenerateKey(customCriterionForm.name)"
                      type="text"
                      :placeholder="$t('dashboard.jobs.new.scoring.form.namePlaceholder')"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ $t('dashboard.jobs.new.scoring.form.category') }}</label>
                    <select
                      v-model="customCriterionForm.category"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ $t('dashboard.jobs.new.scoring.form.description') }}</label>
                  <textarea
                    v-model="customCriterionForm.description"
                    rows="2"
                    :placeholder="$t('dashboard.jobs.new.scoring.form.descriptionPlaceholder')"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ $t('dashboard.jobs.new.scoring.form.maxScore') }}</label>
                    <input
                      v-model.number="customCriterionForm.maxScore"
                      type="number"
                      min="1"
                      max="100"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ $t('dashboard.jobs.new.scoring.form.initialWeight') }}</label>
                    <input
                      v-model.number="customCriterionForm.weight"
                      type="number"
                      min="0"
                      max="100"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>
                <div class="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    :disabled="!customCriterionForm.name"
                    class="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    @click="addCustomCriterion"
                  >
                    {{ $t('dashboard.jobs.new.scoring.addCriterion') }}
                  </button>
                  <button
                    type="button"
                    class="px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
                    @click="showCustomForm = false"
                  >
                    {{ $t('dashboard.jobs.new.scoring.cancel') }}
                  </button>
                </div>
              </div>

              <!-- Auto-score toggle -->
              <div v-if="scoringCriteria.length > 0" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                <label class="flex items-start gap-3 cursor-pointer">
                  <input
                    v-model="autoScoreOnApply"
                    type="checkbox"
                    :disabled="!isAiConfigured"
                    class="mt-0.5 size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">
                      {{ $t('dashboard.jobs.new.scoring.autoScore.label') }}
                    </span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-0.5 block leading-relaxed">
                      {{ $t('dashboard.jobs.new.scoring.autoScore.description') }}
                    </span>
                    <span v-if="!isAiConfigured" class="text-xs text-amber-600 dark:text-amber-400 mt-1 block">
                      <NuxtLink :to="$localePath('/dashboard/settings/ai')" class="underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200">{{ $t('dashboard.jobs.new.scoring.autoScore.configureLink') }}</NuxtLink> {{ $t('dashboard.jobs.new.scoring.autoScore.configureSuffix') }}
                    </span>
                  </div>
                </label>
              </div>

              <!-- Skip scoring note -->
              <div v-if="scoringCriteria.length === 0 && scoringMode === 'none'" class="text-center py-6 text-sm text-surface-400">
                <p>{{ $t('dashboard.jobs.new.scoring.skipNote') }}</p>
              </div>
            </section>

            <!-- Step 4: Publish & Distribute -->
            <section v-else-if="currentStep === 4" class="space-y-8">
              <!-- Success state after publishing -->
              <div v-if="isPublished" class="space-y-8">
                <!-- Compact success header -->
                <div class="flex items-center gap-4 rounded-xl border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950/30 p-5">
                  <div class="inline-flex items-center justify-center size-12 rounded-full bg-success-100 dark:bg-success-900/50 shrink-0">
                    <PartyPopper class="size-6 text-success-600 dark:text-success-400" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h2 class="text-lg font-bold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.publish.liveTitle') }}</h2>
                    <p class="text-sm text-surface-500 dark:text-surface-400">
                      <i18n-t keypath="dashboard.jobs.new.publish.liveDescription" tag="span">
                        <template #title><strong>{{ form.title }}</strong></template>
                      </i18n-t>
                    </p>
                  </div>
                  <NuxtLink
                    :to="finalApplicationLink"
                    target="_blank"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 bg-brand-100 dark:bg-brand-900/50 rounded-lg hover:bg-brand-200 dark:hover:bg-brand-800 transition-colors shrink-0"
                  >
                    <ExternalLink class="size-3.5" />
                    {{ $t('dashboard.jobs.new.publish.preview') }}
                  </NuxtLink>
                </div>

                <!-- Direct application link -->
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2 mb-3">
                    <Link2 class="size-4 text-surface-500 dark:text-surface-400" />
                    <span class="text-sm font-semibold text-surface-700 dark:text-surface-300">{{ $t('dashboard.jobs.new.publish.directLinkLabel') }}</span>
                    <span class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.jobs.new.publish.noTracking') }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readonly
                      :value="finalApplicationLink"
                      class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-600 dark:text-surface-400 select-all font-mono"
                    />
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-surface-200 dark:bg-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors shrink-0"
                      @click="copyFinalLink"
                    >
                      <Copy class="size-3.5" />
                      {{ linkCopiedFinal ? $t('dashboard.jobs.new.publish.copied') : $t('dashboard.jobs.new.publish.copy') }}
                    </button>
                  </div>
                </div>

                <!-- Distribution hub -->
                <div>
                  <div class="flex items-center gap-3 mb-2">
                    <Share2 class="size-5 text-brand-600 dark:text-brand-400" />
                    <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.publish.distributeTitle') }}</h3>
                  </div>
                  <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                    {{ $t('dashboard.jobs.new.publish.distributeDescription') }}
                  </p>

                  <!-- Job boards -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ $t('dashboard.jobs.new.publish.jobBoards') }}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="ch in distributionChannels.filter(c => c.category === 'job_board')"
                        :key="ch.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all"
                        :class="createdLinks[ch.channel]?.code ? 'ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800' : ''"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <component :is="channelIcons[ch.channel] ?? Globe" class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ ch.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ ch.description }}</span>
                          </div>
                        </div>

                        <!-- Not yet created -->
                        <div v-if="!createdLinks[ch.channel]" class="mt-3">
                          <button
                            type="button"
                            class="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-3 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            @click="createChannelLink(ch.channel, ch.name)"
                          >
                            <Plus class="size-3.5" />
                            {{ $t('dashboard.jobs.new.publish.createTrackingLink') }}
                          </button>
                        </div>

                        <!-- Loading -->
                        <div v-else-if="createdLinks[ch.channel]?.loading" class="mt-3 flex items-center justify-center gap-2 py-2">
                          <Loader2 class="size-3.5 text-brand-600 animate-spin" />
                          <span class="text-xs text-surface-500">{{ $t('dashboard.jobs.new.publish.creating') }}</span>
                        </div>

                        <!-- Created - show URL -->
                        <div v-else class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="createdLinks[ch.channel]?.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="createdLinks[ch.channel]?.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyChannelLink(ch.channel)"
                            >
                              <Check v-if="createdLinks[ch.channel]?.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ createdLinks[ch.channel]?.copied ? $t('dashboard.jobs.new.publish.copied') : $t('dashboard.jobs.new.publish.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ $t('dashboard.jobs.new.publish.trackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Outreach -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ $t('dashboard.jobs.new.publish.directOutreach') }}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="ch in distributionChannels.filter(c => c.category === 'outreach')"
                        :key="ch.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all"
                        :class="createdLinks[ch.channel]?.code ? 'ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800' : ''"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <component :is="channelIcons[ch.channel] ?? Globe" class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ ch.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ ch.description }}</span>
                          </div>
                        </div>
                        <div v-if="!createdLinks[ch.channel]" class="mt-3">
                          <button
                            type="button"
                            class="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-3 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            @click="createChannelLink(ch.channel, ch.name)"
                          >
                            <Plus class="size-3.5" />
                            {{ $t('dashboard.jobs.new.publish.createTrackingLink') }}
                          </button>
                        </div>
                        <div v-else-if="createdLinks[ch.channel]?.loading" class="mt-3 flex items-center justify-center gap-2 py-2">
                          <Loader2 class="size-3.5 text-brand-600 animate-spin" />
                          <span class="text-xs text-surface-500">{{ $t('dashboard.jobs.new.publish.creating') }}</span>
                        </div>
                        <div v-else class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="createdLinks[ch.channel]?.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="createdLinks[ch.channel]?.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyChannelLink(ch.channel)"
                            >
                              <Check v-if="createdLinks[ch.channel]?.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ createdLinks[ch.channel]?.copied ? $t('dashboard.jobs.new.publish.copied') : $t('dashboard.jobs.new.publish.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ $t('dashboard.jobs.new.publish.trackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Social media -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ $t('dashboard.jobs.new.publish.socialMedia') }}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="ch in distributionChannels.filter(c => c.category === 'social')"
                        :key="ch.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all"
                        :class="createdLinks[ch.channel]?.code ? 'ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800' : ''"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <component :is="channelIcons[ch.channel] ?? Globe" class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ ch.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ ch.description }}</span>
                          </div>
                        </div>
                        <div v-if="!createdLinks[ch.channel]" class="mt-3">
                          <button
                            type="button"
                            class="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-3 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            @click="createChannelLink(ch.channel, ch.name)"
                          >
                            <Plus class="size-3.5" />
                            {{ $t('dashboard.jobs.new.publish.createTrackingLink') }}
                          </button>
                        </div>
                        <div v-else-if="createdLinks[ch.channel]?.loading" class="mt-3 flex items-center justify-center gap-2 py-2">
                          <Loader2 class="size-3.5 text-brand-600 animate-spin" />
                          <span class="text-xs text-surface-500">{{ $t('dashboard.jobs.new.publish.creating') }}</span>
                        </div>
                        <div v-else class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="createdLinks[ch.channel]?.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="createdLinks[ch.channel]?.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyChannelLink(ch.channel)"
                            >
                              <Check v-if="createdLinks[ch.channel]?.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ createdLinks[ch.channel]?.copied ? $t('dashboard.jobs.new.publish.copied') : $t('dashboard.jobs.new.publish.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ $t('dashboard.jobs.new.publish.trackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Custom job board -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ $t('dashboard.jobs.new.publish.customJobBoard') }}</h4>
                    <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">
                      {{ $t('dashboard.jobs.new.publish.customJobBoardDescription') }}
                    </p>

                    <!-- Add custom board form -->
                    <div class="flex items-center gap-2 mb-4">
                      <input
                        v-model="customBoardName"
                        type="text"
                        :placeholder="$t('dashboard.jobs.new.publish.customJobBoardPlaceholder')"
                        class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 placeholder-surface-400 dark:placeholder-surface-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                        @keydown.enter.prevent="createCustomBoardLink"
                      />
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-4 py-2 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="!customBoardName.trim() || isCreatingCustomBoard"
                        @click="createCustomBoardLink"
                      >
                        <Loader2 v-if="isCreatingCustomBoard" class="size-3.5 animate-spin" />
                        <Plus v-else class="size-3.5" />
                        {{ $t('dashboard.jobs.new.publish.createLink') }}
                      </button>
                    </div>

                    <!-- Created custom board links -->
                    <div v-if="customBoardLinks.length" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="(cbl, idx) in customBoardLinks"
                        :key="cbl.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <Globe class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ cbl.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ $t('dashboard.jobs.new.publish.customBoardLabel') }}</span>
                          </div>
                        </div>
                        <div class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="cbl.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="cbl.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyCustomBoardLink(idx)"
                            >
                              <Check v-if="cbl.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ cbl.copied ? $t('dashboard.jobs.new.publish.copied') : $t('dashboard.jobs.new.publish.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ $t('dashboard.jobs.new.publish.trackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Summary and link to full dashboard -->
                  <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-4">
                    <div class="flex items-center gap-3">
                      <BarChart3 class="size-5 text-surface-400 dark:text-surface-500 shrink-0" />
                      <div class="flex-1">
                        <p class="text-sm text-surface-700 dark:text-surface-300">
                          <span v-if="createdLinkCount > 0">
                            {{ $t('dashboard.jobs.new.publish.linkCountCreated', { count: createdLinkCount }) }}
                          </span>
                          {{ $t('dashboard.jobs.new.publish.viewAllAnalyticsPrefix') }}
                          <NuxtLink :to="$localePath('/dashboard/source-tracking')" class="text-brand-600 dark:text-brand-400 font-medium underline underline-offset-2">{{ $t('dashboard.jobs.new.publish.sourceTrackingDashboard') }}</NuxtLink>.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Action buttons -->
                <div class="flex items-center justify-between pt-6 border-t border-surface-100 dark:border-surface-800">
                  <NuxtLink
                    :to="$localePath(`/dashboard/jobs/${createdJobId}`)"
                    class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                  >
                    <Eye class="size-4" />
                    {{ $t('dashboard.jobs.new.publish.viewJob') }}
                  </NuxtLink>
                  <NuxtLink
                    :to="$localePath('/dashboard')"
                    class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors shadow-sm"
                  >
                    {{ $t('dashboard.jobs.new.publish.goToDashboard') }}
                  </NuxtLink>
                </div>
              </div>

              <!-- Pre-publish state: choose publish or draft -->
              <div v-else>
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 pb-2 border-b border-surface-100 dark:border-surface-800">{{ $t('dashboard.jobs.new.publish.readyTitle') }}</h2>
                <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                  {{ $t('dashboard.jobs.new.publish.readyDescription') }}
                </p>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  <!-- Publish now option -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all"
                    :class="publishChoice === 'publish'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="publishChoice = 'publish'"
                  >
                    <span
                      v-if="publishChoice === 'publish'"
                      class="absolute top-3 right-3 inline-flex items-center justify-center size-5 rounded-full bg-brand-600 text-white"
                    >
                      <Check class="size-3" />
                    </span>
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-brand-100 dark:bg-brand-900/50">
                      <Rocket class="size-5 text-brand-600 dark:text-brand-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.publish.publishNow.label') }}</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        {{ $t('dashboard.jobs.new.publish.publishNow.description') }}
                      </span>
                    </div>
                  </button>

                  <!-- Save as draft option -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all"
                    :class="publishChoice === 'draft'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="publishChoice = 'draft'"
                  >
                    <span
                      v-if="publishChoice === 'draft'"
                      class="absolute top-3 right-3 inline-flex items-center justify-center size-5 rounded-full bg-brand-600 text-white"
                    >
                      <Check class="size-3" />
                    </span>
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800">
                      <FileEdit class="size-5 text-surface-500 dark:text-surface-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.publish.saveAsDraft.label') }}</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        {{ $t('dashboard.jobs.new.publish.saveAsDraft.description') }}
                      </span>
                    </div>
                  </button>
                </div>

                <!-- Summary of what was configured -->
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">{{ $t('dashboard.jobs.new.publish.jobSummary') }}</h3>
                  <dl class="space-y-3 text-sm">
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <Briefcase class="size-3.5" /> {{ $t('dashboard.jobs.new.publish.summaryTitle') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100 font-medium">{{ form.title }}</dd>
                    </div>
                    <div v-if="form.location" class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <Link2 class="size-3.5" /> {{ $t('dashboard.jobs.new.publish.summaryLocation') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ form.location }}</dd>
                    </div>
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <FileText class="size-3.5" /> {{ $t('dashboard.jobs.new.publish.summaryResume') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ applicationForm.requireResume ? $t('dashboard.jobs.new.applicationForm.required') : $t('dashboard.jobs.new.applicationForm.optional') }}</dd>
                    </div>
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <MessageSquare class="size-3.5" /> {{ $t('dashboard.jobs.new.publish.summaryQuestions') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ $t('dashboard.jobs.new.publish.customQuestions', { count: applicationForm.questions.length }) }}</dd>
                    </div>
                  </dl>
                </div>

                <!-- What happens next hint -->
                <div v-if="publishChoice === 'publish'" class="rounded-xl border border-brand-100 dark:border-brand-900 bg-brand-50/50 dark:bg-brand-950/20 p-4 mt-6">
                  <div class="flex items-start gap-3">
                    <Share2 class="size-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                    <div>
                      <p class="text-sm font-medium text-brand-800 dark:text-brand-200">{{ $t('dashboard.jobs.new.publish.afterPublishingTitle') }}</p>
                      <p class="text-xs text-brand-700 dark:text-brand-300 mt-0.5 leading-relaxed">
                        {{ $t('dashboard.jobs.new.publish.afterPublishingDescription') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Actions Footer -->
            <div v-if="!isPublished" class="flex items-center justify-between mt-12 pt-8 border-t border-surface-100 dark:border-surface-800">
              <NuxtLink
                :to="$localePath('/dashboard')"
                class="px-6 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              >
                {{ $t('dashboard.jobs.new.publish.cancel') }}
              </NuxtLink>

              <div class="flex items-center gap-3">
                <button
                  v-if="currentStep > 1"
                  type="button"
                  @click="prevStep"
                  class="px-6 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                >
                  {{ $t('dashboard.jobs.new.publish.back') }}
                </button>
                <button
                  v-if="currentStep < 4"
                  type="button"
                  :disabled="!canGoNext"
                  @click="nextStep"
                  class="px-8 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {{ $t('dashboard.jobs.new.saveAndContinue') }}
                </button>
                <button
                  v-else
                  type="submit"
                  :disabled="isSubmitting"
                  class="inline-flex items-center gap-2 px-8 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                  :class="publishChoice === 'publish' ? 'bg-brand-600 hover:bg-brand-700' : 'bg-surface-600 hover:bg-surface-700'"
                >
                  <Rocket v-if="publishChoice === 'publish'" class="size-4" />
                  <FileEdit v-else class="size-4" />
                  {{ isSubmitting
                    ? (publishChoice === 'publish' ? $t('dashboard.jobs.new.publish.publishing') : $t('dashboard.jobs.new.publish.saving'))
                    : (publishChoice === 'publish' ? $t('dashboard.jobs.new.publish.publishAndCopy') : $t('dashboard.jobs.new.publish.saveAsDraft.label'))
                  }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <!-- Right side: Tips -->
      <aside class="lg:col-span-4 space-y-6">
        <div class="sticky top-8 space-y-6">
          <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-900/50 p-6">
            <h3 class="text-sm font-bold text-surface-900 dark:text-surface-100 uppercase tracking-wider mb-4">{{ $t('dashboard.jobs.new.tips.title') }}</h3>
            <ul class="space-y-4">
              <li v-if="currentStep === 1" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step1.jobTitle.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step1.jobTitle.body') }}
              </li>
              <li v-if="currentStep === 1" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step1.location.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step1.location.body') }}
              </li>
              <li v-if="currentStep === 1" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step1.description.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step1.description.body') }}
              </li>
              <li v-if="currentStep === 2" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step2.keepShort.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step2.keepShort.body') }}
              </li>
              <li v-if="currentStep === 2" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step2.resumeMatters.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step2.resumeMatters.body') }}
              </li>
              <li v-if="currentStep === 2" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step2.standardFields.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step2.standardFields.body') }}
              </li>
              <li v-if="currentStep === 3" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step3.startWithTemplate.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step3.startWithTemplate.body') }}
              </li>
              <li v-if="currentStep === 3" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step3.adjustWeights.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step3.adjustWeights.body') }}
              </li>
              <li v-if="currentStep === 3" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step3.aiSetupRequired.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step3.aiSetupRequired.body') }} <NuxtLink :to="$localePath('/dashboard/settings/ai')" class="text-brand-600 dark:text-brand-400 underline">{{ $t('dashboard.jobs.new.tips.step3.aiSetupRequired.settingsLink') }}</NuxtLink>.
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step4.publishWhenReady.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step4.publishWhenReady.body') }}
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step4.useTrackingLinks.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step4.useTrackingLinks.body') }}
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step4.onePerChannel.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step4.onePerChannel.body') }}
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                <p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ $t('dashboard.jobs.new.tips.step4.draftsArePrivate.heading') }}</p>
                {{ $t('dashboard.jobs.new.tips.step4.draftsArePrivate.body') }}
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
button:not(:disabled) {
  cursor: pointer;
}
</style>

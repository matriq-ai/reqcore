import { z } from 'zod'

// ─────────────────────────────────────────────
// Candidate validation schemas — shared across API routes
// ─────────────────────────────────────────────

const genderValues = ['male', 'female', 'other', 'prefer_not_to_say'] as const

/** ISO 8601 date string (YYYY-MM-DD), validated to be a real date in a reasonable range */
const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
  .refine((val) => {
    const d = new Date(val)
    if (isNaN(d.getTime())) return false
    const year = d.getFullYear()
    const now = new Date()
    return year >= 1900 && d <= now
  }, 'Date of birth must be a valid past date')

/** Schema for creating a new candidate */
export const createCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  displayName: z.string().max(200).optional(),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
  phone: z.string().max(50).optional(),
  gender: z.enum(genderValues).optional(),
  dateOfBirth: dobSchema.optional(),
  quickNotes: z.string().max(1000).optional(),
})

/** Schema for updating an existing candidate (all fields optional) */
export const updateCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100).optional(),
  lastName: z.string().min(1, 'Last name is required').max(100).optional(),
  displayName: z.string().max(200).nullish(),
  email: z
    .string()
    .email('Invalid email address')
    .max(255)
    .transform((v) => v.toLowerCase().trim())
    .optional(),
  phone: z.string().max(50).nullish(),
  gender: z.enum(genderValues).nullish(),
  dateOfBirth: dobSchema.nullish(),
  quickNotes: z.string().max(1000).nullish(),
})

/** Schema for candidate list query params */
export const candidateQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  gender: z.enum(genderValues).optional(),
  dobFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dobFrom must be YYYY-MM-DD').optional(),
  dobTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dobTo must be YYYY-MM-DD').optional(),
  /** JSON-encoded array of { propertyDefinitionId, op, value } filters */
  propertyFilters: z.string().optional(),
})

/** Reusable schema for `:id` route params */
export const candidateIdParamSchema = z.object({
  id: z.string().min(1),
})

// ─────────────────────────────────────────────
// Batch import schemas (T2)
// ─────────────────────────────────────────────

/**
 * Shape the LLM must return per resume. All fields nullable — model returns null when a field isn't found;
 * email/name get corrected by the user in the preview table before commit.
 */
export const candidateExtractionSchema = z.object({
  firstName: z
    .string()
    .nullable()
    .describe('First/given name. For Chinese names, split if possible (e.g., "张" from "张三"); otherwise leave null and use lastName/fullName.'),
  lastName: z
    .string()
    .nullable()
    .describe('Last/family name. For Chinese names that cannot be split, put the full name here. For split names, this is the family name.'),
  fullName: z
    .string()
    .nullable()
    .describe('Full name as written in the resume. Use when firstName/lastName cannot be reliably split.'),
  email: z.string().nullable().describe('Email address found in the resume.'),
  phone: z.string().nullable().describe('Phone number found in the resume.'),
  currentTitle: z.string().nullable().describe('Current job title or position.'),
  notes: z.string().nullable().describe('Any additional notes about the candidate from the resume.'),
})
export type CandidateExtraction = z.infer<typeof candidateExtractionSchema>

/**
 * One row the user confirmed for import. Reuses createCandidateSchema's field rules (email required + normalized),
 * plus the staging id and optional job binding.
 */
export const importCandidateRowSchema = createCandidateSchema.extend({
  tempId: z.string().min(1),
  jobId: z.string().min(1).optional(),
})

export const importCommitSchema = z.object({
  rows: z.array(importCandidateRowSchema).min(1).max(50),
})
export type ImportCandidateRow = z.infer<typeof importCandidateRowSchema>

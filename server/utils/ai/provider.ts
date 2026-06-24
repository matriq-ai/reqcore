/**
 * AI Provider Abstraction Layer
 *
 * Supports OpenAI, Anthropic, and custom OpenAI-compatible endpoints.
 * Credentials are decrypted per-request from the organization's AI config.
 * Never logs or stores raw API keys — only encrypted values in the database.
 */
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import { decrypt } from '../encryption'

export type SupportedProvider = 'openai' | 'anthropic' | 'google' | 'openai_compatible'

export interface ProviderConfig {
  provider: SupportedProvider
  model: string
  apiKeyEncrypted: string
  baseUrl?: string | null
  maxTokens: number
}

/** Detailed info about a single model (presentation + suggested defaults). */
export interface ModelInfo {
  /** Provider-recognised model id, e.g. `gpt-4.1-mini`. */
  id: string
  /** Human label shown in dropdowns, e.g. `GPT‑4.1 Mini`. */
  label: string
  /** One-line plain-English description for non-experts. */
  description: string
  /** Suggested USD price per 1M input tokens — used to pre-fill the form. */
  inputPricePer1m?: number
  /** Suggested USD price per 1M output tokens — used to pre-fill the form. */
  outputPricePer1m?: number
  /** Optional badge: `recommended`, `fast`, `powerful`, `cheap`. */
  badge?: 'recommended' | 'fast' | 'powerful' | 'cheap'
}

/** Well-known providers with links for obtaining API keys and curated model lists. */
export const PROVIDER_REGISTRY: Record<string, {
  name: string
  /** Short tagline describing the provider for the UI. */
  tagline: string
  modelsUrl: string
  apiKeyUrl: string
  /** Optional docs link explaining how to get started. */
  signupUrl?: string
  /** Whether a custom Base URL field should be exposed. */
  supportsBaseUrl: boolean
  defaultModel: string
  models: ModelInfo[]
}> = {
  openai: {
    name: 'OpenAI',
    tagline: 'Industry-leading GPT models. The safest default for most teams.',
    modelsUrl: 'https://platform.openai.com/docs/models',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    signupUrl: 'https://platform.openai.com/signup',
    supportsBaseUrl: false,
    defaultModel: 'gpt-4.1-mini',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Flagship model — highest accuracy for complex reasoning.', inputPricePer1m: 2.0, outputPricePer1m: 8.0, badge: 'powerful' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Best balance of price, speed and quality. Recommended default.', inputPricePer1m: 0.4, outputPricePer1m: 1.6, badge: 'recommended' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', description: 'Fastest and cheapest GPT-4.1. Great for high-volume scoring.', inputPricePer1m: 0.1, outputPricePer1m: 0.4, badge: 'cheap' },
      { id: 'gpt-4o', label: 'GPT-4o', description: 'Multimodal flagship from the GPT-4o family.', inputPricePer1m: 2.5, outputPricePer1m: 10.0 },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Older small model — keep for cost compatibility.', inputPricePer1m: 0.15, outputPricePer1m: 0.6 },
      { id: 'o3', label: 'o3', description: 'Reasoning model — slow but excellent at multi-step problems.', inputPricePer1m: 2.0, outputPricePer1m: 8.0 },
      { id: 'o4-mini', label: 'o4 Mini', description: 'Smaller reasoning model — good price/quality for scoring.', inputPricePer1m: 1.1, outputPricePer1m: 4.4 },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    tagline: 'Claude models — strong at long-form analysis and nuanced writing.',
    modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    signupUrl: 'https://console.anthropic.com/',
    supportsBaseUrl: false,
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', description: 'Anthropic\'s most capable model. Best for the toughest analyses.', inputPricePer1m: 15.0, outputPricePer1m: 75.0, badge: 'powerful' },
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'The sweet spot — strong reasoning at a sensible price.', inputPricePer1m: 3.0, outputPricePer1m: 15.0, badge: 'recommended' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', description: 'Fast and inexpensive. Great for chat and quick scoring.', inputPricePer1m: 0.8, outputPricePer1m: 4.0, badge: 'fast' },
    ],
  },
  google: {
    name: 'Google AI (Gemini)',
    tagline: 'Gemini models — generous free tier and very fast inference.',
    modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    signupUrl: 'https://aistudio.google.com/',
    supportsBaseUrl: false,
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google\'s top model — strong at reasoning and long contexts.', inputPricePer1m: 1.25, outputPricePer1m: 10.0, badge: 'powerful' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Excellent quality at a very low price. Recommended default.', inputPricePer1m: 0.3, outputPricePer1m: 2.5, badge: 'recommended' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Previous-gen fast model. Still solid and very cheap.', inputPricePer1m: 0.1, outputPricePer1m: 0.4, badge: 'cheap' },
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', description: 'Cheapest Gemini option for high-volume light tasks.', inputPricePer1m: 0.075, outputPricePer1m: 0.3, badge: 'cheap' },
    ],
  },
  openai_compatible: {
    name: 'OpenAI-Compatible (Custom)',
    tagline: 'Connect any OpenAI-compatible endpoint: Ollama, LM Studio, OpenRouter, Groq, Together AI, vLLM, …',
    modelsUrl: '',
    apiKeyUrl: '',
    supportsBaseUrl: true,
    defaultModel: '',
    models: [],
  },
}

/**
 * Create a language model instance from encrypted config.
 * Decrypts the API key just-in-time and never persists it in memory beyond the call.
 */
export function createLanguageModel(config: ProviderConfig) {
  const secret = env.BETTER_AUTH_SECRET
  const apiKey = decrypt(config.apiKeyEncrypted, secret)

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to decrypt AI API key. The key may be corrupted.',
    })
  }

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return openai(config.model)
    }
    case 'openai_compatible': {
      const openai = createOpenAI({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      // Use the Chat Completions API (`/chat/completions`). Many OpenAI-compatible
      // backends (DeepSeek, MiniMax, Groq, Together, …) do not implement the newer
      // `/responses` endpoint that the default `openai(model)` helper targets.
      return openai.chat(config.model)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return anthropic(config.model)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return google(config.model)
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: `Unsupported AI provider: ${config.provider}`,
      })
  }
}

/**
 * Generate a structured JSON response from the AI provider.
 * Uses Vercel AI SDK's `generateObject` for reliable schema-conformant output.
 */
export async function generateStructuredOutput<T>(
  config: ProviderConfig,
  options: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    schemaName: string
    schemaDescription?: string
  },
): Promise<{ object: T; usage: { promptTokens: number; completionTokens: number } }> {
  // OpenAI-compatible backends (DeepSeek, MiniMax, …) commonly reject the strict
  // `response_format: { type: 'json_schema' }` that `generateObject` emits
  // ("This response_format type is unavailable now"). Fall back to the widely
  // supported `json_object` mode, describing the schema in the prompt and
  // validating the returned JSON ourselves.
  if (config.provider === 'openai_compatible') {
    return generateStructuredOutputJsonObject(config, options)
  }

  const model = createLanguageModel(config)

  const result = await generateObject({
    model,
    system: options.system,
    prompt: options.prompt,
    schema: options.schema,
    schemaName: options.schemaName,
    schemaDescription: options.schemaDescription,
    maxTokens: config.maxTokens,
    temperature: 0.1,
  })

  return {
    object: result.object,
    usage: {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
    },
  }
}

/**
 * Structured-output path for OpenAI-compatible endpoints that only support
 * `response_format: { type: 'json_object' }`. Calls `/chat/completions`
 * directly, injects the JSON Schema into the system prompt, then parses and
 * validates the response against the zod schema.
 */
async function generateStructuredOutputJsonObject<T>(
  config: ProviderConfig,
  options: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    schemaName: string
    schemaDescription?: string
  },
): Promise<{ object: T; usage: { promptTokens: number; completionTokens: number } }> {
  const secret = env.BETTER_AUTH_SECRET
  const apiKey = decrypt(config.apiKeyEncrypted, secret)

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to decrypt AI API key. The key may be corrupted.',
    })
  }

  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const jsonSchema = z.toJSONSchema(options.schema)

  const schemaHint = options.schemaDescription
    ? `${options.schemaName}: ${options.schemaDescription}`
    : options.schemaName

  const systemPrompt = `${options.system}\n\nRespond with a single JSON object named "${schemaHint}" that conforms to this JSON Schema:\n${JSON.stringify(jsonSchema)}\n\nReturn only the raw JSON object — no markdown fences, no commentary.`

  const callChatCompletions = (includeResponseFormat: boolean) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: options.prompt },
        ],
        // `json_object` is a nudge, not a requirement: the schema is in the
        // system prompt and we parse/validate the result ourselves.
        ...(includeResponseFormat ? { response_format: { type: 'json_object' } } : {}),
        max_tokens: config.maxTokens,
        temperature: 0.1,
      }),
    })

  let res = await callChatCompletions(true)

  // Some OpenAI-compatible providers (e.g. MiniMax) reject `json_object`
  // ("unknown response_format type 'json_object'"). Retry once without it —
  // DeepSeek/OpenAI keep the nudge, MiniMax falls back to prompt-only.
  if (!res.ok && res.status === 400) {
    const errText = await res.text().catch(() => '')
    if (/response_format/i.test(errText)) {
      res = await callChatCompletions(false)
    }
    else {
      throw createError({
        statusCode: 502,
        statusMessage: `AI provider error (${res.status}): ${errText.slice(0, 500)}`,
      })
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: `AI provider error (${res.status}): ${errText.slice(0, 500)}`,
    })
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw createError({ statusCode: 502, statusMessage: 'AI provider returned no content' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  }
  catch {
    // Some models wrap the JSON in prose or markdown fences — extract the object.
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) {
      throw createError({ statusCode: 502, statusMessage: 'AI provider returned non-JSON output' })
    }
    parsed = JSON.parse(match[0])
  }

  return {
    object: options.schema.parse(parsed),
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  }
}

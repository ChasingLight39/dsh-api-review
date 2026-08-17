/**
 * Configuration schema and validation for dsh-api-review.
 */

import z from 'schemastery'
import type { CategoryConfig, Config as ConfigType } from './types.ts'

const categoryConfig = (): z<CategoryConfig> => z.object({
  review: z.boolean().default(false),
  block: z.boolean().default(false),
  includeContext: z.boolean().default(false),
})

export const Config: z<ConfigType> = z.object({
  system: categoryConfig(),
  user: categoryConfig(),
  assistant: categoryConfig(),
  tool: categoryConfig(),
  toolResult: categoryConfig(),
  unmatched: categoryConfig(),

  baseURL: z.string().default(''),
  model: z.string().default(''),
  apiKey: z.string().default(''),
  timeoutMs: z.number().default(8000),

  maxContextTokens: z.number().default(256000),
  contextTrimThreshold: z.number().default(0.8),
  contextTrimTarget: z.number().default(0.4),
  maxQueueSize: z.number().default(1000),

  noUserAction: z.union(['deny', 'allow'] as const).default('deny'),

  recoveryText: z.string().default('我已经更换了API源，我信任这个API，继续对话'),
  auditLogDir: z.string().default(''),
})

function anyReviewEnabled(config: ConfigType): boolean {
  return Object.values([
    config.system,
    config.user,
    config.assistant,
    config.tool,
    config.toolResult,
    config.unmatched,
  ]).some((entry: CategoryConfig) => entry.review)
}

export function validateConfig(config: ConfigType): void {
  if (anyReviewEnabled(config) && (config.baseURL.trim() === '' || config.model.trim() === '')) {
    throw new Error(
      'dsh-api-review: review/block is enabled but guard API is not configured — '
      + 'set `baseURL` and `model`',
    )
  }

  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error('dsh-api-review: timeoutMs must be a positive finite number')
  }

  if (!Number.isFinite(config.maxContextTokens) || config.maxContextTokens <= 0) {
    throw new Error('dsh-api-review: maxContextTokens must be a positive finite number')
  }

  if (!Number.isFinite(config.contextTrimThreshold)
    || config.contextTrimThreshold <= 0
    || config.contextTrimThreshold > 1) {
    throw new Error('dsh-api-review: contextTrimThreshold must be in (0, 1]')
  }

  if (!Number.isFinite(config.contextTrimTarget)
    || config.contextTrimTarget <= 0
    || config.contextTrimTarget >= config.contextTrimThreshold) {
    throw new Error('dsh-api-review: contextTrimTarget must be positive and lower than contextTrimThreshold')
  }

  if (!Number.isInteger(config.maxQueueSize) || config.maxQueueSize <= 0) {
    throw new Error('dsh-api-review: maxQueueSize must be a positive integer')
  }

  if (config.recoveryText.trim() === '') {
    throw new Error('dsh-api-review: recoveryText must not be empty')
  }
}

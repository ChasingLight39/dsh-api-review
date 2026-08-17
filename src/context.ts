/**
 * Context buffer management for root-shared review history.
 *
 * The buffer contains only units whose category has includeContext=true.
 * Units are appended in globalSeq order. When the estimated token count exceeds
 * maxContextTokens * contextTrimThreshold, oldest units are removed until the
 * remaining estimate is <= maxContextTokens * contextTrimTarget.
 */

import type { Config, RootReviewState, Unit } from './types.ts'

export function estimateTokens(text: string): number {
  // Rough heuristic: ~4 chars per token, reasonable for mixed CJK/Latin text.
  return Math.ceil(text.length / 4)
}

export function unitTokens(unit: Unit): number {
  return estimateTokens(unit.content)
}

export interface TrimResult {
  trimmedTokens: number
  remainingTokens: number
  removedUnits: number
}

export function appendUnit(state: RootReviewState, unit: Unit): void {
  state.contextBuffer.push(unit)
}

export function trimContextIfNeeded(state: RootReviewState, config: Config): TrimResult | undefined {
  const total = state.contextBuffer.reduce((sum, unit) => sum + unitTokens(unit), 0)
  const threshold = config.maxContextTokens * config.contextTrimThreshold
  const target = config.maxContextTokens * config.contextTrimTarget

  if (total <= threshold) return undefined

  let remaining = total
  let removed = 0
  while (state.contextBuffer.length > 1 && remaining > target) {
    const first = state.contextBuffer.shift()!
    remaining -= unitTokens(first)
    removed += 1
  }

  return {
    trimmedTokens: total - remaining,
    remainingTokens: remaining,
    removedUnits: removed,
  }
}

export function snapshotContext(state: RootReviewState): Unit[] {
  return [...state.contextBuffer]
}

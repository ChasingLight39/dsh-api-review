/**
 * Context buffer management for root-shared review history.
 *
 * The buffer contains only units whose category has includeContext=true.
 * Units are appended in globalSeq order. When the estimated token count exceeds
 * maxContextTokens * contextTrimThreshold, oldest units are removed until the
 * remaining estimate is <= maxContextTokens * contextTrimTarget.
 */
import type { Config, RootReviewState, Unit } from './types.ts';
export declare function estimateTokens(text: string): number;
export declare function unitTokens(unit: Unit): number;
export interface TrimResult {
    trimmedTokens: number;
    remainingTokens: number;
    removedUnits: number;
}
export declare function appendUnit(state: RootReviewState, unit: Unit): void;
export declare function trimContextIfNeeded(state: RootReviewState, config: Config): TrimResult | undefined;
export declare function snapshotContext(state: RootReviewState): Unit[];

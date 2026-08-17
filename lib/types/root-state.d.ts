/**
 * Root-scoped review state management.
 *
 * One RootReviewState is shared by every agent in the same root session tree.
 * All mutations to a root state go through withRootLock so parallel subagents
 * cannot corrupt shared context/pending/frozen state.
 */
import type { RootReviewState } from './types.ts';
export declare function nextGlobalSeq(): number;
export declare function getOrCreateRootState(rootSessionId: string): RootReviewState;
export declare function getRootState(rootSessionId: string): RootReviewState | undefined;
export declare function deleteRootState(rootSessionId: string): void;
export declare function withRootLock<T>(rootSessionId: string, fn: () => Promise<T> | T): Promise<T>;
export declare function liveRootIds(): string[];

/**
 * Freeze / unfreeze handling.
 *
 * When a root is frozen, no agent in that root tree may start a new model step
 * unless the root user supplies the exact recovery text.
 */
import type { UserMessage } from '@deepseek-ai/dsh-session';
import type { AuditLogger } from './audit.ts';
import type { Config, RootReviewState } from './types.ts';
export declare function isFrozen(state: RootReviewState): boolean;
export interface UnfreezeResult {
    unfrozen: boolean;
    remainingMessages: UserMessage[];
}
/**
 * Inspect the claimed user messages of a frozen root.
 *
 * If any message text exactly equals config.recoveryText, the root is unfrozen,
 * pending blocks are cleared, and that message is removed from the model-bound
 * batch. All other messages are preserved.
 */
export declare function tryUnfreeze(state: RootReviewState, config: Config, messages: UserMessage[], audit: AuditLogger): Promise<UnfreezeResult>;

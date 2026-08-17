/**
 * Checkpoint settlement and user interaction.
 *
 * A checkpoint is any place where pending blocks must be resolved before the
 * agent may continue: block=true units, turn end, and resume attempts.
 */
import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-agent';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AuditLogger } from './audit.ts';
import type { CheckpointDecision, Config, RootReviewState } from './types.ts';
/**
 * Settle all pending blocks at one checkpoint.
 *
 * Returns:
 * - 'allow': pending blocks were cleared and execution may continue.
 * - 'deny': the user rejected; the root state has been frozen.
 */
export declare function settleCheckpoint(ctx: Context, agent: Agent, state: RootReviewState, config: Config, audit: AuditLogger, signal?: AbortSignal): Promise<CheckpointDecision>;

/**
 * Core review engine: turns collected units into context updates and review
 * tasks, and translates review results into pending blocks / freeze decisions.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { AuditLogger } from './audit.ts';
import type { ReviewScheduler } from './scheduler.ts';
import type { Config, ReviewResult, Unit } from './types.ts';
export interface BlockOutcome {
    allow: boolean;
    reason?: string;
}
export declare class ReviewEngine {
    private readonly config;
    private readonly audit;
    private readonly scheduler;
    constructor(config: Config, audit: AuditLogger, scheduler: ReviewScheduler);
    setSystemSnapshot(rootSessionId: string, agentId: string, content: string): Promise<void>;
    private systemSnapshotFor;
    getContextSnapshot(rootSessionId: string): Promise<Unit[]>;
    /**
     * Append a unit to the root context buffer if includeContext=true, and return
     * a snapshot of the buffer BEFORE this unit was appended. This snapshot is
     * what a review task should use.
     */
    prepareUnit(unit: Unit): Promise<Unit[]>;
    /**
     * Register a unit for asynchronous review (block=false, review=true).
     * The large model does not wait for this call.
     */
    reviewAsync(unit: Unit): Promise<void>;
    /**
     * Register an asynchronous review without appending the unit to the context
     * buffer. Used for system units, whose content is stored as a per-agent
     * system snapshot rather than in the shared context buffer.
     */
    reviewAsyncExternal(unit: Unit, snapshot: Unit[], systemSnapshot?: {
        agentId: string;
        content: string;
        updatedAt: number;
    }): Promise<void>;
    /**
     * Handle a blocking unit without appending it to the context buffer. Used for
     * system units.
     */
    reviewBlockingExternal(ctx: Context, agent: Agent, unit: Unit, snapshot: Unit[], systemSnapshot: {
        agentId: string;
        content: string;
        updatedAt: number;
    } | undefined, signal?: AbortSignal): Promise<BlockOutcome>;
    /**
     * Handle a blocking unit (block=true).
     *
     * Flow:
     * 1. Settle any existing pending blocks.
     * 2. If review=false, the unit itself is just a checkpoint and may proceed.
     * 3. If review=true, synchronously review this unit.
     * 4. Non-safe results become pending blocks and are settled through the user.
     */
    reviewBlocking(ctx: Context, agent: Agent, unit: Unit, signal?: AbortSignal): Promise<BlockOutcome>;
    /**
     * Called by the scheduler after an asynchronous review completes.
     */
    handleAsyncResult(task: {
        unit: Unit;
        rootSessionId: string;
        agentId: string;
    }, result: ReviewResult): Promise<void>;
    private addPendingBlock;
    ensureRootExists(rootSessionId: string): Promise<void>;
    contextTokenCount(rootSessionId: string): Promise<number>;
}

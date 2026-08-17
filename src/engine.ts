/**
 * Core review engine: turns collected units into context updates and review
 * tasks, and translates review results into pending blocks / freeze decisions.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AuditLogger } from './audit.ts'
import { settleCheckpoint } from './checkpoint.ts'
import { appendUnit, snapshotContext, trimContextIfNeeded, unitTokens } from './context.ts'
import { getOrCreateRootState, getRootState, withRootLock } from './root-state.ts'
import type { ReviewScheduler } from './scheduler.ts'
import type { Config, PendingBlock, ReviewResult, Unit } from './types.ts'

export interface BlockOutcome {
  allow: boolean
  reason?: string
}

function preview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= 160 ? compact : `${compact.slice(0, 160)}…`
}

export class ReviewEngine {
  constructor(
    private readonly config: Config,
    private readonly audit: AuditLogger,
    private readonly scheduler: ReviewScheduler,
  ) {}

  async setSystemSnapshot(rootSessionId: string, agentId: string, content: string): Promise<void> {
    await withRootLock(rootSessionId, () => {
      const state = getOrCreateRootState(rootSessionId)
      state.systemSnapshots.set(agentId, { agentId, content, updatedAt: Date.now() })
    })
  }

  private async systemSnapshotFor(rootSessionId: string, agentId: string) {
    if (!this.config.system.includeContext) return undefined
    const state = getOrCreateRootState(rootSessionId)
    return state.systemSnapshots.get(agentId)
  }

  async getContextSnapshot(rootSessionId: string): Promise<Unit[]> {
    return withRootLock(rootSessionId, () => {
      const state = getOrCreateRootState(rootSessionId)
      return snapshotContext(state)
    })
  }

  /**
   * Append a unit to the root context buffer if includeContext=true, and return
   * a snapshot of the buffer BEFORE this unit was appended. This snapshot is
   * what a review task should use.
   */
  async prepareUnit(unit: Unit): Promise<Unit[]> {
    return withRootLock(unit.rootSessionId, () => {
      const state = getOrCreateRootState(unit.rootSessionId)
      const snapshot = snapshotContext(state)

      if (unit.includeContext) {
        appendUnit(state, unit)
        const trim = trimContextIfNeeded(state, this.config)
        if (trim !== undefined) {
          void this.audit.log({
            time: Date.now(),
            rootSessionId: unit.rootSessionId,
            agentId: unit.agentId,
            globalSeq: unit.globalSeq,
            category: unit.category,
            unitId: unit.id,
            action: 'context_trim',
            trimmedTokens: trim.trimmedTokens,
            remainingTokens: trim.remainingTokens,
          })
        }
      }

      return snapshot
    })
  }

  /**
   * Register a unit for asynchronous review (block=false, review=true).
   * The large model does not wait for this call.
   */
  async reviewAsync(unit: Unit): Promise<void> {
    if (!unit.review) return
    const snapshot = await this.prepareUnit(unit)
    const systemSnapshot = await this.systemSnapshotFor(unit.rootSessionId, unit.agentId)
    this.scheduler.enqueue({
      taskId: randomUUID(),
      globalSeq: unit.globalSeq,
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      unit,
      contextSnapshot: snapshot,
      systemSnapshot,
      sync: false,
    })
    await this.audit.log({
      time: Date.now(),
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      globalSeq: unit.globalSeq,
      category: unit.category,
      unitId: unit.id,
      action: 'review_start',
      review: unit.review,
      block: unit.block,
      includeContext: unit.includeContext,
    })
  }

  /**
   * Register an asynchronous review without appending the unit to the context
   * buffer. Used for system units, whose content is stored as a per-agent
   * system snapshot rather than in the shared context buffer.
   */
  async reviewAsyncExternal(
    unit: Unit,
    snapshot: Unit[],
    systemSnapshot?: { agentId: string; content: string; updatedAt: number },
  ): Promise<void> {
    if (!unit.review) return
    this.scheduler.enqueue({
      taskId: randomUUID(),
      globalSeq: unit.globalSeq,
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      unit,
      contextSnapshot: snapshot,
      systemSnapshot,
      sync: false,
    })
    await this.audit.log({
      time: Date.now(),
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      globalSeq: unit.globalSeq,
      category: unit.category,
      unitId: unit.id,
      action: 'review_start',
      review: unit.review,
      block: unit.block,
      includeContext: unit.includeContext,
    })
  }

  /**
   * Handle a blocking unit without appending it to the context buffer. Used for
   * system units.
   */
  async reviewBlockingExternal(
    ctx: Context,
    agent: Agent,
    unit: Unit,
    snapshot: Unit[],
    systemSnapshot: { agentId: string; content: string; updatedAt: number } | undefined,
    signal?: AbortSignal,
  ): Promise<BlockOutcome> {
    const state = getOrCreateRootState(unit.rootSessionId)

    const prior = await settleCheckpoint(ctx, agent, state, this.config, this.audit, signal)
    if (prior === 'deny') return { allow: false, reason: 'frozen by prior pending blocks' }

    if (!unit.review) return { allow: true }

    const task = {
      taskId: randomUUID(),
      globalSeq: unit.globalSeq,
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      unit,
      contextSnapshot: snapshot,
      systemSnapshot,
      sync: true,
      signal,
    }
    const resultPromise = this.scheduler.enqueue(task)
    if (resultPromise === undefined) {
      throw new Error('sync review task did not return a promise')
    }
    const result = await resultPromise

    await this.audit.log({
      time: Date.now(),
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      globalSeq: unit.globalSeq,
      category: unit.category,
      unitId: unit.id,
      action: 'review_result',
      review: unit.review,
      block: unit.block,
      includeContext: unit.includeContext,
      verdict: result.verdict,
      reason: result.reason,
    })

    if (result.verdict === 'safe') return { allow: true }

    await this.addPendingBlock(unit, result)
    const decision = await settleCheckpoint(ctx, agent, state, this.config, this.audit, signal)
    if (decision === 'deny') return { allow: false, reason: 'frozen by review decision' }
    return { allow: true }
  }

  /**
   * Handle a blocking unit (block=true).
   *
   * Flow:
   * 1. Settle any existing pending blocks.
   * 2. If review=false, the unit itself is just a checkpoint and may proceed.
   * 3. If review=true, synchronously review this unit.
   * 4. Non-safe results become pending blocks and are settled through the user.
   */
  async reviewBlocking(
    ctx: Context,
    agent: Agent,
    unit: Unit,
    signal?: AbortSignal,
  ): Promise<BlockOutcome> {
    const state = getOrCreateRootState(unit.rootSessionId)

    // Step 1: settle existing pending blocks first.
    const prior = await settleCheckpoint(ctx, agent, state, this.config, this.audit, signal)
    if (prior === 'deny') return { allow: false, reason: 'frozen by prior pending blocks' }

    // Step 2: a block=true unit with review=false is only a checkpoint.
    // Still honor includeContext so the unit enters shared history.
    if (!unit.review) {
      if (unit.includeContext) await this.prepareUnit(unit)
      return { allow: true }
    }

    // Step 3: capture snapshot / append context, then synchronously review.
    const snapshot = await this.prepareUnit(unit)
    const systemSnapshot = await this.systemSnapshotFor(unit.rootSessionId, unit.agentId)
    const task = {
      taskId: randomUUID(),
      globalSeq: unit.globalSeq,
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      unit,
      contextSnapshot: snapshot,
      systemSnapshot,
      sync: true,
      signal,
    }
    const resultPromise = this.scheduler.enqueue(task)
    if (resultPromise === undefined) {
      throw new Error('sync review task did not return a promise')
    }
    const result = await resultPromise

    await this.audit.log({
      time: Date.now(),
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      globalSeq: unit.globalSeq,
      category: unit.category,
      unitId: unit.id,
      action: 'review_result',
      review: unit.review,
      block: unit.block,
      includeContext: unit.includeContext,
      verdict: result.verdict,
      reason: result.reason,
    })

    if (result.verdict === 'safe') return { allow: true }

    // Step 4: add the suspicious unit as a pending block and settle it.
    await this.addPendingBlock(unit, result)
    const decision = await settleCheckpoint(ctx, agent, state, this.config, this.audit, signal)
    if (decision === 'deny') return { allow: false, reason: 'frozen by review decision' }
    return { allow: true }
  }

  /**
   * Called by the scheduler after an asynchronous review completes.
   */
  async handleAsyncResult(task: { unit: Unit; rootSessionId: string; agentId: string }, result: ReviewResult): Promise<void> {
    if (result.verdict === 'safe') {
      await this.audit.log({
        time: Date.now(),
        rootSessionId: task.rootSessionId,
        agentId: task.agentId,
        category: task.unit.category,
        unitId: task.unit.id,
        action: 'review_result',
        verdict: result.verdict,
        reason: result.reason,
      })
      return
    }

    await this.addPendingBlock(task.unit, result)
  }

  private async addPendingBlock(unit: Unit, result: ReviewResult): Promise<void> {
    const block: PendingBlock = {
      id: randomUUID(),
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      unitId: unit.id,
      category: unit.category,
      reason: result.reason,
      contentPreview: preview(unit.content),
      createdAt: Date.now(),
    }

    await withRootLock(unit.rootSessionId, () => {
      const state = getRootState(unit.rootSessionId)
      if (state === undefined) return
      state.pendingBlocks.push(block)
    })

    await this.audit.log({
      time: Date.now(),
      rootSessionId: unit.rootSessionId,
      agentId: unit.agentId,
      globalSeq: unit.globalSeq,
      category: unit.category,
      unitId: unit.id,
      action: 'pending_block',
      reason: result.reason,
    })
  }

  async ensureRootExists(rootSessionId: string): Promise<void> {
    getOrCreateRootState(rootSessionId)
  }

  async contextTokenCount(rootSessionId: string): Promise<number> {
    return withRootLock(rootSessionId, () => {
      const state = getOrCreateRootState(rootSessionId)
      return state.contextBuffer.reduce((sum, unit) => sum + unitTokens(unit), 0)
    })
  }
}

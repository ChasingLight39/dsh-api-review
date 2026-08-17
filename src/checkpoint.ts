/**
 * Checkpoint settlement and user interaction.
 *
 * A checkpoint is any place where pending blocks must be resolved before the
 * agent may continue: block=true units, turn end, and resume attempts.
 */

import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AuditLogger } from './audit.ts'
import { withRootLock } from './root-state.ts'
import type { CheckpointDecision, Config, PendingBlock, RootReviewState } from './types.ts'

const CHECKPOINT_ID = 'api-review-checkpoint'
const ALLOW_LABEL = '全部允许'
const DENY_LABEL = '存在拒绝'

async function withCheckpointLock<T>(state: RootReviewState, fn: () => Promise<T> | T): Promise<T> {
  let acquired = false
  let waitPromise: Promise<void> | undefined

  await withRootLock(state.rootSessionId, () => {
    if (state.checkpointLock) {
      waitPromise = new Promise<void>((resolve) => {
        state.checkpointWaiters.push(resolve)
      })
    } else {
      state.checkpointLock = true
      acquired = true
    }
  })

  if (!acquired) {
    await waitPromise
    return withCheckpointLock(state, fn)
  }

  try {
    return await fn()
  } finally {
    await withRootLock(state.rootSessionId, () => {
      state.checkpointLock = false
      const waiters = state.checkpointWaiters.splice(0)
      for (const waiter of waiters) waiter()
    })
  }
}

function formatPendingBlocks(blocks: PendingBlock[]): string {
  return blocks.map((block, index) => {
    return `${index + 1}. [${block.category}] ${block.reason}\n   ${block.contentPreview}`
  }).join('\n')
}

async function askCheckpointUser(
  ctx: Context,
  agent: Agent,
  blocks: PendingBlock[],
  signal: AbortSignal | undefined,
  fallback: CheckpointDecision,
): Promise<CheckpointDecision> {
  const interaction = ctx.get('userQuestions')
  if (interaction === undefined) return fallback

  let answer
  try {
    answer = await interaction.ask({
      questions: [{
        id: CHECKPOINT_ID,
        header: 'API 安全审查',
        question: `发现以下可疑内容，请决定是否继续：\n\n${formatPendingBlocks(blocks)}`,
        options: [
          { label: ALLOW_LABEL, description: '全部允许，清空所有待处理告警并继续。' },
          { label: DENY_LABEL, description: '存在拒绝，冻结整个对话，需要恢复文本才能继续。' },
        ],
      }],
      agent,
      signal,
    })
  } catch (cause) {
    if (cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED') {
      return 'deny'
    }
    return fallback
  }

  const item = answer.answers.find(entry => entry.id === CHECKPOINT_ID)
  const selected = item?.selected ?? []
  if (selected.includes(ALLOW_LABEL)) return 'allow'
  return 'deny'
}

/**
 * Settle all pending blocks at one checkpoint.
 *
 * Returns:
 * - 'allow': pending blocks were cleared and execution may continue.
 * - 'deny': the user rejected; the root state has been frozen.
 */
export async function settleCheckpoint(
  ctx: Context,
  agent: Agent,
  state: RootReviewState,
  config: Config,
  audit: AuditLogger,
  signal?: AbortSignal,
): Promise<CheckpointDecision> {
  return withCheckpointLock(state, async () => {
    const stateSnapshot = await withRootLock(state.rootSessionId, () => ({
      frozen: state.frozen,
      hasPending: state.pendingBlocks.length > 0,
      blocks: [...state.pendingBlocks],
    }))
    if (stateSnapshot.frozen) return 'deny'
    if (!stateSnapshot.hasPending) return 'allow'

    // Ask the root user, not a child agent. A child agent cannot answer human
    // questions, and asking it would fail-closed and freeze the whole root.
    const rootAgent = ctx.agents.get(state.rootSessionId as SessionId) ?? agent
    const decision = await askCheckpointUser(ctx, rootAgent, stateSnapshot.blocks, signal, config.noUserAction)

    await withRootLock(state.rootSessionId, () => {
      if (decision === 'allow') {
        state.pendingBlocks = []
      } else {
        state.frozen = true
        state.frozenReason = 'user rejected pending blocks'
      }
    })

    await audit.log({
      time: Date.now(),
      rootSessionId: state.rootSessionId,
      agentId: rootAgent.id,
      action: decision === 'allow' ? 'allow' : 'deny',
      userDecision: decision,
      reason: decision === 'deny' ? state.frozenReason : undefined,
    })

    return decision
  })
}

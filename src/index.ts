/**
 * @dsh-external/dsh-api-review — message-flow security review plugin.
 *
 * Reviews system/user/assistant/tool/toolResult/unmatched units with a small
 * model. Supports synchronous (block=true) and asynchronous (block=false)
 * review, root-scoped shared context, pending blocks, checkpoints, freeze, and
 * JSONL auditing.
 */

import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/dsh-user-questions'
import type { AuditLogger } from './audit.ts'
import { AuditLogger as AuditLoggerImpl } from './audit.ts'
import { settleCheckpoint } from './checkpoint.ts'
import {
  assistantText,
  blockToText,
  configForCategory,
  makeUnit,
  resolveRootSessionId,
} from './collectors.ts'
import { Config, validateConfig } from './config.ts'
import { ReviewEngine } from './engine.ts'
import { tryUnfreeze } from './freeze.ts'
import { GuardClient } from './guard-client.ts'
import { deleteRootState, getOrCreateRootState } from './root-state.ts'
import { ReviewScheduler } from './scheduler.ts'
import type { Category, Config as ConfigType, Unit } from './types.ts'

export const name = '@dsh-external/dsh-api-review'
export const inject = ['agents', 'sessions', 'tools', 'userQuestions']

export { Config }

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function textContent(content: ContentBlock[]): string {
  return content.map(blockToText).join('\n')
}

async function processUnit(
  engine: ReviewEngine,
  unit: Unit,
  ctx: Context,
  agent: Agent,
  signal?: AbortSignal,
): Promise<{ allow: boolean; reason?: string }> {
  if (unit.block) {
    return engine.reviewBlocking(ctx, agent, unit, signal)
  }
  if (unit.review) {
    await engine.reviewAsync(unit)
  } else if (unit.includeContext) {
    await engine.prepareUnit(unit)
  }
  return { allow: true }
}

export function apply(ctx: Context, rawConfig: ConfigType): void {
  const config = Config(rawConfig)
  validateConfig(config)

  const audit: AuditLogger = new AuditLoggerImpl(config.auditLogDir)
  const guard = new GuardClient(config)
  let reviewEngine!: ReviewEngine
  const scheduler = new ReviewScheduler(
    guard,
    (task, result) => reviewEngine.handleAsyncResult(task, result),
    config.maxQueueSize,
  )
  reviewEngine = new ReviewEngine(config, audit, scheduler)

  // ── system ──────────────────────────────────────────────────────────────
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent !== undefined) {
      const toolText = assembled.tools.length > 0
        ? `Tools:\n${JSON.stringify(assembled.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })))}`
        : ''
      const contextText = renderContextSnapshot(assembled)
      const rendered = [renderPrompt(assembled), contextText, toolText].filter(Boolean).join('\n\n')
      const rootId = resolveRootSessionId(ctx, agent)
      await reviewEngine.setSystemSnapshot(rootId, agent.id, rendered)

      const category: Category = 'system'
      const cfg = configForCategory(config, category)
      if (cfg.review || cfg.block || cfg.includeContext) {
        const unit = makeUnit(ctx, agent, category, rendered, 'model', config)
        const snapshot = await reviewEngine.getContextSnapshot(rootId)
        // System content is stored as a per-agent snapshot, not in the shared
        // context buffer, so review it through the external (no-append) path.
        let outcome: { allow: boolean; reason?: string }
        if (unit.block) {
          outcome = await reviewEngine.reviewBlockingExternal(ctx, agent, unit, snapshot, undefined, context.signal)
        } else if (unit.review) {
          await reviewEngine.reviewAsyncExternal(unit, snapshot, undefined)
          outcome = { allow: true }
        } else {
          outcome = { allow: true }
        }
        if (!outcome.allow) {
          // The actual rejection is enforced at agent/pre-step via frozen state.
          // We cannot cleanly reject from the assembly waterfall.
          await audit.log({
            time: Date.now(),
            rootSessionId: unit.rootSessionId,
            agentId: unit.agentId,
            globalSeq: unit.globalSeq,
            category,
            unitId: unit.id,
            action: 'deny',
            userDecision: 'deny',
            reason: outcome.reason,
          })
        }
      }
    }
    return assembled
  })

  // ── user / unmatched / frozen / pending settlement ─────────────────────
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const rootId = resolveRootSessionId(ctx, agent)
    const state = getOrCreateRootState(rootId)

    if (state.frozen) {
      // Only the root user may unfreeze a frozen root. A child agent must never
      // be able to clear the freeze by forwarding the recovery text.
      if (agent.session.header.parentSession !== undefined) {
        return { kind: 'reject' }
      }
      const unfreeze = await tryUnfreeze(state, config, messages, audit)
      if (!unfreeze.unfrozen) {
        return { kind: 'reject' }
      }
      messages = unfreeze.remainingMessages
    }

    if (state.pendingBlocks.length > 0) {
      const decision = await settleCheckpoint(ctx, agent, state, config, audit, signal)
      if (decision === 'deny') return { kind: 'reject' }
    }

    for (const message of messages) {
      const category: Category = message.source.kind === 'user' ? 'user' : 'unmatched'
      const cfg = configForCategory(config, category)
      if (!cfg.review && !cfg.block && !cfg.includeContext) continue

      const content = textContent(message.content)
      if (content.trim() === '') continue

      const unit = makeUnit(ctx, agent, category, content, message.source.kind, config)
      const outcome = await processUnit(reviewEngine, unit, ctx, agent, signal)
      if (!outcome.allow) return { kind: 'reject' }
    }

    return next()
  })

  // ── assistant text ─────────────────────────────────────────────────────
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'assistant/message') return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return

    const category: Category = 'assistant'
    const cfg = configForCategory(config, category)
    if (!cfg.review && !cfg.block && !cfg.includeContext) return

    const content = assistantText(event.data.message)
    if (content.trim() === '') return

    const unit = makeUnit(ctx, agent, category, content, 'model', config)
    void processUnit(reviewEngine, unit, ctx, agent).then((outcome) => {
      if (!outcome.allow) {
        // Assistant text may already be visible; freeze prevents further steps.
        void audit.log({
          time: Date.now(),
          rootSessionId: unit.rootSessionId,
          agentId: unit.agentId,
          globalSeq: unit.globalSeq,
          category,
          unitId: unit.id,
          action: 'deny',
          userDecision: 'deny',
          reason: outcome.reason,
        })
      }
    }).catch((error: unknown) => {
      void audit.log({
        time: Date.now(),
        rootSessionId: unit.rootSessionId,
        agentId: unit.agentId,
        globalSeq: unit.globalSeq,
        category,
        unitId: unit.id,
        action: 'review_result',
        verdict: 'error',
        reason: error instanceof Error ? error.message : String(error),
      })
    })
  })

  // ── tool calls ─────────────────────────────────────────────────────────
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next()

    const category: Category = 'tool'
    const cfg = configForCategory(config, category)
    if (!cfg.review && !cfg.block && !cfg.includeContext) return next()

    const argumentsText = typeof exec.arguments === 'string'
      ? exec.arguments
      : safeStringify(exec.arguments)
    const content = `tool: ${exec.name}\narguments: ${argumentsText}`
    const unit = makeUnit(ctx, exec.agent, category, content, 'model', config)

    // Review BEFORE delegating downstream. Otherwise another plugin returning
    // `ask` (which may later be approved) would bypass this guard entirely.
    const outcome = await processUnit(reviewEngine, unit, ctx, exec.agent, exec.signal)
    if (!outcome.allow) {
      return { kind: 'deny', reason: outcome.reason ?? '[api-review] blocked' }
    }
    return next()
  })

  // ── tool results ───────────────────────────────────────────────────────
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (exec.agent === undefined) return downstream

    const category: Category = 'toolResult'
    const cfg = configForCategory(config, category)
    if (!cfg.review && !cfg.block && !cfg.includeContext) return downstream

    const content = textContent(result.content)
    if (content.trim() === '') return downstream

    const unit = makeUnit(ctx, exec.agent, category, content, 'tool', config)
    const outcome = await processUnit(reviewEngine, unit, ctx, exec.agent, exec.signal)
    if (!outcome.allow) {
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: outcome.reason ?? '[api-review] tool result blocked' }],
      }
    }
    return downstream
  })

  // ── turn-end pending settlement ────────────────────────────────────────
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const state = getOrCreateRootState(resolveRootSessionId(ctx, agent))
    if (state.frozen) return
    if (state.pendingBlocks.length > 0) {
      await settleCheckpoint(ctx, agent, state, config, audit, signal)
    }
  })

  // ── lifecycle cleanup ──────────────────────────────────────────────────
  ctx.on('agent/disposed', ({ agent }) => {
    if (agent.session.header.parentSession === undefined) {
      deleteRootState(agent.session.id)
    }
  })
}

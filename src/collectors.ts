/**
 * Helpers for collecting DSH events into review Units.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import { nextGlobalSeq } from './root-state.ts'
import type { Category, CategoryConfig, Config, Unit } from './types.ts'

export function configForCategory(config: Config, category: Category): CategoryConfig {
  switch (category) {
    case 'system': return config.system
    case 'user': return config.user
    case 'assistant': return config.assistant
    case 'tool': return config.tool
    case 'toolResult': return config.toolResult
    case 'unmatched': return config.unmatched
  }
}

export function resolveRootSessionId(ctx: Context, agent: Agent): string {
  let session = agent.session
  let currentId = session.id
  const seen = new Set<string>()

  while (session.header.parentSession !== undefined) {
    const parentId = session.header.parentSession
    if (seen.has(parentId)) break
    seen.add(parentId)
    const parentSession = ctx.sessions.get(parentId)
    if (parentSession === undefined) break
    currentId = parentId
    session = parentSession
  }

  return currentId
}

export function makeUnit(
  ctx: Context,
  agent: Agent,
  category: Category,
  content: string,
  sourceKind: string,
  config: Config,
): Unit {
  const categoryConfig = configForCategory(config, category)
  return {
    id: randomUUID(),
    globalSeq: nextGlobalSeq(),
    rootSessionId: resolveRootSessionId(ctx, agent),
    agentId: agent.id,
    category,
    content,
    sourceKind,
    review: categoryConfig.review,
    block: categoryConfig.block,
    includeContext: categoryConfig.includeContext,
    occurredAt: Date.now(),
  }
}

export function blockToText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text
    case 'reasoning':
      return `[reasoning] ${block.text}`
    case 'tool-call':
      return `[tool-call ${block.name}] ${block.arguments}`
    case 'tool-result':
      return `[tool-result ${block.toolCallId}] ${block.content.map(blockToText).join('\n')}`
    case 'image':
      return '[image]'
    default:
      return `[${(block as { type: string }).type}]`
  }
}

export function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): boolean => block.type === 'text' || block.type === 'reasoning')
    .map(blockToText)
    .join('\n')
}

export function toolResultText(message: ToolResultMessage): string {
  return message.content.map(blockToText).join('\n')
}

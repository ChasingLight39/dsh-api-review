/**
 * Helpers for collecting DSH events into review Units.
 */
import { randomUUID } from 'node:crypto';
import '@deepseek-ai/dsh-session';
import { nextGlobalSeq } from "./root-state.js";
export function configForCategory(config, category) {
    switch (category) {
        case 'system': return config.system;
        case 'user': return config.user;
        case 'assistant': return config.assistant;
        case 'tool': return config.tool;
        case 'toolResult': return config.toolResult;
        case 'unmatched': return config.unmatched;
    }
}
export function resolveRootSessionId(ctx, agent) {
    let session = agent.session;
    let currentId = session.id;
    const seen = new Set();
    while (session.header.parentSession !== undefined) {
        const parentId = session.header.parentSession;
        if (seen.has(parentId))
            break;
        seen.add(parentId);
        const parentSession = ctx.sessions.get(parentId);
        if (parentSession === undefined)
            break;
        currentId = parentId;
        session = parentSession;
    }
    return currentId;
}
export function makeUnit(ctx, agent, category, content, sourceKind, config) {
    const categoryConfig = configForCategory(config, category);
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
    };
}
export function blockToText(block) {
    switch (block.type) {
        case 'text':
            return block.text;
        case 'reasoning':
            return `[reasoning] ${block.text}`;
        case 'tool-call':
            return `[tool-call ${block.name}] ${block.arguments}`;
        case 'tool-result':
            return `[tool-result ${block.toolCallId}] ${block.content.map(blockToText).join('\n')}`;
        case 'image':
            return '[image]';
        default:
            return `[${block.type}]`;
    }
}
export function assistantText(message) {
    return message.content
        .filter((block) => block.type === 'text' || block.type === 'reasoning')
        .map(blockToText)
        .join('\n');
}
export function toolResultText(message) {
    return message.content.map(blockToText).join('\n');
}
//# sourceMappingURL=collectors.js.map
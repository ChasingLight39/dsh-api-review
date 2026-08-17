/**
 * Freeze / unfreeze handling.
 *
 * When a root is frozen, no agent in that root tree may start a new model step
 * unless the root user supplies the exact recovery text.
 */
import { withRootLock } from "./root-state.js";
export function isFrozen(state) {
    return state.frozen;
}
function messageText(message) {
    return message.content
        .map((block) => {
        if (block.type === 'text')
            return block.text;
        if (block.type === 'tool-result') {
            return block.content.map((child) => child.type === 'text' ? child.text : '').join('\n');
        }
        return '';
    })
        .filter(Boolean)
        .join('\n')
        .trim();
}
/**
 * Inspect the claimed user messages of a frozen root.
 *
 * If any message text exactly equals config.recoveryText, the root is unfrozen,
 * pending blocks are cleared, and that message is removed from the model-bound
 * batch. All other messages are preserved.
 */
export async function tryUnfreeze(state, config, messages, audit) {
    const recovery = config.recoveryText.trim();
    const remaining = [];
    let foundRecovery = false;
    for (const message of messages) {
        if (!foundRecovery && messageText(message) === recovery) {
            foundRecovery = true;
        }
        else {
            remaining.push(message);
        }
    }
    if (!foundRecovery) {
        return { unfrozen: false, remainingMessages: messages };
    }
    await withRootLock(state.rootSessionId, () => {
        state.frozen = false;
        state.frozenReason = undefined;
        state.pendingBlocks = [];
    });
    await audit.log({
        time: Date.now(),
        rootSessionId: state.rootSessionId,
        agentId: state.rootSessionId,
        action: 'unfreeze',
    });
    return { unfrozen: true, remainingMessages: remaining };
}
//# sourceMappingURL=freeze.js.map
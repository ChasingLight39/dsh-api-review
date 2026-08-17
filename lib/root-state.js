/**
 * Root-scoped review state management.
 *
 * One RootReviewState is shared by every agent in the same root session tree.
 * All mutations to a root state go through withRootLock so parallel subagents
 * cannot corrupt shared context/pending/frozen state.
 */
const states = new Map();
const locks = new Map();
let globalSeq = 0;
export function nextGlobalSeq() {
    globalSeq += 1;
    return globalSeq;
}
export function getOrCreateRootState(rootSessionId) {
    let state = states.get(rootSessionId);
    if (state === undefined) {
        state = {
            rootSessionId,
            contextBuffer: [],
            pendingBlocks: [],
            frozen: false,
            systemSnapshots: new Map(),
            checkpointLock: false,
            checkpointWaiters: [],
        };
        states.set(rootSessionId, state);
    }
    return state;
}
export function getRootState(rootSessionId) {
    return states.get(rootSessionId);
}
export function deleteRootState(rootSessionId) {
    states.delete(rootSessionId);
    locks.delete(rootSessionId);
}
export async function withRootLock(rootSessionId, fn) {
    const previous = locks.get(rootSessionId) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    locks.set(rootSessionId, previous.then(() => gate));
    try {
        return await previous.then(fn);
    }
    finally {
        release();
    }
}
export function liveRootIds() {
    return [...states.keys()];
}
//# sourceMappingURL=root-state.js.map
/**
 * Context buffer management for root-shared review history.
 *
 * The buffer contains only units whose category has includeContext=true.
 * Units are appended in globalSeq order. When the estimated token count exceeds
 * maxContextTokens * contextTrimThreshold, oldest units are removed until the
 * remaining estimate is <= maxContextTokens * contextTrimTarget.
 */
export function estimateTokens(text) {
    // Rough heuristic: ~4 chars per token, reasonable for mixed CJK/Latin text.
    return Math.ceil(text.length / 4);
}
export function unitTokens(unit) {
    return estimateTokens(unit.content);
}
export function appendUnit(state, unit) {
    state.contextBuffer.push(unit);
}
export function trimContextIfNeeded(state, config) {
    const total = state.contextBuffer.reduce((sum, unit) => sum + unitTokens(unit), 0);
    const threshold = config.maxContextTokens * config.contextTrimThreshold;
    const target = config.maxContextTokens * config.contextTrimTarget;
    if (total <= threshold)
        return undefined;
    let remaining = total;
    let removed = 0;
    while (state.contextBuffer.length > 1 && remaining > target) {
        const first = state.contextBuffer.shift();
        remaining -= unitTokens(first);
        removed += 1;
    }
    return {
        trimmedTokens: total - remaining,
        remainingTokens: remaining,
        removedUnits: removed,
    };
}
export function snapshotContext(state) {
    return [...state.contextBuffer];
}
//# sourceMappingURL=context.js.map
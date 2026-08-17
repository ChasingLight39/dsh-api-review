/**
 * Shared type definitions for dsh-api-review.
 */
export type Category = 'system' | 'user' | 'assistant' | 'tool' | 'toolResult' | 'unmatched';
export interface CategoryConfig {
    review: boolean;
    block: boolean;
    includeContext: boolean;
}
export interface Config {
    system: CategoryConfig;
    user: CategoryConfig;
    assistant: CategoryConfig;
    tool: CategoryConfig;
    toolResult: CategoryConfig;
    unmatched: CategoryConfig;
    baseURL: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    maxContextTokens: number;
    contextTrimThreshold: number;
    contextTrimTarget: number;
    maxQueueSize: number;
    noUserAction: 'deny' | 'allow';
    recoveryText: string;
    auditLogDir: string;
}
export interface Unit {
    id: string;
    globalSeq: number;
    rootSessionId: string;
    agentId: string;
    category: Category;
    content: string;
    sourceKind: string;
    review: boolean;
    block: boolean;
    includeContext: boolean;
    occurredAt: number;
}
export interface SystemSnapshot {
    agentId: string;
    content: string;
    updatedAt: number;
}
export interface PendingBlock {
    id: string;
    rootSessionId: string;
    agentId: string;
    unitId: string;
    category: Category;
    reason: string;
    contentPreview: string;
    createdAt: number;
}
export interface RootReviewState {
    rootSessionId: string;
    contextBuffer: Unit[];
    pendingBlocks: PendingBlock[];
    frozen: boolean;
    frozenReason?: string;
    systemSnapshots: Map<string, SystemSnapshot>;
    checkpointLock: boolean;
    checkpointWaiters: Array<() => void>;
}
export type ReviewVerdict = 'safe' | 'block' | 'unknown' | 'error';
export interface ReviewResult {
    verdict: ReviewVerdict;
    reason: string;
}
export interface ReviewTask {
    taskId: string;
    globalSeq: number;
    rootSessionId: string;
    agentId: string;
    unit: Unit;
    contextSnapshot: Unit[];
    systemSnapshot?: SystemSnapshot;
    sync: boolean;
    signal?: AbortSignal;
    resolve?: (result: ReviewResult) => void;
    reject?: (error: unknown) => void;
}
export type AuditAction = 'unit_arrived' | 'review_start' | 'review_result' | 'pending_block' | 'checkpoint' | 'freeze' | 'unfreeze' | 'context_trim' | 'allow' | 'deny';
export interface AuditEntry {
    time: number;
    rootSessionId: string;
    agentId: string;
    globalSeq?: number;
    category?: Category;
    unitId?: string;
    action: AuditAction;
    review?: boolean;
    block?: boolean;
    includeContext?: boolean;
    verdict?: ReviewVerdict;
    reason?: string;
    userDecision?: 'allow' | 'deny';
    trimmedTokens?: number;
    remainingTokens?: number;
}
export type CheckpointDecision = 'allow' | 'deny';

/**
 * Global single-consumer review scheduler.
 *
 * Every review request — synchronous (block=true) or asynchronous (block=false)
 * — enters one global FIFO queue. A single worker consumes the queue and calls
 * the guard model, so parallel subagents never create concurrent small-model
 * requests.
 */
import type { GuardClient } from './guard-client.ts';
import type { ReviewResult, ReviewTask } from './types.ts';
export type AsyncResultHandler = (task: ReviewTask, result: ReviewResult) => Promise<void> | void;
export declare class ReviewScheduler {
    private readonly guard;
    private readonly onAsyncResult?;
    private readonly maxQueueSize;
    private readonly queue;
    private running;
    constructor(guard: GuardClient, onAsyncResult?: AsyncResultHandler | undefined, maxQueueSize?: number);
    /**
     * Enqueue a review task.
     *
     * For sync tasks (block=true) returns a Promise that resolves when the worker
     * has processed this task. For async tasks returns undefined; the caller must
     * not wait.
     */
    enqueue(task: ReviewTask): Promise<ReviewResult> | undefined;
    private ensureWorker;
    private loop;
}

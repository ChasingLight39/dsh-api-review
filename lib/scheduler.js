/**
 * Global single-consumer review scheduler.
 *
 * Every review request — synchronous (block=true) or asynchronous (block=false)
 * — enters one global FIFO queue. A single worker consumes the queue and calls
 * the guard model, so parallel subagents never create concurrent small-model
 * requests.
 */
export class ReviewScheduler {
    guard;
    onAsyncResult;
    maxQueueSize;
    queue = [];
    running = false;
    constructor(guard, onAsyncResult, maxQueueSize = 1000) {
        this.guard = guard;
        this.onAsyncResult = onAsyncResult;
        this.maxQueueSize = maxQueueSize;
    }
    /**
     * Enqueue a review task.
     *
     * For sync tasks (block=true) returns a Promise that resolves when the worker
     * has processed this task. For async tasks returns undefined; the caller must
     * not wait.
     */
    enqueue(task) {
        // Async best-effort reviews are dropped when the queue is saturated.
        // Sync reviews are always admitted because they are security checkpoints.
        if (!task.sync && this.queue.length >= this.maxQueueSize) {
            const result = {
                verdict: 'error',
                reason: 'review queue full; async review dropped',
            };
            Promise.resolve(this.onAsyncResult?.(task, result)).catch(() => { });
            return undefined;
        }
        this.queue.push(task);
        if (!task.sync) {
            this.ensureWorker();
            return undefined;
        }
        return new Promise((resolve, reject) => {
            task.resolve = resolve;
            task.reject = reject;
            this.ensureWorker();
        });
    }
    ensureWorker() {
        if (this.running)
            return;
        this.running = true;
        void this.loop();
    }
    async loop() {
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task.signal?.aborted) {
                task.reject?.(new Error('review task aborted'));
                continue;
            }
            let result;
            try {
                result = await this.guard.review(task.unit, task.contextSnapshot, task.systemSnapshot, task.signal);
            }
            catch (error) {
                result = {
                    verdict: 'error',
                    reason: error instanceof Error ? error.message : String(error),
                };
            }
            if (task.sync) {
                task.resolve?.(result);
            }
            else {
                try {
                    await this.onAsyncResult?.(task, result);
                }
                catch {
                    // A failed async-result handler must not break the queue or re-run
                    // the same task (which would duplicate pending blocks).
                }
            }
        }
        this.running = false;
    }
}
//# sourceMappingURL=scheduler.js.map
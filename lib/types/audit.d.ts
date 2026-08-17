/**
 * JSONL audit logger for dsh-api-review.
 *
 * Logging is best-effort and batched: entries are queued in memory and flushed
 * asynchronously, so audit I/O never blocks the security decision path.
 */
import type { AuditEntry } from './types.ts';
export declare class AuditLogger {
    private readonly dir;
    private ready;
    private readonly pending;
    private flushing;
    constructor(dir: string);
    private ensureDir;
    log(entry: AuditEntry): void;
    private drain;
}

/**
 * JSONL audit logger for dsh-api-review.
 *
 * Logging is best-effort and batched: entries are queued in memory and flushed
 * asynchronously, so audit I/O never blocks the security decision path.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
function dateStamp(date) {
    return date.toISOString().slice(0, 10);
}
export class AuditLogger {
    dir;
    ready;
    pending = [];
    flushing = false;
    constructor(dir) {
        this.dir = dir.trim() === '' ? join(homedir(), '.dsh', 'logs') : dir;
    }
    ensureDir() {
        this.ready ??= mkdir(this.dir, { recursive: true })
            .then(() => undefined)
            .catch((error) => {
            this.ready = undefined;
            throw error;
        });
        return this.ready;
    }
    log(entry) {
        this.pending.push(entry);
        if (!this.flushing) {
            this.flushing = true;
            void this.drain();
        }
    }
    async drain() {
        try {
            while (this.pending.length > 0) {
                const batch = this.pending.splice(0);
                try {
                    await this.ensureDir();
                    const byFile = new Map();
                    for (const entry of batch) {
                        const file = join(this.dir, `api-review-${dateStamp(new Date(entry.time))}.jsonl`);
                        const lines = byFile.get(file) ?? [];
                        lines.push(JSON.stringify(entry));
                        byFile.set(file, lines);
                    }
                    for (const [file, lines] of byFile) {
                        await appendFile(file, `${lines.join('\n')}\n`, 'utf8');
                    }
                }
                catch {
                    // Best-effort only: a failed batch is dropped.
                }
            }
        }
        finally {
            this.flushing = false;
        }
    }
}
//# sourceMappingURL=audit.js.map
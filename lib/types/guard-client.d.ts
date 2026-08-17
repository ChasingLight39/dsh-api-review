/**
 * Small-model guard API client.
 *
 * The guard model is deliberately given no tools and no code execution ability.
 * It only returns a JSON classification. Anything other than an explicit `safe`
 * verdict is treated as a block/unknown/error by the caller.
 */
import type { ReviewResult, Unit } from './types.ts';
import type { Config } from './types.ts';
declare function estimateTokens(text: string): number;
export declare class GuardClient {
    private readonly config;
    constructor(config: Config);
    review(unit: Unit, contextSnapshot: Unit[], systemSnapshot?: {
        content: string;
    }, signal?: AbortSignal): Promise<ReviewResult>;
}
export { estimateTokens };

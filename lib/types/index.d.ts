/**
 * @dsh-external/dsh-api-review — message-flow security review plugin.
 *
 * Reviews system/user/assistant/tool/toolResult/unmatched units with a small
 * model. Supports synchronous (block=true) and asynchronous (block=false)
 * review, root-scoped shared context, pending blocks, checkpoints, freeze, and
 * JSONL auditing.
 */
import type { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-session';
import '@deepseek-ai/dsh-system-prompt';
import '@deepseek-ai/dsh-tools';
import '@deepseek-ai/dsh-user-questions';
import { Config } from './config.ts';
import type { Config as ConfigType } from './types.ts';
export declare const name = "@dsh-external/dsh-api-review";
export declare const inject: string[];
export { Config };
export declare function apply(ctx: Context, rawConfig: ConfigType): void;

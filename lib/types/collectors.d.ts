/**
 * Helpers for collecting DSH events into review Units.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import '@deepseek-ai/dsh-session';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { AssistantMessage, ToolResultMessage } from '@deepseek-ai/dsh-llm';
import type { Category, CategoryConfig, Config, Unit } from './types.ts';
export declare function configForCategory(config: Config, category: Category): CategoryConfig;
export declare function resolveRootSessionId(ctx: Context, agent: Agent): string;
export declare function makeUnit(ctx: Context, agent: Agent, category: Category, content: string, sourceKind: string, config: Config): Unit;
export declare function blockToText(block: ContentBlock): string;
export declare function assistantText(message: AssistantMessage): string;
export declare function toolResultText(message: ToolResultMessage): string;

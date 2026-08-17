/**
 * Configuration schema and validation for dsh-api-review.
 */
import z from 'schemastery';
import type { Config as ConfigType } from './types.ts';
export declare const Config: z<ConfigType>;
export declare function validateConfig(config: ConfigType): void;

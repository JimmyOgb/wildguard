/**
 * WildGuard - Otari Configuration Module
 * Manages runtime configuration, model routing roles, timeouts, and budget caps.
 */

import * as fs from 'node:fs';

export type ExecutionMode = 'simulation' | 'live';

export interface ModelRolesConfig {
  explorer: string;
  coder: string;
  fallback: string;
}

export interface WildGuardConfig {
  apiKey?: string;
  baseUrl: string;
  mode: ExecutionMode;
  maxRunCostUsd: number;
  globalBudgetCeilingUsd: number;
  timeoutMs: number;
  models: ModelRolesConfig;
  accessToken?: string;
  upstashRedisUrl?: string;
  upstashRedisToken?: string;
}

export const DEFAULT_CONFIG = {
  BASE_URL: 'https://api.otari.ai/api/v1',
  EXPLORER_MODEL: 'deepseek/deepseek-v4.1-flash',
  CODER_MODEL: 'alibaba/qwen-3.5-35b-a3b',
  FALLBACK_MODEL: 'meta-llama/llama-3.3-70b-instruct',
  DEFAULT_MODE: 'simulation' as ExecutionMode,
  DEFAULT_MAX_RUN_COST_USD: 1.50,
  DEFAULT_GLOBAL_BUDGET_CEILING_USD: 10.00,
  DEFAULT_TIMEOUT_MS: 30000,
} as const;

/**
 * Validates a numeric budget value.
 * Must be finite, positive, and non-NaN.
 */
export function validateBudget(value: unknown): number {
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  if (isNaN(num) || !isFinite(num) || num <= 0) {
    throw new Error(`Invalid budget: value must be a positive finite number, got: ${value}`);
  }
  return Number(num.toFixed(6));
}

/**
 * Validates timeout value.
 * Must be a positive integer >= 1000ms.
 */
export function validateTimeout(value: unknown): number {
  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (isNaN(num) || !isFinite(num) || num < 1000) {
    throw new Error(`Invalid timeout: value must be >= 1000ms, got: ${value}`);
  }
  return Math.floor(num);
}

/**
 * Validates the base URL to ensure proper scheme and path.
 */
export function validateBaseUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid base URL: URL must be a non-empty string');
  }
  const trimmed = url.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Invalid URL protocol: ${parsed.protocol}. Only http and https are supported.`);
    }
  } catch (err) {
    throw new Error(`Malformed base URL "${url}": ${(err as Error).message}`);
  }
  return trimmed;
}

/**
 * Loads and validates WildGuard configuration from environment variables.
 * Fails safe to simulation mode if live credentials or live flag are not explicitly set.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): WildGuardConfig {
  let resolvedEnv = env;
  if (env === process.env && !env.OTARI_API_KEY && fs.existsSync('.env')) {
    try {
      const dotenvContent = fs.readFileSync('.env', 'utf8');
      const parsed: Record<string, string> = {};
      for (const line of dotenvContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          parsed[key] = val;
        }
      }
      resolvedEnv = { ...parsed, ...env };
    } catch {
      // Fallback cleanly if .env cannot be read
    }
  }

  const cleanEnvValue = (val?: string): string | undefined => {
    if (!val) return undefined;
    let s = val.trim();
    const eqIdx = s.indexOf('=');
    if (eqIdx !== -1 && !s.startsWith('http://') && !s.startsWith('https://')) {
      s = s.slice(eqIdx + 1).trim();
    }
    s = s.replace(/^[\\"'`]+|[\\"'`]+$/g, '').trim();
    if (s.startsWith('Bearer ')) s = s.slice(7).trim();
    return s || undefined;
  };

  const rawApiKey = cleanEnvValue(resolvedEnv.OTARI_API_KEY);
  const rawBaseUrl = cleanEnvValue(resolvedEnv.OTARI_BASE_URL) || DEFAULT_CONFIG.BASE_URL;
  const baseUrl = validateBaseUrl(rawBaseUrl);

  const rawMode = cleanEnvValue(resolvedEnv.WILDGUARD_MODE)?.toLowerCase();
  
  // Rule: WILDGUARD_MODE must default to simulation unless live credentials
  // and explicit live-mode configuration are BOTH present.
  let mode: ExecutionMode = 'simulation';
  if (rawMode === 'live') {
    if (rawApiKey && rawApiKey.length > 0) {
      mode = 'live';
    } else {
      // Missing API key forces simulation mode for safety
      mode = 'simulation';
    }
  }

  // Budget validation (defaults to 1.50 USD per run)
  const maxRunCostUsd = resolvedEnv.WILDGUARD_MAX_RUN_COST_USD
    ? validateBudget(resolvedEnv.WILDGUARD_MAX_RUN_COST_USD)
    : DEFAULT_CONFIG.DEFAULT_MAX_RUN_COST_USD;

  // Global budget ceiling (defaults to 10.00 USD)
  const globalBudgetCeilingUsd = resolvedEnv.WILDGUARD_GLOBAL_BUDGET_CEILING_USD
    ? validateBudget(resolvedEnv.WILDGUARD_GLOBAL_BUDGET_CEILING_USD)
    : DEFAULT_CONFIG.DEFAULT_GLOBAL_BUDGET_CEILING_USD;

  // Timeout validation
  const timeoutMs = resolvedEnv.OTARI_TIMEOUT_MS
    ? validateTimeout(resolvedEnv.OTARI_TIMEOUT_MS)
    : DEFAULT_CONFIG.DEFAULT_TIMEOUT_MS;

  // Models configuration
  const explorer = resolvedEnv.OTARI_EXPLORER_MODEL !== undefined
    ? (cleanEnvValue(resolvedEnv.OTARI_EXPLORER_MODEL) ?? '')
    : DEFAULT_CONFIG.EXPLORER_MODEL;
  const coder = resolvedEnv.OTARI_CODER_MODEL !== undefined
    ? (cleanEnvValue(resolvedEnv.OTARI_CODER_MODEL) ?? '')
    : DEFAULT_CONFIG.CODER_MODEL;
  const fallback = resolvedEnv.OTARI_FALLBACK_MODEL !== undefined
    ? (cleanEnvValue(resolvedEnv.OTARI_FALLBACK_MODEL) ?? '')
    : DEFAULT_CONFIG.FALLBACK_MODEL;

  if (!explorer || !coder || !fallback) {
    throw new Error('All model roles (explorer, coder, fallback) must have valid non-empty identifiers.');
  }

  const rawAccessToken = cleanEnvValue(resolvedEnv.WILDGUARD_ACCESS_TOKEN);
  const rawRedisUrl = cleanEnvValue(resolvedEnv.UPSTASH_REDIS_REST_URL);
  const rawRedisToken = cleanEnvValue(resolvedEnv.UPSTASH_REDIS_REST_TOKEN);

  return {
    apiKey: rawApiKey || undefined,
    baseUrl,
    mode,
    maxRunCostUsd,
    globalBudgetCeilingUsd,
    timeoutMs,
    models: {
      explorer,
      coder,
      fallback,
    },
    accessToken: rawAccessToken || undefined,
    upstashRedisUrl: rawRedisUrl || undefined,
    upstashRedisToken: rawRedisToken || undefined,
  };
}

/**
 * Returns safe string representation of config for logging/diagnostics,
 * redacting any sensitive credentials.
 */
export function sanitizeConfig(config: WildGuardConfig): Record<string, unknown> {
  return {
    baseUrl: config.baseUrl,
    mode: config.mode,
    maxRunCostUsd: config.maxRunCostUsd,
    globalBudgetCeilingUsd: config.globalBudgetCeilingUsd,
    timeoutMs: config.timeoutMs,
    models: { ...config.models },
    hasApiKey: Boolean(config.apiKey && config.apiKey.length > 0),
    hasAccessToken: Boolean(config.accessToken && config.accessToken.length > 0),
    hasRedisConfig: Boolean(config.upstashRedisUrl && config.upstashRedisToken),
  };
}

/**
 * Returns public configuration status reporting only safe booleans
 */
export function getPublicConfigStatus(config: WildGuardConfig): Record<string, boolean | string | number> {
  return {
    mode: config.mode,
    hasApiKey: Boolean(config.apiKey && config.apiKey.length > 0),
    hasAccessToken: Boolean(config.accessToken && config.accessToken.length > 0),
    hasRedisConfig: Boolean(config.upstashRedisUrl && config.upstashRedisToken),
    maxRunCostUsd: config.maxRunCostUsd,
    globalBudgetCeilingUsd: config.globalBudgetCeilingUsd,
  };
}

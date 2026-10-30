/**
 * WildGuard - Otari Configuration Module
 * Manages runtime configuration, model routing roles, timeouts, and budget caps.
 */

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
  timeoutMs: number;
  models: ModelRolesConfig;
}

export const DEFAULT_CONFIG = {
  BASE_URL: 'https://api.otari.ai/api/v1',
  EXPLORER_MODEL: 'deepseek/deepseek-v4.1-flash',
  CODER_MODEL: 'alibaba/qwen-3.5-35b-a3b',
  FALLBACK_MODEL: 'meta-llama/llama-3.3-70b-instruct',
  DEFAULT_MODE: 'simulation' as ExecutionMode,
  DEFAULT_MAX_RUN_COST_USD: 1.50,
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
  const rawApiKey = env.OTARI_API_KEY?.trim();
  const rawBaseUrl = env.OTARI_BASE_URL?.trim() || DEFAULT_CONFIG.BASE_URL;
  const baseUrl = validateBaseUrl(rawBaseUrl);

  const rawMode = env.WILDGUARD_MODE?.toLowerCase().trim();
  
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
  const maxRunCostUsd = env.WILDGUARD_MAX_RUN_COST_USD
    ? validateBudget(env.WILDGUARD_MAX_RUN_COST_USD)
    : DEFAULT_CONFIG.DEFAULT_MAX_RUN_COST_USD;

  // Timeout validation
  const timeoutMs = env.OTARI_TIMEOUT_MS
    ? validateTimeout(env.OTARI_TIMEOUT_MS)
    : DEFAULT_CONFIG.DEFAULT_TIMEOUT_MS;

  // Models configuration
  const explorer = env.OTARI_EXPLORER_MODEL !== undefined
    ? env.OTARI_EXPLORER_MODEL.trim()
    : DEFAULT_CONFIG.EXPLORER_MODEL;
  const coder = env.OTARI_CODER_MODEL !== undefined
    ? env.OTARI_CODER_MODEL.trim()
    : DEFAULT_CONFIG.CODER_MODEL;
  const fallback = env.OTARI_FALLBACK_MODEL !== undefined
    ? env.OTARI_FALLBACK_MODEL.trim()
    : DEFAULT_CONFIG.FALLBACK_MODEL;

  if (!explorer || !coder || !fallback) {
    throw new Error('All model roles (explorer, coder, fallback) must have valid non-empty identifiers.');
  }

  return {
    apiKey: rawApiKey || undefined,
    baseUrl,
    mode,
    maxRunCostUsd,
    timeoutMs,
    models: {
      explorer,
      coder,
      fallback,
    },
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
    timeoutMs: config.timeoutMs,
    models: { ...config.models },
    hasApiKey: Boolean(config.apiKey && config.apiKey.length > 0),
  };
}

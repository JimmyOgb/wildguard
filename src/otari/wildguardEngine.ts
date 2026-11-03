/**
 * WildGuard - Multi-Model Otari Inference Engine
 * Manages model role routing (Explorer, Coder, Fallback), transient error recovery,
 * response normalization, and live telemetry capture via Otari.ai gateway.
 */

import { WildGuardConfig } from './config.js';
import { TelemetryManager } from './telemetry.js';

export type ModelRole = 'explorer' | 'coder' | 'fallback';

export type OtariErrorCategory =
  | 'timeout'
  | 'authentication_failed'
  | 'invalid_model'
  | 'gateway_error'
  | 'network_error';

export class WildGuardApiError extends Error {
  public readonly category: OtariErrorCategory;
  public readonly status?: number;
  public readonly code?: string;
  public readonly isTimeout: boolean;

  constructor(
    category: OtariErrorCategory,
    message: string,
    options?: { status?: number; code?: string; isTimeout?: boolean }
  ) {
    super(message);
    this.name = 'WildGuardApiError';
    this.category = category;
    this.status = options?.status;
    this.code = options?.code;
    this.isTimeout = options?.isTimeout ?? (category === 'timeout');
    Object.setPrototypeOf(this, WildGuardApiError.prototype);
  }
}

/**
 * Strips credentials, API keys, and Authorization headers from error text.
 */
export function sanitizeErrorMessage(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, '$1[REDACTED]')
    .replace(/(Otari-Key[:=]\s*)[A-Za-z0-9_\-\.]{8,}/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key[:=]\s*)[A-Za-z0-9_\-\.]{8,}/gi, '$1[REDACTED]')
    .replace(/(authorization[:=]\s*)[A-Za-z0-9_\-\.]{8,}/gi, '$1[REDACTED]');
}

/**
 * Classifies errors into safe, structured categories.
 */
export function categorizeOtariError(
  err: any,
  timeoutMs: number = 30000,
  model?: string
): WildGuardApiError {
  if (err instanceof WildGuardApiError) {
    return err;
  }

  const status = typeof err?.status === 'number' ? err.status : undefined;
  const rawMsg = typeof err?.message === 'string' ? err.message : (typeof err === 'string' ? err : '');
  const sanitized = sanitizeErrorMessage(rawMsg);
  const isAbort = err?.name === 'AbortError' || err?.isTimeout === true || sanitized.includes('aborted');

  // 1. Timeout (client AbortController / deadline exceeded - distinct from gateway HTTP error)
  if (isAbort || err?.code === 'ETIMEDOUT') {
    return new WildGuardApiError(
      'timeout',
      `Request timed out after ${timeoutMs}ms while waiting for Otari gateway response.`,
      { status: 504, code: 'CLIENT_TIMEOUT', isTimeout: true }
    );
  }

  // 2. Authentication failure (HTTP 401 or 403)
  if (
    status === 401 ||
    status === 403 ||
    /missing.*(otari-key|authorization|x-api-key)/i.test(sanitized) ||
    /unauthorized/i.test(sanitized) ||
    /forbidden/i.test(sanitized)
  ) {
    return new WildGuardApiError(
      'authentication_failed',
      `Otari API error ${status || 401}: Authentication failed - Invalid or missing Otari credentials.`,
      { status: status || 401, code: 'AUTH_FAILED' }
    );
  }

  // 3. Invalid model (HTTP 400 with invalid_model or unrecognized identifier)
  if (
    (status === 400 && (/invalid_model/i.test(sanitized) || /unknown or unsupported model/i.test(sanitized) || /model.*not found/i.test(sanitized))) ||
    err?.code === 'invalid_model'
  ) {
    const targetModel = model ? ` '${model}'` : '';
    return new WildGuardApiError(
      'invalid_model',
      `Otari API error 400: Invalid model identifier${targetModel}. Upstream requires a valid 'provider:model' selector or catalog model ID.`,
      { status: 400, code: 'INVALID_MODEL' }
    );
  }

  // 4. Gateway HTTP errors (5xx or other non-200 HTTP responses)
  if (typeof status === 'number' && status >= 400) {
    return new WildGuardApiError(
      'gateway_error',
      `Otari API error ${status}: Gateway error (${sanitized || 'Upstream service error'})`,
      { status, code: 'GATEWAY_ERROR' }
    );
  }

  // 5. Network errors (fetch failed, connection refused, DNS error)
  return new WildGuardApiError(
    'network_error',
    `Network error: Failed to reach Otari gateway (${sanitized || 'Connection failed'}).`,
    { status: 503, code: 'NETWORK_ERROR' }
  );
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface EngineRequest {
  role: ModelRole;
  modelOverride?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  disableFallback?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface EngineResponse {
  content: string;
  reasoningDiagnostic?: string;
  roleUsed: ModelRole;
  modelUsed: string;
  providerUsed?: string;
  fallbackTriggered: boolean;
  attemptCount: number;
  requestId?: string;
  latencyMs: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    pricingSource?: string;
  };
}

export class WildGuardEngine {
  private readonly config: WildGuardConfig;
  private readonly telemetry: TelemetryManager;

  constructor(config: WildGuardConfig, telemetry: TelemetryManager) {
    this.config = config;
    this.telemetry = telemetry;
  }

  public getConfig(): WildGuardConfig {
    return this.config;
  }

  public getTelemetry(): TelemetryManager {
    return this.telemetry;
  }

  /**
   * Resolves the candidate model identifier for a given role.
   */
  public resolveModelForRole(role: ModelRole): string {
    switch (role) {
      case 'explorer':
        return this.config.models.explorer;
      case 'coder':
        return this.config.models.coder;
      case 'fallback':
        return this.config.models.fallback;
      default:
        return this.config.models.explorer;
    }
  }

  /**
   * Primary inference execution with budget checks and automatic fallback.
   */
  public async execute(request: EngineRequest): Promise<EngineResponse> {
    // Check budget before proceeding
    const budgetCheck = this.telemetry.canProceed();
    if (!budgetCheck.allowed) {
      throw new Error(`Inference blocked by budget enforcement: ${budgetCheck.reason}`);
    }

    if (this.config.mode === 'simulation') {
      return this.executeSimulation(request);
    }

    return this.executeLiveWithFallback(request);
  }

  /**
   * Executes live request with failover to fallback model on recoverable errors.
   */
  private async executeLiveWithFallback(request: EngineRequest): Promise<EngineResponse> {
    if (!this.config.apiKey) {
      throw new WildGuardApiError(
        'authentication_failed',
        'OTARI_API_KEY is not configured on server. Live inference fails closed for security.',
        { status: 401, code: 'MISSING_API_KEY' }
      );
    }

    let primaryModel = this.resolveModelForRole(request.role);

    // Bounded request-scoped model override (must match one of the configured models)
    if (request.modelOverride) {
      const allowedModels = [
        this.config.models.coder,
        this.config.models.explorer,
        this.config.models.fallback,
      ];
      if (!allowedModels.includes(request.modelOverride)) {
        throw new WildGuardApiError(
          'invalid_model',
          `Invalid request modelOverride: "${request.modelOverride}". Model must be one of the configured models: ${allowedModels.join(', ')}.`,
          { status: 400, code: 'INVALID_MODEL' }
        );
      }
      primaryModel = request.modelOverride;
    }

    let attemptCount = 1;
    let fallbackTriggered = false;
    let modelToUse = primaryModel;
    let roleUsed = request.role;

    const startTotal = Date.now();

    try {
      return await this.callOtariApi(modelToUse, request.messages, roleUsed, false, attemptCount, {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      });
    } catch (primaryErr: any) {
      const isAuthError = primaryErr.category === 'authentication_failed' || primaryErr.status === 401 || primaryErr.status === 403;
      const isBudgetError = primaryErr.message?.includes('budget') || primaryErr.status === 402;

      // DO NOT fallback on auth or budget errors, or when fallback is disabled
      if (isAuthError || isBudgetError || request.disableFallback) {
        throw primaryErr;
      }

      // If primary was already fallback, propagate error
      if (request.role === 'fallback') {
        throw primaryErr;
      }

      // Recoverable error: fallback to designated fallback model
      fallbackTriggered = true;
      attemptCount++;
      modelToUse = this.config.models.fallback;
      roleUsed = 'fallback';

      // Verify budget before initiating fallback call
      const fallbackBudgetCheck = this.telemetry.canProceed();
      if (!fallbackBudgetCheck.allowed) {
        throw new Error(
          `Primary model (${primaryModel}) failed: ${primaryErr.message}. Fallback blocked by budget enforcement: ${fallbackBudgetCheck.reason}`
        );
      }

      try {
        return await this.callOtariApi(modelToUse, request.messages, roleUsed, true, attemptCount, {
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          timeoutMs: request.timeoutMs,
          signal: request.signal,
        });
      } catch (fallbackErr: any) {
        throw new WildGuardApiError(
          fallbackErr.category || primaryErr.category || 'gateway_error',
          `Primary model (${primaryModel}) failed: ${primaryErr.message}. Fallback model (${modelToUse}) also failed: ${fallbackErr.message}`,
          { status: fallbackErr.status || primaryErr.status }
        );
      }
    }
  }

  /**
   * Performs the HTTP request to Otari POST /chat/completions
   */
  private async callOtariApi(
    model: string,
    messages: ChatMessage[],
    role: ModelRole,
    fallbackOccurred: boolean,
    attemptCount: number,
    options?: { temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal }
  ): Promise<EngineResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey || ''}`,
      'Otari-Key': this.config.apiKey || '',
      'User-Agent': 'WildGuard-Engine/1.0',
    };

    const body: Record<string, any> = {
      model,
      messages,
      temperature: options?.temperature !== undefined ? options.temperature : (role === 'coder' ? 0.2 : 0.7),
    };
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    const effectiveTimeout = options?.timeoutMs || this.config.timeoutMs;
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), effectiveTimeout);

    let abortListener: (() => void) | undefined;
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        abortListener = () => controller.abort();
        options.signal.addEventListener('abort', abortListener, { once: true });
      }
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw categorizeOtariError(
          { status: res.status, statusText: res.statusText, message: errorText },
          this.config.timeoutMs,
          model
        );
      }

      const requestId = res.headers.get('otari-request-id') || undefined;
      const provider = res.headers.get('otari-provider') || undefined;
      const data = await res.json() as any;

      const firstChoice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
      const msg = firstChoice?.message;

      // Extract text content safely without substituting reasoning fields
      let content = '';
      if (typeof msg?.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg?.content)) {
        content = msg.content
          .map((part: any) => {
            if (typeof part === 'string') return part;
            if (part && typeof part.text === 'string') return part.text;
            return '';
          })
          .join('');
      } else if (typeof firstChoice?.text === 'string') {
        content = firstChoice.text;
      }

      // Preserve reasoning content purely as diagnostic metadata if present, NEVER substituting content
      const rawReasoning = msg?.reasoning_content ?? msg?.reasoning;
      const reasoningDiagnostic = typeof rawReasoning === 'string' ? rawReasoning : undefined;

      const usageData = data?.usage || {};

      const promptTokens = usageData.prompt_tokens ?? 0;
      const completionTokens = usageData.completion_tokens ?? 0;
      const totalTokens = usageData.total_tokens ?? (promptTokens + completionTokens);
      const costUsd = usageData.cost_usd ?? null;
      const pricingSource = usageData.pricing_source ?? undefined;

      // Record in telemetry
      const event = this.telemetry.recordEvent({
        requestId,
        model,
        provider,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
        pricingSource,
        latencyMs,
        fallbackOccurred,
        attemptCount,
      });

      return {
        content,
        reasoningDiagnostic,
        roleUsed: role,
        modelUsed: model,
        providerUsed: provider,
        fallbackTriggered: fallbackOccurred,
        attemptCount,
        requestId,
        latencyMs,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          costUsd: event.costUsd,
          pricingSource,
        },
      };
    } catch (err: any) {
      if (err instanceof WildGuardApiError) {
        throw err;
      }
      if (controller.signal.aborted || err?.name === 'AbortError') {
        throw categorizeOtariError(
          { name: 'AbortError', isTimeout: true, message: 'This operation was aborted' },
          effectiveTimeout,
          model
        );
      }
      throw categorizeOtariError(err, effectiveTimeout, model);
    } finally {
      clearTimeout(timeoutHandle);
      if (options?.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener);
      }
    }
  }

  /**
   * Deterministic simulation mode for CI and local verification without consuming credits.
   */
  private executeSimulation(request: EngineRequest): EngineResponse {
    let model = this.resolveModelForRole(request.role);

    if (request.modelOverride) {
      const allowedModels = [
        this.config.models.coder,
        this.config.models.explorer,
        this.config.models.fallback,
      ];
      if (!allowedModels.includes(request.modelOverride)) {
        throw new WildGuardApiError(
          'invalid_model',
          `Invalid request modelOverride: "${request.modelOverride}". Model must be one of the configured models: ${allowedModels.join(', ')}.`,
          { status: 400, code: 'INVALID_MODEL' }
        );
      }
      model = request.modelOverride;
    }

    const latencyMs = 120 + Math.floor(Math.random() * 80);

    const userMsg = request.messages[request.messages.length - 1]?.content || '';
    let simContent = '';

    if (request.role === 'explorer') {
      simContent = `[SIMULATED EXPLORER: ${model}]\nRepository analysis complete. Inspected files and identified core structure for "${userMsg.slice(0, 50)}...". Recommendations ready.`;
    } else if (request.role === 'coder') {
      simContent = `[SIMULATED CODER: ${model}]\nCode synthesis complete. Generated patch proposals adhering to repository guardrails.`;
    } else {
      simContent = `[SIMULATED FALLBACK: ${model}]\nFallback model activated. Verified alternative execution path.`;
    }

    const promptTokens = Math.max(50, Math.floor(userMsg.length / 4));
    const completionTokens = Math.max(30, Math.floor(simContent.length / 4));
    const totalTokens = promptTokens + completionTokens;

    const event = this.telemetry.recordEvent({
      requestId: `sim_req_${Date.now()}`,
      model,
      provider: 'simulated_provider',
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      fallbackOccurred: request.role === 'fallback',
      attemptCount: 1,
    });

    return {
      content: simContent,
      roleUsed: request.role,
      modelUsed: model,
      providerUsed: 'simulated_provider',
      fallbackTriggered: request.role === 'fallback',
      attemptCount: 1,
      requestId: event.requestId,
      latencyMs,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: event.costUsd,
        pricingSource: 'simulation',
      },
    };
  }
}

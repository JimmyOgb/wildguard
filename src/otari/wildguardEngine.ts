/**
 * WildGuard - Multi-Model Otari Inference Engine
 * Manages model role routing (Explorer, Coder, Fallback), transient error recovery,
 * response normalization, and live telemetry capture via Otari.ai gateway.
 */

import { WildGuardConfig } from './config.js';
import { TelemetryManager } from './telemetry.js';

export type ModelRole = 'explorer' | 'coder' | 'fallback';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface EngineRequest {
  role: ModelRole;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
}

export interface EngineResponse {
  content: string;
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
    const primaryModel = this.resolveModelForRole(request.role);
    let attemptCount = 1;
    let fallbackTriggered = false;
    let modelToUse = primaryModel;
    let roleUsed = request.role;

    const startTotal = Date.now();

    try {
      return await this.callOtariApi(modelToUse, request.messages, roleUsed, false, attemptCount);
    } catch (primaryErr: any) {
      const isAuthError = primaryErr.status === 401 || primaryErr.status === 403;
      const isBudgetError = primaryErr.message?.includes('budget') || primaryErr.status === 402;

      // DO NOT fallback on auth or budget errors
      if (isAuthError || isBudgetError) {
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
        return await this.callOtariApi(modelToUse, request.messages, roleUsed, true, attemptCount);
      } catch (fallbackErr: any) {
        throw new Error(
          `Primary model (${primaryModel}) failed: ${primaryErr.message}. Fallback model (${modelToUse}) also failed: ${fallbackErr.message}`
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
    attemptCount: number
  ): Promise<EngineResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Otari-Key': this.config.apiKey || '',
      'User-Agent': 'WildGuard-Engine/1.0',
    };

    const body = {
      model,
      messages,
      temperature: role === 'coder' ? 0.2 : 0.7,
    };

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

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
        const err: any = new Error(`Otari API error ${res.status}: ${errorText || res.statusText}`);
        err.status = res.status;
        throw err;
      }

      const requestId = res.headers.get('otari-request-id') || undefined;
      const provider = res.headers.get('otari-provider') || undefined;
      const data = await res.json() as any;

      const content = data.choices?.[0]?.message?.content || '';
      const usageData = data.usage || {};

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
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Deterministic simulation mode for CI and local verification without consuming credits.
   */
  private executeSimulation(request: EngineRequest): EngineResponse {
    const model = this.resolveModelForRole(request.role);
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

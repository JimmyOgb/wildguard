/**
 * WildGuard - Telemetry & Budget Tracker Module
 * Strictly tracks token usage, settles micro-dollar costs, enforces per-run caps,
 * and maintains clean isolation between simulated and live Otari data.
 */

import { ExecutionMode } from './config.js';

export type CostSource = 'otari' | 'estimate' | 'simulation' | 'unavailable';

export interface InferenceTelemetryEvent {
  id: string;
  runId: string;
  timestamp: string;
  executionMode: ExecutionMode;
  requestId?: string;
  model: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  costSource: CostSource;
  pricingSource?: string;
  latencyMs: number;
  fallbackOccurred: boolean;
  attemptCount: number;
}

export interface BudgetSummary {
  runId: string;
  executionMode: ExecutionMode;
  maxRunCostUsd: number;
  accumulatedCostUsd: number;
  remainingCostUsd: number;
  isExhausted: boolean;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  requestCount: number;
}

/**
 * Validates and sanitizes token count values.
 * Must be a finite, non-negative integer.
 */
function sanitizeTokens(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.floor(val) : 0;
  }
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

/**
 * Validates cost values.
 * Must be a finite, non-negative number.
 */
function sanitizeCost(val: unknown): { valid: boolean; cost: number } {
  if (val === null || val === undefined) {
    return { valid: false, cost: 0 };
  }
  const num = typeof val === 'string' ? parseFloat(val) : Number(val);
  if (!Number.isFinite(num) || isNaN(num) || num < 0) {
    return { valid: false, cost: 0 };
  }
  return { valid: true, cost: Number(num.toFixed(6)) };
}

export class TelemetryManager {
  private readonly runId: string;
  private readonly mode: ExecutionMode;
  private readonly maxRunCostUsd: number;
  private events: InferenceTelemetryEvent[] = [];
  private accumulatedActualCostUsd = 0;
  private accumulatedSimulatedCostUsd = 0;

  constructor(runId: string, mode: ExecutionMode, maxRunCostUsd = 1.50) {
    this.runId = runId;
    this.mode = mode;
    this.maxRunCostUsd = Number(maxRunCostUsd.toFixed(6));
  }

  public getRunId(): string {
    return this.runId;
  }

  public getMode(): ExecutionMode {
    return this.mode;
  }

  public getMaxRunCostUsd(): number {
    return this.maxRunCostUsd;
  }

  /**
   * Checks whether a new request can proceed within the remaining budget.
   * Fails closed if the budget is already exhausted or projected cost exceeds limit.
   */
  public canProceed(projectedCostUsd = 0.01): { allowed: boolean; reason?: string } {
    const currentCost = this.mode === 'live' ? this.accumulatedActualCostUsd : this.accumulatedSimulatedCostUsd;
    const projected = Number.isFinite(projectedCostUsd) && projectedCostUsd > 0 ? projectedCostUsd : 0.01;
    const projectedTotal = Number((currentCost + projected).toFixed(6));

    if (currentCost >= this.maxRunCostUsd) {
      return {
        allowed: false,
        reason: `Run budget exhausted: accumulated ${currentCost.toFixed(6)} USD >= cap of ${this.maxRunCostUsd.toFixed(6)} USD.`,
      };
    }

    if (projectedTotal > this.maxRunCostUsd) {
      return {
        allowed: false,
        reason: `Projected cost (${projectedTotal.toFixed(6)} USD) exceeds per-run ceiling of ${this.maxRunCostUsd.toFixed(6)} USD.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Records a completed inference telemetry event and updates accumulated spend.
   * Rejects negative costs, negative tokens, NaN, and Infinity.
   */
  public recordEvent(params: {
    requestId?: string;
    model: string;
    provider?: string;
    promptTokens?: unknown;
    completionTokens?: unknown;
    totalTokens?: unknown;
    costUsd?: unknown;
    pricingSource?: string;
    latencyMs: number;
    fallbackOccurred?: boolean;
    attemptCount?: number;
  }): InferenceTelemetryEvent {
    const pTokens = sanitizeTokens(params.promptTokens);
    const cTokens = sanitizeTokens(params.completionTokens);
    const rawTot = sanitizeTokens(params.totalTokens);
    const totTokens = rawTot > 0 ? rawTot : (pTokens + cTokens);

    let cost = 0;
    let costSource: CostSource = 'unavailable';

    if (this.mode === 'simulation') {
      costSource = 'simulation';
      // Simulated cost at $0.20 per million prompt, $0.60 per million completion
      cost = Number(((pTokens * 0.0000002) + (cTokens * 0.0000006)).toFixed(6));
      this.accumulatedSimulatedCostUsd = Number((this.accumulatedSimulatedCostUsd + cost).toFixed(6));
    } else {
      // Live mode
      const costCheck = sanitizeCost(params.costUsd);
      if (costCheck.valid) {
        cost = costCheck.cost;
        costSource = 'otari';
        this.accumulatedActualCostUsd = Number((this.accumulatedActualCostUsd + cost).toFixed(6));
      } else if (totTokens > 0) {
        // Fallback estimate if Otari did not supply cost_usd or supplied invalid cost
        costSource = 'estimate';
        cost = Number(((pTokens * 0.0000005) + (cTokens * 0.0000015)).toFixed(6));
        this.accumulatedActualCostUsd = Number((this.accumulatedActualCostUsd + cost).toFixed(6));
      } else {
        // Cost is genuinely unavailable
        cost = 0;
        costSource = 'unavailable';
      }
    }

    const event: InferenceTelemetryEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      executionMode: this.mode,
      requestId: params.requestId,
      model: params.model,
      provider: params.provider,
      promptTokens: pTokens,
      completionTokens: cTokens,
      totalTokens: totTokens,
      costUsd: cost,
      costSource,
      pricingSource: params.pricingSource,
      latencyMs: Number.isFinite(params.latencyMs) && params.latencyMs >= 0 ? Math.floor(params.latencyMs) : 0,
      fallbackOccurred: Boolean(params.fallbackOccurred),
      attemptCount: Math.max(1, typeof params.attemptCount === 'number' ? params.attemptCount : 1),
    };

    this.events.push(event);
    return event;
  }

  /**
   * Returns current budget and usage summary.
   */
  public getSummary(): BudgetSummary {
    const isLive = this.mode === 'live';
    const cost = isLive ? this.accumulatedActualCostUsd : this.accumulatedSimulatedCostUsd;
    const remaining = Math.max(0, Number((this.maxRunCostUsd - cost).toFixed(6)));

    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalTokens = 0;

    for (const evt of this.events) {
      totalPrompt += evt.promptTokens;
      totalCompletion += evt.completionTokens;
      totalTokens += evt.totalTokens;
    }

    return {
      runId: this.runId,
      executionMode: this.mode,
      maxRunCostUsd: this.maxRunCostUsd,
      accumulatedCostUsd: cost,
      remainingCostUsd: remaining,
      isExhausted: cost >= this.maxRunCostUsd,
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalCompletion,
      totalTokens,
      requestCount: this.events.length,
    };
  }

  public getEvents(): readonly InferenceTelemetryEvent[] {
    return this.events;
  }
}

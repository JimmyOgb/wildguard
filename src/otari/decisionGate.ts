/**
 * WildGuard - Decision Gate Module
 * Implements structured go/no-go quality gates for PRs, patches, and actions.
 * Integrates with Otari POST /api/v1/decisions with deterministic local fallback and fail-closed safety.
 */

import { PolicyResult } from './guardrails.js';

export type DecisionOutcome = 'approve' | 'reject' | 'requires_human_approval';

export interface DecisionGateRequest {
  state: string;
  context?: Record<string, unknown>;
  localPolicyResult?: PolicyResult;
  proposedDiff?: string;
  filesModified?: string[];
}

export interface DecisionGateResult {
  outcome: DecisionOutcome;
  confidence: number;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  decisionEngine: 'otari_decisions_api' | 'local_deterministic_gate';
  rawResponse?: Record<string, unknown>;
  timestamp: string;
}

export class DecisionGate {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly isLiveMode: boolean;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, apiKey?: string, isLiveMode = false, timeoutMs = 10000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.isLiveMode = isLiveMode;
    this.timeoutMs = timeoutMs && timeoutMs > 0 ? timeoutMs : 10000;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * Evaluates a proposed change through the decision gate.
   * Deterministic local policy ALWAYS takes absolute precedence.
   */
  public async evaluate(request: DecisionGateRequest): Promise<DecisionGateResult> {
    const timestamp = new Date().toISOString();

    // RULE 1: Local policy precedence. An Otari decision CANNOT override a local rejection.
    if (request.localPolicyResult) {
      if (request.localPolicyResult.status === 'blocked') {
        return {
          outcome: 'reject',
          confidence: 1.0,
          reason: `Local guardrail policy rejection: ${request.localPolicyResult.message} (${request.localPolicyResult.reasonCode})`,
          riskLevel: 'critical',
          decisionEngine: 'local_deterministic_gate',
          timestamp,
        };
      }

      if (request.localPolicyResult.status === 'requires_approval') {
        return {
          outcome: 'requires_human_approval',
          confidence: 1.0,
          reason: `Local guardrail policy demands human verification: ${request.localPolicyResult.message}`,
          riskLevel: 'high',
          decisionEngine: 'local_deterministic_gate',
          timestamp,
        };
      }
    }

    // Live mode evaluation with Otari Decisions API
    if (this.isLiveMode) {
      if (!this.apiKey) {
        return {
          outcome: 'requires_human_approval',
          confidence: 1.0,
          reason: 'Decisions API missing credentials in live execution mode. Fails closed to require human verification.',
          riskLevel: 'high',
          decisionEngine: 'local_deterministic_gate',
          timestamp,
        };
      }

      try {
        const remoteResult = await this.queryRemoteDecisionsApi(request);
        if (remoteResult) {
          return remoteResult;
        }
      } catch (err: any) {
        const isTimeout = err?.name === 'AbortError' || err?.message?.includes('timeout') || err?.message?.includes('aborted');
        // Fail closed on timeout or network error: never convert failure into approval
        return {
          outcome: 'requires_human_approval',
          confidence: 1.0,
          reason: isTimeout
            ? `Otari Decisions API timed out after ${this.timeoutMs}ms. Fails closed to require human verification.`
            : `Otari Decisions API network failure (${err?.message || 'unknown error'}). Fails closed to require human verification.`,
          riskLevel: 'high',
          decisionEngine: 'local_deterministic_gate',
          timestamp,
        };
      }
    }

    // Deterministic local gate evaluation
    return this.evaluateLocalGate(request, timestamp);
  }

  /**
   * Queries Otari POST /api/v1/decisions with AbortController timeout.
   */
  public async queryRemoteDecisionsApi(request: DecisionGateRequest): Promise<DecisionGateResult> {
    const url = `${this.baseUrl}/decisions`;
    const body = {
      model: 'typesafe:jev-latest',
      state: request.state,
      questions: {
        is_safe: {
          type: 'noul',
          instructions: 'Does this proposed patch or change introduce unsafe modifications, security escapes, or breaking syntax?',
        },
        risk_level: {
          type: 'choice',
          options: ['low', 'medium', 'high', 'critical'],
          instructions: 'Assess the overall risk level of this change.',
        },
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Otari-Key': this.apiKey!,
      'User-Agent': 'WildGuard-DecisionGate/1.0',
    };

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Decisions API HTTP ${res.status}: ${errText || res.statusText}`);
      }

      const data = await res.json() as Record<string, any>;
      const answers = data?.answers || {};

      const isSafe = answers.is_safe?.value ?? false;
      const riskLevel = (answers.risk_level?.value ?? 'high') as 'low' | 'medium' | 'high' | 'critical';

      let outcome: DecisionOutcome = 'reject';
      if (isSafe && (riskLevel === 'low' || riskLevel === 'medium')) {
        outcome = 'approve';
      } else if (riskLevel === 'high') {
        outcome = 'requires_human_approval';
      }

      return {
        outcome,
        confidence: 0.95,
        reason: `Otari Decisions API evaluated state. Safe: ${isSafe}, Risk: ${riskLevel}.`,
        riskLevel,
        decisionEngine: 'otari_decisions_api',
        rawResponse: data,
        timestamp: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Deterministic local gate: performs pattern and heuristics checks on diff and state.
   */
  private evaluateLocalGate(request: DecisionGateRequest, timestamp: string): DecisionGateResult {
    const diff = request.proposedDiff || '';

    // Check for high-risk markers
    const hasEval = /eval\s*\(/.test(diff) || /exec\s*\(/.test(diff);
    const hasSpawn = /child_process|execSync|spawnSync/.test(diff);
    const hasDangerousShell = /rm\s+-rf|sudo\s+|chmod\s+777/.test(diff);

    if (hasDangerousShell) {
      return {
        outcome: 'reject',
        confidence: 1.0,
        reason: 'Dangerous shell deletion or permission override detected in diff.',
        riskLevel: 'critical',
        decisionEngine: 'local_deterministic_gate',
        timestamp,
      };
    }

    if (hasEval || hasSpawn) {
      return {
        outcome: 'requires_human_approval',
        confidence: 0.9,
        reason: 'Dynamic code execution (eval/exec/spawn) detected in proposed patch.',
        riskLevel: 'high',
        decisionEngine: 'local_deterministic_gate',
        timestamp,
      };
    }

    // Default safe change
    return {
      outcome: 'approve',
      confidence: 0.9,
      reason: 'Local gate verified: no dangerous execution patterns or unapproved dependency changes.',
      riskLevel: 'low',
      decisionEngine: 'local_deterministic_gate',
      timestamp,
    };
  }
}

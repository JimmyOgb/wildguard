/**
 * WildGuard - Agent Orchestration Loop
 * Coordinates autonomous agent turns between Explorer reconnaissance and Coder synthesis,
 * enforcing hard limits, budget stops, decision quality gates, and live audit logging.
 */

import { WildGuardEngine } from './wildguardEngine.js';
import { McpRepoTools, ToolResult } from './mcpRepoTools.js';
import { DecisionGate, DecisionGateResult } from './decisionGate.js';
import { TelemetryManager, BudgetSummary } from './telemetry.js';

export interface AgentRunOptions {
  userTask: string;
  maxIterations?: number;
  autoApproveSafePatches?: boolean;
}

export interface AgentEvent {
  step: number;
  phase: 'explorer' | 'coder' | 'tool_execution' | 'decision_gate' | 'completed' | 'error';
  timestamp: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface AgentRunSummary {
  runId: string;
  status: 'completed' | 'aborted_budget' | 'aborted_iteration_limit' | 'failed' | 'requires_approval';
  totalSteps: number;
  budgetSummary: BudgetSummary;
  decisionGateResult?: DecisionGateResult;
  history: AgentEvent[];
  finalResponse: string;
}

export class AgentLoop {
  private readonly engine: WildGuardEngine;
  private readonly tools: McpRepoTools;
  private readonly decisionGate: DecisionGate;
  private readonly telemetry: TelemetryManager;
  private readonly runId: string;
  private events: AgentEvent[] = [];

  constructor(
    engine: WildGuardEngine,
    tools: McpRepoTools,
    decisionGate: DecisionGate,
    telemetry: TelemetryManager
  ) {
    this.engine = engine;
    this.tools = tools;
    this.decisionGate = decisionGate;
    this.telemetry = telemetry;
    this.runId = telemetry.getRunId();
  }

  public getRunId(): string {
    return this.runId;
  }

  public getEvents(): readonly AgentEvent[] {
    return this.events;
  }

  /**
   * Executes the full agent workflow with strict boundaries.
   */
  public async run(options: AgentRunOptions): Promise<AgentRunSummary> {
    const maxSteps = options.maxIterations ?? 5;
    let currentStep = 0;
    let finalResponse = '';

    this.logEvent(0, 'explorer', `Initiating WildGuard Agent Run [${this.runId}]`, { task: options.userTask });

    try {
      // PHASE 1: EXPLORER RECONNAISSANCE
      currentStep++;
      const budgetCheck1 = this.telemetry.canProceed();
      if (!budgetCheck1.allowed) {
        return this.abortWithBudget(currentStep, budgetCheck1.reason || 'Budget exhausted');
      }

      // Safe repo exploration tool
      const fileList = this.tools.listFiles('', false);
      this.logEvent(currentStep, 'tool_execution', 'Listed files in repository root', { count: fileList.data?.length ?? 0 });

      // Run Explorer model
      const explorerRes = await this.engine.execute({
        role: 'explorer',
        messages: [
          { role: 'system', content: 'You are the WildGuard Explorer. Inspect the task, identify required files, and outline an implementation plan.' },
          { role: 'user', content: `Task: ${options.userTask}\nExisting files: ${fileList.data?.map(f => f.name).join(', ') || 'none'}` }
        ]
      });

      this.logEvent(currentStep, 'explorer', 'Explorer model completed reconnaissance', {
        model: explorerRes.modelUsed,
        tokens: explorerRes.usage.totalTokens,
        cost: explorerRes.usage.costUsd
      });

      // PHASE 2: CODER SYNTHESIS
      currentStep++;
      const budgetCheck2 = this.telemetry.canProceed();
      if (!budgetCheck2.allowed) {
        return this.abortWithBudget(currentStep, budgetCheck2.reason || 'Budget exhausted');
      }

      const coderRes = await this.engine.execute({
        role: 'coder',
        messages: [
          { role: 'system', content: 'You are the WildGuard Coder. Produce clean code changes and adhere strictly to repository policies.' },
          { role: 'user', content: `Task: ${options.userTask}\nExplorer plan: ${explorerRes.content}` }
        ]
      });

      finalResponse = coderRes.content;
      this.logEvent(currentStep, 'coder', 'Coder model generated proposed changes', {
        model: coderRes.modelUsed,
        tokens: coderRes.usage.totalTokens,
        cost: coderRes.usage.costUsd
      });

      // PHASE 3: STRUCTURED DECISION GATE
      currentStep++;
      const gateResult = await this.decisionGate.evaluate({
        state: `Proposed changes for: ${options.userTask}`,
        proposedDiff: coderRes.content,
      });

      this.logEvent(currentStep, 'decision_gate', `Decision gate evaluated change: outcome=${gateResult.outcome}`, {
        outcome: gateResult.outcome,
        risk: gateResult.riskLevel,
        engine: gateResult.decisionEngine
      });

      if (gateResult.outcome === 'reject') {
        return {
          runId: this.runId,
          status: 'failed',
          totalSteps: currentStep,
          budgetSummary: this.telemetry.getSummary(),
          decisionGateResult: gateResult,
          history: this.events,
          finalResponse: `Run rejected by decision gate: ${gateResult.reason}`,
        };
      }

      if (gateResult.outcome === 'requires_human_approval') {
        return {
          runId: this.runId,
          status: 'requires_approval',
          totalSteps: currentStep,
          budgetSummary: this.telemetry.getSummary(),
          decisionGateResult: gateResult,
          history: this.events,
          finalResponse: `Human approval required before applying changes: ${gateResult.reason}`,
        };
      }

      // Completed successfully
      this.logEvent(currentStep, 'completed', 'Agent workflow completed successfully.');
      return {
        runId: this.runId,
        status: 'completed',
        totalSteps: currentStep,
        budgetSummary: this.telemetry.getSummary(),
        decisionGateResult: gateResult,
        history: this.events,
        finalResponse,
      };

    } catch (err) {
      this.logEvent(currentStep, 'error', `Agent execution error: ${(err as Error).message}`);
      return {
        runId: this.runId,
        status: 'failed',
        totalSteps: currentStep,
        budgetSummary: this.telemetry.getSummary(),
        history: this.events,
        finalResponse: `Agent loop failed: ${(err as Error).message}`,
      };
    }
  }

  private abortWithBudget(step: number, reason: string): AgentRunSummary {
    this.logEvent(step, 'error', `Agent aborted due to budget cap: ${reason}`);
    return {
      runId: this.runId,
      status: 'aborted_budget',
      totalSteps: step,
      budgetSummary: this.telemetry.getSummary(),
      history: this.events,
      finalResponse: `Execution halted by spending cap: ${reason}`,
    };
  }

  private logEvent(step: number, phase: AgentEvent['phase'], summary: string, details?: Record<string, unknown>): void {
    this.events.push({
      step,
      phase,
      timestamp: new Date().toISOString(),
      summary,
      details,
    });
  }
}

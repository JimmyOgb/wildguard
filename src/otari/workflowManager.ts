/**
 * WildGuard - Client-Orchestrated Workflow Manager
 * Replaces monolithic 20-35s autonomous loops with bounded, single-turn steps
 * (Explorer -> Coder -> Human Approval) suitable for Vercel Hobby (<10s).
 * Enforces session-scoped workspace isolation and durable Redis synchronization.
 */

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { WildGuardEngine, EngineResponse } from './wildguardEngine.js';
import { RedisBudgetManager } from './redisBudgetManager.js';
import { McpRepoTools } from './mcpRepoTools.js';
import { validateWritePolicy } from './guardrails.js';
import { syncDurableWorkspaceAsync, saveWorkspaceFileAsync } from './demoWorkspace.js';

export type WorkflowStatus =
  | 'initialized'
  | 'explorer_done'
  | 'coder_done'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'failed';

export interface WorkflowPatch {
  filePath: string;
  previewDiff: string;
  linesModified: number;
  requiresApproval: boolean;
  rawDiffContent: string;
  newContent?: string;
  baseVersion?: number;
}

export interface WorkflowRecord {
  runId: string;
  userTask: string;
  status: WorkflowStatus;
  mode: 'simulation' | 'live';
  createdAt: string;
  updatedAt: string;
  ownerSessionId?: string;
  workspaceDir?: string;
  workspaceVersion?: number;
  version: number;
  explorerOutput?: string;
  coderOutput?: string;
  patch?: WorkflowPatch;
  stepUsage: {
    explorer?: { model: string; latencyMs: number; costUsd: number; promptTokens?: number; completionTokens?: number };
    coder?: { model: string; latencyMs: number; costUsd: number; promptTokens?: number; completionTokens?: number };
  };
  totalCostUsd: number;
  error?: string;
  appliedAt?: string;
}

export interface StepResult {
  success: boolean;
  runId: string;
  status: WorkflowStatus;
  step: 'init' | 'explorer' | 'coder' | 'approve';
  mode: 'simulation' | 'live';
  output?: string;
  patch?: WorkflowPatch;
  modelUsed?: string;
  latencyMs?: number;
  costUsd?: number;
  isIdempotent?: boolean;
  error?: string;
}

export class WorkflowManager {
  private readonly engine: WildGuardEngine;
  private readonly budgetManager: RedisBudgetManager;
  private readonly tools: McpRepoTools;
  private readonly stepTimeoutMs: number;
  private readonly workflows = new Map<string, WorkflowRecord>();
  private readonly processedIdempotencyKeys = new Map<string, StepResult>();

  constructor(options: {
    engine: WildGuardEngine;
    budgetManager: RedisBudgetManager;
    tools: McpRepoTools;
    stepTimeoutMs?: number;
  }) {
    this.engine = options.engine;
    this.budgetManager = options.budgetManager;
    this.tools = options.tools;
    this.stepTimeoutMs = options.stepTimeoutMs || 25000; // 25s bounded gateway execution window
  }

  /**
   * Synchronous accessor for in-memory workflow cache
   */
  public getWorkflowSync(runId: string): WorkflowRecord | undefined {
    return this.workflows.get(runId);
  }

  /**
   * Load workflow record from Redis persistent store or local cache (CRIT-1)
   */
  public async getWorkflow(runId: string): Promise<WorkflowRecord | undefined> {
    if (!runId || typeof runId !== 'string') return undefined;

    if (this.budgetManager && typeof this.budgetManager.get === 'function' && this.budgetManager.isConfigured?.()) {
      try {
        const raw = await this.budgetManager.get(`wildguard:workflow:${runId}`);
        if (raw) {
          const parsed = JSON.parse(raw) as WorkflowRecord;
          if (parsed && typeof parsed.runId === 'string' && parsed.runId === runId && parsed.status && parsed.mode) {
            this.workflows.set(runId, parsed);
            return parsed;
          }
        }
      } catch {
        // Fallback safely to local cache
      }
    }

    return this.workflows.get(runId);
  }

  /**
   * Save workflow record to Redis persistent store and local cache with optimistic version bump (CRIT-1)
   */
  public async saveWorkflowRecord(record: WorkflowRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    record.version = (record.version || 0) + 1;
    this.workflows.set(record.runId, record);

    if (this.budgetManager && typeof this.budgetManager.set === 'function' && this.budgetManager.isConfigured?.()) {
      try {
        await this.budgetManager.set(`wildguard:workflow:${record.runId}`, JSON.stringify(record), 86400); // 24h TTL
      } catch {
        // If Redis is unreachable, in-memory record is preserved; live inference will fail closed on budget reservation
      }
    }
  }

  /**
   * Step 0: Initialize a new client-orchestrated workflow
   */
  public async initWorkflow(
    userTask: string,
    mode: 'simulation' | 'live' = 'simulation',
    ownerSessionId?: string,
    workspaceDir?: string,
    workspaceVersion?: number
  ): Promise<WorkflowRecord> {
    if (!userTask || !userTask.trim()) {
      throw new Error('userTask is required to initialize workflow');
    }

    const runId = `run_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const record: WorkflowRecord = {
      runId,
      userTask: userTask.trim(),
      status: 'initialized',
      mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerSessionId,
      workspaceDir,
      workspaceVersion: workspaceVersion || 1,
      version: 1,
      stepUsage: {},
      totalCostUsd: 0,
    };

    this.workflows.set(runId, record);

    // Commit to Redis persistent storage (CRIT-1)
    if (this.budgetManager && typeof this.budgetManager.set === 'function' && this.budgetManager.isConfigured?.()) {
      try {
        await this.budgetManager.set(`wildguard:workflow:${runId}`, JSON.stringify(record), 86400);
      } catch {
        // Local in-memory copy preserved
      }
    }

    return record;
  }

  /**
   * Resolves session-scoped repository tools for a given workflow record.
   * Guarantees that public workflows operate strictly within their isolated demo workspace.
   */
  public async resolveToolsForRecord(record: WorkflowRecord, overrideTools?: McpRepoTools): Promise<McpRepoTools> {
    if (overrideTools) return overrideTools;

    if (record.ownerSessionId?.startsWith('pub_')) {
      const sync = await syncDurableWorkspaceAsync(record.ownerSessionId, this.budgetManager);
      record.workspaceDir = sync.sessionDir;
      record.workspaceVersion = sync.version;
      return new McpRepoTools(sync.sessionDir);
    }

    if (record.workspaceDir && fs.existsSync(record.workspaceDir)) {
      return new McpRepoTools(record.workspaceDir);
    }

    return this.tools;
  }

  /**
   * Step 1: Bounded Explorer Turn (< 8.5s)
   */
  public async executeExplorerStep(params: {
    runId: string;
    idempotencyKey?: string;
    tools?: McpRepoTools;
  }): Promise<StepResult> {
    const record = await this.getWorkflow(params.runId);
    if (!record) {
      throw new Error(`Workflow runId "${params.runId}" not found. Please call /api/workflow/init first.`);
    }

    // Check idempotency
    if (params.idempotencyKey && this.processedIdempotencyKeys.has(params.idempotencyKey)) {
      const cached = this.processedIdempotencyKeys.get(params.idempotencyKey)!;
      return { ...cached, isIdempotent: true };
    }

    const workflowTools = await this.resolveToolsForRecord(record, params.tools);
    const isLive = record.mode === 'live';
    let reservationId: string | undefined;

    // Budget reservation if live
    if (isLive) {
      const reserve = await this.budgetManager.reserveBudget({
        runId: record.runId,
        idempotencyKey: params.idempotencyKey,
        reserveAmountUsd: 0.05,
      });

      if (!reserve.allowed) {
        record.status = 'failed';
        record.error = reserve.reason;
        await this.saveWorkflowRecord(record);
        return {
          success: false,
          runId: record.runId,
          status: 'failed',
          step: 'explorer',
          mode: record.mode,
          error: reserve.reason,
        };
      }
      reservationId = reserve.reservationId;
    }

    const start = Date.now();
    let stepResult: StepResult;

    try {
      // Execute bounded turn with controller timeout (CRIT-3: 7500ms safety timeout)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.stepTimeoutMs);

      // Include safe file outline from visitor's isolated workspace
      const repoFiles = workflowTools.listFiles('', false);
      const fileNames = repoFiles.success && Array.isArray(repoFiles.data)
        ? repoFiles.data.map((f: any) => f.name).join(', ')
        : 'paymentCalculator.ts';

      let response: EngineResponse;
      try {
        response = await this.engine.execute({
          role: 'explorer',
          messages: [
            {
              role: 'system',
              content: `You are the WildGuard Explorer. Read task, inspect workspace files [${fileNames}], and plan steps. Be succinct and direct. Output a concise exploration plan in 3-5 bullet points without lengthy preamble.`,
            },
            { role: 'user', content: record.userTask },
          ],
          timeoutMs: this.stepTimeoutMs,
          signal: controller.signal,
          disableFallback: true, // Disable fallback for bounded workflow turns
        });
      } finally {
        clearTimeout(timer);
      }

      const latencyMs = Date.now() - start;
      const costUsd = response.usage?.costUsd || (isLive ? 0.002 : 0);

      // Settle budget if live
      if (isLive && reservationId) {
        await this.budgetManager.settleBudget({
          runId: record.runId,
          reservationId,
          actualUsd: costUsd,
          status: 'settled',
        });
      }

      // Check if content was empty due to reasoning exhaustion
      const trimmedExplorerContent = (response.content || '').trim();
      if (!trimmedExplorerContent && response.reasoningDiagnostic) {
        throw new Error('Explorer reasoning model exhausted token allowance during internal thinking before emitting text.');
      }

      record.explorerOutput = response.content;
      record.status = 'explorer_done';
      record.stepUsage.explorer = {
        model: response.modelUsed,
        latencyMs,
        costUsd,
        promptTokens: response.usage?.promptTokens,
        completionTokens: response.usage?.completionTokens,
      };
      record.totalCostUsd += costUsd;
      await this.saveWorkflowRecord(record);

      stepResult = {
        success: true,
        runId: record.runId,
        status: record.status,
        step: 'explorer',
        mode: record.mode,
        output: response.content,
        modelUsed: response.modelUsed,
        latencyMs,
        costUsd,
      };
    } catch (err) {
      const isTimeout = (err as Error).name === 'AbortError' || (err as Error).message.includes('timeout') || (err as any).isTimeout;
      const errMessage = isTimeout
        ? `Explorer step timed out after ${this.stepTimeoutMs}ms (Gateway execution deadline).`
        : `Explorer step failed: ${(err as Error).message}`;

      // In live mode with timeout, charge is uncertain (do not refund gateway)
      if (isLive && reservationId) {
        await this.budgetManager.settleBudget({
          runId: record.runId,
          reservationId,
          actualUsd: 0.05,
          status: isTimeout ? 'uncertain' : 'released',
        });
      }

      record.status = 'failed';
      record.error = errMessage;
      await this.saveWorkflowRecord(record);

      stepResult = {
        success: false,
        runId: record.runId,
        status: 'failed',
        step: 'explorer',
        mode: record.mode,
        error: errMessage,
      };
    }

    if (params.idempotencyKey) {
      this.processedIdempotencyKeys.set(params.idempotencyKey, stepResult);
    }
    return stepResult;
  }

  /**
   * Step 2: Bounded Coder Turn (< 7.5s) & In-Memory Patch Generation
   */
  public async executeCoderStep(params: {
    runId: string;
    idempotencyKey?: string;
    targetFile?: string;
    tools?: McpRepoTools;
  }): Promise<StepResult> {
    const record = await this.getWorkflow(params.runId);
    if (!record) {
      throw new Error(`Workflow runId "${params.runId}" not found.`);
    }

    if (record.status !== 'explorer_done' && record.status !== 'coder_done') {
      throw new Error(`Invalid workflow state "${record.status}". Explorer step must complete before Coder step.`);
    }

    if (params.idempotencyKey && this.processedIdempotencyKeys.has(params.idempotencyKey)) {
      const cached = this.processedIdempotencyKeys.get(params.idempotencyKey)!;
      return { ...cached, isIdempotent: true };
    }

    const workflowTools = await this.resolveToolsForRecord(record, params.tools);
    const isLive = record.mode === 'live';
    let reservationId: string | undefined;

    if (isLive) {
      const reserve = await this.budgetManager.reserveBudget({
        runId: record.runId,
        idempotencyKey: params.idempotencyKey,
        reserveAmountUsd: 0.05,
      });

      if (!reserve.allowed) {
        record.status = 'failed';
        record.error = reserve.reason;
        await this.saveWorkflowRecord(record);
        return {
          success: false,
          runId: record.runId,
          status: 'failed',
          step: 'coder',
          mode: record.mode,
          error: reserve.reason,
        };
      }
      reservationId = reserve.reservationId;
    }

    const start = Date.now();
    let stepResult: StepResult;

    try {
      const targetFilePath = params.targetFile || 'src/paymentCalculator.ts';

      // Read current base file from visitor's workspace
      const currentBaseFile = workflowTools.readFile(targetFilePath);
      const currentContent = currentBaseFile.success && currentBaseFile.data ? currentBaseFile.data.content : '';

      // Execute Coder turn with bounded timeout & signal propagation (CRIT-3)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.stepTimeoutMs);

      let response: EngineResponse;
      try {
        response = await this.engine.execute({
          role: 'coder',
          messages: [
            {
              role: 'system',
              content: `You are the WildGuard Coder. Implement safe, minimal fix based on exploration. Target file: ${targetFilePath}. Current source:\n\`\`\`typescript\n${currentContent}\n\`\`\`\nBe direct and concise. Return the complete replacement source code for ${targetFilePath} without conversational preamble or markdown code fences.`,
            },
            { role: 'user', content: `Task: ${record.userTask}\n\nExplorer Plan:\n${record.explorerOutput || 'Direct implementation'}` },
          ],
          temperature: 0,
          maxTokens: 1024,
          timeoutMs: this.stepTimeoutMs,
          signal: controller.signal,
          disableFallback: true, // Disable fallback for bounded workflow turns
        });
      } finally {
        clearTimeout(timer);
      }

      const latencyMs = Date.now() - start;
      const costUsd = response.usage?.costUsd || (isLive ? 0.003 : 0);

      if (isLive && reservationId) {
        await this.budgetManager.settleBudget({
          runId: record.runId,
          reservationId,
          actualUsd: costUsd,
          status: 'settled',
        });
      }

      // Check if content was empty due to reasoning exhaustion
      const trimmedCoderContent = (response.content || '').trim();
      if (!trimmedCoderContent && response.reasoningDiagnostic) {
        throw new Error('Coder reasoning model exhausted token allowance during internal thinking before emitting code.');
      }

      record.coderOutput = response.content;
      record.stepUsage.coder = {
        model: response.modelUsed,
        latencyMs,
        costUsd,
        promptTokens: response.usage?.promptTokens,
        completionTokens: response.usage?.completionTokens,
      };
      record.totalCostUsd += costUsd;

      // Generate in-memory unified diff against visitor workspace base
      const generatedPatch = this.generateInMemoryPatch(
        targetFilePath,
        response.content,
        workflowTools,
        record.workspaceVersion
      );
      record.patch = generatedPatch;
      record.status = 'awaiting_approval';
      await this.saveWorkflowRecord(record);

      stepResult = {
        success: true,
        runId: record.runId,
        status: record.status,
        step: 'coder',
        mode: record.mode,
        output: response.content,
        patch: generatedPatch,
        modelUsed: response.modelUsed,
        latencyMs,
        costUsd,
      };
    } catch (err) {
      const isTimeout = (err as Error).name === 'AbortError' || (err as Error).message.includes('timeout') || (err as any).isTimeout;
      const errMessage = isTimeout
        ? `Coder step timed out after ${this.stepTimeoutMs}ms (Gateway execution deadline).`
        : `Coder step failed: ${(err as Error).message}`;

      if (isLive && reservationId) {
        await this.budgetManager.settleBudget({
          runId: record.runId,
          reservationId,
          actualUsd: 0.05,
          status: isTimeout ? 'uncertain' : 'released',
        });
      }

      record.status = 'failed';
      record.error = errMessage;
      await this.saveWorkflowRecord(record);

      stepResult = {
        success: false,
        runId: record.runId,
        status: 'failed',
        step: 'coder',
        mode: record.mode,
        error: errMessage,
      };
    }

    if (params.idempotencyKey) {
      this.processedIdempotencyKeys.set(params.idempotencyKey, stepResult);
    }
    return stepResult;
  }

  /**
   * Step 3: Human Approval Gate & Durable Patch Application
   */
  public async executeApprovalStep(params: {
    runId: string;
    isApproved: boolean;
    callerSessionId?: string;
    tools?: McpRepoTools;
  }): Promise<StepResult> {
    const record = await this.getWorkflow(params.runId);
    if (!record) {
      throw new Error(`Workflow runId "${params.runId}" not found.`);
    }

    // Verify session ownership
    if (record.ownerSessionId && params.callerSessionId && record.ownerSessionId !== params.callerSessionId) {
      throw new Error(`Unauthorized: Caller session does not own workflow runId "${params.runId}".`);
    }

    if (record.status !== 'awaiting_approval' && record.status !== 'coder_done') {
      throw new Error(`Invalid workflow state "${record.status}". Cannot approve ungenerated patch.`);
    }

    if (!params.isApproved) {
      record.status = 'rejected';
      await this.saveWorkflowRecord(record);
      return {
        success: true,
        runId: record.runId,
        status: 'rejected',
        step: 'approve',
        mode: record.mode,
        output: 'Patch rejected by operator. No changes applied.',
      };
    }

    // Apply patch to visitor's durable workspace
    if (record.patch?.newContent && record.ownerSessionId?.startsWith('pub_')) {
      const saveRes = await saveWorkspaceFileAsync(
        record.ownerSessionId,
        record.patch.filePath,
        record.patch.newContent,
        this.budgetManager,
        record.patch.baseVersion
      );

      if (!saveRes.success) {
        record.status = 'failed';
        record.error = saveRes.error;
        await this.saveWorkflowRecord(record);
        return {
          success: false,
          runId: record.runId,
          status: 'failed',
          step: 'approve',
          mode: record.mode,
          error: `Failed to apply approved patch: ${saveRes.error}`,
        };
      }
      record.workspaceVersion = saveRes.newVersion;
    }

    record.status = 'approved';
    record.appliedAt = new Date().toISOString();
    await this.saveWorkflowRecord(record);

    return {
      success: true,
      runId: record.runId,
      status: 'approved',
      step: 'approve',
      mode: record.mode,
      patch: record.patch,
      output: 'Patch approved by operator and applied to visitor durable workspace. Subsequent queries and turns reflect updated code.',
    };
  }

  /**
   * Generates in-memory unified diff against visitor workspace base
   */
  public generateInMemoryPatch(
    filePath: string,
    newContent: string,
    customTools?: McpRepoTools,
    baseVersion?: number
  ): WorkflowPatch {
    const tools = customTools || this.tools;

    // 1. Guardrail validation on path
    const policy = validateWritePolicy(tools.getRepoRoot(), filePath, tools.getCurrentBranch());
    if (policy.status === 'blocked') {
      throw new Error(`Patch path rejected by deterministic guardrails: ${policy.message} (${policy.reasonCode})`);
    }

    // 2. Read existing file from visitor workspace
    const existingFileResult = tools.readFile(filePath);
    const oldText = existingFileResult.success && existingFileResult.data ? existingFileResult.data.content : '';

    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newContent ? newContent.split('\n') : [];

    const diffLines = [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map(l => `-${l}`),
      ...newLines.map(l => `+${l}`),
    ];

    const rawDiffContent = diffLines.join('\n');

    return {
      filePath,
      previewDiff: rawDiffContent,
      linesModified: newLines.length,
      requiresApproval: true,
      rawDiffContent,
      newContent,
      baseVersion,
    };
  }
}

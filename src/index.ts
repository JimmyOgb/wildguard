/**
 * WildGuard - Open, Policy-Aware Coding Agent and Observability Engine
 * Core exports for Otari gateway integration.
 */

export * from './otari/config.js';
export * from './otari/guardrails.js';
export * from './otari/mcpRepoTools.js';
export * from './otari/telemetry.js';
export * from './otari/decisionGate.js';
export * from './otari/wildguardEngine.js';
export * from './otari/agentLoop.js';
export * from './web/server.js';

import { loadConfig } from './otari/config.js';
import { McpRepoTools } from './otari/mcpRepoTools.js';
import { TelemetryManager } from './otari/telemetry.js';
import { DecisionGate } from './otari/decisionGate.js';
import { WildGuardEngine } from './otari/wildguardEngine.js';
import { AgentLoop } from './otari/agentLoop.js';

/**
 * Convenience factory to create a fully wired WildGuard agent instance.
 */
export function createWildGuardAgent(repoRoot: string, options?: { runId?: string; env?: Record<string, string | undefined> }) {
  const config = loadConfig(options?.env);
  const runId = options?.runId || `run_${Date.now()}`;
  const telemetry = new TelemetryManager(runId, config.mode, config.maxRunCostUsd);
  const tools = new McpRepoTools(repoRoot);
  const decisionGate = new DecisionGate(config.baseUrl, config.apiKey, config.mode === 'live');
  const engine = new WildGuardEngine(config, telemetry);
  const loop = new AgentLoop(engine, tools, decisionGate, telemetry);

  return {
    config,
    telemetry,
    tools,
    decisionGate,
    engine,
    loop,
  };
}

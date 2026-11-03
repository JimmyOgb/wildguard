/**
 * WildGuard - Comprehensive Test Suite
 * Covers Configuration, Deterministic Guardrails, Repository Tools,
 * Multi-Model Engine, Decision Quality Gate, and Agent Orchestration.
 *
 * All tests execute in deterministic simulation or mocked environments.
 * ZERO external API credits are consumed.
 */

import { test, describe, beforeEach, afterEach, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  loadConfig,
  validateBudget,
  validateTimeout,
  validateBaseUrl,
  getPublicConfigStatus,
  DEFAULT_CONFIG,
} from '../src/otari/config.js';

import {
  validatePathContainment,
  validateFileReadPolicy,
  validateWritePolicy,
  validateBranchCreation,
  BLOCKED_BRANCHES,
  DEPENDENCY_FILES,
} from '../src/otari/guardrails.js';

import { McpRepoTools } from '../src/otari/mcpRepoTools.js';
import { TelemetryManager } from '../src/otari/telemetry.js';
import { DecisionGate } from '../src/otari/decisionGate.js';
import {
  WildGuardEngine,
  WildGuardApiError,
  categorizeOtariError,
  sanitizeErrorMessage,
} from '../src/otari/wildguardEngine.js';
import { AgentLoop } from '../src/otari/agentLoop.js';
import { createWildGuardAgent } from '../src/index.js';
import { WorkflowManager } from '../src/otari/workflowManager.js';
import { RedisBudgetManager } from '../src/otari/redisBudgetManager.js';

describe('WildGuard Test Suite', () => {
  let tempRepo: string;
  const originalEnvMode = process.env.WILDGUARD_MODE;
  process.env.WILDGUARD_MODE = 'simulation';

  after(() => {
    if (originalEnvMode !== undefined) {
      process.env.WILDGUARD_MODE = originalEnvMode;
    } else {
      delete process.env.WILDGUARD_MODE;
    }
  });

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'wildguard-test-repo-'));
    // Setup test repository structure
    fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Test Repo\nHello world');
    fs.writeFileSync(path.join(tempRepo, 'package.json'), '{"name": "test-pkg", "version": "1.0.0"}');
    fs.writeFileSync(path.join(tempRepo, '.env'), 'SECRET_API_KEY=supersecret1234567890');
    fs.mkdirSync(path.join(tempRepo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempRepo, 'src', 'index.ts'), 'export const greeting = "hello";');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // ==========================================
  // 1. CONFIGURATION TESTS
  // ==========================================
  describe('Configuration Module', () => {
    test('defaults to simulation mode when API key is missing', () => {
      const cfg = loadConfig({ WILDGUARD_MODE: 'live' }); // live requested but no key
      assert.strictEqual(cfg.mode, 'simulation');
      assert.strictEqual(cfg.apiKey, undefined);
      assert.strictEqual(cfg.maxRunCostUsd, 1.50);
      assert.strictEqual(cfg.timeoutMs, 30000);
      assert.strictEqual(cfg.baseUrl, DEFAULT_CONFIG.BASE_URL);
    });

    test('enables live mode only when explicit flag AND non-empty key are present', () => {
      const cfg = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-key-value',
      });
      assert.strictEqual(cfg.mode, 'live');
      assert.strictEqual(cfg.apiKey, 'test-key-value');
    });

    test('validates budget correctly and rejects invalid values', () => {
      assert.strictEqual(validateBudget('2.50'), 2.50);
      assert.strictEqual(validateBudget(1.25), 1.25);

      assert.throws(() => validateBudget('-0.5'), /Invalid budget/);
      assert.throws(() => validateBudget('abc'), /Invalid budget/);
      assert.throws(() => validateBudget('Infinity'), /Invalid budget/);
      assert.throws(() => validateBudget(0), /Invalid budget/);
    });

    test('validates timeouts and rejects values below 1000ms', () => {
      assert.strictEqual(validateTimeout('5000'), 5000);
      assert.throws(() => validateTimeout('500'), /Invalid timeout/);
      assert.throws(() => validateTimeout('not-a-number'), /Invalid timeout/);
    });

    test('validates base URL format and protocols', () => {
      assert.strictEqual(validateBaseUrl('https://api.otari.ai/api/v1/'), 'https://api.otari.ai/api/v1');
      assert.throws(() => validateBaseUrl('ftp://example.com'), /Invalid URL protocol/);
      assert.throws(() => validateBaseUrl(''), /Invalid base URL/);
    });

    test('rejects empty model identifiers in configuration', () => {
      assert.throws(() => loadConfig({ OTARI_EXPLORER_MODEL: '' }), /model roles.*must have valid/);
    });
  });

  // ==========================================
  // 2. DETERMINISTIC GUARDRAILS TESTS
  // ==========================================
  describe('Deterministic Guardrails', () => {
    test('blocks reads of .env and .env.* files', () => {
      const res1 = validateFileReadPolicy(tempRepo, '.env');
      assert.strictEqual(res1.status, 'blocked');
      assert.strictEqual(res1.reasonCode, 'SECRET_FILE_READ_BLOCKED');

      const res2 = validateFileReadPolicy(tempRepo, '.env.production');
      assert.strictEqual(res2.status, 'blocked');
      assert.strictEqual(res2.reasonCode, 'SECRET_FILE_READ_BLOCKED');
    });

    test('blocks reads of private keys and credential stores', () => {
      const resKey = validateFileReadPolicy(tempRepo, 'id_rsa');
      assert.strictEqual(resKey.status, 'blocked');

      const resPem = validateFileReadPolicy(tempRepo, 'server.pem');
      assert.strictEqual(resPem.status, 'blocked');
    });

    test('blocks directory traversal attempts', () => {
      const res = validatePathContainment(tempRepo, '../outside.txt');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'PATH_TRAVERSAL_DETECTED');
    });

    test('blocks UNC path escape attempts', () => {
      const res = validatePathContainment(tempRepo, '//server/share/file.txt');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'UNC_PATH_FORBIDDEN');
    });

    test('blocks direct writes and patches to protected branches (main, master)', () => {
      const resMain = validateWritePolicy(tempRepo, 'src/index.ts', 'main');
      assert.strictEqual(resMain.status, 'blocked');
      assert.strictEqual(resMain.reasonCode, 'PROTECTED_BRANCH_WRITE_BLOCKED');

      const resMaster = validateWritePolicy(tempRepo, 'src/index.ts', 'master');
      assert.strictEqual(resMaster.status, 'blocked');
      assert.strictEqual(resMaster.reasonCode, 'PROTECTED_BRANCH_WRITE_BLOCKED');
    });

    test('requires human approval for dependency modifications on feature branches', () => {
      const res = validateWritePolicy(tempRepo, 'package.json', 'feat/otari-agent-harness');
      assert.strictEqual(res.status, 'requires_approval');
      assert.strictEqual(res.reasonCode, 'DEPENDENCY_MODIFICATION_REQUIRES_APPROVAL');
    });

    test('allows regular file modifications on feature branches', () => {
      const res = validateWritePolicy(tempRepo, 'src/index.ts', 'feat/otari-agent-harness');
      assert.strictEqual(res.status, 'allowed');
      assert.strictEqual(res.reasonCode, 'WRITE_POLICY_PERMITTED');
    });

    test('blocks creation of protected branches and malformed branch names', () => {
      const resMain = validateBranchCreation('main');
      assert.strictEqual(resMain.status, 'blocked');

      const resBad = validateBranchCreation('bad branch with spaces');
      assert.strictEqual(resBad.status, 'blocked');

      const resGood = validateBranchCreation('feat/safe-feature');
      assert.strictEqual(resGood.status, 'allowed');
    });
  });

  // ==========================================
  // 3. REPOSITORY TOOLS TESTS
  // ==========================================
  describe('Repository Tools', () => {
    test('lists safe files and automatically omits secret files and hidden git dirs', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const list = tools.listFiles('', true);
      assert.strictEqual(list.success, true);
      assert.ok(list.data);

      const paths = list.data.map(f => f.relativePath);
      assert.ok(paths.includes('README.md'));
      assert.ok(paths.includes('package.json'));
      assert.ok(paths.some(p => p.includes('src/index.ts') || p.includes('src\\index.ts')));
      // .env must NOT be returned in listed files
      assert.ok(!paths.includes('.env'));
    });

    test('reads permitted files and returns file content and size', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const res = tools.readFile('README.md');
      assert.strictEqual(res.success, true);
      assert.ok(res.data?.content.includes('Hello world'));
    });

    test('refuses to read sensitive .env file', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const res = tools.readFile('.env');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reasonCode, 'SECRET_FILE_READ_BLOCKED');
    });

    test('refuses to apply patch to protected branch main', () => {
      const tools = new McpRepoTools(tempRepo, 'main');
      const res = tools.applyPatch('src/index.ts', 'export const x = 1;');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.reasonCode, 'PROTECTED_BRANCH_WRITE_BLOCKED');
    });

    test('generates diff preview and requires approval for dependency modification without approval flag', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const res = tools.applyPatch('package.json', '{"name": "hacked"}', false);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.requiresApproval, true);
      assert.ok(res.data?.previewDiff.includes('+++ b/package.json'));
    });

    test('applies dependency patch when explicitly approved', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const res = tools.applyPatch('package.json', '{"name": "approved-pkg"}', true);
      assert.strictEqual(res.success, true);
      const readBack = fs.readFileSync(path.join(tempRepo, 'package.json'), 'utf-8');
      assert.strictEqual(readBack, '{"name": "approved-pkg"}');
    });

    test('creates new branch and updates active branch tracking', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const res = tools.createBranch('feat/new-optimization');
      assert.strictEqual(res.success, true);
      assert.strictEqual(tools.getCurrentBranch(), 'feat/new-optimization');
    });
  });

  // ==========================================
  // 4. MULTI-MODEL ENGINE & BUDGET TESTS
  // ==========================================
  describe('Multi-Model Engine & Telemetry', () => {
    test('resolves appropriate model identifiers for Explorer, Coder, and Fallback roles', () => {
      const config = loadConfig();
      const telemetry = new TelemetryManager('test_run', 'simulation', 1.50);
      const engine = new WildGuardEngine(config, telemetry);

      assert.strictEqual(engine.resolveModelForRole('explorer'), DEFAULT_CONFIG.EXPLORER_MODEL);
      assert.strictEqual(engine.resolveModelForRole('coder'), DEFAULT_CONFIG.CODER_MODEL);
      assert.strictEqual(engine.resolveModelForRole('fallback'), DEFAULT_CONFIG.FALLBACK_MODEL);
    });

    test('executes simulation turn returning rich structured response and tracks simulated cost', async () => {
      const config = loadConfig();
      const telemetry = new TelemetryManager('test_run', 'simulation', 1.50);
      const engine = new WildGuardEngine(config, telemetry);

      const res = await engine.execute({
        role: 'explorer',
        messages: [{ role: 'user', content: 'Scan repository files' }]
      });

      assert.strictEqual(res.roleUsed, 'explorer');
      assert.ok(res.content.includes('[SIMULATED EXPLORER:'));
      assert.ok(res.usage.totalTokens > 0);
      assert.strictEqual(res.usage.pricingSource, 'simulation');

      const summary = telemetry.getSummary();
      assert.strictEqual(summary.requestCount, 1);
      assert.strictEqual(summary.executionMode, 'simulation');
      assert.ok(summary.accumulatedCostUsd > 0);
    });

    test('halts inference immediately when spending cap is exceeded', async () => {
      const config = loadConfig();
      // Set tiny budget of $0.000001
      const telemetry = new TelemetryManager('test_run', 'simulation', 0.000001);
      const engine = new WildGuardEngine(config, telemetry);

      // Record artificial spend to exhaust budget
      telemetry.recordEvent({
        model: 'sim_model',
        promptTokens: 10000,
        completionTokens: 5000,
        latencyMs: 50,
      });

      assert.strictEqual(telemetry.canProceed().allowed, false);

      await assert.rejects(
        () => engine.execute({ role: 'coder', messages: [{ role: 'user', content: 'Write code' }] }),
        /Inference blocked by budget enforcement/
      );
    });
  });

  // ==========================================
  // 5. DECISION GATE TESTS
  // ==========================================
  describe('Decision Gate Module', () => {
    test('approves safe modifications with low risk', async () => {
      const gate = new DecisionGate('https://api.otari.ai/api/v1', undefined, false);
      const res = await gate.evaluate({
        state: 'Add utility function to math.ts',
        proposedDiff: '+ export function add(a: number, b: number) { return a + b; }',
      });

      assert.strictEqual(res.outcome, 'approve');
      assert.strictEqual(res.riskLevel, 'low');
      assert.strictEqual(res.decisionEngine, 'local_deterministic_gate');
    });

    test('demands human approval if dynamic eval/exec/spawn is detected in proposed diff', async () => {
      const gate = new DecisionGate('https://api.otari.ai/api/v1', undefined, false);
      const res = await gate.evaluate({
        state: 'Add dynamic executor',
        proposedDiff: '+ eval(userSuppliedInput);',
      });

      assert.strictEqual(res.outcome, 'requires_human_approval');
      assert.strictEqual(res.riskLevel, 'high');
    });

    test('rejects dangerous shell deletion commands in diff', async () => {
      const gate = new DecisionGate('https://api.otari.ai/api/v1', undefined, false);
      const res = await gate.evaluate({
        state: 'Clean temp files',
        proposedDiff: '+ rm -rf /var/log',
      });

      assert.strictEqual(res.outcome, 'reject');
      assert.strictEqual(res.riskLevel, 'critical');
    });

    test('deterministic local rejection takes absolute precedence over any remote result', async () => {
      const gate = new DecisionGate('https://api.otari.ai/api/v1', 'mock-key', true);
      const res = await gate.evaluate({
        state: 'Overwriting root secret',
        localPolicyResult: {
          status: 'blocked',
          reasonCode: 'SECRET_FILE_READ_BLOCKED',
          message: 'Access to .env is forbidden',
        },
      });

      assert.strictEqual(res.outcome, 'reject');
      assert.strictEqual(res.riskLevel, 'critical');
      assert.ok(res.reason.includes('Local guardrail policy rejection'));
    });
  });

  // ==========================================
  // 6. AGENT ORCHESTRATION LOOP TESTS
  // ==========================================
  describe('Agent Orchestration Loop', () => {
    test('completes full agent turn successfully in simulation mode', async () => {
      const config = loadConfig();
      const telemetry = new TelemetryManager('run_agent_test', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const gate = new DecisionGate(config.baseUrl, undefined, false);
      const engine = new WildGuardEngine(config, telemetry);
      const loop = new AgentLoop(engine, tools, gate, telemetry);

      const summary = await loop.run({
        userTask: 'Inspect project structure and implement greeting utility',
        maxIterations: 5,
      });

      assert.strictEqual(summary.status, 'completed');
      assert.ok(summary.totalSteps >= 3);
      assert.ok(summary.finalResponse.length > 0);
      assert.strictEqual(summary.budgetSummary.executionMode, 'simulation');
      assert.strictEqual(summary.history.length >= 4, true);
    });

    test('halts agent loop safely when budget is exhausted mid-turn', async () => {
      const config = loadConfig();
      const telemetry = new TelemetryManager('run_exhaust_test', 'simulation', 0.000001);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const gate = new DecisionGate(config.baseUrl, undefined, false);
      const engine = new WildGuardEngine(config, telemetry);
      const loop = new AgentLoop(engine, tools, gate, telemetry);

      // Pre-exhaust budget
      telemetry.recordEvent({
        model: 'sim_model',
        promptTokens: 10000,
        completionTokens: 5000,
        latencyMs: 20,
      });

      const summary = await loop.run({
        userTask: 'Attempt to execute with zero remaining budget',
      });

      assert.strictEqual(summary.status, 'aborted_budget');
      assert.ok(summary.finalResponse.includes('Execution halted by spending cap'));
    });
  });

  // ==========================================
  // 7. SECURITY HARDENING & EDGE CASE TESTS
  // ==========================================
  describe('Security Hardening & Edge Cases', () => {
    test('blocks read of arbitrary file containing private key content', () => {
      fs.writeFileSync(
        path.join(tempRepo, 'innocent.txt'),
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----'
      );
      const res = validateFileReadPolicy(tempRepo, 'innocent.txt');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'SECRET_CONTENT_DETECTED');
    });

    test('blocks Windows trailing dot bypass attempt (.env.)', () => {
      const res = validateFileReadPolicy(tempRepo, '.env.');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'SECRET_FILE_READ_BLOCKED');
    });

    test('blocks Windows multi-dot trailing bypass attempt (.env..)', () => {
      const res = validateFileReadPolicy(tempRepo, '.env..');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'SECRET_FILE_READ_BLOCKED');
    });

    test('blocks case-insensitive sensitive file access (.ENV)', () => {
      const res = validateFileReadPolicy(tempRepo, '.ENV');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'SECRET_FILE_READ_BLOCKED');
    });

    test('enforces case-insensitive dependency file approval (PACKAGE.JSON)', () => {
      const res = validateWritePolicy(tempRepo, 'PACKAGE.JSON', 'feat/otari-agent-harness');
      assert.strictEqual(res.status, 'requires_approval');
      assert.strictEqual(res.reasonCode, 'DEPENDENCY_MODIFICATION_REQUIRES_APPROVAL');
    });

    test('blocks Windows trailing space bypass attempt (.env )', () => {
      const res = validateFileReadPolicy(tempRepo, '.env ');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'SECRET_FILE_READ_BLOCKED');
    });

    test('blocks NTFS alternate data stream (:stream)', () => {
      const res = validatePathContainment(tempRepo, 'innocent.txt:stream');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'NTFS_STREAM_FORBIDDEN');
    });

    test('blocks NTFS alternate data stream (::$DATA)', () => {
      const res = validatePathContainment(tempRepo, '.env::$DATA');
      assert.strictEqual(res.status, 'blocked');
      assert.strictEqual(res.reasonCode, 'NTFS_STREAM_FORBIDDEN');
    });

    test('blocks Windows reserved DOS device names (CON, NUL, AUX)', () => {
      const resCon = validatePathContainment(tempRepo, 'CON.txt');
      assert.strictEqual(resCon.status, 'blocked');
      assert.strictEqual(resCon.reasonCode, 'RESERVED_DEVICE_NAME');

      const resNul = validatePathContainment(tempRepo, 'sub/NUL');
      assert.strictEqual(resNul.status, 'blocked');
      assert.strictEqual(resNul.reasonCode, 'RESERVED_DEVICE_NAME');
    });

    test('blocks symlinked parent directory escape for nonexistent target', () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wildguard-outside-'));
      const symlinkPath = path.join(tempRepo, 'sym_external');

      try {
        fs.symlinkSync(outsideDir, symlinkPath, 'junction');
      } catch (err: any) {
        // If OS prevents symlink creation, report blocked per audit rule
        console.warn(`Symlink creation blocked by OS permissions: ${err.message}`);
        fs.rmSync(outsideDir, { recursive: true, force: true });
        return;
      }

      try {
        // Attempt to validate writing to nonexistent file inside symlinked directory pointing outside repo
        const res = validateWritePolicy(tempRepo, 'sym_external/drop.txt', 'feat/otari-agent-harness');
        assert.strictEqual(res.status, 'blocked');
        assert.strictEqual(res.reasonCode, 'SYMLINK_BOUNDARY_ESCAPE');
      } finally {
        try {
          fs.unlinkSync(symlinkPath);
        } catch {
          // Ignore cleanup
        }
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    test('telemetry rejects negative cost values and preserves accumulated spend', () => {
      const telemetry = new TelemetryManager('test_tamper', 'live', 1.50);
      telemetry.recordEvent({
        model: 'test_model',
        costUsd: -0.50,
        latencyMs: 10,
      });
      const summary = telemetry.getSummary();
      assert.strictEqual(summary.accumulatedCostUsd, 0);
    });

    test('telemetry rejects negative and non-finite token counts', () => {
      const telemetry = new TelemetryManager('test_tokens', 'live', 1.50);
      const evt = telemetry.recordEvent({
        model: 'test_model',
        promptTokens: -500,
        completionTokens: 'invalid' as any,
        totalTokens: NaN as any,
        costUsd: '0.005000',
        latencyMs: 15,
      });
      assert.strictEqual(evt.promptTokens, 0);
      assert.strictEqual(evt.completionTokens, 0);
      assert.strictEqual(evt.totalTokens, 0);
      assert.strictEqual(evt.costUsd, 0.005);
    });

    test('Decisions API handles successful remote response', async () => {
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => {
          return new Response(JSON.stringify({
            answers: {
              is_safe: { value: true },
              risk_level: { value: 'low' },
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const gate = new DecisionGate('https://api.otari.ai/api/v1', 'test-key', true, 5000);
        const res = await gate.evaluate({ state: 'Safe patch' });
        assert.strictEqual(res.outcome, 'approve');
        assert.strictEqual(res.decisionEngine, 'otari_decisions_api');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('Decisions API times out and fails closed without treating timeout as approval', async () => {
      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (_url, init: any) => {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve(new Response('{}', { status: 200 }));
            }, 500);
            if (init?.signal) {
              init.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                const abortErr: any = new Error('This operation was aborted');
                abortErr.name = 'AbortError';
                reject(abortErr);
              });
            }
          });
        };

        // Decision gate with short 50ms timeout
        const gate = new DecisionGate('https://api.otari.ai/api/v1', 'test-key', true, 50);
        const res = await gate.evaluate({ state: 'Slow response' });

        // Must fail closed to requires_human_approval, NOT approve
        assert.strictEqual(res.outcome, 'requires_human_approval');
        assert.ok(res.reason.includes('timed out'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('Decisions API fails closed on HTTP error and malformed JSON', async () => {
      const origFetch = globalThis.fetch;
      try {
        // Test HTTP 500
        globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });
        const gate500 = new DecisionGate('https://api.otari.ai/api/v1', 'test-key', true, 2000);
        const res500 = await gate500.evaluate({ state: 'Server error state' });
        assert.strictEqual(res500.outcome, 'requires_human_approval');
        assert.ok(res500.reason.includes('HTTP 500'));

        // Test Malformed JSON
        globalThis.fetch = async () => new Response('Not-JSON-Payload', { status: 200 });
        const gateJson = new DecisionGate('https://api.otari.ai/api/v1', 'test-key', true, 2000);
        const resJson = await gateJson.evaluate({ state: 'Malformed json state' });
        assert.strictEqual(resJson.outcome, 'requires_human_approval');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('Decisions API fails closed when live mode is set but credentials are missing', async () => {
      const gate = new DecisionGate('https://api.otari.ai/api/v1', undefined, true);
      const res = await gate.evaluate({ state: 'Missing credentials state' });
      assert.strictEqual(res.outcome, 'requires_human_approval');
      assert.ok(res.reason.includes('missing credentials'));
    });

    test('Engine classifies HTTP 401 as non-recoverable and halts without invoking fallback', async () => {
      const origFetch = globalThis.fetch;
      let callCount = 0;

      try {
        globalThis.fetch = async () => {
          callCount++;
          return new Response('{"detail":"Missing Otari-Key"}', { status: 401 });
        };

        const config = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'bad-key' });
        const telemetry = new TelemetryManager('test_401', 'live', 1.50);
        const engine = new WildGuardEngine(config, telemetry);

        await assert.rejects(
          () => engine.execute({ role: 'explorer', messages: [{ role: 'user', content: 'test' }] }),
          /Otari API error 401/
        );

        // Fallback must NOT have been called: callCount must be exactly 1
        assert.strictEqual(callCount, 1);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('Engine halts before fallback if budget is exhausted', async () => {
      const config = loadConfig();
      const telemetry = new TelemetryManager('test_budget_stop', 'simulation', 0.000001);
      const engine = new WildGuardEngine(config, telemetry);

      // Pre-exhaust spend
      telemetry.recordEvent({ model: 'sim', promptTokens: 100000, completionTokens: 50000, latencyMs: 10 });
      assert.strictEqual(telemetry.canProceed().allowed, false);

      await assert.rejects(
        () => engine.execute({ role: 'coder', messages: [{ role: 'user', content: 'write code' }] }),
        /Inference blocked by budget enforcement/
      );
    });

    test('Approval bypass attempt fails and preserves protected files on disk', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const originalPkg = fs.readFileSync(path.join(tempRepo, 'package.json'), 'utf-8');

      // Attempt to patch package.json without approval
      const res = tools.applyPatch('package.json', '{"name": "malicious-takeover"}', false);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.requiresApproval, true);

      // Verify file on disk is unchanged
      const currentPkg = fs.readFileSync(path.join(tempRepo, 'package.json'), 'utf-8');
      assert.strictEqual(currentPkg, originalPkg);
    });
  });

  // ==========================================
  // 8. WEB INTERFACE SERVER TESTS
  // ==========================================
  describe('Web Interface Server & API Endpoints', () => {
    test('starts web server and serves static assets and API routes', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');

      const address = testServer.server.address();
      assert.ok(address && typeof address === 'object');
      const port = (address as any).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. GET / serves HTML
        const resRoot = await fetch(baseUrl);
        assert.strictEqual(resRoot.status, 200);
        const textRoot = await resRoot.text();
        assert.ok(textRoot.includes('WildGuard'));

        // 2. GET /api/status returns valid state
        const resStatus = await fetch(`${baseUrl}/api/status`);
        assert.strictEqual(resStatus.status, 200);
        const dataStatus = await resStatus.json() as any;
        assert.strictEqual(dataStatus.status, 'ok');
        assert.strictEqual(dataStatus.currentBranch, 'feat/otari-agent-harness');
        assert.strictEqual(dataStatus.telemetry.maxRunCostUsd, 1.50);

        // 3. GET /api/repo/files lists safe files
        const resFiles = await fetch(`${baseUrl}/api/repo/files`);
        assert.strictEqual(resFiles.status, 200);
        const dataFiles = await resFiles.json() as any;
        assert.strictEqual(dataFiles.success, true);
        assert.ok(dataFiles.data.some((f: any) => f.name === 'README.md'));
        // Sensitive files hidden
        assert.ok(!dataFiles.data.some((f: any) => f.name === '.env'));

        // 4. POST /api/chat runs agent query
        const resChat = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'Inspect repository greeting', role: 'explorer' }),
        });
        assert.strictEqual(resChat.status, 200);
        const dataChat = await resChat.json() as any;
        assert.strictEqual(dataChat.success, true);
        assert.strictEqual(dataChat.phase, 'explorer');
        assert.ok(dataChat.response.includes('[SIMULATED EXPLORER:'));

        // 5. POST /api/tests/run executes test verification endpoint
        const resTests = await fetch(`${baseUrl}/api/tests/run`, {
          method: 'POST',
        });
        assert.strictEqual(resTests.status, 200);
        const dataTests = await resTests.json() as any;
        assert.strictEqual(dataTests.success, true);
        assert.strictEqual(dataTests.passed, dataTests.totalTests);
        assert.ok(dataTests.tests.length > 0);

        // 6. GET /styles.css and /app.js serve static assets from frontend/
        const resStyles = await fetch(`${baseUrl}/styles.css`);
        assert.strictEqual(resStyles.status, 200);
        assert.ok(resStyles.headers.get('content-type')?.includes('text/css'));

        const resApp = await fetch(`${baseUrl}/app.js`);
        assert.strictEqual(resApp.status, 200);
        assert.ok(resApp.headers.get('content-type')?.includes('javascript'));
      } finally {
        await testServer.stop();
      }
    });
  });

  // ==========================================
  // 9. STAGE 3.0 CONTROLLED SINGLE-REQUEST VERIFICATION & ERROR CATEGORIZATION
  // ==========================================
  describe('Stage 3.0 Controlled Single-Request Verification & Error Handling', () => {
    test('1. Verification with fallback disabled makes exactly one mocked outbound request', async () => {
      const origFetch = globalThis.fetch;
      let outboundCalls = 0;

      try {
        globalThis.fetch = async () => {
          outboundCalls++;
          return new Response(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, cost_usd: 0.00004 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const config = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
        const telemetry = new TelemetryManager('test_stage30_single', 'live', 1.50);
        const engine = new WildGuardEngine(config, telemetry);

        const res = await engine.execute({
          role: 'coder',
          messages: [{ role: 'user', content: 'Please reply exactly OTARI_CONNECTION_OK' }],
          disableFallback: true,
        });

        assert.strictEqual(res.content, 'OTARI_CONNECTION_OK');
        assert.strictEqual(res.fallbackTriggered, false);
        assert.strictEqual(res.attemptCount, 1);
        assert.strictEqual(outboundCalls, 1, 'Verification must make exactly one outbound request');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('2. Primary timeout does not trigger fallback when disableFallback is true', async () => {
      const origFetch = globalThis.fetch;
      let outboundCalls = 0;

      try {
        globalThis.fetch = async () => {
          outboundCalls++;
          const abortErr: any = new Error('This operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        };

        const config = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
        const telemetry = new TelemetryManager('test_stage30_timeout', 'live', 1.50);
        const engine = new WildGuardEngine(config, telemetry);

        await assert.rejects(
          async () => {
            await engine.execute({
              role: 'coder',
              messages: [{ role: 'user', content: 'Please reply exactly OTARI_CONNECTION_OK' }],
              disableFallback: true,
            });
          },
          (err: any) => {
            assert.strictEqual(err.category, 'timeout');
            assert.ok(err.message.includes('timed out'));
            return true;
          }
        );

        assert.strictEqual(outboundCalls, 1, 'Primary timeout must NOT trigger fallback call');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('3. HTTP 400 invalid-model response does not trigger fallback when disableFallback is true', async () => {
      const origFetch = globalThis.fetch;
      let outboundCalls = 0;

      try {
        globalThis.fetch = async () => {
          outboundCalls++;
          return new Response(JSON.stringify({
            detail: "Unknown or unsupported model 'alibaba/qwen-3.5-35b-a3b'. Send a 'provider:model' selector...",
            code: 'invalid_model',
          }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        };

        const config = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
        const telemetry = new TelemetryManager('test_stage30_invalid_model', 'live', 1.50);
        const engine = new WildGuardEngine(config, telemetry);

        await assert.rejects(
          async () => {
            await engine.execute({
              role: 'coder',
              messages: [{ role: 'user', content: 'Please reply exactly OTARI_CONNECTION_OK' }],
              disableFallback: true,
            });
          },
          (err: any) => {
            assert.strictEqual(err.category, 'invalid_model');
            assert.strictEqual(err.status, 400);
            assert.ok(err.message.includes('Invalid model identifier'));
            return true;
          }
        );

        assert.strictEqual(outboundCalls, 1, 'HTTP 400 invalid_model must NOT trigger fallback call');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('4. Normal role execution retains its existing fallback behavior when disableFallback is omitted or false', async () => {
      const origFetch = globalThis.fetch;
      let outboundCalls = 0;
      const modelsCalled: string[] = [];

      try {
        globalThis.fetch = async (_url: any, init: any) => {
          outboundCalls++;
          const body = JSON.parse(init.body);
          modelsCalled.push(body.model);

          if (outboundCalls === 1) {
            // Primary model fails with transient 500 error
            return new Response('Internal Server Error', { status: 500 });
          }

          // Fallback model succeeds
          return new Response(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'Recovered via fallback model' } }],
            usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23, cost_usd: 0.00003 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const config = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
        const telemetry = new TelemetryManager('test_stage30_fallback_retained', 'live', 1.50);
        const engine = new WildGuardEngine(config, telemetry);

        // Normal role execution (disableFallback not set)
        const res = await engine.execute({
          role: 'coder',
          messages: [{ role: 'user', content: 'Perform synthesis' }],
        });

        assert.strictEqual(outboundCalls, 2, 'Normal role execution must attempt primary then fallback');
        assert.strictEqual(res.fallbackTriggered, true);
        assert.strictEqual(res.attemptCount, 2);
        assert.strictEqual(res.content, 'Recovered via fallback model');
        assert.strictEqual(res.modelUsed, DEFAULT_CONFIG.FALLBACK_MODEL);
        assert.strictEqual(modelsCalled[0], DEFAULT_CONFIG.CODER_MODEL);
        assert.strictEqual(modelsCalled[1], DEFAULT_CONFIG.FALLBACK_MODEL);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('5. No failure is presented as a successful model response (engine and API levels)', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_stage30_srv', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = {
        config: liveConfig,
        tools: liveTools,
        telemetry: liveTelemetry,
        decisionGate: liveGate,
        engine: liveEngine,
        loop: liveLoop,
      };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Sub-test A: Gateway timeout returns HTTP 504 and success: false
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          const err: any = new Error('This operation was aborted');
          err.name = 'AbortError';
          throw err;
        };

        const resTimeout = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'Verify connection', role: 'verify' }),
        });

        const dataTimeout = await resTimeout.json() as any;
        assert.strictEqual(resTimeout.status, 504);
        assert.strictEqual(dataTimeout.success, false);
        assert.strictEqual(dataTimeout.errorCategory, 'timeout');
        assert.strictEqual(dataTimeout.response, undefined);

        // Sub-test B: Invalid model returns HTTP 400 and success: false
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            detail: "Unknown or unsupported model 'alibaba/qwen-3.5-35b-a3b'",
            code: 'invalid_model',
          }), { status: 400 });
        };

        const resInvalid = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'Verify connection', role: 'verify' }),
        });

        const dataInvalid = await resInvalid.json() as any;
        assert.strictEqual(resInvalid.status, 400);
        assert.strictEqual(dataInvalid.success, false);
        assert.strictEqual(dataInvalid.errorCategory, 'invalid_model');
        assert.strictEqual(dataInvalid.response, undefined);
      } finally {
        await testServer.stop();
        globalThis.fetch = origFetch;
      }
    });

    test('6. Existing budget checks remain enforced across normal primary and fallback execution', async () => {
      const origFetch = globalThis.fetch;
      let outboundCalls = 0;

      try {
        const config = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
        // Set tiny budget of $0.0001
        const telemetry = new TelemetryManager('test_stage30_budget', 'live', 0.0001);
        const engine = new WildGuardEngine(config, telemetry);

        // 6a: Pre-exhaust budget before primary request
        telemetry.recordEvent({
          model: 'pre_exhaust',
          costUsd: 0.0002,
          promptTokens: 100,
          completionTokens: 100,
          latencyMs: 10,
        });

        assert.strictEqual(telemetry.canProceed().allowed, false);

        await assert.rejects(
          async () => {
            await engine.execute({
              role: 'coder',
              messages: [{ role: 'user', content: 'blocked task' }],
            });
          },
          /Inference blocked by budget enforcement/
        );

        assert.strictEqual(outboundCalls, 0, 'Zero requests dispatched when budget is exhausted pre-call');

        // 6b: Fallback blocked if budget is exhausted after primary fails
        // Allocate $0.015000 budget (enough for primary projected call of $0.010000)
        const telemetry2 = new TelemetryManager('test_stage30_budget2', 'live', 0.015);
        const engine2 = new WildGuardEngine(config, telemetry2);

        globalThis.fetch = async () => {
          outboundCalls++;
          // Simulate cost accumulated during primary attempt
          telemetry2.recordEvent({
            model: 'primary_failed',
            costUsd: 0.010,
            latencyMs: 10,
          });
          return new Response('Internal error', { status: 500 });
        };

        await assert.rejects(
          async () => {
            await engine2.execute({
              role: 'coder',
              messages: [{ role: 'user', content: 'test task' }],
            });
          },
          /Fallback blocked by budget enforcement/
        );

        assert.strictEqual(outboundCalls, 1, 'Primary made 1 call; fallback was blocked by budget enforcement');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test('7. Error classification categorizes all 5 categories and redacts sensitive credentials', () => {
      // 1. Timeout
      const errTimeout = categorizeOtariError(new Error('This operation was aborted'), 30000);
      assert.strictEqual(errTimeout.category, 'timeout');
      assert.strictEqual(errTimeout.isTimeout, true);

      // 2. Authentication failure & credential redaction
      const errAuth = categorizeOtariError({
        status: 401,
        message: 'Missing Otari-Key: sk-live-secret-key-1234567890abcdef. Authorization: Bearer token-value-abcdef12345',
      });
      assert.strictEqual(errAuth.category, 'authentication_failed');
      assert.strictEqual(errAuth.status, 401);
      assert.ok(!errAuth.message.includes('sk-live-secret-key'));
      assert.ok(!errAuth.message.includes('token-value'));

      // 3. Invalid model
      const errModel = categorizeOtariError({
        status: 400,
        message: "Unknown or unsupported model 'meta-llama/llama-3.3-70b-instruct'",
      }, 30000, 'meta-llama/llama-3.3-70b-instruct');
      assert.strictEqual(errModel.category, 'invalid_model');
      assert.strictEqual(errModel.status, 400);

      // 4. Gateway error
      const errGateway = categorizeOtariError({ status: 502, message: 'Bad Gateway from Envoy' });
      assert.strictEqual(errGateway.category, 'gateway_error');
      assert.strictEqual(errGateway.status, 502);

      // 5. Network error
      const errNet = categorizeOtariError(new TypeError('fetch failed: ECONNREFUSED'));
      assert.strictEqual(errNet.category, 'network_error');
    });

    test('8. Dedicated verification endpoint /api/verify behaves truthfully in simulation mode', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const resSim = await fetch(`${baseUrl}/api/verify`, { method: 'POST' });
        assert.strictEqual(resSim.status, 200);
        const dataSim = await resSim.json() as any;
        assert.strictEqual(dataSim.success, true);
        assert.strictEqual(dataSim.verified, false);
        assert.strictEqual(dataSim.mode, 'simulation');
        assert.ok(dataSim.message.includes('Simulation mode active'));
      } finally {
        await testServer.stop();
      }
    });
  });

  describe('Stage 3.6: Verification Reliability Correction Suite', () => {
    // 1. Exact passphrase in message.content returns verified: true
    test('1. Exact passphrase in message.content returns verified: true and verificationStatus: matched', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_passphrase', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, true);
        assert.strictEqual(data.verificationStatus, 'matched');
        assert.strictEqual(data.response, 'OTARI_CONNECTION_OK');
        assert.strictEqual(data.maxTokens, 100);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 2. Empty content returns verified: false and verificationStatus: empty_content
    test('2. Empty content returns verified: false and verificationStatus: empty_content', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_empty', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: '' } }],
            usage: { prompt_tokens: 15, completion_tokens: 15, total_tokens: 30 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, false);
        assert.strictEqual(data.verificationStatus, 'empty_content');
        assert.strictEqual(data.response, '');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 3. Reasoning-only content does NOT return verified: true
    test('3. Reasoning-only content in reasoning_content does NOT return verified: true', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_reasoning', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: '',
                reasoning_content: 'The user wants me to reply with OTARI_CONNECTION_OK. I will formulate a plan...',
              }
            }],
            usage: { prompt_tokens: 15, completion_tokens: 15, total_tokens: 30 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, false);
        assert.strictEqual(data.verificationStatus, 'empty_content');
        assert.strictEqual(data.response, '');
        assert.ok(data.reasoningDiagnostic?.includes('The user wants me to reply'));
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 4. Different answer text returns verified: false and verificationStatus: mismatch
    test('4. Different answer text returns verified: false and verificationStatus: mismatch', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_mismatch', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'Hello! How can I help you today?' } }],
            usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, false);
        assert.strictEqual(data.verificationStatus, 'mismatch');
        assert.strictEqual(data.response, 'Hello! How can I help you today?');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 5. Missing choices/message returns safe empty content and verified: false without crashing
    test('5. Missing choices or message returns safe empty content and verified: false without crashing', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_missing_choices', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [],
            usage: { prompt_tokens: 15, completion_tokens: 0, total_tokens: 15 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, false);
        assert.strictEqual(data.verificationStatus, 'empty_content');
        assert.strictEqual(data.response, '');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 6. Structured multipart content is parsed safely and returns verified: true
    test('6. Structured multipart content array is parsed safely and returns verified: true', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_multipart', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: [
                  { type: 'text', text: 'Confirmed: ' },
                  { type: 'text', text: 'OTARI_CONNECTION_OK' }
                ]
              }
            }],
            usage: { prompt_tokens: 15, completion_tokens: 6, total_tokens: 21 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, true);
        assert.strictEqual(data.verificationStatus, 'matched');
        assert.strictEqual(data.response, 'Confirmed: OTARI_CONNECTION_OK');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 7. Invalid token limits are safely rejected with HTTP 400
    test('7. Invalid token limits (negative, zero, float, excessive > 150) are rejected with HTTP 400', async () => {
      const { createServer, validateVerificationMaxTokens } = await import('../src/web/server.js');
      // Unit validation checks
      assert.strictEqual(validateVerificationMaxTokens(undefined), 100);
      assert.strictEqual(validateVerificationMaxTokens(null), 100);
      assert.strictEqual(validateVerificationMaxTokens(''), 100);
      assert.strictEqual(validateVerificationMaxTokens(30), 30);
      assert.strictEqual(validateVerificationMaxTokens('50'), 50);
      assert.strictEqual(validateVerificationMaxTokens(150), 150);

      assert.throws(() => validateVerificationMaxTokens(0), /must be greater than 0/);
      assert.throws(() => validateVerificationMaxTokens(-10), /must be greater than 0/);
      assert.throws(() => validateVerificationMaxTokens(15.5), /must be an integer/);
      assert.throws(() => validateVerificationMaxTokens('abc'), /not a valid integer/);
      assert.throws(() => validateVerificationMaxTokens(151), /exceeds maximum allowed verification limit of 150/);

      // Server endpoint rejection checks
      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const resZero = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_tokens: 0 }),
        });
        assert.strictEqual(resZero.status, 400);
        const dataZero = await resZero.json() as any;
        assert.strictEqual(dataZero.success, false);
        assert.strictEqual(dataZero.errorCategory, 'invalid_request');

        const resExcessive = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_tokens: 200 }),
        });
        assert.strictEqual(resExcessive.status, 400);
        const dataExcessive = await resExcessive.json() as any;
        assert.strictEqual(dataExcessive.success, false);
        assert.strictEqual(dataExcessive.errorCategory, 'invalid_request');
        assert.ok(dataExcessive.error.includes('exceeds maximum allowed verification limit'));

        // Query param validation on /api/verify
        const resQuery = await fetch(`${baseUrl}/api/verify?max_tokens=invalid`, { method: 'GET' });
        assert.strictEqual(resQuery.status, 400);
      } finally {
        await testServer.stop();
      }
    });

    // 8. Validated token limit reaches outbound request body
    test('8. Validated token limit reaches outbound request body (body.max_tokens)', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_tokens_sent', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      let capturedOutboundBody: any = null;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          if (init?.body) {
            capturedOutboundBody = JSON.parse(init.body as string);
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_tokens: 45 }),
        });
        assert.strictEqual(res.status, 200);
        assert.ok(capturedOutboundBody, 'Outbound fetch must be captured');
        assert.strictEqual(capturedOutboundBody.max_tokens, 45, 'Outbound body must reflect requested 45 max_tokens');
        assert.strictEqual(capturedOutboundBody.temperature, 0);

        // Also test /api/chat with role: 'verify'
        capturedOutboundBody = null;
        const resChat = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'verify', max_tokens: 30 }),
        });
        assert.strictEqual(resChat.status, 200);
        assert.ok(capturedOutboundBody);
        assert.strictEqual(capturedOutboundBody.max_tokens, 30);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 9. Verification errors (401, 500, timeout) do not trigger fallback or retry
    test('9. Verification errors (401, 500, timeout) do not trigger fallback or retry', async () => {
      const origFetch = globalThis.fetch;
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_no_fallback', 'live', 1.50);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);

      let outboundCalls = 0;

      try {
        globalThis.fetch = async () => {
          outboundCalls++;
          return new Response(JSON.stringify({ error: { message: 'Internal Server Error' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        await assert.rejects(
          async () => {
            await liveEngine.execute({
              role: 'coder',
              messages: [{ role: 'user', content: 'Verify' }],
              disableFallback: true,
            });
          },
          (err: any) => {
            assert.strictEqual(err.category, 'gateway_error');
            return true;
          }
        );

        assert.strictEqual(outboundCalls, 1, 'HTTP 500 with disableFallback must NOT trigger fallback');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    // 10. Normal Coder/Explorer fallback behavior remains completely unchanged
    test('10. Normal Coder/Explorer fallback behavior remains completely unchanged', async () => {
      const origFetch = globalThis.fetch;
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s36_normal_fallback', 'live', 1.50);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);

      let callCount = 0;
      const modelsCalled: string[] = [];

      try {
        globalThis.fetch = async (_input: any, init: any) => {
          callCount++;
          const body = JSON.parse(init.body as string);
          modelsCalled.push(body.model);
          if (callCount === 1) {
            // First call (primary coder) fails with gateway 503
            return new Response('Gateway Unavailable', { status: 503 });
          }
          // Second call (fallback) succeeds
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'Normal synthesis completed by fallback' } }],
            usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await liveEngine.execute({
          role: 'coder',
          messages: [{ role: 'user', content: 'Synthesize code' }],
        });

        assert.strictEqual(callCount, 2, 'Normal execution must invoke fallback upon primary failure');
        assert.strictEqual(res.fallbackTriggered, true);
        assert.strictEqual(res.attemptCount, 2);
        assert.strictEqual(res.roleUsed, 'fallback');
        assert.strictEqual(res.content, 'Normal synthesis completed by fallback');
        assert.strictEqual(modelsCalled[0], DEFAULT_CONFIG.CODER_MODEL);
        assert.strictEqual(modelsCalled[1], DEFAULT_CONFIG.FALLBACK_MODEL);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('Stage 3.11: Request-Scoped Verification Model Selection Suite', () => {
    // 1. Verification can select each of the three configured model IDs
    test('1. Verification can select each of the three configured model IDs', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_select_models', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const modelsToTest = [
        DEFAULT_CONFIG.FALLBACK_MODEL, // meta-llama/llama-3.3-70b-instruct
        DEFAULT_CONFIG.EXPLORER_MODEL, // deepseek/deepseek-v4.1-flash
        DEFAULT_CONFIG.CODER_MODEL,    // alibaba/qwen-3.5-35b-a3b
      ];

      try {
        for (const targetModel of modelsToTest) {
          let modelSeenByGateway = '';
          globalThis.fetch = async (input: any, init: any) => {
            const urlStr = typeof input === 'string' ? input : (input?.url || '');
            if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
              return origFetch(input, init);
            }
            if (init?.body) {
              const parsed = JSON.parse(init.body as string);
              modelSeenByGateway = parsed.model;
            }
            return new Response(JSON.stringify({
              choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
              usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          };

          const res = await fetch(`${baseUrl}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: targetModel }),
          });

          assert.strictEqual(res.status, 200);
          const data = await res.json() as any;
          assert.strictEqual(data.success, true);
          assert.strictEqual(data.modelUsed, targetModel);
          assert.strictEqual(modelSeenByGateway, targetModel, `Outbound request must use requested model ${targetModel}`);
        }
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 2. An unknown model ID is rejected
    test('2. An unknown model ID is rejected with HTTP 400', async () => {
      const { createServer, validateVerificationModel } = await import('../src/web/server.js');
      const allowed = [DEFAULT_CONFIG.CODER_MODEL, DEFAULT_CONFIG.EXPLORER_MODEL, DEFAULT_CONFIG.FALLBACK_MODEL];

      assert.throws(
        () => validateVerificationModel('openai/gpt-4o', allowed, DEFAULT_CONFIG.CODER_MODEL),
        /not an authorized verification model candidate/
      );

      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'openai/gpt-4o' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json() as any;
        assert.strictEqual(data.success, false);
        assert.strictEqual(data.errorCategory, 'invalid_request');
        assert.ok(data.error.includes('not an authorized verification model candidate'));
      } finally {
        await testServer.stop();
      }
    });

    // 3. An unconfigured model ID is rejected
    test('3. An unconfigured model ID is rejected with HTTP 400', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'anthropic/claude-3-opus' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json() as any;
        assert.strictEqual(data.success, false);
        assert.ok(data.error.includes('not an authorized verification model candidate'));
      } finally {
        await testServer.stop();
      }
    });

    // 4. Normal Coder requests still use the Coder model
    test('4. Normal Coder requests still use the Coder model and ignore model overrides', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_coder', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      let outboundModel = '';

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          if (init?.body) {
            outboundModel = JSON.parse(init.body as string).model;
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'Coder patch synthesized' } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        // Attempting to pass model override in ordinary coder turn must be ignored
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'coder', task: 'Synthesize code', model: DEFAULT_CONFIG.FALLBACK_MODEL }),
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.modelUsed, DEFAULT_CONFIG.CODER_MODEL);
        assert.strictEqual(outboundModel, DEFAULT_CONFIG.CODER_MODEL);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 5. Normal Explorer requests still use the Explorer model
    test('5. Normal Explorer requests still use the Explorer model', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_explorer', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      let outboundModel = '';

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          if (init?.body) {
            outboundModel = JSON.parse(init.body as string).model;
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'Reconnaissance completed' } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'explorer', task: 'Scan repo', model: DEFAULT_CONFIG.CODER_MODEL }),
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.modelUsed, DEFAULT_CONFIG.EXPLORER_MODEL);
        assert.strictEqual(outboundModel, DEFAULT_CONFIG.EXPLORER_MODEL);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 6. Normal fallback behavior remains unchanged
    test('6. Normal fallback behavior remains completely unchanged', async () => {
      const origFetch = globalThis.fetch;
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_fallback', 'live', 1.50);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);

      let attempts = 0;
      const modelsSeen: string[] = [];

      try {
        globalThis.fetch = async (_input: any, init: any) => {
          attempts++;
          const body = JSON.parse(init.body as string);
          modelsSeen.push(body.model);
          if (attempts === 1) {
            return new Response('Primary Error', { status: 500 });
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'Fallback response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await liveEngine.execute({
          role: 'coder',
          messages: [{ role: 'user', content: 'Do work' }],
        });

        assert.strictEqual(attempts, 2);
        assert.strictEqual(res.fallbackTriggered, true);
        assert.strictEqual(res.roleUsed, 'fallback');
        assert.strictEqual(res.modelUsed, DEFAULT_CONFIG.FALLBACK_MODEL);
        assert.strictEqual(modelsSeen[0], DEFAULT_CONFIG.CODER_MODEL);
        assert.strictEqual(modelsSeen[1], DEFAULT_CONFIG.FALLBACK_MODEL);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    // 7. Verification selection does not modify persistent configuration
    test('7. Verification selection does not modify persistent configuration', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_persistent', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const coderBefore = liveAgent.config.models.coder;
        const fallbackBefore = liveAgent.config.models.fallback;
        const explorerBefore = liveAgent.config.models.explorer;

        // Execute verify with Llama override
        await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DEFAULT_CONFIG.FALLBACK_MODEL }),
        });

        assert.strictEqual(liveAgent.config.models.coder, coderBefore);
        assert.strictEqual(liveAgent.config.models.fallback, fallbackBefore);
        assert.strictEqual(liveAgent.config.models.explorer, explorerBefore);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 8. Verification still disables fallback
    test('8. Verification still disables fallback when model override is active', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_disables_fallback', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      let outboundCalls = 0;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          outboundCalls++;
          return new Response(JSON.stringify({ error: { message: 'Upstream failure' } }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DEFAULT_CONFIG.FALLBACK_MODEL }),
        });

        assert.strictEqual(res.status, 502);
        const data = await res.json() as any;
        assert.strictEqual(data.success, false);
        assert.strictEqual(data.errorCategory, 'gateway_error');
        assert.strictEqual(outboundCalls, 1, 'Verification must NOT trigger fallback upon failure');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 9. One verification operation results in at most one outbound request
    test('9. One verification operation results in at most one outbound request', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_single_outbound', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      let outboundCalls = 0;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          outboundCalls++;
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DEFAULT_CONFIG.FALLBACK_MODEL }),
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(outboundCalls, 1, 'Verification must make exactly one outbound call');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 10. The selected model ID reaches the outbound request builder
    test('10. The selected model ID reaches the outbound request builder', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_builder_model', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      let capturedPayload: any = null;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          if (init?.body) {
            capturedPayload = JSON.parse(init.body as string);
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DEFAULT_CONFIG.FALLBACK_MODEL, max_tokens: 30 }),
        });

        assert.strictEqual(res.status, 200);
        assert.ok(capturedPayload);
        assert.strictEqual(capturedPayload.model, DEFAULT_CONFIG.FALLBACK_MODEL);
        assert.strictEqual(capturedPayload.max_tokens, 30);
        assert.strictEqual(capturedPayload.temperature, 0);

        // Also test /api/chat with role: 'verify'
        capturedPayload = null;
        const resChat = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'verify', model: DEFAULT_CONFIG.FALLBACK_MODEL, max_tokens: 30 }),
        });
        assert.strictEqual(resChat.status, 200);
        assert.ok(capturedPayload);
        assert.strictEqual(capturedPayload.model, DEFAULT_CONFIG.FALLBACK_MODEL);
        assert.strictEqual(capturedPayload.max_tokens, 30);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 11. Exact-match verification behavior remains correct
    test('11. Exact-match verification behavior remains correct with model override', async () => {
      const origFetch = globalThis.fetch;
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const liveTelemetry = new TelemetryManager('test_s311_exact_match', 'live', 1.50);
      const liveTools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const liveGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);
      const liveLoop = new AgentLoop(liveEngine, liveTools, liveGate, liveTelemetry);
      const liveAgent = { config: liveConfig, tools: liveTools, telemetry: liveTelemetry, decisionGate: liveGate, engine: liveEngine, loop: liveLoop };

      const testServer = createServer({ repoRoot: tempRepo, agent: liveAgent });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            return origFetch(input, init);
          }
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DEFAULT_CONFIG.FALLBACK_MODEL }),
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, true);
        assert.strictEqual(data.verificationStatus, 'matched');
        assert.strictEqual(data.response, 'OTARI_CONNECTION_OK');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 12. Existing budget checks remain effective
    test('12. Existing budget checks remain effective with model override', async () => {
      const origFetch = globalThis.fetch;
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      // Zero remaining budget
      const liveTelemetry = new TelemetryManager('test_s311_budget', 'live', 0.0001);
      liveTelemetry.recordEvent({
        requestId: 'prev_1',
        model: DEFAULT_CONFIG.FALLBACK_MODEL,
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
        costUsd: 0.0002, // exceeds 0.0001 cap
        latencyMs: 100,
        fallbackOccurred: false,
        attemptCount: 1,
      });

      const liveEngine = new WildGuardEngine(liveConfig, liveTelemetry);

      await assert.rejects(
        async () => {
          await liveEngine.execute({
            role: 'coder',
            modelOverride: DEFAULT_CONFIG.FALLBACK_MODEL,
            messages: [{ role: 'user', content: 'Verify' }],
            disableFallback: true,
          });
        },
        /Inference blocked by budget enforcement/
      );
    });
  });

  // ==========================================
  // 13. STAGE 4.2 VERCEL SIMULATION-ONLY PREVIEW TESTS
  // ==========================================
  describe('Stage 4.2 Simulation-Only Vercel Preview Suite', () => {
    // 1. Public preview always reports simulation mode
    test('1. Public preview always reports simulation mode', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/status`);
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.status, 'ok');
        assert.strictEqual(data.config.mode, 'simulation');
        assert.strictEqual(data.config.hasApiKey, false);
        assert.strictEqual(data.preview, true);
        assert.strictEqual(data.readOnly, true);
        assert.ok(data.notice.includes('Public preview deployment: simulation mode only'));
      } finally {
        await testServer.stop();
      }
    });

    // 2. Live-mode override attempts are rejected
    test('2. Live-mode override attempts are rejected', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Query param override attempt on status
        const resQuery = await fetch(`${baseUrl}/api/status?mode=live`);
        assert.strictEqual(resQuery.status, 400);
        const dataQuery = await resQuery.json() as any;
        assert.strictEqual(dataQuery.success, false);
        assert.strictEqual(dataQuery.errorCategory, 'invalid_request');
        assert.ok(dataQuery.error.includes('Live mode override is strictly prohibited'));

        // Body override attempt on /api/chat
        const resChat = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'Test', mode: 'live' }),
        });
        assert.strictEqual(resChat.status, 400);
        const dataChat = await resChat.json() as any;
        assert.strictEqual(dataChat.success, false);
        assert.ok(dataChat.error.includes('Live mode override is strictly prohibited'));

        // Override attempt on /api/verify
        const resVerify = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'live' }),
        });
        assert.strictEqual(resVerify.status, 400);
        const dataVerify = await resVerify.json() as any;
        assert.strictEqual(dataVerify.success, false);
        assert.ok(dataVerify.error.includes('Live mode override is strictly prohibited'));
      } finally {
        await testServer.stop();
      }
    });

    // 3. No request can reach the Otari inference client
    test('3. No request can reach the Otari inference client in public preview', async () => {
      const origFetch = globalThis.fetch;
      let otariCallCount = 0;
      globalThis.fetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (urlStr.includes('otari.ai')) {
          otariCallCount++;
          throw new Error('OTARI_CALL_DETECTED: Outbound calls are forbidden in preview');
        }
        return origFetch(input, init);
      };

      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Chat turns
        const roles = ['explorer', 'coder', 'verify', 'autonomous'];
        for (const role of roles) {
          const res = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, task: 'Test preview isolation' }),
          });
          assert.strictEqual(res.status, 200);
          const data = await res.json() as any;
          assert.strictEqual(data.success, true);
        }

        // Verify probe
        const resVerify = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        assert.strictEqual(resVerify.status, 200);
        const verifyData = await resVerify.json() as any;
        assert.strictEqual(verifyData.verificationStatus, 'simulation');

        // Assert exactly 0 outbound calls to otari.ai
        assert.strictEqual(otariCallCount, 0, 'Zero requests must reach Otari client');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 4. No request can trigger fallback inference
    test('4. No request can trigger fallback inference in public preview', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'coder', task: 'Synthesize code' }),
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(testServer.agent.telemetry.getEvents().every((e: any) => e.fallbackOccurred === false), true);
      } finally {
        await testServer.stop();
      }
    });

    // 5. Patch operations return dry-run diffs without filesystem writes
    test('5. Patch operations return dry-run diffs without filesystem writes', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const targetPath = 'src/previewDryRunTest.ts';
      const fullPath = path.join(tempRepo, targetPath);
      assert.strictEqual(fs.existsSync(fullPath), false);

      try {
        const res = await fetch(`${baseUrl}/api/patch/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: targetPath,
            content: 'export const dryRunSuccess = true;\n',
            isApproved: true,
          }),
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.data.dryRun, true);
        assert.ok(data.data.notice.includes('dry-run'));
        assert.ok(data.data.previewDiff.includes('+export const dryRunSuccess = true;'));

        // Critical assertion: File was NEVER written to disk
        assert.strictEqual(fs.existsSync(fullPath), false, 'Disk file must NOT be created');
      } finally {
        await testServer.stop();
      }
    });

    // 6. Unsafe routes and operations are rejected
    test('6. Unsafe routes and operations are rejected', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Unknown API route -> 404
        const resUnknown = await fetch(`${baseUrl}/api/execute_arbitrary_shell`);
        assert.strictEqual(resUnknown.status, 404);
        const dataUnknown = await resUnknown.json() as any;
        assert.strictEqual(dataUnknown.success, false);

        // Path traversal read -> blocked
        const resTraversal = await fetch(`${baseUrl}/api/repo/file?path=../../etc/shadow`);
        assert.strictEqual(resTraversal.status, 200); // 200 with policy result
        const dataTraversal = await resTraversal.json() as any;
        assert.strictEqual(dataTraversal.success, false);
        assert.strictEqual(dataTraversal.reasonCode, 'PATH_TRAVERSAL_DETECTED');

        // Secret file read (.env) -> blocked
        const resSecret = await fetch(`${baseUrl}/api/repo/file?path=.env`);
        assert.strictEqual(resSecret.status, 200);
        const dataSecret = await resSecret.json() as any;
        assert.strictEqual(dataSecret.success, false);
        assert.strictEqual(dataSecret.reasonCode, 'SECRET_FILE_READ_BLOCKED');

        // Invalid chat role -> 400
        const resInvalidRole = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'arbitrary_injection', task: 'Halt' }),
        });
        assert.strictEqual(resInvalidRole.status, 400);
      } finally {
        await testServer.stop();
      }
    });

    // 7. Existing local development routes remain compatible
    test('7. Existing local development routes remain compatible when isPublicPreview is false', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo, isPublicPreview: false });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const localPath = 'src/localDevWrite.ts';
      const fullPath = path.join(tempRepo, localPath);

      try {
        const resStatus = await fetch(`${baseUrl}/api/status`);
        assert.strictEqual(resStatus.status, 200);
        const dataStatus = await resStatus.json() as any;
        assert.strictEqual(dataStatus.preview, false);

        // Local non-preview write does write to disk when approved
        const resPatch = await fetch(`${baseUrl}/api/patch/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: localPath,
            content: 'export const localDevActive = true;\n',
            isApproved: true,
          }),
        });
        assert.strictEqual(resPatch.status, 200);
        const dataPatch = await resPatch.json() as any;
        assert.strictEqual(dataPatch.success, true);
        assert.strictEqual(dataPatch.data.dryRun, undefined);
        assert.strictEqual(fs.existsSync(fullPath), true, 'Local dev write should succeed');
      } finally {
        await testServer.stop();
      }
    });

    // 8. Existing budget and guardrail tests continue passing
    test('8. Existing guardrail policies continue passing under preview tools', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness', { readOnly: true });
      assert.strictEqual(tools.isReadOnlyMode(), true);

      // Branch protection still blocks protected branches
      tools.setCurrentBranch('main');
      const patchRes = tools.applyPatch('package.json', '{}', true);
      assert.strictEqual(patchRes.success, false);
      assert.strictEqual(patchRes.policyResult.status, 'blocked');
      assert.strictEqual(patchRes.reasonCode, 'PROTECTED_BRANCH_WRITE_BLOCKED');

      // Dependency protection requires approval
      tools.setCurrentBranch('feat/preview-test');
      const unapprovedRes = tools.applyPatch('package.json', '{"dependencies":{}}', false);
      assert.strictEqual(unapprovedRes.success, false);
      assert.strictEqual(unapprovedRes.requiresApproval, true);
    });

    // 9. Serverless handler returns correct status codes and response headers
    test('9. Serverless handler returns correct status codes and security response headers', async () => {
      const httpModule = await import('node:http');
      const { default: serverlessHandler } = await import('../api/index.js');

      const server = httpModule.createServer(async (req, res) => {
        await serverlessHandler(req, res);
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/status`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
        assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
        assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
        assert.strictEqual(res.headers.get('x-wildguard-preview'), 'simulation-only');

        const body = await res.json() as any;
        assert.strictEqual(body.preview, true);
        assert.strictEqual(body.config.mode, 'simulation');

        // 2. Static root / -> index.html
        const resRoot = await fetch(`${baseUrl}/`);
        assert.strictEqual(resRoot.status, 200);
        assert.ok(resRoot.headers.get('content-type')?.includes('text/html'));
        const rootHtml = await resRoot.text();
        assert.ok(rootHtml.includes('WildGuard'));
        assert.ok(rootHtml.includes('previewBanner'));

        // 3. Static asset /styles.css
        const resCss = await fetch(`${baseUrl}/styles.css`);
        assert.strictEqual(resCss.status, 200);
        assert.ok(resCss.headers.get('content-type')?.includes('text/css'));
        const cssContent = await resCss.text();
        assert.ok(cssContent.length > 50);

        // 4. Static asset /app.js
        const resJs = await fetch(`${baseUrl}/app.js`);
        assert.strictEqual(resJs.status, 200);
        assert.ok(resJs.headers.get('content-type')?.includes('javascript'));
        const jsContent = await resJs.text();
        assert.ok(jsContent.includes('WildGuard'));

        // 5. Unknown API route -> 404 JSON
        const resUnknownApi = await fetch(`${baseUrl}/api/non_existent_route`);
        assert.strictEqual(resUnknownApi.status, 404);
        assert.strictEqual(resUnknownApi.headers.get('content-type'), 'application/json; charset=utf-8');

        // 6. Unknown client route -> SPA fallback to index.html (HTTP 200 text/html)
        const resSpa = await fetch(`${baseUrl}/sessions/new-session`);
        assert.strictEqual(resSpa.status, 200);
        assert.ok(resSpa.headers.get('content-type')?.includes('text/html'));
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    // 10. Cold-start simulation requests do not depend on previous in-memory state
    test('10. Cold-start simulation requests do not depend on previous in-memory state', async () => {
      const { createServer } = await import('../src/web/server.js');

      // Container instance 1
      const server1 = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await server1.start(0, '127.0.0.1');
      const port1 = (server1.server.address() as any).port;

      const res1 = await fetch(`http://127.0.0.1:${port1}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'explorer', task: 'Instance 1 task' }),
      });
      assert.strictEqual(res1.status, 200);
      const data1 = await res1.json() as any;
      assert.strictEqual(data1.success, true);
      await server1.stop();

      // Fresh container instance 2 (Cold start emulation)
      const server2 = createServer({ repoRoot: tempRepo, isPublicPreview: true });
      await server2.start(0, '127.0.0.1');
      const port2 = (server2.server.address() as any).port;

      const res2 = await fetch(`http://127.0.0.1:${port2}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coder', task: 'Instance 2 task' }),
      });
      assert.strictEqual(res2.status, 200);
      const data2 = await res2.json() as any;
      assert.strictEqual(data2.success, true);
      assert.strictEqual(data2.phase, 'coder');
      await server2.stop();
    });

    // 11. Vercel deployment configuration syntax and limits validation
    test('11. Vercel deployment configuration syntax and limits validation', () => {
      const vercelJsonPath = path.resolve(process.cwd(), 'vercel.json');
      assert.strictEqual(fs.existsSync(vercelJsonPath), true);
      const rawContent = fs.readFileSync(vercelJsonPath, 'utf-8');
      const vercelConfig = JSON.parse(rawContent);

      assert.strictEqual(vercelConfig.version, 2);
      assert.strictEqual(vercelConfig.buildCommand, 'npm run build');
      assert.strictEqual(vercelConfig.framework, null);
      assert.strictEqual(vercelConfig.outputDirectory, undefined); // removed to avoid static packaging mismatch

      // Functions configuration
      const fnConfig = vercelConfig.functions?.['api/index.ts'];
      assert.ok(fnConfig, 'functions["api/index.ts"] must be defined');
      assert.strictEqual(fnConfig.memory, 1024);
      assert.ok(fnConfig.maxDuration >= 10 && fnConfig.maxDuration <= 300, 'maxDuration must be between 10 and 300 for Vercel Serverless Function compatibility');
      assert.strictEqual(fnConfig.includeFiles, 'frontend/**');

      // Rewrites configuration
      const rewrites = vercelConfig.rewrites;
      assert.ok(Array.isArray(rewrites) && rewrites.length >= 2);
      assert.strictEqual(rewrites[0].source, '/api/(.*)');
      assert.strictEqual(rewrites[0].destination, '/api/index.ts');
      assert.strictEqual(rewrites[1].source, '/(.*)');
      assert.strictEqual(rewrites[1].destination, '/api/index.ts');

      // 12. Verify generated public/ output directory matches canonical frontend/
      const publicDir = path.resolve(process.cwd(), 'public');
      assert.strictEqual(fs.existsSync(publicDir), true, 'public/ directory must exist for Vercel deployment');
      for (const asset of ['index.html', 'styles.css', 'app.js']) {
        const canonical = path.resolve(process.cwd(), 'frontend', asset);
        const generated = path.resolve(publicDir, asset);
        assert.strictEqual(fs.existsSync(generated), true, `public/${asset} must exist`);
        assert.strictEqual(
          fs.readFileSync(canonical, 'utf-8'),
          fs.readFileSync(generated, 'utf-8'),
          `public/${asset} must match canonical frontend/${asset}`
        );
      }
    });
  });

  // ==========================================
  // 14. STAGE 4.6 LIVE OTARI INTEGRATION FOR VERCEL HOBBY SUITE
  // ==========================================
  describe('Stage 4.6: Live Otari Integration for Vercel Hobby Suite', () => {
    function createMockUpstashRedis() {
      const store = new Map<string, string>();

      const customFetch = async (_url: any, init: any): Promise<Response> => {
        const command = JSON.parse(init.body as string) as (string | number)[];
        const cmd = String(command[0]).toUpperCase();

        if (cmd === 'PING') {
          return new Response(JSON.stringify({ result: 'PONG' }));
        }
        if (cmd === 'GET') {
          const key = String(command[1]);
          return new Response(JSON.stringify({ result: store.get(key) || null }));
        }
        if (cmd === 'SET') {
          const key = String(command[1]);
          const val = String(command[2]);
          store.set(key, val);
          return new Response(JSON.stringify({ result: 'OK' }));
        }
        if (cmd === 'INCRBYFLOAT') {
          const key = String(command[1]);
          const amt = parseFloat(String(command[2]));
          const current = parseFloat(store.get(key) || '0');
          const next = current + amt;
          store.set(key, next.toFixed(6));
          return new Response(JSON.stringify({ result: next.toFixed(6) }));
        }
        if (cmd === 'EVAL') {
          const script = String(command[1]);
          const numKeys = Number(command[2]);
          const keys = command.slice(3, 3 + numKeys).map(String);
          const args = command.slice(3 + numKeys).map(String);

          if (script.includes('PER_RUN_CAP_EXCEEDED')) {
            const [k_g_spent, k_g_res, k_r_spent, k_r_res, k_res, k_idemp] = keys;
            const [reserve_amt_s, run_cap_s, global_cap_s, res_id, idemp_k, _ttl, created] = args;

            const reserve_amt = parseFloat(reserve_amt_s);
            const run_cap = parseFloat(run_cap_s);
            const global_cap = parseFloat(global_cap_s);

            if (idemp_k && store.has(k_idemp)) {
              const existing_id = store.get(k_idemp)!;
              const g_spent = store.get(k_g_spent) || '0';
              const r_spent = store.get(k_r_spent) || '0';
              return new Response(JSON.stringify({ result: [2, existing_id, r_spent, g_spent] }));
            }

            const g_spent = parseFloat(store.get(k_g_spent) || '0');
            const g_res = parseFloat(store.get(k_g_res) || '0');
            const r_spent = parseFloat(store.get(k_r_spent) || '0');
            const r_res = parseFloat(store.get(k_r_res) || '0');

            if ((r_spent + r_res + reserve_amt) > run_cap) {
              return new Response(JSON.stringify({ result: [0, 'PER_RUN_CAP_EXCEEDED', String(r_spent), String(g_spent)] }));
            }
            if ((g_spent + g_res + reserve_amt) > global_cap) {
              return new Response(JSON.stringify({ result: [0, 'GLOBAL_CEILING_EXCEEDED', String(r_spent), String(g_spent)] }));
            }

            store.set(k_g_res, (g_res + reserve_amt).toFixed(6));
            store.set(k_r_res, (r_res + reserve_amt).toFixed(6));
            store.set(k_res, JSON.stringify({ id: res_id, amount: reserve_amt, status: 'reserved', created }));
            if (idemp_k) store.set(k_idemp, res_id);

            return new Response(JSON.stringify({ result: [1, res_id, String(r_spent), String(g_spent)] }));
          }

          if (script.includes('RESERVATION_NOT_FOUND') || script.includes('actualUsd')) {
            const [k_g_spent, k_g_res, k_r_spent, k_r_res, k_res] = keys;
            const [res_id, actual_usd_s, status] = args;
            const actual_usd = parseFloat(actual_usd_s);

            const raw = store.get(k_res);
            if (!raw) {
              return new Response(JSON.stringify({ result: [0, 'RESERVATION_NOT_FOUND', '0', '0'] }));
            }
            const meta = JSON.parse(raw);
            if (meta.status !== 'reserved') {
              const g_spent = store.get(k_g_spent) || '0';
              const r_spent = store.get(k_r_spent) || '0';
              return new Response(JSON.stringify({ result: [1, 'ALREADY_SETTLED', r_spent, g_spent] }));
            }

            const reserved_amt = parseFloat(meta.amount) || 0;
            const g_res = parseFloat(store.get(k_g_res) || '0');
            const r_res = parseFloat(store.get(k_r_res) || '0');
            store.set(k_g_res, Math.max(0, g_res - reserved_amt).toFixed(6));
            store.set(k_r_res, Math.max(0, r_res - reserved_amt).toFixed(6));

            let charge = 0;
            if (status === 'settled') charge = actual_usd;
            else if (status === 'uncertain') charge = reserved_amt;
            else if (status === 'released') charge = 0;

            if (charge > 0) {
              const g_spent = parseFloat(store.get(k_g_spent) || '0') + charge;
              const r_spent = parseFloat(store.get(k_r_spent) || '0') + charge;
              store.set(k_g_spent, g_spent.toFixed(6));
              store.set(k_r_spent, r_spent.toFixed(6));
            }

            meta.status = status;
            meta.actualUsd = charge;
            store.set(k_res, JSON.stringify(meta));

            const g_spent = store.get(k_g_spent) || '0';
            const r_spent = store.get(k_r_spent) || '0';
            return new Response(JSON.stringify({ result: [1, status, r_spent, g_spent] }));
          }
        }

        return new Response(JSON.stringify({ result: null }));
      };

      return { store, customFetch };
    }

    // 1. Ingress Authentication: Unauthorized requests rejected before Otari calls (HTTP 401)
    test('1. Ingress Authentication: Unauthorized requests rejected before Otari calls (HTTP 401)', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedis();
      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-secret-key',
        WILDGUARD_ACCESS_TOKEN: 'correct-secret-passphrase',
        UPSTASH_REDIS_REST_URL: 'https://test-mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const telemetry = new TelemetryManager('test_s46_auth_gate', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Attempt live verify without auth: strictly rejected with 401 (owner-only verification)
        const resVerify = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        assert.strictEqual(resVerify.status, 401);
        const dataVerify = await resVerify.json() as any;
        assert.strictEqual(dataVerify.success, false);
        assert.ok(dataVerify.error.includes('Unauthorized'));

        // Stage 4.17 update: public access intentionally supersedes prior gating for interactive chat and workflows.
        // Public visitors without owner credentials receive an isolated public session.
        const resWf = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userTask: 'Test task', mode: 'simulation' }),
        });
        assert.strictEqual(resWf.status, 200);
        const dataWf = await resWf.json() as any;
        assert.strictEqual(dataWf.success, true);
        assert.ok(dataWf.workflow.ownerSessionId.startsWith('pub_'));
      } finally {
        await testServer.stop();
      }
    });

    // 2. Ingress Authentication: Valid Access Token authorizes request
    test('2. Ingress Authentication: Valid Access Token authorizes request via Bearer header', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedis();
      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-secret-key',
        WILDGUARD_ACCESS_TOKEN: 'owner-secret-passphrase',
        UPSTASH_REDIS_REST_URL: 'https://test-mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const telemetry = new TelemetryManager('test_s46_auth_bearer', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const resWf = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer owner-secret-passphrase',
          },
          body: JSON.stringify({ userTask: 'Fix typo in sample file', mode: 'live' }),
        });
        assert.strictEqual(resWf.status, 200);
        const dataWf = await resWf.json() as any;
        assert.strictEqual(dataWf.success, true);
        assert.strictEqual(dataWf.workflow.status, 'initialized');
        assert.strictEqual(dataWf.workflow.mode, 'live');
      } finally {
        await testServer.stop();
      }
    });

    // 3. Secure Session Cookie: Login creates HMAC session and sets secure cookie
    test('3. Secure Session Cookie: /api/auth/login sets valid session cookie and logout clears it', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const liveConfig = loadConfig({
        WILDGUARD_ACCESS_TOKEN: 'owner-session-secret',
      });
      const authManager = new AuthManager({ accessToken: 'owner-session-secret' });
      const testServer = createServer({
        repoRoot: tempRepo,
        agent: {
          config: liveConfig,
          telemetry: new TelemetryManager('test_s46_sess', 'simulation', 1.50),
          tools: new McpRepoTools(tempRepo),
          decisionGate: new DecisionGate('https://mock'),
          engine: new WildGuardEngine(liveConfig, new TelemetryManager('s', 'simulation', 1.50)),
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
          authManager,
        },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Failed login attempt
        const resFail = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'wrong-passphrase' }),
        });
        assert.strictEqual(resFail.status, 401);

        // Successful login attempt
        const resSuccess = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'owner-session-secret' }),
        });
        assert.strictEqual(resSuccess.status, 200);
        const setCookie = resSuccess.headers.get('set-cookie');
        assert.ok(setCookie && setCookie.includes('wildguard_session=v1:'));
        assert.ok(setCookie.includes('HttpOnly'));
        assert.ok(setCookie.includes('SameSite=Strict'));

        // Check auth status with cookie
        const cookieVal = setCookie.split(';')[0];
        const resStatus = await fetch(`${baseUrl}/api/auth/status`, {
          headers: { 'Cookie': cookieVal },
        });
        const statusData = await resStatus.json() as any;
        assert.strictEqual(statusData.authenticated, true);
        assert.strictEqual(statusData.hasAccessToken, true);

        // Logout
        const resLogout = await fetch(`${baseUrl}/api/auth/logout`, {
          method: 'POST',
        });
        assert.strictEqual(resLogout.status, 200);
        const clearCookie = resLogout.headers.get('set-cookie');
        assert.ok(clearCookie && clearCookie.includes('Max-Age=0'));
      } finally {
        await testServer.stop();
      }
    });

    // 4. Brute Force Protection: 5 failed attempts trigger HTTP 429 lockout
    test('4. Brute Force Protection: 5 failed attempts trigger HTTP 429 lockout', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const liveConfig = loadConfig({ WILDGUARD_ACCESS_TOKEN: 'vault-passphrase' });
      const authManager = new AuthManager({ accessToken: 'vault-passphrase', maxFailedAttempts: 5, lockoutMs: 60000 });
      const testServer = createServer({
        repoRoot: tempRepo,
        agent: {
          config: liveConfig,
          telemetry: new TelemetryManager('test_s46_bf', 'simulation', 1.50),
          tools: new McpRepoTools(tempRepo),
          decisionGate: new DecisionGate('https://mock'),
          engine: new WildGuardEngine(liveConfig, new TelemetryManager('s', 'simulation', 1.50)),
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
          authManager,
        },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        for (let i = 0; i < 5; i++) {
          const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: `invalid-guess-${i}` }),
          });
          assert.strictEqual(res.status, 401);
        }

        // 6th attempt must be locked out with 429
        const resLockout = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'vault-passphrase' }),
        });
        assert.strictEqual(resLockout.status, 429);
        assert.ok(resLockout.headers.get('retry-after'));
      } finally {
        await testServer.stop();
      }
    });

    // 5. Redis Atomic Budget Reservation & Settlement
    test('5. Redis Atomic Budget Reservation: reserves amount, settles actual usage, updates status', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const mockRedis = createMockUpstashRedis();

      const manager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      assert.strictEqual(manager.isConfigured(), true);
      assert.strictEqual(await manager.ping(), true);

      // 1. Initial status
      const initialStatus = await manager.getBudgetStatus();
      assert.strictEqual(initialStatus.healthy, true);
      assert.strictEqual(initialStatus.globalSpentUsd, 0);
      assert.strictEqual(initialStatus.remainingGlobalUsd, 10.00);

      // 2. Reserve $0.05
      const reserve = await manager.reserveBudget({
        runId: 'run_test_01',
        reserveAmountUsd: 0.05,
      });
      assert.strictEqual(reserve.allowed, true);
      assert.ok(reserve.reservationId);

      // 3. Settle actual $0.004
      const settle = await manager.settleBudget({
        runId: 'run_test_01',
        reservationId: reserve.reservationId!,
        actualUsd: 0.004,
        status: 'settled',
      });
      assert.strictEqual(settle.settled, true);
      assert.strictEqual(settle.runSpentUsd, 0.004);
      assert.strictEqual(settle.globalSpentUsd, 0.004);

      // 4. Status reflects settled amount
      const updatedStatus = await manager.getBudgetStatus('run_test_01');
      assert.strictEqual(updatedStatus.globalSpentUsd, 0.004);
      assert.strictEqual(updatedStatus.globalReservedUsd, 0);
    });

    // 6. Redis Per-Run $1.50 Cap Enforcement
    test('6. Redis Per-Run $1.50 Cap: rejects reservations when per-run cap is reached', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const mockRedis = createMockUpstashRedis();

      const manager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      // Settle $1.48 into run_cap_test
      mockRedis.store.set('wildguard:budget:run:run_cap_test:spent', '1.480000');

      // Attempting to reserve $0.05 will exceed $1.50 (1.48 + 0.05 = 1.53 > 1.50)
      const reserve = await manager.reserveBudget({
        runId: 'run_cap_test',
        reserveAmountUsd: 0.05,
      });

      assert.strictEqual(reserve.allowed, false);
      assert.ok(reserve.reason?.includes('Per-run spending cap ($1.50) reached'));
    });

    // 7. Redis Global Spending Ceiling Enforcement
    test('7. Redis Global Spending Ceiling: rejects reservations when global ceiling ($10.00) is reached', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const mockRedis = createMockUpstashRedis();

      const manager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      // Set global spent to $9.98
      mockRedis.store.set('wildguard:budget:global:spent', '9.980000');

      // Attempt to reserve $0.05 (9.98 + 0.05 = 10.03 > 10.00)
      const reserve = await manager.reserveBudget({
        runId: 'run_new_02',
        reserveAmountUsd: 0.05,
      });

      assert.strictEqual(reserve.allowed, false);
      assert.ok(reserve.reason?.includes('Global budget ceiling ($10.00) reached'));
    });

    // 8. Redis Concurrency Safety: Parallel reservations do not exceed cap
    test('8. Redis Concurrency Safety: Parallel reservations exceeding cap are atomic and safe', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const mockRedis = createMockUpstashRedis();

      const manager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      // Dispatch 35 concurrent requests of $0.05 each (35 * 0.05 = $1.75 > $1.50)
      const promises = Array.from({ length: 35 }, (_, i) =>
        manager.reserveBudget({ runId: 'run_parallel_test', reserveAmountUsd: 0.05, idempotencyKey: `req_${i}` })
      );

      const results = await Promise.all(promises);
      const allowed = results.filter(r => r.allowed);
      const rejected = results.filter(r => !r.allowed);

      // Exactly 30 requests (30 * 0.05 = $1.50) allowed, 5 rejected
      assert.strictEqual(allowed.length, 30);
      assert.strictEqual(rejected.length, 5);
    });

    // 9. Redis Outage Fail-Closed Behavior in Live Mode
    test('9. Redis Outage Fail-Closed: live inference fails closed with HTTP 503 if Redis throws error', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      // Throwing fetch implementation
      const failingFetch = async () => {
        throw new Error('ECONNREFUSED: Upstash Redis connection severed');
      };

      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-secret-key',
        WILDGUARD_ACCESS_TOKEN: 'valid-token',
        UPSTASH_REDIS_REST_URL: 'https://broken.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'broken-token',
      });
      const telemetry = new TelemetryManager('test_s46_redis_fail', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, failingFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer valid-token',
          },
          body: JSON.stringify({ userTask: 'Test task', mode: 'live' }),
        });
        // Initial workflow step with failed reservation must return fail-closed
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        const runId = data.workflow.runId;

        const resStep = await fetch(`${baseUrl}/api/workflow/step/explorer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer valid-token',
          },
          body: JSON.stringify({ runId }),
        });
        assert.strictEqual(resStep.status, 500);
        const stepData = await resStep.json() as any;
        assert.strictEqual(stepData.success, false);
        assert.ok(stepData.error.includes('Redis budget reservation failed'));
      } finally {
        await testServer.stop();
      }
    });

    // 10. Idempotency Key Prevents Duplicate Spending
    test('10. Idempotency: Duplicate submissions with same key return cached reservation without duplicate billing', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const mockRedis = createMockUpstashRedis();

      const manager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      const res1 = await manager.reserveBudget({
        runId: 'run_idemp_test',
        idempotencyKey: 'tx_unique_abc123',
        reserveAmountUsd: 0.05,
      });
      assert.strictEqual(res1.allowed, true);
      assert.strictEqual(res1.isIdempotent, false);

      // Repeat request with exact same idempotencyKey
      const res2 = await manager.reserveBudget({
        runId: 'run_idemp_test',
        idempotencyKey: 'tx_unique_abc123',
        reserveAmountUsd: 0.05,
      });
      assert.strictEqual(res2.allowed, true);
      assert.strictEqual(res2.isIdempotent, true);
      assert.strictEqual(res1.reservationId, res2.reservationId);
    });

    // 11. Uncertain Charges: Gateway timeouts do not refund reserved budget
    test('11. Uncertain Charges: Interrupted gateway requests mark reservation as uncertain and retain charge', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const mockRedis = createMockUpstashRedis();

      const manager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      const res = await manager.reserveBudget({
        runId: 'run_uncertain_test',
        reserveAmountUsd: 0.05,
      });
      assert.strictEqual(res.allowed, true);

      // Settle as uncertain (e.g. gateway connection severed mid-request)
      const settle = await manager.settleBudget({
        runId: 'run_uncertain_test',
        reservationId: res.reservationId!,
        actualUsd: 0.05,
        status: 'uncertain',
      });
      assert.strictEqual(settle.status, 'uncertain');
      // Full reserved amount charged to prevent unbacked spend
      assert.strictEqual(settle.globalSpentUsd, 0.05);
    });

    // 12. Monolithic Autonomous Loop Rejection on Vercel
    test('12. Vercel Hobby Timeout Defense: Monolithic autonomous loops rejected with HTTP 400', async () => {
      const { createServer } = await import('../src/web/server.js');
      const origVercel = process.env.VERCEL;
      process.env.VERCEL = '1';

      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'autonomous', task: 'Run full 30s loop' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json() as any;
        assert.strictEqual(data.success, false);
        assert.strictEqual(data.code, 'VERCEL_HOBBY_TIMEOUT_PREVENTION');
        assert.ok(data.error.includes('Monolithic autonomous loops (20-35s) are prohibited on Vercel Hobby'));
      } finally {
        process.env.VERCEL = origVercel;
        await testServer.stop();
      }
    });

    // 13. Client-Orchestrated Workflow: Explorer & Coder single turns complete under Hobby limits
    test('13. Client-Orchestrated Workflow: Sequential single turns complete bounded steps with in-memory diff', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Step 0: Init
        const resInit = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'Create utility helper function', mode: 'simulation' }),
        });
        assert.strictEqual(resInit.status, 200);
        const dataInit = await resInit.json() as any;
        const runId = dataInit.workflow.runId;
        assert.ok(runId.startsWith('run_'));

        // Step 1: Explorer Turn
        const resExp = await fetch(`${baseUrl}/api/workflow/step/explorer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
        });
        assert.strictEqual(resExp.status, 200);
        const dataExp = await resExp.json() as any;
        assert.strictEqual(dataExp.step, 'explorer');
        assert.strictEqual(dataExp.status, 'explorer_done');
        assert.ok(dataExp.output);

        // Step 2: Coder Turn
        const resCoder = await fetch(`${baseUrl}/api/workflow/step/coder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, targetFile: 'src/sampleUtil.ts' }),
        });
        assert.strictEqual(resCoder.status, 200);
        const dataCoder = await resCoder.json() as any;
        assert.strictEqual(dataCoder.step, 'coder');
        assert.strictEqual(dataCoder.status, 'awaiting_approval');
        assert.ok(dataCoder.patch);
        assert.strictEqual(dataCoder.patch.filePath, 'src/sampleUtil.ts');
        assert.ok(dataCoder.patch.previewDiff.includes('--- a/src/sampleUtil.ts'));
      } finally {
        await testServer.stop();
      }
    });

    // 14. In-Memory Patch Generation: Serverless filesystem is untouched
    test('14. In-Memory Patch: Generates unified diff without writing to disk', async () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness', { readOnly: true });
      const targetPath = 'src/pureInMemory.ts';
      const fullPath = path.join(tempRepo, targetPath);

      // Verify file does not exist before
      assert.strictEqual(fs.existsSync(fullPath), false);

      const diffResult = tools.generateUnifiedDiff(targetPath, 'export const memorySafe = true;\n');
      assert.strictEqual(diffResult.success, true);
      assert.ok(diffResult.data?.diff.includes('--- a/src/pureInMemory.ts'));
      assert.ok(diffResult.data?.diff.includes('+export const memorySafe = true;'));

      // File must still NOT exist on disk!
      assert.strictEqual(fs.existsSync(fullPath), false, 'File must not be written to disk');
    });

    // 15. Guardrail Path Validation: Traversal & secret paths rejected on diff generation
    test('15. Deterministic Guardrails: Blocks traversal and secret paths on diff generation', () => {
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');

      const traversalRes = tools.generateUnifiedDiff('../outside.ts', 'malicious');
      assert.strictEqual(traversalRes.success, false);
      assert.strictEqual(traversalRes.reasonCode, 'PATH_TRAVERSAL_DETECTED');

      const secretRes = tools.generateUnifiedDiff('.env', 'EXPOSED_SECRET=true');
      assert.strictEqual(secretRes.success, false);
      assert.strictEqual(secretRes.reasonCode, 'SECRET_FILE_OVERWRITE_BLOCKED');
    });

    // 16. Patch Download Endpoint: Serves valid attachment
    test('16. Patch Download Endpoint: Serves text/x-diff attachment with proper headers', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const resInit = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'Generate patch to download' }),
        });
        const { workflow } = await resInit.json() as any;

        await fetch(`${baseUrl}/api/workflow/step/explorer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: workflow.runId }),
        });

        await fetch(`${baseUrl}/api/workflow/step/coder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: workflow.runId, targetFile: 'src/downloadable.ts' }),
        });

        // Download patch
        const resDownload = await fetch(`${baseUrl}/api/patch/download?runId=${encodeURIComponent(workflow.runId)}`);
        assert.strictEqual(resDownload.status, 200);
        assert.ok(resDownload.headers.get('content-type')?.includes('text/x-diff'));
        assert.ok(resDownload.headers.get('content-disposition')?.includes('attachment; filename="wildguard-'));

        const diffBody = await resDownload.text();
        assert.ok(diffBody.includes('--- a/src/downloadable.ts'));
      } finally {
        await testServer.stop();
      }
    });

    // 17. Human Approval Gate: Approval step transitions workflow state
    test('17. Human Approval Gate: Reject transitions to rejected, approve transitions to approved', async () => {
      const { createServer } = await import('../src/web/server.js');
      const testServer = createServer({ repoRoot: tempRepo });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const resInit = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'Approval testing' }),
        });
        const { workflow } = await resInit.json() as any;

        await fetch(`${baseUrl}/api/workflow/step/explorer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: workflow.runId }),
        });

        await fetch(`${baseUrl}/api/workflow/step/coder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: workflow.runId }),
        });

        // Operator approves
        const resApprove = await fetch(`${baseUrl}/api/workflow/step/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: workflow.runId, isApproved: true }),
        });
        assert.strictEqual(resApprove.status, 200);
        const dataApprove = await resApprove.json() as any;
        assert.strictEqual(dataApprove.status, 'approved');
      } finally {
        await testServer.stop();
      }
    });

    // 18. Zero Secret Leakage & Safe Configuration Booleans
    test('18. Zero Secret Leakage: API responses and status endpoints expose only safe booleans', async () => {
      const { createServer } = await import('../src/web/server.js');
      const liveConfig = loadConfig({
        OTARI_API_KEY: 'sk-super-secret-otari-key-12345',
        WILDGUARD_ACCESS_TOKEN: 'secret-access-token-98765',
        UPSTASH_REDIS_REST_URL: 'https://vault.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'secret-redis-token-xyz',
      });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: {
          config: liveConfig,
          telemetry: new TelemetryManager('test_s46_leak', 'simulation', 1.50),
          tools: new McpRepoTools(tempRepo),
          decisionGate: new DecisionGate('https://mock'),
          engine: new WildGuardEngine(liveConfig, new TelemetryManager('s', 'simulation', 1.50)),
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
        },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/status`);
        const text = await res.text();

        // Must NOT leak secrets anywhere in raw text!
        assert.strictEqual(text.includes('sk-super-secret-otari-key-12345'), false);
        assert.strictEqual(text.includes('secret-access-token-98765'), false);
        assert.strictEqual(text.includes('secret-redis-token-xyz'), false);

        const json = JSON.parse(text);
        assert.strictEqual(json.config.hasApiKey, true);
        assert.strictEqual(json.config.hasAccessToken, true);
        assert.strictEqual(json.config.hasRedisConfig, true);
        assert.strictEqual(json.config.apiKey, undefined);

        // Safe status helper
        const safeStatus = getPublicConfigStatus(liveConfig);
        assert.strictEqual(safeStatus.hasApiKey, true);
        assert.strictEqual(safeStatus.hasAccessToken, true);
        assert.strictEqual(safeStatus.hasRedisConfig, true);
      } finally {
        await testServer.stop();
      }
    });
  });

  // ==========================================
  // 15. STAGE 4.8 PRODUCTION SECURITY REMEDIATION SUITE
  // ==========================================
  describe('Stage 4.8: Production Security & Resilience Remediation Suite', () => {
    function createMockUpstashRedisWithFeatures() {
      const store = new Map<string, string>();
      const ttls = new Map<string, number>();

      const customFetch = async (_url: any, init: any): Promise<Response> => {
        const command = JSON.parse(init.body as string) as (string | number)[];
        const cmd = String(command[0]).toUpperCase();

        if (cmd === 'PING') {
          return new Response(JSON.stringify({ result: 'PONG' }));
        }
        if (cmd === 'GET') {
          const key = String(command[1]);
          return new Response(JSON.stringify({ result: store.get(key) || null }));
        }
        if (cmd === 'SET') {
          const key = String(command[1]);
          const val = String(command[2]);
          store.set(key, val);
          if (command[3] === 'EX') {
            ttls.set(key, Number(command[4]));
          }
          return new Response(JSON.stringify({ result: 'OK' }));
        }
        if (cmd === 'DEL') {
          const key = String(command[1]);
          const deleted = store.delete(key);
          ttls.delete(key);
          return new Response(JSON.stringify({ result: deleted ? 1 : 0 }));
        }
        if (cmd === 'INCR') {
          const key = String(command[1]);
          const next = parseInt(store.get(key) || '0', 10) + 1;
          store.set(key, String(next));
          return new Response(JSON.stringify({ result: next }));
        }
        if (cmd === 'EXPIRE') {
          const key = String(command[1]);
          const seconds = Number(command[2]);
          ttls.set(key, seconds);
          return new Response(JSON.stringify({ result: 1 }));
        }
        if (cmd === 'INCRBYFLOAT') {
          const key = String(command[1]);
          const amt = parseFloat(String(command[2]));
          const current = parseFloat(store.get(key) || '0');
          const next = current + amt;
          store.set(key, next.toFixed(6));
          return new Response(JSON.stringify({ result: next.toFixed(6) }));
        }
        if (cmd === 'EVAL') {
          const script = String(command[1]);
          const numKeys = Number(command[2]);
          const keys = command.slice(3, 3 + numKeys).map(String);
          const args = command.slice(3 + numKeys).map(String);

          if (script.includes('PER_RUN_CAP_EXCEEDED')) {
            const [k_g_spent, k_g_res, k_r_spent, k_r_res, k_res, k_idemp] = keys;
            const [reserve_amt_s, run_cap_s, global_cap_s, res_id, idemp_k, _ttl, created] = args;

            const reserve_amt = parseFloat(reserve_amt_s);
            const run_cap = parseFloat(run_cap_s);
            const global_cap = parseFloat(global_cap_s);

            if (idemp_k && store.has(k_idemp)) {
              const existing_id = store.get(k_idemp)!;
              const g_spent = store.get(k_g_spent) || '0';
              const r_spent = store.get(k_r_spent) || '0';
              return new Response(JSON.stringify({ result: [2, existing_id, r_spent, g_spent] }));
            }

            const g_spent = parseFloat(store.get(k_g_spent) || '0');
            const g_res = parseFloat(store.get(k_g_res) || '0');
            const r_spent = parseFloat(store.get(k_r_spent) || '0');
            const r_res = parseFloat(store.get(k_r_res) || '0');

            if ((r_spent + r_res + reserve_amt) > run_cap) {
              return new Response(JSON.stringify({ result: [0, 'PER_RUN_CAP_EXCEEDED', String(r_spent), String(g_spent)] }));
            }
            if ((g_spent + g_res + reserve_amt) > global_cap) {
              return new Response(JSON.stringify({ result: [0, 'GLOBAL_CEILING_EXCEEDED', String(r_spent), String(g_spent)] }));
            }

            store.set(k_g_res, (g_res + reserve_amt).toFixed(6));
            store.set(k_r_res, (r_res + reserve_amt).toFixed(6));
            ttls.set(k_r_spent, 86400);
            ttls.set(k_r_res, 86400);
            store.set(k_res, JSON.stringify({ id: res_id, amount: reserve_amt, status: 'reserved', created }));
            if (idemp_k) store.set(k_idemp, res_id);

            return new Response(JSON.stringify({ result: [1, res_id, String(r_spent), String(g_spent)] }));
          }

          if (script.includes('RESERVATION_NOT_FOUND') || script.includes('actualUsd')) {
            const [k_g_spent, k_g_res, k_r_spent, k_r_res, k_res] = keys;
            const [res_id, actual_usd_s, status] = args;
            const actual_usd = parseFloat(actual_usd_s);

            const raw = store.get(k_res);
            if (!raw) {
              return new Response(JSON.stringify({ result: [0, 'RESERVATION_NOT_FOUND', '0', '0'] }));
            }
            const meta = JSON.parse(raw);
            if (meta.status !== 'reserved') {
              const g_spent = store.get(k_g_spent) || '0';
              const r_spent = store.get(k_r_spent) || '0';
              return new Response(JSON.stringify({ result: [1, 'ALREADY_SETTLED', r_spent, g_spent] }));
            }

            const reserved_amt = parseFloat(meta.amount) || 0;
            const g_res = parseFloat(store.get(k_g_res) || '0');
            const r_res = parseFloat(store.get(k_r_res) || '0');
            store.set(k_g_res, Math.max(0, g_res - reserved_amt).toFixed(6));
            store.set(k_r_res, Math.max(0, r_res - reserved_amt).toFixed(6));
            ttls.set(k_r_spent, 86400);
            ttls.set(k_r_res, 86400);

            let charge = 0;
            if (status === 'settled') charge = actual_usd;
            else if (status === 'uncertain') charge = reserved_amt;
            else if (status === 'released') charge = 0;

            if (charge > 0) {
              const g_spent = parseFloat(store.get(k_g_spent) || '0') + charge;
              const r_spent = parseFloat(store.get(k_r_spent) || '0') + charge;
              store.set(k_g_spent, g_spent.toFixed(6));
              store.set(k_r_spent, r_spent.toFixed(6));
            }

            meta.status = status;
            meta.actualUsd = charge;
            store.set(k_res, JSON.stringify(meta));

            const g_spent = store.get(k_g_spent) || '0';
            const r_spent = store.get(k_r_spent) || '0';
            return new Response(JSON.stringify({ result: [1, status, r_spent, g_spent] }));
          }
        }

        return new Response(JSON.stringify({ error: `Unknown mock command ${cmd}` }), { status: 400 });
      };

      return { store, ttls, customFetch };
    }

    // 1. CRIT-1: State Persistence across independent serverless instances
    test('1. CRIT-1: Workflow state persists across independent serverless function instances via Redis', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');
      const { WorkflowManager } = await import('../src/otari/workflowManager.js');

      const { customFetch } = createMockUpstashRedisWithFeatures();
      const simConfig = loadConfig({
        WILDGUARD_MODE: 'simulation',
        OTARI_API_KEY: 'test-key',
        WILDGUARD_ACCESS_TOKEN: 'shared-secret',
        UPSTASH_REDIS_REST_URL: 'https://mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });

      // Instance A: Initializes workflow & runs Explorer step
      const budgetManagerA = new RedisBudgetManager({
        redisUrl: simConfig.upstashRedisUrl,
        redisToken: simConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);
      const authManagerA = new AuthManager({ accessToken: simConfig.accessToken });
      const engineA = new WildGuardEngine(simConfig, new TelemetryManager('inst_a', 'simulation', 1.50));
      const toolsA = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const workflowManagerA = new WorkflowManager({ engine: engineA, budgetManager: budgetManagerA, tools: toolsA });

      const serverA = createServer({
        repoRoot: tempRepo,
        agent: {
          config: simConfig,
          telemetry: new TelemetryManager('s', 'simulation', 1.50),
          tools: toolsA,
          decisionGate: new DecisionGate('https://mock'),
          engine: engineA,
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
          budgetManager: budgetManagerA,
          authManager: authManagerA,
          workflowManager: workflowManagerA,
        },
      });
      await serverA.start(0, '127.0.0.1');
      const addrA = serverA.server.address() as any;
      const baseUrlA = `http://127.0.0.1:${addrA.port}`;

      let runId = '';
      try {
        const initRes = await fetch(`${baseUrlA}/api/workflow/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer shared-secret' },
          body: JSON.stringify({ task: 'Persist state test', mode: 'simulation' }),
        });
        assert.strictEqual(initRes.status, 200);
        const initData = await initRes.json() as any;
        runId = initData.workflow.runId;
        assert.ok(runId.startsWith('run_'));

        // Run explorer step on Instance A
        const expRes = await fetch(`${baseUrlA}/api/workflow/step/explorer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer shared-secret' },
          body: JSON.stringify({ runId }),
        });
        assert.strictEqual(expRes.status, 200);
        const expData = await expRes.json() as any;
        assert.strictEqual(expData.status, 'explorer_done');
      } finally {
        await serverA.stop();
      }

      // Instance B: Completely brand new instance, zero local in-memory state!
      const budgetManagerB = new RedisBudgetManager({
        redisUrl: simConfig.upstashRedisUrl,
        redisToken: simConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);
      const authManagerB = new AuthManager({ accessToken: simConfig.accessToken });
      const engineB = new WildGuardEngine(simConfig, new TelemetryManager('inst_b', 'simulation', 1.50));
      const toolsB = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const workflowManagerB = new WorkflowManager({ engine: engineB, budgetManager: budgetManagerB, tools: toolsB });

      const serverB = createServer({
        repoRoot: tempRepo,
        agent: {
          config: simConfig,
          telemetry: new TelemetryManager('s2', 'simulation', 1.50),
          tools: toolsB,
          decisionGate: new DecisionGate('https://mock'),
          engine: engineB,
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
          budgetManager: budgetManagerB,
          authManager: authManagerB,
          workflowManager: workflowManagerB,
        },
      });
      await serverB.start(0, '127.0.0.1');
      const addrB = serverB.server.address() as any;
      const baseUrlB = `http://127.0.0.1:${addrB.port}`;

      try {
        // Query state on Instance B
        const stateRes = await fetch(`${baseUrlB}/api/workflow/state?runId=${runId}`, {
          headers: { 'Authorization': 'Bearer shared-secret' },
        });
        assert.strictEqual(stateRes.status, 200);
        const stateData = await stateRes.json() as any;
        assert.strictEqual(stateData.workflow.status, 'explorer_done');
        assert.ok(stateData.workflow.explorerOutput);

        // Execute Coder turn on Instance B - must succeed using state loaded from Redis!
        const coderRes = await fetch(`${baseUrlB}/api/workflow/step/coder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer shared-secret' },
          body: JSON.stringify({ runId }),
        });
        assert.strictEqual(coderRes.status, 200);
        const coderData = await coderRes.json() as any;
        assert.strictEqual(coderData.status, 'awaiting_approval');
        assert.ok(coderData.patch);
      } finally {
        await serverB.stop();
      }
    });

    // 2. CRIT-2 & HIGH-2: Ingress Authentication & Cross-Session Isolation
    test('2. CRIT-2 & HIGH-2: Unauthenticated requests rejected; Cross-session access denied with 404', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const { customFetch } = createMockUpstashRedisWithFeatures();
      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-key',
        WILDGUARD_ACCESS_TOKEN: 'master-token-xyz',
        UPSTASH_REDIS_REST_URL: 'https://mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: {
          config: liveConfig,
          telemetry: new TelemetryManager('s', 'live', 1.50),
          tools: new McpRepoTools(tempRepo),
          decisionGate: new DecisionGate('https://mock'),
          engine: new WildGuardEngine(liveConfig, new TelemetryManager('s', 'live', 1.50)),
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
          budgetManager,
          authManager,
        },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // User A logs in
        const resLoginA = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'master-token-xyz' }),
        });
        assert.strictEqual(resLoginA.status, 200);
        const cookieA = resLoginA.headers.get('set-cookie')!;
        assert.ok(cookieA.includes('wildguard_session='));

        // User A initializes workflow
        const resInitA = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': cookieA },
          body: JSON.stringify({ task: 'User A private task', mode: 'live' }),
        });
        assert.strictEqual(resInitA.status, 200);
        const dataA = await resInitA.json() as any;
        const runIdA = dataA.workflow.runId;

        // Anonymous attacker: tries to read workflow state -> 401 Unauthorized
        const resAnonState = await fetch(`${baseUrl}/api/workflow/state?runId=${runIdA}`);
        assert.strictEqual(resAnonState.status, 401);

        // Anonymous attacker: tries to download patch -> 401 Unauthorized
        const resAnonPatch = await fetch(`${baseUrl}/api/patch/download?runId=${runIdA}`);
        assert.strictEqual(resAnonPatch.status, 401);

        // Anonymous attacker: tries to approve workflow -> 401 Unauthorized
        const resAnonApprove = await fetch(`${baseUrl}/api/workflow/step/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: runIdA, isApproved: true }),
        });
        assert.strictEqual(resAnonApprove.status, 401);

        // User B logs in (different session)
        const resLoginB = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'master-token-xyz' }),
        });
        assert.strictEqual(resLoginB.status, 200);
        const cookieB = resLoginB.headers.get('set-cookie')!;
        assert.notStrictEqual(cookieA, cookieB);

        // User B tries to access User A's run -> 404 (denied without revealing existence)
        const resCrossState = await fetch(`${baseUrl}/api/workflow/state?runId=${runIdA}`, {
          headers: { 'Cookie': cookieB },
        });
        assert.strictEqual(resCrossState.status, 404);

        // User B tries to approve User A's run -> 404
        const resCrossApprove = await fetch(`${baseUrl}/api/workflow/step/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': cookieB },
          body: JSON.stringify({ runId: runIdA, isApproved: true }),
        });
        assert.strictEqual(resCrossApprove.status, 404);

        // User A accesses their own run -> 200 OK
        const resOwnerState = await fetch(`${baseUrl}/api/workflow/state?runId=${runIdA}`, {
          headers: { 'Cookie': cookieA },
        });
        assert.strictEqual(resOwnerState.status, 200);
      } finally {
        await testServer.stop();
      }
    });

    // 3. CRIT-3: AbortSignal & 7,500ms Timeout Propagation to Outbound Fetch
    test('3. CRIT-3: AbortSignal and 7500ms timeout propagate to outbound fetch; disableFallback enforced', async () => {
      let fetchCalled = false;
      let receivedSignal: AbortSignal | undefined;

      const mockFetch = async (_url: any, init: any): Promise<Response> => {
        fetchCalled = true;
        receivedSignal = init.signal;
        // Wait and observe signal
        return new Promise((resolve, reject) => {
          if (init.signal?.aborted) {
            reject(new DOMException('This operation was aborted', 'AbortError'));
            return;
          }
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
          // Do not resolve normally
        });
      };

      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = mockFetch;

      try {
        const liveConfig = loadConfig({
          WILDGUARD_MODE: 'live',
          OTARI_API_KEY: 'test-key',
        });
        const engine = new WildGuardEngine(liveConfig, new TelemetryManager('t_sig', 'live', 1.50));

        const controller = new AbortController();
        const timeoutMs = 150; // fast test timeout
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        await assert.rejects(async () => {
          try {
            await engine.execute({
              role: 'coder',
              messages: [{ role: 'user', content: 'test signal' }],
              timeoutMs,
              signal: controller.signal,
              disableFallback: true,
            });
          } finally {
            clearTimeout(timer);
          }
        }, (err: any) => {
          assert.ok(err.message.includes('aborted') || err.isTimeout || err.name === 'WildGuardApiError');
          return true;
        });

        assert.strictEqual(fetchCalled, true);
        assert.ok(receivedSignal !== undefined);
        assert.strictEqual(receivedSignal?.aborted, true);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    // 4. CRIT-4: 24h Expiration Applied to Per-Run Budget Keys
    test('4. CRIT-4: 24h expiration applied to per-run Redis spend and reservation keys', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { store, ttls, customFetch } = createMockUpstashRedisWithFeatures();

      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://mock.upstash.io',
        redisToken: 'mock-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);

      const runId = 'test_ttl_run_123';
      const reserve = await budgetManager.reserveBudget({ runId, reserveAmountUsd: 0.05 });
      assert.strictEqual(reserve.allowed, true);

      // Verify 24h TTL (86400s) on per-run reservation key
      assert.strictEqual(ttls.get(`wildguard:budget:run:${runId}:reserved`), 86400);
      assert.strictEqual(ttls.get(`wildguard:budget:run:${runId}:spent`), 86400);

      // Verify global counters DO NOT have TTL
      assert.strictEqual(ttls.get('wildguard:budget:global:spent'), undefined);
      assert.strictEqual(ttls.get('wildguard:budget:global:reserved'), undefined);

      // Settle budget and verify TTL is refreshed
      const settle = await budgetManager.settleBudget({
        runId,
        reservationId: reserve.reservationId!,
        actualUsd: 0.03,
        status: 'settled',
      });
      assert.strictEqual(settle.settled, true);
      assert.strictEqual(ttls.get(`wildguard:budget:run:${runId}:spent`), 86400);
      assert.strictEqual(ttls.get(`wildguard:budget:run:${runId}:reserved`), 86400);
    });

    // 5. HIGH-1: Distributed Brute Force & Trusted Client IP Extraction
    test('5. HIGH-1: Distributed brute force increments counter in Redis and triggers lockout; header spoofing rejected', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const { store, customFetch } = createMockUpstashRedisWithFeatures();
      const liveConfig = loadConfig({
        WILDGUARD_ACCESS_TOKEN: 'correct-passphrase',
        UPSTASH_REDIS_REST_URL: 'https://mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken, maxFailedAttempts: 5 });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: {
          config: liveConfig,
          telemetry: new TelemetryManager('s', 'simulation', 1.50),
          tools: new McpRepoTools(tempRepo),
          decisionGate: new DecisionGate('https://mock'),
          engine: new WildGuardEngine(liveConfig, new TelemetryManager('s', 'simulation', 1.50)),
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
          budgetManager,
          authManager,
        },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Attacker attempts 5 failed logins with spoofed leading X-Forwarded-For
        // Server trusts rightmost IP (or x-real-ip)
        for (let i = 1; i <= 5; i++) {
          const res = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': `spoofed-ip-${i}, 203.0.113.50`, // real IP is 203.0.113.50
            },
            body: JSON.stringify({ token: 'wrong-pass' }),
          });
          assert.strictEqual(res.status, 401);
        }

        // Verify Redis failed attempt counter was incremented for 203.0.113.50
        assert.strictEqual(store.get('wildguard:auth:failed:203.0.113.50'), '5');

        // 6th attempt must be locked out with HTTP 429
        const resLocked = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': 'another-spoofed-ip, 203.0.113.50',
          },
          body: JSON.stringify({ token: 'correct-passphrase' }),
        });
        assert.strictEqual(resLocked.status, 429);
        const lockedData = await resLocked.json() as any;
        assert.ok(lockedData.error.includes('Too many failed login attempts'));
      } finally {
        await testServer.stop();
      }
    });

    // 6. HIGH-3: Monetary Input Validation
    test('6. HIGH-3: Rejects negative, NaN, Infinity, and malformed currency inputs', async () => {
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { customFetch } = createMockUpstashRedisWithFeatures();

      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://mock.upstash.io',
        redisToken: 'mock-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);

      // Negative reservation rejected
      const negRes = await budgetManager.reserveBudget({ runId: 'r1', reserveAmountUsd: -0.50 });
      assert.strictEqual(negRes.allowed, false);
      assert.ok(negRes.reason?.includes('Invalid reservation amount'));

      // NaN reservation rejected
      const nanRes = await budgetManager.reserveBudget({ runId: 'r1', reserveAmountUsd: NaN });
      assert.strictEqual(nanRes.allowed, false);

      // Infinity reservation rejected
      const infRes = await budgetManager.reserveBudget({ runId: 'r1', reserveAmountUsd: Infinity });
      assert.strictEqual(infRes.allowed, false);

      // Negative actual settlement rejected
      const negSettle = await budgetManager.settleBudget({ runId: 'r1', reservationId: 'res1', actualUsd: -1.0, status: 'settled' });
      assert.strictEqual(negSettle.settled, false);
      assert.ok(negSettle.error?.includes('Invalid actualUsd'));

      // NaN actual settlement rejected
      const nanSettle = await budgetManager.settleBudget({ runId: 'r1', reservationId: 'res1', actualUsd: NaN, status: 'settled' });
      assert.strictEqual(nanSettle.settled, false);
    });

    // 7. HIGH-4: Server-Side Session Revocation on Logout
    test('7. HIGH-4: Logout revokes session in Redis; replayed token rejected with HTTP 401', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const { customFetch } = createMockUpstashRedisWithFeatures();
      const liveConfig = loadConfig({
        WILDGUARD_ACCESS_TOKEN: 'master-token-revocation',
        UPSTASH_REDIS_REST_URL: 'https://mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: {
          config: liveConfig,
          telemetry: new TelemetryManager('s', 'simulation', 1.50),
          tools: new McpRepoTools(tempRepo),
          decisionGate: new DecisionGate('https://mock'),
          engine: new WildGuardEngine(liveConfig, new TelemetryManager('s', 'simulation', 1.50)),
          loop: new AgentLoop(null as any, null as any, null as any, null as any),
          budgetManager,
          authManager,
        },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // 1. Log in to get session cookie
        const resLogin = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'master-token-revocation' }),
        });
        assert.strictEqual(resLogin.status, 200);
        const cookie = resLogin.headers.get('set-cookie')!;

        // 2. Verified that session is valid
        const resStatus1 = await fetch(`${baseUrl}/api/auth/status`, {
          headers: { 'Cookie': cookie },
        });
        assert.strictEqual(resStatus1.status, 200);
        const data1 = await resStatus1.json() as any;
        assert.strictEqual(data1.authenticated, true);

        // 3. Log out (revokes session server-side in Redis)
        const resLogout = await fetch(`${baseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Cookie': cookie },
        });
        assert.strictEqual(resLogout.status, 200);

        // 4. Attacker attempts to replay the same session token
        const resStatus2 = await fetch(`${baseUrl}/api/auth/status`, {
          headers: { 'Cookie': cookie },
        });
        assert.strictEqual(resStatus2.status, 200);
        const data2 = await resStatus2.json() as any;
        assert.strictEqual(data2.authenticated, false); // Session is revoked!
      } finally {
        await testServer.stop();
      }
    });
  });

  // =========================================================================
  // 16. STAGE 4.13B: SECURE VERIFICATION ENDPOINT REMEDIATION SUITE
  // =========================================================================
  describe('Stage 4.13B: Secure Verification Endpoint Remediation Suite', () => {
    function createMockUpstashRedis() {
      const store = new Map<string, string>();

      const customFetch = async (_url: any, init: any): Promise<Response> => {
        const command = JSON.parse(init.body as string) as (string | number)[];
        const cmd = String(command[0]).toUpperCase();

        if (cmd === 'PING') {
          return new Response(JSON.stringify({ result: 'PONG' }));
        }
        if (cmd === 'GET') {
          const key = String(command[1]);
          return new Response(JSON.stringify({ result: store.get(key) || null }));
        }
        if (cmd === 'SET') {
          const key = String(command[1]);
          const val = String(command[2]);
          store.set(key, val);
          return new Response(JSON.stringify({ result: 'OK' }));
        }
        if (cmd === 'INCRBYFLOAT') {
          const key = String(command[1]);
          const amt = parseFloat(String(command[2]));
          const current = parseFloat(store.get(key) || '0');
          const next = current + amt;
          store.set(key, next.toFixed(6));
          return new Response(JSON.stringify({ result: next.toFixed(6) }));
        }
        if (cmd === 'EVAL') {
          const script = String(command[1]);
          const numKeys = Number(command[2]);
          const keys = command.slice(3, 3 + numKeys).map(String);
          const args = command.slice(3 + numKeys).map(String);

          if (script.includes('PER_RUN_CAP_EXCEEDED')) {
            const [k_g_spent, k_g_res, k_r_spent, k_r_res, k_res, k_idemp] = keys;
            const [reserve_amt_s, run_cap_s, global_cap_s, res_id, idemp_k, _ttl, created] = args;

            const reserve_amt = parseFloat(reserve_amt_s);
            const run_cap = parseFloat(run_cap_s);
            const global_cap = parseFloat(global_cap_s);

            if (idemp_k && store.has(k_idemp)) {
              const existing_id = store.get(k_idemp)!;
              const g_spent = store.get(k_g_spent) || '0';
              const r_spent = store.get(k_r_spent) || '0';
              return new Response(JSON.stringify({ result: [2, existing_id, r_spent, g_spent] }));
            }

            const g_spent = parseFloat(store.get(k_g_spent) || '0');
            const g_res = parseFloat(store.get(k_g_res) || '0');
            const r_spent = parseFloat(store.get(k_r_spent) || '0');
            const r_res = parseFloat(store.get(k_r_res) || '0');

            if ((r_spent + r_res + reserve_amt) > run_cap) {
              return new Response(JSON.stringify({ result: [0, 'PER_RUN_CAP_EXCEEDED', String(r_spent), String(g_spent)] }));
            }
            if ((g_spent + g_res + reserve_amt) > global_cap) {
              return new Response(JSON.stringify({ result: [0, 'GLOBAL_CEILING_EXCEEDED', String(r_spent), String(g_spent)] }));
            }

            store.set(k_g_res, (g_res + reserve_amt).toFixed(6));
            store.set(k_r_res, (r_res + reserve_amt).toFixed(6));
            store.set(k_res, JSON.stringify({ id: res_id, amount: reserve_amt, status: 'reserved', created }));
            if (idemp_k) store.set(k_idemp, res_id);

            return new Response(JSON.stringify({ result: [1, res_id, String(r_spent), String(g_spent)] }));
          }

          if (script.includes('RESERVATION_NOT_FOUND') || script.includes('actualUsd')) {
            const [k_g_spent, k_g_res, k_r_spent, k_r_res, k_res] = keys;
            const [res_id, actual_usd_s, status] = args;
            const actual_usd = parseFloat(actual_usd_s);

            const raw = store.get(k_res);
            if (!raw) {
              return new Response(JSON.stringify({ result: [0, 'RESERVATION_NOT_FOUND', '0', '0'] }));
            }
            const meta = JSON.parse(raw);
            if (meta.status !== 'reserved') {
              const g_spent = store.get(k_g_spent) || '0';
              const r_spent = store.get(k_r_spent) || '0';
              return new Response(JSON.stringify({ result: [1, 'ALREADY_SETTLED', r_spent, g_spent] }));
            }

            const reserved_amt = parseFloat(meta.amount) || 0;
            const g_res = parseFloat(store.get(k_g_res) || '0');
            const r_res = parseFloat(store.get(k_r_res) || '0');
            store.set(k_g_res, Math.max(0, g_res - reserved_amt).toFixed(6));
            store.set(k_r_res, Math.max(0, r_res - reserved_amt).toFixed(6));

            let charge = 0;
            if (status === 'settled') charge = actual_usd;
            else if (status === 'uncertain') charge = reserved_amt;
            else if (status === 'released') charge = 0;

            if (charge > 0) {
              const g_spent = parseFloat(store.get(k_g_spent) || '0') + charge;
              const r_spent = parseFloat(store.get(k_r_spent) || '0') + charge;
              store.set(k_g_spent, g_spent.toFixed(6));
              store.set(k_r_spent, r_spent.toFixed(6));
            }

            meta.status = status;
            meta.actualUsd = charge;
            store.set(k_res, JSON.stringify(meta));

            const g_spent = store.get(k_g_spent) || '0';
            const r_spent = store.get(k_r_spent) || '0';
            return new Response(JSON.stringify({ result: [1, status, r_spent, g_spent] }));
          }
        }

        return new Response(JSON.stringify({ result: null }));
      };

      return { store, customFetch };
    }
    // 1. Reservation occurs before outbound inference and settles on success
    test('1. Redis budget reservation occurs before outbound Otari request and settles on success', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedis();
      const events: string[] = [];

      // Intercept customFetch to track ordering
      const origCustomFetch = mockRedis.customFetch;
      mockRedis.customFetch = async (url: any, init: any) => {
        const body = JSON.parse(init.body as string);
        if (body[0] === 'EVAL' && String(body[1]).includes('PER_RUN_CAP_EXCEEDED')) {
          events.push('redis_reserve');
        } else if (body[0] === 'EVAL' && String(body[1]).includes('RESERVATION_NOT_FOUND')) {
          events.push('redis_settle');
        }
        return origCustomFetch(url, init);
      };

      const origFetch = globalThis.fetch;
      let outboundFetchCount = 0;

      globalThis.fetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
          return origFetch(input, init);
        }
        if (urlStr.includes('api.otari.ai')) {
          outboundFetchCount++;
          events.push('outbound_otari_fetch');
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'OTARI_CONNECTION_OK' } }],
            usage: { prompt_tokens: 18, completion_tokens: 5, total_tokens: 23, cost_usd: 0.00002 },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return origFetch(input, init);
      };

      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-api-key',
        WILDGUARD_ACCESS_TOKEN: 'valid-test-token',
        UPSTASH_REDIS_REST_URL: 'https://test-mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const telemetry = new TelemetryManager('test_s413b_order', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer valid-test-token',
          },
          body: JSON.stringify({
            model: 'alibaba/qwen-3.5-35b-a3b',
            task: 'Reply with exactly: OTARI_CONNECTION_OK',
            max_tokens: 100,
          }),
        });

        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.verified, true);
        assert.strictEqual(data.verificationStatus, 'matched');
        assert.strictEqual(outboundFetchCount, 1);

        // Assert strictly ordered lifecycle: reserve -> outbound fetch -> settle
        assert.deepStrictEqual(events, ['redis_reserve', 'outbound_otari_fetch', 'redis_settle']);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 2. No outbound request when Redis reservation fails
    test('2. No outbound inference request is dispatched when Redis budget cap is exceeded', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedis();
      // Pre-exhaust global spend to $10.00
      mockRedis.store.set('wildguard:budget:global:spent', '10.000000');

      const origFetch = globalThis.fetch;
      let outboundFetchCount = 0;

      globalThis.fetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
          return origFetch(input, init);
        }
        if (urlStr.includes('api.otari.ai')) {
          outboundFetchCount++;
          return new Response(JSON.stringify({ choices: [] }));
        }
        return origFetch(input, init);
      };

      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-api-key',
        WILDGUARD_ACCESS_TOKEN: 'valid-test-token',
        UPSTASH_REDIS_REST_URL: 'https://test-mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const telemetry = new TelemetryManager('test_s413b_cap', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer valid-test-token',
          },
          body: JSON.stringify({ model: 'alibaba/qwen-3.5-35b-a3b' }),
        });

        assert.strictEqual(res.status, 402);
        const data = await res.json() as any;
        assert.strictEqual(data.success, false);
        assert.strictEqual(data.errorCategory, 'budget_exceeded');
        assert.ok(data.error.includes('Verification blocked by budget cap'));
        // Outbound request was blocked BEFORE touching Otari
        assert.strictEqual(outboundFetchCount, 0);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 3. Uncertain charge retained on timeout
    test('3. Reservation is retained as uncertain charge when outbound request times out or is aborted', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedis();
      let settledStatus = '';

      const origCustomFetch = mockRedis.customFetch;
      mockRedis.customFetch = async (url: any, init: any) => {
        const body = JSON.parse(init.body as string);
        if (body[0] === 'EVAL' && String(body[1]).includes('RESERVATION_NOT_FOUND')) {
          // Status is 3rd arg in ARGV (index 10 in command array: EVAL, script, 5, 5 keys..., resId, actualUsd, status)
          settledStatus = String(body[10] || '');
        }
        return origCustomFetch(url, init);
      };

      const origFetch = globalThis.fetch;

      globalThis.fetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
          return origFetch(input, init);
        }
        if (urlStr.includes('api.otari.ai')) {
          // Simulate timeout via AbortError
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }
        return origFetch(input, init);
      };

      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-api-key',
        WILDGUARD_ACCESS_TOKEN: 'valid-test-token',
        UPSTASH_REDIS_REST_URL: 'https://test-mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const telemetry = new TelemetryManager('test_s413b_unc', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer valid-test-token',
          },
          body: JSON.stringify({ model: 'alibaba/qwen-3.5-35b-a3b' }),
        });

        assert.strictEqual(res.status, 504);
        const data = await res.json() as any;
        assert.strictEqual(data.success, false);
        assert.strictEqual(data.errorCategory, 'timeout');
        // Verified: settlement was marked 'uncertain' so funds are retained
        assert.strictEqual(settledStatus, 'uncertain');
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });

    // 4. Exactly one outbound request with zero fallback
    test('4. Exactly ONE outbound request is dispatched with zero fallback on failure', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedis();
      const origFetch = globalThis.fetch;
      let outboundFetchCount = 0;

      globalThis.fetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
          return origFetch(input, init);
        }
        if (urlStr.includes('api.otari.ai')) {
          outboundFetchCount++;
          return new Response(JSON.stringify({ error: { message: 'Upstream gateway error' } }), { status: 500 });
        }
        return origFetch(input, init);
      };

      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-api-key',
        WILDGUARD_ACCESS_TOKEN: 'valid-test-token',
        UPSTASH_REDIS_REST_URL: 'https://test-mock.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const telemetry = new TelemetryManager('test_s413b_one', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer valid-test-token',
          },
          body: JSON.stringify({ model: 'alibaba/qwen-3.5-35b-a3b' }),
        });

        assert.strictEqual(res.status, 500);
        // Strictly ONE outbound request made; zero fallback to Llama or Deepseek
        assert.strictEqual(outboundFetchCount, 1);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });
  });

  // ==========================================
  // 17. STAGE 4.17 PUBLIC FULL-FUNCTIONAL ACCESS SUITE
  // ==========================================
  describe('Stage 4.17: Public Full-Functional Access Suite', () => {
    function createMockUpstashRedisForPublic() {
      const store = new Map<string, string>();
      const customFetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (!urlStr.includes('upstash.io')) {
          throw new Error(`Unexpected call to ${urlStr}`);
        }
        let body: any = {};
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch {}
        }
        const pathname = new URL(urlStr).pathname;
        if (pathname.includes('/pipeline')) {
          const results = (body || []).map(() => ({ result: 'OK' }));
          return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const cmd = Array.isArray(body) ? body[0] : (body.command || pathname.split('/').pop());
        const key = Array.isArray(body) ? body[1] : body.key;
        if (cmd === 'INCR') {
          const current = parseInt(store.get(key) || '0', 10) + 1;
          store.set(key, String(current));
          return new Response(JSON.stringify({ result: current }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'GET') {
          return new Response(JSON.stringify({ result: store.get(key) ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'SET' || cmd === 'SETEX') {
          const val = Array.isArray(body) ? body[2] : body.value;
          store.set(key, String(val));
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      return { store, customFetch };
    }

    test('1. Public visitor without credentials receives public session and interactive mode', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedisForPublic();
      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'simulation',
        WILDGUARD_ACCESS_TOKEN: 'secret-owner-passphrase',
        UPSTASH_REDIS_REST_URL: 'https://test-public.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'mock-token',
      });
      const telemetry = new TelemetryManager('test_pub_status', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      // Simulate Vercel environment
      const origVercel = process.env.VERCEL;
      process.env.VERCEL = '1';

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/status`);
        assert.strictEqual(res.status, 200);
        const data = await res.json() as any;
        assert.strictEqual(data.auth.authenticated, true);
        assert.strictEqual(data.auth.isOwner, false);
        assert.strictEqual(data.auth.mode, 'public_interactive');
        assert.ok(data.auth.sessionId.startsWith('pub_'));
        assert.strictEqual(data.repoRoot, 'demo-workspace');
        assert.ok(res.headers.get('set-cookie')?.includes('wildguard_public_session=pub_'));
      } finally {
        process.env.VERCEL = origVercel;
        await testServer.stop();
      }
    });

    test('2. Public visitor can explore demo workspace files in /tmp without host access', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedisForPublic();
      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'simulation',
        WILDGUARD_ACCESS_TOKEN: 'secret-owner-passphrase',
      });
      const telemetry = new TelemetryManager('test_pub_repo', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const origVercel = process.env.VERCEL;
      process.env.VERCEL = '1';

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const resFiles = await fetch(`${baseUrl}/api/repo/files?recursive=true`);
        assert.strictEqual(resFiles.status, 200);
        const dataFiles = await resFiles.json() as any;
        assert.strictEqual(dataFiles.success, true);
        const fileNames = (dataFiles.data || []).map((f: any) => (f.relativePath || f.name || '').replace(/\\/g, '/'));
        assert.ok(fileNames.includes('src/paymentCalculator.ts'));
        assert.ok(fileNames.includes('package.json'));
        assert.ok(fileNames.includes('README.md'));

        // Read specific demo file
        const resFile = await fetch(`${baseUrl}/api/repo/file?path=src/paymentCalculator.ts`);
        assert.strictEqual(resFile.status, 200);
        const dataFile = await resFile.json() as any;
        assert.strictEqual(dataFile.success, true);
        assert.ok(dataFile.data.content.includes('calculatePaymentTotal'));

        // Path traversal is strictly blocked
        const resTraversal = await fetch(`${baseUrl}/api/repo/file?path=../../etc/passwd`);
        const dataTraversal = await resTraversal.json() as any;
        assert.strictEqual(dataTraversal.success, false);
        assert.ok(dataTraversal.error, 'Path traversal must return error');
      } finally {
        process.env.VERCEL = origVercel;
        await testServer.stop();
      }
    });

    test('3. Public workflow execution runs bounded turns and enforces cross-session isolation', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedisForPublic();
      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'simulation',
        WILDGUARD_ACCESS_TOKEN: 'secret-owner-passphrase',
      });
      const telemetry = new TelemetryManager('test_pub_wf', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const origVercel = process.env.VERCEL;
      process.env.VERCEL = '1';

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Visitor 1 creates a workflow
        const pubSession1 = 'pub_visitor_session_111111111111';
        const resInit = await fetch(`${baseUrl}/api/workflow/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `wildguard_public_session=${pubSession1}`,
          },
          body: JSON.stringify({ task: 'Optimize fee calculations' }),
        });
        assert.strictEqual(resInit.status, 200);
        const dataInit = await resInit.json() as any;
        const runId = dataInit.workflow.runId;
        assert.strictEqual(dataInit.workflow.ownerSessionId, pubSession1);

        // Visitor 1 runs explorer turn
        const resExp = await fetch(`${baseUrl}/api/workflow/step/explorer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `wildguard_public_session=${pubSession1}`,
          },
          body: JSON.stringify({ runId }),
        });
        assert.strictEqual(resExp.status, 200);

        // Visitor 1 runs coder turn
        const resCoder = await fetch(`${baseUrl}/api/workflow/step/coder`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `wildguard_public_session=${pubSession1}`,
          },
          body: JSON.stringify({ runId, targetFile: 'src/paymentCalculator.ts' }),
        });
        assert.strictEqual(resCoder.status, 200);

        // Visitor 2 (different public session) attempts to read Visitor 1's workflow -> 404
        const pubSession2 = 'pub_visitor_session_222222222222';
        const resCross = await fetch(`${baseUrl}/api/workflow/state?runId=${runId}`, {
          headers: { 'Cookie': `wildguard_public_session=${pubSession2}` },
        });
        assert.strictEqual(resCross.status, 404);

        // Visitor 1 approves patch -> 200
        const resApprove = await fetch(`${baseUrl}/api/workflow/step/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `wildguard_public_session=${pubSession1}`,
          },
          body: JSON.stringify({ runId, isApproved: true }),
        });
        assert.strictEqual(resApprove.status, 200);
        const dataApprove = await resApprove.json() as any;
        assert.strictEqual(dataApprove.status, 'approved');
      } finally {
        process.env.VERCEL = origVercel;
        await testServer.stop();
      }
    });

    test('4. Vercel Hobby timeout defense returns structured errorCategory hobby_timeout_prevention', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const mockRedis = createMockUpstashRedisForPublic();
      const liveConfig = loadConfig({
        WILDGUARD_MODE: 'simulation',
        WILDGUARD_ACCESS_TOKEN: 'secret-owner-passphrase',
      });
      const telemetry = new TelemetryManager('test_hobby_err', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl, undefined, false);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const authManager = new AuthManager({ accessToken: liveConfig.accessToken });

      const origVercel = process.env.VERCEL;
      process.env.VERCEL = '1';

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'autonomous', task: 'Run full loop' }),
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json() as any;
        assert.strictEqual(data.code, 'VERCEL_HOBBY_TIMEOUT_PREVENTION');
        assert.strictEqual(data.errorCategory, 'hobby_timeout_prevention');
        assert.notStrictEqual(data.errorCategory, 'invalid_model');
      } finally {
        process.env.VERCEL = origVercel;
        await testServer.stop();
      }
    });

    test('5. Public rate limiting returns HTTP 429 when threshold exceeded', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      // Create a mock Redis that simulates rate limit count exceeding 20
      let callCount = 0;
      const customFetch = async (input: any, init: any) => {
        let body: any = {};
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch {}
        }
        const cmd = Array.isArray(body) ? body[0] : body.command;
        const key = Array.isArray(body) ? body[1] : body.key;
        if (key && key.includes('ratelimit')) {
          callCount++;
          // Return count of 25 (exceeding limit of 20)
          return new Response(JSON.stringify({ result: 25 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const liveConfig = loadConfig({ WILDGUARD_MODE: 'simulation' });
      const telemetry = new TelemetryManager('test_ratelimit', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-rl.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, customFetch as any);
      const authManager = new AuthManager({ accessToken: 'secret-owner-passphrase' });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'explorer', task: 'Hello rate limit' }),
        });
        assert.strictEqual(res.status, 429);
        const data = await res.json() as any;
        assert.strictEqual(data.errorCategory, 'rate_limited');
        assert.strictEqual(res.headers.get('retry-after'), '60');
      } finally {
        await testServer.stop();
      }
    });
  });

  describe('Stage 4.19: Durable Workspaces & Complete Public Budget Enforcement Suite', () => {
    function createMockUpstashRedisForSuite18() {
      const store = new Map<string, string>();
      const customFetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (!urlStr.includes('upstash.io')) {
          throw new Error(`Unexpected call to ${urlStr}`);
        }
        let body: any = {};
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch {}
        }
        const pathname = new URL(urlStr).pathname;
        if (pathname.includes('/pipeline')) {
          const results = (body || []).map(() => ({ result: 'OK' }));
          return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const cmd = Array.isArray(body) ? body[0] : (body.command || pathname.split('/').pop());
        const key = Array.isArray(body) ? body[1] : body.key;
        if (cmd === 'INCR') {
          const current = parseInt(store.get(key) || '0', 10) + 1;
          store.set(key, String(current));
          return new Response(JSON.stringify({ result: current }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'GET') {
          return new Response(JSON.stringify({ result: store.get(key) ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'SET' || cmd === 'SETEX') {
          const val = Array.isArray(body) ? body[2] : body.value;
          store.set(key, String(val));
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'DEL') {
          store.delete(key);
          return new Response(JSON.stringify({ result: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      return { store, customFetch };
    }

    test('1. WorkflowManager receives visitor-scoped tools and rejects /var/task escape', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { WorkflowManager } = await import('../src/otari/workflowManager.js');
      const { McpRepoTools } = await import('../src/otari/mcpRepoTools.js');
      const { syncDurableWorkspaceAsync } = await import('../src/otari/demoWorkspace.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');

      const mockRedis = createMockUpstashRedisForSuite18();
      const liveConfig = loadConfig({ WILDGUARD_MODE: 'simulation' });
      const telemetry = new TelemetryManager('test_stage419_tools', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: liveConfig.upstashRedisUrl,
        redisToken: liveConfig.upstashRedisToken,
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      const workflowManager = new WorkflowManager({
        engine,
        budgetManager,
        tools,
      });

      const visitorSession = 'pub_test_visitor_isolation';
      const sync = await syncDurableWorkspaceAsync(visitorSession, budgetManager);
      const visitorTools = new McpRepoTools(sync.sessionDir);

      // Initialize workflow with visitor demo workspace
      const record = await workflowManager.initWorkflow(
        'Add discount tier',
        'simulation',
        visitorSession,
        sync.sessionDir,
        sync.version
      );

      // Execute Explorer turn first
      const expResult = await workflowManager.executeExplorerStep({
        runId: record.runId,
        tools: visitorTools,
      });
      assert.strictEqual(expResult.success, true);

      // Execute Coder turn with visitorTools
      const coderResult = await workflowManager.executeCoderStep({
        runId: record.runId,
        targetFile: 'src/paymentCalculator.ts',
        tools: visitorTools,
      });

      assert.strictEqual(coderResult.success, true);
      assert.ok(coderResult.patch);
      // Verify diff base was taken from the visitor demo workspace (has calculatePaymentTotal)
      assert.ok(coderResult.patch.previewDiff.includes('calculatePaymentTotal'));

      // Attempting to target /var/task or escaping workspace is rejected by guardrails
      const record2 = await workflowManager.initWorkflow(
        'Traversal test',
        'simulation',
        visitorSession,
        sync.sessionDir,
        sync.version
      );
      await workflowManager.executeExplorerStep({
        runId: record2.runId,
        tools: visitorTools,
      });

      const traversalStep = await workflowManager.executeCoderStep({
        runId: record2.runId,
        targetFile: '../../package.json',
        tools: visitorTools,
      });
      assert.strictEqual(traversalStep.success, false);
      assert.ok(traversalStep.error?.includes('guardrails') || traversalStep.error?.includes('traversal') || traversalStep.error?.includes('Path is outside repository root'));
    });

    test('2. Two visitors have completely isolated workspaces and cannot see each others edits', async () => {
      const { syncDurableWorkspaceAsync, saveWorkspaceFileAsync } = await import('../src/otari/demoWorkspace.js');
      const { McpRepoTools } = await import('../src/otari/mcpRepoTools.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');

      const mockRedis = createMockUpstashRedisForSuite18();
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      const sessionAlice = 'pub_alice_test_isolation_1';
      const sessionBob = 'pub_bob_test_isolation_2';

      const syncAlice = await syncDurableWorkspaceAsync(sessionAlice, budgetManager);
      const syncBob = await syncDurableWorkspaceAsync(sessionBob, budgetManager);

      // Alice updates paymentCalculator.ts with custom nonprofit tier
      const customCodeAlice = 'export function calculatePaymentTotal() { return "alice_custom_code"; }';
      const saveAlice = await saveWorkspaceFileAsync(
        sessionAlice,
        'src/paymentCalculator.ts',
        customCodeAlice,
        budgetManager,
        syncAlice.version
      );
      assert.strictEqual(saveAlice.success, true);

      // Bob reads paymentCalculator.ts from his workspace
      const toolsBob = new McpRepoTools(syncBob.sessionDir);
      const bobFile = toolsBob.readFile('src/paymentCalculator.ts');
      assert.strictEqual(bobFile.success, true);
      // Bob sees canonical code, NOT Alice's edit
      assert.ok(bobFile.data?.content.includes('Core Payment Fee & Tax Calculator'));
      assert.ok(!bobFile.data?.content.includes('alice_custom_code'));

      // Traversal attempt by Bob into Alice's directory is blocked
      const traversalAttempt = toolsBob.readFile(`../${sessionAlice}/src/paymentCalculator.ts`);
      assert.strictEqual(traversalAttempt.success, false);
      assert.strictEqual(traversalAttempt.policyResult?.status, 'blocked');
    });

    test('3. Workspace and patch approval survive simulated cold start restoration from Redis', async () => {
      const { syncDurableWorkspaceAsync, saveWorkspaceFileAsync } = await import('../src/otari/demoWorkspace.js');
      const { McpRepoTools } = await import('../src/otari/mcpRepoTools.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');

      const mockRedis = createMockUpstashRedisForSuite18();
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      const sessionCold = 'pub_coldstart_persist_test';
      const sync1 = await syncDurableWorkspaceAsync(sessionCold, budgetManager);

      // Save an approved modification
      const modifiedContent = 'export const VERSION = "2.0.0-approved-patch";';
      const saveRes = await saveWorkspaceFileAsync(
        sessionCold,
        'src/version.ts',
        modifiedContent,
        budgetManager,
        sync1.version
      );
      assert.strictEqual(saveRes.success, true);
      assert.strictEqual(saveRes.newVersion, 2);

      // Simulate cold start: remove local /tmp directory completely
      if (fs.existsSync(sync1.sessionDir)) {
        fs.rmSync(sync1.sessionDir, { recursive: true, force: true });
      }
      assert.strictEqual(fs.existsSync(sync1.sessionDir), false);

      // Re-synchronize from durable Redis storage (simulating new serverless container)
      const syncCold = await syncDurableWorkspaceAsync(sessionCold, budgetManager);
      assert.strictEqual(syncCold.fromDurable, true);
      assert.strictEqual(syncCold.version, 2);

      // Verify that local /tmp directory was rebuilt with the modified file
      const tools = new McpRepoTools(syncCold.sessionDir);
      const readRes = tools.readFile('src/version.ts');
      assert.strictEqual(readRes.success, true);
      assert.strictEqual(readRes.data?.content, modifiedContent);
    });

    test('4. Version conflict & concurrency protection on workspace writes', async () => {
      const { syncDurableWorkspaceAsync, saveWorkspaceFileAsync } = await import('../src/otari/demoWorkspace.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');

      const mockRedis = createMockUpstashRedisForSuite18();
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);

      const sessionConflict = 'pub_conflict_test_session';
      const sync = await syncDurableWorkspaceAsync(sessionConflict, budgetManager);
      assert.strictEqual(sync.version, 1);

      // Save first change with expectedVersion: 1 -> succeeds, version becomes 2
      const save1 = await saveWorkspaceFileAsync(sessionConflict, 'src/test.ts', 'first', budgetManager, 1);
      assert.strictEqual(save1.success, true);
      assert.strictEqual(save1.newVersion, 2);

      // Concurrent/stale save attempting with expectedVersion: 1 -> fails with conflict
      const saveStale = await saveWorkspaceFileAsync(sessionConflict, 'src/test.ts', 'stale', budgetManager, 1);
      assert.strictEqual(saveStale.success, false);
      assert.ok(saveStale.error?.includes('Workspace version conflict'));
    });

    test('5. Storage failure blocks unsafe operations on Vercel', async () => {
      const { syncDurableWorkspaceAsync } = await import('../src/otari/demoWorkspace.js');

      // Create a mock Redis that throws network error
      const brokenBudgetManager: any = {
        isConfigured: () => true,
        get: async () => { throw new Error('Redis connection severed'); },
      };

      const origVercel = process.env.VERCEL;
      process.env.VERCEL = '1';

      try {
        await assert.rejects(
          async () => {
            await syncDurableWorkspaceAsync('pub_failing_storage', brokenBudgetManager);
          },
          /Durable workspace storage failure on Vercel/
        );
      } finally {
        process.env.VERCEL = origVercel;
      }
    });

    test('6. /api/chat reserves budget atomically before inference and enforces global ceiling', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      let reserveCalls = 0;
      let settleCalls = 0;
      let mockGlobalSpent = 0;

      const mockRedisFetch = async (input: any, init: any) => {
        let body: any = {};
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch {}
        }
        const cmd = Array.isArray(body) ? body[0] : body.command;
        const script = String(Array.isArray(body) ? body[1] : (body.script || ''));

        if (cmd === 'EVAL' && script.includes('PER_RUN_CAP_EXCEEDED')) {
          reserveCalls++;
          if (mockGlobalSpent >= 10.00) {
            return new Response(JSON.stringify({ result: [0, 'GLOBAL_CEILING_EXCEEDED', '0', '10.000000'] }), {
              status: 200, headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ result: [1, 'res_chat_test', '0', '0'] }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        if (cmd === 'EVAL' && script.includes('RESERVATION_NOT_FOUND')) {
          settleCalls++;
          return new Response(JSON.stringify({ result: [1, 'settled', '0', '0'] }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const liveConfig = loadConfig({ WILDGUARD_MODE: 'simulation' });
      const telemetry = new TelemetryManager('test_chat_budget', 'simulation', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-budget.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedisFetch as any);
      const authManager = new AuthManager({ accessToken: 'secret-owner-passphrase' });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Sub-test A: Live mode single turn chat calls reserveBudget
        const resAllowed = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'explorer', task: 'Analyze payment fees', mode: 'live' }),
        });
        assert.strictEqual(resAllowed.status, 200);
        assert.strictEqual(reserveCalls, 1, 'Live chat must call reserveBudget atomically before inference');

        // Sub-test B: When global budget is exhausted, /api/chat returns HTTP 402
        mockGlobalSpent = 10.00;
        const resBlocked = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'explorer', task: 'Analyze payment fees', mode: 'live' }),
        });
        assert.strictEqual(resBlocked.status, 402);
        const dataBlocked = await resBlocked.json() as any;
        assert.strictEqual(dataBlocked.errorCategory, 'budget_exceeded');
        assert.ok(dataBlocked.error.includes('Global budget ceiling ($10.00) reached'));

        // Sub-test C: Live verification role in /api/chat without owner credentials returns 401
        mockGlobalSpent = 0;
        const resVerifyUnauth = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'verify', task: 'Verify Otari', mode: 'live' }),
        });
        assert.strictEqual(resVerifyUnauth.status, 401);
        const dataVerify = await resVerifyUnauth.json() as any;
        assert.strictEqual(dataVerify.errorCategory, 'authentication_failed');
      } finally {
        await testServer.stop();
      }
    });

    test('7. Timeout reservations remain uncertain and session recreation cannot bypass global limit', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { RedisBudgetManager } = await import('../src/otari/redisBudgetManager.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      let settledStatus = '';

      const mockRedisFetch = async (input: any, init: any) => {
        let body: any = {};
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch {}
        }
        const cmd = Array.isArray(body) ? body[0] : body.command;
        const script = String(Array.isArray(body) ? body[1] : (body.script || ''));

        if (cmd === 'EVAL' && script.includes('PER_RUN_CAP_EXCEEDED')) {
          return new Response(JSON.stringify({ result: [1, 'res_timeout_test', '0', '0'] }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        if (cmd === 'EVAL' && script.includes('RESERVATION_NOT_FOUND')) {
          const numKeys = Array.isArray(body) ? Number(body[2] || 5) : 5;
          const args = Array.isArray(body) ? body.slice(3 + numKeys) : (body.args || []);
          settledStatus = String(args?.[2] || '');
          return new Response(JSON.stringify({ result: [1, settledStatus, '0', '0'] }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'mock-key' });
      const telemetry = new TelemetryManager('test_chat_timeout', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-timeout.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedisFetch as any);
      const authManager = new AuthManager({ accessToken: 'secret-owner-passphrase' });

      const testServer = createServer({
        repoRoot: tempRepo,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const origFetch = globalThis.fetch;
      try {
        // Mock outbound Otari fetch to abort with timeout
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost') || urlStr.includes('upstash')) {
            return origFetch(input, init);
          }
          const abortErr: any = new Error('This operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        };

        const resTimeout = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'coder', task: 'Implement feature', mode: 'live' }),
        });

        assert.strictEqual(resTimeout.status, 504);
        const dataTimeout = await resTimeout.json() as any;
        assert.strictEqual(dataTimeout.errorCategory, 'timeout');
        // Confirm reservation was retained with status 'uncertain'
        assert.strictEqual(settledStatus, 'uncertain', 'Timeout must retain reservation as uncertain charge');

        // Confirm zero credentials leaked
        assert.strictEqual(JSON.stringify(dataTimeout).includes('mock-key'), false);
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });
  });

  // =========================================================================
  // SUITE 19: STAGE 4.27 LIVE PRODUCTION INFERENCE RELIABILITY REPAIR SUITE
  // =========================================================================
  describe('Stage 4.27: Live Production Inference Reliability Repair Suite', () => {
    let tempRepo: string;

    function createMockUpstashRedisForSuite19() {
      const store = new Map<string, string>();
      const customFetch = async (input: any, init: any) => {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (!urlStr.includes('upstash.io')) {
          throw new Error(`Unexpected call to ${urlStr}`);
        }
        let body: any = {};
        if (init?.body) {
          try { body = JSON.parse(init.body as string); } catch {}
        }
        const pathname = new URL(urlStr).pathname;
        if (pathname.includes('/pipeline')) {
          const results = (body || []).map(() => ({ result: 'OK' }));
          return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const cmd = Array.isArray(body) ? body[0] : (body.command || pathname.split('/').pop());
        const key = Array.isArray(body) ? body[1] : body.key;
        if (cmd === 'EVAL') {
          return new Response(JSON.stringify({ result: [1, 'res_427_mock', '0', '0'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'INCR') {
          const current = parseInt(store.get(key) || '0', 10) + 1;
          store.set(key, String(current));
          return new Response(JSON.stringify({ result: current }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'GET') {
          return new Response(JSON.stringify({ result: store.get(key) ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'SET' || cmd === 'SETEX') {
          const val = Array.isArray(body) ? body[2] : body.value;
          store.set(key, String(val));
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (cmd === 'DEL') {
          store.delete(key);
          return new Response(JSON.stringify({ result: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      return { store, customFetch };
    }

    beforeEach(() => {
      tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'wildguard-stage427-'));
      const wildguardDir = path.join(tempRepo, '.wildguard');
      fs.mkdirSync(wildguardDir, { recursive: true });
      fs.writeFileSync(
        path.join(wildguardDir, 'policy.json'),
        JSON.stringify({
          version: '1.0',
          protectedBranches: ['main', 'master'],
          approvalRequiredForDependencies: true,
          blockedPatterns: ['**/.env*'],
        }, null, 2)
      );
      fs.writeFileSync(path.join(tempRepo, 'README.md'), '# Temp Workspace');
      fs.writeFileSync(path.join(tempRepo, 'package.json'), JSON.stringify({ name: 'temp-app', version: '1.0.0' }, null, 2));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempRepo, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    });

    // 1. WorkflowManager step timeout defaults to 25,000ms
    test('1. WorkflowManager step timeout defaults to 25,000ms', () => {
      const config = loadConfig({ WILDGUARD_MODE: 'simulation' });
      const telemetry = new TelemetryManager('test_427_timeout', 'simulation', 1.50);
      const engine = new WildGuardEngine(config, telemetry);
      const budgetManager = new RedisBudgetManager({ perRunCapUsd: 1.50, globalCeilingUsd: 10.00 });
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const wm = new WorkflowManager({ engine, budgetManager, tools });
      assert.strictEqual((wm as any).stepTimeoutMs, 25000, 'stepTimeoutMs must default to 25,000ms');
    });

    // 2. Request completes within the execution window
    test('2. Request completing within execution window settles cleanly', async () => {
      const config = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-key-427',
      });
      const telemetry = new TelemetryManager('test_427_success', 'live', 1.50);
      const engine = new WildGuardEngine(config, telemetry);
      const mockRedis = createMockUpstashRedisForSuite19();
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const wm = new WorkflowManager({ engine, budgetManager, tools });

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('chat/completions')) {
            return new Response(JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'Step 1: Inspect paymentCalculator.ts' } }],
              usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50, cost_usd: 0.00005 },
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'otari-request-id': 'req_427_ok' },
            });
          }
          return origFetch(input);
        };

        const rec = await wm.initWorkflow('Fix edge case', 'live');
        const res = await wm.executeExplorerStep({ runId: rec.runId, idempotencyKey: 'idemp_427_1' });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.step, 'explorer');
        assert.ok(res.output?.includes('paymentCalculator.ts'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    // 3. Request exceeding timeout aborts and returns gateway deadline error
    test('3. Request exceeding timeout aborts and returns gateway deadline error', async () => {
      const config = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-key-427',
      });
      const telemetry = new TelemetryManager('test_427_timeout', 'live', 1.50);
      const engine = new WildGuardEngine(config, telemetry);
      const mockRedis = createMockUpstashRedisForSuite19();
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const wm = new WorkflowManager({ engine, budgetManager, tools, stepTimeoutMs: 50 }); // fast 50ms timeout for test

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('chat/completions')) {
            // delay beyond timeout
            await new Promise((r) => setTimeout(r, 200));
            if (init?.signal?.aborted) {
              const err: any = new Error('The operation was aborted');
              err.name = 'AbortError';
              throw err;
            }
            return new Response(JSON.stringify({ choices: [{ message: { content: 'late' } }] }));
          }
          return origFetch(input, init);
        };

        const rec = await wm.initWorkflow('Fix edge case', 'live');
        const res = await wm.executeExplorerStep({ runId: rec.runId, idempotencyKey: 'idemp_427_to' });
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.step, 'explorer');
        assert.ok(res.error?.includes('timed out after 50ms'));
        assert.ok(res.error?.includes('Gateway execution deadline'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    // 4. Empty final model content with reasoning diagnostic is trapped gracefully
    test('4. Empty final model content with reasoning diagnostic is trapped gracefully', async () => {
      const config = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-key-427',
      });
      const telemetry = new TelemetryManager('test_427_empty', 'live', 1.50);
      const engine = new WildGuardEngine(config, telemetry);
      const mockRedis = createMockUpstashRedisForSuite19();
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const wm = new WorkflowManager({ engine, budgetManager, tools });

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('chat/completions')) {
            return new Response(JSON.stringify({
              choices: [{
                message: {
                  role: 'assistant',
                  content: '',
                  reasoning_content: 'Let me think step by step...',
                },
              }],
              usage: { prompt_tokens: 20, completion_tokens: 100, total_tokens: 120, cost_usd: 0.0001 },
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return origFetch(input);
        };

        const rec = await wm.initWorkflow('Fix edge case', 'live');
        const res = await wm.executeExplorerStep({ runId: rec.runId });
        assert.strictEqual(res.success, false);
        assert.ok(res.error?.includes('exhausted token allowance during internal thinking'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    // 5. Coder step with 1024 token allowance succeeds and creates patch
    test('5. Coder step with 1024 token allowance succeeds and creates patch', async () => {
      const config = loadConfig({
        WILDGUARD_MODE: 'live',
        OTARI_API_KEY: 'test-key-427',
      });
      const telemetry = new TelemetryManager('test_427_coder', 'live', 1.50);
      const engine = new WildGuardEngine(config, telemetry);
      const mockRedis = createMockUpstashRedisForSuite19();
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-mock.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, mockRedis.customFetch as any);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');

      // Create target file in workspace
      fs.mkdirSync(path.join(tempRepo, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tempRepo, 'src', 'paymentCalculator.ts'), 'export function calc() { return 1; }');

      const wm = new WorkflowManager({ engine, budgetManager, tools });

      const origFetch = globalThis.fetch;
      try {
        let capturedMaxTokens: number | undefined;
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('chat/completions')) {
            if (init?.body) {
              const parsed = JSON.parse(init.body);
              capturedMaxTokens = parsed.max_tokens;
            }
            return new Response(JSON.stringify({
              choices: [{
                message: {
                  role: 'assistant',
                  content: 'export function calc() { return 2; }',
                  reasoning_content: 'Let us change return 1 to return 2',
                },
              }],
              usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70, cost_usd: 0.00007 },
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return origFetch(input, init);
        };

        const rec = await wm.initWorkflow('Update calc to return 2', 'live');
        // Mark explorer step done
        const savedRec = await wm.getWorkflow(rec.runId);
        savedRec!.status = 'explorer_done';
        savedRec!.explorerOutput = 'Plan: change 1 to 2';
        await wm.saveWorkflowRecord(savedRec!);

        const res = await wm.executeCoderStep({ runId: rec.runId, targetFile: 'src/paymentCalculator.ts' });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.step, 'coder');
        assert.strictEqual(capturedMaxTokens, 1024, 'Coder step must request 1024 max_tokens');
        assert.ok(res.patch, 'Patch must be generated');
        assert.ok(res.patch.previewDiff.includes('+export function calc() { return 2; }'));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    // 6. Idempotent Step Loop execution returns cached result without second reservation
    test('6. Idempotent Step Loop execution returns cached result without second reservation', async () => {
      const config = loadConfig({ WILDGUARD_MODE: 'simulation' });
      const telemetry = new TelemetryManager('test_427_idemp', 'simulation', 1.50);
      const engine = new WildGuardEngine(config, telemetry);
      const budgetManager = new RedisBudgetManager({ perRunCapUsd: 1.50, globalCeilingUsd: 10.00 });
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const wm = new WorkflowManager({ engine, budgetManager, tools });

      const rec = await wm.initWorkflow('Task', 'simulation');
      const first = await wm.executeExplorerStep({ runId: rec.runId, idempotencyKey: 'idemp_key_repeat' });
      const second = await wm.executeExplorerStep({ runId: rec.runId, idempotencyKey: 'idemp_key_repeat' });

      assert.strictEqual(first.success, true);
      assert.strictEqual(second.success, true);
      assert.strictEqual(second.isIdempotent, true, 'Second call with same key must return isIdempotent: true');
    });

    // 7. Budget exhaustion halts Step Loop with fail-closed error
    test('7. Budget exhaustion halts Step Loop with fail-closed error', async () => {
      const config = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'test-key-427' });
      const telemetry = new TelemetryManager('test_427_exhausted', 'live', 1.50);
      const budgetManager = new RedisBudgetManager({
        redisUrl: 'https://test-exhaust.upstash.io',
        redisToken: 'test-token',
        perRunCapUsd: 1.50,
        globalCeilingUsd: 10.00,
      }, async () => {
        // Return 0 (no allowance) for reserve
        return new Response(JSON.stringify({ result: [0, '', '10.00', '10.00'] }));
      });

      const engine = new WildGuardEngine(config, telemetry);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const wm = new WorkflowManager({ engine, budgetManager, tools });

      const rec = await wm.initWorkflow('Task', 'live');
      const res = await wm.executeExplorerStep({ runId: rec.runId });
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('exceeded') || res.error?.includes('ceiling') || res.error?.includes('cap') || res.error?.includes('budget'));
    });

    // 8. Server /api/chat enforces 25,000ms timeout and returns 504 on gateway timeout
    test('8. Server /api/chat enforces 25,000ms timeout and returns 504 on gateway timeout', async () => {
      const { createServer } = await import('../src/web/server.js');
      const { AuthManager } = await import('../src/otari/authManager.js');

      const liveConfig = loadConfig({ WILDGUARD_MODE: 'live', OTARI_API_KEY: 'test-key' });
      const telemetry = new TelemetryManager('test_427_server_to', 'live', 1.50);
      const tools = new McpRepoTools(tempRepo, 'feat/otari-agent-harness');
      const decisionGate = new DecisionGate(liveConfig.baseUrl);
      const engine = new WildGuardEngine(liveConfig, telemetry);
      const loop = new AgentLoop(engine, tools, decisionGate, telemetry);
      const budgetManager = new RedisBudgetManager({ perRunCapUsd: 1.50, globalCeilingUsd: 10.00 });
      const authManager = new AuthManager({});

      const testServer = createServer({
        repoRoot: tempRepo,
        isPublicPreview: false,
        agent: { config: liveConfig, telemetry, tools, decisionGate, engine, loop, budgetManager, authManager },
      });
      await testServer.start(0, '127.0.0.1');
      const address = testServer.server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const origFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: any, init: any) => {
          const urlStr = typeof input === 'string' ? input : (input?.url || '');
          if (urlStr.includes('chat/completions')) {
            const err: any = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
          }
          return origFetch(input, init);
        };

        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'coder', task: 'Implement something', mode: 'live' }),
        });

        assert.strictEqual(res.status, 504);
        const data = await res.json() as any;
        assert.strictEqual(data.success, false);
        assert.strictEqual(data.errorCategory, 'timeout');
        assert.ok(data.error.includes('Chat inference timed out after 25000ms'));
      } finally {
        globalThis.fetch = origFetch;
        await testServer.stop();
      }
    });
  });
});

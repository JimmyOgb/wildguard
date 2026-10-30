/**
 * WildGuard - Comprehensive Test Suite
 * Covers Configuration, Deterministic Guardrails, Repository Tools,
 * Multi-Model Engine, Decision Quality Gate, and Agent Orchestration.
 *
 * All tests execute in deterministic simulation or mocked environments.
 * ZERO external API credits are consumed.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  loadConfig,
  validateBudget,
  validateTimeout,
  validateBaseUrl,
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
import { WildGuardEngine } from '../src/otari/wildguardEngine.js';
import { AgentLoop } from '../src/otari/agentLoop.js';

describe('WildGuard Test Suite', () => {
  let tempRepo: string;

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
});

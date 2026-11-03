/**
 * WildGuard - Public Demo Workspace Isolator & Durable Store
 * Provides securely isolated, per-session demo workspaces in /tmp backed by
 * durable Upstash Redis persistence across Vercel serverless cold starts.
 * Protects private deployment files (/var/task) from public access.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface DemoProjectFile {
  relativePath: string;
  content: string;
}

export interface DurableWorkspaceData {
  sessionId: string;
  version: number;
  updatedAt: string;
  files: Record<string, string>; // relativePath -> content
}

export const WORKSPACE_LIMITS = {
  MAX_FILES: 30,
  MAX_FILE_SIZE_BYTES: 64 * 1024,        // 64 KB per file
  MAX_TOTAL_WORKSPACE_BYTES: 300 * 1024, // 300 KB total workspace size
  TTL_SECONDS: 86400,                    // 24 hours
};

export const CANONICAL_DEMO_FILES: DemoProjectFile[] = [
  {
    relativePath: 'README.md',
    content: `# WildGuard Demo Application — Payment Processor

Welcome to the isolated WildGuard demo project.
This repository is monitored by the WildGuard Deterministic Policy Harness.

### Available Capabilities:
- **Repository Exploration:** Inspect source code and test files safely.
- **AI Code Synthesis:** Request fixes and optimizations from the Coder agent.
- **Guardrail Decision Gates:** View real-time security reviews of proposed diffs.
- **Patch Review & Approval:** Inspect unified diffs before applying changes.
- **Automated Test Runner:** Validate business logic against the test suite.
`,
  },
  {
    relativePath: 'package.json',
    content: JSON.stringify(
      {
        name: 'payment-processor-demo',
        version: '1.0.0',
        description: 'Sample payment calculation and billing engine',
        type: 'module',
        scripts: {
          test: 'node --test tests/paymentCalculator.test.js',
        },
        dependencies: {
          decimal: '^0.1.1',
        },
      },
      null,
      2
    ),
  },
  {
    relativePath: 'src/paymentCalculator.ts',
    content: `/**
 * Core Payment Fee & Tax Calculator
 */

export interface FeeResult {
  subtotalUsd: number;
  processingFeeUsd: number;
  taxUsd: number;
  totalUsd: number;
}

export function calculatePaymentTotal(
  subtotalUsd: number,
  tier: 'standard' | 'enterprise' = 'standard',
  taxRate: number = 0.08
): FeeResult {
  if (typeof subtotalUsd !== 'number' || isNaN(subtotalUsd) || subtotalUsd < 0) {
    throw new Error('Invalid subtotal: must be a positive finite number');
  }

  const feeRate = tier === 'enterprise' ? 0.015 : 0.029;
  const fixedFee = 0.30;

  const processingFeeUsd = Number((subtotalUsd * feeRate + fixedFee).toFixed(2));
  const taxUsd = Number((subtotalUsd * taxRate).toFixed(2));
  const totalUsd = Number((subtotalUsd + processingFeeUsd + taxUsd).toFixed(2));

  return {
    subtotalUsd,
    processingFeeUsd,
    taxUsd,
    totalUsd,
  };
}
`,
  },
  {
    relativePath: 'src/formatting.ts',
    content: `/**
 * Financial Formatting Utilities
 */

export function formatUsd(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '$0.00';
  }
  return '$' + amount.toFixed(2);
}
`,
  },
  {
    relativePath: 'tests/paymentCalculator.test.ts',
    content: `/**
 * Test Suite for Payment Calculator
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { calculatePaymentTotal } from '../src/paymentCalculator.js';
import { formatUsd } from '../src/formatting.js';

test('calculates standard tier fee correctly', () => {
  const result = calculatePaymentTotal(100.0, 'standard', 0.08);
  assert.strictEqual(result.subtotalUsd, 100.0);
  assert.strictEqual(result.processingFeeUsd, 3.20); // 100 * 0.029 + 0.30
  assert.strictEqual(result.taxUsd, 8.00);
  assert.strictEqual(result.totalUsd, 111.20);
});

test('calculates enterprise tier fee correctly', () => {
  const result = calculatePaymentTotal(100.0, 'enterprise', 0.08);
  assert.strictEqual(result.processingFeeUsd, 1.80); // 100 * 0.015 + 0.30
});

test('formats USD amounts cleanly', () => {
  assert.strictEqual(formatUsd(123.456), '$123.46');
  assert.strictEqual(formatUsd(NaN), '$0.00');
});
`,
  },
  {
    relativePath: '.wildguard/policy.json',
    content: JSON.stringify(
      {
        version: '1.0',
        protectedBranches: ['main', 'master', 'production'],
        requireApprovalForDependencies: true,
        disallowSecrets: true,
      },
      null,
      2
    ),
  },
];

/**
 * Sanitizes session ID to prevent directory traversal or shell injection in folder names.
 */
export function sanitizeSessionId(rawSessionId: string): string {
  const clean = rawSessionId.replace(/[^a-zA-Z0-9_-]/g, '').trim();
  if (!clean || clean.length < 8) {
    return 'pub_default_' + Date.now().toString(36);
  }
  return clean.substring(0, 48);
}

/**
 * Validates and normalizes relative path within workspace.
 * Rejects traversals, absolute paths, null bytes, and sensitive files.
 */
export function validateWorkspaceRelativePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('File path must be a non-empty string');
  }

  // Reject null bytes and illegal control chars
  if (rawPath.includes('\0')) {
    throw new Error('File path contains illegal null bytes');
  }

  // Normalize forward slashes
  const normalized = path.normalize(rawPath).replace(/\\/g, '/').replace(/^\/+/, '');

  if (
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized === '..' ||
    path.isAbsolute(rawPath) ||
    /^[a-zA-Z]:/.test(rawPath) // Windows drive letter
  ) {
    throw new Error(`Directory traversal blocked: "${rawPath}"`);
  }

  // Reject sensitive files
  const lower = normalized.toLowerCase();
  if (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.includes('/.env') ||
    lower.startsWith('.git/') ||
    lower.startsWith('node_modules/')
  ) {
    throw new Error(`Access to protected path blocked: "${rawPath}"`);
  }

  return normalized;
}

/**
 * Ensures a dedicated, isolated workspace exists in the system temp directory for this session.
 * Synchronous local initializer.
 */
export function getOrCreateDemoWorkspace(sessionId: string): string {
  const cleanId = sanitizeSessionId(sessionId);
  const baseDir = path.resolve(os.tmpdir(), 'wildguard_workspaces');
  const sessionDir = path.resolve(baseDir, cleanId);

  // Initialize directory if it does not exist
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });

    for (const file of CANONICAL_DEMO_FILES) {
      const filePath = path.resolve(sessionDir, file.relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content, 'utf8');
    }
  }

  return sessionDir;
}

/**
 * Synchronizes a visitor's workspace with Upstash Redis durable store.
 * Restores file state across serverless instances and cold starts.
 */
export async function syncDurableWorkspaceAsync(
  sessionId: string,
  budgetManager?: any
): Promise<{ sessionDir: string; version: number; fromDurable: boolean }> {
  const cleanId = sanitizeSessionId(sessionId);
  const baseDir = path.resolve(os.tmpdir(), 'wildguard_workspaces');
  const sessionDir = path.resolve(baseDir, cleanId);

  if (budgetManager && typeof budgetManager.get === 'function' && budgetManager.isConfigured?.()) {
    try {
      const redisKey = `wildguard:workspace:${cleanId}`;
      const raw = await budgetManager.get(redisKey);

      if (raw) {
        const parsed = JSON.parse(raw) as DurableWorkspaceData;
        if (parsed && typeof parsed.version === 'number' && parsed.files && typeof parsed.files === 'object') {
          // Recreate or sync files to local /tmp
          fs.mkdirSync(sessionDir, { recursive: true });

          for (const [relPath, content] of Object.entries(parsed.files)) {
            const safeRel = validateWorkspaceRelativePath(relPath);
            const fullTarget = path.resolve(sessionDir, safeRel);
            fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
            fs.writeFileSync(fullTarget, content, 'utf8');
          }

          return { sessionDir, version: parsed.version, fromDurable: true };
        }
      }

      // If key doesn't exist in Redis yet, initialize canonical files in durable store
      const initialFiles: Record<string, string> = {};
      fs.mkdirSync(sessionDir, { recursive: true });

      for (const file of CANONICAL_DEMO_FILES) {
        initialFiles[file.relativePath] = file.content;
        const fullTarget = path.resolve(sessionDir, file.relativePath);
        fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
        fs.writeFileSync(fullTarget, file.content, 'utf8');
      }

      const initialData: DurableWorkspaceData = {
        sessionId: cleanId,
        version: 1,
        updatedAt: new Date().toISOString(),
        files: initialFiles,
      };

      if (typeof budgetManager.set === 'function') {
        await budgetManager.set(redisKey, JSON.stringify(initialData), WORKSPACE_LIMITS.TTL_SECONDS);
      }

      return { sessionDir, version: 1, fromDurable: true };
    } catch (err) {
      if (process.env.VERCEL === '1') {
        throw new Error(`Durable workspace storage failure on Vercel: ${(err as Error).message}`);
      }
    }
  }

  // Fallback to local synchronous demo workspace
  const localDir = getOrCreateDemoWorkspace(sessionId);
  return { sessionDir: localDir, version: 1, fromDurable: false };
}

/**
 * Atomically updates a file within the durable visitor workspace with version checking.
 */
export async function saveWorkspaceFileAsync(
  sessionId: string,
  relativePath: string,
  content: string,
  budgetManager?: any,
  expectedVersion?: number
): Promise<{ success: boolean; newVersion: number; error?: string }> {
  const cleanId = sanitizeSessionId(sessionId);
  let safeRelPath: string;

  try {
    safeRelPath = validateWorkspaceRelativePath(relativePath);
  } catch (err) {
    return { success: false, newVersion: 0, error: (err as Error).message };
  }

  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes > WORKSPACE_LIMITS.MAX_FILE_SIZE_BYTES) {
    return {
      success: false,
      newVersion: 0,
      error: `File size (${contentBytes} bytes) exceeds maximum limit of ${WORKSPACE_LIMITS.MAX_FILE_SIZE_BYTES} bytes.`,
    };
  }

  const baseDir = path.resolve(os.tmpdir(), 'wildguard_workspaces');
  const sessionDir = path.resolve(baseDir, cleanId);

  // If Redis is configured, perform version-checked update
  if (budgetManager && typeof budgetManager.get === 'function' && budgetManager.isConfigured?.()) {
    try {
      const redisKey = `wildguard:workspace:${cleanId}`;
      const raw = await budgetManager.get(redisKey);
      let workspaceData: DurableWorkspaceData;

      if (raw) {
        workspaceData = JSON.parse(raw) as DurableWorkspaceData;
      } else {
        const initialFiles: Record<string, string> = {};
        for (const f of CANONICAL_DEMO_FILES) {
          initialFiles[f.relativePath] = f.content;
        }
        workspaceData = {
          sessionId: cleanId,
          version: 1,
          updatedAt: new Date().toISOString(),
          files: initialFiles,
        };
      }

      // Check version conflict
      if (expectedVersion !== undefined && workspaceData.version !== expectedVersion) {
        return {
          success: false,
          newVersion: workspaceData.version,
          error: `Workspace version conflict: current version is ${workspaceData.version}, expected ${expectedVersion}.`,
        };
      }

      // File count limit
      const isNewFile = !workspaceData.files[safeRelPath];
      if (isNewFile && Object.keys(workspaceData.files).length >= WORKSPACE_LIMITS.MAX_FILES) {
        return {
          success: false,
          newVersion: workspaceData.version,
          error: `Workspace file count exceeds maximum of ${WORKSPACE_LIMITS.MAX_FILES} files.`,
        };
      }

      // Total size check
      workspaceData.files[safeRelPath] = content;
      let totalBytes = 0;
      for (const c of Object.values(workspaceData.files)) {
        totalBytes += Buffer.byteLength(c, 'utf8');
      }
      if (totalBytes > WORKSPACE_LIMITS.MAX_TOTAL_WORKSPACE_BYTES) {
        return {
          success: false,
          newVersion: workspaceData.version,
          error: `Total workspace size (${totalBytes} bytes) exceeds limit of ${WORKSPACE_LIMITS.MAX_TOTAL_WORKSPACE_BYTES} bytes.`,
        };
      }

      workspaceData.version = (workspaceData.version || 0) + 1;
      workspaceData.updatedAt = new Date().toISOString();

      // Persist to Redis
      if (typeof budgetManager.set === 'function') {
        await budgetManager.set(redisKey, JSON.stringify(workspaceData), WORKSPACE_LIMITS.TTL_SECONDS);
      }

      // Sync to local /tmp
      fs.mkdirSync(sessionDir, { recursive: true });
      const fullTarget = path.resolve(sessionDir, safeRelPath);
      fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
      fs.writeFileSync(fullTarget, content, 'utf8');

      return { success: true, newVersion: workspaceData.version };
    } catch (err) {
      if (process.env.VERCEL === '1') {
        return { success: false, newVersion: 0, error: `Durable storage write failed: ${(err as Error).message}` };
      }
    }
  }

  // Local-only update fallback (e.g. offline tests without Redis)
  fs.mkdirSync(sessionDir, { recursive: true });
  const fullTarget = path.resolve(sessionDir, safeRelPath);
  fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
  fs.writeFileSync(fullTarget, content, 'utf8');

  return { success: true, newVersion: (expectedVersion || 1) + 1 };
}

/**
 * Loads durable workspace data directly from Redis.
 */
export async function loadDurableWorkspaceAsync(
  sessionId: string,
  budgetManager?: any
): Promise<DurableWorkspaceData | null> {
  const cleanId = sanitizeSessionId(sessionId);
  if (!budgetManager || typeof budgetManager.get !== 'function' || !budgetManager.isConfigured?.()) {
    return null;
  }
  try {
    const raw = await budgetManager.get(`wildguard:workspace:${cleanId}`);
    if (!raw) return null;
    return JSON.parse(raw) as DurableWorkspaceData;
  } catch {
    return null;
  }
}

/**
 * Cleans up abandoned workspaces older than maxAgeMs (default: 24h).
 */
export function pruneOldWorkspaces(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const baseDir = path.resolve(os.tmpdir(), 'wildguard_workspaces');
  if (!fs.existsSync(baseDir)) return 0;

  let pruned = 0;
  const now = Date.now();

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.resolve(baseDir, entry.name);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            pruned++;
          }
        } catch {
          // Skip if locked or in use
        }
      }
    }
  } catch {
    // Silently handle read errors
  }

  return pruned;
}

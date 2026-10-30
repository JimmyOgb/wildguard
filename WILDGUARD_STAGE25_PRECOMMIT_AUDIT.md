# WildGuard — Stage 2.5 Pre-Commit Security, Integration & Rubric Audit

**Audit Date:** October 30, 2026  
**Auditor:** Independent Principal Engineer & Lead Security Auditor  
**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Feature Branch:** `feat/otari-agent-harness`  
**Baseline Commit:** `4eedb60` (`chore: initial pre-Otari baseline`)  
**Audit Scope:** Read-Only Pre-Commit Verification, Security Boundary Inspection, and Rubric Reconciliation  

---

## 1. Git and Branch Integrity

An exhaustive inspection of the local Git repository was conducted using read-only Git commands.

### Executed Commands & Outputs

#### 1. `git branch --show-current`
```text
feat/otari-agent-harness
```
*Verdict:* **Compliant.** The active branch is strictly `feat/otari-agent-harness`.

#### 2. `git log --oneline --decorate -10`
```text
4eedb60 (HEAD -> feat/otari-agent-harness, main) chore: initial pre-Otari baseline
```
*Verdict:* **Compliant.** The feature branch points directly to the pre-Otari baseline commit `4eedb60`. Zero commits have been authored on `feat/otari-agent-harness`.

#### 3. `git diff --stat` & `git diff --cached --stat`
```text
(Empty output - zero modified tracked files, zero staged files)
```
*Verdict:* **Compliant.** Existing tracked files (`.gitignore`, `WILDGUARD_OTARI_CAPABILITY_AUDIT.md`, `WILDGUARD_OTARI_CONFIGURATION_MATRIX.md`) remain 100% untouched and preserved.

#### 4. `git status --short`
```text
?? .env.example
?? OTARI_DX_FEEDBACK.md
?? README.md
?? SUBMISSION_MANIFEST.md
?? WILDGUARD_STAGE2_IMPLEMENTATION_REPORT.md
?? WILDGUARD_STAGE2_OTARI_VERIFICATION.md
?? call_otari.py
?? package-lock.json
?? package.json
?? src/
?? tests/
?? tsconfig.json
```
*Ignored files:*
```text
.env
dist/
node_modules/
```

### Git Requirements Assessment
1. **Current branch is `feat/otari-agent-harness`:** Verified.
2. **Baseline commit `4eedb60` exists:** Verified (`4eedb6059c18c28de098813640b7f50634cb7e62`).
3. **Feature branch based on intended baseline:** Verified (`HEAD` is at `4eedb60`).
4. **No preliminary feature-branch commits created:** Verified (0 commits on branch).
5. **Proposed first commit introduces actual Otari integration:** Verified (core engine, guardrails, tools, telemetry, and test suite are prepared).
6. **No secrets or `.env` files tracked:** Verified (`.env` is properly matched by `.gitignore` and untracked).
7. **Existing user work preserved:** Verified.

---

## 2. First-Commit Compliance

The official hackathon submission requirements specify that the **first commit** on `feat/otari-agent-harness` must introduce the actual Otari integration, preventing empty or purely cosmetic setup commits.

- **Status:** **COMPLIANT.**
- The repository has preserved zero-commit purity on the feature branch.
- When staged and committed, the proposed first commit will contain the full TypeScript implementation (`src/otari/config.ts`, `src/otari/wildguardEngine.ts`, `src/otari/guardrails.ts`, `src/otari/mcpRepoTools.ts`, `src/otari/telemetry.ts`, `src/otari/decisionGate.ts`, `src/otari/agentLoop.ts`, `src/index.ts`), unit tests, documentation, and project configuration.

---

## 3. Full Changed-File Inventory

The following table categorizes every untracked file currently present in the working directory intended for the initial feature integration:

| File Path | Classification | Purpose | Audit Notes |
|---|---|---|---|
| `.env.example` | Configuration Template | Safe template with configuration keys | Verified clean; contains dummy string `your_otari_api_key_here`. |
| `package.json` | Project Manifest | Dependencies & script definitions | Uses native `node --test` runner; devDeps `@types/node` and `typescript`. Clean. |
| `package-lock.json` | Dependency Lockfile | Pinned dependency tree | Clean. |
| `tsconfig.json` | Compiler Config | NodeNext ES2022 TypeScript configuration | Strict mode enabled, output to `./dist`. |
| `src/index.ts` | Module Barrel | Public exports and agent factory `createWildGuardAgent()` | Clean, well-structured. |
| `src/otari/config.ts` | Core Module | Configuration loader, validation, spending caps | Validates URLs, timeouts, budgets; sanitizes secrets for logging. |
| `src/otari/wildguardEngine.ts` | Core Module | Multi-model open-weight inference engine | Implements role routing, failover, live fetch, telemetry logging. |
| `src/otari/guardrails.ts` | Security Module | Deterministic zero-trust filesystem & Git guardrails | Enforces boundary checks, secret pattern blocking, branch protection. |
| `src/otari/mcpRepoTools.ts` | Tool Module | Application-owned repository tools | Sandboxed file list, read, patch, branch creation. |
| `src/otari/telemetry.ts` | Observability Module | Token tracking, micro-dollar cost settlement, budget stops | Separates live vs simulated costs; halts on spend cap. |
| `src/otari/decisionGate.ts` | Quality Gate | Go/no-go evaluation gate (Otari API + local heuristic fallback) | Deterministic local rejection overrides remote decisions. |
| `src/otari/agentLoop.ts` | Orchestration Module | Multi-turn agent loop (Explorer -> Coder -> Gate) | Orchestrates workflow with budget checks and structured events. |
| `tests/wildguard.test.ts` | Automated Test Suite | 30 unit tests covering all core modules | Executes without live credit consumption. Passes 30/30. |
| `README.md` | Documentation | Project overview, architecture diagrams, quickstart | Clear and comprehensive. |
| `OTARI_DX_FEEDBACK.md` | Submission Asset | Developer experience evaluation for Mozilla Otari team | High-value technical feedback. |
| `SUBMISSION_MANIFEST.md` | Submission Asset | Hackathon checklist, capability mapping, permalink registry | Aligned with Stage 2 status. |
| `WILDGUARD_STAGE2_IMPLEMENTATION_REPORT.md` | Internal Report | Summary of Stage 2 implementation steps | Engineering documentation. |
| `WILDGUARD_STAGE2_OTARI_VERIFICATION.md` | Internal Report | Empirical probe findings on Otari gateway | Documents 401 discovery responses. |
| `call_otari.py` | Scratch Script | Python test script for POST /chat/completions | **CAUTION:** Standalone test script. Should either be moved to `scripts/` or removed from the root before commit. |

---

## 4. Secret and Credential Review

An exhaustive scan across all workspace files was conducted for hardcoded tokens, API keys, credentials, and high-entropy secrets.

### Findings
1. **`.env` Exclusion:** `.env` exists locally (holding user secrets) but is strictly ignored by `.gitignore` (`.env`, `.env.*`). `git status` verifies it is classified as `Ignored`.
2. **`.env.example` Safety:** Contains only placeholder strings:
   `OTARI_API_KEY=your_otari_api_key_here`. No real keys exist in this file.
3. **`call_otari.py`:** Uses `os.environ.get("OTARI_API_KEY")` and reads from local `.env` if present. No hardcoded credentials exist in the script.
4. **Source Code (`src/`):** Scanned for regex patterns matching API keys (`sk-`, `ghp_`, `otari_`, bearer tokens). Zero hardcoded credentials found.
5. **Credential Leakage in Exceptions/Logs:**
   - In `src/otari/config.ts`: `sanitizeConfig()` replaces `apiKey` with `hasApiKey: Boolean(...)`.
   - In `src/otari/wildguardEngine.ts`: Errors do not echo headers or raw API keys.
   - In `src/otari/decisionGate.ts`: Remote decision exceptions are caught safely without credential output.

---

## 5. Otari API Implementation Review

Detailed code analysis of `config.ts`, `wildguardEngine.ts`, `telemetry.ts`, `decisionGate.ts`, and `agentLoop.ts`:

### 1. Base URL & Endpoint Construction
- **Base URL:** `https://api.otari.ai/api/v1` (enforced via `validateBaseUrl` in `config.ts`). Strips trailing slashes cleanly.
- **Inference Endpoint:** `${this.config.baseUrl}/chat/completions` -> `https://api.otari.ai/api/v1/chat/completions`. Matches official Otari specification.
- **Decisions Endpoint:** `${this.baseUrl}/decisions` -> `https://api.otari.ai/api/v1/decisions`. Matches official OpenAPI specification.

### 2. Authentication Header Handling
- Transmits `'Otari-Key': this.config.apiKey || ''`.
- Empirical probes confirm that Envoy proxies at `api.otari.ai` recognize `Otari-Key` alongside `Authorization: Bearer` and `x-api-key`.

### 3. Request Timeouts & Abort Handling
- `wildguardEngine.ts` sets an `AbortController` linked to `this.config.timeoutMs` (default: 30,000ms), cleared in a `finally` block.
- **Deficiency / Gap:** `decisionGate.ts` line 116 does **NOT** configure an `AbortController` or timeout. If `POST /api/v1/decisions` hangs upstream, the evaluation gate will block indefinitely.

### 4. Error Classification & Fallback Guards
- In `wildguardEngine.ts`:
  ```ts
  const isAuthError = primaryErr.status === 401 || primaryErr.status === 403;
  const isBudgetError = primaryErr.message?.includes('budget') || primaryErr.status === 402;
  if (isAuthError || isBudgetError) {
    throw primaryErr;
  }
  ```
  Correctly isolates non-recoverable errors (401, 403, 402, budget exhaustion) to prevent invalid retry loops.
- Fallback to `config.models.fallback` is triggered only on transient/upstream errors and prevents recursive fallback when already on the fallback model.

### 5. Telemetry & Response Headers
- Extracts `res.headers.get('otari-request-id')` and `res.headers.get('otari-provider')`.
- Extracts `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`, `usage.cost_usd`, and `usage.pricing_source`.
- Records latency in milliseconds.

### 6. Live Execution vs Simulation
- The engine implements real network execution (`executeLiveWithFallback` via `fetch`) and isolated simulation execution (`executeSimulation`).
- System defaults safe-closed to simulation mode unless both `WILDGUARD_MODE=live` and a non-empty `OTARI_API_KEY` are explicitly provided.

---

## 6. Live Discovery Claims Verification

An audit of `WILDGUARD_STAGE2_OTARI_VERIFICATION.md` and related matrix documents was performed.

### Empirical Evidence
- Four HTTP GET probes were executed against `api.otari.ai` and `otari.ai`:
  - `GET https://api.otari.ai/api/v1/models` -> `HTTP 401 Unauthorized`
  - `GET https://api.otari.ai/api/v1/tools` -> `HTTP 401 Unauthorized`
  - `GET https://otari.ai/api/v1/models` -> `HTTP 401 Unauthorized`
  - `GET https://otari.ai/api/v1/tools` -> `HTTP 401 Unauthorized`
- Envoy header `x-envoy-upstream-service-time: 3ms` and response body `{"detail":"Missing Otari-Key, Authorization, or x-api-key header"}` were returned.

### Verification Assessment & Audit Corrections
- **What was proven:** Network reachability of the endpoint, active Envoy reverse proxy, and accepted authentication header schemas.
- **What was NOT proven:** Model catalog contents, tool availability flags, organization account balance, or voucher redemption.
- **Documentation Discrepancy:** In `WILDGUARD_OTARI_CONFIGURATION_MATRIX.md`, several features (e.g. Model catalog, Explorer model, Coder model, Web fetch, MCP) were marked with status **"VERIFIED"**.
  > [!WARNING]
  > An HTTP 401 response proves endpoint reachability, NOT model availability or tool availability. Labeling unauthenticated endpoints as "VERIFIED" for specific models or tools is inaccurate. The configuration matrix and documentation must clearly distinguish between **"Publicly Documented in Otari Specs"** and **"Empirically Verified via Authenticated Response"**.

---

## 7. Security Audit & Guardrail Vulnerability Analysis

A comprehensive audit of `src/otari/guardrails.ts` and `src/otari/mcpRepoTools.ts` was conducted, focusing on boundary escapes, Windows filesystem quirks, and bypass risks.

### 1. Secret File Path Blocking
- **Implementation:** Tests filename basename against regex patterns (`/^\.env(\..+)?$/i`, `/^id_rsa/i`, `/\.(pem|key)$/i`, etc.).
- **Windows Quirks & Bypasses Identified:**
  - *Trailing Dot Bypass:* On Windows NTFS, file paths with trailing dots (e.g. `.env.`) resolve directly to `.env`. The regex `/^\.env(\..+)?$/i` requires at least one character after the dot (`.+`), so it does not match `.env.`. While `sanitized.trim()` removes trailing spaces, it does not strip trailing dots. An attacker requesting `.env.` could bypass the filename regex on Windows.
  - *NTFS Alternate Data Streams (ADS):* On Windows NTFS, files can have streams (e.g. `.env:stream` or `.env::$DATA`). `path.basename('.env:stream')` produces `.env:stream`, which fails the `.env` regex and could bypass filename pattern blocking.
  - *Windows Reserved Device Names:* Querying DOS device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) can cause process hangs or denial of service on Windows.

### 2. Secret Content Inspection
- **Implementation:** For files under 512KB, inspects contents for private key headers (`-----BEGIN ... PRIVATE KEY-----`) and API key patterns.
- **Test Gap:** The automated test suite has **zero test cases** validating that high-entropy secrets or private keys in arbitrarily named files (e.g. `config.txt`) trigger `SECRET_CONTENT_DETECTED`.

### 3. Path Traversal & Canonical Confinement
- **Implementation:** Normalizes slashes, rejects `../` and UNC paths (`//`, `\\\\`), and uses `path.resolve()` and `path.relative()` to verify containment.
- **Symlink Escape Gap on Non-Existent Files:**
  - In `guardrails.ts` line 124:
    ```ts
    if (fs.existsSync(resolvedTarget)) {
      const realTargetPath = fs.realpathSync(resolvedTarget);
      ...
    }
    ```
  - If a file does **not** exist yet (e.g. during a write or patch to `symlink_dir/new_file.txt`, where `symlink_dir` is a symlink pointing outside the repository), `fs.existsSync(resolvedTarget)` returns `false`.
  - The symlink boundary check is bypassed, and `applyPatch()` creates the file outside the repository root.
  - *Fix Required:* If the target file does not exist, check the canonical path of its nearest existing ancestor directory via `fs.realpathSync()`.

### 4. Protected Branch Immutability
- **Implementation:** `BLOCKED_BRANCHES = new Set(['main', 'master'])`.
- **Bypass Risk:** Normalization only checks `.trim().toLowerCase()`. Git branch references such as `refs/heads/main` or `origin/main` are not checked against the set and could bypass the gate if passed as the active branch.

### 5. Dependency Modification Gate
- **Enforcement Type:** **Application-enforced.**
- `applyPatch()` checks `validateWritePolicy()`. If the file is in `DEPENDENCY_FILES` (`package.json`, `package-lock.json`, `pnpm-lock.yaml`, etc.), it returns `status: 'requires_approval'`.
- Unless the caller passes explicit `isApproved === true`, `applyPatch()` aborts without writing and returns `requiresApproval: true` along with a preview diff.
- In `agentLoop.ts`, `decisionGate.evaluate()` blocks on `requires_human_approval`.

---

## 8. Model Routing Verification

Assessment of candidate models declared in `config.ts` and documentation:

| Model Identifier | Role | Configured | Documented | Returned by Auth Org Discovery | Actually Executed | Open-Weight Status |
|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | Explorer | **Yes** (Default) | Yes | **No** (Probe returned 401) | **No** (Simulated only) | **Verified Open-Weight** (DeepSeek family) |
| `alibaba/qwen-3.5-35b-a3b` | Coder | **Yes** (Default) | Yes | **No** (Probe returned 401) | **No** (Simulated only) | **Verified Open-Weight** (Alibaba Qwen family) |
| `meta-llama/llama-3.3-70b-instruct` | Fallback | **Yes** (Default) | Yes | **No** (Probe returned 401) | **No** (Simulated only) | **Verified Open-Weight** (Meta Llama 3.3) |
| `deepseek/deepseek-r1` | Coder (Alt) | No (Catalog ref) | Yes | **No** (Probe returned 401) | **No** | **Verified Open-Weight** (MIT licensed) |

### Findings
1. Role-based routing is genuinely implemented in `wildguardEngine.ts` via `resolveModelForRole()`.
2. Fallback logic correctly cascades on transient errors.
3. Neither primary nor fallback models have executed live inference over the wire due to the absence of an authenticated key.
4. Open-weight status is verified for all three primary candidate models.

---

## 9. MCP and Built-in Tools Verification

| Tool Capability | Architecture Classification | Implementation Status | Execution Evidence | Rubric Credit Eligibility |
|---|---|---|---|---|
| **Remote Otari MCP** | Hosted Otari MCP Gateway | **Not Implemented** | None | **Ineligible** (Remote `/api/v1/mcp/execute` not invoked) |
| **Repository File Tools** | Application-Owned Functions | **Implemented** (`mcpRepoTools.ts`) | Verified via 7 automated tests | **Eligible as Agent Tools**, but should not be mislabeled as Remote MCP |
| **Built-in Web Fetch** | Gateway Builtin Fetcher | **Documented Only** | None | **Ineligible** (No code issues web fetch calls) |
| **Web Search** | Third-Party Search Provider | **Not Implemented** | None | **Ineligible** (Requires Tavily/Brave key) |
| **Sandboxed Code Exec** | Gateway / E2B Sandbox | **Not Implemented** | None | **Ineligible** (Requires E2B key or Docker URL) |

### Key Assessment
WildGuard's file operations are application-owned Node.js functions. Calling them `mcp_repo_*` does not convert them into remote MCP protocol servers. The documentation and submission manifest must clearly describe them as **Application-Owned Repository Tools** to prevent reviewer pushback.

---

## 10. Budget Enforcement Review

Audit of `src/otari/telemetry.ts` and inference execution paths:

### 1. Spending Cap & Conversions
- Enforces strict `$1.50 USD` per-run ceiling (`DEFAULT_MAX_RUN_COST_USD = 1.50`).
- Micro-dollar settlement calculates to 6 decimal places (`toFixed(6)`).

### 2. Isolation of Simulated vs Live Spend
- `TelemetryManager` maintains distinct private properties:
  `accumulatedActualCostUsd` and `accumulatedSimulatedCostUsd`.
- Simulation spend never pollutes actual billing counters.

### 3. Missing Pricing Fallback
- If live completion omits `usage.cost_usd`, `telemetry.ts` switches to `costSource = 'estimate'`, applying a conservative token-based calculation ($0.50/M prompt, $1.50/M completion) to prevent unmetered spend.

### 4. Circuit Breaker Timing
- Checked prior to inference in `WildGuardEngine.execute()`.
- Checked at Step 1 (Explorer) and Step 2 (Coder) in `AgentLoop.run()`.
- Halts execution immediately upon budget breach without triggering fallback inference.

### 5. Negative/Malformed Usage Gap
- In `telemetry.ts` line 125: `parseFloat(params.costUsd)` checks `!isNaN(cost) && isFinite(cost)`, but does **NOT** check `cost >= 0`. Negative values could theoretically decrement accumulated spend.

---

## 11. Test Quality Review

Execution of the test suite was performed:
```bash
npm test
```
*Output Summary:*
- **Total Tests:** 30
- **Suites:** 7
- **Passed:** 30
- **Failed:** 0
- **Exit Code:** 0
- **Duration:** 594 ms

### Test Suite Strengths
- 100% deterministic local execution without network calls or credit consumption.
- Comprehensive coverage of basic configuration parsing, traversal detection, branch rejection, token accounting, and gate heuristics.

### Test Gaps & Missing Coverage
1. **Secret Content Scanning:** No test verifies `SECRET_CONTENT_DETECTED` when reading a file with an innocent name containing API keys or private keys.
2. **Symlink Boundary Escapes:** No unit test creates filesystem symlinks to verify `SYMLINK_BOUNDARY_ESCAPE`.
3. **Windows Edge Cases:** Trailing dots (`.env.`), alternate data streams (`.env:stream`), and DOS device names are unexercised.
4. **Live Fallback Simulation:** `executeLiveWithFallback()` error recovery is not exercised with mocked network responses.
5. **Authentication Error Halting:** No test verifies that HTTP 401 prevents fallback retry.

---

## 12. Official Rubric Reconciliation

Reconciliation between the official Google Doc judging rubric and WildGuard's actual implementation:

| Rubric Feature / Category | Official Points | Implementation Evidence | Execution Evidence | Status |
|---|---:|---|---|---|
| **Meaningful use of 1 open-weight model** | 20 | Declared in `config.ts` & `wildguardEngine.ts` | Simulation mode only | **Implemented, not executed** |
| **2+ open-weight models for distinct roles** | 10 | Explorer, Coder, Fallback role mappings | Simulation mode only | **Implemented, not executed** |
| **Model routing and fallbacks** | 10 | Multi-tier failover in `wildguardEngine.ts` | Simulation mode only | **Partially implemented** |
| **MCP integrations** | 10 | `mcpRepoTools.ts` (Application-owned tools) | Unit tests (Local filesystem) | **Partially implemented** |
| **Web search or web fetch** | 10 | Architecture documentation only | None | **Unavailable** |
| **Code execution** | 10 | Local test runner only; no remote sandbox | None via Otari | **Unavailable** |
| **Budgets and spending limits** | 10 | `$1.50` cap & circuit breaker in `telemetry.ts` | Verified via 2 unit tests | **Implemented, not executed** |
| **Multiple models serving distinct roles** | 10 | Explorer + Coder orchestration in `agentLoop.ts` | Verified via unit tests (simulated) | **Implemented, not executed** |
| **Deterministic Guardrails** | 10 | Zero-trust policies in `guardrails.ts` | Verified via 8 unit tests | **Verified** |
| **Per-user budgets** | 10 | Per-run tracking; no per-user API binding | None | **Unavailable** |
| **Working application / real use case** | 5 | Complete functional agent loop in `agentLoop.ts` | Verified via 30 unit tests | **Implemented, not executed** |
| **Video demonstration** | 5 | Video script outlined | Pending recording | **Unavailable** |

> [!IMPORTANT]
> The earlier report stated that 60 points were achieved from 6 Otari features. In reality, while 5 relevant Otari features are implemented, only **Deterministic Guardrails** is fully verified with test execution. The other 4 implemented features remain in **"Implemented, not executed"** status pending live authenticated verification.

---

## 13. Critical Blockers & Recommended Fixes

### Critical Security & Reliability Fixes (Prior to Commit)

1. **Fix Symlink Escape on Non-Existent Files (`src/otari/guardrails.ts`):**
   When `targetPath` does not exist, resolve and check `fs.realpathSync()` on the nearest existing parent directory.
2. **Harden Windows Filename Parsing (`src/otari/guardrails.ts`):**
   Strip trailing dots and spaces before evaluating sensitive file regexes (`targetPath.replace(/[\s.]+$/, '')`), and reject NTFS Alternate Data Streams containing `:`.
3. **Add Request Timeout to Decision Gate (`src/otari/decisionGate.ts`):**
   Add `AbortController` with timeout to `queryRemoteDecisionsApi` to avoid indefinite hangs.
4. **Validate Non-Negative Usage Costs (`src/otari/telemetry.ts`):**
   Explicitly check `cost >= 0` to prevent negative usage amounts from inflating remaining budget.
5. **Add Missing Security Unit Tests (`tests/wildguard.test.ts`):**
   Add test cases for secret-content scanning (`SECRET_CONTENT_DETECTED`), trailing-dot traversal, and non-negative budget enforcement.
6. **Clean Up Scratch Script:**
   `call_otari.py` is an uncommitted Python scratch script at the repo root. Relocate it to a `scripts/` directory or add it to `.gitignore` so the TypeScript project commit remains clean.
7. **Reconcile Documentation Claims:**
   Update `WILDGUARD_OTARI_CONFIGURATION_MATRIX.md` and `SUBMISSION_MANIFEST.md` to accurately classify 401 probe responses as endpoint verification rather than model/tool catalog verification.

---

## 14. First-Commit Readiness Decision

### Conclusion:
## `READY AFTER SPECIFIC FIXES`

The codebase architecture, Git branch structure, and pre-commit hygiene are substantially strong. The repository has strictly maintained zero-commit purity on `feat/otari-agent-harness` from baseline `4eedb60`.

However, the 7 specific security hardening fixes, timeout additions, and test additions outlined in Section 13 should be applied before generating the official first integration commit.

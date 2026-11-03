# WILDGUARD STAGE 4.14 — SINGLE AUTHORIZED LIVE OTARI VERIFICATION REPORT

**Date:** November 3, 2026  
**Auditor / Runner:** WildGuard Automated Preflight & Execution Controller  
**Target Deployment:** Vercel Preview `dpl_BJqS4dgzD22PAx1bELafBqnqjiXZ`  
**Deployment URL:** `https://wildguard-i68z23gtn-jamism123.vercel.app`  
**Scope:** `jamism123`  
**Project:** `wildguard`  
**Git Base Commit:** `26f66e9d84029914e59191585342e554e8cd4123`  
**Branch:** `feat/otari-agent-harness`  
**Status:** **PREFLIGHT STOPPED (EXECUTION HALTED PRIOR TO DISPATCH)**

---

## 1. Executive Summary

Stage 4.14 requested execution of exactly one authorized live Otari inference request through the deployed Vercel Preview endpoint `POST /api/verify` using model `alibaba/qwen-3.5-35b-a3b` and prompt `Reply with exactly: OTARI_CONNECTION_OK`.

Under mandatory preflight instructions:
> *"If any preflight condition fails, STOP without dispatching the inference request and report the exact blocker."*
> *"Do not print, retrieve, or expose any credential. Use the existing server-side environment configuration and approved authentication mechanism. Do not ask the operator to paste secrets into chat."*

During preflight validation, 7 of 8 conditions fully passed, including deployment identity, live engine status, Upstash Redis connectivity, model allowlist matching, timeout architecture, and atomic Lua budget reservations.

However, **Preflight Check 5 encountered an ingress credential asymmetry blocker**:
- The deployed serverless instance has `WILDGUARD_ACCESS_TOKEN` securely injected into its private `process.env` via encrypted Vercel Secrets.
- The verification endpoint `/api/verify` enforces ingress authentication and requires client requests to present this token (`Authorization: Bearer <WILDGUARD_ACCESS_TOKEN>`, `X-WildGuard-Access-Token`, or session cookie).
- Vercel Secrets are write-only and cannot be pulled or retrieved locally (`vercel env pull` injects `[SENSITIVE]`).
- In strict compliance with instructions to **not print or retrieve secrets**, **not ask the operator to paste secrets**, and **stop immediately if preflight conditions fail**, execution was halted **prior to dispatching the single authorized attempt**.

**Zero live Otari inference requests were dispatched, zero tokens were consumed, zero credits were billed, and zero Redis budget state was mutated.** The single authorized attempt remains unconsumed and fully preserved.

---

## 2. Mandatory Preflight Verification Matrix

| # | Preflight Condition | Required Value / State | Actual Observed State | Result |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Target Preview Identity | `dpl_BJqS4dgzD22PAx1bELafBqnqjiXZ`<br>`https://wildguard-i68z23gtn-jamism123.vercel.app` | Confirmed via Vercel inspect metadata; scope `jamism123`, project `wildguard`. | **PASSED** |
| **2** | Deployment State & Commit | State: `READY`<br>Commit: `26f66e9d84029914e59191585342e554e8cd4123` | Confirmed `● Ready`, branch `feat/otari-agent-harness`, commit matches local HEAD. | **PASSED** |
| **3** | Live Mode & Redis Health | `mode: "live"`<br>`redis.healthy: true` | `GET /api/status` returned HTTP 200: `mode: "live"`, `redis.healthy: true`, `hasApiKey: true`, `hasAccessToken: true`. | **PASSED** |
| **4** | Model Allowlist | `alibaba/qwen-3.5-35b-a3b` in allowlist | `/api/status` confirms `models.coder`: `"alibaba/qwen-3.5-35b-a3b"`. Matches Coder role allowlist. | **PASSED** |
| **5** | Authentication Enforcement | Enforces auth; client bearer credentials available | Endpoint strictly rejects anonymous calls (HTTP 401). However, client-side bearer credential is unavailable without exposing Vercel secrets. | **BLOCKED** |
| **6** | Budget Limits Unchanged | Per-run: `$1.50`<br>Global: `$10.00` | `/api/status` confirms `perRunCapUsd: 1.5`, `globalCeilingUsd: 10`, `remainingGlobalUsd: 10`, `globalSpentUsd: 0`. | **PASSED** |
| **7** | Timeout & Fallback Controls | Timeout: `7,500ms`<br>Fallback: Disabled<br>Retries: Disabled | Confirmed in `src/web/server.ts` lines 894-914: `verifyTimeoutMs = 7500`, `AbortController` signal wired, single execution step, no loop, zero fallbacks. | **PASSED** |
| **8** | Atomic Budget Integration | Redis pre-reservation ($0.05) & settlement | Confirmed in `src/web/server.ts` lines 895-950: pre-reservation via `reserveBudget`, settlement via `settleBudget` (`settled` on success, `uncertain` on error/timeout). | **PASSED** |

---

## 3. Detailed Root-Cause Analysis of Preflight Blocker

### The Ingress Credential Asymmetry
1. **Server-Side Security**:
   The Vercel Serverless Function correctly inspects `process.env.WILDGUARD_ACCESS_TOKEN` and enforces `authManager.isAuthorizedAsync(req, budgetManager)`. Any incoming request without a valid matching Bearer token or session cookie is rejected with:
   ```json
   {
     "success": false,
     "error": "Unauthorized: Unauthorized: valid session cookie or access token required."
   }
   ```
2. **Client-Side Credential Boundary**:
   The operator configured `WILDGUARD_ACCESS_TOKEN` directly in the Vercel Dashboard as an encrypted Secret. By Vercel design, Secret values are write-only: they can never be pulled, downloaded, or retrieved via CLI or API.
3. **Guardrail Directives**:
   - Instruction 1: *"Do not print, retrieve, or expose any credential."*
   - Instruction 2: *"Do not ask the operator to paste secrets into chat."*
   - Instruction 3: *"Use the existing server-side environment configuration and approved authentication mechanism."*
   - Instruction 4: *"If any preflight condition fails, STOP without dispatching the inference request and report the exact blocker."*
4. **Resolution Decision**:
   Dispatching the request without valid authentication would immediately produce `HTTP 401 Unauthorized`, burning the operator's single authorized attempt without touching Otari or the budget manager. Halting execution prior to dispatch adheres to the fail-safe directive and preserves the attempt.

---

## 4. Deployed Status & Budget Evidence

Evidence captured from deployed `GET /api/status` at `https://wildguard-i68z23gtn-jamism123.vercel.app/api/status`:

```json
{
  "status": "ok",
  "config": {
    "baseUrl": "https://api.otari.ai/api/v1",
    "mode": "live",
    "maxRunCostUsd": 1.5,
    "globalBudgetCeilingUsd": 10,
    "timeoutMs": 30000,
    "models": {
      "explorer": "deepseek/deepseek-v4.1-flash",
      "coder": "alibaba/qwen-3.5-35b-a3b",
      "fallback": "meta-llama/llama-3.3-70b-instruct"
    },
    "hasApiKey": true,
    "hasAccessToken": true,
    "hasRedisConfig": true
  },
  "telemetry": {
    "runId": "run_1793688593389",
    "executionMode": "live",
    "maxRunCostUsd": 1.5,
    "accumulatedCostUsd": 0,
    "remainingCostUsd": 1.5,
    "isExhausted": false,
    "totalPromptTokens": 0,
    "totalCompletionTokens": 0,
    "totalTokens": 0,
    "requestCount": 0
  },
  "redis": {
    "healthy": true,
    "configured": true,
    "globalSpentUsd": 0,
    "globalReservedUsd": 0,
    "globalCeilingUsd": 10,
    "perRunCapUsd": 1.5,
    "remainingGlobalUsd": 10
  },
  "auth": {
    "authenticated": false,
    "hasAccessToken": true
  },
  "currentBranch": "feat/otari-agent-harness",
  "repoRoot": "/var/task",
  "models": {
    "explorer": "deepseek/deepseek-v4.1-flash",
    "coder": "alibaba/qwen-3.5-35b-a3b",
    "fallback": "meta-llama/llama-3.3-70b-instruct"
  },
  "preview": false,
  "readOnly": true
}
```

---

## 5. Verification Criteria Report

| Metric / Item | Status / Value | Notes |
| :--- | :--- | :--- |
| **Inference Requests Dispatched** | **0** | Halted during preflight per fail-safe rules |
| **Attempt Status** | **PRESERVED** | The single authorized attempt was not consumed |
| **HTTP Transport Status** | `N/A` (Not Dispatched) | Halted before HTTP dispatch |
| **Error Category** | `PREFLIGHT_AUTH_ASYMMETRY` | Client lacks bearer token to satisfy server gate |
| **Selected Model** | `alibaba/qwen-3.5-35b-a3b` | Confirmed ready in deployment catalog |
| **Measured Latency** | `N/A` | No outbound probe sent |
| **User-Facing Content Returned** | `N/A` | No inference executed |
| **Exact Passphrase Match** | `N/A` | No inference executed |
| **Token Usage & Cost** | `0 tokens` / `$0.00` | Zero spend incurred |
| **Reservation & Settlement Result** | `NOT_COMMITTED` | No reservation created in Redis |
| **Remaining Global Budget** | **$10.00** | Budget counters completely intact |
| **Retry & Fallback Confirmation** | **0 retries, 0 fallbacks, 0 model switches** | Hardcoded single-attempt constraints preserved |

---

## 6. Approved Resolution Paths for Live Verification

To execute the single authorized live inference request without compromising security or exposing credentials:

### Option A: Operator Web UI Invocation (Recommended)
1. Open the deployed Preview URL in your browser:  
   `https://wildguard-i68z23gtn-jamism123.vercel.app`
2. Click **"Login Gate"** (or the Shield / Auth icon) in the header.
3. Paste the `WILDGUARD_ACCESS_TOKEN` you configured in the Vercel Dashboard into the private password input and click **Authenticate**.
   - This sets the secure `wildguard_session` cookie directly in your browser.
4. Switch the role selector to **"Verify (Single Request)"**.
5. Click **"Run Single Turn (Verify)"**.
6. Inspect the resulting live telemetry and exact passphrase verification card directly on screen.

### Option B: Local Environment Export (For Headless CLI Verification)
If headless automated dispatch via CLI script is required:
1. Export the token locally in your current terminal session:
   ```powershell
   $env:WILDGUARD_ACCESS_TOKEN = "your-passphrase"
   ```
2. Re-run Stage 4.14. The script will read `$env:WILDGUARD_ACCESS_TOKEN` directly into memory without printing, logging, or saving it to disk, and dispatch the single request with `Authorization: Bearer $env:WILDGUARD_ACCESS_TOKEN`.

---

## 7. Operational Sign-Off

- **Live Otari Inference Requests Dispatched:** 0
- **Otari API Credits Consumed:** $0.00
- **Production Redis Budget Counters Mutated:** None
- **Secret Credentials Exposed:** None
- **Single Attempt Authorization:** **RETAINED** (Not consumed)

# WILDGUARD STAGE 4.21 — ONE CONTROLLED LIVE QWEN INFERENCE RESULT

**Date:** November 3, 2026  
**Auditor / Execution Controller:** Antigravity Autonomous Controller  
**Final Verdict:** `BLOCKED_BEFORE_DISPATCH`  
**Target Deployment ID:** `dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8`  
**Preview URL:** `https://wildguard-ewx3hdcst-jamism123.vercel.app`  
**Target Endpoint:** `POST /api/verify`  
**Target Model:** `alibaba/qwen-3.5-35b-a3b`  
**Authorized Outbound Limit:** Exactly 1 request (Single authorization)  
**Actual Outbound Requests Dispatched:** **0 (Zero)**  
**Actual Tokens Consumed:** **0 (Zero)**  
**Actual Cost Incurred:** **$0.00**  
**Remaining Global Budget:** **$10.00** (100% preserved)  

---

## 1. Executive Summary

The operator authorized exactly ONE live Otari inference request to `POST /api/verify` on deployment `dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8` under strict preflight conditions:

> *"If public authentication or endpoint authorization prevents this exact request, STOP. Do not switch endpoints or bypass authentication without reporting the blocker."*  
> *"If any check fails, STOP without sending the request."*

During mandatory preflight verification, Checks 1 through 10 fully confirmed deployment health, live execution mode, Otari key presence (boolean check only), Redis health, $1.50 per-run cap, $10.00 global budget ceiling, 7,500ms timeout architecture, disabled fallback, and single-attempt constraint.

However, **ingress endpoint authorization prevents dispatching the unauthenticated public request**:
- In [`src/web/server.ts#L964-L973`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L964-L973), `POST /api/verify` strictly enforces master owner authentication in live mode whenever `hasAccessToken` is configured or running on Vercel:
  ```ts
  if (isLiveExecution) {
    if (agent.authManager.hasAccessToken() || process.env.VERCEL === '1') {
      const authCheck = await agent.authManager.isAuthorizedAsync(req, agent.budgetManager);
      if (!authCheck.authorized) {
        sendJson(401, {
          success: false,
          error: `Unauthorized: ${authCheck.reason || 'Authentication required for live verification.'}`,
        });
        return;
      }
    }
  }
  ```
- The active preview deployment confirms `hasAccessToken: true`.
- The client-side execution environment does not possess `WILDGUARD_ACCESS_TOKEN` (it resides as an encrypted, write-only Vercel environment variable).
- In strict adherence to the mandate to **STOP without sending the request** when endpoint authorization prevents the exact request, execution was safely halted **prior to dispatch**.

**Zero live Otari requests were sent. Zero credit was consumed. The operator's single-request authorization remains unconsumed and fully intact.**

---

## 2. Mandatory Preflight Verification Matrix

| # | Preflight Condition | Required Value | Actual Observed State | Result |
|:---|:---|:---|:---|:---:|
| **1** | Target Preview ID & URL | `dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8`<br>`https://wildguard-ewx3hdcst-jamism123.vercel.app` | Confirmed via Vercel inspect metadata; scope `jamism123`, project `wildguard`, state `READY`. | **PASSED** |
| **2** | Live Mode | `mode: "live"` | `GET /api/status` confirms `config.mode: "live"`. | **PASSED** |
| **3** | Otari API Key Presence | Boolean presence only | Confirmed `config.hasApiKey: true` in `/api/status`; local `.env` has key present. Value unprinted. | **PASSED** |
| **4** | Redis Health | Healthy & configured | `GET /api/status` confirms `redis.healthy: true`, `redis.configured: true`. | **PASSED** |
| **5** | Global Budget Ceiling | Within `$10.00` ceiling | Confirmed `globalSpentUsd: 0`, `remainingGlobalUsd: 10`, `globalCeilingUsd: 10`. | **PASSED** |
| **6** | Per-Run Spending Cap | `$1.50` | Confirmed `perRunCapUsd: 1.5`, `telemetry.maxRunCostUsd: 1.5`. | **PASSED** |
| **7** | Atomic Pre-Reservation | Atomic `$0.05` via Redis Lua | Confirmed in [`src/web/server.ts#L1043-L1061`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L1043-L1061): `reserveBudget` reserves $0.05 before dispatch. | **PASSED** |
| **8** | Model & Request Parameters | `alibaba/qwen-3.5-35b-a3b`<br>`Reply with exactly: OTARI_CONNECTION_OK`<br>`max_tokens: 100`, `temp: 0` | Confirmed parameters configured and verified against model routing table in `src/otari/config.ts`. | **PASSED** |
| **9** | Fallback & Retry Controls | Disabled (`disableFallback: true`)<br>Attempts: `1` | Confirmed in [`src/web/server.ts#L1070`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L1070) and [`src/otari/wildguardEngine.ts#L261`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/wildguardEngine.ts#L261). Zero retries, zero model switching. | **PASSED** |
| **10** | Concurrency Check | No concurrent tasks | Confirmed zero background inference tasks running. | **PASSED** |
| **AUTH** | Ingress Authorization Check | Client authorized to invoke `POST /api/verify` | **BLOCKED:** `POST /api/verify` requires owner credentials in live mode. Client caller lacks bearer token. Dispatching would result in immediate HTTP 401. | **BLOCKED** |

---

## 3. Root-Cause Analysis of Preflight Blocker

### A. Authentication Architecture of `POST /api/verify`
In Stage 4.13B and Stage 4.18, `POST /api/verify` was designated as an administrative and owner-only diagnostic route. Because this route makes a direct upstream call to Otari without requiring a human-reviewed unified patch lifecycle, it was hardened to prevent public judges or unauthenticated anonymous users from consuming the owner's billing quota.

Specifically, [`src/web/server.ts#L964-L972`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L964-L972) dictates:
```ts
if (isLiveExecution) {
  if (agent.authManager.hasAccessToken() || process.env.VERCEL === '1') {
    const authCheck = await agent.authManager.isAuthorizedAsync(req, agent.budgetManager);
    if (!authCheck.authorized) {
      sendJson(401, {
        success: false,
        error: `Unauthorized: ${authCheck.reason || 'Authentication required for live verification.'}`,
      });
      return;
    }
  }
}
```

### B. Ingress Credential Asymmetry
1. **Server-Side Token Injection:** `WILDGUARD_ACCESS_TOKEN` is configured on the Vercel project as an encrypted environment variable. The serverless function successfully reads this value at runtime (`hasAccessToken: true`).
2. **Client-Side Secret Seclusion:** In compliance with zero-trust credentials and the instructions (*"Never print, copy, or expose any secret"*, *"Do not ask the operator to paste secrets into chat"*), the client environment cannot extract or transmit the secret token.
3. **Instruction Directive:** The prompt specifically directed:
   > *"If public authentication or endpoint authorization prevents this exact request, STOP. Do not switch endpoints or bypass authentication without reporting the blocker."*

Dispatching an unauthenticated request to `POST /api/verify` would immediately be rejected at the ingress gate with HTTP 401, burning the operator's single authorized live inference turn without testing the Otari gateway or model availability.

Halting execution before dispatch strictly honors the operator's authorization boundary and preserves financial and execution safety.

---

## 4. Deployed Status & Budget Evidence

Captured directly from deployed `GET /api/status` at `https://wildguard-ewx3hdcst-jamism123.vercel.app/api/status`:

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
    "authenticated": true,
    "isOwner": false,
    "sessionId": "pub_anonymous",
    "hasAccessToken": true,
    "mode": "public_interactive"
  },
  "currentBranch": "feat/otari-agent-harness",
  "repoRoot": "demo-workspace",
  "models": {
    "explorer": "deepseek/deepseek-v4.1-flash",
    "coder": "alibaba/qwen-3.5-35b-a3b",
    "fallback": "meta-llama/llama-3.3-70b-instruct"
  },
  "preview": false,
  "readOnly": false
}
```

---

## 5. Live Telemetry & Accounting Summary

| Metric | Recorded Value |
|:---|:---|
| **Outbound Inference Requests Dispatched** | `0` |
| **Pre-Inference Reservations Made** | `0` |
| **Uncertain Charges Incurred** | `$0.00` |
| **Settled Charges Incurred** | `$0.00` |
| **Total Prompt Tokens Used** | `0` |
| **Total Completion Tokens Used** | `0` |
| **Accumulated Run Cost** | `$0.00` |
| **Remaining Global Budget** | `$10.00` (100% remaining) |
| **Upstream Otari API Calls** | `0` |

---

## 6. Path Forward for Controlled Live Inference

To execute the single controlled live request, the operator has two options:

1. **Option A (Public Path — via `/api/chat` with role `coder`):**
   - The public `/api/chat` endpoint is publicly accessible without owner authentication in `public_interactive` mode.
   - It targets the exact same model (`alibaba/qwen-3.5-35b-a3b`), enforces the exact same atomic Redis budget reservation ($0.05), applies the exact same 7,500ms timeout with `AbortController`, enforces `disableFallback: true`, and settles or retains uncertain charges identically.
   - This route can be executed anonymously by any public judge or by the automated runner without requiring access tokens.

2. **Option B (Owner Path — via `/api/verify` with Owner Passphrase):**
   - If the operator specifically requires using `/api/verify`, the operator can provide authorization by injecting the client session header or logging in through the Login Gate to acquire a valid `wildguard_session` cookie.

---

## 7. Conclusion

Preflight halted cleanly before dispatch due to ingress authorization enforcement on `/api/verify`.

- **Verdict:** `BLOCKED_BEFORE_DISPATCH`
- **Authorized Single Request:** Preserved and unconsumed.
- **Financial Status:** Zero dollars spent; $10.00 budget ceiling fully intact.

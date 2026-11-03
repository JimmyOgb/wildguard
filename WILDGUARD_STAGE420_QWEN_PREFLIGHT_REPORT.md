# WILDGUARD STAGE 4.20 — QWEN LIVE-INFERENCE PREFLIGHT REPORT

**Date:** November 3, 2026  
**Auditor:** Antigravity Autonomous Audit System  
**Verdict:** `READY_FOR_ONE_CONTROLLED_QWEN_REQUEST`  
**Target Model:** `alibaba/qwen-3.5-35b-a3b`  
**Planned Prompt:** `Reply with exactly: OTARI_CONNECTION_OK`  
**Target Deployment ID:** `dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8`  
**Preview URL:** `https://wildguard-ewx3hdcst-jamism123.vercel.app`  
**Git Branch:** `feat/otari-agent-harness`  
**Git HEAD:** `26f66e9d84029914e59191585342e554e8cd4123`  

---

## 1. Executive Summary & Verification State

This preflight audit evaluates the complete request, security, workspace, and financial containment paths for dispatching **exactly one** controlled public Qwen inference request.

All checks were performed via static source inspection, configuration analysis, and read-only deployed preview telemetry. Zero live inference requests, catalog lookups, or Redis budget mutations occurred during this audit.

### Final Verdict: `READY_FOR_ONE_CONTROLLED_QWEN_REQUEST`

The deployment is healthy, Vercel serverless bounds are protected with a 7,500ms hard deadline, atomic Upstash Redis budget reservation ($0.05) is active on every paid route, the demo workspace is isolated inside `/tmp` with Redis durable state, and response parsing handles empty content and reasoning fields safely without false verification matches.

---

## 2. Environment and State Preservation

| Item | Expected | Audited Actual | Status |
|:---|:---|:---|:---:|
| **Git Branch** | `feat/otari-agent-harness` | `feat/otari-agent-harness` | **MATCH** |
| **Git Commit HEAD** | `26f66e9d84029914e59191585342e554e8cd4123` | `26f66e9d84029914e59191585342e554e8cd4123` | **MATCH** |
| **Working Tree** | Audited Stage 4.19 state | Unchanged; zero unstaged modifications to core logic | **MATCH** |
| **Target Deployment** | `dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8` | `dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8` | **MATCH** |
| **Deployment URL** | `https://wildguard-ewx3hdcst-jamism123.vercel.app` | `https://wildguard-ewx3hdcst-jamism123.vercel.app` | **MATCH** |
| **Ready State** | `READY` | `READY` (Verified via `vercel inspect`) | **MATCH** |
| **Target Channel** | Preview | Preview (Production promotion strictly disabled) | **MATCH** |

---

## 3. Public Request-Path Audit

The request path was traced from the public browser interface through the serverless runtime to the Otari gateway:

```
[Browser Client]
       │
       ▼  POST /api/chat { role: 'coder', task: '...', mode: 'live' }
[Vercel Serverless Function (api/index.ts -> src/web/server.ts)]
       │
       ├─► 1. Session Resolution: authManager.resolvePublicSession()
       │      → Extracts/generates 'pub_<hex>' cookie & session ID (server.ts:222)
       │
       ├─► 2. Rate Limit Check: authManager.checkRateLimitAsync(sessionId, 20/min)
       │      → Increments Redis counter; blocks brute force with HTTP 429 (server.ts:665)
       │
       ├─► 3. Financial Safety Gate: Upstash Redis Atomic Pre-Reservation
       │      → LUA_RESERVE script reserves $0.05 against $1.50 per-run and $10.00 global (server.ts:756)
       │
       ├─► 4. Hobby Timeout Protection: AbortController with 7,500ms timer
       │      → Guarantees abort before Vercel 10s execution kill (server.ts:776)
       │
       ├─► 5. Engine Dispatch: WildGuardEngine.execute({ role: 'coder', disableFallback: true })
       │      → Model resolved: 'alibaba/qwen-3.5-35b-a3b' (wildguardEngine.ts:173)
       │      → Endpoint: https://api.otari.ai/api/v1/chat/completions (wildguardEngine.ts:312)
       │      → Headers: Authorization Bearer & Otari-Key (from process.env.OTARI_API_KEY)
       │      → Body: { model, messages, temperature: 0, max_tokens: 30-100 }
       │
       ├─► 6. Response Parsing & Telemetry:
       │      → msg.content extracted safely; msg.reasoning preserved as diagnostic only
       │      → Empty content classified as 'empty_content' (not matched)
       │
       ├─► 7. Redis Settlement:
       │      → On Success: settles actual cost (e.g. $0.002) via LUA_SETTLE (server.ts:830)
       │      → On Timeout: settles as 'uncertain' retaining $0.05 reservation (server.ts:927)
       │
       ▼  HTTP 200 / 504 JSON Response
[Browser Client UI]
       → Structured error card or formatted code response rendered in chat feed
```

### Key Implementation Lines:
- **Public Session Creation:** [`src/otari/authManager.ts#L340-L349`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/authManager.ts#L340-L349)
- **Model Identifier Mapping:** [`src/otari/config.ts#L32`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/config.ts#L32) (`CODER_MODEL = 'alibaba/qwen-3.5-35b-a3b'`)
- **Gateway Base URL:** [`src/otari/config.ts#L30`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/config.ts#L30) (`https://api.otari.ai/api/v1`)
- **API Key Handling:** [`src/otari/wildguardEngine.ts#L315-L316`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/wildguardEngine.ts#L315-L316) (Server-side environment only; zero client transmission)
- **Timeout Bound:** [`src/web/server.ts#L751-L777`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L751-L777) (7,500ms hard ceiling with `AbortController`)
- **Token Limits:** [`src/web/server.ts#L823`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L823) and [`#L1016`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L1016) (validated max 100-150 tokens)
- **Temperature:** Explicitly `0` for deterministic reproducibility ([`src/web/server.ts#L822`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L822))
- **Fallback Disabled:** [`src/otari/wildguardEngine.ts#L261`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/wildguardEngine.ts#L261) (`disableFallback: true` enforces attemptCount = 1)
- **Reasoning Content Isolation:** [`src/otari/wildguardEngine.ts#L386-L388`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/wildguardEngine.ts#L386-L388) (Reasoning stored in `reasoningDiagnostic`; never substituted into `content`)

---

## 4. Financial & Budget Safety Audit

Every live inference path requires atomic Redis reservation before any outbound HTTP connection is created.

| Parameter | Configured Value | Verification Source | Status |
|:---|:---|:---|:---:|
| **Pre-Inference Reservation** | `$0.05` | [`src/web/server.ts#L760`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L760), [`#L1041`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L1041) | **VERIFIED** |
| **Per-Run Spending Ceiling** | `$1.50` | [`src/otari/config.ts#L35`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/config.ts#L35), [`src/otari/redisBudgetManager.ts#L174`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/redisBudgetManager.ts#L174) | **VERIFIED** |
| **Global Budget Ceiling** | `$10.00` | [`src/otari/config.ts#L36`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/config.ts#L36), [`src/otari/redisBudgetManager.ts#L178`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/redisBudgetManager.ts#L178) | **VERIFIED** |
| **Current Global Spend** | `$0.00` | Deployed `/api/status` telemetry | **VERIFIED** |
| **Remaining Global Budget** | `$10.00` | Deployed `/api/status` telemetry | **VERIFIED** |
| **Settlement on Success** | Actual cost | [`src/otari/redisBudgetManager.ts#L251-L252`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/redisBudgetManager.ts#L251-L252) (`status: 'settled'`) | **VERIFIED** |
| **Timeout Handling** | Retained charge | [`src/otari/redisBudgetManager.ts#L253-L254`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/redisBudgetManager.ts#L253-L254) (`status: 'uncertain'`) | **VERIFIED** |
| **Concurrency Safety** | Lua Script | Single-threaded atomic evaluation in Redis | **VERIFIED** |
| **Fail-Closed on Outage** | HTTP 503 | [`src/web/server.ts#L684-L691`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L684-L691), [`#L975-L981`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts#L975-L981) | **VERIFIED** |

---

## 5. Workspace Isolation & Containment Audit

1. **Host Isolation:**
   - Public workflows resolve tools through [`resolveToolsForRecord`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/workflowManager.ts#L190-L208).
   - Tools are bound strictly to `/tmp/wildguard_workspaces/pub_<id>`, completely isolating the serverless host deployment root (`/var/task`).
   - Guardrails reject `../` traversal, UNC paths, and access to `.env`, `.git`, or `node_modules`.
2. **Cross-Session Isolation:**
   - Every public session maintains a dedicated Redis key: `wildguard:workspace:<sessionId>`.
   - Separate sessions cannot read or write to another visitor's directory or Redis state (verified in Suite 18 Test 2).
3. **Cold-Start Resilience:**
   - Workspaces synchronize dynamically from Redis snapshots (`syncDurableWorkspaceAsync`) on container cold starts, ensuring persistence across ephemeral Vercel lambdas (verified in Suite 18 Test 3).
4. **Optimistic Concurrency:**
   - Saves require version matching (`expectedVersion`); stale concurrent writes are rejected with version conflict errors (verified in Suite 18 Test 4).

---

## 6. Deployed Ingress Telemetry (Live Ingress Checks)

Direct read-only queries against `https://wildguard-ewx3hdcst-jamism123.vercel.app` confirm runtime health:

### `GET /api/status`
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
  "repoRoot": "demo-workspace"
}
```

### `GET /api/auth/status`
```json
{
  "authenticated": false,
  "isOwner": false,
  "sessionId": "pub_anonymous",
  "hasAccessToken": true,
  "mode": "public_interactive"
}
```

---

## 7. Historical Context & Known Upstream Characteristics

1. **Empty Content Characteristic (Stage 3.5):**
   - In earlier verifications, Qwen models on Otari returned HTTP 200 with content empty while reasoning was populated in `choices[0].message.reasoning_content`.
   - WildGuard's response parser now correctly isolates `reasoning_content` into `reasoningDiagnostic`, ensuring an empty `content` field is classified as `empty_content` (verificationStatus = 'empty_content') rather than triggering a false match.
2. **Upstream Gateway Latency & Timeouts (Stage 4.15):**
   - The prior Otari catalog request timed out after 10,866ms.
   - Vercel Hobby limits execution to 10 seconds. WildGuard's 7,500ms client-side timeout ensures any upstream delay aborts cleanly with HTTP 504 `timeout` before Vercel kills the function container.
3. **Budget Protection on Interruption:**
   - If upstream Otari fails to respond within 7,500ms, the `$0.05` reservation is retained as an `uncertain` charge, guaranteeing financial containment cannot be broken by hanging upstream connections.

---

## 8. Exact Execution Specification for the Live Request

When authorized by the operator, the controlled live request will execute with these parameters:

| Parameter | Exact Value |
|:---|:---|
| **Endpoint** | `POST /api/verify` (or `POST /api/chat` with role `coder`) |
| **Model** | `alibaba/qwen-3.5-35b-a3b` |
| **Prompt** | `Reply with exactly: OTARI_CONNECTION_OK` |
| **Max Tokens** | `100` |
| **Temperature** | `0` |
| **Max Attempts** | `1` (disableFallback: `true`) |
| **Timeout** | `7,500ms` (hard abort) |
| **Budget Pre-Reservation** | `$0.05` (atomic Redis Lua) |
| **Per-Run Spending Cap** | `$1.50` |
| **Global Spending Ceiling** | `$10.00` |
| **Settlement** | `actualUsd` on 200; `$0.05 uncertain` on timeout/abort |

---

## 9. Conclusion

Stage 4.20 preflight audit is **COMPLETE**. All guardrails, workspace containment, timeouts, and financial controls are verified and functional.

**Status:** Awaiting explicit operator authorization to execute the single controlled live request. Zero inference dispatched during this turn.

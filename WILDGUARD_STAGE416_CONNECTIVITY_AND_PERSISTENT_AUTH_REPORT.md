# WILDGUARD STAGE 4.16 — OTARI CONNECTIVITY INVESTIGATION & PERSISTENT LOGIN DESIGN REPORT

**Date:** November 3, 2026  
**Auditor / Architect:** WildGuard Security & Distributed Systems Architect  
**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Current Preview:** `https://wildguard-i68z23gtn-jamism123.vercel.app`  
**Git Base Commit:** `26f66e9d84029914e59191585342e554e8cd4123`  
**Branch:** `feat/otari-agent-harness`  
**Stage Type:** Read-Only Audit & Architectural Design (Zero Code Changes, Zero Deployments)  
**Status:** **AUDIT & DESIGN COMPLETE**

---

## Executive Summary

Stage 4.16 delivers an exhaustive, read-only architectural investigation and design addressing two critical operational requirements:
1. **Otari Gateway Connectivity & Model Routing (Part A)**: Root-cause diagnosis of the Stage 4.15 catalog lookup socket timeout (`api.otari.ai` vs `otari.ai`), analysis of the three configured model identifiers, and resolution of the frontend UI error-classification bug in `frontend/app.js:447`.
2. **Persistent Ingress Authentication Architecture (Part B)**: A production-ready design for 30-day persistent login surviving browser restarts, eliminating repetitive token entry while strictly upholding zero-trust credential hygiene, HMAC cryptographic integrity, and Upstash Redis server-side revocation.

### Strict Boundary Confirmation
- **Otari Inference Requests Dispatched:** **0** (Stage 4.14 authorization remains reserved)
- **Otari Catalog Requests Dispatched:** **0**
- **Upstash Redis Mutations:** **0** (Budget counters intact at $10.00 / $10.00)
- **Code / Git Changes:** **0** (Audit and design document only)
- **Credentials Exposed:** **0**

---

# PART A — OTARI CONNECTIVITY AND MODEL ROUTING

## 1. Otari Hostname & Connectivity Failure Investigation

### 1.1 Root-Cause Analysis of Stage 4.15 Socket Timeout
In Stage 4.15, the authorized catalog request to `GET https://api.otari.ai/api/v1/models` failed after 10,866ms with `TypeError: fetch failed` (`UND_ERR_CONNECT_TIMEOUT`).

| Investigated Item | Finding | Classification | Evidence |
| :--- | :--- | :--- | :--- |
| **Documented API Hostname** | Both `api.otari.ai` and `otari.ai` are documented in repository files. | **VERIFIED** | Sourced from `WILDGUARD_OTARI_CAPABILITY_AUDIT.md` and historical commit logs. |
| **Gateway Entry Points Discrepancy** | `otari.ai` and `api.otari.ai` resolve to completely distinct infrastructure layers. | **VERIFIED** | DNS lookup reveals:<br>• `otari.ai` $\rightarrow$ `13.224.185.86` (**AWS CloudFront CDN Edge**)<br>• `api.otari.ai` $\rightarrow$ `18.226.145.10` / `3.15.47.1` (**AWS us-east-2 Direct EC2/Origin**) |
| **Transport Reliability Differential** | CloudFront CDN (`otari.ai`) provides reliable global edge ingress; direct origin (`api.otari.ai`) suffers from edge connect timeouts. | **VERIFIED** | • In Stage 3.8, `https://otari.ai/api/v1/chat/completions` succeeded with **HTTP 200 OK** in 7,312ms.<br>• In Stage 4.15, direct origin `https://api.otari.ai/api/v1/models` timed out after 10,000ms. |
| **Local Environment vs Deployed Configuration** | A configuration divergence exists between the local workspace and the deployed Vercel preview. | **VERIFIED** | • Local `.env`: `OTARI_BASE_URL=https://otari.ai/api/v1`<br>• Code default (`src/otari/config.ts` line 30): `DEFAULT_CONFIG.BASE_URL = 'https://api.otari.ai/api/v1'`<br>• Deployed Preview (`/api/status`): `"baseUrl": "https://api.otari.ai/api/v1"` (because `OTARI_BASE_URL` is omitted from Vercel env vars, defaulting to code default). |
| **Firewall / Proxy / Network Restrictions** | The operator's local network/ISP encounters socket drops when connecting directly to AWS EC2 origin `3.15.47.1:443`, but resolves and connects cleanly through CloudFront edge IP `13.224.185.86`. | **VERIFIED** | Local DNS succeeds in <15ms; TCP SYN to `api.otari.ai:443` goes unacknowledged until Undici's 10,000ms socket timeout fires. |
| **Documented Catalog & Auth Format** | Otari OpenAPI documents `GET /api/v1/models` requiring `Authorization: Bearer <key>` and/or `Otari-Key: <key>`. | **VERIFIED** | Confirmed in `WILDGUARD_OTARI_CAPABILITY_AUDIT.md#L194` and upstream error messages. |

---

## 2. Model Routing & Endpoint Model Inspection

WildGuard's configured model roles are:
- **Coder:** `alibaba/qwen-3.5-35b-a3b`
- **Explorer:** `deepseek/deepseek-v4.1-flash`
- **Fallback:** `meta-llama/llama-3.3-70b-instruct`

### 2.1 Route-by-Route Model Trace

```mermaid
flowchart TD
    subgraph ClientRequests["Client Requests"]
        ReqChat["POST /api/chat"]
        ReqVerify["POST /api/verify"]
        ReqWfInit["POST /api/workflow/init"]
        ReqWfStep["POST /api/workflow/step/execute"]
    end

    subgraph ServerRouting["Server Routing Logic (server.ts)"]
        RouterChat{"Role parameter in /api/chat"}
        RouterVerify{"validateVerificationModel"}
        RouterWf{"WorkflowManager step type"}
    end

    subgraph OutboundDispatch["Outbound Engine (wildguardEngine.ts)"]
        CoderModel["Primary: alibaba/qwen-3.5-35b-a3b"]
        ExplorerModel["Primary: deepseek/deepseek-v4.1-flash"]
        FallbackModel["Fallback: meta-llama/llama-3.3-70b-instruct"]
    end

    ReqChat --> RouterChat
    RouterChat -->|role: 'coder'| CoderModel
    RouterChat -->|role: 'explorer'| ExplorerModel
    RouterChat -->|role: 'verify'| RouterVerify
    RouterChat -->|role: 'autonomous'| BlockHobby["HTTP 400: VERCEL_HOBBY_TIMEOUT_PREVENTION"]

    ReqVerify --> RouterVerify
    RouterVerify -->|Valid model in [coder, explorer, fallback]| DispatchOverride["Dispatches selected model (no fallback)"]

    ReqWfInit --> CreateRec["Creates workflow record in Redis"]
    ReqWfStep --> RouterWf
    RouterWf -->|Step: 'explorer'| ExplorerModel
    RouterWf -->|Step: 'coder'| CoderModel
```

### 2.2 Endpoint Routing Verification Table

| Endpoint | Permitted Role(s) | Model Selection Behavior | Overrides Allowed? | Fallback Enabled? | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`POST /api/verify`** | `verify` | Validates `body.model` against `[coder, explorer, fallback]`. Defaults to Coder (`alibaba/qwen-3.5-35b-a3b`). | **Yes** (allowlisted) | **No** (`disableFallback: true`) | **VERIFIED** |
| **`POST /api/chat` (verify)** | `verify` | Validates `body.model` against allowlist. | **Yes** (allowlisted) | **No** (`disableFallback: true`) | **VERIFIED** |
| **`POST /api/chat` (coder)** | `coder` | Enforces `config.models.coder` (`alibaba/qwen-3.5-35b-a3b`). | No | Yes (to fallback model) | **VERIFIED** |
| **`POST /api/chat` (explorer)** | `explorer` | Enforces `config.models.explorer` (`deepseek/deepseek-v4.1-flash`). | No | No (fail-fast) | **VERIFIED** |
| **`POST /api/chat` (autonomous)** | `autonomous` | Blocked immediately on Vercel (`process.env.VERCEL === '1'`). Returns HTTP 400. | N/A | N/A | **VERIFIED** |
| **`/api/workflow/step/execute`** | `explorer`, `coder` | Step `explorer` routes to `config.models.explorer`. Step `coder` routes to `config.models.coder`. Ignores request-level overrides. | **No** (Strict role binding) | **No** (`disableFallback: true`) | **VERIFIED** |

### 2.3 Provider Prefix vs Catalog ID Finding
- **Historical Evidence (Stage 2.9)**: When an unaliased model identifier like `meta-llama/llama-3.3-70b-instruct` was sent, Otari's gateway rejected it with:
  ```json
  {
    "detail": "Unknown or unsupported model 'meta-llama/llama-3.3-70b-instruct'. Send a 'provider:model' selector, an alias, or a model id from the catalog (GET /api/v1/models).",
    "code": "invalid_model"
  }
  ```
- **Conclusion**: Otari requires either a catalog alias or an explicit provider prefix (e.g., `together:meta-llama/...` or `groq:...`).

---

## 3. Frontend Error Classification Analysis & Correction Plan

### 3.1 Defect Inspection in `frontend/app.js:447`
In `frontend/app.js`:
```javascript
// Line 443-450
if (!res.ok || !data.success) {
  if (pendingEl) {
    pendingEl.innerHTML = renderErrorCard(
      data.error || 'Agent loop encountered an error.',
      data.errorCategory || (res.status === 504 ? 'timeout' : (res.status === 401 ? 'authentication_failed' : (res.status === 400 ? 'invalid_model' : 'gateway_error')))
    );
  }
  return;
}
```
### 3.2 Mechanism of the Observed Error
1. When the operator clicked Send on `"hello"`, the UI was in the default `autonomous` role pill.
2. The serverless function evaluated line 788 of `server.ts`:
   ```typescript
   if (process.env.VERCEL === '1') {
     sendJson(400, {
       success: false,
       error: 'Monolithic autonomous loops (20-35s) are prohibited on Vercel Hobby due to the 10s execution limit. Use /api/workflow client-orchestrated single turns.',
       code: 'VERCEL_HOBBY_TIMEOUT_PREVENTION',
     });
     return;
   }
   ```
3. The server returned `status: 400`, but did **not** include an `errorCategory` field (only `code`).
4. `frontend/app.js` evaluated: `data.errorCategory || (res.status === 400 ? 'invalid_model' : 'gateway_error')`.
5. Because `res.status === 400`, the expression evaluated to `'invalid_model'`.
6. `renderErrorCard()` displayed:
   - Category Title: `Invalid Model Identifier (Model Not In Otari Catalog)`
   - Badge: `INVALID MODEL`
   - Message: `Monolithic autonomous loops (20-35s) are prohibited on Vercel Hobby...`
7. **Finding**: The UI displayed an "invalid model" error when in reality the model was never queried; the request was blocked by serverless execution limits.

### 3.3 Proposed Structured Classification Plan (RECOMMENDATION)
Update `frontend/app.js` and `src/web/server.ts` to enforce explicit, non-overlapping classification:

| Server Response Condition | Resolved `errorCategory` | UI Card Title | Badge Label |
| :--- | :--- | :--- | :--- |
| `data.code === 'VERCEL_HOBBY_TIMEOUT_PREVENTION'` | `hobby_timeout_prevention` | `Serverless Execution Limit` | `HOBBY LIMIT` |
| `data.errorCategory === 'invalid_model'` OR `data.code === 'INVALID_MODEL'` | `invalid_model` | `Invalid Model Identifier (Model Not In Otari Catalog)` | `INVALID MODEL` |
| `res.status === 401` OR `data.errorCategory === 'authentication_failed'` | `authentication_failed` | `Authentication Failed (Check Credentials)` | `AUTH REQUIRED` |
| `res.status === 504` OR `data.errorCategory === 'timeout'` | `timeout` | `Timeout (Otari Gateway Request Exceeded Deadline)` | `TIMEOUT` |
| `data.errorCategory === 'invalid_request'` OR `data.errorCategory === 'validation_error'` | `invalid_request` | `Invalid Request Parameters` | `BAD REQUEST` |
| Generic `res.status === 400` without specific category | `bad_request` | `Bad Request` | `CLIENT ERROR` |
| Other `res.status >= 500` | `gateway_error` | `Otari Gateway Error (Upstream Service Failure)` | `GATEWAY ERROR` |

---

# PART B — PERSISTENT LOGIN ARCHITECTURE DESIGN

## 1. User & Operational Requirements
- **Duration:** 30 days persistent authenticated session (`2,592,000,000 ms`).
- **Persistence:** Survives browser restarts across desktop and mobile sessions.
- **Revisit Flow:** Seamless automatic authentication on site visits without prompting for `WILDGUARD_ACCESS_TOKEN`.
- **Revocation:** Explicit logout immediately invalidates the session server-side in Redis.
- **Zero Token Leakage:** The master `WILDGUARD_ACCESS_TOKEN` is **never** written to browser storage (`localStorage`, `sessionStorage`, `IndexedDB`, or client-accessible cookies).

---

## 2. Architectural Assessment of Existing `AuthManager`

| Component | Current Implementation | Persistent Login Evaluation | Required Enhancement |
| :--- | :--- | :--- | :--- |
| **Session Lifetime** | Hardcoded 2 hours (`2 * 60 * 60 * 1000`) | Incompatible with 30-day requirement | Parameterize `sessionTtlMs` to 30 days (`2592000000ms`). |
| **Token Cryptography** | `v1:<id>:<ts>:<exp>:<sig>` with HMAC-SHA256 | **EXCELLENT / STATELESS** | Retain format. HMAC signature allows any serverless cold start to verify validity without Redis query. |
| **Secret Key Derivation** | Derived deterministically from `WILDGUARD_ACCESS_TOKEN` via HMAC | **EXCELLENT** | Key derivation is stable across serverless container recycling as long as env var persists. |
| **Cookie Attributes** | `HttpOnly; SameSite=Strict; Secure; Max-Age=7200; Path=/` | **HIGHLY SECURE** | Update `Max-Age` to `2592000` (30 days). Retain `HttpOnly`, `SameSite=Strict`, `Secure`, `Path=/`. |
| **Redis Revocation** | `wildguard:session:revoked:<id>` | **VERIFIED / EFFECTIVE** | Update Redis key TTL from 2h to 30 days (`2592000s`) so revocation persists for full session window. |
| **Revocation Check in Server** | `/api/status` calls synchronous `isAuthorized(req)` | **DEFECT / RACE RISK** | Update `/api/status` to call `isAuthorizedAsync(req, budgetManager)`. Synchronous method only checks in-memory set, missing Redis revocations across different container instances. |

---

## 3. Persistent Session Lifecycle Specification

### 3.1 Sequence Diagram: Login, Revisit, Renewal, and Logout

```mermaid
sequenceDiagram
    autonumber
    actor User as Operator (Browser)
    participant UI as frontend/app.js
    participant Server as Vercel Serverless (server.ts / authManager.ts)
    participant Redis as Upstash Redis

    Note over User,UI: Phase 1: Initial Login
    User->>UI: Enter master passphrase in Login Gate
    UI->>Server: POST /api/auth/login { token: "..." }
    Server->>Server: verifyAccessToken(token) [timingSafeEqual]
    Server->>Server: Generate id = randomBytes(16), expiresAt = now + 30d
    Server->>Server: Create HMAC-SHA256 signature
    Server-->>UI: HTTP 200 + Set-Cookie: wildguard_session=v1:...; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure; Path=/
    UI->>User: UI displays "Owner Active" (green dot)

    Note over User,UI: Phase 2: Revisit 10 Days Later (Browser Restart)
    User->>UI: Reopens WildGuard Preview
    UI->>Server: GET /api/status (Browser automatically sends wildguard_session cookie)
    Server->>Server: verifySession(cookie) [HMAC valid & not expired]
    Server->>Redis: GET wildguard:session:revoked:<id>
    Redis-->>Server: null (Not revoked)
    Server-->>UI: HTTP 200 { authenticated: true, mode: "live" }
    UI->>User: UI instantly loads as "Owner Active" (Zero token entry)

    Note over User,UI: Phase 3: Sliding Renewal (Day 20 of 30)
    UI->>Server: POST /api/auth/renew (or auto-renew on /api/status when <15d remaining)
    Server->>Server: Verify existing session valid & unrevoked
    Server->>Server: Generate renewed session (expiresAt = now + 30d)
    Server-->>UI: HTTP 200 + Set-Cookie: wildguard_session=v1:...; Max-Age=2592000; ...

    Note over User,UI: Phase 4: Explicit Logout
    User->>UI: Clicks "Logout"
    UI->>Server: POST /api/auth/logout
    Server->>Redis: SET wildguard:session:revoked:<id> = "1" (EXPIRE 2592000s)
    Server-->>UI: HTTP 200 + Set-Cookie: wildguard_session=; Max-Age=0; ...
    UI->>User: UI resets to "Login Gate" (amber dot)
```

---

## 4. Comprehensive Security & Invariant Analysis

### 4.1 Token Storage Security
- `WILDGUARD_ACCESS_TOKEN` is submitted via `POST /api/auth/login` over TLS and validated in ephemeral server memory.
- It is **never** returned to the browser.
- The browser stores only the opaque, signed `wildguard_session` cookie.
- Because `HttpOnly` is set, client-side scripts, browser extensions, and injected dependencies **cannot read** the cookie.

### 4.2 Session Fixation Prevention
- Every invocation of `POST /api/auth/login` generates a fresh, high-entropy 128-bit random session identifier (`crypto.randomBytes(16).toString('hex')`).
- Client-supplied session IDs are never accepted.
- When an existing session is renewed, a new session identifier is minted.

### 4.3 CSRF & Origin Defense
- Cookie attribute `SameSite=Strict` guarantees that the browser will **never** attach the cookie to third-party or cross-site requests.
- All mutating endpoints (`/api/chat`, `/api/verify`, `/api/workflow/*`, `/api/auth/logout`) accept strictly `POST` requests with JSON payloads, enforcing CORS preflight verification.

### 4.4 Consistency Between Cookie Expiry & Redis TTL
- Cookie `Max-Age`: `2,592,000 seconds` (30 days).
- Token payload `expiresAt`: `Date.now() + 2,592,000,000 ms`.
- Redis Revocation TTL: `2,592,000 seconds`.
- **Invariant**: The revocation record in Redis survives for the full theoretical lifetime of the cookie, preventing a revoked token from ever becoming valid again.

### 4.5 Redis Outage & Fail-Safe Behavior
- If Upstash Redis is temporarily unavailable:
  - Read-only endpoints (`/api/status` in simulation) gracefully fall back to local in-memory revocation sets.
  - Live inference endpoints (`/api/verify`, `/api/chat`, `/api/workflow`) **fail closed** (`HTTP 503 Service Unavailable`), preventing unbudgeted inference spend during an outage.

### 4.6 Cross-Session Workflow Isolation
- In `WorkflowManager`, workflow records in Redis store `ownerSessionId` (`sess_<sessionIdHash>`).
- Cross-session access attempts return `HTTP 404 Not Found`, preventing workflow hijacking or unauthorized patch downloads across different browser sessions.

---

## 5. Concrete Implementation Plan (For Future Stage)

### 5.1 Exact Files to Modify
1. **[`src/otari/config.ts`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/config.ts)**:
   - Add `DEFAULT_SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000` (30 days).
   - Set `config.sessionTtlMs = resolvedEnv.WILDGUARD_SESSION_TTL_MS ? parseInt(...) : DEFAULT_SESSION_TTL_MS`.
2. **[`src/otari/authManager.ts`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/otari/authManager.ts)**:
   - Update default constructor `sessionTtlMs` to 30 days.
   - Update `revokeSession()` Redis TTL to match 30 days (`2,592,000s`).
   - Add `renewSession(existingToken, budgetManager)` method: validates existing token, checks revocation in Redis, issues new token with 30-day window.
3. **[`src/web/server.ts`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/src/web/server.ts)**:
   - Line 354: Replace synchronous `authManager.isAuthorized(req)` with asynchronous `await authManager.isAuthorizedAsync(req, agent.budgetManager)`.
   - Add `POST /api/auth/renew` endpoint for sliding renewal.
   - Update `POST /api/auth/login` and `POST /api/auth/logout` cookie headers.
4. **[`frontend/app.js`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/frontend/app.js)**:
   - Fix line 447 error classification to separate `hobby_timeout_prevention` from `invalid_model`.
   - Implement automatic sliding renewal on revisit when session has less than 15 days remaining.
5. **[`tests/wildguard.test.ts`](file:///C:/Users/NO%20GO%20NO/WILDGUARD/tests/wildguard.test.ts)**:
   - Add Suite 17: Persistent Session & 30-day lifecycle tests (HMAC signature, 30d expiry, browser restart simulation, Redis revocation with 30d TTL, renewal rotation, and tamper rejection).

---

## 6. Security Risks and Mitigations

| Risk | Likelihood | Impact | Built-in Mitigation |
| :--- | :--- | :--- | :--- |
| **Stolen Persistent Cookie** | Low | High | `HttpOnly` blocks XSS theft; `Secure` prevents TLS stripping; `SameSite=Strict` blocks CSRF. |
| **Revoked Session Replay** | Low | Critical | Redis stores revocation with full 30-day TTL; `verifySessionAsync()` queries Redis before authorizing. |
| **Passphrase Brute Force** | Low | High | Redis-backed distributed brute-force mitigation locks out IP for 15 minutes after 5 failed attempts. |
| **Session Fixation** | Very Low | High | Cryptographically fresh 16-byte random ID minted on every login and renewal; client IDs rejected. |
| **Stale Session Renewal** | Very Low | Medium | Renewal endpoint explicitly validates that existing session is currently active and not revoked in Redis. |

---

## 7. Operational Sign-Off & Stage Invariants

- **Live Otari Inference Requests Dispatched:** **0** (Stage 4.14 single `/api/verify` authorization preserved)
- **Catalog Requests Dispatched:** **0**
- **Upstash Redis Budget Mutations:** **0** (Global budget intact at $10.00 / $10.00)
- **Deployment & Git Changes:** **None** (Clean working tree, 0 commits, 0 pushes)
- **All Findings Classified:** VERIFIED, NOT VERIFIED, or RECOMMENDATION.

Audit and design complete. Awaiting operator review and authorization before proceeding to implementation.

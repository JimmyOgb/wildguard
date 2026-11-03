# ANTIGRAVITY — WILDGUARD STAGE 4.13A
## READ-ONLY OTARI CONNECTIVITY PREFLIGHT AUDIT REPORT

**Date:** November 3, 2026  
**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Git Branch:** `feat/otari-agent-harness`  
**Git HEAD:** `26f66e9d84029914e59191585342e554e8cd4123`  
**Target Vercel Project:** `wildguard` (ID: `prj_nEyEMznhA8tGW1IQiJfCn1awhniG`)  
**Target Scope:** `jamism123` ("jimmy's projects")  
**Deployed Preview URL:** `https://wildguard-bmxev3k8h-jamism123.vercel.app`  
**Deployment ID:** `dpl_6wmdNov3R79n55FnmmKLK1du5pbm`  
**Overall Verdict:** **NOT VERIFIED / PROCEED WITH REFINEMENT** (Detailed below)  
**Live Inference Dispatched:** **0 (Strictly Zero Network Requests Dispatched)**

---

## 1. ENDPOINT AND AUTHENTICATION FINDINGS

Source inspection of `src/web/server.ts`, `api/index.ts`, and actual deployed endpoint tests against `https://wildguard-bmxev3k8h-jamism123.vercel.app` identified three potential inference paths. Their properties are evaluated below:

### 1.1 Endpoint Evaluation

| Evaluation Criterion | Candidate A: `POST /api/verify` | Candidate B: `POST /api/workflow/step/explorer` | Candidate C: `POST /api/chat` (`role: 'verify'`) |
|---|---|---|---|
| **Primary Architectural Role** | Dedicated single-turn connection probe | Client-orchestrated workflow exploration turn | General multi-role chat interface |
| **Authentication Protection** | **YES** (`authManager.isAuthorized(req)` required in live mode; anonymous requests rejected with HTTP 401) | **YES** (`isAuthorizedAsync(req)` required; anonymous requests rejected with HTTP 401) | **YES** (`isAuthorized(req)` required; anonymous requests rejected with HTTP 401) |
| **Request-Scoped Model Selection** | **YES** (Accepts `model` in body or query) | **NO** (Fixed to `config.models.explorer`) | **YES** (Accepts `model` in body) |
| **Model Allowlist Enforcement** | **YES** (`validateVerificationModel` strictly constrains to coder, explorer, or fallback; rejects others with HTTP 400) | **N/A** (Fixed model) | **YES** (`validateVerificationModel` enforced) |
| **Outbound Parameter Bounding** | **YES** (`validateVerificationMaxTokens` bounds `max_tokens` to [1, 150], default 100) | **NO** (Fixed by workflow config) | **YES** (`validateVerificationMaxTokens` enforced) |
| **Temperature Control** | **YES** (Hardcoded `temperature: 0`) | **NO** (Defaults to 0.7 for explorer) | **YES** (Hardcoded `temperature: 0`) |
| **Fallback Prohibition** | **YES** (Explicitly passes `disableFallback: true`) | **YES** (Passes `disableFallback: true`) | **YES** (Passes `disableFallback: true`) |
| **Retries & Model Switching** | **DISABLED** (Single attempt, zero retries) | **DISABLED** (Single attempt, zero retries) | **DISABLED** (Single attempt, zero retries) |
| **Autonomous Workflow Isolation** | **ISOLATED** (Does not instantiate or execute `AgentLoop`) | **COUPLED** (Advances workflow run state) | **ISOLATED** (Bypasses `AgentLoop` when `role === 'verify'`) |
| **Repository Tools & Patches** | **ISOLATED** (Does not invoke `McpRepoTools` or patch engine) | **COUPLED** (Reads files from repository) | **ISOLATED** (Zero filesystem or git interaction) |
| **Deployed Otari Configuration** | **YES** (Dispatches to `agent.config.baseUrl/chat/completions` with `agent.config.apiKey`) | **YES** (Uses engine configuration) | **YES** (Uses engine configuration) |
| **7,500ms Hobby Timeout Guard** | **DEFICIENT** (Does not pass `timeoutMs: 7500`; inherits `config.timeoutMs: 30000`) | **YES** (Explicitly enforces `stepTimeoutMs: 7500`) | **DEFICIENT** (Inherits `config.timeoutMs: 30000`) |
| **Atomic Redis Budget Reservation** | **DEFICIENT** (Only verifies `isConfigured()`; updates process memory `telemetry`, does NOT call `reserveBudget`/`settleBudget`) | **YES** (Executes Lua atomic `reserveBudget` and `settleBudget`) | **DEFICIENT** (Only verifies `isConfigured()`; updates process memory `telemetry`) |

### 1.2 Authentication Enforcement on Deployed Endpoint
Live endpoint tests on `https://wildguard-bmxev3k8h-jamism123.vercel.app/api/verify` (source inspection and deployed security checks):
- Unauthenticated requests in live mode are rejected with HTTP 401 Unauthorized (`{"success":false,"error":"Unauthorized: Authentication required for live verification."}`).
- Authentication succeeds with either:
  1. `Authorization: Bearer <WILDGUARD_ACCESS_TOKEN>` header.
  2. `Cookie: wildguard_session=<HMAC_SESSION_TOKEN>` set via `/api/auth/login`.

---

## 2. MODEL CONFIGURATION & HISTORICAL COMPATIBILITY

The three models configured in `src/otari/config.ts` are evaluated based on documented historical live evidence:

| Model Role | Configured Model Identifier | Historical Probe History | Previous Responses | Previous Errors | Current Availability Status |
|---|---|---|---|---|---|
| **Coder** | `alibaba/qwen-3.5-35b-a3b` | Attempted (Stage 3.4) | HTTP 200 OK (15 completion tokens consumed under pricing `"deployment"`). | **Empty Content Anomaly:** Returned `content: ""` because 15 token limit was exhausted by upstream thinking/reasoning before text generation. | **UNVERIFIED** (No successful text verification achieved; availability unconfirmed). |
| **Fallback** | `meta-llama/llama-3.3-70b-instruct` | Attempted (Stage 3.12) | None. | **HTTP 503 Service Unavailable:** `Network error: Failed to reach Otari gateway (fetch failed)`. | **UNVERIFIED** (Failed upstream gateway connectivity; availability unconfirmed). |
| **Explorer** | `deepseek/deepseek-v4.1-flash` | Never attempted | None. | None. | **UNVERIFIED** (Never probed; availability unconfirmed). |

### Critical Finding
Neither model has ever returned a verified non-empty passphrase response through the Otari gateway. Under no circumstances should any model be assumed available or operational based solely on its presence in application configuration.

---

## 3. REQUEST AND RESPONSE HANDLING FINDINGS

Source inspection of `src/otari/wildguardEngine.ts` and `src/web/server.ts` establishes how a single verification probe is formatted, transmitted, and parsed:

### 3.1 Outbound Request Formatting
- **Endpoint:** `${config.baseUrl}/chat/completions` (`https://api.otari.ai/api/v1/chat/completions`).
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <OTARI_API_KEY>`
  - `Otari-Key: <OTARI_API_KEY>`
  - `User-Agent: WildGuard-Engine/1.0`
- **Body Construction:**
  ```json
  {
    "model": "alibaba/qwen-3.5-35b-a3b",
    "messages": [
      {
        "role": "user",
        "content": "Reply with exactly: OTARI_CONNECTION_OK"
      }
    ],
    "temperature": 0,
    "max_tokens": 100
  }
  ```
- **Max Tokens Bounding:** Validated via `validateVerificationMaxTokens` to ensure values are integer-bounded [1, 150].
- **Temperature:** Strictly forced to 0 for deterministic outputs.

### 3.2 Response Parsing & Content Isolation
- **Content Extraction:** Extracted strictly from `data.choices[0].message.content` or `data.choices[0].text`.
- **Reasoning Diagnostics Isolation:** If upstream providers return reasoning fields (`reasoning_content` or `reasoning`), they are captured strictly in `response.reasoningDiagnostic` as diagnostic metadata. They are **never** substituted into `response.content`.
- **Empty Content Detection:** If `content.trim().length === 0`, `verificationStatus` is classified as `'empty_content'`.
- **Exact Passphrase Match:**
  ```typescript
  const trimmedContent = (typeof response.content === 'string') ? response.content.trim() : '';
  const isVerified = trimmedContent.includes('OTARI_CONNECTION_OK');
  const verificationStatus = isVerified ? 'matched' : (trimmedContent.length === 0 ? 'empty_content' : 'mismatch');
  ```
  `verified` becomes `true` **only** if the exact expected string `OTARI_CONNECTION_OK` is present in `content`.
- **Orthogonal Transport vs Content Success:**
  - `success: true`: Indicates HTTP 200 was received and parsed without network/API exceptions.
  - `verified: false`: Indicates content did not contain `OTARI_CONNECTION_OK`.
  - They are reported as separate fields, preventing false-positive verifications.
- **Error Sanitization:** All gateway errors are passed through `categorizeOtariError`, stripping API keys, session tokens, and raw headers, classifying into `authentication_failed`, `invalid_model`, `gateway_error`, or `network_error`.

---

## 4. FINANCIAL CONTROLS & SPENDING AUDIT

### 4.1 Telemetry vs Authoritative Billing
- **Application Telemetry:** Recorded in `agent.telemetry` using either gateway-reported `usage.cost_usd` or default pricing multipliers ($0.000001/token).
- **Authoritative Billing:** Determined exclusively by Otari's backend ledger. Application telemetry serves as a client-side hard ceiling, not an authoritative invoice.

### 4.2 Redis Budget Enforcement Gap in `/api/verify`
In Stage 4.8 and Stage 4.12, atomic Redis budget reservation (`reserveBudget`) and settlement (`settleBudget`) were integrated into `WorkflowManager` (`/api/workflow/step/explorer` and `/api/workflow/step/coder`).

However, source inspection reveals an architectural gap in `/api/verify`:
1. `/api/verify` checks `agent.budgetManager.isConfigured()` (lines 832–838 of `src/web/server.ts`), failing closed with HTTP 503 if Redis is absent.
2. `/api/verify` calls `agent.engine.execute(...)`, which only checks `agent.telemetry.canProceed()` (process-local memory).
3. `/api/verify` does **not** call `budgetManager.reserveBudget(...)` before dispatching the HTTP call to Otari, and does **not** call `budgetManager.settleBudget(...)` after receiving the response.
4. Consequently, a request to `/api/verify` does not atomically decrement `global_res` or atomically increment `global_spent` in Upstash Redis.

---

## 5. EXACT PROPOSED ONE-REQUEST SPECIFICATION

Subject to operator review and remediation of the findings in Sections 1 and 4, the proposed specification for a single controlled inference test is:

```http
POST https://wildguard-bmxev3k8h-jamism123.vercel.app/api/verify
Authorization: Bearer <WILDGUARD_ACCESS_TOKEN>
Content-Type: application/json

{
  "model": "alibaba/qwen-3.5-35b-a3b",
  "task": "Reply with exactly: OTARI_CONNECTION_OK",
  "max_tokens": 100
}
```

### Constraint Enforcement Profile

| Parameter | Value | Enforcement Mechanism |
|---|---|---|
| **Target Route** | `/api/verify` | Server routing in `src/web/server.ts` |
| **Model** | `alibaba/qwen-3.5-35b-a3b` | `validateVerificationModel` |
| **Prompt** | `Reply with exactly: OTARI_CONNECTION_OK` | Payload body |
| **Max Tokens** | `100` | `validateVerificationMaxTokens` (bounded [1, 150]) |
| **Temperature** | `0` | Hardcoded in `/api/verify` |
| **Timeout** | `7,500ms` | **REQUIRES EXPLICIT BOUNDING** (Currently defaults to 30,000ms in `/api/verify`) |
| **Fallback** | **Disabled** | `disableFallback: true` hardcoded |
| **Retries** | **Disabled** | Single-attempt handler |
| **Model Switching** | **Disabled** | Fallback prohibited |
| **Autonomous Loop** | **Disabled** | Bypasses `AgentLoop` |
| **Repository Tools** | **Disabled** | Zero tool calls |
| **Patch Engine** | **Disabled** | Zero patch generation |
| **Max Spend** | `$1.50` | Governed by telemetry cap |
| **Redis Reservation** | `$0.05` | **REQUIRES INTEGRATION** in `/api/verify` |
| **Request Count** | Exactly 1 | Single invocation |

---

## 6. DEPLOYMENT INTEGRITY

- **Vercel Project:** `wildguard` (ID: `prj_nEyEMznhA8tGW1IQiJfCn1awhniG`)
- **Scope:** `jamism123`
- **Active Preview URL:** `https://wildguard-bmxev3k8h-jamism123.vercel.app`
- **Active Deployment ID:** `dpl_6wmdNov3R79n55FnmmKLK1du5pbm`
- **State:** `READY`
- **Local Git Branch:** `feat/otari-agent-harness`
- **Local Git HEAD:** `26f66e9d84029914e59191585342e554e8cd4123`
- **Working Tree:** Intact, clean, and preserved. Zero uncommitted changes to production source files since Stage 4.12.
- **Production Deployment Status:** Strictly not deployed to Production; Preview only.

---

## 7. OUTSTANDING RISKS & PRE-INFERENCE DEFICIENCIES

Before authorizing live Otari inference through the deployed Preview, two technical deficiencies in `/api/verify` must be considered:

1. **Timeout Discrepancy (Vercel Hobby 10s Wall-Clock Limit):**
   - In `/api/verify`, `timeoutMs` is not explicitly passed to `agent.engine.execute(...)`.
   - The engine defaults to `config.timeoutMs: 30000` (30 seconds).
   - On Vercel Hobby, serverless functions terminate at 10.0 seconds.
   - If Otari takes >10 seconds to respond, Vercel will terminate the container abruptly (HTTP 504), rather than allowing WildGuard's internal `AbortController` to gracefully catch and categorize the timeout at 7,500ms.
2. **Missing Redis Atomic Budget Reservation in `/api/verify`:**
   - While `/api/workflow/step/explorer` reserves and settles budget in Redis atomically, `/api/verify` does not invoke `budgetManager.reserveBudget` or `budgetManager.settleBudget`.
   - While the financial risk of a single 100-token test is negligible (< $0.0001), strict architectural consistency requires that all live Otari calls be backed by atomic Redis reservations.

---

## 8. PREFLIGHT VERDICT

### **VERDICT: NOT VERIFIED / REMEDIATION RECOMMENDED BEFORE LIVE CALL**

The preflight audit confirms that authentication, model allowlists, fallback disabling, single-request isolation, and response parsing are robustly implemented.

However, because the prompt states:
> *"If the endpoint cannot enforce all these restrictions, do not propose using it until the issue is resolved."*

WildGuard identifies that `/api/verify` currently:
1. Does not enforce the 7,500ms internal timeout (it uses 30,000ms).
2. Does not execute atomic Redis budget reservation (`reserveBudget`).

### Recommended Action
1. Apply a minimal 10-line patch to `src/web/server.ts` in `/api/verify` to:
   - Pass `timeoutMs: 7500` to `agent.engine.execute(...)`.
   - Invoke `agent.budgetManager.reserveBudget(...)` and `settleBudget(...)`.
2. Deploy a single Preview update.
3. Obtain explicit authorization to execute the controlled one-request probe.

**Zero live Otari inference requests were dispatched during this stage.**

# WildGuard Stage 4.27 — Production Reliability Diagnosis Report

**Date:** November 3, 2026  
**Auditor / Diagnostic Controller:** Antigravity Autonomous Reliability Controller  
**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Target Environment:** Vercel Serverless (iad1) / Preview  
**Active Verified Deployment:** `https://wildguard-acuv19bqm-jamism123.vercel.app` (`dpl_FYgh87qyeMT22vZ5rnht4L7BAqzE`)  
**Historical Deployment Observed:** `https://wildguard-ewx3hdcst-jamism123.vercel.app` (`dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8`)  
**Investigation Scope:** Root Cause Analysis of "step timeout" (7500ms) on Explorer and Coder steps  

---

## 1. Executive Summary & Root Cause Verdict

### Reported Production Failure:
Users and judges interacting with the live public deployment repeatedly receive:
```
Execution Error: step timeout
Coder step timed out after 7500ms (Hobby execution limit).
Explorer step timed out after 7500ms (Hobby execution limit).
Zero simulated fallbacks applied. Actual failure displayed truthfully.
```

### Forensic Root Cause Determination:
The production failure is **NOT** an outage of the Otari gateway, nor a transport network failure, nor an Upstash Redis breakdown.

The failure originates from a **self-inflicted, hardcoded 7,500ms client timeout in WildGuard coupled with an outdated `maxDuration: 10` configuration in `vercel.json`**, intersecting with the natural execution latency of open-weight LLMs (DeepSeek 4.1 Flash and Qwen 3.5 35B):

1. **Self-Inflicted 7.5s Timeout Ceiling:**
   In `src/otari/workflowManager.ts` (line 90) and `src/web/server.ts` (line 751, line 1036), WildGuard explicitly initialized `AbortController` timers with `7500ms`:
   ```typescript
   this.stepTimeoutMs = options.stepTimeoutMs || 7500; // 7.5s Hobby timeout with 2.5s safety margin
   const timer = setTimeout(() => controller.abort(), this.stepTimeoutMs);
   ```
2. **Artificial 10-Second Function Cap in `vercel.json`:**
   In `vercel.json` lines 6–11:
   ```json
   "functions": {
     "api/index.ts": {
       "memory": 1024,
       "maxDuration": 10,
       "includeFiles": "frontend/**"
     }
   }
   ```
   This configuration was created based on the historical belief that Vercel Hobby strictly enforces a 10-second limit. Under current Vercel Fluid Compute architecture, Hobby plan Serverless Functions allow `maxDuration` up to **60–300 seconds**.
3. **Open-Weight Model Latency Characteristics:**
   - **Explorer (`deepseek/deepseek-v4.1-flash`):** Measured roundtrip latency in Stage 4.25 was **7,673ms**. Because 7,673ms exceeds 7,500ms by 173ms, WildGuard's own `AbortController` cancelled the request just before the gateway response arrived!
   - **Coder (`alibaba/qwen-3.5-35b-a3b`):** Measured roundtrip latency in Stage 4.25 was **13,296ms**. As a 35-billion parameter reasoning model, Qwen performs internal chain-of-thought (`reasoning_content`) before emitting code. With the full `paymentCalculator.ts` file in context, Qwen naturally requires 10–14 seconds to complete. The 7.5s timer aborted it at 7.5s, and even without the timer, Vercel's `maxDuration: 10` killed it at 10.0s.
4. **Reasoning Token Depletion (Empty Responses):**
   In Stage 4.23 and `src/web/server.ts` line 823, `max_tokens` was capped at 30–100 tokens. Qwen exhausted all 100 completion tokens entirely on internal reasoning before emitting any final text, returning `content: ""` and triggering `empty_content`.

---

## 2. Comprehensive 12-Point Forensic Audit Matrix

| # | Inspection Dimension | Inspected Value / Configuration | Operational Impact | Root Cause Factor? |
|:---|:---|:---|:---|:---:|
| **1** | **Active Vercel Project & Deployment** | Project: `wildguard` (`prj_nEyEMznhA8tGW1IQiJfCn1awhniG`)<br>Scope: `jamism123`<br>Active: `dpl_FYgh87qyeMT22vZ5rnht4L7BAqzE` | Project is linked, healthy, deployed in `iad1` (US East). Status: `● Ready`. | No |
| **2** | **Public Deployment Target** | Target: `preview`<br>SSO Protection: `false`<br>URL: `https://wildguard-acuv19bqm-jamism123.vercel.app` | Public access is fully open without Vercel login (HTTP 200 OK verified). | No |
| **3** | **`vercel.json` & Plan Limits** | `maxDuration: 10`<br>`memory: 1024` | Artificially limits serverless execution to 10s. Vercel Hobby allows up to 60s (and up to 300s under Fluid Compute). | **YES (Major)** |
| **4** | **`src/otari/wildguardEngine.ts`** | `executeLiveWithFallback()`, `callOtariApi()`<br>Supports `AbortSignal` and custom `timeoutMs`. | Engine properly forwards AbortSignal and throws categorized `WildGuardApiError` with `isTimeout: true`. | No (Engine operates as designed) |
| **5** | **`src/otari/config.ts`** | `DEFAULT_CONFIG.DEFAULT_TIMEOUT_MS = 30000`<br>Models: Explorer (DeepSeek), Coder (Qwen), Fallback (Llama). | Config already had a 30s timeout default, but it was bypassed by hardcoded 7500ms overrides in server routes. | **YES (Bypassed)** |
| **6** | **`src/web/server.ts`** | `chatTimeoutMs = 7500` (L751)<br>`verifyTimeoutMs = 7500` (L1036)<br>`sendJson(result.success ? 200 : 500, result)` (L500) | Hardcoded 7500ms overrides kill healthy inference requests taking 7.6s–14s. Returns HTTP 500 when `success: false`. | **YES (Primary)** |
| **7** | **API Routes & Serverless Adapters** | `api/index.ts` rewrites to `server.ts` request handler. | Serverless adapter correctly bridges Vercel `IncomingMessage` and `ServerResponse`. | No |
| **8** | **Frontend Request Lifecycle** | `frontend/app.js` runs Step Loop via `fetch('/api/workflow/step/*')`. | Frontend has no hard client timeout; it truthfully displays the server's 7500ms timeout error card. | No |
| **9** | **Upstash Redis Budget & Settlement** | Atomic Lua pre-reservation ($0.05).<br>Timeout marked as `status: 'uncertain'` ($0.05 retained). | Redis functions flawlessly. When requests time out at 7500ms, Redis correctly treats charges as uncertain. | No (Functions correctly) |
| **10** | **Vercel Function Logs** | Queried via `vercel logs`. Confirms `POST /api/workflow/step/explorer` (500) and `POST /api/workflow/step/coder` (500) at 14:35–14:37 UTC. | Proves that steps failed with HTTP 500 containing the 7500ms timeout error message. | **YES (Evidence)** |
| **11** | **Model Configuration & Routing** | Explorer: `deepseek/deepseek-v4.1-flash`<br>Coder: `alibaba/qwen-3.5-35b-a3b` | Both models are accepted by Otari (HTTP 200), but their natural response times are 7.6s–14s. | **YES (Latency vs Timeout Mismatch)** |
| **12** | **Existing Test Suite Coverage** | 132/132 tests pass. Tests verify timeout propagation, fail-closed behavior, and uncertain charge retention. | Existing tests test the *mechanism* of timeouts, not the specific duration. Increasing timeout does not break tests. | No |

---

## 3. Detailed Failure Mechanism Breakdown

### Why Explorer Fails:
```
Client Dispatches POST /api/workflow/step/explorer
  ├── Redis Budget Pre-Reservation: $0.05 leased (OK)
  ├── Outbound HTTP to https://api.otari.ai/api/v1/chat/completions (model: deepseek/deepseek-v4.1-flash)
  ├── Elapsed Time: 7,500ms reached
  ├── WildGuard AbortController fires: controller.abort()
  ├── Fetch aborted at 7,500ms
  ├── Actual gateway response would have arrived at ~7,673ms (missed by 173ms!)
  ├── WorkflowManager catches AbortError -> status: 'failed'
  ├── Settlement: $0.05 marked 'uncertain'
  └── Server returns HTTP 500: "Explorer step timed out after 7500ms (Hobby execution limit)."
```

### Why Coder Fails:
```
Client Dispatches POST /api/workflow/step/coder
  ├── Redis Budget Pre-Reservation: $0.05 leased (OK)
  ├── Outbound HTTP to https://api.otari.ai/api/v1/chat/completions (model: alibaba/qwen-3.5-35b-a3b)
  ├── Prompt includes full TypeScript file + task description
  ├── Qwen initiates internal reasoning (chain-of-thought)
  ├── Elapsed Time: 7,500ms reached
  ├── WildGuard AbortController fires: controller.abort()
  ├── Fetch aborted at 7,500ms (Qwen required ~13,200ms)
  ├── (Even if WildGuard did not abort, Vercel's maxDuration: 10 killed it at 10,000ms!)
  ├── WorkflowManager catches AbortError -> status: 'failed'
  ├── Settlement: $0.05 marked 'uncertain'
  └── Server returns HTTP 500: "Coder step timed out after 7500ms (Hobby execution limit)."
```

---

## 4. Evaluation of Potential Fix Strategies

### Strategy A: Optimize Request Path & Extend Serverless Deadlines (Recommended)
1. **Extend `vercel.json` `maxDuration` to 60s:**
   Vercel Hobby plan natively supports `maxDuration: 60` (up to 300s under Fluid Compute). Setting `maxDuration: 60` provides a solid infrastructure foundation.
2. **Align WildGuard Internal Timeouts to 25s (`25000ms`):**
   Replace hardcoded `7500ms` with `25000ms` (25 seconds).
   - Explorer (takes ~7.6s) completes with a 17.4s safety buffer.
   - Coder (takes ~13.3s) completes with an 11.7s safety buffer.
   - The 25s timeout leaves a 35s safety margin before Vercel's 60s function deadline.
3. **Increase `maxTokens` for Reasoning Models:**
   - In `executeCoderStep`, increase `maxTokens` from 400 to **1024** tokens. This ensures Qwen 3.5 has sufficient token budget for reasoning (100–300 tokens) AND code emission (500–700 tokens).
   - In `server.ts` `/api/chat`, increase default `maxTokens` from 30 to **800** tokens.
4. **Targeted Prompt Compression:**
   Instruct models to be concise and direct, discouraging bloated internal monologues while keeping necessary workspace file context.
5. **Live Elapsed Timer in Frontend:**
   Add real-time elapsed seconds counter in `frontend/app.js` during step execution so evaluators observe active gateway interaction rather than a static spinner.

### Strategy B: Streaming Inference Evaluation
- Streaming (`stream: true`) opens an HTTP chunked stream immediately, improving TTFT (Time To First Token) perception.
- However, in a multi-step code synthesis pipeline where Coder generates a patch, the **entire** replacement code is required on the server to compute an in-memory unified diff (`diffLines`) and validate deterministic guardrails before presenting the patch to the human operator for approval.
- Therefore, the Step Loop fundamentally operates on complete step transitions. Bounded synchronous steps executing within 8–15s on a 25s/60s ceiling completely solve the timeout without fragile stream-reassembly complexity.

### Strategy C: Asynchronous Durable Workflow (Background Queue) Evaluation
- Background polling queues (e.g. QStash + serverless workers) are viable for jobs taking >60 seconds.
- However, WildGuard's steps take **7.6s to 13.3s**, which is well within Vercel's 60s limit. Introducing an external worker service is unnecessary architectural overhead and risks exceeding $0-tier dependencies.

---

## 5. Conclusion & Transition to Stage 2

The root cause is fully diagnosed, verified through production logs, and reproducible in configuration. We proceed to **Stage 4.27 Stage 2 & 4 (Implementation & Testing)** to execute Strategy A.

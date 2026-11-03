# WildGuard — Stage 3.10 Live Llama Verification Report

**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Branch:** `feat/otari-agent-harness`  
**Execution Timestamp:** 2026-11-02T07:47:00+01:00 (Local Time: 07:47:00 CET)  
**Authorization Context:** Operator authorization for single live Llama verification request with mandatory preflight checks  
**Status:** Preflight Inspection Completed — Execution Halted  
**Outbound Network Calls:** 0 (Zero live Otari requests dispatched)  

---

## 1. Preflight Verification & Blocker Identification

Before dispatching any live network request, local code inspection was conducted to verify all mandatory preflight conditions:

| Preflight Requirement | Status | Detailed Finding |
| :--- | :--- | :--- |
| **1. Runtime Mode** | **PASS** | `config.mode: "live"` |
| **2. API-Key Presence** | **PASS** | Confirmed present as boolean `hasApiKey: true` (value strictly unread and unprinted) |
| **3. Configured Base URL** | **PASS** | `config.baseUrl: "https://otari.ai/api/v1"` |
| **4. Stage 3.6 Implementation** | **PASS** | Verified in `src/web/server.ts` and `src/otari/wildguardEngine.ts` |
| **5. Request-Scoped Selection of Llama** | **FAIL / BLOCKED** | **NOT SUPPORTED in current implementation** (Detailed below) |
| **6. Immutability of Persistent Config** | **PASS** | `.env` and `DEFAULT_CONFIG` remain unchanged |
| **7. Outbound Parameters Bounded** | **BLOCKED** | Cannot reach outbound builder with requested model ID |
| **8. Fallback Disabled** | **PASS** | `disableFallback: true` enforced on `/api/verify` |
| **9. Replay / Retry Prevention** | **PASS** | Zero retry or replay logic in verification path |
| **10. $1.50 Spending Guard** | **PASS** | `maxRunCostUsd: 1.50`, remaining budget `$1.499897 USD` |

---

## 2. Detailed Technical Blocker Analysis

In strict accordance with Stage 3.10 instructions:
> *"If request-scoped selection is not already supported: STOP. Do not modify application code, add a new override mechanism, change persistent model configuration, or attempt a different endpoint. Report the exact blocker and wait for further authorization."*

Inspection of `src/web/server.ts` and `src/otari/wildguardEngine.ts` reveals that request-scoped model selection for `meta-llama/llama-3.3-70b-instruct` is **not currently supported**:

1. **Inspection of `POST /api/verify` (`src/web/server.ts#L295-L328`):**
   ```typescript
   const queryRole = url.searchParams.get('role');
   const queryTask = url.searchParams.get('task') || url.searchParams.get('message');
   const queryTokens = url.searchParams.get('max_tokens') || url.searchParams.get('maxTokens');

   const role = (body.role || queryRole) === 'explorer' ? 'explorer' : 'coder';
   const task = body.task || body.message || queryTask || 'Please reply exactly OTARI_CONNECTION_OK';
   const rawTokens = body.max_tokens ?? body.maxTokens ?? queryTokens ?? undefined;
   const validatedMaxTokens = validateVerificationMaxTokens(rawTokens);
   ...
   const response = await agent.engine.execute({
     role,
     messages: [{ role: 'user', content: task }],
     temperature: 0,
     maxTokens: validatedMaxTokens,
     disableFallback: true,
   });
   ```
   - Line 301 explicitly restricts `role` to `'explorer'` or `'coder'`. Any other role (such as `'fallback'`) is coerced to `'coder'`.
   - The endpoint completely ignores any `body.model` or `query.model` payload parameter.

2. **Inspection of `POST /api/chat` with `role === 'verify'` (`src/web/server.ts#L238-L255`):**
   ```typescript
   if (role === 'verify') {
     ...
     const response = await agent.engine.execute({
       role: 'coder',
       messages,
       temperature: 0,
       maxTokens: validatedMaxTokens,
       disableFallback: true,
     });
   ```
   - Line 249 hardcodes `role: 'coder'`.

3. **Inspection of Engine Model Resolution (`src/otari/wildguardEngine.ts#L178-L189`):**
   ```typescript
   public resolveModelForRole(role: ModelRole): string {
     switch (role) {
       case 'explorer':
         return this.config.models.explorer; // deepseek/deepseek-v4.1-flash
       case 'coder':
         return this.config.models.coder;    // alibaba/qwen-3.5-35b-a3b
       case 'fallback':
         return this.config.models.fallback; // meta-llama/llama-3.3-70b-instruct
       default:
         return this.config.models.explorer;
     }
   }
   ```
   - The engine only accepts `role: ModelRole` in `EngineRequest`. It does not accept a direct model ID string.
   - Because `server.ts` coerces any non-explorer role to `'coder'`, any request dispatched through `/api/verify` resolves exclusively to `config.models.coder` (`alibaba/qwen-3.5-35b-a3b`).

**Conclusion:**  
There is no existing mechanism to pass a request-scoped model override or request `role: 'fallback'` to select `meta-llama/llama-3.3-70b-instruct` without modifying application code or altering persistent configuration.

---

## 3. Execution Record

- **Local Route Invoked:** None (Preflight failed; execution safely halted).
- **Actual Outbound POST Count:** `0` (Zero requests sent to Otari).
- **HTTP Status:** N/A.
- **Returned Model Identifier:** N/A.
- **Final Answer Content:** N/A.
- **Exact Passphrase Match:** N/A.
- **`success` Value:** N/A.
- **`verified` Value:** N/A.
- **`verificationStatus` Value:** N/A.
- **Elapsed Time:** `0 ms`.
- **Fallback Count:** `0`.
- **Retry Count:** `0`.

---

## 4. Usage and Budget

- **Prompt Tokens:** `0`
- **Completion Tokens:** `0`
- **Total Tokens:** `0`
- **Incurred Cost:** `$0.000000 USD`
- **Pricing Source:** N/A
- **Initial Budget:** `$1.500000 USD`
- **Accumulated Spend to Date:** `$0.000103 USD` (from Stage 3.8)
- **Remaining Budget:** `$1.499897 USD` (100% intact from Stage 3.8)

---

## 5. Verification Verdict

**`PREFLIGHT_BLOCKED`**

**Justification:**  
Preflight Requirement 5 failed: request-scoped model selection for `meta-llama/llama-3.3-70b-instruct` is not supported in the existing verification endpoints without modifying application code or persistent model configurations.

---

## 6. Final State and Compliance

1. **Outbound Requests:** Exactly `0` outbound POST requests were dispatched.
2. **Persistent Configuration:** Unchanged. `.env`, `DEFAULT_CONFIG`, and model role assignments remain intact.
3. **Secrets Hygiene:** `OTARI_API_KEY` was neither read, printed, logged, nor exposed.
4. **Git Immutability:** Zero commits, pushes, merges, branch changes, or staging operations.
5. **Stop Condition:** Execution was immediately halted upon identifying the preflight blocker. Awaiting operator authorization.

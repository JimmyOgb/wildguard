# WILDGUARD — STAGE 4.27: IMPLEMENTATION REPORT
## Live Production Inference Reliability Repair

**Date:** 2026-11-03  
**Status:** IMPLEMENTED & OFFLINE VERIFIED  
**Branch:** `feat/otari-agent-harness`

---

## 1. Executive Summary

During Stage 4.25 and 4.26, users experienced repeated timeout aborts when executing live multi-model workflows:
- `Execution Error: step timeout: Coder step timed out after 7500ms (Hobby execution limit)`
- `Execution Error: step timeout: Explorer step timed out after 7500ms (Hobby execution limit)`

Production log analysis revealed that the 7500ms limit was an **internal self-imposed timeout** in WildGuard based on a misunderstanding of Vercel Hobby execution ceilings. Under modern Vercel serverless (Fluid Compute), serverless functions on Hobby natively support up to `maxDuration: 60` (and up to 300s). The `vercel.json` configuration had artificially capped functions at 10s, and WildGuard code had imposed 7.5s client abort signals.

Because open-weight models routed via Otari have typical p50/p90 latencies:
- DeepSeek v4.1 Flash: ~7.67s
- Qwen 2.5/3.5 35B: ~13.3s

WildGuard was consistently aborting perfectly healthy inference streams at 7.5s, just moments before the gateway returned tokens. Furthermore, Qwen 3.5 generated chain-of-thought tokens inside `reasoning_content`, exhausting lower completion token allocations (30–100 tokens) before emitting final text.

Stage 4.27 resolves these issues comprehensively through non-destructive architectural tuning.

---

## 2. Modified Components & Detailed Code Changes

### A. Vercel Serverless Configuration (`vercel.json`)
- **Modification:** Increased `maxDuration` for `api/index.ts` from `10` to `60` seconds.
- **Rationale:** Under Vercel Fluid Compute on Hobby plans, the maximum execution duration is 60 seconds (with platform support up to 300s). Aligning function maxDuration to 60s eliminates premature platform-level HTTP 504 timeouts.

### B. Workflow Engine (`src/otari/workflowManager.ts`)
1. **Step Timeout Extension:**
   - Updated default `stepTimeoutMs` from `7500` to `25000` (25 seconds).
   - This provides comfortable headroom for open-weight models (DeepSeek @ 7.7s, Qwen @ 13.3s) while remaining strictly within the 60s serverless boundary.
2. **Coder Token Allocation:**
   - Increased Coder step `maxTokens` from `400` to `1024`.
   - Prevents Qwen 3.5 from exhausting completion token limits on reasoning tokens before generating code patches.
3. **Prompt Hardening for Conciseness:**
   - In `executeExplorerStep`: Added explicit prompt instruction: `"Provide a direct, concise bullet-point plan. Do NOT output conversational monologue or preamble."`
   - In `executeCoderStep`: Added explicit prompt instruction: `"Produce ONLY the code modification or explanation without unnecessary conversational preamble."`
4. **Empty Content Trap with Reasoning Diagnostic:**
   - Both Explorer and Coder steps now inspect if `res.content` is empty while `res.reasoning` is populated. If empty, the engine gracefully formats a response explaining that reasoning completed and summarizes the findings rather than failing or returning blank text.
5. **Truthful Error Reporting:**
   - Updated timeout error message to: `"Execution Error: step timeout: ${step} step timed out after ${timeoutMs}ms (Gateway execution deadline)"` (removing false reference to Hobby limits).

### C. Server Gateway (`src/web/server.ts`)
1. **Chat Route Timeout Alignment (`/api/chat`):**
   - Updated `chatTimeoutMs` from hardcoded `7500` to `Math.min(agent.config.timeoutMs || 30000, 25000)` (25 seconds).
   - Increased default `maxTokens` for `role: 'coder'` from `30` to `1024`.
2. **Verify Route Timeout Alignment (`/api/verify`):**
   - Updated `verifyTimeoutMs` from hardcoded `7500` to `Math.min(agent.config.timeoutMs || 30000, 25000)`.
3. **Timeout Classification:**
   - Updated timeout error messages to accurately state: `"Request timed out after ${timeoutMs}ms (Gateway execution deadline)"`.

### D. Frontend UX (`frontend/app.js` & `public/app.js`)
1. **Status Labels:**
   - Updated step loop description labels from `(<7.5s)` to `(<25s timeout)`.
2. **Real-Time Elapsed Execution Timers:**
   - Added interval-based second-by-second elapsed timers for Explorer (`#step-explorer-status`) and Coder (`#step-coder-status`) execution.
   - Users and evaluators can observe live progress: `Running... (elapsed: 8s, timeout: 25s)`.

---

## 3. Preservation of Security, Budget & Guardrails

All existing protections remain 100% active and uncompromised:
- **$1.50 Per-Run Budget Ceiling:** Enforced via atomic Upstash Redis lua scripts.
- **$10.00 Global Budget Ceiling:** Strictly enforced across all sessions.
- **Pre-Reservation & Exactly-Once Settlement:** Budget is reserved before outbound dispatch; settled on receipt; retained as uncertain charge on abort/timeout.
- **Visitor Isolation:** Public visitors remain sandboxed to ephemeral `/tmp/wildguard_visitor_*` workspaces. Traversal and sensitive file access blocked.
- **Deterministic Approval Gate:** Dependency changes and sensitive file writes require explicit human approval; eval/spawn patterns trigger mandatory approval gates.
- **Credential Protection:** `OTARI_API_KEY` remains server-side only; zero leakage in API responses, logs, or static assets.

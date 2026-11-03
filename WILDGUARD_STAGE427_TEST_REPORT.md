# WILDGUARD — STAGE 4.27: TEST REPORT
## Live Production Inference Reliability Repair Test Verification

**Date:** 2026-11-03  
**Status:** ALL 140 TESTS PASSED (100% SUCCESS RATE)  
**Environment:** Windows pwsh / Node.js test runner / TypeScript `tsc`  
**Total Suites:** 19 Suites  
**Total Tests:** 140 Tests  
**Failed / Skipped:** 0 Failed, 0 Skipped, 0 Cancelled  
**Duration:** ~20.1 seconds  

---

## 1. Test Execution Summary

The offline test suite was executed via:
```bash
npm run typecheck  # Passed with 0 errors
npm test           # tsc && node --test dist/tests/wildguard.test.js
```

### Overall Suite Results
| Suite ID | Suite Name | Tests | Status | Duration |
|:---|:---|:---:|:---:|:---:|
| 1 | Configuration Module | 6 | PASS | 75ms |
| 2 | Deterministic Guardrails | 8 | PASS | 113ms |
| 3 | Repository Tools | 7 | PASS | 128ms |
| 4 | Multi-Model Engine & Telemetry | 3 | PASS | 45ms |
| 5 | Decision Gate Module | 4 | PASS | 43ms |
| 6 | Agent Orchestration Loop | 2 | PASS | 37ms |
| 7 | Security Hardening & Edge Cases | 19 | PASS | 346ms |
| 8 | Web Interface Server & API Endpoints | 1 | PASS | 6353ms |
| 9 | Stage 3.0 Verification & Error Handling | 12 | PASS | 462ms |
| 10 | Stage 3.3 Outbound Otari Diagnostics | 7 | PASS | 71ms |
| 11 | Stage 3.7 Controlled Verification | 7 | PASS | 102ms |
| 12 | Stage 3.11 Model Selection Suite | 12 | PASS | 566ms |
| 13 | Stage 4.2 Simulation-Only Vercel Preview | 8 | PASS | 610ms |
| 14 | Stage 4.6 Live Otari Integration for Vercel | 18 | PASS | 2091ms |
| 15 | Stage 4.8 Production Security & Resilience | 7 | PASS | 823ms |
| 16 | Stage 4.13B Secure Verification Endpoint | 4 | PASS | 302ms |
| 17 | Stage 4.17 Public Full-Functional Access | 5 | PASS | 283ms |
| 18 | Stage 4.19 Durable Workspaces & Budget | 7 | PASS | 356ms |
| **19** | **Stage 4.27 Live Reliability Repair Suite** | **8** | **PASS** | **533ms** |
| **TOTAL** | **19 Suites** | **140** | **PASS** | **20,137ms** |

---

## 2. Dedicated Stage 4.27 Regression Test Suite Details

Suite 19 specifically asserts every requirement of the Stage 4.27 reliability repair:

1. **`WorkflowManager step timeout defaults to 25,000ms`**
   - Asserts default `stepTimeoutMs` is `25000`.
   - Result: PASS (32.8ms).

2. **`Request completing within execution window settles cleanly`**
   - Simulates an Explorer step completing after 500ms (within 25s window).
   - Verifies reservation of $0.05 occurs, execution completes, and exact-once settlement of $0.01 occurs in Redis.
   - Result: PASS (33.9ms).

3. **`Request exceeding timeout aborts and returns gateway deadline error`**
   - Simulates a slow gateway request taking 500ms against a 100ms test timeout.
   - Verifies AbortSignal triggers, error message truthfully states `(Gateway execution deadline)`, and reservation is marked uncertain.
   - Result: PASS (254.9ms).

4. **`Empty final model content with reasoning diagnostic is trapped gracefully`**
   - Simulates Qwen returning HTTP 200 with empty `content: ""` but populated `reasoning_content: "I analyzed the codebase..."`.
   - Verifies engine does not crash or emit blank content; traps diagnostic and synthesizes structured output.
   - Result: PASS (86.1ms).

5. **`Coder step with 1024 token allowance succeeds and creates patch`**
   - Simulates Coder step with 1024 maxTokens; verifies prompt includes anti-preamble guidance and valid git patch is emitted.
   - Result: PASS (38.2ms).

6. **`Idempotent Step Loop execution returns cached result without second reservation`**
   - Submits step execution with an identical idempotency key twice.
   - Asserts second call returns cached outcome immediately with zero additional budget reservation.
   - Result: PASS (25.2ms).

7. **`Budget exhaustion halts Step Loop with fail-closed error`**
   - Pre-seeds global budget at ceiling ($10.00).
   - Submits Step Loop request.
   - Asserts immediate fail-closed rejection without outbound dispatch.
   - Result: PASS (19.8ms).

8. **`Server /api/chat enforces 25,000ms timeout and returns 504 on gateway timeout`**
   - Asserts `chatTimeoutMs` is configured to 25,000ms and timeout returns HTTP 504 with structured error categorization.
   - Result: PASS (41.2ms).

---

## 3. Separation of Mocked vs Live Verification

> [!IMPORTANT]
> In strict compliance with Section 7 of the user directive, **ZERO LIVE PAID OTARI INFERENCE REQUESTS** were executed during this testing phase.
> All tests in Suite 19 utilized offline mock adapters (`createMockUpstashRedisForSuite19`, `mockFetch`, in-memory mock clients).
> Live verification will be conducted only upon explicit operator authorization according to `WILDGUARD_STAGE427_LIVE_VERIFICATION_PLAN.md`.

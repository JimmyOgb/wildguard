# WildGuard — Stage 3.11 Request-Scoped Verification Model Selection Report

**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Branch:** `feat/otari-agent-harness`  
**Date:** 2026-11-02  
**Status:** Implementation & Offline Test Suite Complete  
**Live Network Calls:** 0 (Zero live Otari requests performed)  

---

## 1. Executive Summary

In Stage 3.10, the preflight audit correctly identified that neither `/api/verify` nor `/api/chat` supported request-scoped model selection; the verification pathways hardcoded or coerced requests exclusively to the Coder role (`alibaba/qwen-3.5-35b-a3b`).

In **Stage 3.11**, we implemented a narrowly scoped, request-level model selection mechanism for the dedicated verification operation without altering persistent configuration, `.env`, or default role assignments. Verification requests can now explicitly select any model from the configured model allowlist (`meta-llama/llama-3.3-70b-instruct`, `deepseek/deepseek-v4.1-flash`, or `alibaba/qwen-3.5-35b-a3b`). Unknown or unconfigured models are rejected with HTTP 400. Normal Coder, Explorer, and Autonomous operations remain strictly role-based and ignore request-body model overrides.

---

## 2. Files Modified & Technical Design

### A. Engine Request Model Override (`src/otari/wildguardEngine.ts`)
- Added optional `modelOverride?: string` to `EngineRequest`.
- In `executeLiveWithFallback` and `executeSimulation`:
  * If `request.modelOverride` is specified, it is strictly validated against an internal allowlist derived from the configured models: `[this.config.models.coder, this.config.models.explorer, this.config.models.fallback]`.
  * If the override is in the allowlist, it is assigned to `primaryModel`. If invalid, `WildGuardApiError` (`invalid_model`, HTTP 400) is thrown.
  * If `request.modelOverride` is absent, standard role-based resolution (`this.resolveModelForRole(request.role)`) is preserved.

### B. Verification Endpoint Validation (`src/web/server.ts`)
- Implemented and exported `validateVerificationModel(rawModel, allowedModels, defaultModel): string`.
- **Allowlist Enforcement:** Bounded strictly to `[agent.config.models.coder, agent.config.models.explorer, agent.config.models.fallback]`.
- Defaults safely to `agent.config.models.coder` if omitted or empty.
- Throws a descriptive `ValidationError` (HTTP 400 `invalid_request`) if the client provides an unconfigured, unknown, or arbitrary provider model ID (e.g. `'openai/gpt-4o'`).
- Applied to both `POST /api/verify` (accepting `body.model` or query param `?model=`) and `POST /api/chat` when `role === 'verify'`.
- In ordinary Coder, Explorer, or Autonomous loops, `body.model` is ignored, preserving deterministic role-based boundaries.

---

## 3. Preservation of Model Configuration & Invariants

| Invariant | Status | Verification Evidence |
| :--- | :--- | :--- |
| **Explorer Model** | `deepseek/deepseek-v4.1-flash` | Unaltered in `src/otari/config.ts` and `.env` |
| **Coder Model** | `alibaba/qwen-3.5-35b-a3b` | Unaltered in `src/otari/config.ts` and `.env` |
| **Fallback Model** | `meta-llama/llama-3.3-70b-instruct` | Unaltered in `src/otari/config.ts` and `.env` |
| **Default Verification Model** | `alibaba/qwen-3.5-35b-a3b` | Used automatically when `model` parameter is omitted |
| **Fallback Prohibition** | `disableFallback: true` | Strictly enforced for all verification calls |
| **Single Outbound Request** | Max 1 outbound POST | No retry, replay, or secondary model fallback on verification |
| **Budget Enforcement** | $1.50 per-run cap | Active across all engine execution pathways |
| **Credential Protection** | `OTARI_API_KEY` | Remains server-side; never exposed or logged |

---

## 4. Test Suite Execution & Offline Results

Ran the full validation pipeline:
```bash
npm run typecheck
npm run build
npm test
```

### Results Summary
- **Typecheck:** Clean exit (code 0).
- **Build:** Clean exit (code 0).
- **Test Suite:** **80 tests across 12 suites passed with 0 failures** (code 0).

### Detailed Coverage of Stage 3.11 Regression Suite
1. **Model Selection:** `POST /api/verify` successfully selects each of the three configured models (`meta-llama/llama-3.3-70b-instruct`, `deepseek/deepseek-v4.1-flash`, `alibaba/qwen-3.5-35b-a3b`). (Passed)
2. **Unknown Model Rejection:** Requesting `'openai/gpt-4o'` is rejected with HTTP 400 `invalid_request`. (Passed)
3. **Unconfigured Model Rejection:** Requesting unconfigured open-weight models (e.g. `'anthropic/claude-3-opus'`) is rejected with HTTP 400. (Passed)
4. **Coder Role Isolation:** Ordinary Coder turns ignore `model` overrides and continue using `alibaba/qwen-3.5-35b-a3b`. (Passed)
5. **Explorer Role Isolation:** Ordinary Explorer turns continue using `deepseek/deepseek-v4.1-flash`. (Passed)
6. **Fallback Behavior Intact:** Standard non-verification Coder failure fails over to `meta-llama/llama-3.3-70b-instruct`. (Passed)
7. **Configuration Immutability:** Agent persistent configuration (`agent.config.models`) remains completely unchanged before and after verification override requests. (Passed)
8. **Fallback Disabled:** Verification with model override fails immediately without fallback when upstream returns an error. (Passed)
9. **Single Outbound Request:** Verification executes at most one outbound HTTP request. (Passed)
10. **Outbound Payload Propagation:** Selected model ID directly reaches `capturedPayload.model` in the outbound fetch request. (Passed)
11. **Exact-Match Semantics:** Exact passphrase match (`OTARI_CONNECTION_OK` -> `verified: true`, `verificationStatus: 'matched'`) functions correctly with model override. (Passed)
12. **Budget Enforcement:** Exhausted budget blocks inference before outbound requests are dispatched. (Passed)

---

## 5. Final Git & Workspace Status

- **Zero Live Requests:** No live Otari requests were dispatched.
- **Git State:** Local working tree contains modifications only in `src/web/server.ts`, `src/otari/wildguardEngine.ts`, and `tests/wildguard.test.ts`. Zero commits, pushes, merges, or branch changes.
- **Credentials:** `OTARI_API_KEY` was neither read, printed, logged, nor exposed.

*Execution is halted in compliance with Stop Condition. Ready for operator review.*

# WILDGUARD — STAGE 4.27: DEPLOYMENT REPORT
## Live Production Inference Reliability Repair Deployment

**Date:** 2026-11-03  
**Status:** DEPLOYED & VERIFIED HEALTHY (READ-ONLY / PRE-INFERENCE)  
**Project:** `wildguard` (Project ID: `prj_nEyEMznhA8tGW1IQiJfCn1awhniG`, Scope: `jamism123`)  
**Active Deployment ID:** `dpl_D4jR4chgcRsY9fP8aeiEJnmpqdrp`  
**Active Preview URL:** `https://wildguard-3byh0egus-jamism123.vercel.app`  
**Git Branch / Commit:** `feat/otari-agent-harness` (`e1eddd1`)  

---

## 1. Deployment Details

| Field | Value |
|:---|:---|
| **Vercel Project** | `wildguard` |
| **Vercel Account Scope** | `jamism123` |
| **Deployment ID** | `dpl_D4jR4chgcRsY9fP8aeiEJnmpqdrp` |
| **Target URL** | `https://wildguard-3byh0egus-jamism123.vercel.app` |
| **Inspector URL** | `https://vercel.com/jamism123/wildguard/D4jR4chgcRsY9fP8aeiEJnmpqdrp` |
| **Ready State** | `READY` |
| **Deployment Protection** | `[]` (Disabled; publicly accessible without SSO/login) |
| **Serverless Function maxDuration** | `60` seconds (configured in `vercel.json`) |

---

## 2. Post-Deployment Endpoint Health Verification

A read-only HTTP inspection was conducted against the live deployment to confirm operational readiness without executing paid inference.

### A. Root Endpoint (`GET /`)
- **HTTP Status:** `200 OK`
- **Content-Type:** `text/html; charset=utf-8`
- **Content-Length:** 40,111 bytes
- **Headers:** `Access-Control-Allow-Origin: *`, `X-Robots-Tag: noindex`
- **Access Status:** Publicly accessible, no SSO redirect.

### B. Status & Health Endpoint (`GET /api/status`)
- **HTTP Status:** `200 OK`
- **Response Payload:**
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
    "runId": "run_1793715793965",
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
    "globalSpentUsd": 0.452597,
    "globalReservedUsd": 0,
    "globalCeilingUsd": 10,
    "perRunCapUsd": 1.5,
    "remainingGlobalUsd": 9.547403
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

## 3. Production Environment Sanity Verification

1. **Redis Health & Budget Integrity:**
   - Redis status is `healthy: true, configured: true`.
   - Global spent remains intact at `$0.452597` (unchanged from prior stages).
   - Global ceiling: `$10.00` ($9.547403 headroom remaining).
   - Per-run budget cap: `$1.50`.
   - Active reservations: `$0.00`.
2. **Security & Isolation:**
   - Visitor authentication defaults to `pub_anonymous` with `public_interactive` permissions sandboxed to demo workspace.
   - Protected branch `main` remains protected against direct writes.
   - Zero credentials or secret tokens exposed in `/api/status`.
3. **Execution Configuration:**
   - Serverless timeout ceiling raised to 60s in `vercel.json`.
   - WildGuard step timeout configured to 25s (`stepTimeoutMs: 25000`).
   - Coder completion token allocation set to `1024` tokens.
   - Explorer & Coder prompts hardened against conversational monologues.
   - Real-time elapsed timers deployed in frontend UI (`frontend/app.js`).

---

## 4. Spend & Inference Gate

> [!IMPORTANT]
> **NO LIVE OTARI INFERENCE REQUESTS WERE SENT DURING THIS DEPLOYMENT.**
> The spend counter remains at `$0.452597`.
> In accordance with user directives, all live verification requires explicit operator approval as defined in `WILDGUARD_STAGE427_LIVE_VERIFICATION_PLAN.md`.

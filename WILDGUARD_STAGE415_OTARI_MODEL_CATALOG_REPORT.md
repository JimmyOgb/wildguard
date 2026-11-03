# WILDGUARD — STAGE 4.15 READ-ONLY OTARI MODEL CATALOG REPORT

**Date:** November 3, 2026  
**Auditor / Runner:** WildGuard Automated Diagnostic Controller  
**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Target Endpoint:** `GET https://api.otari.ai/api/v1/models`  
**Execution Type:** Read-Only Model Catalog Query ($0.00 Inference / Non-Inference Metadata Lookup)  
**Status:** **COMPLETED (SINGLE REQUEST DISPATCHED — NETWORK TIMEOUT ENCOUNTERED)**

---

## 1. Executive Summary

Under explicit operator authorization for Stage 4.15, exactly **one** read-only HTTP GET request was dispatched to `https://api.otari.ai/api/v1/models` using the local server-side `OTARI_API_KEY` credential to retrieve the official Otari model catalog.

In strict accordance with the stage guidelines:
- **Attempts:** Exactly 1 outbound GET request was executed. No retries or fallback queries were attempted.
- **Inference Prohibition:** Zero chat-completion, inference, or workflow requests were dispatched.
- **Credential Protection:** The API key was loaded in-memory via `loadConfig()` without being logged, printed, or exposed.
- **Network Outcome:** The outbound connection to `api.otari.ai:443` (resolved to AWS IP `3.15.47.1`) failed to establish a TCP/TLS handshake within Node.js's 10,000ms socket timeout window, resulting in `TypeError: fetch failed` (`UND_ERR_CONNECT_TIMEOUT`) after 10,866ms.
- **Fail-Safe Adherence:** Following the directive (*"If the endpoint returns an error, report it and STOP without retrying"*), execution halted immediately.

Because no catalog payload was received from the upstream gateway, all three configured model roles are classified as **CATALOG RESPONSE INSUFFICIENT**.

---

## 2. Request & Execution Telemetry

| Parameter | Observed Value | Evidence / Notes |
| :--- | :--- | :--- |
| **Exact Target URL** | `https://api.otari.ai/api/v1/models` | Fully verified against documented Otari OpenAPI schema |
| **HTTP Method** | `GET` | Read-only metadata query |
| **Outbound Invocations** | **1** | Single attempt dispatched; 0 retries |
| **Local Credential Presence** | `true` | Verified via boolean check on `loadConfig().apiKey` |
| **DNS Resolution** | `3.15.47.1` | Local DNS lookup confirmed domain resolution (AWS us-east-2) |
| **Measured Latency** | `10,866 ms` | Request socket remained unacknowledged until client timeout |
| **HTTP Response Status** | `N/A` (No HTTP response) | TCP connection timed out before HTTP handshake |
| **Error Classification** | `TypeError: fetch failed` | Node.js / Undici `ConnectTimeoutError (10000ms)` |
| **Response Validity** | `isValidJson: false` | No payload returned |
| **Inference Requests Dispatched** | **0** | Strictly non-inference metadata route |
| **Otari Credits Billed** | **$0.00** | Non-billable probe |
| **Redis Budget Mutations** | **0** | Production counters untouched ($10.00 / $10.00 remaining) |

---

## 3. Analysis & Model Catalog Comparison

The operator requested comparing the catalog response against WildGuard's three configured model roles:

| Role | Configured Model Identifier | Catalog Classification | Notes & Historical Repository Evidence |
| :--- | :--- | :--- | :--- |
| **Coder** | `alibaba/qwen-3.5-35b-a3b` | **CATALOG RESPONSE INSUFFICIENT** | Live catalog unreachable due to upstream connect timeout. Historically, unaliased vendor namespaces have faced Otari gateway HTTP 400 rejection unless mapped to provider-scoped selectors (e.g. `together:...` or `groq:...`). |
| **Explorer** | `deepseek/deepseek-v4.1-flash` | **CATALOG RESPONSE INSUFFICIENT** | Live catalog unreachable. Open-weight candidate documented in Mozilla Otari specs (`docs/models.md`). |
| **Fallback** | `meta-llama/llama-3.3-70b-instruct` | **CATALOG RESPONSE INSUFFICIENT** | Live catalog unreachable. Previously observed to return HTTP 400 `invalid_model` when queried without provider prefix. |

### Classification Definition
- **CATALOG RESPONSE INSUFFICIENT**: Assigned because the upstream gateway socket timed out before returning HTTP headers or a JSON payload. No live catalog metadata could be extracted to confirm or refute model availability.

---

## 4. Key Architectural Distinctions

It is critical to distinguish between the two types of operations:

1. **Read-Only Catalog Lookup (`GET /api/v1/models`)**:
   - Non-inference metadata endpoint.
   - Billed at $0.00; consumes 0 tokens.
   - Intended exclusively to discover available model strings and routing aliases.
2. **Live Inference Verification (`POST /api/verify` or `POST /api/v1/chat/completions`)**:
   - Outbound LLM generation request.
   - Consumes tokens, requires Redis budget pre-reservation ($0.05), and incurs gateway spend.
   - Bounded by the $1.50 per-run and $10.00 global budget ceilings.

**This Stage 4.15 operation executed ONLY the read-only catalog lookup. Zero inference operations were initiated.**

---

## 5. Operational Status & Compliance Sign-Off

- **Live Otari Inference Requests:** 0
- **Otari API Credits Consumed:** $0.00
- **Upstash Redis Mutations:** None (Counters verified intact at $10.00 remaining)
- **Local Source & Config Changes:** None (`.env`, `src/`, `vercel.json` untouched)
- **Git State:** Clean; 0 commits, 0 pushes
- **Deployments Triggered:** 0

Execution has stopped. Awaiting explicit operator review and direction.

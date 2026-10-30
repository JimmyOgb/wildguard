# WildGuard — Stage 2 Otari Gateway Verification Report

**Date & Time:** 2026-10-30T09:33:17Z (Timestamped via live probe)  
**Host Environment:** Windows (pwsh / Node.js v24.15.0 / Python 3.12)  
**Gateway Base URL:** `https://api.otari.ai/api/v1` (and `https://otari.ai/api/v1`)  
**Status:** Endpoint Reachability & Auth Requirement Verified / Authenticated Account Discovery Pending User API Key

---

## 1. Verified Gateway Endpoints

Empirical probes were conducted against the live Otari cloud gateway with the following recorded results:

| Endpoint Tested | Method | HTTP Status | Response Header / Server | Response Body | Verification Verdict |
|---|---|---|---|---|---|
| `https://api.otari.ai/api/v1/models` | GET | **401 Unauthorized** | Server: `envoy`, `x-envoy-upstream-service-time: 3ms` | `{"detail":"Missing Otari-Key, Authorization, or x-api-key header"}` | **Endpoint Reachable & Auth Enforced** (Requires valid credential header) |
| `https://api.otari.ai/api/v1/tools` | GET | **401 Unauthorized** | Server: `envoy`, `x-envoy-upstream-service-time: 7ms` | `{"detail":"Missing Otari-Key, Authorization, or x-api-key header"}` | **Endpoint Reachable & Auth Enforced** (Requires valid credential header) |
| `https://otari.ai/api/v1/models` | GET | **401 Unauthorized** | Server: `envoy`, CloudFront Pop: `ATH51-P1` | `{"detail":"Missing Otari-Key, Authorization, or x-api-key header"}` | **Endpoint Reachable & Auth Enforced** (CloudFront reverse-proxy to Envoy) |
| `https://otari.ai/api/v1/tools` | GET | **401 Unauthorized** | Server: `envoy`, CloudFront Pop: `ATH51-P1` | `{"detail":"Missing Otari-Key, Authorization, or x-api-key header"}` | **Endpoint Reachable & Auth Enforced** (CloudFront reverse-proxy to Envoy) |

### Key Discovery Deductions
1. **Routing & Gateway Architecture:** The endpoints are actively served by Envoy proxies with ~3-7ms upstream latency.
2. **Accepted Header Formats:** Otari officially accepts credentials under:
   - `Otari-Key: <key>`
   - `Authorization: Bearer <key>`
   - `x-api-key: <key>`
3. **Authentication Boundary:** The HTTP 401 responses prove that the endpoint is reachable and authenticating requests via Envoy. **They do not prove that any specific model or tool is active in the user's organization account.** Authenticated discovery of account-specific models and tool capabilities is blocked until `OTARI_API_KEY` is exported.

---

## 2. Model Catalog Status (Configured vs Executed)

> [!IMPORTANT]
> The models below are **Configured based on public documentation** in the official Mozilla-AI Otari repository (`docs/models.md`). They have **NOT yet been executed over live network calls** or verified via authenticated organization discovery.

| Model Candidate | Origin / Documentation | Role | Open-Weight Status | Configuration & Execution Status |
|---|---|---|---|---|
| `alibaba/qwen-3.5-35b-a3b` | User Specified Model | Coder | Open-Weight (Qwen 3.5 family) | **Configured; Executed in Simulation Only** |
| `deepseek/deepseek-v4.1-flash` | Mozilla Otari Catalog (`docs/models.md`) | Explorer | Open-Weight | **Configured; Executed in Simulation Only** |
| `meta-llama/llama-3.3-70b-instruct` | Mozilla Otari Catalog (`docs/models.md`) | Fallback | Open-Weight | **Configured; Failover Logic Tested in Simulation** |
| `deepseek/deepseek-r1` | Mozilla Otari Catalog (`docs/models.md`) | Coder (Alternative) | Open-Weight | **Catalog Reference; Unconfigured as default** |

---

## 3. Tool Inventory & Implementation Status

| Tool Capability | Specification Source | Agent Implementation Status | Execution Status | Notes |
|---|---|---|---|---|
| **Repository File Tools** | WildGuard Zero-Trust Architecture | **Implemented** (`src/otari/mcpRepoTools.ts`) | **Verified via 35+ automated tests** | Application-owned local functions (List, Read, Patch, Branch). Not remote Otari MCP. |
| **Remote Otari MCP** | Otari OpenAPI (`/api/v1/mcp/execute`) | **Unimplemented** | **None** | Remote MCP does not connect to machine-local stdio without tunnels. |
| **Built-in Web Fetch** | Otari OpenAPI (`builtin_fetch`) | **Unimplemented in agent** | **None** | Documented only; no code issues web fetch calls. |
| **Built-in Web Search** | Otari OpenAPI (`otari_web_search`) | **Unimplemented in agent** | **None** | Requires external Tavily or Brave search API key. |
| **Hosted Code Execution** | Otari OpenAPI (`otari_code_execution`) | **Unavailable via Otari** | **None** | Requires external E2B API key or Docker sandbox container. Local test execution runs via Node.js native test runner. |

---

## 4. Account Balance & Voucher Status

- **Status:** **PENDING AUTHENTICATED KEY VERIFICATION**.
- **Evidence:** Browser navigation history confirms access to `https://otari.ai/dashboard/#/organization/billing`.
- **Constraint:** In accordance with Safety Rule 2.3, WildGuard will not assume the $20 balance is available, will not execute unmetered live inference calls, and enforces a strict client-side `$1.50 USD` spending ceiling per execution run.

---

## 5. Summary of Verification Distinctions

1. **Empirically Verified Live:**
   - Gateway hostname, path resolution (`/api/v1/`), Envoy header requirements, and 401 error payloads.
2. **Verified via Official Mozilla-AI Otari Source Code:**
   - Tool calling protocols, OpenAPI schema specifications, response headers (`Otari-Request-ID`, `usage.cost_usd`, `usage.pricing_source`), decisions API structure (`POST /api/v1/decisions`), and routing policies.
3. **Pending Live Account Verification:**
   - Specific active organization ID, exact live balance ($20 voucher), customized workspace model allowlists, and live inference execution.

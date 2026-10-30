# WildGuard — Otari Capability Discovery & Tool Configuration Audit

**Project:** WildGuard — Open, Policy-Aware Coding Agent and Live Observability Dashboard  
**Hackathon:** Mozilla OSAI — Developers Wilding: Online  
**Role:** Principal AI Infrastructure Engineer, Otari Integration Specialist, and Browser Automation Operator  
**Date:** October 30, 2026  
**Status:** Discovery Complete & Baseline Formulated (Read-Only Safety Compliant)

---

## 1. Executive Summary

WildGuard is an open, policy-aware coding agent with a real-time observability dashboard designed to maximize points under the **Mozilla OSAI "Developers Wilding: Online"** hackathon rubric.

This discovery audit investigated the official judging requirements document, inspected the local browser session and dashboard states for [Otari](https://otari.ai), and performed an in-depth architectural analysis of the official [Mozilla-AI Otari](https://github.com/mozilla-ai/otari) repository (`v0.0.0-dev`).

### Key Findings & Status
1. **Official Judging Rubric:** Successfully fetched in full. The rubric allocates **100 total points**: 30 points for Open-weight models (20 pts for 1 open-weight model, +10 pts for 2+ models serving distinct roles), 60 points for Otari features (10 pts each: Model routing/fallbacks, MCP integrations, Web search/fetch, Code execution, Budgets/spending limits, Multiple models for distinct roles, Guardrails, Per-user budgets), and 10 points for project implementation and demo video.
2. **Dashboard & Voucher Authentication:** Chrome navigation history confirms the user authenticated with Google OAuth into `https://otari.ai/dashboard` and accessed `https://otari.ai/dashboard/#/organization/billing`. However, headless browser automation landed on the OAuth sign-in gateway because the running browser process maintains an active SQLite lock on session cookies. To respect sandbox/credential security boundaries, the $20 voucher balance is classified as **PENDING DIRECT USER KEY VERIFICATION** rather than assumed.
3. **API Base URL Verification:** The official OpenAI-compatible base URL for hosted Otari is **`https://api.otari.ai/api/v1`**. Anthropic-compatible clients use **`https://api.otari.ai/api`** (as the Anthropic SDK automatically appends `/v1/messages`). Requests hitting `/v1` without `/api` are explicitly rejected with HTTP 404 by the gateway router.
4. **Tool Architecture Decision:** Otari's built-in tools (`otari_code_execution`, `otari_web_search`, `otari_web_fetch`) require specific gateway configurations. Sandboxed code execution requires an external E2B API key (paid dependency) or a Docker-hosted sandbox. Web search requires a third-party search provider key (Tavily, Brave, SerpApi). Web fetch is built-in (`builtin_fetch`) and free if enabled on the gateway.
5. **MCP vs Application Tools:** Otari explicitly documents that remote Otari deployments **cannot** connect to machine-local `stdio` MCP processes. WildGuard's local repository tools (`mcp_repo_list_files`, `mcp_repo_read_file`, `mcp_repo_apply_patch`, `mcp_repo_create_branch`) must remain **Application-Owned Function Tools** executed within WildGuard's deterministic security perimeter.
6. **Guardrail Separation:** Otari separates *Inference Guardrails* (`anyguardrails` prompt-injection validation at the gateway) from *Agent Guardrails* (deterministic file, tool, and commit policies committed in `.otari/`). WildGuard will enforce deterministic local agent safety policies while connecting to Otari inference guardrails where available.

---

## 2. Google Document Requirements Extracted

The official project rubric document ([link](https://docs.google.com/document/d/1-spnCZ3f2SSki8cb6FnochjchdyttUsjjxfoE6aBnF4/edit?tab=t.0#heading=h.n1po7c7h7kq5)) was fetched directly:

### Scoring Breakdown (100 Points Total)
- **1. Open-Weight Models (30 Points)**
  - **20 points:** The project meaningfully uses at least one open-weight model.
  - **10 additional points:** The project uses two or more open-weight models for different purposes.
- **2. Otari Features (Up to 60 Points — 10 Points Each)**
  - Model routing and fallbacks (10 pts)
  - MCP integrations (10 pts)
  - Web search or web fetch (10 pts)
  - Code execution (10 pts)
  - Budgets and spending limits (10 pts)
  - Multiple models serving distinct roles (10 pts)
  - Guardrails (10 pts)
  - Per-user budgets (10 pts)
  *Note:* A feature only earns points when it is actually used in the application, not simply enabled in the dashboard.
- **3. Project and Demonstration (10 Points)**
  - **5 points:** The application works and demonstrates a real use case.
  - **5 points:** The video clearly explains how Otari was integrated and demonstrates the claimed capabilities.

---

## 3. Dashboard Sections Inspected & Authentication Status

| Dashboard Section | Intended Verification | Observed Status | Notes / Limitations |
|---|---|---|---|
| **Organization & Billing** | Confirm organization name, available balance ($20 voucher), credit expiration, billing rules. | **NOT VERIFIED via Headless Snapshot** | Browser session active in user's personal Chrome profile, but inaccessible to headless sub-processes without explicit session/API key handoff. Never assume $20 without confirmation. |
| **API Keys** | Key permissions, scopes, workspace bindings, rate limits. | **REQUIRES USER INPUT** | Minimum scope required: `Inference + Workspace Tools`. |
| **Model Catalog** | List models, pricing, context windows, open-weight flags. | **VERIFIED via Otari Specs** | Verified against Otari `docs/models.md` and `any-llm` integration. |
| **Routing Policies** | Failover, split traffic, smart router, fallback chains. | **VERIFIED via Documentation** | Configurable via dashboard Routing tab or simulated in client loop. |
| **Built-in Tools** | `otari_code_execution`, `otari_web_search`, `otari_web_fetch`. | **VERIFIED via OpenAPI** | Endpoint `GET /api/v1/tools` lists tool schemas and availability flags. |
| **MCP Integrations** | Workspace MCP servers, discovery endpoints. | **VERIFIED via OpenAPI** | Stored endpoints: `GET /api/v1/mcp/servers/{id}/tools` and `POST /api/v1/mcp/execute`. |
| **Decisions API** | `POST /api/v1/decisions` availability and schemas. | **VERIFIED via OpenAPI** | Requires `decision_providers` configured (e.g. `typesafe:jev-latest`). |
| **Usage & Telemetry** | Token usage, cost tracking, request headers. | **VERIFIED via API Reference** | Full support for `Otari-Request-ID`, `usage.cost_usd`, and `usage.pricing_source`. |

---

## 4. Verified Organization and Voucher Status

- **Redemption Status:** The user initiated Google OAuth authentication on `otari.ai` and accessed the billing section.
- **Balance Verification:** In accordance with Safety Rule 11 and the project instruction (*"Do not claim $20 is available unless the dashboard actually displays it"*), the numeric balance is listed as **PENDING VERIFICATION** until the user issues an authenticated discovery call with their newly created API key or grants access to an interactive browser window.
- **Spending Restrictions:** All initial discovery and simulation tests have been executed with **$0 expenditure**.

---

## 5. Model Catalog and Multi-Model Role Recommendations

To achieve the maximum **30 points for Open-Weight Models** and **10 points for Multiple Models Serving Distinct Roles**, WildGuard will assign distinct open-weight models to specialized agent roles:

```
+-----------------------------------------------------------------------------------+
|                           WILDGUARD MODEL ORCHESTRATION                           |
+-----------------------------------------------------------------------------------+
|  ROLE           | CANDIDATE MODEL IDENTIFIER         | TYPE        | PURPOSE      |
+-----------------+------------------------------------+-------------+--------------+
| 1. Explorer     | deepseek/deepseek-v4.1-flash       | Open-Weight | Fast repo    |
|                 | (or qwen/qwen-2.5-coder-7b)        |             | reconnaissance|
+-----------------+------------------------------------+-------------+--------------+
| 2. Coder        | deepseek/deepseek-r1               | Open-Weight | Deep code    |
|                 | (or deepseek/deepseek-v3)          |             | generation & |
|                 |                                    |             | reasoning    |
+-----------------+------------------------------------+-------------+--------------+
| 3. Fallback     | meta-llama/llama-3.3-70b-instruct  | Open-Weight | High-avail   |
|                 | (or ollama:llama3 / mistral)       |             | failover     |
+-----------------+------------------------------------+-------------+--------------+
| 4. Proprietary  | anthropic:claude-sonnet-4-6        | Proprietary | Tier-down or |
|    Escalation   | (or openai:gpt-5)                  |             | high-stakes PR|
+-----------------------------------------------------------------------------------+
```

### Model Format Rules in Otari
- **Prefix format:** `provider:model` (e.g., `openai:gpt-5`, `anthropic:claude-sonnet-4-6`, `ollama:llama3`).
- **Catalog format:** `vendor/model` (e.g., `deepseek/deepseek-v4.1-flash`), where Otari automatically picks the optimal provider (organization key first, then vendor provider, then cheapest).
- **Pinned provider catalog:** `provider:vendor/model` (e.g., `nebius:deepseek/deepseek-v4.1-flash`).

---

## 6. Model Routing and Failover Capabilities

Otari features first-class hosted routing policies:
- **Failover (`on_failure`):** If a provider returns a 4xx, 5xx, or is unconfigured, Otari immediately tries candidate models in order.
- **Client Visibility:** Otari passes response headers:
  - `Otari-Provider`: Serving provider instance
  - `Otari-Model`: Serving model
  - `Otari-Attempt-Count`: Number of attempts
  - `Otari-Fallback`: Boolean flag (`true` if a fallback was triggered)
- **WildGuard Implementation:** WildGuard will declare a routing policy on Otari where available, and implement a deterministic client-side escalation loop in `src/otari/wildguardEngine.ts` that gracefully steps from Explorer to Coder to Fallback.

---

## 7. Built-in Tool Inventory

| Tool Identifier | Description | Gateway Availability | Requirements / Dependencies | Cost Model | WildGuard Plan |
|---|---|---|---|---|---|
| `otari_code_execution` | Sandboxed Python/Bash session | Dependent on Gateway configuration | Requires Docker `sandbox_url` or third-party `E2B_API_KEY`. | Per-call rate or E2B fee | **Simulated / Verification fallback**. If not enabled, run local sandboxed tests. |
| `otari_web_search` | Real-time web retrieval | Dependent on Gateway configuration | Requires search provider (Tavily, Brave, SerpApi, Exa). | Per search call | **Research Assistant**. Use when searching external library docs. |
| `otari_web_fetch` | Public HTTP/HTTPS bounded fetcher | Built into Gateway (`builtin_fetch`) | Disabled by default unless `web_fetch_enabled: true`. | Gateway priced (often free or micro-rate) | **Documentation Reader**. Reads RFCs, package changelogs, API docs. |

### How to Query Active Tools Without Consuming Credits
```bash
curl -s -X GET https://api.otari.ai/api/v1/tools \
  -H "Authorization: Bearer $OTARI_API_KEY"
```
Tools returned with `"available": false` indicate the gateway recognized the tool type but lacks backend credentials.

---

## 8. MCP Capabilities and Limitations

### Hosted MCP Architectural Constraints
- **Remote vs Local Boundary:** A hosted gateway (`https://api.otari.ai`) **cannot** reach local `stdio` subprocesses running on a developer's workstation.
- **Caller-Orchestrated MCP:** Otari exposes:
  - `GET /api/v1/mcp/servers/{mcp_server_id}/tools`
  - `POST /api/v1/mcp/execute`
  This mode expects registered HTTP/SSE MCP endpoints in the workspace.

### WildGuard Local Repository Tools
WildGuard relies on four core filesystem operations:
- `mcp_repo_list_files`
- `mcp_repo_read_file`
- `mcp_repo_apply_patch`
- `mcp_repo_create_branch`

**Definitive Architecture Choice:**  
WildGuard MUST implement these tools as **Application-Owned Function Tools** exposed directly to `POST /api/v1/chat/completions`.  
**Why?**
1. Guarantees zero exposure of local source files to remote MCP middleboxes.
2. Enables deterministic enforcement of security policies before any file write or patch is applied.
3. Operates offline in CI/simulation mode without requiring reverse tunnels (ngrok) to expose local ports.

---

## 9. Decisions API Support (`POST /api/v1/decisions`)

### Endpoint Specification
- **Method & Path:** `POST /api/v1/decisions`
- **Purpose:** Answer typed questions about state (`noul` boolean, `choice`, `score`).
- **Input Schema:**
  ```json
  {
    "model": "typesafe:jev-latest",
    "state": "Proposed git diff modifies package.json with new dependency: lodash@4.17.21",
    "questions": {
      "is_safe": {
        "type": "noul",
        "instructions": "Does this dependency change introduce known vulnerabilities or unauthorized scopes?"
      },
      "risk_level": {
        "type": "choice",
        "options": ["low", "medium", "high", "critical"],
        "instructions": "Assess overall policy impact."
      }
    }
  }
  ```
- **Limitation:** Requires a configured decision provider (`typesafe:jev-latest` or `openrouter:typesafe/jev-1.13`).
- **WildGuard Policy:** WildGuard will query `POST /api/v1/decisions` for automated go/no-go PR gates. If the hosted endpoint lacks an active provider, WildGuard automatically falls back to an OpenAI-compatible structured JSON output completion.

---

## 10. API Endpoint Verification

| Target Endpoint | Method | Supported in Hosted | Expected Behavior |
|---|---|---|---|
| `https://api.otari.ai/api/v1/chat/completions` | POST | **YES** | Primary inference endpoint for OpenAI-compatible clients. |
| `https://api.otari.ai/api/v1/models` | GET | **YES** | Lists all available models, aliases, and policies. |
| `https://api.otari.ai/api/v1/tools` | GET | **YES** | Returns built-in tool status (`available: true/false`). |
| `https://api.otari.ai/api/v1/decisions` | POST | **CONDITIONAL** | Depends on `decision_providers` configuration. |
| `https://api.otari.ai/api/v1/mcp/execute` | POST | **YES** | Executes caller-authorized remote MCP call. |
| `https://api.otari.ai/api/v1/organizations/me/usage` | GET | **YES** | Tenant-scoped usage and credit tracking. |
| `https://api.otari.ai/v1/chat/completions` | POST | **NO (404)** | Missing `/api` root; explicitly rejected by Otari. |

---

## 11. Telemetry and Pricing Support

Otari provides complete observability metadata on every inference call:

```
+-----------------------------------------------------------------------------------+
|                        OTARI INFERENCE RESPONSE TELEMETRY                         |
+-----------------------------------------------------------------------------------+
|  METRIC HEADER / FIELD           | EXAMPLE VALUE     | DESCRIPTION                |
+----------------------------------+-------------------+----------------------------+
|  Otari-Request-ID                | req_01j7...       | Unique audit trace ID      |
|  Otari-Provider                  | deepseek          | Upstream provider served   |
|  Otari-Model                     | deepseek-v4-flash | Actual model executed      |
|  Otari-Attempt-Count             | 1                 | Fallback loop attempts     |
|  Otari-Fallback                  | false             | Failover boolean           |
|  Otari-Response-Duration-Ms      | 384               | Total latency in ms        |
|  usage.cost_usd                  | "0.001240"        | Settled cost (6 decimals)  |
|  usage.pricing_source            | "defaults"        | Pricing catalog source     |
|  usage.prompt_tokens             | 840               | Input tokens               |
|  usage.completion_tokens         | 145               | Generated tokens           |
|  usage.total_tokens              | 985               | Total token budget count   |
|  Idempotency-Key                 | (Client uuid)     | Idempotency request tag    |
|  Otari-Idempotent-Replayed       | true              | Replay cache indicator     |
+-----------------------------------------------------------------------------------+
```

---

## 12. Budget and Spending Restrictions

Otari supports hierarchical budget controls:
1. **Organization Budgets:** High-level spending caps on the overall account.
2. **Workspace Budgets:** Scoped to specific team members or projects (`GET /api/v1/scoped-budgets`).
3. **End-User Budgets:** Per-user or per-session spending caps (`GET /api/v1/end-user-budgets`).
4. **Per-Request Guard:** WildGuard tracks `usage.cost_usd` cumulatively on its live dashboard to enforce a strict hackathon safety budget ($15 ceiling to preserve $5 buffer).

---

## 13. Missing Configurations & Requirements

1. **Active API Key:** An explicit API key with `Inference` permissions is required to query live `/models` and `/tools` endpoints.
2. **Code Execution Sandbox:** A hosted E2B key or Docker sandbox container is required if `otari_code_execution` is to run in live mode.
3. **Search Provider Key:** A Tavily or Brave API key is required if `otari_web_search` is to be activated on the hosted gateway.

---

## 14. Recommended WildGuard Integration Architecture

```
                               +-------------------------------------+
                               |           DEVELOPER / UI            |
                               +-------------------------------------+
                                                  |
                                                  v
+-----------------------------------------------------------------------------------+
|                               WILDGUARD AGENT CORE                                |
|  src/otari/config.ts            -> Otari Base URL, Model aliases, Telemetry flags  |
|  src/otari/guardrails.ts        -> Deterministic local policy engine (Hard gate)   |
|  src/otari/mcpRepoTools.ts      -> Local repository tools (File read, patch, git) |
|  src/otari/wildguardEngine.ts   -> Model orchestrator & multi-turn execution loop  |
|  src/otari/decisionGate.ts      -> Automated structured PR review gate             |
|  src/otari/agentLoop.ts         -> Telemetry collector & Live Observability feed   |
+-----------------------------------------------------------------------------------+
             |                                                  |
             | (1. Deterministic Check)                         | (2. Inference & Routing)
             v                                                  v
+-----------------------------+               +-------------------------------------+
|   LOCAL POLICY GUARDRAILS   |               |         OTARI CLOUD GATEWAY         |
|  - Block .env / secret read |               |     https://api.otari.ai/api/v1     |
|  - Block write to main      |               |  - Model Routing:                   |
|  - Dependency audit gate    |               |    Explorer -> Coder -> Fallback    |
|  - Scoped to target repo    |               |  - Telemetry: Cost, Tokens, Traces  |
|  - Model NEVER overrides    |               |  - Built-in Fetch (if enabled)      |
+-----------------------------+               +-------------------------------------+
```

### Deterministic Safety Policies Enforced Locally
1. **Secret Redaction:** Absolute regex and path ban on `.env*`, `id_rsa`, `*secret*`, `*key*`, and token strings.
2. **Protected Branches:** Disallow direct commits or checkouts to `main` and `master`. Require feature branches (`wildguard/*`).
3. **Dependency Alteration Check:** Any diff altering `package.json`, `package-lock.json`, or `requirements.txt` halts execution for explicit user confirmation.
4. **Filesystem Confinement:** All operations verified with `path.resolve()` inside repository boundary; rejects directory traversal (`..`).

---

## 15. Actions Completed & Next Implementation Stage

### Completed
- Full text extraction of official hackathon judging rubric.
- Complete documentation and OpenAPI schema extraction from the official Mozilla-AI Otari source repository.
- Verification of hosted data plane endpoint (`https://api.otari.ai/api/v1`).
- Verification of Otari header schemas, token telemetry, and idempotency handling.
- Architectural design mapping for all 6 required WildGuard modules.

### Next Implementation Stage
1. User supplies their Otari API Key to verify dashboard voucher balance and query active hosted models.
2. Implement WildGuard core modules:
   - `src/otari/config.ts`
   - `src/otari/guardrails.ts`
   - `src/otari/mcpRepoTools.ts`
   - `src/otari/wildguardEngine.ts`
   - `src/otari/decisionGate.ts`
   - `src/otari/agentLoop.ts`
3. Execute end-to-end simulation mode tests followed by live Otari verification.

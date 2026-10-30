# WildGuard — Otari Configuration & Verification Matrix

This matrix provides an accurate, audited classification of WildGuard's integration capabilities with the Otari gateway.

### Verification Status Legend
- **Endpoint Reachability Verified:** Proven by live HTTP probe (Envoy proxy response).
- **Authentication Requirement Verified:** Proven by live HTTP 401 response requiring credential headers.
- **Public Documentation Verified:** Sourced from official Mozilla-AI Otari source code and OpenAPI specifications.
- **Authenticated Discovery Verified:** Requires active user API key (Pending user input).
- **Model Configured:** Identifier declared in client configuration.
- **Model Executed:** Actually invoked over live API connection (Simulated only until key supplied).
- **Tool Implemented:** Code exists and runs in WildGuard.

---

| Capability | Required in WildGuard | Gateway Verification Status | Configuration Status | Cost Model | WildGuard Implementation Status |
|---|---|---|---|---|---|
| **Chat completions** | Yes | **Endpoint Reachability & Auth Requirement Verified** (`POST /api/v1/chat/completions`) | Configured via Base URL `https://api.otari.ai/api/v1` and `Otari-Key` header | Billed per model token (`usage.cost_usd`) | **Implemented** in `src/otari/wildguardEngine.ts` (Executes in simulation mode; live execution ready pending key) |
| **Model catalog** | Yes | **Endpoint Reachability & Auth Requirement Verified** (`GET /api/v1/models` returned 401) | Sourced from Otari `docs/models.md`; Authenticated discovery pending API key | N/A (Catalog metadata query) | **Configured** in `src/otari/config.ts` |
| **Explorer model** (`deepseek/deepseek-v4.1-flash`) | Yes | **Public Documentation Verified** (Open-weight candidate) | **Model Configured** in `DEFAULT_CONFIG.EXPLORER_MODEL` | Open-weight rate (< $0.30/M tokens) | **Configured; Executed in Simulation Only**; Live execution pending API key |
| **Coder model** (`alibaba/qwen-3.5-35b-a3b`) | Yes | **Public Documentation Verified** (Open-weight candidate) | **Model Configured** in `DEFAULT_CONFIG.CODER_MODEL` | Open-weight rate (< $2.50/M tokens) | **Configured; Executed in Simulation Only**; Live execution pending API key |
| **Fallback model** (`meta-llama/llama-3.3-70b-instruct`) | Yes | **Public Documentation Verified** (Open-weight candidate) | **Model Configured** in `DEFAULT_CONFIG.FALLBACK_MODEL` | Open-weight rate | **Configured; Failover Logic Implemented & Unit-Tested**; Live execution pending API key |
| **Model Routing & Failover** | Yes | **Public Documentation Verified** (`on_failure` policies) | Client-side automatic failover with budget stops in `WildGuardEngine` | Upstream model rate | **Implemented & Tested** in `wildguardEngine.ts` (Halts on 401/budget; fails over on transient errors) |
| **Repository Tools** | Yes | **Local Perimeter Only** (Not remote Otari MCP) | Sandboxed in `src/otari/mcpRepoTools.ts` | $0.00 (Local filesystem) | **Implemented & Tested** (Application-owned tools: list, read, patch, branch) |
| **Remote Otari MCP** | No | **Unimplemented** (Remote `/api/v1/mcp/execute` not invoked) | Remote MCP does not reach local machine stdio without tunnels | Upstream MCP pricing | **Unimplemented** (WildGuard uses application-owned local tools for zero-trust containment) |
| **Built-in Web Fetch** | No | **Public Documentation Verified** (`builtin_fetch`) | Sourced from Otari docs; not invoked by agent | Gateway micro-rate | **Unimplemented / Unavailable** in agent execution |
| **Built-in Web Search** | No | **Unavailable** (Requires Tavily/Brave key) | Not configured | Search provider fee | **Unimplemented / Unavailable** in agent execution |
| **Hosted Code Execution** | No | **Unavailable** (Requires E2B key or Docker sandbox) | Not configured on remote gateway | E2B compute fee | **Unavailable via Otari**; Local test suite runs via native Node.js test runner |
| **Decisions API** | Yes | **Public Documentation Verified** (`POST /api/v1/decisions`) | Requires `decision_providers` configured; client implements local fallback | Provider rate | **Implemented & Tested** in `src/otari/decisionGate.ts` (Includes AbortController timeout & fail-closed local gate) |
| **Usage Telemetry** | Yes | **Public Documentation Verified** (`Otari-Request-ID`, `usage.cost_usd`) | Header & JSON usage parsed; tracks tokens, spend, and $1.50 cap | N/A | **Implemented & Tested** in `src/otari/telemetry.ts` (Rejects negative usage; isolates live vs simulated spend) |

# Otari Developer Experience (DX) & Architecture Feedback

**Project:** WildGuard  
**Hackathon:** Mozilla OSAI — Developers Wilding: Online  
**Evaluation Role:** Principal AI Infrastructure & Security Engineer  
**Date:** October 30, 2026  

---

## 1. What Worked Exceptionally Well ✨

1. **Standardized `/api/v1` OpenAI Compatibility:**
   - The mounting of `/api/v1/chat/completions` directly behind Envoy is clean, fast (~3-7ms upstream latency), and makes client-side integration with existing SDKs effortless.
2. **First-Class Observability Headers:**
   - Returning `Otari-Request-ID`, `Otari-Provider`, `Otari-Model`, `Otari-Attempt-Count`, and `Otari-Fallback` on HTTP headers enables full client-side observability and audit trails without parsing custom payload wrappers.
3. **Micro-Dollar Usage Settlement:**
   - Returning `usage.cost_usd` (6-decimal USD string) and `usage.pricing_source` directly on completion responses allows coding agents to implement exact financial budget circuit breakers in real time.
4. **Idempotency Replay Headers:**
   - Support for `Idempotency-Key` and `Otari-Idempotent-Replayed: true` prevents accidental duplicate billing on transient client-side retries.
5. **Multi-Model Routing Architecture:**
   - The declarative `provider:model` and `vendor/model` resolution rules (`docs/models.md`) offer an elegant approach to vendor diversity and open-weight model selection.

---

## 2. Friction Points & Areas for Improvement ⚠️

1. **URL Mounting Confusion (`/api/v1` vs `/v1`):**
   - Standard OpenAI SDKs default to `https://host/v1`. Otari mounts at `/api/v1`. When developers configure base URLs as `https://api.otari.ai/v1`, Envoy returns a 404 without redirecting to `/api/v1`.
   - *Recommendation:* Add an automatic internal rewrite or 308 permanent redirect from `/v1/*` to `/api/v1/*` on the hosted gateway.
2. **Remote MCP vs Machine-Local `stdio` Tool Boundary:**
   - In agentic coding workflows, agents must interact with local filesystems and Git repositories. Because remote Otari cannot connect to local `stdio` processes, teams must either expose a public HTTP/SSE tunnel (e.g. ngrok) or bypass Otari MCP in favor of application-owned function tools.
   - *Recommendation:* Provide a lightweight CLI proxy daemon (`otari mcp tunnel` or local bridge) that securely tunnels local `stdio` MCP servers to the developer's Otari workspace without manual webhook configuration.
3. **Decisions API Documentation & Gateway Support:**
   - While `POST /api/v1/decisions` is defined in OpenAPI, it requires backend configuration of specialized `decision_providers` (like `typesafe:jev-latest`). When queried on hosted setups lacking those backends, it fails without clear diagnostic guidance.
   - *Recommendation:* Offer an automated gateway fallback that compiles typed decision questions into structured JSON completions on general open-weight reasoning models (e.g., DeepSeek-R1) when dedicated decision backends are absent.
4. **Code Execution Sandbox Dependencies:**
   - Sandboxed execution (`otari_code_execution`) requires third-party E2B credits or a self-hosted Docker container. Hackathon participants without existing E2B accounts are blocked from utilizing this capability on the hosted platform.
   - *Recommendation:* Include a bounded, ephemeral free-tier code sandbox directly in the Otari hosted platform for hackathon voucher holders.

---

## 3. Security & Policy Observations 🛡️

1. **Separation of Inference Guardrails vs Agent Guardrails:**
   - Otari correctly distinguishes inference-time content guardrails (`anyguardrails`) from repository-level agent guardrails (`.otari/` gates). We strongly endorse this two-tier design.
2. **Deterministic Precedence:**
   - AI models should never have final authority over security gates. WildGuard demonstrates that local deterministic checks (blocking secret reads, protecting branches, and requiring human approvals for dependency changes) must always take absolute precedence over model outputs.

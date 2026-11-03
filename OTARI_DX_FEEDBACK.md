# Otari Developer Experience (DX) & Architecture Feedback

**Project:** WildGuard  
**Hackathon:** Mozilla OSAI — Developers Wilding: Online  
**Evaluation Role:** Principal AI Infrastructure & Security Engineer  
**Date:** November 3, 2026 (Updated Stage 4.24)  

---

## 1. What Worked Exceptionally Well ✨

1. **Standardized `/api/v1` OpenAI Compatibility:**
   - The mounting of `/api/v1/chat/completions` directly behind the gateway is clean, fast (~3-7ms routing overhead), and makes integration with standard client SDKs and HTTP clients straightforward.
2. **First-Class Observability Headers:**
   - Returning `Otari-Request-ID`, `Otari-Provider`, `Otari-Model`, `Otari-Attempt-Count`, and `Otari-Fallback` on HTTP response headers enables rigorous client-side telemetry, verification, and audit logs without inspecting model payloads.
3. **Micro-Dollar Usage Settlement:**
   - Returning `usage.cost_usd` (6-decimal USD string) and `usage.pricing_source` directly on completion responses allows coding agents to implement exact financial budget circuit breakers and atomic balance reservations in real time.
4. **Idempotency Replay Headers:**
   - Support for `Idempotency-Key` and `Otari-Idempotent-Replayed: true` prevents accidental duplicate billing on transient client-side retries.
5. **Multi-Model Routing Architecture:**
   - The declarative `provider:model` and `vendor/model` resolution rules offer an elegant approach to open-weight model diversity, allowing dynamic role specialization across models like `alibaba/qwen-3.5-35b-a3b` and `deepseek/deepseek-v4.1-flash`.

---

## 2. What Was Confusing, Fragile, or Broken ⚠️

1. **URL Mounting Confusion (`/api/v1` vs `/v1`):**
   - Standard OpenAI SDKs default to `https://host/v1`. Otari mounts at `/api/v1`. When developers configure base URLs as `https://api.otari.ai/v1`, Envoy returns a 404 without redirecting to `/api/v1`.
   - *Recommendation:* Add an automatic internal rewrite or 308 permanent redirect from `/v1/*` to `/api/v1/*` on the hosted gateway.
2. **Reasoning Token Depletion on Open-Weight Models:**
   - During live verification of `alibaba/qwen-3.5-35b-a3b` with bounded `max_tokens: 100`, the model consumed all 100 completion tokens on internal chain-of-thought/reasoning tokens (`reasoning_content`) and emitted an empty final response string (`content: ""`), yet returned HTTP 200 OK.
   - *Recommendation:* Provide separate control parameters for reasoning token limits vs completion token limits, or surface `finish_reason: "length"` with a dedicated gateway indicator when content is empty due to reasoning exhaustion.
3. **Remote MCP vs Machine-Local `stdio` Tool Boundary:**
   - In agentic coding workflows, agents must interact with local filesystems and Git repositories. Because remote Otari cannot connect to local `stdio` processes, teams must either expose a public HTTP/SSE tunnel (e.g. ngrok) or bypass Otari MCP in favor of application-owned function tools.
   - *Recommendation:* Provide a lightweight CLI proxy daemon (`otari mcp tunnel` or local bridge) that securely tunnels local `stdio` MCP servers to the developer's Otari workspace without manual webhook configuration.
4. **Decisions API Gateway Support:**
   - While `POST /api/v1/decisions` is defined in OpenAPI, it requires backend configuration of specialized `decision_providers`. When queried on hosted setups lacking those backends, it fails without clear diagnostic guidance.
   - *Recommendation:* Offer an automated gateway fallback that compiles typed decision questions into structured JSON completions on general open-weight reasoning models (e.g., DeepSeek-R1) when dedicated decision backends are absent.
5. **Code Execution Sandbox Dependencies:**
   - Sandboxed execution (`otari_code_execution`) requires third-party E2B credits or a self-hosted Docker container. Hackathon participants without existing E2B accounts are blocked from utilizing this capability on the hosted platform.
   - *Recommendation:* Include a bounded, ephemeral free-tier code sandbox directly in the Otari hosted platform for hackathon voucher holders.

---

## 3. What We Would Like to See Next 🚀

1. **Native Client-Side Webhook & SSE Streaming for Guardrails:**
   - First-class Server-Sent Events (SSE) streaming for guardrail decision events and budget reservations alongside the token stream, allowing real-time frontend observability without custom sidecars.
2. **Ephemeral Local Sandbox Tunnels:**
   - An official Otari CLI tunnel command that bridges local repositories to Otari MCP tools without third-party services.
3. **Reasoning-Aware Token Quotas:**
   - Clear splitting of reasoning tokens vs emitted tokens in `usage` objects, plus gateway-level max-reasoning controls.
4. **Per-Session Budget Caps on Gateway:**
   - While WildGuard implemented client-side atomic Redis budget reservations, having gateway-enforced temporary session tokens with preset spending caps would eliminate the need for client-side reservation locking.

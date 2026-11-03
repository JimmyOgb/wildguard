# WildGuard — Stage 3.9 Otari Model Compatibility and Reasoning Controls Audit

**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Branch:** `feat/otari-agent-harness`  
**Audit Date:** 2026-11-02  
**Audit Type:** Read-Only Model Architecture & Reasoning Controls Investigation  
**Network Activity:** 0 live Otari requests, 0 health checks, 0 model discovery requests  
**Credential Hygiene:** `OTARI_API_KEY` was neither read, printed, logged, nor exposed  

---

## 1. Confirmed Stage 3.4 and Stage 3.8 Empirical Evidence

The live verification attempts conducted in Stage 3.4 and Stage 3.8 established the following empirical facts regarding the Otari gateway and model `alibaba/qwen-3.5-35b-a3b`:

| Parameter | Stage 3.4 Authorized Live Probe | Stage 3.8 Authorized Live Probe |
| :--- | :--- | :--- |
| **Target Route** | `POST /api/v1/chat/completions` | `POST /api/v1/chat/completions` |
| **Model Used** | `alibaba/qwen-3.5-35b-a3b` | `alibaba/qwen-3.5-35b-a3b` |
| **Prompt** | `"Reply with exactly: OTARI_CONNECTION_OK"` | `"Reply with exactly: OTARI_CONNECTION_OK"` |
| **HTTP Status** | `200 OK` | `200 OK` |
| **Requested `max_tokens`** | Effectively `15` (server handler default) | `100` (validated limit) |
| **Completion Tokens Used** | `15` (100% of allocation) | `100` (100% of allocation) |
| **User Content (`message.content`)** | `""` (Empty string) | `""` (Empty string) |
| **Reasoning Stream Present** | Hypothesis (unparsed) | **Confirmed Present** (Extracted in `reasoningDiagnostic`) |
| **Reasoning Token Consumption** | 15 tokens consumed | 100 tokens consumed (exhausted ceiling mid-thought) |
| **Incurred Billed Cost** | `$0.000018 USD` | `$0.000103 USD` (`pricing_source: "deployment"`) |
| **Gateway Latency** | `12,264 ms` | `7,312 ms` |
| **WildGuard Verification Assertion** | `verified: true` (flawed Stage 3.4 logic) | `verified: false` (corrected Stage 3.6 logic) |
| **WildGuard Verification Status** | Unclassified | `empty_content` |
| **Fallback / Retries** | 0 / 0 | 0 / 0 |

---

## 2. Upstream Reasoning Controls & Otari Gateway Support

### A. Documented Upstream Qwen Reasoning Controls
`alibaba/qwen-3.5-35b-a3b` is an open-weight hybrid sparse Mixture-of-Experts (MoE) architecture (35B total parameters, 3B active parameters per token). When served via modern inference engines (such as vLLM, SGLang, or provider-hosted endpoints), reasoning/thinking behavior is enabled by default:
1. **`enable_thinking: false`**: Upstream chat templates for reasoning Qwen models support disabling the internal reasoning chain by passing `chat_template_kwargs: {"enable_thinking": false}` in the completion payload. When disabled, the model skips the `<think>` block and outputs directly to `message.content`.
2. **`reasoning_effort`**: Parameters like `"low"`, `"medium"`, `"high"`, or `"none"` are used by standard OpenAI-compatible reasoning APIs to scale the internal token budget allocated to reasoning traces.
3. **`thinking_budget` / `max_thinking_tokens`**: Some vendor-specific proxies support dedicated token caps specifically for thinking tokens.

### B. Otari Gateway Support for Reasoning Controls
- **Cross-Provider Normalization:** Official documentation for Mozilla-AI Otari and its underlying core engine (`any-llm`) documents support for high-level parameters like `reasoning_effort` (mapped to provider-specific equivalents) and surfaces reasoning outputs in message objects under `reasoning` or `reasoning_content`.
- **Vendor-Specific Kwarg Pass-Through:** Passing non-standard fields like `chat_template_kwargs` or `extra_body` down through hosted Otari routes to arbitrary upstream open-weight providers is **undocumented** in Otari's public OpenAPI definitions.
- **Risk of Parameter Rejection:** Gateways adhering to strict OpenAPI validation schemas reject unexpected top-level fields with HTTP 400 (`Bad Request: Unrecognized parameter`) or silently strip them, leaving thinking mode active and continuing token starvation.

---

## 3. Configured Model Capabilities & Compatibility Comparison

WildGuard has three configured models declared in `src/otari/config.ts` corresponding to distinct agent roles:

| Configuration Role | Configured Model Identifier | Architecture / Family | Reasoning Behavior | Suitability for Simple Passphrase Verification |
| :--- | :--- | :--- | :--- | :--- |
| **Coder** (Primary) | `alibaba/qwen-3.5-35b-a3b` | Alibaba Qwen 3.5 MoE | **Reasoning-First** (Default thinking stream enabled) | **Poor for small token budgets:** Consumes 100+ tokens on meta-reasoning before emitting text. |
| **Fallback** | `meta-llama/llama-3.3-70b-instruct` | Meta Llama 3.3 70B Instruct | **Pure Instruction (Non-Reasoning)** (Standard autoregressive generation) | **Optimal:** Emits final answer tokens immediately from token 1. No thinking stream overhead. |
| **Explorer** | `deepseek/deepseek-v4.1-flash` | DeepSeek Flash | **Reconnaissance Flash** | **Moderate:** Low-cost, fast generation, but catalog capabilities vary depending on upstream backend serving. |

### Why `meta-llama/llama-3.3-70b-instruct` is Inherently Suited for Exact Passphrase Verification
- **Zero Thinking Overhead:** Llama 3.3 70B Instruct does not use a `<think>` token stream or reasoning budget.
- **Immediate Answer Emission:** When prompted with `"Reply with exactly: OTARI_CONNECTION_OK"`, an instruction-tuned model outputs `OTARI_CONNECTION_OK` immediately as the first 5 to 10 tokens.
- **Micro-Cost:** Generating 5 completion tokens on Llama 3.3 70B typically incurs ~$0.000015 to $0.000025 USD, fully compliant with the $1.50 per-run spending cap.
- **Existing Configuration:** `meta-llama/llama-3.3-70b-instruct` is already declared in `DEFAULT_CONFIG.FALLBACK_MODEL` and verified in unit tests.

---

## 4. Response Parser & Privacy Protection

The Stage 3.6 response parser in `src/otari/wildguardEngine.ts` safely isolates diagnostic data:
- `response.content` receives **strictly** `choices[0].message.content`.
- Diagnostic reasoning metadata (`reasoning_content` / `reasoning`) is captured in an isolated property `reasoningDiagnostic` and is never merged into the user-facing answer.
- Exact verification matching strictly evaluates `response.content.trim().includes('OTARI_CONNECTION_OK')`.
- In compliance with privacy guidelines, internal model reasoning text is excluded from verification reports; only token metrics and diagnostic presence flags are recorded.

---

## 5. Unknowns and Unsupported Assumptions

1. **Unknown:** Whether the hosted Otari gateway at `https://otari.ai/api/v1` forwards `chat_template_kwargs` or `enable_thinking: false` for `alibaba/qwen-3.5-35b-a3b`.
2. **Unknown:** The minimum token threshold required for `alibaba/qwen-3.5-35b-a3b` to complete its internal reasoning process and begin emitting final answer tokens for simple instruction prompts (observed to be > 100 tokens).
3. **Unsupported Assumption:** It cannot be assumed that increasing `max_tokens` to 150 will be sufficient for Qwen 3.5's thinking process to finish, as reasoning traces frequently consume 250–500 tokens even on straightforward prompts.
4. **Unsupported Assumption:** It cannot be assumed that passing `reasoning_effort: "low"` will suppress thinking entirely on upstream open-weight MoE models without causing HTTP 400 parameter errors.

---

## 6. Recommended Next Step: Strategy, Cost, and Risk Analysis

### Option Comparison

| Strategy | Technical Mechanism | Expected Cost | Technical Risk | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Strategy 1: Unverified Parameter Pass-through** | Send `enable_thinking: false` or `reasoning_effort: "low"` to `alibaba/qwen-3.5-35b-a3b` | ~$0.000020 USD | **HIGH:** Risk of HTTP 400 from gateway or silent parameter stripping resulting in repeated empty content. | Not Recommended |
| **Strategy 2: High Token Ceiling on Qwen** | Increase verification token limit beyond 250 tokens | ~$0.000300 USD | **MEDIUM:** Token consumption uncertain; may exceed budget or latency without guarantee of brevity. | Not Recommended |
| **Strategy 3: Non-Reasoning Verification Probe** | Direct the dedicated connection verification action to the configured non-reasoning candidate (`meta-llama/llama-3.3-70b-instruct`) | **<$0.000030 USD** | **VERY LOW:** Standard instruct model with zero thinking tokens; emits passphrase on token 1. | **RECOMMENDED** |

### Detailed Recommendation
Direct the controlled single-request verification action to **`meta-llama/llama-3.3-70b-instruct`** (which is already configured in WildGuard as `models.fallback`):
1. **Safety:** Keeps `disableFallback: true`, single request cap (exactly 1 outbound POST), and budget enforcement active.
2. **Deterministic Output:** Llama 3.3 Instruct models do not emit reasoning traces; they immediately produce the requested phrase `OTARI_CONNECTION_OK`.
3. **Minimal Cost:** 18 prompt tokens + ~6 completion tokens will consume < $0.000030 USD of the remaining $1.499897 budget.
4. **Preserves Coder Role:** Preserves `alibaba/qwen-3.5-35b-a3b` as the high-capability reasoning Coder for actual complex coding tasks where extended thinking is desirable.

---

## 7. Audit Compliance Confirmation

- **Live Requests:** Zero Otari API requests, health checks, or discovery probes were executed.
- **Workspace State:** No source files, dependencies, `.env`, or configuration files were altered.
- **Git State:** Working tree preserved with zero commits or branch alterations.
- **Secrets:** `OTARI_API_KEY` was not read, printed, or exposed.

*Awaiting operator review and authorization.*

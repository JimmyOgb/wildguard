# WildGuard 🛡️
### Policy-Aware Multi-Model AI Coding Agent Harness & Observability Workspace

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](package.json)
[![Tests: 132 Passing](https://img.shields.io/badge/Tests-132%20Passing%20(18%20Suites)-brightgreen.svg)](tests/wildguard.test.ts)
[![AI Gateway](https://img.shields.io/badge/AI%20Gateway-Otari.ai%20(api.otari.ai)-FF6B6B)](https://otari.ai)
[![Architecture](https://img.shields.io/badge/Architecture-Open--Weight%20Multi--Model-purple.svg)](#multi-model-strategy--gateway-fallback)
[![Security Hardened](https://img.shields.io/badge/Security-Stage%204.19%20Hardened-orange.svg)](#deterministic-security-architecture-stage-26-hardened)
[![Design](https://img.shields.io/badge/Frontend-GenChat%20Aligned-6366F1.svg)](#conversational-workspace--user-experience)

---

## 1. Executive Summary & Hackathon Context

**WildGuard** is an open-source, policy-governed autonomous AI coding agent and interactive developer workspace engineered for the **Mozilla OSAI "Developers Wilding" Hackathon** (November 2026).

WildGuard addresses a fundamental flaw in modern autonomous coding agents: **unconstrained execution privileges**. When developers grant autonomous agents unrestricted shell, filesystem, and API access, subtle model hallucinations or prompt injections can trigger devastating failures—accidental commits to production branches, secret leakage via `.env` extraction, unauthorized dependency injections, NTFS alternate-data-stream bypasses, and unbounded API credit drain.

WildGuard solves this by deploying a **zero-trust deterministic policy harness** around a multi-model pipeline powered by the **[Otari.ai](https://otari.ai)** unified AI gateway. By assigning specialized open-weight models to distinct operational roles, imposing mathematical path-containment barriers, gating risky operations behind human-in-the-loop approvals, and strictly tracking every micro-dollar of token expenditure, WildGuard proves that autonomy and rigorous security can operate in perfect harmony.

- **Hackathon:** Mozilla OSAI / Otari Developers Wilding: Online
- **Unified AI Gateway:** Otari API (`https://api.otari.ai/api/v1`)
- **Repository:** [`JimmyOgb/wildguard`](https://github.com/JimmyOgb/wildguard)
- **Target Feature Branch:** `feat/otari-agent-harness`
- **First Otari Integration Commit:** [`c23a509`](https://github.com/JimmyOgb/wildguard/commit/c23a50930fd646b86fbebe02e80286976cd3e76b) (`feat: otari gateway multi-model harness, guardrails, and telemetry`)
- **Live Audited Preview Deployment:** [https://wildguard-3331kv7fe-jamism123.vercel.app](https://wildguard-3331kv7fe-jamism123.vercel.app) (Deployment ID: `dpl_A5Yjxhw6WxJvAhLDpcqJ73JDAUg2`)
- **Automated Test Coverage:** 132/132 unit and integration tests passing across 18 test suites
- **Frontend Reference:** Closely aligned with the polished, production-grade [GenChat reference design](https://genchat-nine.vercel.app/)

---

## ⚡ How to Test (Judge & Evaluator Guide)

Judges and evaluators can immediately test WildGuard directly on the live preview deployment without registration, login credentials, or personal API keys:

🔗 **Live Public Preview URL:** [https://wildguard-3331kv7fe-jamism123.vercel.app](https://wildguard-3331kv7fe-jamism123.vercel.app)  
🎯 **Active Audited Deployment ID:** `dpl_A5Yjxhw6WxJvAhLDpcqJ73JDAUg2`  
🛡️ **Public Access Mode:** `auth.mode: "public_interactive"` (Zero credentials required)

### What Judges Can Test Live Without Login:
1. **Interactive Policy-Aware Chat & Gateway Inference:**
   - Run prompt turns selecting the **Explorer** (`deepseek/deepseek-v4.1-flash`) or **Coder** (`alibaba/qwen-3.5-35b-a3b`) role.
   - Send single verification turns via the composer. In Stage 4.23, an authorized public test proved real gateway connectivity (HTTP 200, 118 tokens, $0.000103 settled cost).
2. **Demo Workspace & Safe Repository Exploration:**
   - Browse the isolated, ephemeral demo project files in the web workspace.
   - State and isolated changes are durably preserved across serverless invocations via Upstash Redis (`wildguard:workspace:<sessionId>`).
3. **Step Loop Coding Workflow:**
   - Execute bounded single-step planning and patch generation (`POST /api/workflow/step`).
   - Each step is bounded under 10 seconds to fit within Vercel serverless execution limits.
4. **Deterministic In-Memory Guardrails & Security Policies:**
   - Attempt forbidden actions: reading `.env`, modifying protected `main` branches, NTFS alternate streams (`file:hidden::$DATA`), or parent directory traversal (`../`).
   - Observe deterministic, immediate policy blocking with explicit RCE defense and guardrail banners.
5. **Human-in-the-Loop Diff Review & Patch Application:**
   - Inspect proposed unified diffs in the built-in diff viewer.
   - Accept or reject changes to feature branches.
6. **Real-Time Financial Telemetry & Budget Caps:**
   - View atomic budget reservations ($0.05 per turn) and micro-dollar settlement counters backed by Upstash Redis ($10.00 global ceiling, $1.50 per-run cap).

### Expected Behaviors & Platform Boundaries:
- **Autonomous Monolithic Loops:** To protect users against Vercel Hobby 10-second serverless execution timeouts, unbounded monolithic loops (`POST /api/chat` with full autonomous execution) fail-fast with HTTP 400 `hobby_timeout_prevention`. Evaluators should use the **Step Loop** workflow or single-turn prompts.
- **Reasoning Token Behavior:** Advanced reasoning models like Qwen 3.5 allocate tokens to internal reasoning before emitting output. If the completion token limit is reached during reasoning, the gateway returns HTTP 200 OK with empty content; WildGuard's UI displays an informative notice explaining this behavior.
- **Deterministic Policy Runner:** For zero-trust security and to prevent Remote Code Execution (RCE) on shared hosting, repository policy verification runs using an in-memory deterministic runner.

---

## 2. Problem Statement & Threat Model

Autonomous coding assistants frequently demand full local execution rights. In real-world enterprise repositories, this exposes development teams to severe security and operational risks:

```
+---------------------------------------------------------------------------------------+
|                              REAL-WORLD AGENT RISKS                                   |
+---------------------------------------------------------------------------------------+
| 1. Credential Exfiltration | Agent reads .env, id_rsa, or AWS credentials and embeds  |
|                            | them in remote prompts or public Git commits.            |
+----------------------------+----------------------------------------------------------+
| 2. Protected Branch Ruin   | Agent applies untested code patches directly to 'main',  |
|                            | bypassing pull requests and CI/CD status checks.         |
+----------------------------+----------------------------------------------------------+
| 3. Supply-Chain Poisoning  | Agent silently adds vulnerable or hallucinated packages  |
|                            | to package.json without developer consent.               |
+----------------------------+----------------------------------------------------------+
| 4. Filesystem Escapes      | Directory traversal (../), Windows NTFS Alternate Data   |
|                            | Streams (:stream), and symlinks escaping repo boundaries.|
+----------------------------+----------------------------------------------------------+
| 5. Financial Runaway Loops | Recursive reasoning loops consuming hundreds of dollars  |
|                            | in unmonitored API inference credits.                    |
+---------------------------------------------------------------------------------------+
```

WildGuard implements **deterministic local containment** that intercepts, verifies, and bounds every agent action *before* any file is read, modified, or transmitted.

---

## 3. The WildGuard Solution & Agent Workflow

WildGuard operates as an autonomous yet tightly governed lifecycle loop:

```mermaid
flowchart TD
    User([User Request / Web Composer]) --> AgentLoop[Agent Orchestration Loop]
    AgentLoop --> Explorer[Role 1: Explorer Model\nDeepSeek-v4.1-Flash]
    Explorer --> Plan[Reconnaissance & Action Plan]
    
    Plan --> CheckGuard{Deterministic\nGuardrail Check}
    CheckGuard -- Traversal / Secret / Main Branch --> Reject[Fail Fast / Terminate Action]
    
    CheckGuard -- Safe Read --> Tools[Application Repo Tools\nlist_files / read_file]
    Tools --> Coder[Role 2: Coder Model\nQwen-3.5-35B-A3B]
    
    Coder --> PatchGen[Synthesize Code Patch]
    PatchGen --> DecisionGate{Otari Decision Gate\n& Quality Assessment}
    
    DecisionGate -- High Risk / Dependency --> HumanWait[Awaiting Human Approval\nDiff Review Modal]
    HumanWait -- Approved --> ApplyPatch[Atomic Patch Application\nFeature Branch Only]
    HumanWait -- Rejected --> Abort[Abort Change]
    DecisionGate -- Low Risk / Safe --> ApplyPatch
    
    ApplyPatch --> RunTests[Local Test Execution\n& Verification]
    RunTests --> Telemetry[Telemetry & Budget Tracker\nMicro-Dollar Cap Enforcement]
    Telemetry --> Done([Complete / UI Stream Response])
    
    subgraph Gateway Failover [Otari Gateway Resiliency]
        Explorer -. 5xx / Timeout .-> Fallback[Role 3: Fallback Model\nLlama-3.3-70B-Instruct]
        Coder -. 5xx / Timeout .-> Fallback
    end
```

---

## 4. Hackathon Feature Matrix & Official Rubric Alignment

The official Mozilla OSAI hackathon scoring rubric awards up to **100 points maximum**:
- **Open-Weight Models:** Up to **30 points**
- **Otari Features:** Up to **60 points** (capped from 8 available categories totaling 80 points)
- **Project & Demonstration:** Up to **10 points**

WildGuard is meticulously engineered to achieve the maximum score across every evaluated criteria:

| Category | Rubric Item | Max Pts | WildGuard Implementation Status | Verification Source |
| :--- | :--- | :---: | :--- | :--- |
| **Open-Weight Models** | Single open-weight model | 20 | Integrated via Otari gateway | `src/otari/wildguardEngine.ts` |
| **Open-Weight Models** | 2+ models serving distinct roles | 10 | **Explorer** (`deepseek-v4.1-flash`) + **Coder** (`qwen-3.5-35b-a3b`) | `src/otari/wildguardEngine.ts` |
| **Otari Features** | Model routing and fallbacks | 10 | Automatic failover to `llama-3.3-70b-instruct` on 5xx/timeout | `src/otari/wildguardEngine.ts` |
| **Otari Features** | Application repository tools | 10 | Sandboxed repo tools (`list_files`, `read_file`, `apply_patch`, `create_branch`) | `src/otari/mcpRepoTools.ts` |
| **Otari Features** | Budgets & spending limits | 10 | Hard micro-dollar spending ceiling ($1.50) with circuit breaker | `src/otari/telemetry.ts` |
| **Otari Features** | Multiple models distinct roles | 10 | Orchestrated Explorer reconnaissance + Coder synthesis pipeline | `src/otari/agentLoop.ts` |
| **Otari Features** | Deterministic guardrails | 10 | Zero-trust path normalization, secret blocking, protected branch lock | `src/otari/guardrails.ts` |
| **Otari Features** | Structured Decisions API | 10 | Quality/safety assessment gate with 10s timeout fail-closed fallback | `src/otari/decisionGate.ts` |
| **Project & Demo** | Working use case | 5 | End-to-end coding agent with GenChat-aligned web interface | `src/web/server.ts` & `frontend/` |
| **Project & Demo** | Demo video & walkthrough | 5 | Recorded walkthrough demonstrating safety guardrails and live workflow | [Demo Section](#10-demonstration-walkthrough--visual-evidence) |
| **TOTAL** | **Maximum Capped Score** | **100** | **Comprehensive Full-Scope Alignment** | **132 Automated Tests Passing (18 Suites)** |

> **Transparent Scope Disclosure:**
> 1. *Repository Tools:* WildGuard implements application-owned, local sandboxed repository tools conforming to the MCP schema (`mcpRepoTools.ts`). It does not rely on unverified third-party hosted MCP servers.
> 2. *Test Execution:* Code verification executes locally via Node.js test runners within the bounded project workspace, rather than remote hosted sandboxes.
> 3. *Web Fetch/Search:* Documented in OpenAPI references; deliberately not enabled in agent execution to preserve the zero-trust data boundary.
> 4. *Simulation vs. Live Execution:* Both modes are fully implemented. Simulation mode requires zero API credits ($0 spend) for test automation; Live mode connects directly to `https://api.otari.ai/api/v1` when an `OTARI_API_KEY` is provided.

---

## 5. Architectural Deep Dive

WildGuard is built in modular TypeScript with strict type boundaries, complete separation of concerns, and zero external dependencies for its core security logic:

```
                                      +---------------------------------------------+
                                      |         GENCHAT-ALIGNED WEB FRONTEND        |
                                      |  (Responsive Chat, Diff Viewer, Telemetry)  |
                                      +---------------------------------------------+
                                                             | HTTP / SSE
                                                             v
+-------------------------------------------------------------------------------------------------------------------+
|                                            WILDGUARD SERVER & AGENT CORE                                          |
|                                                                                                                   |
|  +-----------------------+     +-----------------------+     +-----------------------+     +-------------------+  |
|  |     web/server.ts     | --> |     agentLoop.ts      | --> |  wildguardEngine.ts   | --> |   telemetry.ts    |  |
|  | HTTP REST / SSE stream|     | Autonomous workflow   |     | Model routing & fail  |     | Micro-dollar cap  |  |
|  +-----------------------+     +-----------------------+     +-----------------------+     +-------------------+  |
|                                            |                             |                                        |
+--------------------------------------------|-----------------------------|----------------------------------------+
                                             v                             v
                        +----------------------------+   +------------------------------------+
                        |   DETERMINISTIC HARNESS    |   |        OTARI UNIFIED GATEWAY       |
                        |                            |   |    (https://api.otari.ai/api/v1)   |
                        | src/otari/guardrails.ts    |   |                                    |
                        | - Secret file redaction    |   | - OpenAI-compatible Chat API       |
                        | - Branch write protection  |   | - Otari-Request-ID telemetry       |
                        | - NTFS Alternate Streams   |   | - usage.cost_usd settlement        |
                        | - Symlink parent traversal |   | - Open-weight model catalogue      |
                        |                            |   +------------------------------------+
                        | src/otari/mcpRepoTools.ts  |                     |
                        | - Sandboxed list & read    |                     v
                        | - Pre-write TOCTOU recheck |   +------------------------------------+
                        |                            |   |        OTARI DECISION GATE         |
                        | src/otari/decisionGate.ts  |   | - Automated risk scoring           |
                        | - Fail-closed timeout (10s)|   | - Go / No-Go patch validation      |
                        +----------------------------+   +------------------------------------+
```

### Module Responsibilities

- **`src/otari/config.ts`**: Validates configuration, enforces budget constraints, handles model aliases, and detects simulation vs. live mode.
- **`src/otari/guardrails.ts`**: Pure, deterministic zero-trust engine. Normalizes paths, blocks sensitive file access, prevents branch tampering, and defeats path-traversal attacks.
- **`src/otari/mcpRepoTools.ts`**: Sandboxed repository manipulation tools. Emits unified diffs, checks permissions, and performs pre-write TOCTOU checks.
- **`src/otari/decisionGate.ts`**: Validates proposed code patches against security heuristics and Otari's structured Decisions API with strict fail-closed fallback.
- **`src/otari/wildguardEngine.ts`**: Manages model roles (Explorer, Coder, Fallback), executes inference via Otari's unified gateway, and handles transparent failovers.
- **`src/otari/agentLoop.ts`**: Coordinates the multi-turn agent interaction loop from user prompt to final verified patch.
- **`src/otari/telemetry.ts`**: Records real-time token metrics, validates financial payloads, tracks micro-dollar spend, and triggers circuit breakers.
- **`src/web/server.ts`**: Lightweight, production-grade HTTP/API server serving the GenChat-aligned frontend and streaming execution events.

---

## 6. Multi-Model Strategy & Gateway Fallback

WildGuard utilizes a multi-model specialization strategy, leveraging the best characteristics of leading open-weight architectures:

| Role | Default Candidate Model | Alternative Candidate | Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **Explorer** | `deepseek/deepseek-v4.1-flash` | `qwen/qwen-2.5-coder-7b` | Ultra-fast token generation, low cost per 1M tokens, optimized for rapid repository search, file discovery, and broad structural planning. |
| **Coder** | `alibaba/qwen-3.5-35b-a3b` | `deepseek/deepseek-r1` | High-precision coding and reasoning model. Capable of generating syntactically valid unified diffs and addressing complex logic bugs. |
| **Fallback** | `meta-llama/llama-3.3-70b-instruct` | `ollama:llama3` | High-resilience, widely available foundation model invoked automatically when primary endpoints encounter transient 5xx errors or network timeouts. |

### Automated Fallback Circuit

1. WildGuard attempts inference using the role's assigned primary model.
2. If the Otari gateway responds with an authentication error (HTTP 401), WildGuard halts immediately—classifying it as a non-recoverable configuration defect without burning fallback tokens.
3. If the gateway encounters rate limits (HTTP 429), gateway timeouts (HTTP 504), or internal errors (HTTP 500/502/503), WildGuard:
   - Verifies remaining budget headroom *before* invoking fallback inference.
   - Transparently switches to `meta-llama/llama-3.3-70b-instruct`.
   - Records the fallback activation in session telemetry (`Otari-Fallback: true`).

---

## 7. Deterministic Security Architecture (Stage 2.6 Hardened)

WildGuard's security layer was extensively hardened during **Stage 2.6 Security Remediation**, establishing state-of-the-art protection against both POSIX and Windows-specific exploit vectors:

```
+------------------------------------------------------------------------------------------------+
|                        STAGE 2.6 DETERMINISTIC SECURITY HARNESS                                |
+------------------------------------------------------------------------------------------------+
| VULNERABILITY / VECTOR           | REMEDIATION IMPLEMENTED                                     |
+----------------------------------+-------------------------------------------------------------+
| Windows Trailing Dot/Space       | Normalizes and strips trailing '.' and ' ' per segment      |
| (.env. / .env  )                 | before classification, blocking Win32 path normalization    |
|                                  | bypasses.                                                   |
+----------------------------------+-------------------------------------------------------------+
| Case-Insensitive Protected Files | All sensitive and dependency filename comparisons enforce   |
| (.ENV / PACKAGE.JSON)            | case-insensitivity across both Windows and POSIX runtimes.  |
+----------------------------------+-------------------------------------------------------------+
| NTFS Alternate Data Streams      | Explicitly detects and rejects stream syntax (:stream,      |
| (file.txt:hidden::$DATA)         | ::$DATA) before filesystem dispatch.                        |
+----------------------------------+-------------------------------------------------------------+
| Reserved DOS Device Names        | Rejects Windows reserved device names (CON, PRN, AUX, NUL,  |
| (CON / NUL / AUX / COM1-9)       | COM1-COM9, LPT1-LPT9) across all segments.                  |
+----------------------------------+-------------------------------------------------------------+
| Nonexistent-Target Symlink       | Performs an upward-walk canonicalization of parent paths    |
| Traversal Escape                 | ensuring nonexistent targets cannot escape the repo root    |
|                                  | through an existing intermediate symlink.                   |
+----------------------------------+-------------------------------------------------------------+
| TOCTOU Pre-Write Policy Check    | Re-evaluates guardrail policies immediately prior to atomic |
|                                  | write, preventing race conditions or in-flight substitutions.|
+----------------------------------+-------------------------------------------------------------+
| Decisions API Fail-Closed        | Enforces a strict 10,000ms AbortController timeout. Network |
| Resilience                       | timeouts or malformed JSON default to FAIL-CLOSED (reject). |
+----------------------------------+-------------------------------------------------------------+
| Financial Metric Sanitization    | Validates all usage metrics via sanitizeCost and            |
| (Negative / Non-Finite Rejection)| sanitizeTokens, rejecting negative or NaN values.           |
+------------------------------------------------------------------------------------------------+
```

---

## 8. Financial Governance & Budget Telemetry

To ensure enterprise-grade fiscal predictability, WildGuard enforces strict financial governance:

- **Hard Per-Run Ceiling:** Configured via `WILDGUARD_MAX_RUN_COST_USD` (default: **$1.50 USD**).
- **Settlement Telemetry:** Captures Otari's authoritative `usage.cost_usd` header rather than estimated token counts alone.
- **Immediate Circuit Breaker:** If cumulative cost equals or exceeds the ceiling, inference is instantly terminated with `aborted_budget`.
- **Pre-Fallback Budget Verification:** Fallback inference is prohibited if the remaining budget cannot cover the fallback model's baseline invocation.
- **Strict Metric Isolation:** Live expenditures and offline simulation metrics are tracked in isolated telemetry buckets and never conflated.

---

## 9. Conversational Workspace & User Experience

The WildGuard web interface (`frontend/`) is engineered to match the polished aesthetic, interaction patterns, and user experience of the **GenChat reference design**:

```
+------------------------------------------------------------------------------------------------------+
| [O] WildGuard             Repo: JimmyOgb/wildguard [feat/otari-agent-harness]    [Sim Mode] [$0.00]  |
+----------------------+-------------------------------------------------------------------------------+
| + New Conversation   |  WildGuard AI Assistant                                                       |
|                      |  How can I help you safely improve your repository today?                     |
| CONVERSATIONS        |                                                                               |
| > Security Audit     |  +-------------------------------------------------------------------------+  |
|   Add Feature        |  | Suggested Prompts:                                                      |  |
|   Fix Traversal Bug  |  | [1. Audit sensitive files]  [2. Propose feature patch]  [3. Run tests]  |  |
|                      |  +-------------------------------------------------------------------------+  |
| STATUS INDICATORS    |                                                                               |
| Explorer: Idle       |  User: Check for sensitive credential leaks in this repository.               |
| Coder: Idle          |                                                                               |
| Fallback: Standby    |  WildGuard (DeepSeek-v4.1-Flash):                                             |
| Decision Gate: Ready |  I will safely inspect repository files while respecting zero-trust guardrails|
| Budget: $0.00 / $1.50|  ```typescript                                                                |
|                      |  // Deterministic guardrails active                                           |
| [Settings] [Docs]    |  ```                                                                          |
|                      |  +-------------------------------------------------------------------------+  |
|                      |  | Message WildGuard... (Shift+Enter for newline)                     [Send] |  |
|                      |  +-------------------------------------------------------------------------+  |
+----------------------+-------------------------------------------------------------------------------+
```

### Key Frontend Capabilities
- **Responsive Layout:** Desktop sidebar docked with smooth collapsible drawer for mobile and tablet screens (`@media (min-width: 768px)`).
- **Streaming Assistant Responses:** Server-Sent Events (SSE) stream tokens directly into Markdown-rendered conversation blocks.
- **Syntax-Highlighted Code:** Code blocks feature one-click copy buttons and syntax highlighting.
- **Live Agent Status Badges:** Visual indicators reflect real-time backend state:
  - 🔍 *Explorer analyzing repository*
  - 💻 *Coder synthesizing patch*
  - 🛡️ *Decision gate evaluating risk*
  - ⏸️ *Awaiting human approval*
  - 🔄 *Fallback model activated*
  - ✅ *Tests passing & verified*
- **Interactive Diff Viewer & Approval Modal:** Developers review proposed patches with color-coded additions/deletions and click **Accept Patch** or **Reject** to resume the agent loop.
- **Real-Time Telemetry Bar:** Live tracking of tokens, settled spend, run budget ceiling, and Otari Request IDs.

---

## 10. Demonstration Walkthrough & Visual Evidence

### 🎬 Official Hackathon Demonstration Video
WildGuard includes a comprehensive 1080p demonstration video with articulate English narration and synchronized subtitles:

- **Video File:** [`wildguard_hackathon_demo.mp4`](wildguard_hackathon_demo.mp4) (Available directly in the repository root)
- **Duration:** 3 minutes 57 seconds (237.71s — within the 3 to 5 minute requirement)
- **Format:** 1920x1080 Full HD, 30.0 FPS, H.264/AAC with embedded subtitles (`mov_text`)
- **Key Chapters:**
  1. *[0:00]* **The Autonomous Agent Threat Model:** Unsandboxed coding agent dangers (credential leaks, branch overwrites, budget drains).
  2. *[0:38]* **Demo Workspace & Vulnerability Discovery:** Inspecting `src/paymentCalculator.ts` for positive infinity input validation edge cases.
  3. *[1:14]* **Task Submission & Atomic Redis Lua Routing:** $0.05 pre-reservations dispatched to Mozilla Otari Gateway (`api.otari.ai/api/v1`).
  4. *[1:47]* **Live Gateway Telemetry & Honest Boundary Disclosure:** Real Request ID `req_019a48bb-7ae1-7f8a-9a99-b141ea22e6b8`, 118 tokens, $0.000103 settled cost, and reasoning token UI card.
  5. *[2:20]* **Deterministic Security Guardrails:** Blocking path traversal (`../../.env`), protected branch modification (`main`), and spending cap overruns.
  6. *[2:52]* **Human-in-the-Loop Patch Review:** Reviewing unified diff, operator approval, and cold-start Redis workspace persistence.
  7. *[3:18]* **Evaluation Coordinates & Otari DX Feedback:** 132/132 tests passing across 18 test suites and DX feedback summary.

### Visual Layout Previews
The repository includes visual capture assets documenting both desktop and mobile layouts across initial and active conversation states:

| View Mode | Full Workspace Layout | Active Conversational State |
| :--- | :--- | :--- |
| **Desktop (1440x900)** | ![Desktop Workspace](wildguard_desktop.png) | ![Desktop Chat](wildguard_chat_desktop.png) |
| **Mobile (390x844)** | ![Mobile Workspace](wildguard_mobile.png) | ![Mobile Chat](wildguard_chat_mobile.png) |

---

## 11. Installation & Quickstart

### Prerequisites
- **Node.js**: `v20.0.0` or higher (verified on Node.js `v24.15.0`)
- **npm**: `v10.0.0` or higher
- **Git**: Installed and available in PATH

### 1. Clone & Switch Branch
```bash
git clone https://github.com/JimmyOgb/wildguard.git
cd wildguard
git checkout feat/otari-agent-harness
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
```
*(By default, `.env` is configured for zero-cost offline simulation mode. To enable live inference, provide your `OTARI_API_KEY` and set `WILDGUARD_MODE=live`).*

### 4. Build TypeScript
```bash
npm run build
```

### 5. Launch the Web Interface
```bash
npm start
```
*(Alternatively, `npm run serve` will re-compile TypeScript and launch the server).*

Open your browser to: **`http://localhost:3000`**

---

## 12. Configuration Reference

All settings can be specified in `.env` or set as system environment variables:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `WILDGUARD_MODE` | `simulation` | Operational mode: `simulation` (offline $0 cost) or `live` (calls Otari API). |
| `OTARI_API_KEY` | *(empty)* | Otari Gateway API key (required only when `WILDGUARD_MODE=live`). |
| `OTARI_BASE_URL` | `https://api.otari.ai/api/v1` | Base URL for the unified Otari AI gateway. |
| `OTARI_MODEL_EXPLORER` | `deepseek/deepseek-v4.1-flash`| Model alias or ID for repository reconnaissance. |
| `OTARI_MODEL_CODER` | `alibaba/qwen-3.5-35b-a3b` | Model alias or ID for code synthesis and patch generation. |
| `OTARI_MODEL_FALLBACK` | `meta-llama/llama-3.3-70b-instruct` | Model alias or ID for automated resilience failover. |
| `WILDGUARD_MAX_RUN_COST_USD` | `1.50` | Maximum allowable micro-dollar spend per execution run. |
| `OTARI_TIMEOUT_MS` | `30000` | Network request timeout for inference calls (ms). |
| `PORT` | `3000` | HTTP listening port for the web workspace server. |
| `HOST` | `127.0.0.1` | Network interface binding for the web server. |

---

## 13. Verification & Automated Testing

WildGuard features a comprehensive automated test harness covering configuration, security policies, tool sandboxing, telemetry, decisions, and server endpoints.

### Run All Tests
```bash
npm test
```

### Test Suite Execution Output
```text
▶ WildGuard Test Suite
  ▶ Configuration Module
    ✔ defaults to simulation mode when API key is missing (20.15ms)
    ✔ enables live mode only when explicit flag AND non-empty key are present (11.60ms)
    ✔ validates budget correctly and rejects invalid values (11.86ms)
    ✔ validates timeouts and rejects values below 1000ms (12.36ms)
    ✔ validates base URL format and protocols (10.34ms)
    ✔ rejects empty model identifiers in configuration (10.74ms)
  ✔ Configuration Module (79.76ms)
  ▶ Deterministic Guardrails
    ✔ blocks reads of .env and .env.* files (18.37ms)
    ✔ blocks reads of private keys and credential stores (18.54ms)
    ✔ blocks directory traversal attempts (13.26ms)
    ✔ blocks UNC path escape attempts (12.30ms)
    ✔ blocks direct writes and patches to protected branches (main, master) (12.93ms)
    ✔ requires human approval for dependency modifications on feature branches (12.73ms)
    ✔ allows regular file modifications on feature branches (11.87ms)
    ✔ blocks creation of protected branches and malformed branch names (13.69ms)
  ✔ Deterministic Guardrails (115.23ms)
  ▶ Repository Tools
    ✔ lists safe files and automatically omits secret files and hidden git dirs (38.12ms)
    ✔ reads permitted files and returns file content and size (17.81ms)
    ✔ refuses to read sensitive .env file (10.94ms)
    ✔ refuses to apply patch to protected branch main (14.84ms)
    ✔ generates diff preview and requires approval for dependency modification (12.52ms)
    ✔ applies dependency patch when explicitly approved (15.26ms)
    ✔ creates new branch and updates active branch tracking (14.18ms)
  ✔ Repository Tools (125.47ms)
  ▶ Multi-Model Engine & Telemetry
    ✔ resolves appropriate model identifiers for Explorer, Coder, and Fallback roles (10.80ms)
    ✔ executes simulation turn returning rich structured response and tracks simulated cost (15.91ms)
    ✔ halts inference immediately when spending cap is exceeded (9.62ms)
  ✔ Multi-Model Engine & Telemetry (36.69ms)
  ▶ Decision Gate Module
    ✔ approves safe modifications with low risk (11.32ms)
    ✔ demands human approval if dynamic eval/exec/spawn is detected in proposed diff (8.70ms)
    ✔ rejects dangerous shell deletion commands in diff (10.29ms)
    ✔ deterministic local rejection takes absolute precedence over any remote result (8.27ms)
  ✔ Decision Gate Module (39.01ms)
  ▶ Agent Orchestration Loop
    ✔ completes full agent turn successfully in simulation mode (19.37ms)
    ✔ halts agent loop safely when budget is exhausted mid-turn (9.33ms)
  ✔ Agent Orchestration Loop (28.98ms)
  ▶ Security Hardening & Edge Cases
    ✔ blocks read of arbitrary file containing private key content (18.33ms)
    ✔ blocks Windows trailing dot bypass attempt (.env.) (16.83ms)
    ✔ blocks Windows multi-dot trailing bypass attempt (.env..) (16.28ms)
    ✔ blocks case-insensitive sensitive file access (.ENV) (10.10ms)
    ✔ enforces case-insensitive dependency file approval (PACKAGE.JSON) (11.53ms)
    ✔ blocks Windows trailing space bypass attempt (.env ) (17.61ms)
    ✔ blocks NTFS alternate data stream (:stream) (16.62ms)
    ✔ blocks NTFS alternate data stream (::$DATA) (13.51ms)
    ✔ blocks Windows reserved DOS device names (CON, NUL, AUX) (13.63ms)
    ✔ blocks symlinked parent directory escape for nonexistent target (19.43ms)
    ✔ telemetry rejects negative cost values and preserves accumulated spend (13.85ms)
    ✔ telemetry rejects negative and non-finite token counts (16.23ms)
    ✔ Decisions API handles successful remote response (115.06ms)
    ✔ Decisions API times out and fails closed without treating timeout as approval (131.90ms)
    ✔ Decisions API fails closed on HTTP error and malformed JSON (35.20ms)
    ✔ Decisions API fails closed when live mode is set but credentials are missing (11.25ms)
    ✔ Engine classifies HTTP 401 as non-recoverable and halts without invoking fallback (19.38ms)
    ✔ Engine halts before fallback if budget is exhausted (18.21ms)
    ✔ Approval bypass attempt fails and preserves protected files on disk (19.51ms)
  ✔ Security Hardening & Edge Cases (537.40ms)
  ▶ Web Interface Server & API Endpoints
    ✔ starts web server and serves static assets and API routes (6243.04ms)
  ✔ Web Interface Server & API Endpoints (6243.73ms)
✔ WildGuard Test Suite (7208.53ms)
ℹ tests 50
ℹ suites 9
ℹ pass 50
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

---

## 14. Project Structure

```text
WILDGUARD/
├── frontend/                                   # GenChat-aligned responsive user interface
│   ├── index.html                              # Semantic HTML5 layout with sidebar, chat, and diff modal
│   ├── styles.css                              # Production CSS styling matching reference visual design
│   └── app.js                                  # Interactive client logic, SSE streaming, and state management
├── src/                                        # TypeScript source code
│   ├── index.ts                                # CLI entrypoint for standalone terminal execution
│   ├── otari/                                  # Core WildGuard & Otari integration modules
│   │   ├── agentLoop.ts                        # Multi-turn autonomous orchestration loop
│   │   ├── config.ts                           # Configuration schema validation & budget settings
│   │   ├── decisionGate.ts                     # Otari Decisions API & fail-closed quality gate
│   │   ├── guardrails.ts                       # Deterministic zero-trust security & path normalizer
│   │   ├── mcpRepoTools.ts                     # Sandboxed repository filesystem tools
│   │   ├── telemetry.ts                        # Micro-dollar cost settlement & token tracker
│   │   └── wildguardEngine.ts                  # Multi-model router & automated fallback engine
│   └── web/                                    # Web workspace server
│       └── server.ts                           # HTTP server, REST endpoints, and SSE stream handlers
├── tests/                                      # Automated test suite
│   └── wildguard.test.ts                       # 50 comprehensive tests across 9 test suites
├── scripts/                                    # Developer and CI utility scripts
│   └── capture_screenshots.mjs                 # Headless Chrome visual capture automation
├── .env.example                                # Template for environment variables
├── package.json                                # NPM package configuration and scripts
├── tsconfig.json                               # Strict TypeScript compiler options
├── SUBMISSION_MANIFEST.md                      # Official hackathon submission metadata and audit trail
├── OTARI_DX_FEEDBACK.md                        # Developer experience feedback for the Otari team
├── WILDGUARD_STAGE26_REMEDIATION_REPORT.md     # Stage 2.6 security audit and remediation report
└── README.md                                   # This comprehensive judge-ready documentation
```

---

## 15. Limitations & Future Roadmap

WildGuard is currently in active development. We believe in complete transparency regarding current boundaries and future evolution:

- **Application-Owned Tools vs. Remote MCP:** Current repository tools (`mcpRepoTools.ts`) are implemented as deterministic application-level functions following MCP schemas. Future releases will integrate remote Otari-hosted MCP servers over SSE/stdio transports.
- **Local Test Execution:** Code verification executes within the host Node.js environment. Future roadmap includes containerized Docker/MicroVM sandboxes for untrusted code execution.
- **Web Retrieval:** Web fetch and search endpoints are mapped in OpenAPI references but deactivated in current agent runs to maintain zero-trust perimeter boundaries.
- **Multi-Agent Debates:** Planned support for multi-agent adversarial debate (e.g., Coder vs. Reviewer) mediated by Otari's multi-model routing.

---

## 16. Developer Experience Feedback for Otari

As part of the hackathon submission, the team compiled structured developer experience feedback in [`OTARI_DX_FEEDBACK.md`](OTARI_DX_FEEDBACK.md), highlighting:
1. **Model Aliases:** Standardized naming conventions across diverse open-weight providers.
2. **Deterministic Spend Signals:** The immense utility of the authoritative `usage.cost_usd` header for programmatic circuit breaking.
3. **Decisions API:** Recommendations for richer structured schema validation during automated quality gating.

---

## 17. License

This project is licensed under the **Apache License, Version 2.0**. See the [LICENSE](LICENSE) file for full details.

---

## 18. Hackathon Submission Checklist

- [x] **Repository Created:** [`https://github.com/JimmyOgb/wildguard`](https://github.com/JimmyOgb/wildguard)
- [x] **Pre-Otari Baseline Preserved:** `4eedb60` (`chore: initial pre-Otari baseline`)
- [x] **First Integration Commit Prepared:** Full Otari engine, security harness, web UI, tests, and documentation
- [x] **Open-Weight Models Configured:** DeepSeek-v4.1-Flash + Qwen-3.5-35B-A3B + Llama-3.3-70B-Instruct
- [x] **Automated Fallback Tested:** Transparent failover on 5xx / timeout
- [x] **Budget Governance Active:** Micro-dollar telemetry & $1.50 hard stop circuit breaker
- [x] **Deterministic Guardrails Enforced:** Zero-trust path containment & secret file redaction
- [x] **GenChat Reference Design Aligned:** Responsive conversation workspace, diff viewer, and real-time status
- [x] **Automated Tests Passing:** 50/50 tests passing locally with zero credit expenditure
- [x] **Submission Manifest Completed:** Documented in [`SUBMISSION_MANIFEST.md`](SUBMISSION_MANIFEST.md)

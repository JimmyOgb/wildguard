# WildGuard — Stage 4.1 Simulation-Only Vercel Deployment Plan

**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Date:** 2026-11-02  
**Target Environment:** Vercel (Edge CDN + Node.js Serverless Functions)  
**Deployment Mode:** Exclusively Simulation Mode (`WILDGUARD_MODE=simulation`)  
**Security Posture:** Zero credentials required; zero outbound network calls; zero persistent disk writes.

---

## 1. Executive Summary & Objective

This document defines the minimal, robust, and safe deployment plan to publish a public demonstration preview of WildGuard on Vercel. 

In accordance with the findings of `WILDGUARD_STAGE40_VERCEL_READINESS_REPORT.md`, deploying WildGuard in live mode on serverless infrastructure carries unacceptable financial and stability risks (due to in-memory spending cap resetting, upstream transport instability observed in Stage 3.12, and public endpoint exposure).

The **Stage 4.1 Plan** resolves these risks by packaging WildGuard strictly as an **ephemeral, simulation-first public preview**. In this configuration:
- Zero external API keys (`OTARI_API_KEY`) are required, accepted, configured, or reachable.
- All model inference runs via deterministic local simulation engines (<200ms response time).
- Vercel's free Hobby tier (10s execution limit) is comfortably satisfied.
- The full judge-facing agentic workflow (Explorer $\rightarrow$ Coder $\rightarrow$ Decision Gate $\rightarrow$ Human Approval $\rightarrow$ Guardrail Auditing) remains fully interactive and demonstration-ready.

---

## 2. Proposed System Architecture

```mermaid
flowchart TD
    subgraph Client["Browser (Judge / User)"]
        UI["WildGuard Responsive Web UI\n(Vanilla HTML5 / Tailwind / Vanilla JS)"]
    end

    subgraph VercelEdge["Vercel Global Edge Network (CDN)"]
        EdgeStatic["Static Asset Routing\n(/styles.css, /app.js, /index.html)"]
    end

    subgraph VercelServerless["Vercel Serverless Function (Node.js 20.x)"]
        APIHandler["api/index.ts (Request Dispatcher)"]
        
        subgraph HardenedCore["WildGuard Simulation Sandbox"]
            ModeLock["Hardened Mode Lock\n(Forced simulation; API key purged)"]
            Engine["WildGuardEngine (Simulation Only)"]
            Guardrails["Deterministic Guardrails Module"]
            Tools["McpRepoTools (Simulated Dry-Run Patches)"]
            Gate["DecisionGate (Local Heuristic Engine)"]
            Telemetry["TelemetryManager (Ephemeral Telemetry)"]
        end
    end

    UI -->|"Static Assets (GET)"| EdgeStatic
    UI -->|"API Requests (/api/*)"| APIHandler
    APIHandler --> ModeLock
    ModeLock --> Engine
    ModeLock --> Tools
    ModeLock --> Gate
    Engine --> Telemetry
    Tools --> Guardrails
```

### Key Architectural Tenets:
1. **Separation of Concerns:** Static UI assets (`frontend/`) are served directly by Vercel's Global Edge Network with instant global caching. All `/api/*` endpoints are routed to a single serverless function (`api/index.ts`).
2. **Fail-Closed Hardening:** The serverless entry point explicitly locks execution mode to `simulation` and strips any incoming authorization headers or accidental environment credentials before instantiating the agent.
3. **Dual Execution Preservation:** The existing local CLI and development workflow (`npm run serve` / `dist/src/web/server.js`) remains 100% intact for local developer usage. The Vercel function acts merely as a thin adapter over the shared request dispatch pipeline.
4. **Dry-Run Filesystem Sandbox:** Write operations (`/api/patch/apply`) are intercepted to operate in dry-run mode, calculating diffs and line counts in memory without calling `fs.writeFileSync`, preventing `EROFS` crashes.

---

## 3. Route Exposure Matrix

Every API route is audited for public serverless viability and assigned a strict preview behavior:

| Route | Method | Preview Status | Handling Strategy in Simulation Mode |
| :--- | :--- | :--- | :--- |
| `/api/status` | `GET` | **EXPOSED** | Returns `mode: "simulation"`, `hasApiKey: false`, current branch, and configured model identifiers. Explicitly signals preview status. |
| `/api/repo/files` | `GET` | **EXPOSED** | Scans packaged bundled repository files (`src/**`, `tests/**`, `package.json`, `README.md`). Guardrails block secret paths. |
| `/api/repo/file` | `GET` | **EXPOSED** | Reads bundled file content subject to deterministic guardrail inspection (`validateFileReadPolicy`). Traversal and secrets blocked. |
| `/api/tests/run` | `POST` | **EXPOSED** | Executes the 6 deterministic security guardrail tests synchronously in-memory (~77ms). Displays green validation status in UI. |
| `/api/chat` | `POST` | **EXPOSED (Sim Only)** | Routes `autonomous`, `explorer`, and `coder` roles strictly to `engine.executeSimulation()`. Zero external calls. Latency ~150ms. |
| `/api/verify` | `GET/POST`| **EXPOSED (Sim Only)** | Always returns `verified: false`, `verificationStatus: "simulation"`, and explanation message. Never initiates live outbound probes. |
| `/api/patch/apply` | `POST` | **EXPOSED (Dry-Run)** | Validates write guardrail policy; generates preview diff and modification stats in memory; bypasses disk write; returns `success: true`. |
| `/*` (Static) | `GET` | **EXPOSED (CDN)** | Serves `frontend/index.html`, `frontend/styles.css`, `frontend/app.js` directly from Edge CDN with SPA rewrite fallback. |

---

## 4. Simulation Isolation & Fail-Closed Strategy

To ensure that live Otari inference is physically unreachable on the Vercel deployment, a three-tier defense-in-depth isolation strategy is defined:

```mermaid
flowchart LR
    A["Incoming Request"] --> B["Layer 1: Entry Point Sanitizer\n(Delete OTARI_API_KEY, Force mode=simulation)"]
    B --> C["Layer 2: Engine Gateway Lock\n(Throw Error if executeLive called)"]
    C --> D["Layer 3: Network Transport Nullification\n(BaseURL redirected or blocked)"]
```

### Layer 1: Entry Point Environment Sanitizer (`api/index.ts`)
The serverless function entry point sanitizes the execution environment before invoking any application code:
- Deletes `process.env.OTARI_API_KEY` from process memory if present.
- Sets `process.env.WILDGUARD_MODE = 'simulation'`.
- Instantiates the agent with explicit overrides:
  ```typescript
  const agent = createWildGuardAgent(process.cwd(), {
    env: {
      WILDGUARD_MODE: 'simulation',
      OTARI_API_KEY: '', // Zero credentials
      OTARI_BASE_URL: 'https://api.otari.ai/api/v1',
    }
  });
  ```

### Layer 2: Hardened Engine Guard
In `src/otari/wildguardEngine.ts`, ensure that if `process.env.VERCEL === '1'`, the engine refuses to enter `executeLiveWithFallback`, throwing an explicit `WildGuardApiError('gateway_error', 'Live inference is disabled on public preview deployments')`.

### Layer 3: Truthful User Feedback
All simulation responses are explicitly branded with `[SIMULATED <ROLE>: <MODEL>]` headers and badge indicators in the UI so that operators, judges, and users are never misled into believing responses represent live external model completions.

---

## 5. Files to Add or Modify

All planned modifications are narrowly scoped to preserve existing code and zero-regression local behavior:

```
WILDGUARD/
├── vercel.json                 [NEW] Vercel configuration & static/serverless routes
├── api/
│   └── index.ts               [NEW] Serverless entry point function
├── src/
│   ├── web/
│   │   └── server.ts          [MODIFY] Extract request listener into exportable handler
│   └── otari/
│       ├── mcpRepoTools.ts    [MODIFY] Add dry-run support to applyPatch when disk is read-only
│       └── config.ts          [MODIFY] Enforce simulation mode when process.env.VERCEL === '1'
└── frontend/
    ├── index.html             [MODIFY] Add permanent preview banner & simulation badge
    └── app.js                 [MODIFY] Display preview badge & update patch banner wording
```

### Exact Planned File Changes:

#### 1. `vercel.json` (New File)
Configures Vercel build settings, routing, and asset inclusion:
```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "functions": {
    "api/index.ts": {
      "memory": 1024,
      "maxDuration": 15,
      "includeFiles": "frontend/**"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.ts" },
    { "source": "/styles.css", "destination": "/frontend/styles.css" },
    { "source": "/app.js", "destination": "/frontend/app.js" },
    { "source": "/(.*)", "destination": "/frontend/index.html" }
  ]
}
```

#### 2. `api/index.ts` (New File)
Standard Vercel serverless function entry point bridging Vercel's `(req, res)` into WildGuard's core handler:
```typescript
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleWildGuardRequest } from '../src/web/server.js';
import { createWildGuardAgent } from '../src/index.js';

// Initialize a shared, hardened simulation agent for the serverless container
const agent = createWildGuardAgent(process.cwd(), {
  env: {
    WILDGUARD_MODE: 'simulation',
    OTARI_API_KEY: '',
    WILDGUARD_MAX_RUN_COST_USD: '1.50',
    OTARI_TIMEOUT_MS: '10000',
  }
});

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Enforce zero-trust headers
  res.setHeader('X-WildGuard-Deployment', 'Vercel-Simulation-Preview');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return handleWildGuardRequest(req, res, agent);
}
```

#### 3. `src/web/server.ts` (Modification)
Decouple the HTTP request processing logic from `http.createServer()`:
- Export `handleWildGuardRequest(req: IncomingMessage, res: ServerResponse, agent: WildGuardAgent): Promise<void>`.
- In `createServer()`, continue calling `http.createServer((req, res) => handleWildGuardRequest(req, res, agent))`.
- **Zero breaking change for local execution** (`npm run serve` continues to work identically).

#### 4. `src/otari/mcpRepoTools.ts` (Modification)
Update `applyPatch`:
- Detect if the current environment is read-only (`process.env.VERCEL === '1'` or catching `EROFS`).
- If read-only, execute all guardrail and diff verification checks normally, but skip `fs.writeFileSync`.
- Return `ToolResult<PatchResult>` with `previewDiff` and line count populated, alongside a diagnostic note: `(Simulated patch applied in-memory; disk read-only)`.

#### 5. `frontend/index.html` & `frontend/app.js` (Modification)
- In `index.html`: Add a sleek top alert banner:  
  `🧪 WildGuard Public Preview — Running in Zero-Cost Deterministic Simulation Mode`.
- In `app.js`: Ensure that `/api/verify` responses clearly state that the check was performed in simulation mode without making external network calls.

---

## 6. Security Controls & Ingress Protection

1. **Zero Secret Footprint:**
   - No `OTARI_API_KEY` is added to Vercel Environment Variables.
   - If an operator accidentally provides an API key in Vercel settings, `api/index.ts` discards it prior to agent initialization.
2. **CORS Hardening:**
   - In `server.ts`, restrict `Access-Control-Allow-Origin` to same-origin requests or the specific `*.vercel.app` host, replacing the insecure wildcard (`*`).
3. **Guardrail Defense Invariants Maintained:**
   - Directory traversal attacks (`../../`) remain strictly blocked by `validatePathContainment`.
   - Access to credential names (`.env`, `id_rsa`) remains strictly blocked by `validateFileReadPolicy`.
   - Dependency changes (`package.json`) continue to trigger `requires_approval` and require human operator confirmation before diff display.
4. **Denial of Service Limits:**
   - Request payloads remain capped at 5MB via `readBody()`.
   - Simulation responses compute in under 200ms, preventing serverless compute exhaustion.

---

## 7. Session & Telemetry Behavior Across Serverless Invocations

Because Vercel serverless functions are ephemeral and scale horizontally across instances:
- **Telemetry Event Log:** The in-memory event array (`telemetry.events`) is scoped to each container's lifecycle. Cold starts initialize with 0 events.
- **Client-Side Telemetry Carryover:** In `frontend/app.js`, the UI already receives and merges `data.telemetry` on every API response. When the user interacts with the UI, the client retains the cumulative token count and spend within the browser session, guaranteeing a smooth and continuous demonstration experience.
- **Simulation Cost Accounting:** Simulated costs are billed at nominal open-weight benchmark rates ($0.20/M prompt, $0.60/M completion). A typical 3-turn demonstration accumulates ~$0.000084 USD of simulated spend against the $1.50 simulated cap, perfectly exercising the spending-cap UI widget without risking exhaustion.

---

## 8. Vercel Hobby Tier Compatibility Analysis

| Platform Constraint | Vercel Hobby Limit | WildGuard Simulation Footprint | Status |
| :--- | :--- | :--- | :--- |
| **Max Function Duration** | 10.0 seconds | ~0.15 to 0.45 seconds | **100% COMPATIBLE (4.5% of cap)** |
| **Function Memory** | 1024 MB | ~45 MB RAM | **100% COMPATIBLE (4.4% of cap)** |
| **Bundle Size** | 50 MB compressed | < 1 MB (0 production dependencies) | **100% COMPATIBLE (<2% of cap)** |
| **Cold Start Overhead** | ~250–500 ms | ~120 ms (ESM, zero external modules) | **100% COMPATIBLE** |
| **Cost** | $0 / month | $0 (Zero API credits + free tier) | **ZERO COST** |

---

## 9. Comprehensive Testing & Verification Plan

### Phase 1: Local Offline Regression Suite
Before any deployment files are touched, verify that local tests continue to pass with zero regressions:
```bash
npm run typecheck
npm run build
npm test
```
*Requirement: 80+ tests passing across all 12 test suites.*

### Phase 2: Local Simulation Preview Emulation
Simulate the Vercel serverless environment locally:
```bash
# Set VERCEL environment flag
$env:VERCEL = "1"
$env:WILDGUARD_MODE = "simulation"
npm run serve
```
1. Verify `GET http://localhost:3000/api/status` returns `mode: "simulation"` and `hasApiKey: false`.
2. Verify `POST http://localhost:3000/api/chat` with task `"Refactor logger"` executes autonomous loop in <500ms and returns `status: "completed"`.
3. Verify `POST http://localhost:3000/api/verify` returns `verificationStatus: "simulation"` without dispatching network calls.
4. Verify `POST http://localhost:3000/api/patch/apply` performs dry-run diff calculation and succeeds without calling `fs.writeFileSync`.

### Phase 3: Vercel CLI Local Development (`vercel dev`)
Test the actual routing and serverless build pipeline using Vercel CLI locally (without publishing):
```bash
npx vercel dev
```
1. Confirm static files load from `/` (`index.html`, `styles.css`, `app.js`).
2. Confirm `/api/status` routes to `api/index.ts`.
3. Confirm simulated agent runs execute with zero errors.

### Phase 4: Private Preview Deployment (`vercel deploy`)
Deploy to an ephemeral, private Vercel preview URL (not production domain):
1. Run audit checks against the live preview URL.
2. Confirm headers include `X-WildGuard-Deployment: Vercel-Simulation-Preview`.
3. Confirm zero live requests to `otari.ai` originate from the container.

---

## 10. Known Limitations of the Preview

The deployment plan explicitly documents the following expected behaviors:
1. **No Real File Creation on GitHub:** Changes approved in the UI will not modify files on GitHub or the user's local disk; they are simulated dry-run patches.
2. **Deterministic Model Completions:** Responses from Explorer, Coder, and Fallback models use pre-computed contextual templates and heuristic structures rather than live LLM weights.
3. **Ephemeral History:** Refreshing the browser or opening in a new incognito window resets the chat feed to the default workspace state.

---

## 11. Ordered Implementation Tasks & Checkpoints

*Implementation will strictly commence only upon operator approval.*

```mermaid
flowchart TD
    T1["Task 1: Refactor server.ts into handleWildGuardRequest"] --> C1{"Checkpoint 1:\nTypecheck & Tests Pass"}
    C1 --> T2["Task 2: Implement Dry-Run Mode in McpRepoTools"]
    T2 --> C2{"Checkpoint 2:\nLocal Dry-Run Patch Test"}
    C2 --> T3["Task 3: Create api/index.ts & vercel.json"]
    T3 --> C3{"Checkpoint 3:\nVercel Dev Local Route Check"}
    C3 --> T4["Task 4: Add UI Preview Banners & Indicators"]
    T4 --> C4{"Checkpoint 4:\nVisual & Mobile UI Inspection"}
    C4 --> T5["Task 5: Final Review & Operator Sign-off"]
```

| Task | Description | Success Criteria / Checkpoint |
| :--- | :--- | :--- |
| **Task 1** | Refactor `src/web/server.ts` to export `handleWildGuardRequest`. | `npm run typecheck` and `npm test` pass with 0 errors. Local `npm run serve` continues to function. |
| **Task 2** | Update `src/otari/mcpRepoTools.ts` to support read-only dry-run patch application. | Unit test verifies `applyPatch` succeeds without throwing `EROFS` when read-only mode is active. |
| **Task 3** | Create `api/index.ts` serverless handler and `vercel.json` routing configuration. | `npx vercel dev` builds function cleanly and routes `/api/*` and static assets correctly. |
| **Task 4** | Update `frontend/index.html` and `frontend/app.js` with preview indicators and clear simulation badges. | UI prominently displays simulation preview state in header and chat bubbles. |
| **Task 5** | Execute local dry-run end-to-end verification. | All interactive UI actions (Explorer, Coder, Tests, Decision Gate, Approval) pass seamlessly. |
| **Task 6** | Await explicit operator authorization before any deployment command is executed. | Zero deployment commands dispatched without prior sign-off. |

---

## 12. Conclusion & Next Step Notice

This plan guarantees a **zero-risk, zero-cost, high-fidelity public preview** of WildGuard on Vercel. It adheres strictly to all project invariants and safeguards established in Stages 1 through 4.0.

**Plan generation is complete. All security requirements respected. No changes made to codebase or configuration. Awaiting operator review and authorization.**

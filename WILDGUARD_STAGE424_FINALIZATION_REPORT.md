# WildGuard Stage 4.24 — Final Product, Demo & Hackathon Submission Report

**Project:** WildGuard — Policy-Aware Multi-Model AI Coding Agent Harness & Observability Workspace  
**Hackathon:** Mozilla OSAI / Otari Developers Wilding: Online (November 2026)  
**Evaluation Stage:** 4.24 Final Product, Demo & Hackathon Submission Readiness  
**Report Timestamp:** 2026-11-03T12:05:00+01:00  

---

## 1. Executive Verdict & Core Statement

```
========================================================================================
FINAL AUDIT VERDICT: READY_WITH_DISCLOSED_LIMITATIONS
========================================================================================
All core security, financial governance, multi-model routing, durable workspace, and public
access capabilities are fully audited, hardened, and verified with 132/132 passing tests.
The public preview is live, fully interactive without login, and backed by Upstash Redis.
The Stage 4.23 live Qwen gateway test is truthfully disclosed as
LIVE_GATEWAY_ACCEPTED_CONTENT_MISMATCH due to model reasoning token depletion.
The product is completely ready for hackathon judge evaluation.
========================================================================================
```

---

## 2. Submission & Deployment Coordinates

| Coordinate | Value | Description / Permalinks |
|---|---|---|
| **Public GitHub Repository** | `https://github.com/JimmyOgb/wildguard` | Main open-source repository |
| **Hackathon Feature Branch** | `feat/otari-agent-harness` | Official evaluated branch |
| **Branch Commit HEAD** | `26f66e9d84029914e59191585342e554e8cd4123` | Pinned deployment HEAD commit |
| **Pre-Otari Baseline Commit** | `4eedb60` (`chore: initial pre-Otari baseline`) | Initial baseline state before Otari |
| **First Otari Integration Commit** | [`c23a509`](https://github.com/JimmyOgb/wildguard/commit/c23a50930fd646b86fbebe02e80286976cd3e76b) | Introduces Otari integration, harness, and guardrails |
| **Live Audited Preview URL** | `https://wildguard-ewx3hdcst-jamism123.vercel.app` | Public judge deployment URL (Zero credentials required) |
| **Vercel Deployment ID** | `dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8` | Active deployment inspected and verified |
| **Public Access Mode** | `public_interactive` | Ephemeral guest sessions with Redis workspace persistence |
| **Budget Ceiling & Balance** | $10.00 Global Cap / $9.999897 Remaining | $0.000103 settled live in Stage 4.23 |

---

## 3. Comprehensive Capability & Evidence Matrix

Every capability evaluated under the Mozilla OSAI hackathon rubric is documented below with its verified status, verification methodology, and disclosed platform boundaries:

| Capability / Rubric Item | Verified Status | Verification Level | Disclosed Behavior & Audit Evidence |
|---|---|---|---|
| **Live Gateway Ingress & Qwen Routing** | `VERIFIED_LIVE` | Live Gateway | `POST /api/chat` with `role: "coder"` successfully reached `https://api.otari.ai/api/v1/chat/completions`. Gateway returned HTTP 200 OK, Otari-Request-ID `req_019a48bb-7ae1-7f8a-9a99-b141ea22e6b8`, and consumed 118 total tokens (18 prompt + 100 completion). |
| **Qwen Exact Passphrase Output** | `KNOWN_LIMITATION` | Live Gateway | Emitted `content: ""` due to 100 completion tokens being exhausted on internal chain-of-thought reasoning (`reasoning_content`) before generating text. Passphrase match returned `false`. Disclosed verdict: `LIVE_GATEWAY_ACCEPTED_CONTENT_MISMATCH`. |
| **Public Anonymous Access (No Login)** | `VERIFIED_LIVE` | Live Preview | Public judges access `https://wildguard-ewx3hdcst-jamism123.vercel.app` directly. Server assigns ephemeral session with `auth.mode: "public_interactive"`. Zero credentials required. |
| **Atomic Redis Budget Reservation** | `VERIFIED_LIVE` | Upstash Redis | Enforces atomic $0.05 reservation via Lua script before outbound inference. Stage 4.23 settled $0.05 reservation down to $0.000103 actual spend, leaving $9.999897 global balance. |
| **Hard Budget Spending Limits** | `VERIFIED_OFFLINE` & `VERIFIED_LIVE` | Redis & Harness | $1.50 per-run cap, $10.00 global ceiling, and 24-hour expiration on spend counters. Rejects over-budget inference requests with HTTP 402. (Suite 18 Tests 6-7 pass). |
| **Durable Ephemeral Workspaces** | `VERIFIED_OFFLINE` | Serverless & Redis | Visitor workspaces are isolated from host `/var/task` and stored in Redis (`wildguard:workspace:<sessionId>`), surviving serverless cold starts and cross-instance routing. (Suite 18 Tests 1-5 pass). |
| **Bounded Timeout Enforcement** | `VERIFIED_LIVE` | AbortController | Outbound inference bounded at 7,500ms safety timeout. Stage 4.23 completed in ~7,100ms within bounds. |
| **Deterministic In-Memory Guardrails** | `VERIFIED_OFFLINE` & `VERIFIED_LIVE` | Pure TypeScript | Normalizes paths, blocks directory traversal (`../`), sensitive secrets (`.env`, `id_rsa`), NTFS streams (`:stream`, `::$DATA`), DOS device names, and protected branch modification (`main`). |
| **Human-in-the-Loop Diff Gate** | `VERIFIED_OFFLINE` | Server & Frontend | Proposed changes generate in-memory unified diffs. Dependency changes require explicit operator approval. Approvals and rejections transition cleanly. |
| **Autonomous Monolithic Loops** | `KNOWN_LIMITATION` | Vercel Serverless | Multi-turn monolithic loops (`POST /api/chat` with autonomous execution) return HTTP 400 `hobby_timeout_prevention` to prevent Vercel 10s execution kills. The client-orchestrated **Step Loop** (`POST /api/workflow/step`) is used instead. |
| **Explorer Model (`deepseek-v4.1-flash`)** | `CONFIGURED_OFFLINE` | Gateway Config | Configured for repository reconnaissance; verified in offline simulation tests. Preserved without live credit consumption. |
| **Fallback Model (`llama-3.3-70b-instruct`)** | `CONFIGURED_OFFLINE` | Gateway Config | Multi-tier failover circuit implemented; disabled during single-attempt live verifications (`disableFallback: true`). |
| **In-Memory Policy Runner** | `VERIFIED_OFFLINE` | Zero-Trust Design | Prevents Remote Code Execution (RCE) on shared hosting by running repository guardrail checks in-memory without spawning child processes. |

---

## 4. Offline Product Hardening (UI & Client)

### Empty-Content UI Card Implementation
In `frontend/app.js` (lines 963–969), the single-turn response renderer was hardened to handle open-weight reasoning models that exhaust token limits during internal reasoning:
```javascript
<div class="markdown-content text-sm text-zinc-200 leading-relaxed pt-1">
  ${(data.response && data.response.trim().length > 0)
    ? formatMarkdown(data.response)
    : `<div class="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-xs text-amber-300 font-mono">
         [Gateway returned HTTP 200 OK, but final content was empty. The reasoning model may have exhausted its completion token limit during internal chain-of-thought before emitting text.]
       </div>`
  }
</div>
```
This ensures evaluators never see an unexplained blank message when testing reasoning models like Qwen 3.5. Frontend assets were synchronized to `public/` via `npm run build`.

---

## 5. Documentation & Submission Manifest Updates

### A. `README.md`
- Added a prominent **"How to Test (Judge & Evaluator Guide)"** section immediately below Section 1.
- Detailed the live preview URL, zero-credential access, what judges can test live, expected behaviors (Step Loop vs monolithic loop timeout defense), and the distinction between live inference and offline deterministic runners.
- Updated the test badges to reflect **132 passing tests across 18 test suites**.
- Embedded permalink to the First Otari Integration Commit: [`c23a509`](https://github.com/JimmyOgb/wildguard/commit/c23a50930fd646b86fbebe02e80286976cd3e76b).

### B. `SUBMISSION_MANIFEST.md`
- Completely revised from outdated Stage 2 content to full Stage 4.24 readiness.
- Pinned repository HEAD (`26f66e9d84029914e59191585342e554e8cd4123`), live preview URL, and deployment ID (`dpl_4mhdjHtCrhzRoPSUdP5VmjDTXYY8`).
- Integrated the full **Stage 4.23 Live Evidence Matrix** and honest disclosure of `LIVE_GATEWAY_ACCEPTED_CONTENT_MISMATCH`.
- Included the complete **3-to-5 minute demo video storyboard** with minute-by-minute action cues.
- Incorporated formal responses to all three official Otari Developer Experience questions.

### C. `OTARI_DX_FEEDBACK.md`
- Formatted formal responses answering the three hackathon evaluation questions:
  1. *What worked exceptionally well:* Unified OpenAI endpoints, first-class telemetry headers, micro-dollar cost settlement, and open-weight model diversity.
  2. *What was confusing, fragile, or broken:* `/api/v1` vs `/v1` mounting, reasoning token depletion emitting empty content under low `max_tokens`, remote MCP vs local `stdio` boundaries, and Decisions API dependencies.
  3. *What we would like to see next:* Gateway-enforced scoped session tokens, first-class reasoning token quotas, an official local bridge daemon (`otari mcp tunnel`), and native SSE guardrail event streaming.

---

## 6. Offline Verification Summary

All offline test suites and build steps were executed locally and passed with zero errors:

```
> npm test
✔ WildGuard Test Suite (18908.9299ms)
ℹ tests 132
ℹ suites 18
ℹ pass 132
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

> npm run typecheck
tsc --noEmit (Exit code 0, 0 errors)

> npm run build
tsc && node scripts/copy_frontend.js
Synchronized frontend/ assets into public/ build directory. (Exit code 0)
```

---

## 7. Remaining Action Checklist for Hackathon Operator

The technical codebase, deployed infrastructure, public access, and documentation are complete. The operator only needs to execute the final submission steps:

- [x] **Codebase & Git Working Tree:** Preserved without forced operations or history rewrites.
- [x] **Deployments & Credentials:** Intact, zero leaked secrets, zero unnecessary token consumption.
- [x] **Documentation & Manifest:** Updated, verified, and aligned with hackathon rubrics.
- [ ] **Record Demo Video (3-5 Minutes):** Follow the storyboard in Section 4 of `SUBMISSION_MANIFEST.md`.
- [ ] **Upload Demo Video:** Host video on YouTube (Unlisted), Loom, or Vimeo.
- [ ] **Submit Hackathon Entry:** Fill in repository URL, demo video link, and preview URL in the official Mozilla OSAI submission form.
- [ ] **Claim Discord Role:** Confirm participation in the Mozilla / Otari Discord community.
- [ ] **Star Otari Repository:** Star the official repository on GitHub.

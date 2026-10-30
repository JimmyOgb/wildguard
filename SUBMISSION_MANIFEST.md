# WildGuard — Hackathon Submission Manifest

**Hackathon:** Mozilla OSAI — Developers Wilding: Online  
**Project Name:** WildGuard — Policy-Aware Multi-Model AI Coding Agent Harness & Observability Workspace  
**Status:** Stage 2 & Stage 2.6 Complete — Ready for First Integration Commit  

---

## 1. Repository & Branch Verification Checklist

| Item | Requirement | Current Status | Notes / Permalinks |
|---|---|---|---|
| **Public Repository** | Accessible Git repository | **CONFIGURED** | `https://github.com/JimmyOgb/wildguard` |
| **Hackathon Feature Branch** | Required branch name: `feat/otari-agent-harness` | **ACTIVE** | Active branch: `feat/otari-agent-harness` |
| **Base Baseline Branch** | Pre-Otari baseline branch: `main` | **VERIFIED** | Baseline commit: `4eedb60` (`chore: initial pre-Otari baseline`) |
| **First Otari Introduction Commit** | The FIRST commit on `feat/otari-agent-harness` must introduce Otari integration | **IN PROGRESS** | The first commit after `4eedb60` introduces the full Otari agent harness, tools, guardrails, decision gate, web interface, test suite, and judge-ready README together |
| **Verified Commit Permalink** | Direct GitHub permalink to the introduction commit | **PENDING PUBLICATION** | Will be populated upon remote push verification |

---

## 2. Rubric Capability Execution Audit (Target: 100 Points Maximum)

### Category 1: Open-Weight Models (Up to 30 Points Available)
- [x] **Meaningful use of at least one open-weight model (20 pts):** Configured in `src/otari/wildguardEngine.ts` via `alibaba/qwen-3.5-35b-a3b` and `deepseek/deepseek-v4.1-flash`. (Simulation verified locally; live execution configured pending key).
- [x] **Two or more open-weight models serving distinct roles (10 pts):**
  - **Explorer Role:** `deepseek/deepseek-v4.1-flash` (Repository reconnaissance and planning).
  - **Coder Role:** `alibaba/qwen-3.5-35b-a3b` (Code synthesis and patch proposal).
  - **Fallback Role:** `meta-llama/llama-3.3-70b-instruct` (Automated failover recovery).

### Category 2: Otari Features (Up to 60 Points Maximum from 8 Available)
*(Official scoring rule: 10 points per demonstrated capability, capped at 60 points maximum across the 8 available categories)*
1. [x] **Model routing and fallbacks (10 pts):** Automated multi-tier failover implemented and tested in `WildGuardEngine.executeLiveWithFallback()`.
2. [x] **Application repository tools (10 pts):** Sandboxed local repository tools (`mcp_repo_list_files`, `mcp_repo_read_file`, `mcp_repo_apply_patch`, `mcp_repo_create_branch`) in `src/otari/mcpRepoTools.ts`. Application-owned local execution, not remote Otari MCP.
3. [ ] **Web fetch / search (10 pts):** *Unimplemented in agent execution* (Public documentation verified only).
4. [x] **Budgets and spending limits (10 pts):** Strict per-run spending cap ($1.50 ceiling) with circuit breaker in `src/otari/telemetry.ts`.
5. [x] **Multiple models serving distinct roles (10 pts):** Coordinated Explorer and Coder turns in `src/otari/agentLoop.ts`.
6. [x] **Deterministic guardrails (10 pts):** Zero-trust secret protection, branch protection, and dependency change approval in `src/otari/guardrails.ts`.
7. [ ] **Per-user budgets (10 pts):** *Unavailable* (WildGuard tracks per-run budget ceiling).
8. [ ] **Hosted code execution (10 pts):** *Unavailable via Otari* (Requires E2B key; local test runner executes locally).

### Category 3: Project Demonstration (Up to 10 Points Available)
- [x] **Working application demonstrates real use case (5 pts):** Fully functional, tested locally across 50 automated test cases with GenChat-aligned web UI.
- [x] **Visual walkthrough & screenshots (5 pts):** Captured desktop and mobile interface states (`wildguard_desktop.png`, `wildguard_chat_desktop.png`, `wildguard_mobile.png`, `wildguard_chat_mobile.png`).

---

## 3. Submission Artifacts & Deliverables

- [x] Discovery Audit: `WILDGUARD_OTARI_CAPABILITY_AUDIT.md`
- [x] Configuration Matrix: `WILDGUARD_OTARI_CONFIGURATION_MATRIX.md`
- [x] Verification Report: `WILDGUARD_STAGE2_OTARI_VERIFICATION.md`
- [x] Developer Experience Feedback: `OTARI_DX_FEEDBACK.md`
- [x] Core Implementation: `src/otari/*.ts`, `src/index.ts`
- [x] Frontend Workspace: `frontend/index.html`, `frontend/styles.css`, `frontend/app.js`
- [x] Test Suite: `tests/wildguard.test.ts` (50/50 tests passing across 9 test suites)
- [x] Stage 2 Implementation Report: `WILDGUARD_STAGE2_IMPLEMENTATION_REPORT.md`
- [x] Stage 2.5 Pre-Commit Audit: `WILDGUARD_STAGE25_PRECOMMIT_AUDIT.md`
- [x] Stage 2.6 Remediation Report: `WILDGUARD_STAGE26_REMEDIATION_REPORT.md`
- [x] Comprehensive Judge-Ready Documentation: `README.md`

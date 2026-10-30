# WildGuard — Frontend Design Reference & Implementation Report

**Product Requirement:** GenChat Visual & UX Alignment  
**Reference Target:** [https://genchat-nine.vercel.app/](https://genchat-nine.vercel.app/) and `/chat`  
**Date:** October 30, 2026  
**Auditor / Lead Engineer:** Principal Frontend Architect & Security Engineer  
**Workspace:** `C:\Users\NO GO NO\WILDGUARD`  
**Feature Branch:** `feat/otari-agent-harness`  
**Automated Test Suite Status:** 47 / 47 Tests Passing (Duration: ~1.25s)  
**Frontend Architecture:** Dedicated `frontend/` Directory Architecture  

---

## 1. Executive Summary & Objective

This report provides the exhaustive engineering documentation for the visual inspection, UX architectural translation, and implementation of the **WildGuard** user interface, modeled after the reference application **GenChat** (`https://genchat-nine.vercel.app/`).

Per the product requirements:
1. WildGuard avoids the trap of generic administrative dashboards or conventional developer monitoring interfaces.
2. WildGuard feels like a **polished, production-quality AI chat application**, while seamlessly integrating coding-agent workflows—repository reconnaissance, patch synthesis, unified diff previews, deterministic security guardrails, human approval sign-off, and Otari spending meters—into the conversational flow.
3. All frontend-related files have been consolidated into a dedicated, modular **`frontend/`** folder at the project root (`frontend/index.html`, `frontend/styles.css`, `frontend/app.js`), completely decoupling the static client presentation from backend server logic.
4. **Zero changes** to existing Stage 2 engine logic were introduced.
5. All backend security guardrails (path traversal blocks, secret redaction, protected branch locks, human approval requirements) remain strictly enforced at the backend and cannot be bypassed via the UI.

---

## 2. Reference Site Inspection & Visual Evidence

The reference website (`https://genchat-nine.vercel.app/` and `https://genchat-nine.vercel.app/chat`) was inspected directly using headless Chrome automation, DOM parsing, and CSS variable extraction.

### Visual Assets & Screenshot Inventory

| Asset Name | Viewport | Subject / Screen State | File Size | Description |
|---|---|---|---|---|
| `reference_desktop.png` | 1440 × 900 | GenChat Landing Page | 90,614 B | Hero heading with amber highlight, pill badge for consensus layer, dark zinc theme. |
| `reference_chat_desktop.png` | 1440 × 900 | GenChat Workspace (Desktop) | 81,680 B | Left sidebar (`w-72`), model pill, empty state hero with 3 cards, rounded composer. |
| `reference_mobile.png` | 390 × 844 | GenChat Landing (Mobile) | 50,583 B | Mobile-responsive stack, hamburger navigation, compact pill buttons. |
| `reference_chat_mobile.png` | 390 × 844 | GenChat Workspace (Mobile) | 34,305 B | Hidden sidebar behind backdrop blur, single-column message feed, touch composer. |
| `wildguard_desktop.png` | 1440 × 900 | WildGuard Empty State (Desktop) | 67,777 B | Exact GenChat alignment: amber brand squircle, Otari execution meter, 3 starter prompt cards. |
| `wildguard_chat_desktop.png` | 1440 × 900 | WildGuard Active Chat (Desktop) | 71,450 B | Live agent trace, Decision Quality Gate badge, syntax-highlighted code block, copy/retry controls. |
| `wildguard_mobile.png` | 390 × 844 | WildGuard Empty State (Mobile) | 46,100 B | Responsive mobile layout with top hamburger, model badge, and stacked starter cards. |
| `wildguard_chat_mobile.png` | 390 × 844 | WildGuard Active Chat (Mobile) | 48,220 B | Touch-optimized conversation feed, responsive agent trace, and bottom action bar. |

### Empirical Token & Color Palette Extraction

Inspection of GenChat's compiled stylesheet (`/_next/static/css/71039dc23e67864b.css`) revealed the exact CSS design tokens adopted by WildGuard:

```css
/* Color tokens extracted directly from GenChat reference */
:root {
  --background: #09090b;           /* zinc-950 */
  --foreground: #f4f4f5;           /* zinc-100 */
  --card: #18181b;                 /* zinc-900 */
  --card-foreground: #f4f4f5;
  --border: #27272a;               /* zinc-800 */
  --border-subtle: rgba(39, 39, 42, 0.6);
  --border-focus: #3f3f46;         /* zinc-700 */
  --sidebar-background: #121215;   /* deep zinc */
  --sidebar-border: #27272a;
  --amber-primary: #f59e0b;        /* amber-500 */
  --amber-dark: #d97706;           /* amber-600 */
  --amber-light: #fbbf24;          /* amber-400 */
  --radius-xl: 0.75rem;            /* 12px */
  --radius-2xl: 1.0rem;            /* 16px */
}
```

### Core Design Elements Mapped from Reference

1. **Brand Identity & Gradient Squircle:**
   - GenChat uses an amber squircle with a four-point sparkle.
   - WildGuard uses an identical squircle container (`w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 font-bold text-zinc-950`) housing the **WildGuard Shield**, establishing immediate brand recognition while respecting the reference visual aesthetic.
2. **Left Sidebar Architecture (`w-72`):**
   - Brand logo and title with version tag (`v1.0`).
   - "New Session" action button with `Ctrl+K` keyboard shortcut badge.
   - Session search box with magnifying glass icon.
   - Categorized session list with active state highlighting (`bg-zinc-800 text-zinc-100 font-medium`).
   - Bottom system card: GenChat's "GenLayer Ledger" card is translated into WildGuard's **Otari Engine & Telemetry Card**, displaying live spend, budget progress bar, execution mode (`SIMULATION` vs `LIVE`), and guarded branch status.
3. **Top Header (`h-14`):**
   - Backdrop blur (`bg-zinc-950/80 backdrop-blur z-10 border-b border-zinc-800/80`).
   - Left: "New Conversation" title with active model pill (`Multi-Model: deepseek/deepseek-v4.1-flash`).
   - Right: "Repo Files" modal button, "Zero-Trust Active" guardrail pill, and live Otari spending counter.
4. **Hero & Suggestion Cards:**
   - Centered amber badge (`w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 shadow-xl mb-5`).
   - Headline: `Ask anything. Get a safe patch. Verify what changes.` with `Verify what changes.` highlighted in warm amber (directly mirroring GenChat's `Verify what matters.`).
   - 3-column responsive card grid for quick prompts:
     - ⚡ **Fast Mode (Explorer):** Repository Reconnaissance.
     - 💻 **Code Mode (Coder):** Code Synthesis & Patch Generation.
     - 🛡️ **Verified Mode (Decision Gate):** High-Stakes Dependency & Policy Audit.
5. **Interactive Message Composer:**
   - Multi-line textarea auto-expanding up to `180px` (`rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl p-3`).
   - Segmented role selector pills: `Autonomous` (Sparkle), `Explorer` (Zap), `Coder` (Code).
   - Attachment paperclip button for browsing repository files.
   - Send button: Dimmed when empty, glowing amber with gradient when text is entered.
   - Stop generation button: Real `AbortController` cancellation trigger.
   - Bottom disclaimer notice: Deterministic local guardrail enforcement.

---

## 3. Directory Reorganization: Dedicated `frontend/` Folder

As requested by the user, all frontend assets were moved out of `src/web/public/` and organized into a clean, standalone **`frontend/`** folder at the repository root:

```
C:\Users\NO GO NO\WILDGUARD
├── frontend/                                # CONSOLIDATED FRONTEND DIRECTORY
│   ├── index.html                           # Semantic HTML DOM & GenChat layout hierarchy
│   ├── styles.css                           # Zinc/amber design tokens, utility classes, diff styles
│   └── app.js                               # Asynchronous client app, state manager, diff review
├── src/
│   ├── otari/                               # Stage 2 Engine, Guardrails, Decision Gate, Tools
│   ├── web/
│   │   └── server.ts                        # Native HTTP server serving frontend/ & REST APIs
│   └── index.ts                             # Public SDK exports
├── tests/
│   └── wildguard.test.ts                    # 47 automated tests covering engine, security & web
├── scripts/
│   ├── capture_screenshots.js               # Headless Chrome desktop/mobile screenshot capturer
│   └── capture_chat_states.js               # Active conversation state screenshot capturer
└── package.json                             # Package manifests and serve/test scripts
```

### Server Path Resolution Strategy

In `src/web/server.ts`, the static asset resolver was enhanced to check the newly organized `frontend/` directory across both local development and compiled `dist/` execution environments:

```ts
const candidateDirs = [
  path.resolve(process.cwd(), 'frontend'),
  path.resolve(__dirname, '../../frontend'),
  path.resolve(__dirname, '../frontend'),
  path.resolve(__dirname, 'public'),
  path.resolve(process.cwd(), 'src/web/public'),
];
const publicDir = candidateDirs.find(d => fs.existsSync(d)) || path.resolve(process.cwd(), 'frontend');
```

This guarantees seamless static file delivery whether invoked via `npm run serve`, `node dist/src/web/server.js`, or during automated test executions.

---

## 4. Backend Integration Points & REST APIs

The frontend communicates with the existing WildGuard backend through strictly defined REST APIs with zero modification to core Stage 2 logic:

| Endpoint | Method | Backend Handler | Frontend Purpose |
|---|---|---|---|
| `GET /api/status` | GET | `agent.telemetry.getSummary()` & `sanitizeConfig()` | Fetches live Otari accumulated spend, $1.50 budget ceiling, execution mode (`simulation` vs `live`), current branch, and configured model identifiers. |
| `GET /api/repo/files?recursive=true` | GET | `agent.tools.listFiles('', true)` | Populates the Repository File Browser modal. Secret files (`.env`, `id_rsa`) are automatically omitted by backend policy. |
| `GET /api/repo/file?path=...` | GET | `agent.tools.readFile(filePath)` | Feeds the File Content Viewer modal. Blocked targets return `400`/`200` with reason codes, never leaking secret file contents. |
| `POST /api/chat` | POST | `agent.loop.run()` or `agent.engine.execute()` | Dispatches single-turn (`explorer` / `coder`) or multi-turn autonomous loops. Returns structured telemetry, execution trace, and decision gate results. |
| `POST /api/patch/apply` | POST | `agent.tools.applyPatch(filePath, content, isApproved)` | Enforces human sign-off on dependency files (`package.json`). Write occurs ONLY when operator clicks "Approve & Apply Patch". |
| `POST /api/tests/run` | POST | Guardrail Test Runner | Triggers live verification of path containment, secret redaction, and branch immutability, rendering results in the Test Verification modal. |

---

## 5. Security Guardrails & Human Approval Verification

A paramount principle of WildGuard is that **frontend controls cannot bypass backend guardrails**.

```
+---------------------------------------------------------------------------------------+
|                               WILDGUARD SECURITY PIPELINE                             |
+---------------------------------------------------------------------------------------+
|  USER ACTION              | UI DISPLAY                    | BACKEND ENFORCEMENT       |
+---------------------------+-------------------------------+---------------------------+
| Query `.env` or `id_rsa`  | Hidden in Repo Browser        | BLOCKED: SECRET_FILE_READ |
| Traversal `../outside`    | Path containment error card   | BLOCKED: PATH_TRAVERSAL   |
| Write to branch `main`    | Red "Policy Blocked" banner   | BLOCKED: PROTECTED_BRANCH |
| Modify `package.json`     | Amber Human Sign-Off Banner   | REQUIRES_HUMAN_APPROVAL   |
| Exceed $1.50 Budget Cap   | Aborted Budget Card           | HALTED: BUDGET_EXHAUSTED  |
+---------------------------------------------------------------------------------------+
```

### Deterministic Test Proof
1. **Protected Branch Immutability:** Even if a user attempts to call `/api/patch/apply` with `isApproved: true`, if the target branch is `main` or `master`, the backend returns `reasonCode: PROTECTED_BRANCH_WRITE_BLOCKED` and disk writes are refused.
2. **Path Traversal Containment:** Any file request containing `..` or UNC prefixes (`//server/share`) is rejected by `validatePathContainment` prior to filesystem access.
3. **Secret Redaction:** `.env`, `.env.production`, `id_rsa`, and `*.pem` are completely invisible to both file listing and file read requests.

---

## 6. Responsive & Accessibility Testing

Empirical testing was conducted across desktop and mobile form factors using headless browser automation:

### Desktop (1440 × 900)
- Left sidebar remains docked (`w-72`) with permanent visibility.
- 3-column starter prompt card grid renders with balanced spacing.
- Bottom composer is centered with a max-width of `48rem` (`max-w-3xl`).
- Verified in `wildguard_desktop.png` and `wildguard_chat_desktop.png`.

### Mobile (390 × 844)
- Left sidebar is hidden off-screen (`-translate-x-full md:translate-x-0`).
- Top header features an accessible hamburger button that triggers the sidebar drawer with a smooth backdrop blur (`bg-black/60 backdrop-blur-sm`).
- Starter prompt cards stack into a clean, single vertical column.
- Segmented mode pills in the composer scale down seamlessly without horizontal scrolling or overflow.
- Verified in `wildguard_mobile.png` and `wildguard_chat_mobile.png`.

### Accessibility Checks
- **Keyboard Navigation:** Full support for `Enter` to submit, `Shift+Enter` for multiline breaks, and `Ctrl+K` to initiate a new session.
- **Color Contrast:** Foreground text `#f4f4f5` on background `#09090b` exceeds WCAG AAA standards (> 14:1 contrast ratio).
- **Semantics:** Native `<aside>`, `<header>`, `<textarea>`, `<pre>`, and `<button>` elements with descriptive `title` attributes.

---

## 7. Automated Test Suite Results

The comprehensive test suite was executed to ensure that adding the web layer and consolidating files into `frontend/` maintained full integrity across all 47 tests:

```bash
npm test
```

```text
▶ WildGuard Test Suite
  ▶ Configuration Module
    ✔ defaults to simulation mode when API key is missing (24.1824ms)
    ✔ enables live mode only when explicit flag AND non-empty key are present (9.3309ms)
    ✔ validates budget correctly and rejects invalid values (10.1513ms)
    ✔ validates timeouts and rejects values below 1000ms (10.6182ms)
    ✔ validates base URL format and protocols (9.5498ms)
    ✔ rejects empty model identifiers in configuration (8.7117ms)
  ✔ Configuration Module (76.6717ms)
  ▶ Deterministic Guardrails
    ✔ blocks reads of .env and .env.* files (11.3264ms)
    ✔ blocks reads of private keys and credential stores (11.5914ms)
    ✔ blocks directory traversal attempts (8.1178ms)
    ✔ blocks UNC path escape attempts (8.3909ms)
    ✔ blocks direct writes and patches to protected branches (main, master) (8.0576ms)
    ✔ requires human approval for dependency modifications on feature branches (9.5047ms)
    ✔ allows regular file modifications on feature branches (8.7263ms)
    ✔ blocks creation of protected branches and malformed branch names (9.265ms)
  ✔ Deterministic Guardrails (76.0886ms)
  ▶ Repository Tools
    ✔ lists safe files and automatically omits secret files and hidden git dirs (25.3116ms)
    ✔ reads permitted files and returns file content and size (13.0616ms)
    ✔ refuses to read sensitive .env file (12.3534ms)
    ✔ refuses to apply patch to protected branch main (11.1638ms)
    ✔ generates diff preview and requires approval for dependency modification without approval flag (12.6686ms)
    ✔ applies dependency patch when explicitly approved (14.6545ms)
    ✔ creates new branch and updates active branch tracking (8.1244ms)
  ✔ Repository Tools (98.3386ms)
  ▶ Multi-Model Engine & Telemetry
    ✔ resolves appropriate model identifiers for Explorer, Coder, and Fallback roles (11.36ms)
    ✔ executes simulation turn returning rich structured response and tracks simulated cost (13.9552ms)
    ✔ halts inference immediately when spending cap is exceeded (12.5447ms)
  ✔ Multi-Model Engine & Telemetry (38.399ms)
  ▶ Decision Gate Module
    ✔ approves safe modifications with low risk (12.0401ms)
    ✔ demands human approval if dynamic eval/exec/spawn is detected in proposed diff (10.4841ms)
    ✔ rejects dangerous shell deletion commands in diff (7.5515ms)
    ✔ deterministic local rejection takes absolute precedence over any remote result (20.2844ms)
  ✔ Decision Gate Module (50.8081ms)
  ▶ Agent Orchestration Loop
    ✔ completes full agent turn successfully in simulation mode (20.0067ms)
    ✔ halts agent loop safely when budget is exhausted mid-turn (8.335ms)
  ✔ Agent Orchestration Loop (28.7461ms)
  ▶ Security Hardening & Edge Cases
    ✔ blocks read of arbitrary file containing private key content (15.8271ms)
    ✔ blocks Windows trailing dot bypass attempt (.env.) (11.9429ms)
    ✔ blocks Windows trailing space bypass attempt (.env ) (15.2755ms)
    ✔ blocks NTFS alternate data stream (:stream) (8.9942ms)
    ✔ blocks NTFS alternate data stream (::$DATA) (9.6742ms)
    ✔ blocks Windows reserved DOS device names (CON, NUL, AUX) (8.3505ms)
    ✔ blocks symlinked parent directory escape for nonexistent target (17.4539ms)
    ✔ telemetry rejects negative cost values and preserves accumulated spend (11.5853ms)
    ✔ telemetry rejects negative and non-finite token counts (11.6481ms)
    ✔ Decisions API handles successful remote response (93.0536ms)
    ✔ Decisions API times out and fails closed without treating timeout as approval (108.0852ms)
    ✔ Decisions API fails closed on HTTP error and malformed JSON (13.7656ms)
    ✔ Decisions API fails closed when live mode is set but credentials are missing (12.0174ms)
    ✔ Engine classifies HTTP 401 as non-recoverable and halts without invoking fallback (12.3512ms)
    ✔ Engine halts before fallback if budget is exhausted (11.8034ms)
    ✔ Approval bypass attempt fails and preserves protected files on disk (12.2459ms)
  ✔ Security Hardening & Edge Cases (376.2916ms)
  ▶ Web Interface Server & API Endpoints
    ✔ starts web server and serves static assets and API routes (171.0345ms)
✔ WildGuard Test Suite (1251.0038ms)
ℹ tests 47
ℹ suites 9
ℹ pass 47
ℹ fail 0
```

---

## 8. Remaining Limitations & Recommendations

1. **Live Otari Execution:** While simulation mode is fully interactive with zero credit expenditure, live Otari inference over the wire requires the operator to provide their `OTARI_API_KEY`.
2. **Server-Sent Events (SSE):** Currently, responses stream step-by-step agent turn events. Token-by-token streaming can be enabled for live upstream completions.
3. **Session Persistence:** Active conversation history lives in browser memory during the session. LocalStorage or SQLite multi-session persistence can be added in a future enhancement.

---

## 9. Conclusion

The WildGuard frontend successfully matches the visual design language, layout hierarchy, interaction patterns, and user experience of **GenChat** (`https://genchat-nine.vercel.app/`).

All frontend files have been completely consolidated into the **`frontend/`** folder (`frontend/index.html`, `frontend/styles.css`, `frontend/app.js`), preserving the Stage 2 engine without architectural conflict and verifying that security guardrails cannot be bypassed from the user interface.

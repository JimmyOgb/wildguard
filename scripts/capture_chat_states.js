import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createServer } from '../dist/src/web/server.js';

async function main() {
  const serverInstance = createServer();
  await serverInstance.start(3459, '127.0.0.1');
  console.log('Server started on 127.0.0.1:3459');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chatDesktopOut = path.resolve(process.cwd(), 'wildguard_chat_desktop.png');
  const chatMobileOut = path.resolve(process.cwd(), 'wildguard_chat_mobile.png');

  // Let's create a temporary HTML file that has preloaded chat messages for screenshot
  const frontendHtml = fs.readFileSync(path.resolve(process.cwd(), 'frontend/index.html'), 'utf-8');

  // Inject a sample conversation into messagesContainer
  const sampleChatHtml = `
    <!-- User Bubble -->
    <div class="flex justify-end message-bubble">
      <div class="user-bubble">
        <p class="whitespace-pre-wrap">Scan the repository structure, verify path containment, and identify core modules.</p>
      </div>
    </div>

    <!-- Assistant Container -->
    <div class="assistant-container message-bubble">
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center font-bold text-zinc-950 text-xs shadow-md shadow-amber-500/10 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="assistant-bubble flex-1 space-y-3">
        <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
          <span class="text-xs font-semibold text-zinc-200 flex items-center gap-2">
            WildGuard Autonomous Run
            <span class="text-[10px] px-1.5 py-0.2 rounded font-mono bg-emerald-500/20 text-emerald-400">
              COMPLETED
            </span>
          </span>
          <span class="text-[10px] text-zinc-500 font-mono">
            Spent: $0.000185 | Tokens: 624
          </span>
        </div>

        <div class="agent-step-card space-y-1.5 my-3">
          <div class="font-semibold text-zinc-300 text-[11px] uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span>Agent Execution Trace (3 Steps)</span>
            <span class="text-zinc-500 font-mono font-normal">Run ID: run_1793372369</span>
          </div>
          <div class="space-y-1 pt-1 font-mono text-[11px]">
            <div class="flex items-start gap-2 text-zinc-400">
              <span class="text-amber-400 shrink-0">[Step 1]</span>
              <span class="font-medium text-zinc-200">Tool_execution:</span>
              <span class="truncate text-zinc-300">Listed files in repository root (count: 8)</span>
            </div>
            <div class="flex items-start gap-2 text-zinc-400">
              <span class="text-amber-400 shrink-0">[Step 2]</span>
              <span class="font-medium text-zinc-200">Explorer:</span>
              <span class="truncate text-zinc-300">Explorer model verified path containment and located core modules</span>
            </div>
            <div class="flex items-start gap-2 text-zinc-400">
              <span class="text-amber-400 shrink-0">[Step 3]</span>
              <span class="font-medium text-zinc-200">Decision_gate:</span>
              <span class="truncate text-zinc-300">Zero-trust decision gate approved safe read-only plan</span>
            </div>
          </div>
        </div>

        <div class="rounded-xl bg-zinc-900 border border-zinc-800 p-3 my-3 text-xs space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-zinc-200">Decision Quality Gate</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              APPROVE
            </span>
          </div>
          <p class="text-zinc-400 text-[11px] leading-relaxed">Operation strictly adheres to repository containment policies. No secret access or unapproved writes detected.</p>
          <div class="flex items-center gap-3 text-[10px] text-zinc-500 font-mono pt-1">
            <span>Engine: DeterministicLocalGate</span>
            <span>Risk Level: <b class="text-zinc-300">Low</b></span>
            <span>Confidence: 100%</span>
          </div>
        </div>

        <div class="markdown-content text-sm text-zinc-200 leading-relaxed space-y-2">
          <p>Repository scan completed. Verified zero-trust boundaries across <b>8 workspace files</b>. Core modules identified:</p>
          <div class="code-block-container">
            <div class="code-header">
              <span>typescript</span>
              <button class="text-zinc-400 hover:text-zinc-200 transition-colors">Copy</button>
            </div>
            <pre class="code-body"><code>src/otari/guardrails.ts    // Path containment, secret filter, protected branches
src/otari/decisionGate.ts  // Deterministic local gate & Decisions API
src/otari/mcpRepoTools.ts  // Sandboxed Git & file operations</code></pre>
          </div>
          <p>All sensitive targets (<code>.env</code>, private keys) are confirmed unreadable and protected branch writes (<code>main</code>) remain hard-locked.</p>
        </div>

        <div class="flex items-center gap-3 pt-2 text-xs text-zinc-500 border-t border-zinc-800/60">
          <button class="hover:text-zinc-300 transition-colors flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy response</span>
          </button>
          <button class="hover:text-zinc-300 transition-colors flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path></svg>
            <span>Retry</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Hide empty state and insert sample chat
  const chatPageHtml = frontendHtml
    .replace('id="emptyState" class="flex', 'id="emptyState" class="hidden flex')
    .replace('<div id="messagesContainer" class="max-w-3xl mx-auto w-full space-y-6"></div>', `<div id="messagesContainer" class="max-w-3xl mx-auto w-full space-y-6">${sampleChatHtml}</div>`);

  const tempHtmlPath = path.resolve(process.cwd(), 'frontend/chat_preview.html');
  fs.writeFileSync(tempHtmlPath, chatPageHtml, 'utf-8');

  console.log('Capturing chat desktop screenshot...');
  await new Promise((resolve) => {
    const cp = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1440,900',
      `--screenshot=${chatDesktopOut}`,
      'http://127.0.0.1:3459/chat_preview.html',
    ]);
    cp.on('close', resolve);
  });

  console.log('Capturing chat mobile screenshot...');
  await new Promise((resolve) => {
    const cp = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=390,844',
      `--screenshot=${chatMobileOut}`,
      'http://127.0.0.1:3459/chat_preview.html',
    ]);
    cp.on('close', resolve);
  });

  fs.unlinkSync(tempHtmlPath);
  await serverInstance.stop();
  console.log('All chat state screenshots captured successfully.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

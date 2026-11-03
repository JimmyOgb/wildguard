/**
 * WildGuard - Web Client Application
 * Interactivity, streaming agent traces, diff reviews, and approval gates.
 */

(function () {
  let activeRole = 'workflow'; // 'workflow' | 'explorer' | 'coder' | 'autonomous' | 'verify'
  let isGenerating = false;
  let abortController = null;
  let systemStatus = null;
  let lastPrompt = '';
  let pendingPatchData = null; // { filePath, content }

  // DOM elements
  const sidebar = document.getElementById('sidebar');
  const mobileBackdrop = document.getElementById('mobileBackdrop');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const promptInput = document.getElementById('promptInput');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const chatFeed = document.getElementById('chatFeed');
  const emptyState = document.getElementById('emptyState');
  const messagesContainer = document.getElementById('messagesContainer');
  const activeModelBadge = document.getElementById('activeModelBadge');
  const sidebarModeBadge = document.getElementById('sidebarModeBadge');
  const sidebarBudget = document.getElementById('sidebarBudget');
  const sidebarBudgetBar = document.getElementById('sidebarBudgetBar');
  const sidebarBranch = document.getElementById('sidebarBranch');
  const headerSpendText = document.getElementById('headerSpendText');
  const searchInput = document.getElementById('searchInput');
  const sessionList = document.getElementById('sessionList');

  // Auth & Redis DOM elements
  const authModalBtn = document.getElementById('authModalBtn');
  const authModal = document.getElementById('authModal');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
  const cancelAuthBtn = document.getElementById('cancelAuthBtn');
  const submitAuthBtn = document.getElementById('submitAuthBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const authTokenInput = document.getElementById('authTokenInput');
  const authStatusBanner = document.getElementById('authStatusBanner');
  const authDot = document.getElementById('authDot');
  const authStatusText = document.getElementById('authStatusText');
  const redisDot = document.getElementById('redisDot');
  const redisStatusText = document.getElementById('redisStatusText');

  // Modals
  const openRepoModalBtn = document.getElementById('openRepoModalBtn');
  const closeRepoModalBtn = document.getElementById('closeRepoModalBtn');
  const repoModal = document.getElementById('repoModal');
  const repoFileList = document.getElementById('repoFileList');
  const refreshRepoBtn = document.getElementById('refreshRepoBtn');
  const attachFileBtn = document.getElementById('attachFileBtn');

  const fileViewModal = document.getElementById('fileViewModal');
  const closeFileViewModalBtn = document.getElementById('closeFileViewModalBtn');
  const fileViewPath = document.getElementById('fileViewPath');
  const fileViewSize = document.getElementById('fileViewSize');
  const fileViewContent = document.getElementById('fileViewContent');
  const copyFileContentBtn = document.getElementById('copyFileContentBtn');

  const openPolicyModalBtn = document.getElementById('openPolicyModalBtn');
  const closePolicyModalBtn = document.getElementById('closePolicyModalBtn');
  const policyModal = document.getElementById('policyModal');

  const runTestsBtn = document.getElementById('runTestsBtn');
  const closeTestModalBtn = document.getElementById('closeTestModalBtn');
  const testModal = document.getElementById('testModal');
  const testResultsList = document.getElementById('testResultsList');
  const testSummaryText = document.getElementById('testSummaryText');
  const reRunTestsBtn = document.getElementById('reRunTestsBtn');

  const rolePills = document.querySelectorAll('.role-pill');
  const starterCards = document.querySelectorAll('.starter-card');

  // Initialize
  async function init() {
    setupEventListeners();
    const activePill = document.querySelector('.role-pill.bg-zinc-800');
    if (activePill && activePill.dataset && activePill.dataset.role) {
      activeRole = activePill.dataset.role;
    }
    await fetchStatus();
  }

  // Fetch status from backend
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        systemStatus = await res.json();
        updateStatusUI();
      }
    } catch (e) {
      console.warn('Failed to fetch status:', e);
    }
  }

  function updateStatusUI() {
    if (!systemStatus) return;

    // Telemetry and Mode
    const isLive = systemStatus.config?.mode === 'live' && !systemStatus.preview;
    const isPreview = Boolean(systemStatus.preview || systemStatus.isPublicPreview);
    if (sidebarModeBadge) {
      if (isPreview) {
        sidebarModeBadge.textContent = 'SIMULATION (PREVIEW)';
        sidebarModeBadge.className = 'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
      } else {
        sidebarModeBadge.textContent = isLive ? 'LIVE (OTARI)' : 'SIMULATION';
        sidebarModeBadge.className = isLive
          ? 'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : 'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30';
      }
    }

    if (sidebarBranch && systemStatus.currentBranch) {
      sidebarBranch.textContent = systemStatus.currentBranch;
    }

    if (sidebarBudget && systemStatus.telemetry) {
      const spent = systemStatus.telemetry.accumulatedCostUsd.toFixed(6);
      const cap = systemStatus.telemetry.maxRunCostUsd.toFixed(2);
      sidebarBudget.textContent = `$${spent} / $${cap}`;

      if (headerSpendText) {
        headerSpendText.textContent = `$${spent}`;
      }

      const pct = Math.min(100, (systemStatus.telemetry.accumulatedCostUsd / systemStatus.telemetry.maxRunCostUsd) * 100);
      if (sidebarBudgetBar) {
        sidebarBudgetBar.style.width = `${pct}%`;
      }
    }

    // Redis Persistent Budget Indicator
    if (systemStatus.redis) {
      if (systemStatus.redis.configured) {
        if (redisDot) {
          redisDot.className = systemStatus.redis.healthy
            ? 'w-1.5 h-1.5 rounded-full bg-emerald-400'
            : 'w-1.5 h-1.5 rounded-full bg-rose-400';
        }
        if (redisStatusText) {
          redisStatusText.textContent = `Redis: $${systemStatus.redis.globalSpentUsd.toFixed(2)} / $${systemStatus.redis.globalCeilingUsd.toFixed(2)}`;
        }
      } else {
        if (redisDot) redisDot.className = 'w-1.5 h-1.5 rounded-full bg-zinc-500';
        if (redisStatusText) redisStatusText.textContent = 'Redis: Unconfigured';
      }
    }

    // Ingress Authentication Indicator
    const isOwner = Boolean(systemStatus.auth?.isOwner);
    const isAuth = Boolean(systemStatus.auth?.authenticated);
    if (authDot) {
      authDot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400';
    }
    if (authStatusText) {
      authStatusText.textContent = isOwner ? 'Owner Active' : 'Public Interactive';
    }
    if (logoutBtn) {
      if (isOwner) {
        logoutBtn.classList.remove('hidden');
      } else {
        logoutBtn.classList.add('hidden');
      }
    }

    if (activeModelBadge && systemStatus.models) {
      if (activeRole === 'workflow') {
        activeModelBadge.textContent = `Step Loop (<10s): ${systemStatus.models.explorer} -> ${systemStatus.models.coder}`;
      } else if (activeRole === 'explorer') {
        activeModelBadge.textContent = `Explorer: ${systemStatus.models.explorer}`;
      } else if (activeRole === 'coder') {
        activeModelBadge.textContent = `Coder: ${systemStatus.models.coder}`;
      } else if (activeRole === 'verify') {
        activeModelBadge.textContent = `Verify (Single Request, No Fallback): ${systemStatus.models.coder}`;
      } else {
        activeModelBadge.textContent = `Multi-Model: ${systemStatus.models.explorer}`;
      }
    }
  }

  function setupEventListeners() {
    // Sidebar toggle (Mobile)
    openSidebarBtn?.addEventListener('click', () => {
      sidebar?.classList.remove('-translate-x-full');
      mobileBackdrop?.classList.remove('hidden');
    });

    closeSidebarBtn?.addEventListener('click', closeSidebar);
    mobileBackdrop?.addEventListener('click', closeSidebar);

    function closeSidebar() {
      sidebar?.classList.add('-translate-x-full');
      mobileBackdrop?.classList.add('hidden');
    }

    // Role selection
    rolePills.forEach(btn => {
      btn.addEventListener('click', () => {
        rolePills.forEach(p => {
          p.classList.remove('bg-zinc-800', 'text-zinc-100', 'shadow-sm', 'border', 'border-zinc-700/60');
          p.classList.add('text-zinc-400');
        });
        btn.classList.add('bg-zinc-800', 'text-zinc-100', 'shadow-sm', 'border', 'border-zinc-700/60');
        btn.classList.remove('text-zinc-400');
        activeRole = btn.dataset.role || 'autonomous';
        updateStatusUI();
      });
    });

    // Starter card clicks
    starterCards.forEach(card => {
      card.addEventListener('click', () => {
        const prompt = card.dataset.prompt;
        if (prompt && promptInput) {
          promptInput.value = prompt;
          handleInputResize();
          handleSend();
        }
      });
    });

    // Textarea input and auto-resize
    promptInput?.addEventListener('input', () => {
      handleInputResize();
      updateSendButton();
    });

    promptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Send button
    sendBtn?.addEventListener('click', handleSend);

    // Stop button
    stopBtn?.addEventListener('click', handleStop);

    // New Session
    newChatBtn?.addEventListener('click', () => {
      messagesContainer.innerHTML = '';
      emptyState?.classList.remove('hidden');
      if (promptInput) {
        promptInput.value = '';
        handleInputResize();
      }
      updateSendButton();
    });

    // Keyboard shortcut Ctrl+K
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        newChatBtn?.click();
      }
    });

    // Search filter
    searchInput?.addEventListener('input', (e) => {
      const term = (e.target.value || '').toLowerCase();
      const items = sessionList?.querySelectorAll('.session-item');
      items?.forEach(it => {
        const text = it.textContent.toLowerCase();
        it.style.display = text.includes(term) ? 'flex' : 'none';
      });
    });

    // Repo modal
    openRepoModalBtn?.addEventListener('click', openRepoModal);
    attachFileBtn?.addEventListener('click', openRepoModal);
    closeRepoModalBtn?.addEventListener('click', () => repoModal?.classList.add('hidden'));
    refreshRepoBtn?.addEventListener('click', loadRepoFiles);

    // File viewer modal
    closeFileViewModalBtn?.addEventListener('click', () => fileViewModal?.classList.add('hidden'));
    copyFileContentBtn?.addEventListener('click', () => {
      if (fileViewContent) {
        navigator.clipboard.writeText(fileViewContent.textContent || '');
        copyFileContentBtn.textContent = 'Copied!';
        setTimeout(() => { copyFileContentBtn.textContent = 'Copy Content'; }, 2000);
      }
    });

    // Policy modal
    openPolicyModalBtn?.addEventListener('click', () => policyModal?.classList.remove('hidden'));
    closePolicyModalBtn?.addEventListener('click', () => policyModal?.classList.add('hidden'));

    // Test runner modal
    runTestsBtn?.addEventListener('click', runTestSuiteModal);
    reRunTestsBtn?.addEventListener('click', executeTestSuite);
    closeTestModalBtn?.addEventListener('click', () => testModal?.classList.add('hidden'));

    // Auth Gate modal
    authModalBtn?.addEventListener('click', () => {
      authModal?.classList.remove('hidden');
      if (authTokenInput) authTokenInput.value = '';
      if (authStatusBanner) authStatusBanner.classList.add('hidden');
    });
    closeAuthModalBtn?.addEventListener('click', () => authModal?.classList.add('hidden'));
    cancelAuthBtn?.addEventListener('click', () => authModal?.classList.add('hidden'));

    submitAuthBtn?.addEventListener('click', async () => {
      const token = authTokenInput?.value?.trim();
      if (!token) return;

      submitAuthBtn.disabled = true;
      submitAuthBtn.textContent = 'Verifying...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          if (authStatusBanner) {
            authStatusBanner.textContent = 'Authenticated successfully!';
            authStatusBanner.className = 'p-2.5 rounded-xl text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
            authStatusBanner.classList.remove('hidden');
          }
          await fetchStatus();
          setTimeout(() => authModal?.classList.add('hidden'), 900);
        } else {
          if (authStatusBanner) {
            authStatusBanner.textContent = data.error || 'Authentication failed.';
            authStatusBanner.className = 'p-2.5 rounded-xl text-[11px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20';
            authStatusBanner.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (authStatusBanner) {
          authStatusBanner.textContent = (err).message || 'Network error.';
          authStatusBanner.className = 'p-2.5 rounded-xl text-[11px] font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20';
          authStatusBanner.classList.remove('hidden');
        }
      } finally {
        submitAuthBtn.disabled = false;
        submitAuthBtn.textContent = 'Authenticate';
      }
    });

    logoutBtn?.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        await fetchStatus();
        authModal?.classList.add('hidden');
      } catch (e) {
        console.warn('Logout error:', e);
      }
    });
  }

  function handleInputResize() {
    if (!promptInput) return;
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(180, promptInput.scrollHeight) + 'px';
  }

  function updateSendButton() {
    if (!sendBtn || !promptInput) return;
    const hasText = promptInput.value.trim().length > 0;
    if (isGenerating) {
      sendBtn.classList.add('hidden');
      stopBtn?.classList.remove('hidden');
    } else {
      stopBtn?.classList.add('hidden');
      sendBtn.classList.remove('hidden');
      if (hasText) {
        sendBtn.disabled = false;
        sendBtn.className = 'p-2 rounded-xl transition-all bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold shadow-lg shadow-amber-500/20 cursor-pointer';
      } else {
        sendBtn.disabled = true;
        sendBtn.className = 'p-2 rounded-xl transition-all bg-zinc-800 text-zinc-600 cursor-not-allowed';
      }
    }
  }

  function handleStop() {
    if (abortController) {
      abortController.abort();
    }
    isGenerating = false;
    updateSendButton();
  }

  async function handleSend() {
    if (!promptInput || isGenerating) return;
    const task = promptInput.value.trim();
    if (!task) return;

    lastPrompt = task;
    promptInput.value = '';
    handleInputResize();
    isGenerating = true;
    updateSendButton();

    emptyState?.classList.add('hidden');
    appendUserMessage(task);

    const pendingId = `pending_${Date.now()}`;
    appendAssistantPending(pendingId, activeRole);

    abortController = new AbortController();

    if (activeRole === 'workflow') {
      await handleWorkflowExecution(task, pendingId);
      return;
    }

    const requestPayload = {
      task,
      role: activeRole,
    };
    if (activeRole === 'verify') {
      requestPayload.disableFallback = true;
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal: abortController.signal,
      });

      const data = await res.json();
      const pendingEl = document.getElementById(pendingId);

      if (!res.ok || !data.success) {
        if (pendingEl) {
          let errCategory = data.errorCategory;
          if (!errCategory) {
            if (data.code === 'VERCEL_HOBBY_TIMEOUT_PREVENTION') errCategory = 'hobby_timeout_prevention';
            else if (res.status === 504) errCategory = 'timeout';
            else if (res.status === 401) errCategory = 'authentication_failed';
            else if (res.status === 402) errCategory = 'budget_exceeded';
            else if (res.status === 429) errCategory = 'rate_limited';
            else if (res.status === 400) errCategory = 'invalid_request';
            else errCategory = 'gateway_error';
          }
          pendingEl.innerHTML = renderErrorCard(
            data.error || 'Agent loop encountered an error.',
            errCategory
          );
        }
        return;
      }

      if (data.telemetry) {
        systemStatus.telemetry = data.telemetry;
        updateStatusUI();
      }

      if (pendingEl) {
        if (data.phase === 'autonomous_loop' && data.runSummary) {
          pendingEl.innerHTML = renderAutonomousSummary(data.runSummary);
        } else {
          pendingEl.innerHTML = renderSingleTurnResponse(data);
        }
      }

      chatFeed?.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });

    } catch (err) {
      const pendingEl = document.getElementById(pendingId);
      if (pendingEl) {
        if ((err).name === 'AbortError') {
          pendingEl.innerHTML = renderCancelledCard();
        } else {
          pendingEl.innerHTML = renderErrorCard(
            (err).message || 'Network error communicating with WildGuard backend.',
            'network_error'
          );
        }
      }
    } finally {
      isGenerating = false;
      abortController = null;
      updateSendButton();
      await fetchStatus();
    }
  }

  async function handleWorkflowExecution(task, pendingId) {
    const pendingEl = document.getElementById(pendingId);
    if (!pendingEl) return;

    try {
      // Step 0: Initialize
      pendingEl.innerHTML = `
        <div class="assistant-bubble flex-1 space-y-2">
          <div class="flex items-center gap-2 text-xs text-emerald-400">
            <span class="pulse-dot"></span>
            <span class="font-medium">Step Loop: Initializing bounded workflow (<10s)...</span>
          </div>
          <div class="text-[11px] text-zinc-500 font-mono">
            Creating run session; checking Redis budget reservation...
          </div>
        </div>
      `;

      const isLiveRequested = systemStatus?.config?.mode === 'live' && !systemStatus?.preview;
      const initRes = await fetch('/api/workflow/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, mode: isLiveRequested ? 'live' : 'simulation' }),
        signal: abortController?.signal,
      });

      const initData = await initRes.json();
      if (!initRes.ok || !initData.success) {
        pendingEl.innerHTML = renderErrorCard(
          initData.error || 'Failed to initialize workflow',
          initRes.status === 401 ? 'authentication_failed' : 'workflow_error'
        );
        return;
      }

      const runId = initData.workflow.runId;

      // Step 1: Explorer Turn
      let expElapsed = 0;
      const updateExplorerStatus = () => {
        const textEl = pendingEl.querySelector('#step-explorer-status');
        if (textEl) {
          textEl.textContent = `Bounded turn executing (<25s timeout) — Elapsed: ${expElapsed}s... Waiting for Otari gateway...`;
        }
      };

      pendingEl.innerHTML = `
        <div class="assistant-bubble flex-1 space-y-2">
          <div class="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800 pb-1.5">
            <span class="font-semibold text-amber-400 flex items-center gap-1.5">
              <span class="pulse-dot"></span> Turn 1/3: Explorer Reconnaissance
            </span>
            <span class="font-mono text-[10px] text-zinc-500">Run: ${runId.slice(0, 15)}...</span>
          </div>
          <div id="step-explorer-status" class="text-[11px] text-zinc-400 font-mono">
            Bounded turn executing (<25s timeout) — Elapsed: 0s... Waiting for Otari gateway...
          </div>
        </div>
      `;

      const expTimer = setInterval(() => {
        expElapsed++;
        updateExplorerStatus();
      }, 1000);

      let expRes, expData;
      try {
        expRes = await fetch('/api/workflow/step/explorer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
          signal: abortController?.signal,
        });
        expData = await expRes.json();
      } finally {
        clearInterval(expTimer);
      }

      if (!expRes.ok || !expData.success) {
        pendingEl.innerHTML = renderErrorCard(expData.error || 'Explorer turn failed', 'step_timeout');
        return;
      }

      // Step 2: Coder Turn & In-Memory Patch
      let coderElapsed = 0;
      const updateCoderStatus = () => {
        const textEl = pendingEl.querySelector('#step-coder-status');
        if (textEl) {
          textEl.textContent = `Synthesizing patch & diff (<25s timeout) — Elapsed: ${coderElapsed}s... Reasoning model synthesizing fix...`;
        }
      };

      pendingEl.innerHTML = `
        <div class="assistant-bubble flex-1 space-y-2">
          <div class="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800 pb-1.5">
            <span class="font-semibold text-blue-400 flex items-center gap-1.5">
              <span class="pulse-dot"></span> Turn 2/3: Coder Synthesis & Diff
            </span>
            <span class="font-mono text-[10px] text-emerald-400">Explorer OK (${expData.latencyMs}ms)</span>
          </div>
          <div id="step-coder-status" class="text-[11px] text-zinc-400 font-mono">
            Synthesizing patch & diff (<25s timeout) — Elapsed: 0s... Reasoning model synthesizing fix...
          </div>
        </div>
      `;

      const coderTimer = setInterval(() => {
        coderElapsed++;
        updateCoderStatus();
      }, 1000);

      let coderRes, coderData;
      try {
        coderRes = await fetch('/api/workflow/step/coder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId }),
          signal: abortController?.signal,
        });
        coderData = await coderRes.json();
      } finally {
        clearInterval(coderTimer);
      }

      if (!coderRes.ok || !coderData.success) {
        pendingEl.innerHTML = renderErrorCard(coderData.error || 'Coder turn failed', 'step_timeout');
        return;
      }

      // Step 3: Render Diff & Human Approval
      renderWorkflowApprovalUI(pendingEl, runId, expData, coderData);

    } catch (err) {
      if ((err).name === 'AbortError') {
        pendingEl.innerHTML = renderCancelledCard();
      } else {
        pendingEl.innerHTML = renderErrorCard((err).message || 'Workflow step failed', 'network_error');
      }
    } finally {
      isGenerating = false;
      abortController = null;
      updateSendButton();
      await fetchStatus();
    }
  }

  function renderWorkflowApprovalUI(pendingEl, runId, expData, coderData) {
    const patch = coderData.patch;
    const isLive = expData.mode === 'live' || coderData.mode === 'live';
    const totalCost = (expData.costUsd || 0) + (coderData.costUsd || 0);

    pendingEl.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-emerald-400 flex items-center justify-center font-bold text-zinc-950 text-xs shadow-md shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <div class="assistant-bubble flex-1 space-y-3">
        <div class="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800 pb-1.5">
          <span class="font-mono text-zinc-300">WORKFLOW COMPLETE (Turn 1: ${expData.latencyMs}ms | Turn 2: ${coderData.latencyMs}ms)</span>
          <span class="font-mono text-[10px] text-amber-400">Total Spend: $${totalCost.toFixed(6)} | Mode: ${isLive ? 'LIVE' : 'SIMULATION'}</span>
        </div>

        <!-- Explorer Output Accordion -->
        <details class="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs">
          <summary class="font-medium text-amber-400 cursor-pointer select-none">
            Turn 1: Explorer Summary (${expData.modelUsed})
          </summary>
          <div class="mt-2 text-zinc-300 leading-relaxed whitespace-pre-wrap font-mono text-[11px]">
            ${escapeHtml(expData.output || '')}
          </div>
        </details>

        <!-- Patch Diff Preview -->
        ${patch ? `
          <div class="diff-card space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-mono text-zinc-200 text-xs font-semibold flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                ${escapeHtml(patch.filePath)}
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                AWAITING HUMAN APPROVAL
              </span>
            </div>
            <pre class="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 font-mono text-[11px] overflow-x-auto text-zinc-300"><code>${escapeHtml(patch.previewDiff || '')}</code></pre>
            <div class="flex items-center justify-between pt-1">
              <span class="text-[11px] text-zinc-500">In-memory diff ready. Serverless filesystem untouched.</span>
              <div class="flex items-center gap-2">
                <a href="/api/patch/download?runId=${encodeURIComponent(runId)}" download="wildguard-${escapeHtml(runId)}.patch" class="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono transition-colors flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Download .patch
                </a>
                <button onclick="window.approveWorkflow('${escapeHtml(runId)}', false, this)" class="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold transition-colors">
                  Reject
                </button>
                <button onclick="window.approveWorkflow('${escapeHtml(runId)}', true, this)" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 text-xs font-bold transition-colors">
                  Approve Patch
                </button>
              </div>
            </div>
          </div>
        ` : `
          <div class="text-xs text-zinc-400 italic">No patch generated for this task.</div>
        `}
      </div>
    `;

    chatFeed?.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
  }

  // Global window functions for inline button onclick handlers
  window.approveWorkflow = async function (runId, isApproved, btnEl) {
    if (!btnEl) return;
    const parentContainer = btnEl.closest('.diff-card');
    btnEl.disabled = true;

    try {
      const res = await fetch('/api/workflow/step/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, isApproved }),
      });
      const data = await res.json();

      if (parentContainer) {
        parentContainer.innerHTML = `
          <div class="p-3 rounded-xl ${isApproved ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'} text-xs space-y-1">
            <div class="font-bold">${isApproved ? 'Patch Approved by Operator' : 'Patch Rejected'}</div>
            <p class="text-zinc-400 text-[11px]">${data.output || ''}</p>
            ${isApproved ? `
              <div class="pt-2">
                <a href="/api/patch/download?runId=${encodeURIComponent(runId)}" download="wildguard-${encodeURIComponent(runId)}.patch" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Download .patch File
                </a>
              </div>
            ` : ''}
          </div>
        `;
      }
    } catch (e) {
      alert(`Approval error: ${e.message}`);
    }
  };

  function appendUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'flex justify-end message-bubble';
    el.innerHTML = `
      <div class="user-bubble">
        <p class="whitespace-pre-wrap">${escapeHtml(text)}</p>
      </div>
    `;
    messagesContainer.appendChild(el);
    chatFeed?.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
  }

  function appendAssistantPending(id, role) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'assistant-container message-bubble';
    el.innerHTML = `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center font-bold text-zinc-950 text-xs shadow-md shadow-amber-500/10 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="assistant-bubble flex-1 space-y-2">
        <div class="flex items-center gap-2 text-xs text-amber-400">
          <span class="pulse-dot"></span>
          <span class="font-medium">${role === 'autonomous' ? 'WildGuard Autonomous Orchestration Running...' : 'Processing role turn...'}</span>
        </div>
        <div class="text-[11px] text-zinc-500 font-mono">
          Enforcing deterministic zero-trust guardrails & checking Otari per-run spending cap...
        </div>
      </div>
    `;
    messagesContainer.appendChild(el);
    chatFeed?.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
  }

  function renderAutonomousSummary(summary) {
    const isSuccess = summary.status === 'completed';
    const isApprovalNeeded = summary.status === 'requires_approval';
    const isBudgetExhausted = summary.status === 'aborted_budget';

    let stepsHtml = '';
    if (summary.history && summary.history.length > 0) {
      stepsHtml = `
        <div class="agent-step-card space-y-1.5 my-3">
          <div class="font-semibold text-zinc-300 text-[11px] uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span>Agent Execution Trace (${summary.totalSteps} Steps)</span>
            <span class="text-zinc-500 font-mono font-normal">Run ID: ${summary.runId}</span>
          </div>
          <div class="space-y-1 pt-1 font-mono text-[11px]">
            ${summary.history.map(evt => `
              <div class="flex items-start gap-2 text-zinc-400">
                <span class="text-amber-400 shrink-0">[Step ${evt.step}]</span>
                <span class="font-medium text-zinc-200 capitalize">${evt.phase}:</span>
                <span class="truncate text-zinc-300">${escapeHtml(evt.summary)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    let decisionGateHtml = '';
    if (summary.decisionGateResult) {
      const gate = summary.decisionGateResult;
      const isApproved = gate.outcome === 'approve';
      const isRejected = gate.outcome === 'reject';
      const badgeClass = isApproved
        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
        : isRejected
        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30';

      decisionGateHtml = `
        <div class="rounded-xl bg-zinc-900 border border-zinc-800 p-3 my-3 text-xs space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-zinc-200">Decision Quality Gate</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${badgeClass}">
              ${gate.outcome.toUpperCase()}
            </span>
          </div>
          <p class="text-zinc-400 text-[11px] leading-relaxed">${escapeHtml(gate.reason)}</p>
          <div class="flex items-center gap-3 text-[10px] text-zinc-500 font-mono pt-1">
            <span>Engine: ${gate.decisionEngine}</span>
            <span>Risk Level: <b class="text-zinc-300 capitalize">${gate.riskLevel}</b></span>
            <span>Confidence: ${(gate.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      `;
    }

    let approvalBannerHtml = '';
    if (isApprovalNeeded) {
      pendingPatchData = {
        filePath: 'package.json',
        content: summary.finalResponse || '{\n  "dependencies": {\n    "express": "^4.20.0"\n  }\n}'
      };

      approvalBannerHtml = `
        <div id="approvalBanner" class="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 my-3 space-y-2">
          <div class="flex items-center gap-2 text-amber-400 font-bold text-xs">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 9v4"></path><path d="M12 17h.01"></path>
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            </svg>
            Human Verification & Sign-Off Required
          </div>
          <p class="text-xs text-zinc-300 leading-relaxed">
            Local policy guardrail flagged proposed alterations to protected repository dependencies or high-risk constructs. The change is blocked from being written to disk until explicitly approved by the operator.
          </p>
          <div class="flex items-center gap-2 pt-1">
            <button onclick="window.approveProposedChange()" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs shadow-md transition-all cursor-pointer">
              Approve & Apply Patch
            </button>
            <button onclick="window.rejectProposedChange()" class="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-all cursor-pointer">
              Reject
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center font-bold text-zinc-950 text-xs shadow-md shadow-amber-500/10 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="assistant-bubble flex-1 space-y-3">
        <div class="flex items-center justify-between border-b border-zinc-800/80 pb-2">
          <span class="text-xs font-semibold text-zinc-200 flex items-center gap-2">
            WildGuard Autonomous Run
            <span class="text-[10px] px-1.5 py-0.2 rounded font-mono ${isSuccess ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">
              ${summary.status.toUpperCase()}
            </span>
          </span>
          <span class="text-[10px] text-zinc-500 font-mono">
            Spent: $${summary.budgetSummary.accumulatedCostUsd.toFixed(6)} | Tokens: ${summary.budgetSummary.totalTokens}
          </span>
        </div>

        ${stepsHtml}
        ${decisionGateHtml}
        ${approvalBannerHtml}

        <div class="markdown-content text-sm text-zinc-200 leading-relaxed space-y-2">
          ${formatMarkdown(summary.finalResponse)}
        </div>

        <div class="flex items-center gap-3 pt-2 text-xs text-zinc-500 border-t border-zinc-800/60">
          <button onclick="window.copyResponseText(this)" class="hover:text-zinc-300 transition-colors flex items-center gap-1 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy response</span>
          </button>
          <button onclick="window.retryLastPrompt()" class="hover:text-zinc-300 transition-colors flex items-center gap-1 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path></svg>
            <span>Retry</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderSingleTurnResponse(data) {
    if (data.phase === 'verify') {
      const isVerified = Boolean(data.verified);
      const isSimulation = data.mode === 'simulation';
      const isEmpty = data.verificationStatus === 'empty_content';
      const isMatch = data.verificationStatus === 'matched';

      let statusBadgeText = 'UNCONFIRMED';
      let badgeClass = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      let iconBg = 'from-amber-500 to-amber-400';
      let headline = 'Verification Unconfirmed (Empty Content)';
      let details = 'Gateway transport succeeded (HTTP 200), but message.content was empty. No passphrase matched.';

      if (isSimulation) {
        statusBadgeText = 'SIMULATION';
        badgeClass = 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
        iconBg = 'from-blue-500 to-blue-400';
        headline = 'Simulation Verification Mode';
        details = data.message || 'Simulation mode active. Zero external calls performed.';
      } else if (isVerified) {
        statusBadgeText = 'VERIFIED';
        badgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
        iconBg = 'from-emerald-500 to-emerald-400';
        headline = 'Connection Verified (Passphrase Matched: OTARI_CONNECTION_OK)';
        details = 'Outbound probe succeeded (HTTP 200) and response content strictly verified the expected token sequence.';
      } else if (!isEmpty) {
        statusBadgeText = 'MISMATCH';
        badgeClass = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
        iconBg = 'from-rose-500 to-rose-400';
        headline = 'Verification Failed (Passphrase Mismatch)';
        details = 'Upstream gateway returned HTTP 200, but message.content did not contain "OTARI_CONNECTION_OK".';
      }

      return `
        <div class="w-8 h-8 rounded-xl bg-gradient-to-tr ${iconBg} flex items-center justify-center font-bold text-zinc-950 text-xs shadow-md shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div class="assistant-bubble flex-1 space-y-2">
          <div class="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800 pb-1.5">
            <span class="font-mono text-zinc-300">VERIFY : ${escapeHtml(data.modelUsed || 'Otari Gateway')}</span>
            <span class="font-mono text-[10px]">Tokens: ${data.usage?.totalTokens || 0} (Prompt: ${data.usage?.promptTokens || 0}, Comp: ${data.usage?.completionTokens || 0}) | Cost: $${(data.usage?.costUsd || 0).toFixed(6)}</span>
          </div>

          <!-- Explicit Verification Status Card -->
          <div class="rounded-xl bg-zinc-900 border border-zinc-800 p-3 text-xs space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-zinc-200">Otari Connection Probe</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold ${badgeClass}">
                ${statusBadgeText}
              </span>
            </div>
            <div class="text-[11px] font-medium ${isVerified ? 'text-emerald-400' : (isSimulation ? 'text-blue-400' : 'text-amber-400')}">
              ${escapeHtml(headline)}
            </div>
            <p class="text-zinc-400 text-[11px] leading-relaxed">
              ${escapeHtml(details)}
            </p>
            <div class="flex items-center gap-3 text-[10px] text-zinc-500 font-mono pt-1 border-t border-zinc-800/60">
              <span>Transport: <b class="text-emerald-400">HTTP 200 OK</b></span>
              <span>Tokens Limit: <b class="text-zinc-300">${data.maxTokens || 100}</b></span>
              <span>Fallback: <b class="text-zinc-300">${data.fallbackTriggered ? 'TRIGGERED' : 'DISABLED'}</b></span>
              <span>Attempts: <b class="text-zinc-300">${data.attemptCount || 1}</b></span>
            </div>
          </div>

          <div class="markdown-content text-sm text-zinc-200 leading-relaxed pt-1">
            ${data.response ? formatMarkdown(data.response) : '<span class="text-zinc-500 italic font-mono text-xs">[Empty content response received from gateway]</span>'}
          </div>

          <div class="flex items-center gap-3 pt-2 text-xs text-zinc-500 border-t border-zinc-800/60">
            <button onclick="window.copyResponseText(this)" class="hover:text-zinc-300 transition-colors flex items-center gap-1 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>Copy response</span>
            </button>
            <button onclick="window.retryLastPrompt()" class="hover:text-zinc-300 transition-colors flex items-center gap-1 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path></svg>
              <span>Retry</span>
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center font-bold text-zinc-950 text-xs shadow-md shadow-amber-500/10 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="assistant-bubble flex-1 space-y-2">
        <div class="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800 pb-1.5">
          <span class="font-mono text-zinc-300">${data.roleUsed.toUpperCase()} : ${data.modelUsed}</span>
          <span class="font-mono text-[10px]">Tokens: ${data.usage?.totalTokens || 0} | Cost: $${(data.usage?.costUsd || 0).toFixed(6)}</span>
        </div>
        <div class="markdown-content text-sm text-zinc-200 leading-relaxed pt-1">
          ${(data.response && data.response.trim().length > 0)
            ? formatMarkdown(data.response)
            : `<div class="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-xs text-amber-300 font-mono">
                 [Gateway returned HTTP 200 OK, but final content was empty. The reasoning model may have exhausted its completion token limit during internal chain-of-thought before emitting text.]
               </div>`
          }
        </div>
        <div class="flex items-center gap-3 pt-2 text-xs text-zinc-500 border-t border-zinc-800/60">
          <button onclick="window.copyResponseText(this)" class="hover:text-zinc-300 transition-colors flex items-center gap-1 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy response</span>
          </button>
          <button onclick="window.retryLastPrompt()" class="hover:text-zinc-300 transition-colors flex items-center gap-1 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path></svg>
            <span>Retry</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderErrorCard(errMsg, errorCategory) {
    const categoryLabels = {
      timeout: 'Timeout (Otari Gateway Request Exceeded Deadline)',
      authentication_failed: 'Authentication Failed (Check Otari-Key / Credentials)',
      invalid_model: 'Invalid Model Identifier (Model Not In Otari Catalog)',
      gateway_error: 'Otari Gateway Error (Upstream Service Failure)',
      network_error: 'Network Connectivity Error',
      hobby_timeout_prevention: 'Hobby Execution Limit Notice (Use Step Loop or Single Turns)',
      budget_exceeded: 'Spend Budget Cap Reached',
      rate_limited: 'Rate Limit Exceeded',
      invalid_request: 'Invalid Request',
    };
    const categoryBadge = errorCategory ? `
      <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase">
        ${escapeHtml(errorCategory.replace('_', ' '))}
      </span>
    ` : '';
    const categoryTitle = categoryLabels[errorCategory] || 'Execution Error';

    return `
      <div class="w-8 h-8 rounded-xl bg-rose-500 flex items-center justify-center font-bold text-zinc-950 text-xs shadow-md shrink-0">
        !
      </div>
      <div class="assistant-bubble flex-1 space-y-2">
        <div class="flex items-center justify-between border-b border-rose-500/20 pb-1.5">
          <span class="text-xs font-bold text-rose-400">${escapeHtml(categoryTitle)}</span>
          ${categoryBadge}
        </div>
        <p class="text-xs text-zinc-300 font-mono leading-relaxed">${escapeHtml(errMsg)}</p>
        <div class="text-[10px] text-zinc-500 font-mono pt-0.5">
          Zero simulated fallbacks applied. Actual failure displayed truthfully.
        </div>
        <div class="pt-1">
          <button onclick="window.retryLastPrompt()" class="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors cursor-pointer">Retry</button>
        </div>
      </div>
    `;
  }

  function renderCancelledCard() {
    return `
      <div class="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center font-bold text-zinc-400 text-xs shrink-0">
        ■
      </div>
      <div class="assistant-bubble flex-1 space-y-1">
        <div class="text-xs font-semibold text-zinc-400">Generation stopped by user</div>
      </div>
    `;
  }

  // Markdown and Diff Parser
  function formatMarkdown(content) {
    if (!content) return '';

    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map(part => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.slice(3, -3).trim().split('\n');
        const lang = lines[0].trim() || 'text';
        const code = lines.slice(lang ? 1 : 0).join('\n');

        if (lang === 'diff' || code.includes('--- a/') || code.includes('+++ b/')) {
          return renderDiffBlock(code);
        }

        return `
          <div class="code-block-container">
            <div class="code-header">
              <span>${escapeHtml(lang)}</span>
              <button onclick="window.copyToClipboard(this)" data-code="${escapeHtml(code)}" class="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">Copy</button>
            </div>
            <pre class="code-body"><code>${escapeHtml(code)}</code></pre>
          </div>
        `;
      }

      let html = escapeHtml(part);
      html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
      html = html.replace(/`([^`]+)`/g, '<code class="font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">$1</code>');
      html = html.replace(/\n\n/g, '<br/><br/>');
      return `<p>${html}</p>`;
    }).join('');
  }

  function renderDiffBlock(diffText) {
    const lines = diffText.split('\n');
    const rows = lines.map(line => {
      if (line.startsWith('+')) {
        return `<div class="diff-line-added">${escapeHtml(line)}</div>`;
      } else if (line.startsWith('-')) {
        return `<div class="diff-line-removed">${escapeHtml(line)}</div>`;
      } else if (line.startsWith('@')) {
        return `<div class="diff-line-meta">${escapeHtml(line)}</div>`;
      }
      return `<div class="px-2 py-0.5 text-zinc-400">${escapeHtml(line)}</div>`;
    }).join('');

    return `
      <div class="diff-container">
        <div class="code-header">
          <span>Proposed Diff Preview</span>
          <button onclick="window.copyToClipboard(this)" data-code="${escapeHtml(diffText)}" class="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">Copy Diff</button>
        </div>
        <div>${rows}</div>
      </div>
    `;
  }

  // Repo file browser
  async function openRepoModal() {
    repoModal?.classList.remove('hidden');
    await loadRepoFiles();
  }

  async function loadRepoFiles() {
    if (!repoFileList) return;
    repoFileList.innerHTML = '<div class="text-zinc-500 py-4 text-center">Loading files...</div>';

    try {
      const res = await fetch('/api/repo/files?recursive=true');
      const json = await res.json();
      if (!res.ok || !json.success) {
        repoFileList.innerHTML = `<div class="text-rose-400 py-2">Failed: ${escapeHtml(json.error || 'Error')}</div>`;
        return;
      }

      const files = json.data || [];
      if (files.length === 0) {
        repoFileList.innerHTML = '<div class="text-zinc-500 py-2">No files found.</div>';
        return;
      }

      repoFileList.innerHTML = files.map(f => `
        <div class="flex items-center justify-between p-1.5 rounded hover:bg-zinc-800/60 transition-colors cursor-pointer" onclick="window.viewFileContent('${escapeHtml(f.relativePath)}')">
          <div class="flex items-center gap-2 truncate">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${f.isDirectory ? 'text-amber-400' : 'text-zinc-400'}">
              ${f.isDirectory
                ? '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path>'
                : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>'}
            </svg>
            <span class="text-zinc-200 hover:text-amber-400 transition-colors truncate">${escapeHtml(f.relativePath)}</span>
          </div>
          <span class="text-[10px] text-zinc-500">${(f.sizeBytes / 1024).toFixed(1)} KB</span>
        </div>
      `).join('');

    } catch (err) {
      repoFileList.innerHTML = `<div class="text-rose-400 py-2">Network error: ${escapeHtml(err.message)}</div>`;
    }
  }

  // File Viewer
  window.viewFileContent = async function (filePath) {
    if (!fileViewModal) return;
    fileViewPath.textContent = filePath;
    fileViewContent.textContent = 'Loading content...';
    fileViewModal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/repo/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        fileViewContent.textContent = data.data.content;
        fileViewSize.textContent = `(${data.data.sizeBytes} bytes)`;
      } else {
        fileViewContent.textContent = `Blocked by Policy: ${data.error || 'Access denied'}`;
        fileViewSize.textContent = '';
      }
    } catch (e) {
      fileViewContent.textContent = `Error loading file: ${e.message}`;
    }
  };

  // Test Suite Runner Modal
  async function runTestSuiteModal() {
    testModal?.classList.remove('hidden');
    await executeTestSuite();
  }

  async function executeTestSuite() {
    if (!testResultsList) return;
    testResultsList.innerHTML = '<div class="text-zinc-500 py-4 text-center">Executing security and guardrail tests...</div>';
    testSummaryText.textContent = '';

    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();

      if (res.ok && data.success) {
        testSummaryText.textContent = `${data.passed}/${data.totalTests} policies verified (${data.durationMs}ms)`;
        const noticeHtml = data.notice
          ? `<div class="p-2 mb-2 rounded bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 font-mono">${escapeHtml(data.notice)}</div>`
          : '';
        testResultsList.innerHTML = noticeHtml + data.tests.map(t => `
          <div class="flex items-center justify-between p-2 rounded bg-zinc-950/70 border border-zinc-800">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${t.status === 'pass' ? 'bg-emerald-400' : 'bg-rose-500'}"></span>
              <span class="text-zinc-200">${escapeHtml(t.name)}</span>
            </div>
            <span class="text-[10px] text-zinc-500 font-mono">${t.durationMs}ms</span>
          </div>
        `).join('');
      } else {
        testResultsList.innerHTML = `<div class="text-rose-400 py-2">Test execution failed: ${escapeHtml(data.error || 'Unknown error')}</div>`;
      }
    } catch (e) {
      testResultsList.innerHTML = `<div class="text-rose-400 py-2">Network error running tests: ${escapeHtml(e.message)}</div>`;
    }
  }

  // Human Approval Interactions
  window.approveProposedChange = async function () {
    const banner = document.getElementById('approvalBanner');
    if (!pendingPatchData) return;

    if (banner) {
      banner.innerHTML = `
        <div class="flex items-center gap-2 text-emerald-400 font-bold text-xs">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Patch Approved by Operator
        </div>
        <p class="text-xs text-zinc-300">Applying patch to feature branch through McpRepoTools...</p>
      `;
    }

    try {
      const res = await fetch('/api/patch/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: pendingPatchData.filePath,
          content: pendingPatchData.content,
          isApproved: true,
        }),
      });
      const data = await res.json();

      if (banner) {
        if (data.success) {
          const isDryRun = Boolean(data.data?.dryRun || data.dryRun);
          const notice = data.data?.notice || data.notice;
          banner.className = 'rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 my-3 space-y-1';
          banner.innerHTML = `
            <div class="flex items-center gap-2 text-emerald-400 font-bold text-xs">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              ${isDryRun ? 'Patch Successfully Verified & Simulated' : 'Patch Successfully Applied & Verified'}
            </div>
            <p class="text-xs text-zinc-300 font-mono">Modified: ${escapeHtml(pendingPatchData.filePath)} (${data.data?.linesModified || 0} lines)</p>
            ${notice ? `<p class="text-[11px] text-amber-300 font-mono pt-1">${escapeHtml(notice)}</p>` : ''}
          `;
        } else {
          banner.className = 'rounded-xl bg-rose-500/10 border border-rose-500/30 p-3.5 my-3 space-y-1';
          banner.innerHTML = `
            <div class="flex items-center gap-2 text-rose-400 font-bold text-xs">Policy Blocked Write</div>
            <p class="text-xs text-zinc-300 font-mono">${escapeHtml(data.error || 'Failed to apply patch')}</p>
          `;
        }
      }
    } catch (err) {
      if (banner) {
        banner.innerHTML = `<div class="text-xs text-rose-400">Error: ${escapeHtml(err.message)}</div>`;
      }
    }
  };

  window.rejectProposedChange = function () {
    const banner = document.getElementById('approvalBanner');
    if (banner) {
      banner.className = 'rounded-xl bg-zinc-900 border border-zinc-800 p-3.5 my-3 space-y-1';
      banner.innerHTML = `
        <div class="flex items-center gap-2 text-zinc-400 font-bold text-xs">Patch Rejected by Operator</div>
        <p class="text-xs text-zinc-500">Operation cancelled. Filesystem remains untouched.</p>
      `;
    }
  };

  window.copyToClipboard = function (btn) {
    const code = btn.dataset.code;
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      });
    }
  };

  window.copyResponseText = function (btn) {
    const bubble = btn.closest('.assistant-bubble');
    const textEl = bubble ? bubble.querySelector('.markdown-content') : null;
    if (textEl) {
      navigator.clipboard.writeText(textEl.textContent || '').then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<span>Copied!</span>';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
      });
    }
  };

  window.retryLastPrompt = function () {
    if (lastPrompt && promptInput) {
      promptInput.value = lastPrompt;
      handleInputResize();
      handleSend();
    }
  };

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  init();
})();
<script>
  import { onMount, onDestroy } from 'svelte';
  import * as api from '../lib/api.js';

  let systemLogs = [];
  let previousLogs = [];
  let olderLogs = [];
  let accessLogs = [];
  let systemLogsLoading = true;
  let previousLogsLoading = true;
  let olderLogsLoading = true;
  let accessLogsLoading = true;
  let systemLogsError = null;
  let previousLogsError = null;
  let olderLogsError = null;
  let accessLogsError = null;

  // Auto-refresh state
  let autoRefresh = false;
  let refreshInterval = null;
  let refreshSeconds = 5;

  // Filter state
  let systemLogsFilter = '';
  let previousLogsFilter = '';
  let olderLogsFilter = '';
  let accessLogsFilter = '';

  // Expand/collapse state
  let systemLogsExpanded = true;
  let previousLogsExpanded = true;
  let olderLogsExpanded = false;  // Collapsed by default
  let accessLogsExpanded = true;

  // Scroll position tracking
  let systemLogsContainer;
  let previousLogsContainer;
  let olderLogsContainer;
  let accessLogsContainer;

  // Filtered logs
  $: filteredSystemLogs = systemLogs.filter(log =>
    log.toLowerCase().includes(systemLogsFilter.toLowerCase())
  );
  $: filteredPreviousLogs = previousLogs.filter(log =>
    log.toLowerCase().includes(previousLogsFilter.toLowerCase())
  );
  $: filteredOlderLogs = olderLogs.filter(log =>
    log.toLowerCase().includes(olderLogsFilter.toLowerCase())
  );
  $: filteredAccessLogs = accessLogs.filter(log =>
    log.toLowerCase().includes(accessLogsFilter.toLowerCase())
  );

  async function fetchSystemLogs(showLoading = true) {
    // Save scroll position before updating
    const scrollTop = systemLogsContainer?.scrollTop || 0;

    if (showLoading) {
      systemLogsLoading = true;
    }
    systemLogsError = null;
    try {
      systemLogs = await api.getSystemLogs();
    } catch (err) {
      console.error('Failed to fetch system logs:', err);
      systemLogsError = err.message;
      systemLogs = [];
    } finally {
      if (showLoading) {
        systemLogsLoading = false;
      }

      // Restore scroll position after DOM updates
      if (systemLogsContainer && scrollTop > 0) {
        requestAnimationFrame(() => {
          systemLogsContainer.scrollTop = scrollTop;
        });
      }
    }
  }

  async function fetchPreviousLogs(showLoading = true) {
    // Save scroll position before updating
    const scrollTop = previousLogsContainer?.scrollTop || 0;

    if (showLoading) {
      previousLogsLoading = true;
    }
    previousLogsError = null;
    try {
      previousLogs = await api.getPreviousLogs();
    } catch (err) {
      console.error('Failed to fetch previous logs:', err);
      previousLogsError = err.message;
      previousLogs = [];
    } finally {
      if (showLoading) {
        previousLogsLoading = false;
      }

      // Restore scroll position after DOM updates
      if (previousLogsContainer && scrollTop > 0) {
        requestAnimationFrame(() => {
          previousLogsContainer.scrollTop = scrollTop;
        });
      }
    }
  }

  async function fetchOlderLogs(showLoading = true) {
    // Save scroll position before updating
    const scrollTop = olderLogsContainer?.scrollTop || 0;

    if (showLoading) {
      olderLogsLoading = true;
    }
    olderLogsError = null;
    try {
      olderLogs = await api.getOlderLogs();
    } catch (err) {
      console.error('Failed to fetch older logs:', err);
      olderLogsError = err.message;
      olderLogs = [];
    } finally {
      if (showLoading) {
        olderLogsLoading = false;
      }

      // Restore scroll position after DOM updates
      if (olderLogsContainer && scrollTop > 0) {
        requestAnimationFrame(() => {
          olderLogsContainer.scrollTop = scrollTop;
        });
      }
    }
  }

  async function fetchAccessLogs(showLoading = true) {
    // Save scroll position before updating
    const scrollTop = accessLogsContainer?.scrollTop || 0;

    if (showLoading) {
      accessLogsLoading = true;
    }
    accessLogsError = null;
    try {
      accessLogs = await api.getAccessLogs();
    } catch (err) {
      console.error('Failed to fetch access logs:', err);
      accessLogsError = err.message;
      accessLogs = [];
    } finally {
      if (showLoading) {
        accessLogsLoading = false;
      }

      // Restore scroll position after DOM updates
      if (accessLogsContainer && scrollTop > 0) {
        requestAnimationFrame(() => {
          accessLogsContainer.scrollTop = scrollTop;
        });
      }
    }
  }

  function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    if (autoRefresh) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh(); // Clear any existing interval
    refreshInterval = setInterval(() => {
      fetchSystemLogs(false);
      fetchPreviousLogs(false);
      fetchOlderLogs(false);
      fetchAccessLogs(false);
    }, refreshSeconds * 1000);
  }

  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  function exportLogs(logs, filename) {
    const text = logs.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearSystemLogsFilter() {
    systemLogsFilter = '';
  }

  function clearPreviousLogsFilter() {
    previousLogsFilter = '';
  }

  function clearOlderLogsFilter() {
    olderLogsFilter = '';
  }

  function clearAccessLogsFilter() {
    accessLogsFilter = '';
  }

  function toggleSystemLogsExpanded() {
    systemLogsExpanded = !systemLogsExpanded;
  }

  function togglePreviousLogsExpanded() {
    previousLogsExpanded = !previousLogsExpanded;
  }

  function toggleOlderLogsExpanded() {
    olderLogsExpanded = !olderLogsExpanded;
  }

  function toggleAccessLogsExpanded() {
    accessLogsExpanded = !accessLogsExpanded;
  }

  onMount(() => {
    fetchSystemLogs();
    fetchPreviousLogs();
    fetchOlderLogs();
    fetchAccessLogs();
  });

  onDestroy(() => {
    stopAutoRefresh();
  });
</script>

<svelte:head>
  <title>Logs & Diagnostics - MouseTrap</title>
</svelte:head>

<div class="logs-container">
  <div class="header">
    <h1>Logs & Diagnostics</h1>
    <div class="header-controls">
      <button
        class="btn"
        class:active={autoRefresh}
        on:click={toggleAutoRefresh}
      >
        {autoRefresh ? 'Auto-refresh On' : 'Auto-refresh Off'} ({refreshSeconds}s)
      </button>
      <button class="btn" on:click={() => { fetchSystemLogs(true); fetchPreviousLogs(true); fetchOlderLogs(true); fetchAccessLogs(true); }}>
        Refresh Now
      </button>
    </div>
  </div>

  <!-- System Logs Section -->
  <div class="log-section">
    <div class="log-header">
      <button class="expand-btn" on:click={toggleSystemLogsExpanded}>
        {systemLogsExpanded ? '▼' : '▶'}
      </button>
      <h2>System Logs</h2>
      <div class="log-controls">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter logs..."
          bind:value={systemLogsFilter}
        />
        {#if systemLogsFilter}
          <button class="btn-small" on:click={clearSystemLogsFilter}>Clear</button>
        {/if}
        <button
          class="btn-small"
          on:click={() => exportLogs(systemLogs, 'system-logs.txt')}
          disabled={systemLogs.length === 0}
        >
          Export
        </button>
      </div>
    </div>

    {#if systemLogsExpanded}
    <div class="log-content" class:expanded={systemLogsExpanded} bind:this={systemLogsContainer}>
      {#if systemLogsLoading}
        <div class="loading">Loading system logs...</div>
      {:else if systemLogsError}
        <div class="error">Error: {systemLogsError}</div>
      {:else if filteredSystemLogs.length === 0 && systemLogsFilter}
        <div class="no-results">No logs match filter "{systemLogsFilter}"</div>
      {:else if systemLogs.length === 0}
        <div class="no-data">No system logs available</div>
      {:else}
        <div class="log-list">
          {#each filteredSystemLogs as log}
            <div class="log-line">{log}</div>
          {/each}
        </div>
        {#if systemLogsFilter && filteredSystemLogs.length > 0}
          <div class="filter-info">
            Showing {filteredSystemLogs.length} of {systemLogs.length} logs
          </div>
        {/if}
      {/if}
    </div>
    {/if}
  </div>

  <!-- Previous Logs Section -->
  <div class="log-section">
    <div class="log-header">
      <button class="expand-btn" on:click={togglePreviousLogsExpanded}>
        {previousLogsExpanded ? '▼' : '▶'}
      </button>
      <h2>Previous System Logs</h2>
      <div class="log-controls">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter logs..."
          bind:value={previousLogsFilter}
        />
        {#if previousLogsFilter}
          <button class="btn-small" on:click={clearPreviousLogsFilter}>Clear</button>
        {/if}
        <button
          class="btn-small"
          on:click={() => exportLogs(previousLogs, 'previous-logs.txt')}
          disabled={previousLogs.length === 0}
        >
          Export
        </button>
      </div>
    </div>

    {#if previousLogsExpanded}
    <div class="log-content" class:expanded={previousLogsExpanded} bind:this={previousLogsContainer}>
      {#if previousLogsLoading}
        <div class="loading">Loading previous logs...</div>
      {:else if previousLogsError}
        <div class="error">Error: {previousLogsError}</div>
      {:else if filteredPreviousLogs.length === 0 && previousLogsFilter}
        <div class="no-results">No logs match filter "{previousLogsFilter}"</div>
      {:else if previousLogs.length === 0}
        <div class="no-data">No previous logs available</div>
      {:else}
        <div class="log-list">
          {#each filteredPreviousLogs as log}
            <div class="log-line">{log}</div>
          {/each}
        </div>
        {#if previousLogsFilter && filteredPreviousLogs.length > 0}
          <div class="filter-info">
            Showing {filteredPreviousLogs.length} of {previousLogs.length} logs
          </div>
        {/if}
      {/if}
    </div>
    {/if}
  </div>

  <!-- Older Logs Section (2 boots ago) - for registration troubleshooting -->
  <div class="log-section">
    <div class="log-header">
      <button class="expand-btn" on:click={toggleOlderLogsExpanded}>
        {olderLogsExpanded ? '▼' : '▶'}
      </button>
      <h2>Older Logs (2 boots ago)</h2>
      <div class="log-controls">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter logs..."
          bind:value={olderLogsFilter}
        />
        {#if olderLogsFilter}
          <button class="btn-small" on:click={clearOlderLogsFilter}>Clear</button>
        {/if}
        <button
          class="btn-small"
          on:click={() => exportLogs(olderLogs, 'older-logs.txt')}
          disabled={olderLogs.length === 0}
        >
          Export
        </button>
      </div>
    </div>

    {#if olderLogsExpanded}
    <div class="log-content" class:expanded={olderLogsExpanded} bind:this={olderLogsContainer}>
      {#if olderLogsLoading}
        <div class="loading">Loading older logs...</div>
      {:else if olderLogsError}
        <div class="error">Error: {olderLogsError}</div>
      {:else if filteredOlderLogs.length === 0 && olderLogsFilter}
        <div class="no-results">No logs match filter "{olderLogsFilter}"</div>
      {:else if olderLogs.length === 0}
        <div class="no-data">No older logs available (logs from 2 boots ago)</div>
      {:else}
        <div class="log-list">
          {#each filteredOlderLogs as log}
            <div class="log-line">{log}</div>
          {/each}
        </div>
        {#if olderLogsFilter && filteredOlderLogs.length > 0}
          <div class="filter-info">
            Showing {filteredOlderLogs.length} of {olderLogs.length} logs
          </div>
        {/if}
      {/if}
    </div>
    {/if}
  </div>

  <!-- Access Logs Section -->
  <div class="log-section">
    <div class="log-header">
      <button class="expand-btn" on:click={toggleAccessLogsExpanded}>
        {accessLogsExpanded ? '▼' : '▶'}
      </button>
      <h2>Access Logs</h2>
      <div class="log-controls">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter logs..."
          bind:value={accessLogsFilter}
        />
        {#if accessLogsFilter}
          <button class="btn-small" on:click={clearAccessLogsFilter}>Clear</button>
        {/if}
        <button
          class="btn-small"
          on:click={() => exportLogs(accessLogs, 'access-logs.txt')}
          disabled={accessLogs.length === 0}
        >
          Export
        </button>
      </div>
    </div>

    {#if accessLogsExpanded}
    <div class="log-content" class:expanded={accessLogsExpanded} bind:this={accessLogsContainer}>
      {#if accessLogsLoading}
        <div class="loading">Loading access logs...</div>
      {:else if accessLogsError}
        <div class="error">Error: {accessLogsError}</div>
      {:else if filteredAccessLogs.length === 0 && accessLogsFilter}
        <div class="no-results">No logs match filter "{accessLogsFilter}"</div>
      {:else if accessLogs.length === 0}
        <div class="no-data">No access logs available</div>
      {:else}
        <div class="log-list">
          {#each filteredAccessLogs as log}
            <div class="log-line">{log}</div>
          {/each}
        </div>
        {#if accessLogsFilter && filteredAccessLogs.length > 0}
          <div class="filter-info">
            Showing {filteredAccessLogs.length} of {accessLogs.length} logs
          </div>
        {/if}
      {/if}
    </div>
    {/if}
  </div>
</div>

<style>
  .logs-container {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    flex-wrap: wrap;
    gap: 1rem;
  }

  h1 {
    color: #ddd;
    margin: 0;
    font-size: 2rem;
  }

  .header-controls {
    display: flex;
    gap: 10px;
  }

  .log-section {
    margin-bottom: 2rem;
    border: 1px solid #444;
    border-radius: 8px;
    overflow: hidden;
    background: #1a1a1a;
  }

  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: #2a2a2a;
    border-bottom: 1px solid #444;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .expand-btn {
    background: transparent;
    border: none;
    color: #4CAF50;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    transition: transform 0.2s;
    line-height: 1;
  }

  .expand-btn:hover {
    transform: scale(1.2);
  }

  h2 {
    color: #ddd;
    margin: 0;
    font-size: 1.25rem;
    flex: 1;
  }

  .log-controls {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .filter-input {
    padding: 0.5rem 0.75rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #ddd;
    font-size: 14px;
    min-width: 200px;
  }

  .filter-input:focus {
    outline: none;
    border-color: #4CAF50;
  }

  .btn {
    padding: 0.5rem 1rem;
    background: #1a1a1a;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .btn:hover {
    background: #2a2a2a;
    border-color: #666;
  }

  .btn.active {
    background: #4CAF50;
    border-color: #4CAF50;
    color: white;
  }

  .btn-small {
    padding: 0.4rem 0.75rem;
    background: #1a1a1a;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
  }

  .btn-small:hover:not(:disabled) {
    background: #2a2a2a;
    border-color: #666;
  }

  .btn-small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .log-content {
    padding: 1.5rem;
    background: #1a1a1a;
    max-height: 600px;
    overflow-y: auto;
    transition: max-height 0.3s ease;
    overscroll-behavior: contain;
  }

  .log-content.expanded {
    max-height: calc(100vh - 350px);
    min-height: 600px;
  }

  .log-list {
    font-family: 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
    text-align: left;
  }

  .log-line {
    color: #ddd;
    padding: 2px 0;
    padding-left: 0;
    word-wrap: break-word;
    white-space: pre-wrap;
    text-align: left;
  }

  .log-line:nth-child(odd) {
    background: rgba(255, 255, 255, 0.02);
  }

  .loading,
  .error,
  .no-data,
  .no-results {
    text-align: left;
    padding: 2rem;
    color: #999;
    font-style: italic;
  }

  .error {
    color: #f44336;
  }

  .filter-info {
    margin-top: 1rem;
    padding: 0.5rem;
    background: #2a2a2a;
    border-radius: 4px;
    text-align: left;
    color: #999;
    font-size: 13px;
  }

  @media (max-width: 768px) {
    .logs-container {
      padding: 1rem;
    }

    h1 {
      font-size: 1.5rem;
    }

    .header {
      flex-direction: column;
      align-items: stretch;
    }

    .header-controls {
      flex-direction: column;
    }

    .log-header {
      flex-direction: column;
      align-items: stretch;
    }

    .log-controls {
      flex-direction: column;
    }

    .filter-input {
      min-width: auto;
      width: 100%;
    }

    .btn,
    .btn-small {
      width: 100%;
    }

    .log-content {
      max-height: 400px;
    }
  }
</style>

<script>
  import { onMount, onDestroy } from 'svelte';
  import * as api from '../lib/api.js';

  let status = null;
  let loading = true;
  let error = null;
  let autoRefresh = false;
  let refreshInterval = null;

  async function fetchStatus() {
    try {
      status = await api.getSystemStatus();
      error = null;
    } catch (err) {
      console.error('Failed to fetch system status:', err);
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    return parts.join(' ');
  }

  function getPercentage(used, total) {
    if (total === 0) return 0;
    return Math.round((used / total) * 100);
  }

  function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    if (autoRefresh) {
      refreshInterval = setInterval(fetchStatus, 5000);
    } else {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
    }
  }

  onMount(() => {
    fetchStatus();
  });

  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });
</script>

<svelte:head>
  <title>System Status - MouseTrap</title>
</svelte:head>

<div class="status-container">
  <div class="header">
    <h1>System Status</h1>
    <div class="header-controls">
      <button
        class="btn"
        class:active={autoRefresh}
        on:click={toggleAutoRefresh}
      >
        {autoRefresh ? 'Auto-refresh On' : 'Auto-refresh Off'} (5s)
      </button>
      <button class="btn" on:click={fetchStatus}>
        Refresh Now
      </button>
    </div>
  </div>

  {#if loading}
    <div class="loading">Loading system status...</div>
  {:else if error}
    <div class="error">Error: {error}</div>
  {:else if status}
    <div class="status-grid">
      <!-- Version Info -->
      <div class="card">
        <h3>Version</h3>
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Firmware:</span>
            <span class="value">{status.firmwareVersion || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="label">Filesystem:</span>
            <span class="value">{status.filesystemVersion || 'N/A'}</span>
          </div>
        </div>
      </div>

      <!-- Uptime -->
      <div class="card">
        <h3>Uptime</h3>
        <div class="uptime-display">
          {formatUptime(status.uptimeSeconds || 0)}
        </div>
        <div class="info-subtext">
          CPU: {status.cpuFreq || 0} MHz
        </div>
      </div>

      <!-- Heap Memory -->
      <div class="card">
        <h3>Heap Memory</h3>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {getPercentage((status.heapTotal || 0) - (status.heapFree || 0), status.heapTotal || 1)}%"></div>
        </div>
        <div class="progress-label">
          {formatBytes((status.heapTotal || 0) - (status.heapFree || 0))} / {formatBytes(status.heapTotal || 0)} ({getPercentage((status.heapTotal || 0) - (status.heapFree || 0), status.heapTotal || 1)}%)
        </div>
        <div class="info-subtext">
          Free: {formatBytes(status.heapFree || 0)}
        </div>
      </div>

      <!-- PSRAM -->
      <div class="card">
        <h3>PSRAM</h3>
        {#if status.psramTotal > 0}
          {@const psramUsed = (status.psramTotal || 0) - (status.psramFree || 0)}
          {@const psramPct = getPercentage(psramUsed, status.psramTotal || 1)}
          <div class="progress-bar">
            <div class="progress-fill" style="width: {psramPct}%"></div>
          </div>
          <div class="progress-label">
            {formatBytes(psramUsed)} / {formatBytes(status.psramTotal || 0)} ({psramPct}%)
          </div>
          <div class="info-subtext">
            Free: {formatBytes(status.psramFree || 0)}
          </div>
        {:else}
          <div class="no-data">No PSRAM detected</div>
        {/if}
      </div>

      <!-- Filesystem -->
      <div class="card">
        <h3>Filesystem</h3>
        <div class="progress-bar">
          <div class="progress-fill" class:warning={getPercentage(status.fsUsed || 0, status.fsTotal || 1) > 80} class:critical={getPercentage(status.fsUsed || 0, status.fsTotal || 1) > 95} style="width: {getPercentage(status.fsUsed || 0, status.fsTotal || 1)}%"></div>
        </div>
        <div class="progress-label">
          {formatBytes(status.fsUsed || 0)} / {formatBytes(status.fsTotal || 0)} ({getPercentage(status.fsUsed || 0, status.fsTotal || 1)}%)
        </div>
        <div class="info-subtext">
          Free: {formatBytes(status.fsFree || 0)}
        </div>
      </div>

      <!-- Captures -->
      <div class="card">
        <h3>Captures</h3>
        {#if status.captures && status.captures.length > 0}
          <div class="captures-count">
            {status.captures.length} file{status.captures.length !== 1 ? 's' : ''}
          </div>
          <div class="captures-list">
            {#each status.captures.slice(0, 5) as capture}
              <div class="capture-item">
                <span class="capture-name">{capture.name}</span>
                <span class="capture-size">{formatBytes(capture.size)}</span>
              </div>
            {/each}
            {#if status.captures.length > 5}
              <div class="more-captures">
                +{status.captures.length - 5} more
              </div>
            {/if}
          </div>
        {:else}
          <div class="no-data">No captures stored</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .status-container {
    padding: 2rem;
    max-width: 1200px;
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

  .loading, .error, .no-data {
    text-align: center;
    padding: 2rem;
    color: #999;
    font-style: italic;
  }

  .error {
    color: #f44336;
  }

  .status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .card {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 1.5rem;
  }

  .card h3 {
    margin: 0 0 1rem 0;
    color: #4CAF50;
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .label {
    color: #999;
    font-size: 0.9rem;
  }

  .value {
    color: #ddd;
    font-family: 'Courier New', monospace;
    font-size: 0.9rem;
  }

  .uptime-display {
    font-size: 1.5rem;
    color: #fff;
    font-family: 'Courier New', monospace;
    text-align: center;
    padding: 0.5rem 0;
  }

  .info-subtext {
    color: #666;
    font-size: 0.85rem;
    text-align: center;
    margin-top: 0.5rem;
  }

  .progress-bar {
    height: 20px;
    background: #2a2a2a;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }

  .progress-fill {
    height: 100%;
    background: #4CAF50;
    transition: width 0.3s ease;
  }

  .progress-fill.warning {
    background: #ff9800;
  }

  .progress-fill.critical {
    background: #f44336;
  }

  .progress-label {
    font-size: 0.85rem;
    color: #ddd;
    text-align: center;
    font-family: 'Courier New', monospace;
  }

  .captures-count {
    font-size: 1.25rem;
    color: #fff;
    text-align: center;
    margin-bottom: 1rem;
  }

  .captures-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 150px;
    overflow-y: auto;
  }

  .capture-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0;
    border-bottom: 1px solid #333;
  }

  .capture-item:last-child {
    border-bottom: none;
  }

  .capture-name {
    color: #ddd;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  .capture-size {
    color: #666;
    font-size: 0.8rem;
    font-family: 'Courier New', monospace;
  }

  .more-captures {
    text-align: center;
    color: #666;
    font-size: 0.85rem;
    padding-top: 0.5rem;
  }

  @media (max-width: 768px) {
    .status-container {
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

    .btn {
      width: 100%;
    }

    .status-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

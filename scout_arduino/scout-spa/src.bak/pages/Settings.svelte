<script>
  import { createEventDispatcher, onMount } from 'svelte';

  export let status = null;

  const dispatch = createEventDispatcher();
  let motionConfig = {
    threshold: 25,
    min_size: 1.0,
    max_size: 30.0
  };
  let saving = false;
  let logs = [];

  onMount(async () => {
    await loadMotionConfig();
    await loadLogs();
  });

  async function loadMotionConfig() {
    try {
      const res = await fetch('/api/motion/config');
      motionConfig = await res.json();
    } catch (e) {
      console.error('Failed to load motion config:', e);
    }
  }

  async function saveMotionConfig() {
    saving = true;
    try {
      await fetch('/api/motion/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(motionConfig)
      });
      dispatch('refresh');
    } catch (e) {
      console.error('Failed to save motion config:', e);
    }
    saving = false;
  }

  async function loadLogs() {
    try {
      const res = await fetch('/api/logs');
      logs = await res.json();
    } catch (e) {
      console.error('Failed to load logs:', e);
    }
  }

  async function reboot() {
    if (confirm('Reboot the device?')) {
      await fetch('/api/reboot', { method: 'POST' });
    }
  }
</script>

<div class="container">
  <!-- Motion Detection Settings -->
  <div class="card">
    <div class="card-title">Motion Detection</div>

    <div class="setting-group">
      <label class="label">
        Sensitivity Threshold: {motionConfig.threshold}
      </label>
      <input
        type="range"
        class="range-input"
        min="5"
        max="100"
        bind:value={motionConfig.threshold}
      />
      <small>Lower = more sensitive</small>
    </div>

    <div class="setting-group">
      <label class="label">
        Minimum Size: {motionConfig.min_size.toFixed(1)}%
      </label>
      <input
        type="range"
        class="range-input"
        min="0.5"
        max="10"
        step="0.5"
        bind:value={motionConfig.min_size}
      />
      <small>Ignore motion smaller than this (dust, insects)</small>
    </div>

    <div class="setting-group">
      <label class="label">
        Maximum Size: {motionConfig.max_size.toFixed(1)}%
      </label>
      <input
        type="range"
        class="range-input"
        min="10"
        max="80"
        step="5"
        bind:value={motionConfig.max_size}
      />
      <small>Ignore motion larger than this (people, pets)</small>
    </div>

    <button class="btn btn-primary" style="width: 100%;" on:click={saveMotionConfig} disabled={saving}>
      {saving ? 'Saving...' : 'Save Settings'}
    </button>
  </div>

  <!-- Device Info -->
  {#if status}
    <div class="card">
      <div class="card-title">Device Info</div>
      <div class="stat-row">
        <span class="stat-label">MAC Address</span>
        <span class="stat-value">{status.mac}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Firmware</span>
        <span class="stat-value">{status.firmware_version}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Filesystem</span>
        <span class="stat-value">{status.filesystem_version}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Free Heap</span>
        <span class="stat-value">{Math.round(status.heap_free / 1024)} KB</span>
      </div>
    </div>
  {/if}

  <!-- System Log -->
  <div class="card">
    <div class="card-title">System Log</div>
    <div class="log-container">
      {#each logs as log}
        <div class="log-entry">{log}</div>
      {/each}
      {#if logs.length === 0}
        <div class="empty-state">No log entries</div>
      {/if}
    </div>
    <button class="btn btn-secondary" style="width: 100%; margin-top: 0.5rem;" on:click={loadLogs}>
      Refresh Logs
    </button>
  </div>

  <!-- Actions -->
  <div class="card">
    <div class="card-title">Actions</div>
    <button class="btn btn-secondary" style="width: 100%; margin-bottom: 0.5rem;" on:click={reboot}>
      Reboot Device
    </button>
    <a href="/update" class="btn btn-secondary" style="width: 100%; text-decoration: none;">
      Firmware Update (OTA)
    </a>
  </div>
</div>

<style>
  .setting-group {
    margin-bottom: 1.5rem;
  }

  .setting-group small {
    color: var(--text-secondary);
    font-size: 0.8rem;
  }

  .log-container {
    max-height: 200px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 0.75rem;
    background: var(--bg-secondary);
    border-radius: 4px;
    padding: 0.5rem;
  }

  .log-entry {
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--border);
  }

  .log-entry:last-child {
    border-bottom: none;
  }
</style>

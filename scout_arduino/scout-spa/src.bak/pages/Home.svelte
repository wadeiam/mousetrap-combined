<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';

  export let status = null;

  const dispatch = createEventDispatcher();
  let liveImage = null;
  let refreshInterval;

  onMount(() => {
    refreshInterval = setInterval(() => {
      dispatch('refresh');
      refreshLiveImage();
    }, 5000);
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  async function refreshLiveImage() {
    liveImage = `/api/capture?t=${Date.now()}`;
  }

  function formatUptime(seconds) {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
</script>

<div class="container">
  <!-- Live Camera View -->
  <div class="card">
    <div class="card-title">Live View</div>
    {#if liveImage}
      <img src={liveImage} alt="Live camera" class="live-image" />
    {:else}
      <div class="live-placeholder" on:click={refreshLiveImage}>
        <span>Tap to load camera</span>
      </div>
    {/if}
    <button class="btn btn-secondary" style="width: 100%; margin-top: 0.5rem;" on:click={refreshLiveImage}>
      Refresh
    </button>
  </div>

  <!-- Status -->
  <div class="card">
    <div class="card-title">Status</div>
    {#if status}
      <div class="stat-row">
        <span class="stat-label">Device</span>
        <span class="stat-value">{status.device_name || 'Scout'}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">MQTT</span>
        <span class="stat-value">
          <span class="status-dot" class:online={status.mqtt_connected} class:offline={!status.mqtt_connected}></span>
          {status.mqtt_connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Motion Events</span>
        <span class="stat-value">{status.motion_events || 0}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Uptime</span>
        <span class="stat-value">{formatUptime(status.uptime)}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">WiFi Signal</span>
        <span class="stat-value">{status.rssi} dBm</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">IP Address</span>
        <span class="stat-value">{status.ip}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Firmware</span>
        <span class="stat-value">{status.firmware_version}</span>
      </div>
    {:else}
      <div class="loading">
        <div class="spinner"></div>
      </div>
    {/if}
  </div>

  <!-- Motion Config Summary -->
  {#if status?.motion_config}
    <div class="card">
      <div class="card-title">Motion Detection</div>
      <div class="stat-row">
        <span class="stat-label">Threshold</span>
        <span class="stat-value">{status.motion_config.threshold}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Size Filter</span>
        <span class="stat-value">{status.motion_config.min_size}% - {status.motion_config.max_size}%</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .live-image {
    width: 100%;
    border-radius: 8px;
  }

  .live-placeholder {
    width: 100%;
    aspect-ratio: 4/3;
    background: var(--bg-secondary);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    cursor: pointer;
  }
</style>

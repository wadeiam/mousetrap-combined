<script>
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';
  import LoadingSpinner from '../components/LoadingSpinner.svelte';
  import { scanWiFiNetworks, updateWiFi } from '../lib/api.js';

  let loading = true;
  let scanning = false;
  let saving = false;
  let error = null;
  let success = null;

  // WiFi form fields
  let ssid = '';
  let password = '';
  let showPassword = false;

  // Available networks
  let networks = [];
  let showNetworkList = false;

  onMount(async () => {
    await scanNetworks();
    loading = false;
  });

  async function scanNetworks() {
    scanning = true;
    error = null;

    try {
      const result = await scanWiFiNetworks(true);
      networks = result.networks || [];
      console.log('[WIFI] Found networks:', networks);
    } catch (err) {
      console.error('[WIFI] Scan error:', err);
      // Non-fatal - user can still enter SSID manually
      networks = [];
    }

    scanning = false;
  }

  function selectNetwork(network) {
    ssid = network.ssid;
    showNetworkList = false;
  }

  async function handleSubmit() {
    error = null;
    success = null;

    if (!ssid.trim()) {
      error = 'Please enter or select a WiFi network';
      return;
    }

    if (password.length < 8) {
      error = 'Password must be at least 8 characters';
      return;
    }

    saving = true;

    try {
      await updateWiFi({ ssid: ssid.trim(), password });
      // If we get here, request succeeded before device rebooted
      success = 'WiFi credentials saved. Device is restarting...';
    } catch (err) {
      // The device reboots immediately after saving, which causes the fetch to fail
      // This is expected behavior - treat network errors as success
      const errorMsg = err.message || '';
      if (errorMsg.includes('Failed to fetch') ||
          errorMsg.includes('NetworkError') ||
          errorMsg.includes('network') ||
          errorMsg.includes('Load failed')) {
        // Device likely rebooted - this is expected
        success = 'WiFi credentials saved. Device is restarting...';
      } else {
        error = err.message || 'Failed to update WiFi settings';
        saving = false;
        return;
      }
    }

    saving = false;
  }

  function getSignalIcon(rssi) {
    if (rssi >= -50) return '████';
    if (rssi >= -60) return '███░';
    if (rssi >= -70) return '██░░';
    return '█░░░';
  }
</script>

<div class="wifi-container">
  <div class="header">
    <h1>WiFi Settings</h1>
    <p class="subtitle">Update your WiFi connection without losing device registration</p>
  </div>

  {#if loading}
    <div class="loading-container">
      <LoadingSpinner />
      <p>Scanning for networks...</p>
    </div>
  {:else if success}
    <Card>
      <div class="success-message">
        <div class="success-icon">✓</div>
        <h2>Success!</h2>
        <p>{success}</p>
        <p class="reconnect-info">
          The device is restarting. Once it connects to your WiFi network,
          you can access it at its new IP address.
        </p>
      </div>
    </Card>
  {:else}
    <Card title="Update WiFi Network">
      <div class="form-section">
        {#if error}
          <div class="error-text">{error}</div>
        {/if}

        <div class="form-group">
          <label for="ssid">WiFi Network (SSID)</label>
          <div class="ssid-input-group">
            <input
              id="ssid"
              type="text"
              bind:value={ssid}
              placeholder="Enter network name"
              disabled={saving}
            />
            <button
              type="button"
              class="btn-secondary scan-btn"
              on:click={() => showNetworkList = !showNetworkList}
              disabled={saving}
            >
              {showNetworkList ? 'Hide' : 'Browse'}
            </button>
          </div>
        </div>

        {#if showNetworkList}
          <div class="network-list">
            <div class="network-list-header">
              <span>Available Networks</span>
              <button
                type="button"
                class="btn-link"
                on:click={scanNetworks}
                disabled={scanning}
              >
                {scanning ? 'Scanning...' : 'Rescan'}
              </button>
            </div>
            {#if scanning}
              <div class="scanning">
                <LoadingSpinner size="small" />
                <span>Scanning...</span>
              </div>
            {:else if networks.length === 0}
              <div class="no-networks">
                No networks found. Try rescanning or enter SSID manually.
              </div>
            {:else}
              {#each networks as network}
                <button
                  type="button"
                  class="network-item"
                  class:selected={ssid === network.ssid}
                  on:click={() => selectNetwork(network)}
                >
                  <span class="network-name">{network.ssid}</span>
                  <span class="network-info">
                    <span class="signal">{getSignalIcon(network.rssi)}</span>
                    {#if network.secure}
                      <span class="lock">🔒</span>
                    {/if}
                  </span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}

        <div class="form-group">
          <label for="password">Password</label>
          <div class="password-input-group">
            {#if showPassword}
              <input
                id="password"
                type="text"
                bind:value={password}
                placeholder="Enter WiFi password"
                disabled={saving}
              />
            {:else}
              <input
                id="password"
                type="password"
                bind:value={password}
                placeholder="Enter WiFi password"
                disabled={saving}
              />
            {/if}
            <button
              type="button"
              class="toggle-password"
              on:click={() => showPassword = !showPassword}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <div class="help-text">Minimum 8 characters</div>
        </div>

        <div class="warning-text">
          The device will restart after saving. You may need to reconnect
          to the new network to continue using the device.
        </div>

        <button
          type="button"
          class="btn-primary"
          on:click={handleSubmit}
          disabled={saving || !ssid.trim() || password.length < 8}
        >
          {saving ? 'Saving...' : 'Update WiFi Settings'}
        </button>
      </div>
    </Card>

    <div class="back-link">
      <a href="/">← Back to Dashboard</a>
    </div>
  {/if}
</div>

<style>
  .wifi-container {
    padding: 2rem;
    max-width: 600px;
    margin: 0 auto;
  }

  .header {
    margin-bottom: 2rem;
    text-align: center;
  }

  .header h1 {
    color: #ddd;
    font-size: 2rem;
    margin: 0 0 0.5rem 0;
  }

  .subtitle {
    color: #888;
    margin: 0;
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 300px;
    gap: 1rem;
    color: #888;
  }

  .success-message {
    text-align: center;
    padding: 2rem;
  }

  .success-icon {
    width: 60px;
    height: 60px;
    background: #2d5a2d;
    color: #4ade80;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    margin: 0 auto 1rem;
  }

  .success-message h2 {
    color: #4ade80;
    margin: 0 0 1rem 0;
  }

  .success-message p {
    color: #ddd;
    margin: 0 0 0.5rem 0;
  }

  .reconnect-info {
    color: #888;
    font-size: 0.9rem;
    margin-top: 1rem !important;
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    color: #ddd;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .form-group input[type="text"],
  .form-group input[type="password"] {
    background: #1a1a1a;
    border: 1px solid #444;
    color: #ddd;
    padding: 0.75rem;
    border-radius: 4px;
    font-size: 0.95rem;
    flex: 1;
  }

  .form-group input:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .form-group input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ssid-input-group,
  .password-input-group {
    display: flex;
    gap: 0.5rem;
  }

  .scan-btn {
    white-space: nowrap;
  }

  .toggle-password {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ddd;
    padding: 0.75rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    white-space: nowrap;
  }

  .toggle-password:hover {
    background: #333;
  }

  .network-list {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    max-height: 250px;
    overflow-y: auto;
  }

  .network-list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #333;
    color: #888;
    font-size: 0.85rem;
  }

  .btn-link {
    background: none;
    border: none;
    color: #4a9eff;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0;
  }

  .btn-link:hover:not(:disabled) {
    text-decoration: underline;
  }

  .btn-link:disabled {
    color: #666;
    cursor: not-allowed;
  }

  .scanning {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    color: #888;
  }

  .no-networks {
    padding: 1rem;
    text-align: center;
    color: #666;
  }

  .network-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    border-bottom: 1px solid #333;
    color: #ddd;
    cursor: pointer;
    text-align: left;
  }

  .network-item:last-child {
    border-bottom: none;
  }

  .network-item:hover {
    background: #222;
  }

  .network-item.selected {
    background: #1a3a5a;
  }

  .network-name {
    font-weight: 500;
  }

  .network-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .signal {
    font-family: monospace;
    color: #4ade80;
    letter-spacing: -2px;
  }

  .lock {
    font-size: 0.75rem;
  }

  .help-text {
    color: #888;
    font-size: 0.85rem;
  }

  .warning-text {
    color: #ff9f43;
    font-size: 0.9rem;
    padding: 0.75rem;
    background: #2a2410;
    border-radius: 4px;
    border-left: 3px solid #ff9f43;
  }

  .error-text {
    color: #ff6b6b;
    font-size: 0.9rem;
    padding: 0.75rem;
    background: #2a1010;
    border-radius: 4px;
    border-left: 3px solid #ff6b6b;
  }

  .btn-primary,
  .btn-secondary {
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .btn-primary {
    background: #4a9eff;
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #3a8eef;
  }

  .btn-primary:disabled {
    background: #2a5a8f;
    cursor: not-allowed;
    opacity: 0.6;
  }

  .btn-secondary {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #444;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #333;
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .back-link {
    text-align: center;
    margin-top: 2rem;
  }

  .back-link a {
    color: #4a9eff;
    text-decoration: none;
  }

  .back-link a:hover {
    text-decoration: underline;
  }

  @media (max-width: 480px) {
    .wifi-container {
      padding: 1rem;
    }

    .ssid-input-group,
    .password-input-group {
      flex-direction: column;
    }

    .scan-btn,
    .toggle-password {
      width: 100%;
    }
  }
</style>

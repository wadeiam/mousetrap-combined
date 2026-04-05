<script>
  import { onMount, onDestroy } from 'svelte';
  import { getSystemInfo, reboot } from '../lib/api.js';
  import Card from '../components/Card.svelte';
  import LoadingSpinner from '../components/LoadingSpinner.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';

  let systemInfo = null;
  let loading = true;
  let error = null;

  let showRebootConfirm = false;
  let rebootCountdown = 0;
  let rebooting = false;
  let checkingOnline = false;
  let backOnline = false;

  let countdownInterval = null;
  let healthCheckInterval = null;
  let autoRefreshInterval = null;

  onMount(async () => {
    await loadSystemInfo();

    // Auto-refresh system info every 30 seconds
    autoRefreshInterval = setInterval(async () => {
      if (!rebooting && !showRebootConfirm) {
        await loadSystemInfo();
      }
    }, 30000);
  });

  onDestroy(() => {
    if (countdownInterval) clearInterval(countdownInterval);
    if (healthCheckInterval) clearInterval(healthCheckInterval);
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  });

  async function loadSystemInfo() {
    loading = true;
    error = null;
    try {
      systemInfo = await getSystemInfo();
    } catch (err) {
      // Non-fatal - just log and continue without system info
      console.warn('Failed to load system info:', err);
      systemInfo = null;
    } finally {
      loading = false;
    }
  }

  function openOTA() {
    window.open('/update', '_blank');
  }

  function confirmReboot() {
    showRebootConfirm = true;
    rebootCountdown = 3;

    countdownInterval = setInterval(() => {
      rebootCountdown--;
      if (rebootCountdown <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        executeReboot();
      }
    }, 1000);
  }

  function cancelReboot() {
    showRebootConfirm = false;
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    rebootCountdown = 0;
  }

  async function executeReboot() {
    showRebootConfirm = false;
    rebooting = true;

    try {
      await reboot();
    } catch (err) {
      // Expected to fail as device reboots immediately
    }

    // Wait 5 seconds before starting health checks
    setTimeout(() => {
      checkingOnline = true;
      startHealthCheck();
    }, 5000);
  }

  function startHealthCheck() {
    healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch('/status', {
          method: 'GET',
          cache: 'no-cache'
        });

        if (response.ok) {
          clearInterval(healthCheckInterval);
          healthCheckInterval = null;
          checkingOnline = false;
          rebooting = false;
          backOnline = true;

          // Reload system info
          await loadSystemInfo();

          // Clear "back online" message after 5 seconds
          setTimeout(() => {
            backOnline = false;
          }, 5000);
        }
      } catch (err) {
        // Still offline, keep checking
      }
    }, 2000);
  }

  function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }

  function formatFrequency(mhz) {
    if (!mhz) return 'N/A';
    return `${mhz} MHz`;
  }

  function formatTimestamp(unixTimestamp) {
    if (!unixTimestamp || unixTimestamp === 0) return 'Never';
    const date = new Date(unixTimestamp * 1000);
    return date.toLocaleString();
  }
</script>

<div class="firmware-container">
  <h1>Firmware & Updates</h1>

  {#if loading}
    <div class="loading-container">
      <LoadingSpinner />
    </div>
  {:else}
    {#if backOnline}
      <div class="online-banner">
        Device is back online!
      </div>
    {/if}

    <div class="cards-grid">
      <!-- Current Firmware Card -->
      <Card>
        <h2>ESP32 Sketch</h2>
        <div class="firmware-version">
          {systemInfo?.firmwareVersion || 'Unknown'}
        </div>
        {#if systemInfo?.buildDate}
          <div class="build-date">
            Built: {systemInfo.buildDate}
          </div>
        {/if}

        <div class="device-info">
          <table>
            <tbody>
              {#if systemInfo?.chipModel}
                <tr>
                  <td class="label">Chip Model</td>
                  <td class="value">{systemInfo.chipModel}</td>
                </tr>
              {/if}
              {#if systemInfo?.cpuFreq}
                <tr>
                  <td class="label">CPU Frequency</td>
                  <td class="value">{formatFrequency(systemInfo.cpuFreq)}</td>
                </tr>
              {/if}
              {#if systemInfo?.flashSize}
                <tr>
                  <td class="label">Flash Size</td>
                  <td class="value">{formatBytes(systemInfo.flashSize)}</td>
                </tr>
              {/if}
              {#if systemInfo?.psramSize}
                <tr>
                  <td class="label">PSRAM Size</td>
                  <td class="value">{formatBytes(systemInfo.psramSize)}</td>
                </tr>
              {/if}
              {#if systemInfo?.macAddress}
                <tr>
                  <td class="label">MAC Address</td>
                  <td class="value">{systemInfo.macAddress}</td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      </Card>

      <!-- OTA Update Card -->
      <Card>
        <h2>OTA Update</h2>
        <p class="description">
          Upload new firmware via the web-based OTA interface.
        </p>

        <button class="ota-button" on:click={openOTA} disabled={rebooting}>
          Open OTA Update Interface
        </button>

        <div class="warning-text">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm1 12H7V7h2v5zm0-6H7V4h2v2z"/>
          </svg>
          Device will reboot after update
        </div>
      </Card>

      <!-- Reboot Card -->
      <Card>
        <h2>Device Reboot</h2>

        {#if rebooting}
          <div class="rebooting-container">
            <LoadingSpinner />
            <div class="rebooting-text">
              {#if checkingOnline}
                Waiting for device to come back online...
              {:else}
                Rebooting device...
              {/if}
            </div>
          </div>
        {:else if showRebootConfirm}
          <div class="confirm-container">
            <p class="confirm-text">
              Are you sure you want to reboot the device?
            </p>
            <div class="countdown">
              Rebooting in {rebootCountdown} second{rebootCountdown !== 1 ? 's' : ''}...
            </div>
            <button class="cancel-button" on:click={cancelReboot}>
              Cancel
            </button>
          </div>
        {:else}
          <p class="description">
            Restart the device to apply configuration changes or recover from errors.
          </p>

          <button class="reboot-button" on:click={confirmReboot}>
            Reboot Device
          </button>

          <div class="warning-text">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm1 12H7V7h2v5zm0-6H7V4h2v2z"/>
            </svg>
            Device will be unavailable for approximately 30 seconds
          </div>
        {/if}
      </Card>

      <!-- Version Information Card -->
      <Card>
        <h2>Version Information</h2>
        {#if systemInfo}
          <div class="update-history">
            <div class="history-item">
              <div class="history-label">Sketch Version:</div>
              <div class="history-value">{systemInfo.firmwareVersion || 'Unknown'}</div>
            </div>
            <div class="timestamp-item">
              <div class="timestamp-label">Last Firmware Update:</div>
              <div class="timestamp-value">{formatTimestamp(systemInfo.firmwareUpdateTime)}</div>
            </div>
            {#if systemInfo.filesystemVersion}
              <div class="history-item">
                <div class="history-label">Svelte App Version:</div>
                <div class="history-value">{systemInfo.filesystemVersion}</div>
              </div>
            {/if}
            <div class="timestamp-item">
              <div class="timestamp-label">Last Filesystem Update:</div>
              <div class="timestamp-value">{formatTimestamp(systemInfo.filesystemUpdateTime)}</div>
            </div>
            {#if systemInfo.sdkVersion}
              <div class="history-item">
                <div class="history-label">ESP32 SDK:</div>
                <div class="history-value">{systemInfo.sdkVersion}</div>
              </div>
            {/if}
          </div>
        {:else}
          <p class="placeholder-text">
            No version information available
          </p>
        {/if}
      </Card>
    </div>
  {/if}
</div>

<style>
  .firmware-container {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  h1 {
    color: #ddd;
    margin-bottom: 2rem;
    font-size: 2rem;
  }

  h2 {
    color: #ddd;
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.25rem;
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
  }

  .online-banner {
    background-color: #4CAF50;
    color: white;
    padding: 1rem;
    border-radius: 4px;
    margin-bottom: 1.5rem;
    text-align: center;
    font-weight: 500;
    animation: slideDown 0.3s ease-out;
  }

  @keyframes slideDown {
    from {
      transform: translateY(-20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .firmware-version {
    font-size: 2rem;
    font-weight: bold;
    color: #4CAF50;
    margin: 1rem 0;
  }

  .build-date {
    color: #999;
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
  }

  .device-info {
    margin-top: 1.5rem;
  }

  .device-info table {
    width: 100%;
    border-collapse: collapse;
  }

  .device-info tr {
    border-bottom: 1px solid #333;
  }

  .device-info tr:last-child {
    border-bottom: none;
  }

  .device-info td {
    padding: 0.75rem 0;
    color: #ddd;
  }

  .device-info .label {
    font-weight: 500;
    color: #999;
    width: 45%;
  }

  .device-info .value {
    text-align: right;
    font-family: 'Courier New', monospace;
  }

  .description {
    color: #999;
    margin-bottom: 1.5rem;
    line-height: 1.5;
  }

  .ota-button {
    width: 100%;
    padding: 1rem;
    font-size: 1.1rem;
    font-weight: 600;
    background-color: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
    margin-bottom: 1rem;
  }

  .ota-button:hover:not(:disabled) {
    background-color: #45a049;
  }

  .ota-button:disabled {
    background-color: #555;
    cursor: not-allowed;
    opacity: 0.5;
  }

  .reboot-button {
    width: 100%;
    padding: 1rem;
    font-size: 1.1rem;
    font-weight: 600;
    background-color: #ff9800;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
    margin-bottom: 1rem;
  }

  .reboot-button:hover {
    background-color: #e68900;
  }

  .warning-text {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #ff9800;
    font-size: 0.9rem;
    padding: 0.75rem;
    background-color: rgba(255, 152, 0, 0.1);
    border-radius: 4px;
  }

  .confirm-container {
    text-align: center;
  }

  .confirm-text {
    color: #ddd;
    font-size: 1rem;
    margin-bottom: 1rem;
  }

  .countdown {
    font-size: 1.5rem;
    font-weight: bold;
    color: #ff9800;
    margin: 1.5rem 0;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  .cancel-button {
    padding: 0.75rem 2rem;
    font-size: 1rem;
    font-weight: 600;
    background-color: #666;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .cancel-button:hover {
    background-color: #555;
  }

  .rebooting-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 0;
  }

  .rebooting-text {
    margin-top: 1rem;
    color: #999;
    font-size: 1rem;
  }

  .placeholder-text {
    color: #666;
    font-style: italic;
    text-align: center;
    padding: 2rem 0;
  }

  .update-history {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .history-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0;
    border-bottom: 1px solid #333;
  }

  .history-item:last-child {
    border-bottom: none;
  }

  .history-label {
    color: #999;
    font-weight: 500;
  }

  .history-value {
    color: #4CAF50;
    font-family: 'Courier New', monospace;
    font-weight: 600;
  }

  .timestamp-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    padding-left: 1rem;
    border-left: 2px solid #333;
  }

  .timestamp-label {
    color: #777;
    font-size: 0.85rem;
  }

  .timestamp-value {
    color: #888;
    font-size: 0.85rem;
    font-family: 'Courier New', monospace;
  }

  @media (max-width: 768px) {
    .firmware-container {
      padding: 1rem;
    }

    h1 {
      font-size: 1.5rem;
    }

    .cards-grid {
      grid-template-columns: 1fr;
    }

    .firmware-version {
      font-size: 1.5rem;
    }
  }
</style>

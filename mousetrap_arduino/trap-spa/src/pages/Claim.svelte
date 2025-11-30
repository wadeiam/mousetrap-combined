<script>
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';
  import LoadingSpinner from '../components/LoadingSpinner.svelte';
  import { getClaimStatus, getSystemInfo, claimDevice, unclaimDevice } from '../lib/api.js';

  let loading = true;
  let error = null;
  let claimStatus = null;
  let systemInfo = null;
  let claimCode = '';
  let message = '';
  let messageType = ''; // 'success' or 'error'
  let processing = false;

  onMount(async () => {
    await loadClaimInfo();
  });

  async function loadClaimInfo() {
    loading = true;
    error = null;

    try {
      const [claim, system] = await Promise.all([
        getClaimStatus(),
        getSystemInfo().catch(() => null)
      ]);

      claimStatus = claim;
      systemInfo = system;
    } catch (err) {
      console.error('Failed to load claim info:', err);
      error = err.message || 'Failed to load claim status';
    }

    loading = false;
  }

  async function handleClaim() {
    if (!claimCode.trim()) {
      message = 'Please enter a claim code';
      messageType = 'error';
      return;
    }

    processing = true;
    message = '';

    try {
      const result = await claimDevice(claimCode.trim().toUpperCase());
      if (result.success) {
        message = result.message || 'Device claimed successfully!';
        messageType = 'success';
        claimCode = '';
        setTimeout(loadClaimInfo, 2000);
      } else {
        message = result.error || 'Claim failed';
        messageType = 'error';
      }
    } catch (err) {
      console.error('Claim error:', err);
      message = 'Claim failed: ' + err.message;
      messageType = 'error';
    } finally {
      processing = false;
    }
  }

  async function handleUnclaim() {
    if (!confirm('Are you sure you want to unclaim this device? This will clear all credentials and the device will need to be reclaimed.')) {
      return;
    }

    processing = true;
    message = '';

    try {
      const result = await unclaimDevice();
      if (result.success) {
        message = result.message || 'Device unclaimed successfully';
        messageType = 'success';
        setTimeout(loadClaimInfo, 2000);
      } else {
        message = result.error || 'Unclaim failed';
        messageType = 'error';
      }
    } catch (err) {
      console.error('Unclaim error:', err);
      message = 'Unclaim failed: ' + err.message;
      messageType = 'error';
    } finally {
      processing = false;
    }
  }
</script>

<div class="claim-container">
  <div class="header">
    <h1>Device Registration</h1>
    <p class="subtitle">View and manage device claim status</p>
  </div>

  {#if loading}
    <div class="loading-container">
      <LoadingSpinner />
      <p>Loading claim status...</p>
    </div>
  {:else if error}
    <Card>
      <div class="error-state">
        <div class="error-icon">!</div>
        <h2>Error</h2>
        <p>{error}</p>
        <button class="btn-primary" on:click={loadClaimInfo}>Retry</button>
      </div>
    </Card>
  {:else}
    <div class="cards-grid">
      <!-- Claim Status Card -->
      <Card title="Claim Status">
        <div class="status-section">
          <div class="status-indicator" class:claimed={claimStatus?.claimed} class:unclaimed={!claimStatus?.claimed}>
            <span class="status-icon">{claimStatus?.claimed ? '✓' : '○'}</span>
            <span class="status-text">{claimStatus?.claimed ? 'Claimed' : 'Not Claimed'}</span>
          </div>

          {#if claimStatus?.claimed}
            <div class="info-grid">
              {#if claimStatus.deviceName}
                <div class="info-row">
                  <span class="label">Device Name</span>
                  <span class="value">{claimStatus.deviceName}</span>
                </div>
              {/if}
              {#if claimStatus.tenantId}
                <div class="info-row">
                  <span class="label">Tenant ID</span>
                  <span class="value mono">{claimStatus.tenantId.substring(0, 8)}...</span>
                </div>
              {/if}
              {#if claimStatus.deviceId}
                <div class="info-row">
                  <span class="label">Device ID</span>
                  <span class="value mono">{claimStatus.deviceId.substring(0, 8)}...</span>
                </div>
              {/if}
            </div>
          {:else}
            <div class="claim-form">
              <p class="claim-instructions">Enter the claim code from your dashboard:</p>
              <input
                type="text"
                bind:value={claimCode}
                placeholder="Claim Code"
                maxlength="8"
                class="claim-input"
                disabled={processing}
              />
              <button
                class="btn-claim"
                on:click={handleClaim}
                disabled={processing || !claimCode.trim()}
              >
                {processing ? 'Claiming...' : 'Claim Device'}
              </button>
            </div>
          {/if}

          {#if message}
            <div class="message-box" class:success={messageType === 'success'} class:error={messageType === 'error'}>
              {message}
            </div>
          {/if}
        </div>
      </Card>

      <!-- Connection Status Card -->
      <Card title="Connection Status">
        <div class="connection-section">
          <div class="connection-item">
            <span class="connection-label">MQTT</span>
            <span class="connection-status" class:connected={claimStatus?.mqttConnected} class:disconnected={!claimStatus?.mqttConnected}>
              {claimStatus?.mqttConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>

        {#if !claimStatus?.claimed}
          <div class="info-box">
            <p>Device must be claimed before it can connect to the server.</p>
          </div>
        {:else if !claimStatus?.mqttConnected}
          <div class="warning-box">
            <p>Device is claimed but not connected to the server. Check your network connection.</p>
          </div>
        {/if}
      </Card>

      <!-- Device Identity Card -->
      <Card title="Device Identity">
        <div class="identity-section">
          {#if systemInfo?.macAddress || claimStatus?.macAddress}
            <div class="info-row">
              <span class="label">MAC Address</span>
              <span class="value mono">{systemInfo?.macAddress || claimStatus?.macAddress}</span>
            </div>
          {/if}
          {#if systemInfo?.firmwareVersion}
            <div class="info-row">
              <span class="label">Firmware</span>
              <span class="value">{systemInfo.firmwareVersion}</span>
            </div>
          {/if}
          {#if systemInfo?.chipModel}
            <div class="info-row">
              <span class="label">Chip</span>
              <span class="value">{systemInfo.chipModel}</span>
            </div>
          {/if}
        </div>
      </Card>

      <!-- Help Card -->
      <Card title={claimStatus?.claimed ? "Device Actions" : "Need Help?"}>
        <div class="help-section">
          {#if !claimStatus?.claimed}
            <h3>How to Claim This Device</h3>
            <ol class="help-steps">
              <li>Open the MouseTrap mobile app or web dashboard</li>
              <li>Navigate to "Add Device"</li>
              <li>Enter the claim code above</li>
              <li>The device will connect automatically once claimed</li>
            </ol>
          {:else}
            <h3>Unclaim Device</h3>
            <p class="unclaim-warning">
              Unclaiming will clear all credentials. The device will need to be reclaimed to connect to the server again.
            </p>
            <button
              class="btn-unclaim"
              on:click={handleUnclaim}
              disabled={processing}
            >
              {processing ? 'Processing...' : 'Unclaim Device'}
            </button>
          {/if}
        </div>
      </Card>
    </div>

    <div class="back-link">
      <a href="#/">← Back to Dashboard</a>
    </div>
  {/if}
</div>

<style>
  .claim-container {
    padding: 2rem;
    max-width: 1200px;
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

  .cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .error-state {
    text-align: center;
    padding: 2rem;
  }

  .error-icon {
    width: 60px;
    height: 60px;
    background: #5a2d2d;
    color: #ff6b6b;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    font-weight: bold;
    margin: 0 auto 1rem;
  }

  .error-state h2 {
    color: #ff6b6b;
    margin: 0 0 1rem 0;
  }

  .error-state p {
    color: #ddd;
    margin: 0 0 1.5rem 0;
  }

  .status-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 8px;
  }

  .status-indicator.claimed {
    background: #1a3a1a;
    border: 1px solid #2d5a2d;
  }

  .status-indicator.unclaimed {
    background: #3a3a1a;
    border: 1px solid #5a5a2d;
  }

  .status-icon {
    font-size: 1.5rem;
  }

  .status-indicator.claimed .status-icon {
    color: #4ade80;
  }

  .status-indicator.unclaimed .status-icon {
    color: #facc15;
  }

  .status-text {
    font-size: 1.25rem;
    font-weight: 600;
    color: #ddd;
  }

  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0;
    border-bottom: 1px solid #333;
  }

  .info-row:last-child {
    border-bottom: none;
  }

  .label {
    color: #888;
    font-size: 0.9rem;
  }

  .value {
    color: #ddd;
    font-weight: 500;
  }

  .value.mono {
    font-family: 'Courier New', monospace;
    font-size: 0.9rem;
  }

  .unclaimed-message {
    color: #888;
    font-size: 0.95rem;
    line-height: 1.5;
    margin: 0;
  }

  .connection-section {
    margin-bottom: 1rem;
  }

  .connection-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: #1a1a1a;
    border-radius: 4px;
  }

  .connection-label {
    color: #888;
    font-weight: 500;
  }

  .connection-status {
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .connection-status.connected {
    background: #1a3a1a;
    color: #4ade80;
  }

  .connection-status.disconnected {
    background: #3a1a1a;
    color: #f87171;
  }

  .info-box {
    padding: 0.75rem;
    background: #1a2a3a;
    border-left: 3px solid #4a9eff;
    border-radius: 4px;
    color: #888;
    font-size: 0.9rem;
  }

  .info-box p {
    margin: 0;
  }

  .warning-box {
    padding: 0.75rem;
    background: #3a2a1a;
    border-left: 3px solid #ff9f43;
    border-radius: 4px;
    color: #ff9f43;
    font-size: 0.9rem;
  }

  .warning-box p {
    margin: 0;
  }

  .identity-section {
    display: flex;
    flex-direction: column;
  }

  .help-section h3 {
    color: #ddd;
    font-size: 1rem;
    margin: 0 0 1rem 0;
  }

  .help-steps {
    color: #888;
    margin: 0;
    padding-left: 1.25rem;
    line-height: 1.8;
  }

  .help-steps li {
    margin-bottom: 0.5rem;
  }

  .help-list {
    color: #888;
    margin: 0;
    padding-left: 1.25rem;
    line-height: 1.8;
    list-style-type: disc;
  }

  .help-list li {
    margin-bottom: 0.5rem;
  }

  .btn-primary {
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    background: #4a9eff;
    color: #fff;
  }

  .btn-primary:hover {
    background: #3a8eef;
  }

  .claim-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .claim-instructions {
    color: #888;
    margin: 0;
    font-size: 0.95rem;
  }

  .claim-input {
    padding: 0.875rem 1rem;
    font-size: 1.25rem;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    background: #2a2a2a;
    border: 2px solid #444;
    border-radius: 6px;
    color: #fff;
  }

  .claim-input:focus {
    outline: none;
    border-color: #4CAF50;
  }

  .claim-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-claim {
    padding: 0.875rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    background: #4CAF50;
    color: white;
  }

  .btn-claim:hover:not(:disabled) {
    background: #43A047;
  }

  .btn-claim:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-unclaim {
    width: 100%;
    padding: 0.875rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    background: #f44336;
    color: white;
  }

  .btn-unclaim:hover:not(:disabled) {
    background: #D32F2F;
  }

  .btn-unclaim:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .unclaim-warning {
    color: #888;
    font-size: 0.9rem;
    margin: 0 0 1rem 0;
    line-height: 1.5;
  }

  .message-box {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    text-align: center;
    font-size: 0.95rem;
  }

  .message-box.success {
    background: rgba(76, 175, 80, 0.15);
    color: #4ade80;
    border: 1px solid #4CAF50;
  }

  .message-box.error {
    background: rgba(244, 67, 54, 0.15);
    color: #f87171;
    border: 1px solid #f44336;
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

  @media (max-width: 768px) {
    .claim-container {
      padding: 1rem;
    }

    .cards-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

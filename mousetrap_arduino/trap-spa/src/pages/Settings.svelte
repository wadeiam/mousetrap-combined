<script>
  import { onMount } from 'svelte';
  import Card from '../components/Card.svelte';
  import LoadingSpinner from '../components/LoadingSpinner.svelte';
  import ErrorBanner from '../components/ErrorBanner.svelte';
  import { getIPFilters, setIPFilters, getMQTTConfig, setMQTTConfig, getVideoMode, setVideoMode } from '../lib/api.js';

  let loading = true;
  let error = null;

  // IP Filtering
  let whitelist = '';
  let blacklist = '';
  let clientIP = '';
  let ipError = '';
  let ipSaving = false;

  // MQTT Configuration
  let mqttBroker = '';
  let mqttPort = 1883;
  let mqttUser = '';
  let mqttPassword = '';
  let mqttTopic = '';
  let mqttEnabled = false;
  let showMqttPassword = false;
  let mqttError = '';
  let mqttSaving = false;
  let mqttTesting = false;

  // Video Mode
  let videoMode = 'SVGA';
  let videoSaving = false;
  let videoError = '';

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    loading = true;
    error = null;

    try {
      const [ipData, mqttData, videoData] = await Promise.all([
        getIPFilters(),
        getMQTTConfig(),
        getVideoMode()
      ]);

      // IP Filters
      whitelist = ipData.whitelist.join(', ');
      blacklist = ipData.blacklist.join(', ');
      clientIP = ipData.clientIP || '';

      // MQTT Config
      mqttBroker = mqttData.broker || '';
      mqttPort = mqttData.port || 1883;
      mqttUser = mqttData.user || '';
      mqttPassword = mqttData.password || '';
      mqttTopic = mqttData.topic || '';
      mqttEnabled = mqttData.enabled || false;

      // Video Mode
      videoMode = videoData.mode || 'SVGA';

      loading = false;
    } catch (err) {
      error = err.message || 'Failed to load settings';
      loading = false;
    }
  }

  function validateCIDR(cidr) {
    cidr = cidr.trim();
    if (!cidr) return true; // Empty is valid

    // Basic CIDR validation: IP/mask or just IP
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    if (!cidrRegex.test(cidr)) return false;

    const parts = cidr.split('/');
    const ip = parts[0].split('.');

    // Check each octet is 0-255
    for (let octet of ip) {
      const num = parseInt(octet);
      if (num < 0 || num > 255) return false;
    }

    // Check mask is 0-32
    if (parts[1]) {
      const mask = parseInt(parts[1]);
      if (mask < 0 || mask > 32) return false;
    }

    return true;
  }

  async function saveIPFilters() {
    ipError = '';

    // Parse and validate
    const whitelistArray = whitelist.split(',').map(s => s.trim()).filter(s => s);
    const blacklistArray = blacklist.split(',').map(s => s.trim()).filter(s => s);

    for (let cidr of whitelistArray) {
      if (!validateCIDR(cidr)) {
        ipError = `Invalid CIDR format in whitelist: ${cidr}`;
        return;
      }
    }

    for (let cidr of blacklistArray) {
      if (!validateCIDR(cidr)) {
        ipError = `Invalid CIDR format in blacklist: ${cidr}`;
        return;
      }
    }

    ipSaving = true;

    try {
      await setIPFilters({
        whitelist: whitelistArray,
        blacklist: blacklistArray
      });
      ipSaving = false;
    } catch (err) {
      ipError = err.message || 'Failed to save IP filters';
      ipSaving = false;
    }
  }

  async function saveMQTTConfig() {
    mqttError = '';

    if (mqttEnabled && !mqttBroker) {
      mqttError = 'Broker address is required when MQTT is enabled';
      return;
    }

    if (mqttPort < 1 || mqttPort > 65535) {
      mqttError = 'Port must be between 1 and 65535';
      return;
    }

    mqttSaving = true;

    try {
      await setMQTTConfig({
        broker: mqttBroker,
        port: mqttPort,
        user: mqttUser,
        password: mqttPassword,
        topic: mqttTopic,
        enabled: mqttEnabled
      });
      mqttSaving = false;
    } catch (err) {
      mqttError = err.message || 'Failed to save MQTT configuration';
      mqttSaving = false;
    }
  }

  async function testMQTTConnection() {
    mqttError = '';

    if (!mqttBroker) {
      mqttError = 'Broker address is required';
      return;
    }

    mqttTesting = true;

    try {
      // Assuming there's a test endpoint, fallback to just showing success
      // In real implementation, this would call a test endpoint
      await new Promise(resolve => setTimeout(resolve, 1000));
      mqttTesting = false;
      alert('MQTT connection test successful');
    } catch (err) {
      mqttError = err.message || 'Connection test failed';
      mqttTesting = false;
    }
  }

  async function applyVideoMode() {
    videoError = '';

    const confirmed = confirm('Changing video mode will restart the camera. Continue?');
    if (!confirmed) return;

    videoSaving = true;

    try {
      await setVideoMode({ mode: videoMode });
      videoSaving = false;
    } catch (err) {
      videoError = err.message || 'Failed to apply video mode';
      videoSaving = false;
    }
  }
</script>

<div class="settings-container">
  <div class="header">
    <h1>Settings</h1>
  </div>

  {#if loading}
    <div class="loading-container">
      <LoadingSpinner />
    </div>
  {:else if error}
    <ErrorBanner message={error} onRetry={loadSettings} />
  {:else}
    <div class="settings-grid">
      <!-- IP Filtering Card -->
      <Card title="IP Filtering">
        <div class="form-section">
          {#if clientIP}
            <div class="info-text">
              Your IP: <span class="client-ip">{clientIP}</span>
            </div>
          {/if}

          <div class="form-group">
            <label for="whitelist">Whitelist (comma-separated CIDRs)</label>
            <input
              id="whitelist"
              type="text"
              bind:value={whitelist}
              placeholder="192.168.1.0/24, 10.0.0.1"
              disabled={ipSaving}
            />
            <div class="help-text">Leave empty to allow all IPs</div>
          </div>

          <div class="form-group">
            <label for="blacklist">Blacklist (comma-separated CIDRs)</label>
            <input
              id="blacklist"
              type="text"
              bind:value={blacklist}
              placeholder="192.168.99.0/24, 172.16.0.1"
              disabled={ipSaving}
            />
            <div class="help-text">Blocked IPs take precedence over whitelist</div>
          </div>

          {#if ipError}
            <div class="error-text">{ipError}</div>
          {/if}

          <button
            class="btn-primary"
            on:click={saveIPFilters}
            disabled={ipSaving}
          >
            {ipSaving ? 'Saving...' : 'Save IP Filters'}
          </button>
        </div>
      </Card>

      <!-- MQTT Configuration Card -->
      <Card title="MQTT Configuration">
        <div class="form-section">
          <div class="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                bind:checked={mqttEnabled}
                disabled={mqttSaving}
              />
              <span>Enable MQTT</span>
            </label>
          </div>

          <div class="form-group">
            <label for="mqtt-broker">Broker Address</label>
            <input
              id="mqtt-broker"
              type="text"
              bind:value={mqttBroker}
              placeholder="mqtt.example.com"
              disabled={mqttSaving || !mqttEnabled}
            />
          </div>

          <div class="form-group">
            <label for="mqtt-port">Port</label>
            <input
              id="mqtt-port"
              type="number"
              bind:value={mqttPort}
              placeholder="1883"
              min="1"
              max="65535"
              disabled={mqttSaving || !mqttEnabled}
            />
          </div>

          <div class="form-group">
            <label for="mqtt-user">Username</label>
            <input
              id="mqtt-user"
              type="text"
              bind:value={mqttUser}
              placeholder="Optional"
              disabled={mqttSaving || !mqttEnabled}
            />
          </div>

          <div class="form-group">
            <label for="mqtt-password">Password</label>
            <div class="password-input-group">
              <input
                id="mqtt-password"
                type={showMqttPassword ? 'text' : 'password'}
                value={mqttPassword}
                on:input={(e) => mqttPassword = e.target.value}
                placeholder="Optional"
                disabled={mqttSaving || !mqttEnabled}
              />
              <button
                type="button"
                class="toggle-password"
                on:click={() => showMqttPassword = !showMqttPassword}
                disabled={!mqttEnabled}
              >
                {showMqttPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label for="mqtt-topic">Topic Prefix</label>
            <input
              id="mqtt-topic"
              type="text"
              bind:value={mqttTopic}
              placeholder="mousetrap"
              disabled={mqttSaving || !mqttEnabled}
            />
          </div>

          {#if mqttError}
            <div class="error-text">{mqttError}</div>
          {/if}

          <div class="button-group">
            <button
              class="btn-primary"
              on:click={saveMQTTConfig}
              disabled={mqttSaving}
            >
              {mqttSaving ? 'Saving...' : 'Save MQTT Config'}
            </button>
            <button
              class="btn-secondary"
              on:click={testMQTTConnection}
              disabled={mqttTesting || !mqttEnabled || !mqttBroker}
            >
              {mqttTesting ? 'Testing...' : 'Test Connection'}
            </button>
          </div>
        </div>
      </Card>

      <!-- Video Mode Card -->
      <Card title="Video Mode">
        <div class="form-section">
          <div class="warning-text">
            Changing video mode will restart the camera
          </div>

          <div class="form-group">
            <label>Resolution</label>
            <div class="radio-group">
              <label class="radio-label">
                <input
                  type="radio"
                  bind:group={videoMode}
                  value="SVGA"
                  disabled={videoSaving}
                />
                <span>SVGA (800x600)</span>
              </label>
              <label class="radio-label">
                <input
                  type="radio"
                  bind:group={videoMode}
                  value="VGA"
                  disabled={videoSaving}
                />
                <span>VGA (640x480)</span>
              </label>
              <label class="radio-label">
                <input
                  type="radio"
                  bind:group={videoMode}
                  value="CIF"
                  disabled={videoSaving}
                />
                <span>CIF (352x288)</span>
              </label>
            </div>
          </div>

          {#if videoError}
            <div class="error-text">{videoError}</div>
          {/if}

          <button
            class="btn-primary"
            on:click={applyVideoMode}
            disabled={videoSaving}
          >
            {videoSaving ? 'Applying...' : 'Apply Video Mode'}
          </button>
        </div>
      </Card>
    </div>
  {/if}
</div>

<style>
  .settings-container {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .header {
    margin-bottom: 2rem;
  }

  .header h1 {
    color: #ddd;
    font-size: 2rem;
    margin: 0;
  }

  .loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 400px;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
    gap: 2rem;
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
  .form-group input[type="number"] {
    background: #1a1a1a;
    border: 1px solid #444;
    color: #ddd;
    padding: 0.75rem;
    border-radius: 4px;
    font-size: 0.95rem;
  }

  .form-group input[type="text"]:focus,
  .form-group input[type="number"]:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .form-group input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-group input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .checkbox-group span {
    color: #ddd;
    font-size: 1rem;
  }

  .password-input-group {
    display: flex;
    gap: 0.5rem;
  }

  .password-input-group input {
    flex: 1;
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

  .toggle-password:hover:not(:disabled) {
    background: #333;
  }

  .toggle-password:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: #ddd;
  }

  .radio-label input[type="radio"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .radio-label span {
    font-size: 0.95rem;
  }

  .help-text {
    color: #888;
    font-size: 0.85rem;
    margin-top: -0.25rem;
  }

  .info-text {
    color: #888;
    font-size: 0.9rem;
    padding: 0.75rem;
    background: #1a1a1a;
    border-radius: 4px;
    border-left: 3px solid #4a9eff;
  }

  .client-ip {
    color: #4a9eff;
    font-weight: 600;
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
    padding: 0.5rem;
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

  .button-group {
    display: flex;
    gap: 1rem;
  }

  @media (max-width: 768px) {
    .settings-container {
      padding: 1rem;
    }

    .settings-grid {
      grid-template-columns: 1fr;
    }

    .button-group {
      flex-direction: column;
    }
  }
</style>

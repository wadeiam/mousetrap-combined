<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let step = 'wifi'; // 'wifi' or 'mqtt'
  let wifiSSID = '';
  let wifiPassword = '';
  let mqttBroker = '';
  let mqttUsername = '';
  let mqttPassword = '';
  let tenantId = '';
  let deviceName = 'Scout';
  let loading = false;
  let error = '';

  async function saveWifi() {
    if (!wifiSSID) {
      error = 'WiFi SSID is required';
      return;
    }

    loading = true;
    error = '';

    try {
      const res = await fetch('/api/wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssid: wifiSSID,
          password: wifiPassword
        })
      });

      if (res.ok) {
        // Device will reboot to connect to WiFi
        step = 'rebooting';
      } else {
        const data = await res.json();
        error = data.error || 'Failed to save WiFi settings';
      }
    } catch (e) {
      error = 'Connection error';
    }

    loading = false;
  }

  async function saveMqtt() {
    if (!mqttBroker || !tenantId) {
      error = 'MQTT broker and tenant ID are required';
      return;
    }

    loading = true;
    error = '';

    try {
      const res = await fetch('/api/mqtt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broker: mqttBroker,
          username: mqttUsername,
          password: mqttPassword,
          tenant_id: tenantId,
          device_name: deviceName
        })
      });

      if (res.ok) {
        dispatch('complete');
      } else {
        const data = await res.json();
        error = data.error || 'Failed to save MQTT settings';
      }
    } catch (e) {
      error = 'Connection error';
    }

    loading = false;
  }

  function skipMqtt() {
    dispatch('complete');
  }
</script>

<div class="container">
  <div class="card">
    <div class="card-title">Scout Setup</div>

    {#if step === 'wifi'}
      <p class="setup-intro">
        Connect your Scout device to WiFi to enable motion detection and server communication.
      </p>

      <div class="form-group">
        <label class="label">WiFi Network (SSID)</label>
        <input type="text" class="input" bind:value={wifiSSID} placeholder="Your WiFi name" />
      </div>

      <div class="form-group">
        <label class="label">WiFi Password</label>
        <input type="password" class="input" bind:value={wifiPassword} placeholder="WiFi password" />
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <button class="btn btn-primary" style="width: 100%;" on:click={saveWifi} disabled={loading}>
        {loading ? 'Saving...' : 'Connect to WiFi'}
      </button>

    {:else if step === 'rebooting'}
      <div class="setup-intro">
        <p>WiFi settings saved!</p>
        <p>The device is rebooting to connect to your WiFi network.</p>
        <p>Once connected, access the device at its new IP address to complete setup.</p>
      </div>

    {:else if step === 'mqtt'}
      <p class="setup-intro">
        Configure MQTT connection for server communication (optional for standalone mode).
      </p>

      <div class="form-group">
        <label class="label">Device Name</label>
        <input type="text" class="input" bind:value={deviceName} placeholder="Scout" />
      </div>

      <div class="form-group">
        <label class="label">MQTT Broker URL</label>
        <input type="text" class="input" bind:value={mqttBroker} placeholder="mqtt://192.168.1.100:1883" />
      </div>

      <div class="form-group">
        <label class="label">Tenant ID</label>
        <input type="text" class="input" bind:value={tenantId} placeholder="00000000-0000-0000-0000-000000000001" />
      </div>

      <div class="form-group">
        <label class="label">MQTT Username (optional)</label>
        <input type="text" class="input" bind:value={mqttUsername} placeholder="Username" />
      </div>

      <div class="form-group">
        <label class="label">MQTT Password (optional)</label>
        <input type="password" class="input" bind:value={mqttPassword} placeholder="Password" />
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <button class="btn btn-primary" style="width: 100%; margin-bottom: 0.5rem;" on:click={saveMqtt} disabled={loading}>
        {loading ? 'Saving...' : 'Save & Connect'}
      </button>

      <button class="btn btn-secondary" style="width: 100%;" on:click={skipMqtt}>
        Skip (Standalone Mode)
      </button>
    {/if}
  </div>
</div>

<style>
  .setup-intro {
    color: var(--text-secondary);
    margin-bottom: 1.5rem;
    line-height: 1.6;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .error {
    background: rgba(233, 69, 96, 0.2);
    color: var(--accent);
    padding: 0.75rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    text-align: center;
  }
</style>

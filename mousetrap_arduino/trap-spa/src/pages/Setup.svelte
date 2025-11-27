<script>
  import { onMount } from 'svelte';
  import LoadingSpinner from '../components/LoadingSpinner.svelte';
  import { scanWiFiNetworks, connectWiFi, standaloneMode } from '../lib/api.js';

  // Wizard state
  let currentStep = 1;
  const TOTAL_STEPS = 5;
  let isTransitioning = false;  // Loading state for step transitions

  // Step 2: WiFi Selection
  let networks = [];
  let networksScanError = null;
  let networkLoading = false;
  let selectedNetwork = null;
  let manualSSID = '';
  let wifiPassword = '';
  let showPassword = false;

  // Step 3: Account (Sign In or Create)
  let isNewAccount = false;  // false = sign in, true = create account
  let email = '';
  let accountPassword = '';
  let showAccountPassword = false;
  let deviceName = '';

  // Step 4: Progress
  $: progressSteps = [
    { id: 'wifi', label: 'Connecting to WiFi', status: 'pending' },
    { id: 'account', label: isNewAccount ? 'Creating account' : 'Signing in', status: 'pending' },
    { id: 'activate', label: 'Activating device', status: 'pending' }
  ];

  // Step 5: Result
  let setupSuccess = false;
  let setupError = null;

  // Standalone mode
  let isStandaloneFlow = false;
  let standaloneLoading = false;

  // Validation - WiFi password must be at least 8 characters (WPA requirement)
  $: isStep2Valid = (selectedNetwork || manualSSID.trim()) &&
    (selectedNetwork !== 'manual' || manualSSID.trim()) &&
    wifiPassword.length >= 8;
  // Account password must also be 8+ characters (server requirement)
  $: isStep3Valid = email.trim() && accountPassword.length >= 8 && deviceName.trim();

  onMount(() => {
    // Nothing to load on mount for step 1
  });

  async function loadNetworks(forceRescan = false) {
    console.log('[SETUP] loadNetworks called, forceRescan=' + forceRescan);
    networkLoading = true;
    networksScanError = null;
    networks = [];  // Clear networks to force showing spinner

    try {
      console.log('[SETUP] About to call scanWiFiNetworks...');
      const result = await scanWiFiNetworks(forceRescan);
      console.log('[SETUP] scanWiFiNetworks returned:', JSON.stringify(result));
      networks = result.networks || [];
      console.log('[SETUP] Networks set to:', networks.length, 'items');

      // If still no networks, show helpful error
      if (networks.length === 0) {
        networksScanError = 'No networks found. Tap Retry to scan again.';
      }
    } catch (err) {
      console.error('[SETUP] Scan error:', err);
      console.error('[SETUP] Error details:', err.message, err.stack);
      networksScanError = 'Scan failed: ' + (err.message || 'Unknown error');
      networks = [];
    } finally {
      console.log('[SETUP] loadNetworks finished, setting networkLoading=false');
      networkLoading = false;
    }
  }

  function getSignalBars(rssi) {
    // RSSI typically ranges from -100 (weak) to -30 (strong)
    if (rssi >= -50) return 4;
    if (rssi >= -60) return 3;
    if (rssi >= -70) return 2;
    return 1;
  }

  function getSignalIcon(bars) {
    const filled = '\u2588'; // Full block
    const empty = '\u2591';  // Light shade block
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += i < bars ? filled : empty;
    }
    return result;
  }

  function selectNetwork(ssid) {
    selectedNetwork = ssid;
    if (ssid !== 'manual') {
      manualSSID = '';
    }
  }

  async function goToStep(step) {
    isTransitioning = true;
    try {
      if (step === 2) {
        // Load networks when entering step 2
        await loadNetworks();
      }
      currentStep = step;
    } finally {
      isTransitioning = false;
    }
  }

  async function startSetup() {
    currentStep = 4;
    setupSuccess = false;
    setupError = null;

    const ssid = selectedNetwork === 'manual' ? manualSSID : selectedNetwork;

    // Step 1: Connect to WiFi
    progressSteps = progressSteps.map(s =>
      s.id === 'wifi' ? { ...s, status: 'in_progress' } : s
    );

    try {
      await connectWiFi({
        ssid,
        password: wifiPassword,
        email,
        accountPassword,
        deviceName,
        isNewAccount
      });

      progressSteps = progressSteps.map(s =>
        s.id === 'wifi' ? { ...s, status: 'completed' } : s
      );

      // Step 2: Account creation (handled by device)
      progressSteps = progressSteps.map(s =>
        s.id === 'account' ? { ...s, status: 'in_progress' } : s
      );

      // Wait a bit to simulate account creation progress
      await new Promise(resolve => setTimeout(resolve, 1500));

      progressSteps = progressSteps.map(s =>
        s.id === 'account' ? { ...s, status: 'completed' } : s
      );

      // Step 3: Device activation
      progressSteps = progressSteps.map(s =>
        s.id === 'activate' ? { ...s, status: 'in_progress' } : s
      );

      // Wait for activation to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      progressSteps = progressSteps.map(s =>
        s.id === 'activate' ? { ...s, status: 'completed' } : s
      );

      // Success!
      setupSuccess = true;
      currentStep = 5;

    } catch (err) {
      setupError = err.message || 'Setup failed. Please try again.';

      // Mark current in-progress step as failed
      progressSteps = progressSteps.map(s =>
        s.status === 'in_progress' ? { ...s, status: 'failed' } : s
      );

      currentStep = 5;
    }
  }

  function resetSetup() {
    currentStep = 1;
    selectedNetwork = null;
    manualSSID = '';
    wifiPassword = '';
    email = '';
    accountPassword = '';
    deviceName = '';
    setupSuccess = false;
    setupError = null;
    progressSteps = [
      { id: 'wifi', label: 'Connecting to WiFi', status: 'pending' },
      { id: 'account', label: 'Creating your account', status: 'pending' },
      { id: 'activate', label: 'Activating device', status: 'pending' }
    ];
  }

  function getProgressIcon(status) {
    switch (status) {
      case 'completed': return '\u2713'; // Check mark
      case 'in_progress': return '\u23F3'; // Hourglass
      case 'failed': return '\u2717'; // X mark
      default: return '\u25CB'; // Circle
    }
  }

  async function goToStandaloneStep() {
    isStandaloneFlow = true;
    await goToStep(2);
  }

  async function submitStandalone() {
    standaloneLoading = true;
    setupError = null;

    const ssid = selectedNetwork === 'manual' ? manualSSID : selectedNetwork;

    try {
      await standaloneMode({
        ssid,
        password: wifiPassword
      });

      // Success - device will reboot
      setupSuccess = true;
      currentStep = 5;
    } catch (err) {
      setupError = err.message || 'Failed to enable standalone mode';
      currentStep = 5;
      setupSuccess = false;
    } finally {
      standaloneLoading = false;
    }
  }
</script>

<div class="setup-container">
  <div class="setup-card">
    <!-- Progress indicator -->
    {#if currentStep < 5}
      <div class="progress-bar">
        <div class="progress-fill" style="width: {(currentStep / (TOTAL_STEPS - 1)) * 100}%"></div>
      </div>
    {/if}

    <!-- Step 1: Welcome -->
    {#if currentStep === 1}
      <div class="step welcome-step">
        <div class="welcome-icon">
          <span class="mouse-emoji" role="img" aria-label="mouse">&#x1F401;</span>
        </div>
        <h1>MouseTrap Setup</h1>
        <p class="welcome-text">
          Let's get your device connected and ready to protect your home.
        </p>
        <button class="btn-primary btn-large" on:click={() => { isStandaloneFlow = false; goToStep(2); }} disabled={isTransitioning}>
          {#if isTransitioning}
            <LoadingSpinner size="small" /> Loading...
          {:else}
            Get Started <span class="arrow">&rarr;</span>
          {/if}
        </button>
        <div class="standalone-option">
          <button class="btn-link" on:click={goToStandaloneStep} disabled={isTransitioning}>
            Standalone Mode (Local Only)
          </button>
          <p class="standalone-hint">Connect to WiFi without cloud registration</p>
        </div>
      </div>
    {/if}

    <!-- Step 2: WiFi Selection -->
    {#if currentStep === 2}
      <div class="step wifi-step">
        <h2>Select your WiFi network</h2>

        {#if networkLoading}
          <div class="loading-container">
            <LoadingSpinner />
            <p>Scanning for networks...</p>
          </div>
        {:else if networksScanError || networks.length === 0}
          <div class="error-box">
            <p>{networksScanError || 'No networks found'}</p>
            <button class="btn-primary" on:click={() => { console.log('[SETUP] Retry clicked!'); loadNetworks(true); }}>
              Retry Scan
            </button>
            <p class="hint">Tap Retry to scan again. This may take 10-15 seconds.</p>
          </div>
        {:else}
          <div class="network-list">
            {#each networks as network}
              <button
                class="network-item"
                class:selected={selectedNetwork === network.ssid}
                on:click={() => selectNetwork(network.ssid)}
              >
                <span class="network-radio">
                  {selectedNetwork === network.ssid ? '\u25C9' : '\u25CB'}
                </span>
                <span class="network-name">{network.ssid}</span>
                <span class="signal-icon" title="Signal strength">
                  <span class="signal-label">&#x1F4F6;</span>
                  <span class="signal-bars">{getSignalIcon(getSignalBars(network.rssi))}</span>
                </span>
              </button>
            {/each}

            <button
              class="network-item manual-entry"
              class:selected={selectedNetwork === 'manual'}
              on:click={() => selectNetwork('manual')}
            >
              <span class="network-radio">
                {selectedNetwork === 'manual' ? '\u25C9' : '\u25CB'}
              </span>
              <span class="network-name">Enter manually...</span>
            </button>
          </div>

          {#if selectedNetwork === 'manual'}
            <div class="form-group">
              <label for="manual-ssid">Network Name (SSID)</label>
              <input
                id="manual-ssid"
                type="text"
                bind:value={manualSSID}
                placeholder="Enter network name"
                autocomplete="off"
              />
            </div>
          {/if}

          <div class="form-group">
            <label for="wifi-password">Password</label>
            <div class="password-input-group">
              {#if showPassword}
                <input
                  id="wifi-password"
                  type="text"
                  bind:value={wifiPassword}
                  placeholder="Enter WiFi password"
                  autocomplete="off"
                />
              {:else}
                <input
                  id="wifi-password"
                  type="password"
                  bind:value={wifiPassword}
                  placeholder="Enter WiFi password"
                  autocomplete="off"
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
            <p class="field-hint" class:valid={wifiPassword.length >= 8}>
              {wifiPassword.length}/8 characters minimum
            </p>
          </div>
        {/if}

        <div class="button-row">
          <button class="btn-secondary" on:click={() => { currentStep = 1; isStandaloneFlow = false; }}>
            <span class="arrow">&larr;</span> Back
          </button>
          {#if isStandaloneFlow}
            <button
              class="btn-primary"
              on:click={submitStandalone}
              disabled={!isStep2Valid || standaloneLoading}
            >
              {#if standaloneLoading}
                <LoadingSpinner size="small" /> Enabling...
              {:else}
                Enable Standalone Mode
              {/if}
            </button>
          {:else}
            <button
              class="btn-primary"
              on:click={() => currentStep = 3}
              disabled={!isStep2Valid}
            >
              Next <span class="arrow">&rarr;</span>
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Step 3: Account (Sign In or Create) -->
    {#if currentStep === 3}
      <div class="step account-step">
        <div class="account-tabs">
          <button
            class="tab-btn"
            class:active={!isNewAccount}
            on:click={() => isNewAccount = false}
          >
            Sign In
          </button>
          <button
            class="tab-btn"
            class:active={isNewAccount}
            on:click={() => isNewAccount = true}
          >
            Create Account
          </button>
        </div>

        <h2>{isNewAccount ? 'Create your account' : 'Sign in'}</h2>

        <div class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            type="email"
            bind:value={email}
            placeholder="you@example.com"
            autocomplete="email"
          />
        </div>

        <div class="form-group">
          <label for="account-password">Password</label>
          <div class="password-input-group">
            {#if showAccountPassword}
              <input
                id="account-password"
                type="text"
                bind:value={accountPassword}
                placeholder={isNewAccount ? "Create a password" : "Enter your password"}
                autocomplete={isNewAccount ? "new-password" : "current-password"}
              />
            {:else}
              <input
                id="account-password"
                type="password"
                bind:value={accountPassword}
                placeholder={isNewAccount ? "Create a password" : "Enter your password"}
                autocomplete={isNewAccount ? "new-password" : "current-password"}
              />
            {/if}
            <button
              type="button"
              class="toggle-password"
              on:click={() => showAccountPassword = !showAccountPassword}
            >
              {showAccountPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <p class="field-hint" class:valid={accountPassword.length >= 8}>
            {accountPassword.length}/8 characters minimum
          </p>
        </div>

        <div class="form-group">
          <label for="device-name">Name this device</label>
          <input
            id="device-name"
            type="text"
            bind:value={deviceName}
            placeholder="Kitchen"
            autocomplete="off"
          />
        </div>

        <div class="button-row">
          <button class="btn-secondary" on:click={() => currentStep = 2}>
            <span class="arrow">&larr;</span> Back
          </button>
          <button
            class="btn-primary"
            on:click={startSetup}
            disabled={!isStep3Valid}
          >
            {isNewAccount ? 'Create & Activate' : 'Sign In & Activate'} <span class="arrow">&rarr;</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- Step 4: Progress -->
    {#if currentStep === 4}
      <div class="step progress-step">
        <h2>Setting up your device...</h2>

        <div class="progress-list">
          {#each progressSteps as step}
            <div class="progress-item" class:completed={step.status === 'completed'} class:in-progress={step.status === 'in_progress'} class:failed={step.status === 'failed'}>
              <span class="progress-icon">{getProgressIcon(step.status)}</span>
              <span class="progress-label">{step.label}</span>
              {#if step.status === 'in_progress'}
                <span class="progress-spinner"></span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Step 5: Success or Error -->
    {#if currentStep === 5}
      {#if setupSuccess}
        <div class="step success-step">
          <div class="result-icon success">
            <span role="img" aria-label="success">&#x2705;</span>
          </div>
          {#if isStandaloneFlow}
            <h2>Standalone Mode Enabled</h2>
            <p class="result-text">
              Device will reboot and connect to WiFi without cloud registration.
            </p>
            <div class="dashboard-link-box">
              <p>After reboot, access the device at:</p>
              <p class="dashboard-link">http://192.168.4.1</p>
              <p class="hint-text">(Connect to the MouseTrap WiFi network first)</p>
            </div>
            <p class="auto-close-text">
              Device is rebooting...<br />
              You can view system logs at /app/#/logs
            </p>
          {:else}
            <h2>You're all set!</h2>
            <p class="result-text">
              Your device "{deviceName}" is now connected and monitoring.
            </p>
            <div class="dashboard-link-box">
              <p>Access your dashboard at:</p>
              <a href="https://dashboard.mousetrap.com" class="dashboard-link" target="_blank" rel="noopener noreferrer">
                https://dashboard.mousetrap.com
              </a>
            </div>
            <p class="auto-close-text">
              This page will close automatically.<br />
              Your device is now connected to your home WiFi.
            </p>
          {/if}
        </div>
      {:else}
        <div class="step error-step">
          <div class="result-icon error">
            <span role="img" aria-label="error">&#x274C;</span>
          </div>
          <h2>Setup Failed</h2>
          <p class="error-message">{setupError}</p>
          <button class="btn-primary btn-large" on:click={resetSetup}>
            Try Again
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .setup-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  }

  .setup-card {
    background: #1e1e2e;
    border: 1px solid #333;
    border-radius: 16px;
    padding: 2rem;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .progress-bar {
    height: 4px;
    background: #333;
    border-radius: 2px;
    margin-bottom: 2rem;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4a9eff, #00d4aa);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  /* Welcome Step */
  .welcome-step .welcome-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
  }

  .mouse-emoji {
    display: inline-block;
  }

  .welcome-step h1 {
    color: #fff;
    font-size: 2rem;
    margin: 0 0 1rem 0;
    font-weight: 600;
  }

  .welcome-text {
    color: #aaa;
    font-size: 1.1rem;
    margin-bottom: 2rem;
    line-height: 1.6;
  }

  .standalone-option {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #333;
    text-align: center;
  }

  .btn-link {
    background: none;
    border: none;
    color: #4a9eff;
    font-size: 0.95rem;
    cursor: pointer;
    padding: 0.5rem;
    text-decoration: underline;
  }

  .btn-link:hover:not(:disabled) {
    color: #6ab0ff;
  }

  .btn-link:disabled {
    color: #666;
    cursor: not-allowed;
  }

  .standalone-hint {
    color: #666;
    font-size: 0.8rem;
    margin: 0.5rem 0 0 0;
  }

  .hint-text {
    color: #888;
    font-size: 0.85rem;
    margin-top: 0.5rem;
  }

  /* WiFi Step */
  .wifi-step {
    align-items: stretch;
    text-align: left;
  }

  .wifi-step h2 {
    color: #fff;
    font-size: 1.5rem;
    margin: 0 0 1.5rem 0;
    text-align: center;
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 0;
    color: #aaa;
  }

  .error-box {
    background: #2a1a1a;
    border: 1px solid #ff6b6b;
    border-radius: 8px;
    padding: 1.5rem;
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .error-box p {
    color: #ff9999;
    margin: 0 0 1rem 0;
  }

  .network-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    max-height: 240px;
    overflow-y: auto;
  }

  .network-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    background: #252535;
    border: 1px solid #333;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    color: #ddd;
    text-align: left;
    width: 100%;
  }

  .network-item:hover {
    background: #2a2a3a;
    border-color: #444;
  }

  .network-item.selected {
    background: #1a3a5a;
    border-color: #4a9eff;
  }

  .network-radio {
    font-size: 1.1rem;
    color: #4a9eff;
  }

  .network-name {
    flex: 1;
    font-size: 0.95rem;
  }

  .signal-icon {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #888;
  }

  .signal-label {
    font-size: 1rem;
  }

  .signal-bars {
    font-family: monospace;
    letter-spacing: -1px;
  }

  .manual-entry {
    border-style: dashed;
    color: #999;
  }

  /* Account Step */
  .account-step {
    align-items: stretch;
    text-align: left;
  }

  .account-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 1.5rem;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #444;
  }

  .tab-btn {
    flex: 1;
    padding: 0.75rem 1rem;
    background: #252535;
    border: none;
    color: #888;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-btn:first-child {
    border-right: 1px solid #444;
  }

  .tab-btn.active {
    background: #3b82f6;
    color: #fff;
  }

  .tab-btn:hover:not(.active) {
    background: #333;
  }

  .account-step h2 {
    color: #fff;
    font-size: 1.5rem;
    margin: 0 0 1.5rem 0;
    text-align: center;
  }

  /* Form Elements */
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .field-hint {
    font-size: 0.75rem;
    color: #888;
    margin: 0.25rem 0 0 0;
  }

  .field-hint.valid {
    color: #4ade80;
  }

  .form-group label {
    color: #ccc;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .form-group input[type="text"],
  .form-group input[type="email"],
  .form-group input[type="password"] {
    background: #252535;
    border: 1px solid #444;
    color: #fff;
    padding: 0.875rem 1rem;
    border-radius: 8px;
    font-size: 1rem;
    transition: border-color 0.2s;
  }

  .form-group input:focus {
    outline: none;
    border-color: #4a9eff;
  }

  .form-group input::placeholder {
    color: #666;
  }

  .password-input-group {
    display: flex;
    gap: 0.5rem;
  }

  .password-input-group input {
    flex: 1;
  }

  .toggle-password {
    background: #333;
    border: 1px solid #444;
    color: #aaa;
    padding: 0.875rem 1rem;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    white-space: nowrap;
    transition: all 0.2s;
  }

  .toggle-password:hover {
    background: #3a3a4a;
    color: #ddd;
  }

  /* Progress Step */
  .progress-step h2 {
    color: #fff;
    font-size: 1.5rem;
    margin: 0 0 2rem 0;
  }

  .progress-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 300px;
  }

  .progress-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: #252535;
    border-radius: 8px;
    color: #888;
  }

  .progress-item.completed {
    color: #00d4aa;
  }

  .progress-item.in-progress {
    color: #4a9eff;
    background: #1a2a3a;
  }

  .progress-item.failed {
    color: #ff6b6b;
    background: #2a1a1a;
  }

  .progress-icon {
    font-size: 1.25rem;
    width: 1.5rem;
    text-align: center;
  }

  .progress-label {
    flex: 1;
    font-size: 0.95rem;
  }

  .progress-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid transparent;
    border-top-color: #4a9eff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Success Step */
  .success-step {
    padding: 1rem 0;
  }

  .result-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
  }

  .result-icon.success {
    color: #00d4aa;
  }

  .result-icon.error {
    color: #ff6b6b;
  }

  .success-step h2,
  .error-step h2 {
    color: #fff;
    font-size: 1.75rem;
    margin: 0 0 1rem 0;
  }

  .result-text {
    color: #aaa;
    font-size: 1.1rem;
    margin-bottom: 1.5rem;
  }

  .dashboard-link-box {
    background: #252535;
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    width: 100%;
  }

  .dashboard-link-box p {
    color: #888;
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
  }

  .dashboard-link {
    color: #4a9eff;
    font-size: 1rem;
    text-decoration: none;
    word-break: break-all;
  }

  .dashboard-link:hover {
    text-decoration: underline;
  }

  .auto-close-text {
    color: #666;
    font-size: 0.9rem;
    line-height: 1.6;
  }

  /* Error Step */
  .error-step {
    padding: 1rem 0;
  }

  .error-message {
    color: #ff9999;
    font-size: 1rem;
    background: #2a1a1a;
    border: 1px solid #ff6b6b;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    width: 100%;
  }

  /* Buttons */
  .btn-primary,
  .btn-secondary {
    padding: 0.875rem 1.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .btn-primary {
    background: linear-gradient(135deg, #4a9eff, #0070f3);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #3a8eef, #0060e3);
    transform: translateY(-1px);
  }

  .btn-primary:disabled {
    background: #333;
    color: #666;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #333;
    color: #ddd;
    border: 1px solid #444;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #3a3a4a;
  }

  .btn-large {
    padding: 1rem 2rem;
    font-size: 1.1rem;
  }

  .button-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1.5rem;
    width: 100%;
  }

  .arrow {
    font-weight: normal;
  }

  /* Responsive */
  @media (max-width: 480px) {
    .setup-card {
      padding: 1.5rem;
      border-radius: 12px;
    }

    .welcome-step h1 {
      font-size: 1.75rem;
    }

    .welcome-text {
      font-size: 1rem;
    }

    .wifi-step h2,
    .account-step h2,
    .progress-step h2 {
      font-size: 1.25rem;
    }

    .network-list {
      max-height: 200px;
    }

    .btn-large {
      padding: 0.875rem 1.5rem;
      font-size: 1rem;
    }
  }
</style>

<script>
  import { onMount } from 'svelte';
  import LoadingSpinner from '../components/LoadingSpinner.svelte';
  import { scanWiFiNetworks, testWiFi, registerDevice, standaloneMode, getSetupStatus, clearSetupStatus, getSetupProgress, resetSetupState, triggerReboot } from '../lib/api.js';

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
  let wifiTestInProgress = false;
  let wifiTestError = null;

  // Step 3: Account (Sign In or Create)
  let isNewAccount = false;  // false = sign in, true = create account
  let email = '';
  let accountPassword = '';
  let showAccountPassword = false;
  let deviceName = '';
  let showForgotPasswordInfo = false;

  // Step 4: Progress
  $: progressSteps = [
    { id: 'wifi', label: 'Connecting to WiFi', status: 'pending' },
    { id: 'account', label: isNewAccount ? 'Creating account' : 'Signing in', status: 'pending' },
    { id: 'activate', label: 'Activating device', status: 'pending' }
  ];

  // Step 5: Result
  let setupSuccess = false;
  let setupError = null;
  let claimRecovered = false;  // True if device was already claimed and recovered

  // Previous attempt error (shown on step 1)
  let previousError = null;
  let previousErrorCode = null;

  // Connection loss recovery - store device LAN IP for "Continue on LAN" fallback
  let deviceLanIP = null;
  let connectionLost = false;
  let consecutiveErrors = 0;
  const CONNECTION_LOST_THRESHOLD = 3; // Number of consecutive errors before showing fallback

  // WiFi connected state - show LAN IP before proceeding
  let wifiConnectedShowingIP = false;

  // Standalone mode
  let isStandaloneFlow = false;
  let standaloneLoading = false;

  // Timezone - auto-detected from browser
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // Validation - WiFi password must be at least 8 characters (WPA requirement)
  $: isStep2Valid = (selectedNetwork || manualSSID.trim()) &&
    (selectedNetwork !== 'manual' || manualSSID.trim()) &&
    wifiPassword.length >= 8;
  // Account password must also be 8+ characters (server requirement)
  $: isStep3Valid = email.trim() && accountPassword.length >= 8 && deviceName.trim();

  onMount(async () => {
    // Check if there was a previous failed setup attempt
    try {
      const status = await getSetupStatus();
      if (status.attempted && !status.success) {
        previousError = status.errorMessage;
        previousErrorCode = status.errorCode;
        console.log('[SETUP] Previous error found:', status.errorCode, status.errorMessage);
      }
    } catch (err) {
      console.log('[SETUP] Could not check setup status:', err.message);
    }
  });

  async function dismissPreviousError() {
    try {
      await clearSetupStatus();
    } catch (err) {
      console.log('[SETUP] Could not clear setup status:', err.message);
    }
    previousError = null;
    previousErrorCode = null;
  }

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

  let pollInterval = null;

  // Proceed to account step after WiFi connected
  function proceedToAccountStep() {
    wifiConnectedShowingIP = false;
    currentStep = 3;
  }

  // Test WiFi connection (Phase 1) - called from Step 2
  async function startWiFiTest() {
    wifiTestInProgress = true;
    wifiTestError = null;
    connectionLost = false; // Reset connection lost state
    consecutiveErrors = 0;  // Reset error counter
    wifiConnectedShowingIP = false;

    const ssid = selectedNetwork === 'manual' ? manualSSID : selectedNetwork;

    try {
      // Send test-wifi request to device
      await testWiFi({ ssid, password: wifiPassword });

      // Start polling for WiFi connection status
      startWiFiPolling();

    } catch (err) {
      wifiTestError = err.message || 'Failed to start WiFi test. Please try again.';
      wifiTestInProgress = false;
    }
  }

  function startWiFiPolling() {
    pollInterval = setInterval(async () => {
      try {
        const progress = await getSetupProgress();
        console.log('[WIFI-TEST] Progress:', progress.state, progress.step, 'staIP:', progress.staIP);
        consecutiveErrors = 0; // Reset on successful poll

        // Store the device's LAN IP for "Continue on LAN" fallback
        if (progress.staIP && progress.staIP !== '0.0.0.0') {
          deviceLanIP = progress.staIP;
          console.log('[WIFI-TEST] Device LAN IP:', deviceLanIP);
        }

        if (progress.state === 'wifi_connected') {
          // WiFi connected! Move to account step
          stopProgressPolling();
          wifiTestInProgress = false;
          currentStep = 3;
        } else if (progress.state === 'checking_claim') {
          // Device is checking if it's already claimed - show status
          console.log('[WIFI-TEST] Device is checking claim status...');
        } else if (progress.state === 'claim_recovered') {
          // Device was already claimed and recovered its credentials!
          // Skip account step entirely
          stopProgressPolling();
          wifiTestInProgress = false;
          deviceName = progress.recoveredDeviceName || 'Device';
          setupSuccess = true;
          claimRecovered = true;
          currentStep = 5;  // Go directly to success screen
        } else if (progress.state === 'failed') {
          // WiFi failed
          stopProgressPolling();
          wifiTestError = progress.error || 'WiFi connection failed';
          wifiTestInProgress = false;
        }
      } catch (err) {
        console.log('[WIFI-TEST] Poll error:', err.message);
        consecutiveErrors++;

        // If we've lost connection to the AP, show the "Continue on LAN" fallback
        if (consecutiveErrors >= CONNECTION_LOST_THRESHOLD && deviceLanIP) {
          console.log('[WIFI-TEST] Connection lost to AP, showing LAN fallback');
          stopProgressPolling();
          wifiTestInProgress = false;
          connectionLost = true;
        }
      }
    }, 500);
  }

  // Start registration (Phase 2) - called from Step 3
  async function startRegistration() {
    currentStep = 4;
    setupSuccess = false;
    setupError = null;

    // Start with WiFi already done (since we tested it in step 2)
    progressSteps = [
      { id: 'wifi', label: 'WiFi Connected', status: 'completed' },
      { id: 'account', label: isNewAccount ? 'Creating account' : 'Signing in', status: 'in_progress' },
      { id: 'activate', label: 'Activating device', status: 'pending' }
    ];

    try {
      // Send registration request to device
      await registerDevice({
        email,
        accountPassword,
        deviceName,
        isNewAccount,
        timezone
      });

      // Start polling for registration progress
      startRegistrationPolling();

    } catch (err) {
      setupError = err.message || 'Failed to start registration. Please try again.';
      progressSteps = progressSteps.map(s =>
        s.status === 'in_progress' ? { ...s, status: 'failed' } : s
      );
      currentStep = 5;
    }
  }

  function startRegistrationPolling() {
    pollInterval = setInterval(async () => {
      try {
        const progress = await getSetupProgress();
        console.log('[REGISTER] Progress:', progress.state, progress.step);
        consecutiveErrors = 0; // Reset on successful poll

        // Store/update the device's LAN IP
        if (progress.staIP && progress.staIP !== '0.0.0.0') {
          deviceLanIP = progress.staIP;
        }

        // Update progress steps based on state
        updateProgressSteps(progress);

        if (progress.state === 'complete') {
          stopProgressPolling();
          setupSuccess = true;
          currentStep = 5;
        } else if (progress.state === 'failed') {
          stopProgressPolling();
          setupError = progress.error || 'Registration failed';
          setupErrorCode = progress.errorCode;
          currentStep = 5;
        }
      } catch (err) {
        console.log('[REGISTER] Poll error:', err.message);
        consecutiveErrors++;

        // If we've lost connection during registration, show the LAN fallback
        if (consecutiveErrors >= CONNECTION_LOST_THRESHOLD && deviceLanIP) {
          console.log('[REGISTER] Connection lost during registration, showing LAN fallback');
          stopProgressPolling();
          connectionLost = true;
          currentStep = 2; // Go back to step 2 to show the connection lost UI
        }
      }
    }, 500);
  }

  // Legacy: Combined setup flow (for backward compatibility, not used in new flow)
  async function startSetup() {
    currentStep = 4;
    setupSuccess = false;
    setupError = null;

    const ssid = selectedNetwork === 'manual' ? manualSSID : selectedNetwork;

    // Start with all steps pending
    progressSteps = [
      { id: 'wifi', label: 'Connecting to WiFi', status: 'in_progress' },
      { id: 'account', label: isNewAccount ? 'Creating account' : 'Signing in', status: 'pending' },
      { id: 'activate', label: 'Activating device', status: 'pending' }
    ];

    try {
      // Send setup request to device - this triggers APSTA mode setup
      await connectWiFi({
        ssid,
        password: wifiPassword,
        email,
        accountPassword,
        deviceName,
        isNewAccount
      });

      // Start polling for real progress
      startProgressPolling();

    } catch (err) {
      setupError = err.message || 'Failed to start setup. Please try again.';
      progressSteps = progressSteps.map(s =>
        s.status === 'in_progress' ? { ...s, status: 'failed' } : s
      );
      currentStep = 5;
    }
  }

  function startProgressPolling() {
    // Poll every 500ms for setup progress
    pollInterval = setInterval(async () => {
      try {
        const progress = await getSetupProgress();
        console.log('[SETUP] Progress:', progress.state, progress.step);

        // Update progress steps based on state
        updateProgressSteps(progress);

        // Check for completion or failure
        if (progress.state === 'complete') {
          stopProgressPolling();
          setupSuccess = true;
          currentStep = 5;
        } else if (progress.state === 'failed') {
          stopProgressPolling();
          setupError = progress.error || 'Setup failed';
          setupErrorCode = progress.errorCode;
          currentStep = 5;
        }
      } catch (err) {
        console.log('[SETUP] Poll error (device may be switching modes):', err.message);
        // Don't stop polling on transient errors - device might be switching WiFi modes
      }
    }, 500);
  }

  function stopProgressPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function updateProgressSteps(progress) {
    const stateMap = {
      'idle': { wifi: 'pending', account: 'pending', activate: 'pending' },
      'connecting_wifi': { wifi: 'in_progress', account: 'pending', activate: 'pending' },
      'syncing_time': { wifi: 'completed', account: 'in_progress', activate: 'pending' },
      'registering': { wifi: 'completed', account: 'in_progress', activate: 'pending' },
      'saving': { wifi: 'completed', account: 'completed', activate: 'in_progress' },
      'complete': { wifi: 'completed', account: 'completed', activate: 'completed' },
      'failed': determineFailedStep(progress.errorCode)
    };

    const stepStatus = stateMap[progress.state] || stateMap['idle'];

    progressSteps = [
      { id: 'wifi', label: 'Connecting to WiFi', status: stepStatus.wifi },
      { id: 'account', label: isNewAccount ? 'Creating account' : 'Signing in', status: stepStatus.account },
      { id: 'activate', label: 'Activating device', status: stepStatus.activate }
    ];
  }

  function determineFailedStep(errorCode) {
    // Determine which step failed based on error code
    switch (errorCode) {
      case 'wifi_failed':
        return { wifi: 'failed', account: 'pending', activate: 'pending' };
      case 'ntp_failed':
      case 'invalid_credentials':
      case 'server_rejected':
        return { wifi: 'completed', account: 'failed', activate: 'pending' };
      case 'connection_error':
      case 'server_error':
      case 'registration_failed':
        return { wifi: 'completed', account: 'completed', activate: 'failed' };
      default:
        return { wifi: 'completed', account: 'completed', activate: 'failed' };
    }
  }

  // Store error code for contextual help
  let setupErrorCode = null;
  let isRebooting = false;

  async function handleReboot() {
    isRebooting = true;
    try {
      await triggerReboot();
      // Device will reboot - connection will be lost
    } catch (err) {
      console.log('[SETUP] Reboot request sent (connection may be lost)');
    }
  }

  async function handleRetry() {
    // Reset device state and go back to account step
    try {
      await resetSetupState();
    } catch (err) {
      console.log('[SETUP] Could not reset state:', err.message);
    }
    setupError = null;
    setupErrorCode = null;
    currentStep = 3;  // Go back to account step (keep WiFi selection)
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
    claimRecovered = false;
    connectionLost = false;
    consecutiveErrors = 0;
    deviceLanIP = null;
    wifiConnectedShowingIP = false;
    showForgotPasswordInfo = false;
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
        {#if previousError}
          <div class="previous-error-box">
            <div class="error-header">
              <span class="error-icon">&#x26A0;</span>
              <strong>Previous Setup Failed</strong>
            </div>
            <p class="error-text">{previousError}</p>
            {#if previousErrorCode === 'invalid_credentials'}
              <div class="error-help">
                <p>Double-check your email and password, or create a new account.</p>
                <a href="https://dashboard.mousetrap.com/forgot-password" target="_blank" rel="noopener noreferrer" class="forgot-link">
                  Forgot your password?
                </a>
              </div>
            {:else if previousErrorCode === 'wifi_failed'}
              <div class="error-help">
                <p>Check your WiFi password and make sure the network is in range.</p>
              </div>
            {/if}
            <button class="btn-dismiss" on:click={dismissPreviousError}>
              Dismiss
            </button>
          </div>
        {:else}
          <div class="welcome-icon">
            <span class="mouse-emoji" role="img" aria-label="mouse">&#x1F401;</span>
          </div>
        {/if}
        <h1>MouseTrap Setup</h1>
        <p class="welcome-text">
          Let's get your device connected and ready to protect your home.
        </p>
        <button class="btn-primary btn-large" on:click={() => { isStandaloneFlow = false; dismissPreviousError(); goToStep(2); }} disabled={isTransitioning}>
          {#if isTransitioning}
            <LoadingSpinner size="small" /> Loading...
          {:else}
            {previousError ? 'Try Again' : 'Get Started'} <span class="arrow">&rarr;</span>
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

          {#if wifiTestError}
            <div class="wifi-error-box">
              <p class="error-icon">&#x26A0;</p>
              <p class="error-text">{wifiTestError}</p>
              <p class="error-hint">Check your WiFi password and try again.</p>
            </div>
          {/if}

          {#if wifiTestInProgress}
            <div class="wifi-connecting-box">
              <LoadingSpinner size="small" />
              <p>Connecting to WiFi...</p>
            </div>
          {/if}

          {#if wifiConnectedShowingIP}
            <div class="wifi-success-box">
              <div class="wifi-success-header">
                <span class="success-icon">&#x2705;</span>
                <strong>WiFi Connected!</strong>
              </div>
              {#if deviceLanIP}
                <div class="lan-ip-notice">
                  <p class="notice-text">Your phone may disconnect from this setup network.</p>
                  <p class="notice-text"><strong>If that happens</strong>, connect to your home WiFi and visit:</p>
                  <div class="lan-ip-display">
                    <span class="lan-ip">{deviceLanIP}</span>
                  </div>
                  <p class="notice-hint">Save this address before continuing!</p>
                </div>
              {/if}
              <button class="btn-primary btn-continue" on:click={proceedToAccountStep}>
                Continue to Account Setup <span class="arrow">&rarr;</span>
              </button>
            </div>
          {/if}

          {#if connectionLost && deviceLanIP}
            <div class="connection-lost-box">
              <div class="connection-lost-header">
                <span class="wifi-success-icon">&#x2705;</span>
                <strong>WiFi Connected!</strong>
              </div>
              <p class="connection-lost-text">
                Your phone disconnected from the setup network. This is normal - the device is now on your home WiFi.
              </p>
              <div class="continue-lan-box">
                <p>To complete setup, connect to your home WiFi and visit:</p>
                <a href="http://{deviceLanIP}" class="lan-link" target="_blank" rel="noopener noreferrer">
                  http://{deviceLanIP}
                </a>
                <p class="lan-hint">Or scan this address on your phone's browser</p>
              </div>
            </div>
          {/if}
        {/if}

        <div class="button-row">
          <button class="btn-secondary" on:click={() => { currentStep = 1; isStandaloneFlow = false; wifiTestError = null; }} disabled={wifiTestInProgress}>
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
              on:click={startWiFiTest}
              disabled={!isStep2Valid || wifiTestInProgress}
            >
              {#if wifiTestInProgress}
                <LoadingSpinner size="small" /> Connecting...
              {:else}
                Connect <span class="arrow">&rarr;</span>
              {/if}
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
            on:click={() => { isNewAccount = false; }}
          >
            Sign In
          </button>
          <button
            class="tab-btn"
            class:active={isNewAccount}
            on:click={() => { isNewAccount = true; showForgotPasswordInfo = false; }}
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
          {#if !isNewAccount}
            <button type="button" class="forgot-password-link" on:click={() => showForgotPasswordInfo = !showForgotPasswordInfo}>
              Forgot password?
            </button>
          {/if}
        </div>

        {#if showForgotPasswordInfo}
          <div class="forgot-password-info-box">
            <button type="button" class="info-box-close" on:click={() => showForgotPasswordInfo = false}>
              &times;
            </button>
            <p class="info-title">To reset your password:</p>
            <ol class="info-steps">
              <li>Connect to your home WiFi network</li>
              <li>Visit <strong>dashboard.mousetrap.com/forgot-password</strong></li>
              <li>Reset your password via email</li>
              <li>Return here to complete setup</li>
            </ol>
            <p class="info-note">The captive portal doesn't have internet access, so you'll need to use your home WiFi to reset your password.</p>
          </div>
        {/if}

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

        <div class="wifi-connected-box">
          <span class="wifi-icon">&#x2705;</span>
          <span>WiFi Connected</span>
        </div>

        <div class="button-row">
          <button class="btn-secondary" on:click={() => currentStep = 2}>
            <span class="arrow">&larr;</span> Back
          </button>
          <button
            class="btn-primary"
            on:click={startRegistration}
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
          {#if isStandaloneFlow}
            <div class="result-icon success">
              <span role="img" aria-label="success">&#x2705;</span>
            </div>
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
          {:else if claimRecovered}
            <div class="result-icon success">
              <span role="img" aria-label="success">&#x2705;</span>
            </div>
            <h2>Connection Restored!</h2>
            <p class="result-text">
              Your device "{deviceName}" has reconnected successfully.
            </p>
            <div class="dashboard-link-box">
              <p>Access your dashboard at:</p>
              <a href="https://dashboard.mousetrap.com" class="dashboard-link" target="_blank" rel="noopener noreferrer">
                https://dashboard.mousetrap.com
              </a>
            </div>
            <button class="btn-primary btn-large" on:click={handleReboot} disabled={isRebooting}>
              {#if isRebooting}
                <LoadingSpinner size="small" /> Rebooting...
              {:else}
                Finish Setup
              {/if}
            </button>
            <p class="auto-close-text">
              The device will reboot and connect to your home WiFi.
            </p>
          {:else}
            <div class="result-icon success">
              <span role="img" aria-label="success">&#x2705;</span>
            </div>
            <h2>Setup Complete!</h2>
            <p class="result-text">
              Your device "{deviceName}" has been registered successfully.
            </p>
            <div class="dashboard-link-box">
              <p>Access your dashboard at:</p>
              <a href="https://dashboard.mousetrap.com" class="dashboard-link" target="_blank" rel="noopener noreferrer">
                https://dashboard.mousetrap.com
              </a>
            </div>
            <button class="btn-primary btn-large" on:click={handleReboot} disabled={isRebooting}>
              {#if isRebooting}
                <LoadingSpinner size="small" /> Rebooting...
              {:else}
                Finish Setup
              {/if}
            </button>
            <p class="auto-close-text">
              The device will reboot and connect to your home WiFi.
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

          {#if setupErrorCode === 'invalid_credentials'}
            <div class="error-help-box">
              <p>Double-check your email and password, or create a new account.</p>
              <a href="https://dashboard.mousetrap.com/forgot-password" target="_blank" rel="noopener noreferrer" class="forgot-link">
                Forgot your password?
              </a>
            </div>
          {:else if setupErrorCode === 'wifi_failed'}
            <div class="error-help-box">
              <p>Check your WiFi password and make sure the network is in range.</p>
            </div>
          {:else if setupErrorCode === 'connection_error'}
            <div class="error-help-box">
              <p>Make sure your WiFi has internet access and the server is reachable.</p>
            </div>
          {/if}

          <button class="btn-primary btn-large" on:click={handleRetry}>
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

  /* Previous Error Box (shown on Welcome step after failed attempt) */
  .previous-error-box {
    background: linear-gradient(135deg, #2a1a1a 0%, #1a1515 100%);
    border: 1px solid #ff6b6b;
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
    width: 100%;
    text-align: left;
  }

  .previous-error-box .error-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    color: #ff9999;
    font-size: 1rem;
  }

  .previous-error-box .error-icon {
    font-size: 1.25rem;
  }

  .previous-error-box .error-text {
    color: #ffcccc;
    font-size: 0.95rem;
    margin: 0 0 0.75rem 0;
    line-height: 1.5;
  }

  .previous-error-box .error-help {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .previous-error-box .error-help p {
    color: #aaa;
    font-size: 0.85rem;
    margin: 0 0 0.5rem 0;
  }

  .previous-error-box .forgot-link {
    color: #4a9eff;
    font-size: 0.9rem;
    text-decoration: none;
  }

  .previous-error-box .forgot-link:hover {
    text-decoration: underline;
  }

  .btn-dismiss {
    background: transparent;
    border: 1px solid #666;
    color: #aaa;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
  }

  .btn-dismiss:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: #888;
    color: #ddd;
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

  /* WiFi test error/connecting boxes */
  .wifi-error-box {
    background: #2a1a1a;
    border: 1px solid #ff6b6b;
    border-radius: 8px;
    padding: 1rem;
    margin: 1rem 0;
    text-align: center;
  }

  .wifi-error-box .error-icon {
    font-size: 1.5rem;
    margin: 0 0 0.5rem 0;
  }

  .wifi-error-box .error-text {
    color: #ff9999;
    font-size: 0.95rem;
    margin: 0 0 0.5rem 0;
  }

  .wifi-error-box .error-hint {
    color: #888;
    font-size: 0.85rem;
    margin: 0;
  }

  .wifi-connecting-box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    background: #1a2a3a;
    border: 1px solid #4a9eff;
    border-radius: 8px;
    padding: 1rem;
    margin: 1rem 0;
    color: #4a9eff;
  }

  .wifi-connecting-box p {
    margin: 0;
  }

  .wifi-connected-box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: #1a3a2a;
    border: 1px solid #00d4aa;
    border-radius: 8px;
    padding: 0.75rem;
    margin: 1rem 0;
    color: #00d4aa;
    font-size: 0.9rem;
  }

  .wifi-icon {
    font-size: 1rem;
  }

  /* WiFi Connected - Show LAN IP before proceeding */
  .wifi-success-box {
    background: linear-gradient(135deg, #1a3a2a 0%, #152a22 100%);
    border: 2px solid #00d4aa;
    border-radius: 12px;
    padding: 1.5rem;
    margin: 1rem 0;
    text-align: center;
  }

  .wifi-success-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    color: #00d4aa;
    font-size: 1.25rem;
  }

  .wifi-success-header .success-icon {
    font-size: 1.5rem;
  }

  .lan-ip-notice {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .lan-ip-notice .notice-text {
    color: #ccc;
    font-size: 0.9rem;
    margin: 0 0 0.5rem 0;
    line-height: 1.4;
  }

  .lan-ip-display {
    background: #1a1a2e;
    border: 1px solid #4a9eff;
    border-radius: 6px;
    padding: 0.75rem;
    margin: 0.75rem 0;
  }

  .lan-ip {
    color: #4a9eff;
    font-size: 1.2rem;
    font-weight: 600;
    font-family: monospace;
    user-select: all;
  }

  .lan-ip-notice .notice-hint {
    color: #f59e0b;
    font-size: 0.85rem;
    font-weight: 500;
    margin: 0.5rem 0 0 0;
  }

  .btn-continue {
    width: 100%;
    margin-top: 0.5rem;
  }

  /* Connection lost / Continue on LAN fallback */
  .connection-lost-box {
    background: linear-gradient(135deg, #1a3a2a 0%, #152a22 100%);
    border: 1px solid #00d4aa;
    border-radius: 12px;
    padding: 1.25rem;
    margin: 1rem 0;
    text-align: center;
  }

  .connection-lost-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    color: #00d4aa;
    font-size: 1.1rem;
  }

  .wifi-success-icon {
    font-size: 1.25rem;
  }

  .connection-lost-text {
    color: #aaa;
    font-size: 0.9rem;
    margin: 0 0 1rem 0;
    line-height: 1.5;
  }

  .continue-lan-box {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    padding: 1rem;
  }

  .continue-lan-box p {
    color: #888;
    font-size: 0.85rem;
    margin: 0 0 0.5rem 0;
  }

  .lan-link {
    display: block;
    color: #4a9eff;
    font-size: 1.1rem;
    font-weight: 500;
    text-decoration: none;
    padding: 0.5rem;
    margin: 0.5rem 0;
    background: rgba(74, 158, 255, 0.1);
    border-radius: 6px;
    word-break: break-all;
  }

  .lan-link:hover {
    background: rgba(74, 158, 255, 0.2);
    text-decoration: underline;
  }

  .lan-hint {
    color: #666;
    font-size: 0.8rem;
    margin: 0.5rem 0 0 0;
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

  /* Forgot Password Link and Info Box */
  .forgot-password-link {
    background: none;
    border: none;
    color: #4a9eff;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0.25rem 0;
    margin-top: 0.25rem;
    text-decoration: underline;
    text-align: left;
  }

  .forgot-password-link:hover {
    color: #6ab0ff;
  }

  .forgot-password-info-box {
    position: relative;
    background: linear-gradient(135deg, #1a2a3a 0%, #152535 100%);
    border: 1px solid #4a9eff;
    border-radius: 10px;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }

  .info-box-close {
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    background: none;
    border: none;
    color: #888;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.25rem;
  }

  .info-box-close:hover {
    color: #fff;
  }

  .forgot-password-info-box .info-title {
    color: #4a9eff;
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
  }

  .forgot-password-info-box .info-steps {
    color: #ccc;
    font-size: 0.9rem;
    margin: 0 0 1rem 0;
    padding-left: 1.25rem;
    line-height: 1.6;
  }

  .forgot-password-info-box .info-steps li {
    margin-bottom: 0.5rem;
  }

  .forgot-password-info-box .info-steps strong {
    color: #fff;
    font-weight: 500;
  }

  .forgot-password-info-box .info-note {
    color: #888;
    font-size: 0.8rem;
    margin: 0;
    font-style: italic;
    line-height: 1.5;
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

  .result-icon.in-progress {
    color: #f59e0b;
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
    margin-bottom: 1rem;
    width: 100%;
  }

  .error-help-box {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
    width: 100%;
    text-align: center;
  }

  .error-help-box p {
    color: #aaa;
    font-size: 0.9rem;
    margin: 0 0 0.5rem 0;
  }

  .error-help-box .forgot-link {
    color: #4a9eff;
    font-size: 0.9rem;
    text-decoration: none;
  }

  .error-help-box .forgot-link:hover {
    text-decoration: underline;
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

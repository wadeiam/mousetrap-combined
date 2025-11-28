// API client for MouseTrap device endpoints
// Handles all HTTP communication with the ESP32

// In captive portal mode, window.location.origin might be captive.apple.com or similar
// We need to detect this and use the device's actual IP instead
function getBaseUrl() {
  const origin = window.location.origin;
  // Check if we're on a captive portal redirect (not a local IP)
  if (origin.includes('192.168.') || origin.includes('localhost') || origin.includes('mousetrap.local')) {
    return origin;
  }
  // In captive portal mode, fall back to the device's AP IP
  console.log('[API] Captive portal detected, using 192.168.4.1 instead of:', origin);
  return 'http://192.168.4.1';
}

const BASE_URL = getBaseUrl();

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  try {
    const url = `${BASE_URL}${endpoint}`;
    console.log(`[API] Fetching: ${url}`);

    // Build headers - only include Content-Type for requests with a body
    const headers = {
      'Accept': 'application/json',
      ...options.headers,
    };

    // Only add Content-Type for POST/PUT/PATCH with a body
    if (options.body && ['POST', 'PUT', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Handle different content types
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    } else if (contentType && contentType.includes('image/')) {
      return await response.blob();
    } else {
      return await response.text();
    }
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
}

// ============================================================================
// Device Status & Info
// ============================================================================

export async function getStatus() {
  // Use /data for triggered state and anomalies, /systemStatus for detailed stats
  // For now, combine both
  try {
    const [data, sysStatus] = await Promise.all([
      apiFetch('/data'),
      apiFetch('/systemStatus').catch(() => null)
    ]);

    return {
      threshold: data.threshold || 0,
      sensorReading: data.currentHourAverage || 0,
      detectionState: data.triggered || false,
      uptime: sysStatus?.uptime || '',
      heap: sysStatus?.heapFree || 0,
      anomalies: data.anomalies || [],
      calibrationOffset: data.calibrationOffset || 0,
      falseAlarmOffset: data.falseAlarmOffset || 0,
      overrideThreshold: data.overrideThreshold || 0
    };
  } catch (err) {
    // Fallback to just /data if systemStatus fails
    const data = await apiFetch('/data');
    return {
      threshold: data.threshold || 0,
      sensorReading: data.currentHourAverage || 0,
      detectionState: data.triggered || false,
      uptime: '',
      heap: 0,
      anomalies: data.anomalies || [],
      calibrationOffset: data.calibrationOffset || 0,
      falseAlarmOffset: data.falseAlarmOffset || 0,
      overrideThreshold: data.overrideThreshold || 0
    };
  }
}

export async function getHealthz() {
  return apiFetch('/healthz');
}

// ============================================================================
// Camera
// ============================================================================

export async function getCameraSnapshot() {
  // Returns Blob
  return apiFetch('/camera');
}

export async function getAutoPreview() {
  // Returns Blob (last captured image or live snapshot)
  return apiFetch('/auto.jpg');
}

export async function toggleLED() {
  return apiFetch('/toggleLED');
}

export async function getLEDStatus() {
  return apiFetch('/ledStatus');
}

// ============================================================================
// Captures/Gallery
// ============================================================================

export async function getCaptures() {
  // Returns { files: [{ name, size, kind }] }
  return apiFetch('/api/captures');
}

export function getCaptureURL(filename) {
  return `${BASE_URL}/captures/${filename}`;
}

export async function deleteCapture(filename) {
  // TODO: Add DELETE endpoint on device
  return apiFetch(`/captures/${filename}`, { method: 'DELETE' });
}

// ============================================================================
// Sensor & Calibration
// ============================================================================

export async function setCalibrationOffset(offset) {
  // Set calibration offset (slider value)
  return apiFetch(`/setCalib?calib=${offset}`);
}

export async function setOverrideThreshold(threshold) {
  // Set override threshold (manual input)
  return apiFetch(`/setCalib?overrideTh=${threshold}`);
}

export async function clearOverride() {
  // Clear override by sending 0
  return apiFetch(`/setCalib?overrideTh=0`);
}

export async function recalibrate() {
  // Trigger auto-recalibration
  return apiFetch('/recalib');
}

export async function resetCalibration() {
  // Reset calibration to factory defaults
  return apiFetch('/resetCalib');
}

export async function reportFalseAlarm() {
  return apiFetch('/falseAlarm');
}

// TODO: Add real-time sensor reading endpoint
export async function getSensorLive() {
  // Placeholder - device needs GET /sensor/live endpoint
  return apiFetch('/sensor/live');
}

// ============================================================================
// Servo
// ============================================================================

export async function getServoSettings() {
  // Return mock data since /servo triggers the servo
  // The backend doesn't have a GET endpoint for servo settings
  return Promise.resolve({
    startUS: 1500,
    endUS: 1100,
    disabled: false
  });
}

export async function setServoSettings(settings) {
  // settings: { startUS, endUS, disabled }
  // Backend expects form-encoded POST to /setServoSettings
  const formData = new FormData();
  formData.append('start', settings.startUS);
  formData.append('end', settings.endUS);
  if (settings.disabled) {
    formData.append('disableServo', 'on');
  }

  return fetch('/setServoSettings', {
    method: 'POST',
    body: formData,
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.text();
  });
}

export async function triggerServo() {
  // /servo endpoint triggers the servo
  return apiFetch('/servo');
}

export async function testAlert() {
  // Triggers a test alert to simulate a trap event
  const response = await apiFetch('/testAlert');
  return response;
}

// ============================================================================
// Settings & Config
// ============================================================================

// TODO: Add config endpoints on device
export async function getConfig() {
  // Placeholder - device needs GET /config
  return apiFetch('/config');
}

export async function setConfig(config) {
  // config: { mqttHost, mqttPort, tenantId, deviceId, etc. }
  return apiFetch('/config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getIPFilters() {
  // Returns { whitelist: [], blacklist: [], clientIP: '' }
  return apiFetch('/api/ip-filters');
}

export async function setIPFilters(filters) {
  // filters: { whitelist: [], blacklist: [] }
  return apiFetch('/api/ip-filters', {
    method: 'POST',
    body: JSON.stringify(filters),
  });
}

export async function getMQTTConfig() {
  // Returns { broker: '', port: 1883, user: '', password: '', topic: '', enabled: false }
  return apiFetch('/api/mqtt-config');
}

export async function setMQTTConfig(config) {
  // config: { broker, port, user, password, topic, enabled }
  return apiFetch('/api/mqtt-config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getVideoMode() {
  // Returns { mode: 'SVGA' }
  return apiFetch('/api/video-mode');
}

export async function setVideoMode(config) {
  // config: { mode: 'SVGA' | 'VGA' | 'CIF' }
  return apiFetch('/api/video-mode', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// ============================================================================
// Logs
// ============================================================================

export async function getLogs() {
  // Returns plain text
  return apiFetch('/logs', {
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  });
}

export async function getSystemLogs() {
  // Returns system logs as JSON array
  return apiFetch('/api/system-logs');
}

export async function getPreviousLogs() {
  // Returns previous system logs as JSON array (1 boot ago)
  return apiFetch('/api/previous-logs');
}

export async function getOlderLogs() {
  // Returns older system logs as JSON array (2 boots ago)
  // Useful for troubleshooting multi-reboot flows like registration
  return apiFetch('/api/older-logs');
}

export async function getLogsJson() {
  // Returns array of log entries
  return apiFetch('/logs.json', {
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  });
}

export async function getVersion() {
  return apiFetch('/version.txt', {
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  });
}

export async function getUptime() {
  return apiFetch('/uptime.txt', {
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  });
}

export async function getMetrics() {
  return apiFetch('/metrics', {
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  });
}

export async function getRequestLog() {
  // Returns array of request log entries
  return apiFetch('/api/request-log', {
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  });
}

// ============================================================================
// Maintenance
// ============================================================================

export async function getSystemInfo() {
  // Returns { firmwareVersion, buildDate, chipModel, cpuFreq, flashSize, psramSize, macAddress }
  return apiFetch('/api/system-info');
}

export async function reboot() {
  return apiFetch('/reboot', {
    headers: {
      'Authorization': 'Basic ' + btoa('ops:changeme'),
    },
  });
}

export async function sendHeartbeat() {
  return apiFetch('/sendHeartbeat');
}

export async function resetAlarm() {
  return apiFetch('/reset');
}

// ============================================================================
// Device Claiming
// ============================================================================

export async function getClaimStatus() {
  // Returns { claimed: boolean, deviceId?, deviceName?, tenantId?, mqttConnected?, macAddress?, message? }
  return apiFetch('/api/device/claim-status');
}

// ============================================================================
// Setup Wizard (Captive Portal)
// ============================================================================

export async function scanWiFiNetworks(forceRescan = false) {
  // Returns { networks: [{ ssid: string, rssi: number, secure: boolean }] }
  // Firmware does synchronous scanning, so one call is enough
  // Pass forceRescan=true to trigger a fresh scan on the device
  const endpoint = forceRescan ? '/api/wifi/scan?rescan=1' : '/api/wifi/scan';

  console.log(`[WIFI-SCAN] Calling ${endpoint}...`);

  try {
    const result = await apiFetch(endpoint);
    console.log(`[WIFI-SCAN] Got result:`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(`[WIFI-SCAN] Error:`, err);
    throw err;
  }
}

export async function connectWiFi(config) {
  // config: { ssid, password, email, accountPassword, deviceName }
  // Sends WiFi credentials and account info to device
  // Device will attempt to connect and register with the server
  return apiFetch('/api/setup/connect', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function standaloneMode(config) {
  // config: { ssid, password }
  // Saves WiFi credentials and enables standalone mode (no cloud registration)
  // Device will reboot and connect to WiFi without captive portal redirect
  return apiFetch('/api/setup/standalone', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function updateWiFi(config) {
  // config: { ssid, password }
  // Updates WiFi credentials on a claimed device without affecting claim status
  // Device will reboot and connect to the new WiFi network
  return apiFetch('/api/wifi/update', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

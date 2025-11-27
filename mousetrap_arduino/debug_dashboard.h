#ifndef DEBUG_DASHBOARD_H
#define DEBUG_DASHBOARD_H

#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>
#include <esp_system.h>

// External variables - these should be defined in your main .ino file
extern const char* OPS_USER;
extern const char* OPS_PASS;
extern bool cameraInitialized;
extern String claimedDeviceName;
// extern PubSubClient mqttClient;  // Removed - causes TCP lock assertion crash
extern struct CrashStamp {
  uint32_t magic;
  char last_page[32];
  uint16_t last_line;
  uint8_t  last_core;
  uint32_t last_ms;
  uint32_t last_heap;
  uint32_t last_biggest;
} g_crashStamp;

// HTML Dashboard Template
const char DEBUG_DASHBOARD_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔍 ESP32 Debug Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #111;
      color: #ddd;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    h1 {
      text-align: center;
      margin-bottom: 30px;
      color: #4CAF50;
      font-size: 2em;
      text-shadow: 0 0 10px rgba(76, 175, 80, 0.3);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }

    .metric {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .metric:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
    }

    .metric h2 {
      font-size: 1.2em;
      margin-bottom: 15px;
      color: #888;
      border-bottom: 2px solid #333;
      padding-bottom: 8px;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      margin: 10px 0;
      padding: 8px 0;
    }

    .stat-label {
      color: #999;
      font-size: 0.95em;
    }

    .stat-value {
      font-weight: bold;
      font-size: 1.05em;
    }

    .good { color: #4CAF50; }
    .warn { color: #FFC107; }
    .bad { color: #F44336; }

    .progress-bar {
      width: 100%;
      height: 24px;
      background: #222;
      border-radius: 12px;
      overflow: hidden;
      margin: 8px 0;
      border: 1px solid #444;
    }

    .progress-fill {
      height: 100%;
      transition: width 0.3s ease, background-color 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85em;
      font-weight: bold;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }

    .status-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 8px;
      box-shadow: 0 0 8px currentColor;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .online { background: #4CAF50; }
    .offline { background: #F44336; animation: none; }

    .section-full {
      grid-column: 1 / -1;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }

    .crash-box {
      background: #2a1a1a;
      border-left: 4px solid #F44336;
      padding: 15px;
      border-radius: 4px;
      margin-top: 10px;
    }

    .no-crash {
      border-left-color: #4CAF50;
      background: #1a2a1a;
    }

    code {
      background: #222;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }

    .refresh-indicator {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #2a2a2a;
      padding: 10px 15px;
      border-radius: 20px;
      border: 1px solid #444;
      font-size: 0.9em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid #444;
      border-top-color: #4CAF50;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      body { padding: 10px; }
      h1 { font-size: 1.5em; }
      .grid { grid-template-columns: 1fr; }
    }

    .back-link {
      display: inline-block;
      margin-top: 20px;
      padding: 10px 20px;
      background: #2a2a2a;
      color: #4CAF50;
      text-decoration: none;
      border-radius: 5px;
      border: 1px solid #444;
      transition: background 0.2s;
    }

    .back-link:hover {
      background: #333;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1 id="page-title">🔍 ESP32-S3 Debug Dashboard</h1>

    <div class="refresh-indicator">
      <div class="spinner"></div>
      <span>Auto-refresh: <span id="countdown">5</span>s</span>
      <button onclick="exportData()" style="margin-left: 20px; padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">📋 Export for Claude</button>
    </div>

    <div class="grid">
      <!-- Memory Usage -->
      <div class="metric">
        <h2>💾 Memory Usage</h2>
        <div class="stat-row">
          <span class="stat-label">Heap Free</span>
          <span class="stat-value" id="heap-free">--</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="heap-bar" style="width: 0%">0%</div>
        </div>

        <div class="stat-row" style="margin-top: 15px;">
          <span class="stat-label">PSRAM Free</span>
          <span class="stat-value" id="psram-free">--</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="psram-bar" style="width: 0%">0%</div>
        </div>
      </div>

      <!-- System State -->
      <div class="metric">
        <h2>⚙️ System State</h2>
        <div class="stat-row">
          <span class="stat-label">
            <span class="status-indicator" id="wifi-status"></span>WiFi
          </span>
          <span class="stat-value" id="wifi-ssid">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">
            <span class="status-indicator" id="mqtt-status"></span>MQTT
          </span>
          <span class="stat-value" id="mqtt-state">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">
            <span class="status-indicator" id="camera-status"></span>Camera
          </span>
          <span class="stat-value" id="camera-state">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">
            <span class="status-indicator" id="sensor-status"></span>Sensor
          </span>
          <span class="stat-value" id="sensor-state">--</span>
        </div>
      </div>

      <!-- Device Info -->
      <div class="metric">
        <h2>📊 Device Info</h2>
        <div class="stat-row">
          <span class="stat-label">Uptime</span>
          <span class="stat-value" id="uptime">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Chip Model</span>
          <span class="stat-value" id="chip-model">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">CPU Freq</span>
          <span class="stat-value" id="cpu-freq">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Flash Size</span>
          <span class="stat-value" id="flash-size">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Free Heap (min)</span>
          <span class="stat-value" id="min-heap">--</span>
        </div>
      </div>

      <!-- Last Crash Info -->
      <div class="metric section-full">
        <h2>⚠️ Last Crash / Reset Info</h2>
        <div id="crash-info">
          <div class="crash-box no-crash">
            <div class="stat-row">
              <span class="stat-label">Reset Reason</span>
              <span class="stat-value" id="reset-reason">--</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <a href="/" class="back-link">← Back to Home</a>
  </div>

  <script>
    let countdown = 5;
    let countdownInterval;

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatUptime(ms) {
      const seconds = Math.floor(ms / 1000);
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;

      if (days > 0) return `${days}d ${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
      return `${minutes}m ${secs}s`;
    }

    function getColorClass(percent) {
      if (percent < 50) return 'good';
      if (percent < 80) return 'warn';
      return 'bad';
    }

    function updateProgressBar(barId, used, total) {
      const bar = document.getElementById(barId);
      const percent = total > 0 ? Math.round((used / total) * 100) : 0;
      const colorClass = getColorClass(percent);

      bar.style.width = percent + '%';
      bar.textContent = percent + '%';
      bar.className = 'progress-fill ' + colorClass;
    }

    function updateStatusIndicator(id, isOnline) {
      const indicator = document.getElementById(id);
      indicator.className = 'status-indicator ' + (isOnline ? 'online' : 'offline');
    }

    function updateDashboard() {
      fetch('/api/debug-stats')
        .then(response => response.json())
        .then(data => {
          // Memory
          document.getElementById('heap-free').textContent = formatBytes(data.heapFree);
          updateProgressBar('heap-bar', data.heapTotal - data.heapFree, data.heapTotal);

          document.getElementById('psram-free').textContent = formatBytes(data.psramFree);
          updateProgressBar('psram-bar', data.psramTotal - data.psramFree, data.psramTotal);

          // System State
          updateStatusIndicator('wifi-status', data.wifiConnected);
          document.getElementById('wifi-ssid').textContent = data.wifiConnected ? (data.wifiSSID || 'Connected') : 'Disconnected';
          document.getElementById('wifi-ssid').className = 'stat-value ' + (data.wifiConnected ? 'good' : 'bad');

          updateStatusIndicator('mqtt-status', data.mqttConnected);
          document.getElementById('mqtt-state').textContent = data.mqttConnected ? 'Connected' : 'Disconnected';
          document.getElementById('mqtt-state').className = 'stat-value ' + (data.mqttConnected ? 'good' : 'bad');

          updateStatusIndicator('camera-status', data.cameraOnline);
          document.getElementById('camera-state').textContent = data.cameraOnline ? 'Online' : 'Offline';
          document.getElementById('camera-state').className = 'stat-value ' + (data.cameraOnline ? 'good' : 'bad');

          updateStatusIndicator('sensor-status', data.sensorOnline);
          document.getElementById('sensor-state').textContent = data.sensorOnline ? 'Active' : 'Inactive';
          document.getElementById('sensor-state').className = 'stat-value ' + (data.sensorOnline ? 'good' : 'warn');

          // Device Info
          document.getElementById('uptime').textContent = formatUptime(data.uptime);
          document.getElementById('chip-model').textContent = data.chipModel || 'ESP32-S3';
          document.getElementById('cpu-freq').textContent = data.cpuFreq + ' MHz';
          document.getElementById('flash-size').textContent = formatBytes(data.flashSize);
          document.getElementById('min-heap').textContent = formatBytes(data.minFreeHeap);

          // Update page title with device name
          const deviceName = data.deviceName || 'MouseTrap';
          document.getElementById('page-title').textContent = '🔍 ' + deviceName + ' - Debug';
          document.title = '🔍 ' + deviceName + ' - Debug';

          // Crash Info
          let crashHtml = '';
          if (data.crash && data.crash.stamped) {
            crashHtml = `
              <div class="crash-box">
                <div class="stat-row">
                  <span class="stat-label">Reset Reason</span>
                  <span class="stat-value bad">${data.crash.reason || 'Unknown'}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Last Page</span>
                  <span class="stat-value"><code>${data.crash.last_page || 'N/A'}</code></span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Last Line</span>
                  <span class="stat-value"><code>${data.crash.last_line || 0}</code></span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Core ID</span>
                  <span class="stat-value">${data.crash.last_core || 0}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Free Heap at Crash</span>
                  <span class="stat-value">${formatBytes(data.crash.last_heap || 0)}</span>
                </div>
              </div>
            `;
          } else {
            crashHtml = `
              <div class="crash-box no-crash">
                <div class="stat-row">
                  <span class="stat-label">Reset Reason</span>
                  <span class="stat-value good">${data.resetReason || 'Power On'}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Status</span>
                  <span class="stat-value good">No crash detected</span>
                </div>
              </div>
            `;
          }
          document.getElementById('crash-info').innerHTML = crashHtml;

          // Reset countdown
          countdown = 5;
        })
        .catch(err => {
          console.error('Failed to fetch debug stats:', err);
        });
    }

    // Update countdown timer
    countdownInterval = setInterval(() => {
      countdown--;
      document.getElementById('countdown').textContent = countdown;
      if (countdown <= 0) {
        countdown = 5;
      }
    }, 1000);

    // Auto-refresh every 5 seconds
    setInterval(updateDashboard, 5000);

    // Initial load
    updateDashboard();

    // Export data in Claude-friendly format
    let latestData = null;

    function exportData() {
      if (!latestData) {
        alert('No data available yet');
        return;
      }

      const markdown = `# ESP32-S3 Debug Report
Generated: ${new Date().toISOString()}

## System Overview
- **Chip**: ${latestData.chipModel || 'ESP32-S3'}
- **CPU Frequency**: ${latestData.cpuFreq} MHz
- **Flash Size**: ${formatBytes(latestData.flashSize)}
- **Uptime**: ${formatUptime(latestData.uptime)}

## Memory Status
- **Heap Free**: ${formatBytes(latestData.heapFree)} / ${formatBytes(latestData.heapTotal)} (${Math.round((latestData.heapFree / latestData.heapTotal) * 100)}% free)
- **Min Free Heap**: ${formatBytes(latestData.minFreeHeap)}
- **PSRAM Free**: ${formatBytes(latestData.psramFree)} / ${formatBytes(latestData.psramTotal)} (${Math.round((latestData.psramFree / latestData.psramTotal) * 100)}% free)

## Connectivity
- **WiFi**: ${latestData.wifiConnected ? 'Connected to ' + (latestData.wifiSSID || 'network') : 'Disconnected'}
- **MQTT**: ${latestData.mqttConnected ? 'Connected' : 'Disconnected'}

## Hardware Status
- **Camera**: ${latestData.cameraOnline ? 'Online' : 'Offline'}
- **Sensor**: ${latestData.sensorOnline ? 'Active' : 'Inactive'}

## Crash Information
${latestData.crash && latestData.crash.stamped ? `
**⚠️ Previous Crash Detected**
- Reset Reason: ${latestData.crash.reason || 'Unknown'}
- Last Page: \`${latestData.crash.last_page || 'N/A'}\`
- Last Line: \`${latestData.crash.last_line || 0}\`
- Core ID: ${latestData.crash.last_core || 0}
- Free Heap at Crash: ${formatBytes(latestData.crash.last_heap || 0)}
` : `**✓ No Crash Detected**
- Reset Reason: ${latestData.resetReason || 'Power On'}
- Status: Clean boot
`}

## Raw JSON Data
\`\`\`json
${JSON.stringify(latestData, null, 2)}
\`\`\`
`;

      // Copy to clipboard
      navigator.clipboard.writeText(markdown).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.background = '#2196F3';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '#4CAF50';
        }, 2000);
      }).catch(err => {
        // Fallback: show in alert
        alert('Report copied! If clipboard failed, here it is:\\n\\n' + markdown);
      });
    }

    // Store latest data
    const originalUpdate = updateDashboard;
    updateDashboard = function() {
      fetch('/api/debug-stats')
        .then(response => response.json())
        .then(data => {
          latestData = data;

          // Memory
          document.getElementById('heap-free').textContent = formatBytes(data.heapFree);
          updateProgressBar('heap-bar', data.heapTotal - data.heapFree, data.heapTotal);

          document.getElementById('psram-free').textContent = formatBytes(data.psramFree);
          updateProgressBar('psram-bar', data.psramTotal - data.psramFree, data.psramTotal);

          // System State
          updateStatusIndicator('wifi-status', data.wifiConnected);
          document.getElementById('wifi-ssid').textContent = data.wifiConnected ? (data.wifiSSID || 'Connected') : 'Disconnected';
          document.getElementById('wifi-ssid').className = 'stat-value ' + (data.wifiConnected ? 'good' : 'bad');

          updateStatusIndicator('mqtt-status', data.mqttConnected);
          document.getElementById('mqtt-state').textContent = data.mqttConnected ? 'Connected' : 'Disconnected';
          document.getElementById('mqtt-state').className = 'stat-value ' + (data.mqttConnected ? 'good' : 'bad');

          updateStatusIndicator('camera-status', data.cameraOnline);
          document.getElementById('camera-state').textContent = data.cameraOnline ? 'Online' : 'Offline';
          document.getElementById('camera-state').className = 'stat-value ' + (data.cameraOnline ? 'good' : 'bad');

          updateStatusIndicator('sensor-status', data.sensorOnline);
          document.getElementById('sensor-state').textContent = data.sensorOnline ? 'Active' : 'Inactive';
          document.getElementById('sensor-state').className = 'stat-value ' + (data.sensorOnline ? 'good' : 'warn');

          // Device Info
          document.getElementById('uptime').textContent = formatUptime(data.uptime);
          document.getElementById('chip-model').textContent = data.chipModel || 'ESP32-S3';
          document.getElementById('cpu-freq').textContent = data.cpuFreq + ' MHz';
          document.getElementById('flash-size').textContent = formatBytes(data.flashSize);
          document.getElementById('min-heap').textContent = formatBytes(data.minFreeHeap);

          // Update page title with device name
          const deviceName = data.deviceName || 'MouseTrap';
          document.getElementById('page-title').textContent = '🔍 ' + deviceName + ' - Debug';
          document.title = '🔍 ' + deviceName + ' - Debug';

          // Crash Info
          let crashHtml = '';
          if (data.crash && data.crash.stamped) {
            crashHtml = `
              <div class="crash-box">
                <div class="stat-row">
                  <span class="stat-label">Reset Reason</span>
                  <span class="stat-value bad">${data.crash.reason || 'Unknown'}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Last Page</span>
                  <span class="stat-value"><code>${data.crash.last_page || 'N/A'}</code></span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Last Line</span>
                  <span class="stat-value"><code>${data.crash.last_line || 0}</code></span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Core ID</span>
                  <span class="stat-value">${data.crash.last_core || 0}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Free Heap at Crash</span>
                  <span class="stat-value">${formatBytes(data.crash.last_heap || 0)}</span>
                </div>
              </div>
            `;
          } else {
            crashHtml = `
              <div class="crash-box no-crash">
                <div class="stat-row">
                  <span class="stat-label">Reset Reason</span>
                  <span class="stat-value good">${data.resetReason || 'Power On'}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Status</span>
                  <span class="stat-value good">No crash detected</span>
                </div>
              </div>
            `;
          }
          document.getElementById('crash-info').innerHTML = crashHtml;

          // Reset countdown
          countdown = 5;
        })
        .catch(err => {
          console.error('Failed to fetch debug stats:', err);
        });
    };
  </script>
</body>
</html>
)rawliteral";

// Handler function for debug dashboard
void handleDebugDashboard(AsyncWebServerRequest *request) {
  // Check authentication
  if (!request->authenticate(OPS_USER, OPS_PASS)) {
    return request->requestAuthentication();
  }

  // Send the HTML dashboard
  request->send_P(200, "text/html", DEBUG_DASHBOARD_HTML);
}

// Handler function for debug stats API endpoint
void handleDebugStatsAPI(AsyncWebServerRequest *request) {
  // Check authentication
  if (!request->authenticate(OPS_USER, OPS_PASS)) {
    return request->requestAuthentication();
  }

  // Create JSON document
  JsonDocument doc;

  // Memory stats
  doc["heapFree"] = ESP.getFreeHeap();
  doc["heapTotal"] = ESP.getHeapSize();
  doc["psramFree"] = psramFound() ? ESP.getFreePsram() : 0;
  doc["psramTotal"] = psramFound() ? ESP.getPsramSize() : 0;
  doc["minFreeHeap"] = ESP.getMinFreeHeap();

  // System state
  doc["wifiConnected"] = WiFi.status() == WL_CONNECTED;
  doc["wifiSSID"] = WiFi.SSID();
  // doc["mqttConnected"] = mqttClient.connected();  // REMOVED - causes TCP lock assertion in async handler
  doc["cameraOnline"] = cameraInitialized;
  doc["sensorOnline"] = true; // Assume active if running

  // Device info
  doc["uptime"] = millis();
  doc["chipModel"] = ESP.getChipModel();
  doc["cpuFreq"] = ESP.getCpuFreqMHz();
  doc["flashSize"] = ESP.getFlashChipSize();
  doc["deviceName"] = claimedDeviceName.length() > 0 ? claimedDeviceName : "MouseTrap";

  // Reset reason
  esp_reset_reason_t resetReason = esp_reset_reason();
  const char* reasonStr = "Unknown";
  switch (resetReason) {
    case ESP_RST_POWERON:   reasonStr = "Power On"; break;
    case ESP_RST_SW:        reasonStr = "Software Reset"; break;
    case ESP_RST_PANIC:     reasonStr = "Exception/Panic"; break;
    case ESP_RST_INT_WDT:   reasonStr = "Interrupt Watchdog"; break;
    case ESP_RST_TASK_WDT:  reasonStr = "Task Watchdog"; break;
    case ESP_RST_WDT:       reasonStr = "Other Watchdog"; break;
    case ESP_RST_DEEPSLEEP: reasonStr = "Deep Sleep"; break;
    case ESP_RST_BROWNOUT:  reasonStr = "Brownout"; break;
    case ESP_RST_SDIO:      reasonStr = "SDIO Reset"; break;
    default: break;
  }
  doc["resetReason"] = reasonStr;

  // Crash info (if available)
  JsonObject crash = doc["crash"].to<JsonObject>();
  crash["stamped"] = (g_crashStamp.magic == 0xC0DEC0DE && g_crashStamp.last_page[0] != 0);
  if (crash["stamped"]) {
    crash["reason"] = reasonStr;
    crash["last_page"] = g_crashStamp.last_page;
    crash["last_line"] = g_crashStamp.last_line;
    crash["last_core"] = g_crashStamp.last_core;
    crash["last_heap"] = g_crashStamp.last_heap;
    crash["last_biggest"] = g_crashStamp.last_biggest;
  }

  // Serialize and send
  String response;
  serializeJson(doc, response);
  request->send(200, "application/json", response);
}

#endif // DEBUG_DASHBOARD_H

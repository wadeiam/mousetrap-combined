/**
 * Scout Device Firmware
 *
 * Entry point monitoring with AI-powered rodent detection.
 * Detects motion, filters by size, and sends images to server for classification.
 *
 * Hardware: XIAO ESP32-S3 Sense (Seeed Studio)
 * Features:
 *   - Camera-based motion detection
 *   - On-device size filtering (reject people/pets)
 *   - MQTT communication with server
 *   - Gallery with FIFO storage
 *   - OTA firmware updates
 *   - Dual-mode: claimed (fleet) or standalone
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_camera.h>
#include <HTTPClient.h>
#include <Update.h>
#include <ElegantOTA.h>
#include <time.h>
#include <base64.h>
#include <DNSServer.h>

// HMAC-SHA256 for secure device claim tokens
#include <mbedtls/md.h>

#include "camera_pins.h"
#include "motion_detect.h"
#include "edge_classifier.h"

// =============================================================================
// Version and Configuration
// =============================================================================

#define FIRMWARE_VERSION "v0.1.3"  // Increased JPEG threshold to 25%, require 3 consecutive frames
#define FILESYSTEM_VERSION "v0.1.0"
#define DEVICE_TYPE "scout"

// Server URL for device claiming
#ifndef CLAIM_SERVER_URL
#define CLAIM_SERVER_URL "http://mtmon.wadehargrove.com:4000"
#endif

// HMAC-SHA256 Shared Secret for Device Claim Tokens
// IMPORTANT: Must match server-side secret (same as trap devices)
#ifndef DEVICE_CLAIM_SECRET
#define DEVICE_CLAIM_SECRET "mousetrap-device-secret-change-in-production"
#endif

// Forward declaration of ClaimCredentials struct
struct ClaimCredentials {
  String token;      // HMAC-SHA256 hex-encoded token
  String timestamp;  // Unix timestamp string
  String mac;        // Device MAC address
};

// MQTT settings
#define MQTT_PORT 1883
#define MQTT_BUFFER_SIZE 50000  // 50KB for image payloads

// Motion detection settings
#define MOTION_CHECK_INTERVAL 200   // ms between motion checks (5 fps for fast movement)
#define MOTION_COOLDOWN 5000        // ms after detection (5 seconds - allows re-detection)
#define MAX_GALLERY_IMAGES 50       // FIFO limit
#define GALLERY_DIR "/gallery"

// =============================================================================
// Global Variables
// =============================================================================

// Preferences namespaces
Preferences devicePrefs;
Preferences versionPrefs;
Preferences motionPrefs;

// WiFi state
String savedSSID = "";
String savedPassword = "";
bool wifiConnected = false;

// Device claiming state
bool deviceClaimed = false;
bool standaloneMode = false;
String claimedDeviceId = "";
String claimedDeviceName = "Scout";
String claimedTenantId = "";
String claimedMqttBroker = "";
String claimedMqttUsername = "";
String claimedMqttPassword = "";
String claimedMqttClientId = "";
String claimedServerUrl = "";

// Version tracking
String currentFirmwareVersion = FIRMWARE_VERSION;
String currentFilesystemVersion = FILESYSTEM_VERSION;
unsigned long firmwareUpdateTimestamp = 0;
unsigned long filesystemUpdateTimestamp = 0;

// MQTT
WiFiClient mqttWifiClient;
PubSubClient mqttClient(mqttWifiClient);
unsigned long lastMqttReconnect = 0;
unsigned long lastStatusPublish = 0;
bool mqttReallyConnected = false;

// OTA state
bool mqttOtaInProgress = false;
String mqttOtaType = "";  // "firmware" or "filesystem"
size_t mqttOtaTotalBytes = 0;
size_t mqttOtaWrittenBytes = 0;
String mqttOtaSha256 = "";
int mqttOtaLastProgress = -1;

// Camera
bool cameraInitialized = false;

// Motion detection
MotionDetector motionDetector;
unsigned long lastMotionCheck = 0;
uint32_t motionEventCount = 0;

// Web server
AsyncWebServer server(80);

// DNS Server for captive portal
DNSServer dnsServer;
const byte DNS_PORT = 53;
bool isAPMode = false;

// Cached WiFi scan results for captive portal
struct CachedNetwork {
  String ssid;
  int rssi;
  int channel;
  bool open;
};
CachedNetwork cachedNetworks[20];
int cachedNetworkCount = 0;
unsigned long lastScanTime = 0;
bool scanInProgress = false;

// Setup result struct (for persisting error across reboot)
struct SetupResult {
  bool attempted;
  bool success;
  String errorCode;
  String errorMessage;
};

// Setup wizard state machine (matching trap exactly)
enum SetupState {
  SETUP_IDLE,
  SETUP_CONNECTING_WIFI,
  SETUP_WIFI_CONNECTED,    // WiFi connected, waiting for registration info
  SETUP_CHECKING_CLAIM,    // Checking if device is already claimed
  SETUP_CLAIM_RECOVERED,   // Device was already claimed, credentials recovered
  SETUP_SYNCING_TIME,
  SETUP_REGISTERING,
  SETUP_SAVING,
  SETUP_COMPLETE,
  SETUP_FAILED
};

static SetupState currentSetupState = SETUP_IDLE;
static String currentSetupStep = "";
static String currentSetupError = "";
static String currentSetupErrorCode = "";
static bool setupNeedsReboot = false;
static String recoveredDeviceName = "";  // Name of device if claim was recovered

// Two-phase setup: test WiFi first, then register
static bool pendingWiFiTest = false;
static unsigned long pendingWiFiTestTime = 0;
static String pendingWiFiTestSSID = "";
static String pendingWiFiTestPassword = "";

static bool pendingRegistration = false;
static unsigned long pendingRegistrationTime = 0;

// Legacy combined setup
static bool pendingSetup = false;
static unsigned long pendingSetupTime = 0;
static String pendingSetupSSID = "";
static String pendingSetupPassword = "";
static String pendingSetupEmail = "";
static String pendingSetupAccountPassword = "";
static String pendingSetupDeviceName = "";
static bool pendingSetupIsNewAccount = true;
static String pendingSetupTimezone = "UTC";

// System log (circular buffer)
#define MAX_LOG_ENTRIES 50
String systemLog[MAX_LOG_ENTRIES];
int logIndex = 0;

// LED control (onboard LED on GPIO 4)
bool ledState = false;
#define ONBOARD_LED_PIN 4

// Access logging (circular buffer)
#define MAX_ACCESS_LOGS 50
String accessLogs[MAX_ACCESS_LOGS];
int accessLogIndex = 0;
int accessLogCount = 0;

// Calibration stubs (for future ToF sensor)
int calibrationOffset = 0;
int falseAlarmOffset = 0;
int overrideThreshold = 0;

// Detection state (for /data endpoint compatibility)
bool detectionState = false;

// =============================================================================
// Forward Declarations
// =============================================================================

void loadWiFiCredentials();
void saveWiFiCredentials(const String& ssid, const String& password);
void loadClaimCredentials();
void saveClaimCredentials();
void loadMotionConfig();
void saveMotionConfig();
void initCamera();
void setupWebServer();
void mqttSetup();
bool mqttConnect();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void publishDeviceStatus();
void publishSnapshot(camera_fb_t* frame);
void publishMotionEvent(camera_fb_t* frame, MotionResult& result);
void checkMotion();
void saveImageToGallery(camera_fb_t* frame, const String& classification);
void cleanupGallery();
String getGalleryJson();
void addSystemLog(const String& msg);

// =============================================================================
// Utility Functions
// =============================================================================

void addSystemLog(const String& msg) {
  time_t now = time(nullptr);
  char timeStr[32];

  // Use full date format if NTP is synced, otherwise just time
  if (now >= 1000000000) {
    strftime(timeStr, sizeof(timeStr), "%b %d %H:%M:%S", localtime(&now));
  } else {
    // Fallback to uptime if NTP not synced
    unsigned long uptime = millis() / 1000;
    snprintf(timeStr, sizeof(timeStr), "%02lu:%02lu:%02lu",
             uptime / 3600, (uptime % 3600) / 60, uptime % 60);
  }

  systemLog[logIndex] = String(timeStr) + " " + msg;
  logIndex = (logIndex + 1) % MAX_LOG_ENTRIES;

  Serial.println("[Log] " + msg);
}

void addAccessLog(const String& msg) {
  accessLogs[accessLogIndex] = msg;
  accessLogIndex = (accessLogIndex + 1) % MAX_ACCESS_LOGS;
  if (accessLogCount < MAX_ACCESS_LOGS) {
    accessLogCount++;
  }
}

// Keeps TWO generations of previous logs for troubleshooting multi-reboot flows
void rotateLogs() {
  if (LittleFS.exists("/logs.txt")) {
    // Rotate: prevLogs.txt → prevLogs2.txt (keep 2 generations)
    LittleFS.remove("/prevLogs2.txt");
    if (LittleFS.exists("/prevLogs.txt")) {
      LittleFS.rename("/prevLogs.txt", "/prevLogs2.txt");
    }
    // rename this session's log to prevLogs
    LittleFS.rename("/logs.txt", "/prevLogs.txt");
  }
  // start a fresh log file for this run
  File f = LittleFS.open("/logs.txt", "w");
  if (f) f.close();
}

// Load persisted versions from Preferences
void loadVersions() {
  versionPrefs.begin("versions", false);  // Read-write to allow updates

  // Load persisted firmware version (or use fallback if not found)
  String persistedFirmware = versionPrefs.getString("firmware", "");

  if (persistedFirmware.isEmpty()) {
    // No version stored - use fallback (first boot or NVS cleared)
    currentFirmwareVersion = FIRMWARE_VERSION;
    versionPrefs.putString("firmware", FIRMWARE_VERSION);
    Serial.printf("[Versions] No persisted version, using fallback: %s\n", FIRMWARE_VERSION);
  } else {
    // Use the OTA-set version from NVS (controlled by server upload)
    currentFirmwareVersion = persistedFirmware;
    firmwareUpdateTimestamp = versionPrefs.getULong("fwTime", 0);
    Serial.printf("[Versions] Using persisted firmware version: %s (timestamp: %lu)\n",
                  persistedFirmware.c_str(), firmwareUpdateTimestamp);
  }

  // Load filesystem version from Preferences (set by MQTT OTA), then fallback
  String persistedFilesystem = versionPrefs.getString("filesystem", "");
  if (persistedFilesystem.isEmpty()) {
    // No OTA version saved, use compile-time constant
    currentFilesystemVersion = FILESYSTEM_VERSION;
    filesystemUpdateTimestamp = 0;
    Serial.printf("[Versions] No persisted filesystem version, using fallback: %s\n", FILESYSTEM_VERSION);
  } else {
    // Use the OTA-set version from NVS (controlled by server upload)
    currentFilesystemVersion = persistedFilesystem;
    filesystemUpdateTimestamp = versionPrefs.getULong("fsTime", 0);
    Serial.printf("[Versions] Using persisted filesystem version: %s (timestamp: %lu)\n",
                  persistedFilesystem.c_str(), filesystemUpdateTimestamp);
  }

  versionPrefs.end();

  Serial.printf("[Versions] Current: FW=%s (ts=%lu), FS=%s (ts=%lu)\n",
    currentFirmwareVersion.c_str(), firmwareUpdateTimestamp,
    currentFilesystemVersion.c_str(), filesystemUpdateTimestamp);
}

// Save version after successful OTA
void saveVersion(const char* type, const char* version) {
  versionPrefs.begin("versions", false);  // Read-write
  unsigned long now = time(nullptr);

  if (strcmp(type, "firmware") == 0) {
    versionPrefs.putString("firmware", version);
    versionPrefs.putULong("fwTime", now);
    currentFirmwareVersion = String(version);
    firmwareUpdateTimestamp = now;
    Serial.printf("[Versions] Saved firmware version: %s (timestamp: %lu)\n", version, now);
  } else if (strcmp(type, "filesystem") == 0) {
    versionPrefs.putString("filesystem", version);
    versionPrefs.putULong("fsTime", now);
    currentFilesystemVersion = String(version);
    filesystemUpdateTimestamp = now;
    Serial.printf("[Versions] Saved filesystem version: %s (timestamp: %lu)\n", version, now);
  }
  versionPrefs.end();
}

// =============================================================================
// OTA Update Functions
// =============================================================================

// Publish OTA progress to cloud
void publishOtaProgress(const char* status, int progress, const char* error = nullptr) {
  if (!mqttClient.connected() || !deviceClaimed) return;

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddressNoColons();

  char topic[256];
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/ota/progress",
           claimedTenantId.c_str(), clientId.c_str());

  JsonDocument doc;
  doc["type"] = mqttOtaType;
  doc["status"] = status;
  doc["progress"] = progress;
  doc["bytes_downloaded"] = mqttOtaWrittenBytes;
  doc["total_bytes"] = mqttOtaTotalBytes;
  if (error) doc["error"] = error;

  String payload;
  serializeJson(doc, payload);

  mqttClient.publish(topic, payload.c_str());
  mqttOtaLastProgress = progress;
}

// HTTP download and flash binary
bool downloadAndFlash(const char* url, size_t expectedSize, const char* sha256, int updateType) {
  HTTPClient http;
  http.begin(url);
  http.setTimeout(30000);  // 30 second timeout

  Serial.printf("[OTA] Downloading from: %s\n", url);
  addSystemLog(String("[OTA] Starting download: ") + url);

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("[OTA] HTTP GET failed: %d\n", httpCode);
    addSystemLog(String("[OTA] Download failed: HTTP ") + httpCode);
    http.end();
    return false;
  }

  size_t contentLength = http.getSize();
  if (contentLength == 0 || (expectedSize > 0 && contentLength != expectedSize)) {
    Serial.printf("[OTA] Size mismatch. Expected: %u, Got: %u\n", expectedSize, contentLength);
    addSystemLog("[OTA] Size mismatch");
    http.end();
    return false;
  }

  // Unmount filesystem if doing filesystem update
  if (updateType == U_SPIFFS) {
    Serial.println("[OTA] Unmounting LittleFS before update...");
    addSystemLog("[OTA] Unmounting filesystem");
    LittleFS.end();
  }

  // Begin Update
  bool beginOk = Update.begin(contentLength, updateType);
  if (!beginOk) {
    Serial.printf("[OTA] Update.begin failed: %s\n", Update.errorString());
    addSystemLog(String("[OTA] Update.begin failed: ") + Update.errorString());
    http.end();
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  mqttOtaTotalBytes = contentLength;
  mqttOtaWrittenBytes = 0;

  uint8_t buf[1024];
  int lastProgress = -1;

  while (http.connected() && mqttOtaWrittenBytes < contentLength) {
    size_t available = stream->available();
    if (available) {
      size_t toRead = min(available, sizeof(buf));
      size_t bytesRead = stream->readBytes(buf, toRead);
      size_t written = Update.write(buf, bytesRead);

      if (written != bytesRead) {
        Serial.println("[OTA] Write failed");
        addSystemLog("[OTA] Flash write failed");
        Update.abort();
        http.end();
        return false;
      }

      mqttOtaWrittenBytes += written;

      // Publish progress every 10%
      int progress = (mqttOtaWrittenBytes * 100) / contentLength;
      if (progress >= lastProgress + 10 || progress == 100) {
        publishOtaProgress("downloading", progress);
        lastProgress = progress;
      }
    } else {
      delay(10);
    }
  }

  http.end();

  // Verify and finish
  if (mqttOtaWrittenBytes != contentLength) {
    Serial.printf("[OTA] Incomplete download: %u / %u bytes\n", mqttOtaWrittenBytes, contentLength);
    addSystemLog("[OTA] Incomplete download");
    Update.abort();
    return false;
  }

  publishOtaProgress("verifying", 100);

  if (!Update.end(true)) {
    Serial.printf("[OTA] Update.end failed: %s\n", Update.errorString());
    addSystemLog(String("[OTA] Update.end failed: ") + Update.errorString());
    return false;
  }

  Serial.println("[OTA] Update complete!");
  addSystemLog("[OTA] Update successful, rebooting...");
  return true;
}

// Handle firmware/filesystem update notification
void handleOtaNotification(const JsonDocument& doc) {
  const char* version = doc["version"];
  const char* url = doc["url"];
  size_t size = doc["size"] | 0;
  const char* sha256 = doc["sha256"] | "";
  const char* deviceType = doc["device_type"] | "";

  Serial.printf("[OTA] MQTT payload - version: '%s', url: '%s', device_type: '%s'\n",
                version ? version : "NULL", url ? url : "NULL", deviceType);

  if (!version || !url) {
    Serial.println("[OTA] Invalid update message");
    return;
  }

  // Check device_type filter - if specified, must match "scout"
  // Empty device_type means update applies to all devices (legacy behavior)
  if (strlen(deviceType) > 0 && strcmp(deviceType, "scout") != 0) {
    Serial.printf("[OTA] Ignoring update for device_type '%s' (this is a scout)\n", deviceType);
    addSystemLog(String("[OTA] Ignoring device_type: ") + deviceType);
    return;
  }

  // Compare versions
  const char* currentVersion = (mqttOtaType == "firmware") ? currentFirmwareVersion.c_str() : currentFilesystemVersion.c_str();
  addSystemLog(String("[OTA] Version check: ") + version + " vs " + currentVersion);
  if (strcmp(version, currentVersion) <= 0) {
    Serial.printf("[OTA] Already up to date: %s (current: %s)\n", version, currentVersion);
    addSystemLog(String("[OTA] Already up to date"));
    return;
  }

  Serial.printf("[OTA] New %s available: %s -> %s\n", mqttOtaType.c_str(), currentVersion, version);
  addSystemLog(String("[OTA] Updating ") + mqttOtaType + " to " + version);

  mqttOtaInProgress = true;
  mqttOtaTotalBytes = size;
  mqttOtaWrittenBytes = 0;
  mqttOtaSha256 = String(sha256);

  publishOtaProgress("downloading", 0);

  int updateType = (mqttOtaType == "firmware") ? U_FLASH : U_SPIFFS;
  bool success = downloadAndFlash(url, size, sha256, updateType);

  if (success) {
    publishOtaProgress("success", 100);

    // Save the new version before reboot
    saveVersion(mqttOtaType.c_str(), version);

    delay(1000);
    ESP.restart();
  } else {
    publishOtaProgress("error", 0, "Download or flash failed");
    mqttOtaInProgress = false;
  }
}

String getMacAddress() {
  // Returns MAC with colons (AA:BB:CC:DD:EE:FF format required by server)
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(macStr);
}

String getMacAddressNoColons() {
  // Returns MAC without colons (for MQTT client ID, etc.)
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[13];
  snprintf(macStr, sizeof(macStr), "%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(macStr);
}

// =============================================================================
// Setup Result Persistence (for error display after reboot)
// =============================================================================

void saveSetupResult(bool success, const String& errorCode, const String& errorMessage) {
  devicePrefs.begin("setup", false);
  devicePrefs.putBool("attempted", true);
  devicePrefs.putBool("success", success);
  devicePrefs.putString("errorCode", errorCode);
  devicePrefs.putString("errorMsg", errorMessage);
  devicePrefs.end();
}

SetupResult loadSetupResult() {
  SetupResult result;
  devicePrefs.begin("setup", true);
  result.attempted = devicePrefs.getBool("attempted", false);
  result.success = devicePrefs.getBool("success", false);
  result.errorCode = devicePrefs.getString("errorCode", "");
  result.errorMessage = devicePrefs.getString("errorMsg", "");
  devicePrefs.end();
  return result;
}

void clearSetupResult() {
  devicePrefs.begin("setup", false);
  devicePrefs.clear();
  devicePrefs.end();
}

// =============================================================================
// WiFi Credential Management
// =============================================================================

void loadWiFiCredentials() {
  devicePrefs.begin("wifi", true);
  savedSSID = devicePrefs.getString("ssid", "");
  savedPassword = devicePrefs.getString("password", "");
  standaloneMode = devicePrefs.getBool("standalone", false);
  devicePrefs.end();

  if (savedSSID.length() > 0) {
    Serial.println("[WiFi] Loaded saved credentials");
  }
}

void saveWiFiCredentials(const String& ssid, const String& password) {
  devicePrefs.begin("wifi", false);
  devicePrefs.putString("ssid", ssid);
  devicePrefs.putString("password", password);
  devicePrefs.end();

  savedSSID = ssid;
  savedPassword = password;
  addSystemLog("WiFi credentials saved");
}

// =============================================================================
// Device Claiming
// =============================================================================

void loadClaimCredentials() {
  devicePrefs.begin("claim", true);
  deviceClaimed = devicePrefs.getBool("claimed", false);
  claimedDeviceId = devicePrefs.getString("deviceId", "");
  claimedDeviceName = devicePrefs.getString("deviceName", "Scout");
  claimedTenantId = devicePrefs.getString("tenantId", "");
  claimedMqttBroker = devicePrefs.getString("mqttBroker", "");
  claimedMqttUsername = devicePrefs.getString("mqttUser", "");
  claimedMqttPassword = devicePrefs.getString("mqttPass", "");
  claimedMqttClientId = devicePrefs.getString("mqttClientId", getMacAddressNoColons());
  claimedServerUrl = devicePrefs.getString("serverUrl", "");
  devicePrefs.end();

  if (deviceClaimed) {
    Serial.println("[Claim] Device is claimed: " + claimedDeviceName);

    // ========== MIGRATION: IP to Hostname ==========
    // Migrate devices with hardcoded IP to hostname for subnet-independent operation
    if (claimedMqttBroker == "192.168.133.110") {
      Serial.println("[Claim-Migrate] Migrating broker from IP to hostname");
      claimedMqttBroker = "mtmon.wadehargrove.com";

      // Persist the hostname to NVS
      devicePrefs.begin("claim", false);  // reopen in write mode
      devicePrefs.putString("mqttBroker", claimedMqttBroker);
      devicePrefs.end();

      addSystemLog("Broker migrated to mtmon.wadehargrove.com");
    }
    // ========== END MIGRATION ==========
  } else {
    Serial.println("[Claim] Device is not claimed");
  }
}

void saveClaimCredentials() {
  devicePrefs.begin("claim", false);
  devicePrefs.putBool("claimed", deviceClaimed);
  devicePrefs.putString("deviceId", claimedDeviceId);
  devicePrefs.putString("deviceName", claimedDeviceName);
  devicePrefs.putString("tenantId", claimedTenantId);
  devicePrefs.putString("mqttBroker", claimedMqttBroker);
  devicePrefs.putString("mqttUser", claimedMqttUsername);
  devicePrefs.putString("mqttPass", claimedMqttPassword);
  devicePrefs.putString("mqttClientId", claimedMqttClientId);
  devicePrefs.putString("serverUrl", claimedServerUrl);
  devicePrefs.end();

  addSystemLog("Claim credentials saved");
}

// =============================================================================
// Motion Configuration
// =============================================================================

void loadMotionConfig() {
  motionPrefs.begin("motion", false);  // Read-write for migration

  // Migration: Check if we need to reset to new optimized defaults
  // Version 2 = false positive reduction update (Jan 2026)
  uint8_t configVersion = motionPrefs.getUChar("version", 0);
  if (configVersion < 2) {
    Serial.println("[Motion] Migrating to v2 optimized config (clearing old settings)");
    motionPrefs.clear();  // Clear all old settings
    motionPrefs.putUChar("version", 2);  // Mark as migrated
  }

  MotionConfig config;
  config.threshold = motionPrefs.getUChar("threshold", 60);       // Higher threshold = less noise
  config.minSizePercent = motionPrefs.getFloat("minSize", 4.0);   // Filter tiny artifacts
  config.maxSizePercent = motionPrefs.getFloat("maxSize", 30.0);
  config.blockSize = motionPrefs.getUShort("blockSize", 16);
  config.cooldownMs = motionPrefs.getUShort("cooldown", MOTION_COOLDOWN);

  motionPrefs.end();

  motionDetector.setConfig(config);

  Serial.printf("[Motion] Config v%d: thresh=%d, min=%.1f%%, max=%.1f%%, cooldown=%dms\n",
                configVersion < 2 ? 2 : configVersion,
                config.threshold, config.minSizePercent, config.maxSizePercent, config.cooldownMs);
}

void saveMotionConfig() {
  MotionConfig config = motionDetector.getConfig();

  motionPrefs.begin("motion", false);
  motionPrefs.putUChar("threshold", config.threshold);
  motionPrefs.putFloat("minSize", config.minSizePercent);
  motionPrefs.putFloat("maxSize", config.maxSizePercent);
  motionPrefs.putUShort("blockSize", config.blockSize);
  motionPrefs.putUShort("cooldown", config.cooldownMs);
  motionPrefs.end();

  addSystemLog("Motion config saved");
}

// =============================================================================
// WiFi Scanning for Captive Portal (Synchronous - matches Trap implementation)
// =============================================================================

void startWiFiScan() {
  if (scanInProgress) return;
  scanInProgress = true;

  Serial.println("[WIFI-SCAN] Starting robust sync scan sequence...");

  // Brief delay to let WiFi hardware settle
  delay(500);

  int n = -1;

  // Try multiple approaches with increasing aggressiveness (like Trap)
  for (int attempt = 1; attempt <= 4 && n <= 0; attempt++) {
    Serial.printf("[WIFI-SCAN] Attempt %d/4...\n", attempt);

    // Clean up any previous scan
    WiFi.scanDelete();
    delay(100);

    switch (attempt) {
      case 1:
        // Standard scan with longer dwell time
        n = WiFi.scanNetworks(false, true, false, 500);  // sync, show_hidden, passive, 500ms
        break;
      case 2:
        // Active scan with even longer dwell
        n = WiFi.scanNetworks(false, true, true, 1000);  // sync, show_hidden, active, 1000ms
        break;
      case 3:
        // Try disconnecting STA first
        WiFi.disconnect(false, false);
        delay(200);
        n = WiFi.scanNetworks(false, true, false, 800);
        break;
      case 4:
        // Last resort: brief switch to STA-only mode
        Serial.println("[WIFI-SCAN] Trying STA-only mode scan...");
        WiFi.mode(WIFI_STA);
        delay(500);
        n = WiFi.scanNetworks(false, true, false, 1000);
        // AP restoration is handled below
        break;
    }

    Serial.printf("[WIFI-SCAN] Attempt %d result: %d networks\n", attempt, n);
    if (n > 0) break;
    delay(500);  // Wait between attempts
  }

  // ALWAYS restore AP mode after scanning (scanning may have disrupted it)
  if (isAPMode) {
    Serial.println("[WIFI-SCAN] Restoring AP after scan...");
    WiFi.mode(WIFI_AP_STA);
    delay(100);

    String apName = "Scout-" + getMacAddressNoColons().substring(6);

    // Configure AP IP before starting
    IPAddress apIP(192, 168, 4, 1);
    IPAddress gateway(192, 168, 4, 1);
    IPAddress subnet(255, 255, 255, 0);
    WiFi.softAPConfig(apIP, gateway, subnet);

    bool apStarted = WiFi.softAP(apName.c_str());
    if (!apStarted) {
      Serial.println("[WIFI-SCAN] ERROR: Failed to restore AP!");
    } else {
      Serial.printf("[WIFI-SCAN] AP restored: %s @ %s\n", apName.c_str(), WiFi.softAPIP().toString().c_str());
    }
  }

  // Process results
  if (n > 0) {
    Serial.printf("[WIFI-SCAN] Found %d networks\n", n);

    // Cache results
    cachedNetworkCount = (n > 20) ? 20 : n;
    for (int i = 0; i < cachedNetworkCount; i++) {
      cachedNetworks[i].ssid = WiFi.SSID(i);
      cachedNetworks[i].rssi = WiFi.RSSI(i);
      cachedNetworks[i].channel = WiFi.channel(i);
      cachedNetworks[i].open = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN);
    }

    // Sort by signal strength
    for (int i = 0; i < cachedNetworkCount - 1; i++) {
      for (int j = i + 1; j < cachedNetworkCount; j++) {
        if (cachedNetworks[j].rssi > cachedNetworks[i].rssi) {
          CachedNetwork temp = cachedNetworks[i];
          cachedNetworks[i] = cachedNetworks[j];
          cachedNetworks[j] = temp;
        }
      }
    }

    lastScanTime = millis();
  } else {
    Serial.println("[WIFI-SCAN] All attempts failed - no networks found");
    cachedNetworkCount = 0;
  }

  WiFi.scanDelete();
  scanInProgress = false;
}

// Legacy function - no longer needed for async but kept for compatibility
void performWiFiScan() {
  // No-op - scanning is now synchronous
}

String getNetworksJson() {
  JsonDocument doc;
  JsonArray networks = doc["networks"].to<JsonArray>();

  for (int i = 0; i < cachedNetworkCount; i++) {
    JsonObject net = networks.add<JsonObject>();
    net["ssid"] = cachedNetworks[i].ssid;
    net["rssi"] = cachedNetworks[i].rssi;
    net["channel"] = cachedNetworks[i].channel;
    net["open"] = cachedNetworks[i].open;
  }

  String result;
  serializeJson(doc, result);
  return result;
}

// =============================================================================
// HMAC-SHA256 Token Generation for Secure Device Claiming
// =============================================================================

// Generate HMAC-SHA256 claim token
// token = HMAC-SHA256(DEVICE_CLAIM_SECRET, MAC_ADDRESS + ":" + TIMESTAMP)
String generateClaimToken(const String& mac, const String& timestamp) {
  String data = mac + ":" + timestamp;

  Serial.println("[CLAIM-TOKEN] Generating HMAC-SHA256 token...");
  Serial.printf("[CLAIM-TOKEN]   MAC: %s\n", mac.c_str());
  Serial.printf("[CLAIM-TOKEN]   Timestamp: %s\n", timestamp.c_str());
  Serial.printf("[CLAIM-TOKEN]   Data: %s\n", data.c_str());

  uint8_t hmacResult[32];  // SHA256 produces 32 bytes

  // Initialize mbedtls HMAC context
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);

  // Setup for HMAC-SHA256
  int ret = mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  if (ret != 0) {
    Serial.printf("[CLAIM-TOKEN] ERROR: mbedtls_md_setup failed with code %d\n", ret);
    mbedtls_md_free(&ctx);
    return "";
  }

  // Start HMAC with secret key
  ret = mbedtls_md_hmac_starts(&ctx, (const uint8_t*)DEVICE_CLAIM_SECRET, strlen(DEVICE_CLAIM_SECRET));
  if (ret != 0) {
    Serial.printf("[CLAIM-TOKEN] ERROR: mbedtls_md_hmac_starts failed with code %d\n", ret);
    mbedtls_md_free(&ctx);
    return "";
  }

  // Update with data
  ret = mbedtls_md_hmac_update(&ctx, (const uint8_t*)data.c_str(), data.length());
  if (ret != 0) {
    Serial.printf("[CLAIM-TOKEN] ERROR: mbedtls_md_hmac_update failed with code %d\n", ret);
    mbedtls_md_free(&ctx);
    return "";
  }

  // Finalize and get result
  ret = mbedtls_md_hmac_finish(&ctx, hmacResult);
  if (ret != 0) {
    Serial.printf("[CLAIM-TOKEN] ERROR: mbedtls_md_hmac_finish failed with code %d\n", ret);
    mbedtls_md_free(&ctx);
    return "";
  }

  mbedtls_md_free(&ctx);

  // Convert to hex string
  String token = "";
  for (int i = 0; i < 32; i++) {
    if (hmacResult[i] < 16) token += "0";
    token += String(hmacResult[i], HEX);
  }

  Serial.printf("[CLAIM-TOKEN] Generated token: %s\n", token.c_str());
  return token;
}

// Perform device claim via HTTP POST to claim server (using claim code)
bool claimDevice(const String& claimCode) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[CLAIM] WiFi not connected");
    return false;
  }

  HTTPClient http;
  String url = String(CLAIM_SERVER_URL) + "/api/devices/claim";

  Serial.printf("[CLAIM] Claiming device with code: %s\n", claimCode.c_str());

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  // Build request payload
  JsonDocument doc;
  doc["claimCode"] = claimCode;
  JsonObject deviceInfo = doc["deviceInfo"].to<JsonObject>();
  deviceInfo["hardwareVersion"] = "XIAO-ESP32S3-Sense";
  deviceInfo["macAddress"] = getMacAddress();
  deviceInfo["firmwareVersion"] = FIRMWARE_VERSION;
  deviceInfo["filesystemVersion"] = FILESYSTEM_VERSION;

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.POST(payload);

  if (httpCode == 200) {
    String response = http.getString();

    JsonDocument responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);

    if (error) {
      Serial.printf("[CLAIM] JSON parse error: %s\n", error.c_str());
      http.end();
      return false;
    }

    if (responseDoc["success"] == true && responseDoc["data"].is<JsonObject>()) {
      JsonObject data = responseDoc["data"];

      claimedDeviceId = data["deviceId"].as<String>();
      claimedTenantId = data["tenantId"].as<String>();
      claimedMqttClientId = data["mqttClientId"].as<String>();
      claimedMqttUsername = data["mqttUsername"].as<String>();
      claimedMqttPassword = data["mqttPassword"].as<String>();
      claimedMqttBroker = data["mqttBrokerUrl"].as<String>();
      claimedDeviceName = data["deviceName"].as<String>();

      // Remove mqtt:// prefix if present
      claimedMqttBroker.replace("mqtt://", "");
      claimedMqttBroker.replace(":1883", "");

      // Mark as claimed and save
      deviceClaimed = true;
      saveClaimCredentials();

      // Setup MQTT with new credentials
      mqttSetup();

      Serial.println("[CLAIM] Device claimed successfully!");
      addSystemLog("[CLAIM] Device claimed: " + claimedDeviceName);

      http.end();
      return true;
    } else {
      String errorMsg = responseDoc["error"] | "Invalid response";
      Serial.printf("[CLAIM] Claim failed: %s\n", errorMsg.c_str());
      http.end();
      return false;
    }
  } else {
    Serial.printf("[CLAIM] HTTP error %d: %s\n", httpCode, http.getString().c_str());
    addSystemLog("[CLAIM] Claim failed - HTTP " + String(httpCode));
    http.end();
    return false;
  }
}

// Generate complete claim credentials
ClaimCredentials generateClaimCredentials() {
  ClaimCredentials creds;

  creds.mac = getMacAddress();

  // Use current time if available, otherwise use uptime
  time_t now = time(nullptr);
  if (now < 1000000000) {  // Before 2001, clock not synced
    now = millis() / 1000 + 1700000000;  // Approximate timestamp
  }

  creds.timestamp = String(now);

  // Generate HMAC-SHA256 token
  creds.token = generateClaimToken(creds.mac, creds.timestamp);

  Serial.println("[CLAIM-TOKEN] Credentials generated:");
  Serial.printf("[CLAIM-TOKEN]   MAC: %s\n", creds.mac.c_str());
  Serial.printf("[CLAIM-TOKEN]   Timestamp: %s\n", creds.timestamp.c_str());
  Serial.printf("[CLAIM-TOKEN]   Token: %s\n", creds.token.c_str());

  return creds;
}

// Register and claim device using HMAC token authentication
bool registerAndClaimDevice(const String& email, const String& password, const String& deviceName, bool isNewAccount = true) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[REGISTER-CLAIM] WiFi not connected");
    return false;
  }

  if (deviceClaimed) {
    Serial.println("[REGISTER-CLAIM] Device already claimed");
    return false;
  }

  Serial.println("[REGISTER-CLAIM] ========================================");
  Serial.println("[REGISTER-CLAIM] Starting register and claim process...");
  Serial.println("[REGISTER-CLAIM] ========================================");

  // Generate cryptographic claim credentials
  ClaimCredentials creds = generateClaimCredentials();

  if (creds.token.length() == 0) {
    Serial.println("[REGISTER-CLAIM] ERROR: Failed to generate claim token");
    return false;
  }

  HTTPClient http;
  String url = String(CLAIM_SERVER_URL) + "/api/setup/register-and-claim";

  Serial.printf("[REGISTER-CLAIM] URL: %s\n", url.c_str());
  Serial.printf("[REGISTER-CLAIM] Email: %s\n", email.c_str());
  Serial.printf("[REGISTER-CLAIM] Device Name: %s\n", deviceName.c_str());

  addSystemLog("[REGISTER-CLAIM] Attempting HTTP to: " + url);

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  // Build request payload
  JsonDocument doc;
  doc["mac"] = creds.mac;
  doc["claimToken"] = creds.token;
  doc["timestamp"] = creds.timestamp;
  doc["email"] = email;
  doc["password"] = password;
  doc["deviceName"] = deviceName;
  doc["isNewAccount"] = isNewAccount;
  doc["deviceType"] = DEVICE_TYPE;  // Scout-specific

  // Add device info
  JsonObject deviceInfo = doc["deviceInfo"].to<JsonObject>();
  deviceInfo["hardwareVersion"] = "XIAO-ESP32S3-Sense";
  deviceInfo["firmwareVersion"] = currentFirmwareVersion;
  deviceInfo["filesystemVersion"] = currentFilesystemVersion;

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[REGISTER-CLAIM] Payload size: %d bytes\n", payload.length());

  int httpCode = http.POST(payload);
  Serial.printf("[REGISTER-CLAIM] HTTP Response Code: %d\n", httpCode);

  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();
    Serial.printf("[REGISTER-CLAIM] Response: %s\n", response.c_str());

    JsonDocument responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);

    if (error) {
      Serial.printf("[REGISTER-CLAIM] JSON parse error: %s\n", error.c_str());
      http.end();
      return false;
    }

    if (responseDoc["success"] == true) {
      // Extract claim data from response
      claimedDeviceId = responseDoc["deviceId"].as<String>();
      claimedTenantId = responseDoc["tenantId"].as<String>();
      claimedMqttClientId = responseDoc["mqttClientId"].as<String>();
      claimedMqttBroker = responseDoc["mqttBroker"].as<String>();
      claimedDeviceName = deviceName;

      // MQTT credentials nested under mqttCredentials object
      JsonObject mqttCreds = responseDoc["mqttCredentials"];
      claimedMqttUsername = mqttCreds["username"].as<String>();
      claimedMqttPassword = mqttCreds["password"].as<String>();

      // Clean up broker URL
      claimedMqttBroker.replace("mqtt://", "");
      claimedMqttBroker.replace(":1883", "");

      // Mark as claimed and save
      deviceClaimed = true;
      saveClaimCredentials();

      Serial.println("[REGISTER-CLAIM] ========================================");
      Serial.println("[REGISTER-CLAIM] Device registered and claimed successfully!");
      Serial.println("[REGISTER-CLAIM] ========================================");
      Serial.printf("[REGISTER-CLAIM]   Device ID: %s\n", claimedDeviceId.c_str());
      Serial.printf("[REGISTER-CLAIM]   Tenant ID: %s\n", claimedTenantId.c_str());
      Serial.printf("[REGISTER-CLAIM]   MQTT Broker: %s\n", claimedMqttBroker.c_str());

      addSystemLog("[REGISTER-CLAIM] Device claimed: " + claimedDeviceName);

      http.end();
      return true;
    } else {
      String errorMsg = responseDoc["error"].as<String>();
      Serial.printf("[REGISTER-CLAIM] Server returned success=false: %s\n", errorMsg.c_str());
      addSystemLog("[REGISTER-CLAIM] Failed: " + errorMsg);
      http.end();
      return false;
    }
  } else {
    Serial.printf("[REGISTER-CLAIM] HTTP error %d: %s\n", httpCode, http.getString().c_str());
    addSystemLog("[REGISTER-CLAIM] Failed - HTTP " + String(httpCode));
    http.end();
    return false;
  }
}

// =============================================================================
// Camera
// =============================================================================

void initCamera() {
  Serial.println("[Camera] Initializing...");

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  // Use pin definitions from camera_pins.h
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;

  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    Serial.println("[Camera] PSRAM found");
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.frame_size = FRAMESIZE_VGA;  // 640x480
    config.fb_count = 2;
  } else {
    Serial.println("[Camera] No PSRAM");
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.frame_size = FRAMESIZE_QVGA;  // 320x240
    config.fb_count = 1;
  }

  config.jpeg_quality = 12;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[Camera] Init failed: 0x%x\n", err);
    cameraInitialized = false;
    return;
  }

  // Configure sensor
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_framesize(s, FRAMESIZE_VGA);
    s->set_quality(s, 12);
  }

  cameraInitialized = true;
  addSystemLog("Camera initialized");
}

// =============================================================================
// MQTT
// =============================================================================

// Static buffer for MQTT broker address (survives function scope)
static char mqttBrokerAddress[128] = {0};

void mqttSetup() {
  String broker = claimedMqttBroker;
  if (broker.startsWith("mqtt://")) broker = broker.substring(7);

  int colonPos = broker.indexOf(':');
  if (colonPos > 0) broker = broker.substring(0, colonPos);

  if (broker.length() == 0) {
    Serial.println("[MQTT] No broker configured");
    return;
  }

  // Copy to static buffer so the pointer remains valid
  strncpy(mqttBrokerAddress, broker.c_str(), sizeof(mqttBrokerAddress) - 1);
  mqttBrokerAddress[sizeof(mqttBrokerAddress) - 1] = '\0';

  mqttClient.setServer(mqttBrokerAddress, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);

  Serial.printf("[MQTT] Configured for %s:%d\n", mqttBrokerAddress, MQTT_PORT);
}

bool mqttConnect() {
  if (mqttClient.connected()) return true;
  if (!deviceClaimed && !standaloneMode) return false;
  if (millis() - lastMqttReconnect < 5000) return false;

  lastMqttReconnect = millis();
  addSystemLog("[MQTT] Attempting connection to " + claimedMqttBroker);

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddressNoColons();

  // Last Will Testament
  char lwtTopic[256];
  snprintf(lwtTopic, sizeof(lwtTopic), "tenant/%s/device/%s/status",
           claimedTenantId.c_str(), clientId.c_str());

  Serial.printf("[MQTT] Connecting as %s...\n", clientId.c_str());

  bool connected = mqttClient.connect(
    clientId.c_str(),
    claimedMqttUsername.c_str(),
    claimedMqttPassword.c_str(),
    lwtTopic, 1, true, "{\"online\":false}"
  );

  if (!connected) {
    Serial.printf("[MQTT] Failed, rc=%d\n", mqttClient.state());
    mqttReallyConnected = false;
    return false;
  }

  Serial.println("[MQTT] Connected!");
  mqttReallyConnected = true;

  // Subscribe to command topics
  char topic[256];
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/command/#",
           claimedTenantId.c_str(), clientId.c_str());
  mqttClient.subscribe(topic);

  // Device-specific OTA topics
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/ota/#",
           claimedTenantId.c_str(), clientId.c_str());
  mqttClient.subscribe(topic);

  // Tenant-wide firmware/filesystem updates
  snprintf(topic, sizeof(topic), "tenant/%s/firmware/latest", claimedTenantId.c_str());
  mqttClient.subscribe(topic);
  snprintf(topic, sizeof(topic), "tenant/%s/filesystem/latest", claimedTenantId.c_str());
  mqttClient.subscribe(topic);

  // Global updates
  mqttClient.subscribe("global/firmware/latest");
  mqttClient.subscribe("global/filesystem/latest");

  // Publish initial status
  publishDeviceStatus();

  addSystemLog("MQTT connected");
  return true;
}

// Forward declarations for MQTT settings handlers
void handleMqttGetCameraSettings(JsonDocument& doc);
void handleMqttSetCameraSettings(JsonDocument& doc);
void handleMqttGetMotionConfig(JsonDocument& doc);
void handleMqttSetMotionConfig(JsonDocument& doc);

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("[MQTT] Message on %s (%u bytes)\n", topic, length);
  addSystemLog(String("[MQTT] Received: ") + topic);

  // Parse JSON payload
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[MQTT] JSON parse error: %s\n", err.c_str());
    addSystemLog(String("[MQTT] JSON error: ") + err.c_str());
    return;
  }

  String topicStr = String(topic);

  // Handle commands
  if (topicStr.indexOf("/command/") >= 0) {
    String command = doc["command"] | "";

    if (command == "reboot") {
      addSystemLog("Reboot command received");
      delay(1000);
      ESP.restart();
    } else if (command == "capture" || command == "capture_snapshot") {
      addSystemLog("Snapshot capture requested");
      // Capture and publish to camera/snapshot topic (for dashboard display)
      camera_fb_t* fb = esp_camera_fb_get();
      if (fb) {
        publishSnapshot(fb);
        esp_camera_fb_return(fb);
      }
    } else if (command == "status") {
      publishDeviceStatus();
    }
    // ========== Settings Commands (for iOS app remote control) ==========
    else if (command == "get_camera_settings") {
      handleMqttGetCameraSettings(doc);
    } else if (command == "set_camera_settings") {
      handleMqttSetCameraSettings(doc);
    } else if (command == "get_motion_config") {
      handleMqttGetMotionConfig(doc);
    } else if (command == "set_motion_config") {
      handleMqttSetMotionConfig(doc);
    } else if (command == "set_wifi") {
      // Update WiFi credentials via MQTT - allows remote WiFi change without device access
      String newSSID = doc["ssid"] | "";
      String newPassword = doc["password"] | "";

      if (newSSID.length() > 0) {
        addSystemLog("WiFi update via MQTT: " + newSSID);
        saveWiFiCredentials(newSSID, newPassword);
        addSystemLog("WiFi updated, rebooting...");
        delay(1000);
        ESP.restart();
      } else {
        addSystemLog("set_wifi error: missing SSID");
      }
    }
  }

  // Handle OTA - device-specific firmware updates
  if (strstr(topic, "/ota/firmware")) {
    mqttOtaType = "firmware";
    handleOtaNotification(doc);
    return;
  }

  // Handle OTA - device-specific filesystem updates
  if (strstr(topic, "/ota/filesystem")) {
    mqttOtaType = "filesystem";
    handleOtaNotification(doc);
    return;
  }

  // Handle OTA - tenant-wide and global firmware updates
  if (strstr(topic, "/firmware/latest") || strcmp(topic, "global/firmware/latest") == 0) {
    mqttOtaType = "firmware";
    handleOtaNotification(doc);
    return;
  }

  // Handle OTA - tenant-wide and global filesystem updates
  if (strstr(topic, "/filesystem/latest") || strcmp(topic, "global/filesystem/latest") == 0) {
    mqttOtaType = "filesystem";
    handleOtaNotification(doc);
    return;
  }
}

void publishDeviceStatus() {
  if (!mqttClient.connected()) return;

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddressNoColons();

  char topic[256];
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/status",
           claimedTenantId.c_str(), clientId.c_str());

  JsonDocument doc;
  doc["online"] = true;
  doc["device_type"] = DEVICE_TYPE;
  doc["device_name"] = claimedDeviceName;
  doc["firmware_version"] = currentFirmwareVersion;
  doc["filesystem_version"] = currentFilesystemVersion;
  doc["uptime"] = millis() / 1000;
  doc["heap_free"] = ESP.getFreeHeap();
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();
  doc["motion_events"] = motionEventCount;

  String payload;
  serializeJson(doc, payload);

  mqttClient.publish(topic, payload.c_str(), true);
  lastStatusPublish = millis();
}

// =============================================================================
// MQTT Settings Command Handlers
// These enable remote device configuration via the iOS app and server
// =============================================================================

// Helper to publish settings response back to server
void publishSettingsResponse(const String& requestId, JsonDocument& responseDoc) {
  if (!mqttClient.connected()) {
    Serial.println("[MQTT-SETTINGS] Not connected, cannot publish response");
    return;
  }

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddressNoColons();
  String topic = "tenant/" + claimedTenantId + "/device/" + clientId + "/settings";

  responseDoc["requestId"] = requestId;
  responseDoc["timestamp"] = time(nullptr) * 1000;  // ms for JS compatibility

  String payload;
  serializeJson(responseDoc, payload);

  mqttClient.publish(topic.c_str(), payload.c_str());
  Serial.printf("[MQTT-SETTINGS] Published response to %s\n", topic.c_str());
}

// GET camera settings via MQTT
void handleMqttGetCameraSettings(JsonDocument& doc) {
  Serial.println("[MQTT-SETTINGS] get_camera_settings command");

  const char* requestId = doc["requestId"];
  sensor_t *s = esp_camera_sensor_get();

  JsonDocument response;
  response["type"] = "camera_settings";
  response["success"] = (s != nullptr);

  if (s) {
    response["settings"]["framesize"] = s->status.framesize;
    response["settings"]["quality"] = s->status.quality;
    response["settings"]["brightness"] = s->status.brightness;
    response["settings"]["contrast"] = s->status.contrast;
    response["settings"]["saturation"] = s->status.saturation;
    response["settings"]["vflip"] = s->status.vflip;
    response["settings"]["hmirror"] = s->status.hmirror;
  } else {
    response["error"] = "Camera not initialized";
  }

  publishSettingsResponse(requestId ? String(requestId) : "", response);
}

// SET camera settings via MQTT
void handleMqttSetCameraSettings(JsonDocument& doc) {
  Serial.println("[MQTT-SETTINGS] set_camera_settings command");

  const char* requestId = doc["requestId"];
  sensor_t *s = esp_camera_sensor_get();

  JsonDocument response;
  response["type"] = "camera_settings";

  if (!s) {
    response["success"] = false;
    response["error"] = "Camera not initialized";
    publishSettingsResponse(requestId ? String(requestId) : "", response);
    return;
  }

  bool changed = false;

  if (doc.containsKey("framesize")) {
    int fs = doc["framesize"].as<int>();
    if (fs >= 0 && fs <= 13) {
      s->set_framesize(s, (framesize_t)fs);
      changed = true;
    }
  }
  if (doc.containsKey("quality")) {
    int q = doc["quality"].as<int>();
    if (q >= 4 && q <= 63) {
      s->set_quality(s, q);
      changed = true;
    }
  }
  if (doc.containsKey("brightness")) {
    int b = doc["brightness"].as<int>();
    if (b >= -2 && b <= 2) {
      s->set_brightness(s, b);
      changed = true;
    }
  }
  if (doc.containsKey("contrast")) {
    int c = doc["contrast"].as<int>();
    if (c >= -2 && c <= 2) {
      s->set_contrast(s, c);
      changed = true;
    }
  }
  if (doc.containsKey("saturation")) {
    int sat = doc["saturation"].as<int>();
    if (sat >= -2 && sat <= 2) {
      s->set_saturation(s, sat);
      changed = true;
    }
  }
  if (doc.containsKey("vflip")) {
    s->set_vflip(s, doc["vflip"].as<bool>() ? 1 : 0);
    changed = true;
  }
  if (doc.containsKey("hmirror")) {
    s->set_hmirror(s, doc["hmirror"].as<bool>() ? 1 : 0);
    changed = true;
  }

  if (changed) {
    addSystemLog("[MQTT] Camera settings updated via MQTT");
  }

  response["success"] = true;
  response["changed"] = changed;
  response["settings"]["framesize"] = s->status.framesize;
  response["settings"]["quality"] = s->status.quality;
  response["settings"]["brightness"] = s->status.brightness;
  response["settings"]["contrast"] = s->status.contrast;
  response["settings"]["saturation"] = s->status.saturation;
  response["settings"]["vflip"] = s->status.vflip;
  response["settings"]["hmirror"] = s->status.hmirror;

  publishSettingsResponse(requestId ? String(requestId) : "", response);
}

// GET motion config via MQTT
void handleMqttGetMotionConfig(JsonDocument& doc) {
  Serial.println("[MQTT-SETTINGS] get_motion_config command");

  const char* requestId = doc["requestId"];
  MotionConfig config = motionDetector.getConfig();

  JsonDocument response;
  response["type"] = "motion_config";
  response["success"] = true;
  response["settings"]["threshold"] = config.threshold;
  response["settings"]["minSizePercent"] = config.minSizePercent;
  response["settings"]["maxSizePercent"] = config.maxSizePercent;
  response["settings"]["blockSize"] = config.blockSize;
  response["settings"]["cooldownMs"] = config.cooldownMs;

  publishSettingsResponse(requestId ? String(requestId) : "", response);
}

// SET motion config via MQTT
void handleMqttSetMotionConfig(JsonDocument& doc) {
  Serial.println("[MQTT-SETTINGS] set_motion_config command");

  const char* requestId = doc["requestId"];
  MotionConfig config = motionDetector.getConfig();
  bool changed = false;

  if (doc.containsKey("threshold")) {
    config.threshold = doc["threshold"].as<uint8_t>();
    changed = true;
  }
  if (doc.containsKey("minSizePercent")) {
    config.minSizePercent = doc["minSizePercent"].as<float>();
    changed = true;
  }
  if (doc.containsKey("maxSizePercent")) {
    config.maxSizePercent = doc["maxSizePercent"].as<float>();
    changed = true;
  }
  if (doc.containsKey("blockSize")) {
    config.blockSize = doc["blockSize"].as<uint16_t>();
    changed = true;
  }
  if (doc.containsKey("cooldownMs")) {
    config.cooldownMs = doc["cooldownMs"].as<uint16_t>();
    changed = true;
  }

  if (changed) {
    motionDetector.setConfig(config);
    saveMotionConfig();
    addSystemLog("[MQTT] Motion config updated via MQTT");
  }

  JsonDocument response;
  response["type"] = "motion_config";
  response["success"] = true;
  response["changed"] = changed;
  response["settings"]["threshold"] = config.threshold;
  response["settings"]["minSizePercent"] = config.minSizePercent;
  response["settings"]["maxSizePercent"] = config.maxSizePercent;
  response["settings"]["blockSize"] = config.blockSize;
  response["settings"]["cooldownMs"] = config.cooldownMs;

  publishSettingsResponse(requestId ? String(requestId) : "", response);
}

// =============================================================================
// Snapshot Publishing (for dashboard display)
// =============================================================================

void publishSnapshot(camera_fb_t* frame) {
  if (!mqttClient.connected()) {
    Serial.println("[Snapshot] MQTT not connected, skipping publish");
    return;
  }

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddressNoColons();

  // Build MQTT topic: tenant/{tenantId}/device/{MAC}/camera/snapshot
  char topic[256];
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/camera/snapshot",
           claimedTenantId.c_str(), clientId.c_str());

  // Base64 encode image
  String base64Image = base64::encode(frame->buf, frame->len);

  // Build JSON payload (matching trap format)
  JsonDocument doc;
  doc["image"] = base64Image;
  doc["timestamp"] = time(nullptr);

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[Snapshot] Publishing to %s (%d bytes)\n", topic, payload.length());

  bool published = mqttClient.publish(topic, payload.c_str());

  if (published) {
    addSystemLog("Snapshot published to server");
  } else {
    Serial.println("[Snapshot] Publish failed");
  }
}

// =============================================================================
// Motion Events
// =============================================================================

void publishMotionEvent(camera_fb_t* frame, MotionResult& result,
                         const EdgeClassificationResult& edge) {
  if (!mqttClient.connected()) {
    Serial.println("[Motion] MQTT not connected, skipping publish");
    return;
  }

  motionEventCount++;

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddressNoColons();

  char topic[256];
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/motion",
           claimedTenantId.c_str(), clientId.c_str());

  // Base64 encode image
  String base64Image = base64::encode(frame->buf, frame->len);

  // Build JSON payload
  JsonDocument doc;
  doc["type"] = "motion";
  doc["timestamp"] = time(nullptr);
  doc["image"] = base64Image;

  JsonObject motion = doc["motion"].to<JsonObject>();
  motion["x"] = result.x;
  motion["y"] = result.y;
  motion["width"] = result.width;
  motion["height"] = result.height;
  motion["percent"] = result.sizePercent;

  doc["confidence"] = result.confidence;

  // Edge classifier verdict (if the model is loaded and ran)
  if (edge.inference_ran) {
    JsonObject edgeObj = doc["edge"].to<JsonObject>();
    edgeObj["verdict"] = edgeVerdictString(edge.verdict);
    edgeObj["confidence"] = edge.confidence;
    edgeObj["rodent_score"] = edge.rodent_score;
    edgeObj["person_or_pet_score"] = edge.person_or_pet_score;
    edgeObj["other_score"] = edge.other_score;
    edgeObj["inference_time_ms"] = edge.inference_time_ms;
  }

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[Motion] Publishing event #%d (%d bytes)\n",
                motionEventCount, payload.length());

  bool published = mqttClient.publish(topic, payload.c_str());

  if (published) {
    addSystemLog("Motion event published");
    // Save to gallery
    saveImageToGallery(frame, "pending");
  } else {
    Serial.println("[Motion] Publish failed");
  }
}

// Multi-frame validation state for false positive reduction
static uint8_t consecutiveDetections = 0;

void checkMotion() {
  if (!cameraInitialized) return;
  if (millis() - lastMotionCheck < MOTION_CHECK_INTERVAL) return;

  lastMotionCheck = millis();

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[Motion] Failed to get frame");
    return;
  }

  MotionResult result = motionDetector.detect(fb);

  if (result.detected && !result.sizeFiltered && !result.aspectFiltered) {
    consecutiveDetections++;

    bool shouldTrigger = false;
    // HIGH confidence (large motion area) = immediate trigger
    if (result.confidence > 0.7f || result.sizePercent > 10.0f) {
      Serial.printf("[Motion] HIGH motion confidence: conf=%.2f, size=%.1f%%\n",
                    result.confidence, result.sizePercent);
      shouldTrigger = true;
    } else if (consecutiveDetections >= 3) {
      Serial.printf("[Motion] Multi-frame validated: %d consecutive\n",
                    consecutiveDetections);
      shouldTrigger = true;
    } else {
      Serial.printf("[Motion] Pending validation: %d/3 consecutive\n",
                    consecutiveDetections);
    }

    if (shouldTrigger) {
      // Run edge classifier on the frame (no-op if model not loaded)
      EdgeClassificationResult edge = edgeClassify(
          fb, result.x, result.y, result.width, result.height);

      // Filter based on edge verdict:
      //   RODENT / AMBIGUOUS / UNKNOWN  → publish (server will handle)
      //   PERSON_OR_PET / OTHER         → drop, don't even publish
      bool shouldPublish = (edge.verdict != EDGE_VERDICT_PERSON_OR_PET &&
                            edge.verdict != EDGE_VERDICT_OTHER);

      if (shouldPublish) {
        publishMotionEvent(fb, result, edge);
      } else {
        Serial.printf("[Motion] Edge filter dropped (%s, conf=%.2f)\n",
                      edgeVerdictString(edge.verdict), edge.confidence);
      }
      consecutiveDetections = 0;
      esp_camera_fb_return(fb);
      return;
    }
  } else {
    // Reset counter on no detection or filtered detection
    if (consecutiveDetections > 0) {
      Serial.printf("[Motion] Detection chain broken, resetting counter\n");
    }
    consecutiveDetections = 0;
  }

  esp_camera_fb_return(fb);
}

// =============================================================================
// Gallery (FIFO Storage)
// =============================================================================

void saveImageToGallery(camera_fb_t* frame, const String& classification) {
  // Ensure gallery directory exists
  if (!LittleFS.exists(GALLERY_DIR)) {
    LittleFS.mkdir(GALLERY_DIR);
  }

  // Generate filename with timestamp
  time_t now = time(nullptr);
  struct tm* timeinfo = localtime(&now);
  char filename[64];
  snprintf(filename, sizeof(filename), "%s/img_%04d%02d%02d_%02d%02d_%s.jpg",
           GALLERY_DIR,
           timeinfo->tm_year + 1900, timeinfo->tm_mon + 1, timeinfo->tm_mday,
           timeinfo->tm_hour, timeinfo->tm_min,
           classification.c_str());

  // Save image
  File file = LittleFS.open(filename, "w");
  if (file) {
    file.write(frame->buf, frame->len);
    file.close();
    Serial.printf("[Gallery] Saved: %s\n", filename);
  }

  // Cleanup old images if over limit
  cleanupGallery();
}

void cleanupGallery() {
  File dir = LittleFS.open(GALLERY_DIR);
  if (!dir || !dir.isDirectory()) return;

  // Count files and find oldest
  std::vector<String> files;
  File file = dir.openNextFile();
  while (file) {
    if (!file.isDirectory()) {
      files.push_back(String(file.name()));
    }
    file = dir.openNextFile();
  }

  // Delete oldest files if over limit
  while (files.size() > MAX_GALLERY_IMAGES) {
    // Sort and remove oldest (filenames contain timestamps)
    std::sort(files.begin(), files.end());
    String oldest = String(GALLERY_DIR) + "/" + files[0];
    LittleFS.remove(oldest);
    Serial.printf("[Gallery] Deleted oldest: %s\n", oldest.c_str());
    files.erase(files.begin());
  }
}

String getGalleryJson() {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();

  File dir = LittleFS.open(GALLERY_DIR);
  if (dir && dir.isDirectory()) {
    File file = dir.openNextFile();
    while (file) {
      if (!file.isDirectory()) {
        JsonObject obj = arr.add<JsonObject>();
        obj["name"] = file.name();
        obj["size"] = file.size();
      }
      file = dir.openNextFile();
    }
  }

  String result;
  serializeJson(doc, result);
  return result;
}

// =============================================================================
// Web Server
// =============================================================================

void setupWebServer() {
  // Add CORS headers for captive portal (iOS uses captive.apple.com domain)
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Requested-With");
  DefaultHeaders::Instance().addHeader("Access-Control-Max-Age", "86400");

  // Handle OPTIONS preflight for all /api routes
  server.on("/api/setup/test-wifi", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/setup/register", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/setup/standalone", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/wifi", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/motion/config", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/device/register-claim", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/device/claim", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/device/unclaim", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });
  server.on("/api/setup/connect", HTTP_OPTIONS, [](AsyncWebServerRequest* request) {
    request->send(200);
  });

  // ============================================================================
  // Setup Status Endpoint - Returns last setup attempt result
  // ============================================================================
  server.on("/api/setup/status", HTTP_GET, [](AsyncWebServerRequest* request) {
    SetupResult result = loadSetupResult();

    JsonDocument doc;
    doc["attempted"] = result.attempted;
    doc["success"] = result.success;
    doc["errorCode"] = result.errorCode;
    doc["errorMessage"] = result.errorMessage;

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // Clear setup status (called after user acknowledges error)
  server.on("/api/setup/status/clear", HTTP_POST, [](AsyncWebServerRequest* request) {
    clearSetupResult();
    request->send(200, "application/json", "{\"success\":true}");
  });

  // Reset setup state (allow retry without reboot)
  server.on("/api/setup/reset", HTTP_POST, [](AsyncWebServerRequest* request) {
    currentSetupState = SETUP_IDLE;
    currentSetupStep = "";
    currentSetupError = "";
    currentSetupErrorCode = "";
    setupNeedsReboot = false;
    pendingSetup = false;

    // If we're in APSTA mode and failed, disconnect STA but keep AP
    if (WiFi.getMode() == WIFI_AP_STA) {
      WiFi.disconnect(true);  // Disconnect from STA network
      delay(100);
      WiFi.mode(WIFI_AP);     // Switch back to AP-only mode
    }

    request->send(200, "application/json", "{\"success\":true}");
  });

  // Trigger reboot (called after successful setup)
  server.on("/api/setup/reboot", HTTP_POST, [](AsyncWebServerRequest* request) {
    request->send(200, "application/json", "{\"success\":true,\"message\":\"Rebooting...\"}");
    delay(500);
    ESP.restart();
  });

  // Root handler - always serve SPA
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (!LittleFS.exists("/index.html")) {
      Serial.println("[ROOT] index.html not found in LittleFS!");
      request->send(503, "text/html", "<h1>503</h1><p>Filesystem not uploaded. Please upload via OTA.</p>");
      return;
    }
    Serial.println("[ROOT] Serving index.html");
    AsyncWebServerResponse* response = request->beginResponse(LittleFS, "/index.html", "text/html");
    request->send(response);
  });

  // Captive portal setup page - redirects to SPA with setup route
  // This is the EXACT pattern from the working Trap firmware
  server.on("/setup", HTTP_GET, [](AsyncWebServerRequest* request) {
    Serial.println("[CAPTIVE] /setup - redirecting to /#/setup");
    request->redirect("/#/setup");
  });

  // Explicit captive portal detection endpoints
  server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest* request) {
    Serial.println("[CAPTIVE] /generate_204 - redirecting to /setup");
    request->redirect("/setup");
  });
  server.on("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest* request) {
    Serial.println("[CAPTIVE] /hotspot-detect.html - redirecting to /setup");
    request->redirect("/setup");
  });
  server.on("/canonical.html", HTTP_GET, [](AsyncWebServerRequest* request) {
    Serial.println("[CAPTIVE] /canonical.html - redirecting to /setup");
    request->redirect("/setup");
  });
  server.on("/success.txt", HTTP_GET, [](AsyncWebServerRequest* request) {
    Serial.println("[CAPTIVE] /success.txt - redirecting to /setup");
    request->redirect("/setup");
  });

  // API: WiFi scan for setup wizard (synchronous - returns results immediately)
  server.on("/api/wifi/scan", HTTP_GET, [](AsyncWebServerRequest* request) {
    Serial.println("[WIFI-SCAN] === Scan endpoint called ===");

    bool forceRescan = request->hasParam("rescan");
    Serial.printf("[WIFI-SCAN] forceRescan=%d, cacheSize=%d\n", forceRescan, cachedNetworkCount);

    // If no cached results, force rescan, or cache is stale, do a synchronous scan
    if (cachedNetworkCount == 0 || forceRescan || (millis() - lastScanTime > 30000)) {
      Serial.println("[WIFI-SCAN] Triggering fresh scan...");
      startWiFiScan();  // This is now synchronous - blocks until complete
      Serial.printf("[WIFI-SCAN] Scan completed, found %d networks\n", cachedNetworkCount);
    }

    // Build response - scan is synchronous so always done when we respond
    JsonDocument doc;
    doc["scanning"] = false;
    JsonArray networks = doc["networks"].to<JsonArray>();

    for (int i = 0; i < cachedNetworkCount; i++) {
      JsonObject net = networks.add<JsonObject>();
      net["ssid"] = cachedNetworks[i].ssid;
      net["rssi"] = cachedNetworks[i].rssi;
      net["channel"] = cachedNetworks[i].channel;
      net["secure"] = !cachedNetworks[i].open;
    }

    String result;
    serializeJson(doc, result);
    Serial.printf("[WIFI-SCAN] Returning %d networks\n", cachedNetworkCount);
    request->send(200, "application/json", result);
  });

  // API: Setup progress/state for wizard polling (matches trap format exactly)
  server.on("/api/setup/progress", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;

    const char* stateStr = "idle";
    switch (currentSetupState) {
      case SETUP_IDLE: stateStr = "idle"; break;
      case SETUP_CONNECTING_WIFI: stateStr = "connecting_wifi"; break;
      case SETUP_WIFI_CONNECTED: stateStr = "wifi_connected"; break;
      case SETUP_CHECKING_CLAIM: stateStr = "checking_claim"; break;
      case SETUP_CLAIM_RECOVERED: stateStr = "claim_recovered"; break;
      case SETUP_SYNCING_TIME: stateStr = "syncing_time"; break;
      case SETUP_REGISTERING: stateStr = "registering"; break;
      case SETUP_SAVING: stateStr = "saving"; break;
      case SETUP_COMPLETE: stateStr = "complete"; break;
      case SETUP_FAILED: stateStr = "failed"; break;
    }

    doc["state"] = stateStr;
    doc["step"] = currentSetupStep;
    doc["error"] = currentSetupError;
    doc["errorCode"] = currentSetupErrorCode;
    doc["needsReboot"] = setupNeedsReboot;
    doc["wifiConnected"] = (WiFi.status() == WL_CONNECTED);
    doc["staIP"] = WiFi.localIP().toString();
    if (recoveredDeviceName.length() > 0) {
      doc["recoveredDeviceName"] = recoveredDeviceName;
    }

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // API: Test WiFi connection (Phase 1 of setup)
  // Uses body accumulation pattern from trap for reliability
  server.on("/api/setup/test-wifi", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t *data, size_t len, size_t index, size_t total) {
      // Accumulate body chunks (trap pattern)
      if (index == 0) request->_tempObject = (void*)new String();
      String* body = (String*)request->_tempObject;
      body->concat((char*)data, len);

      // Only process when we have all the data
      if (index + len == total) {
        addSystemLog("[SETUP-WIFI] === TEST WIFI REQUEST RECEIVED ===");

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        request->_tempObject = nullptr;

        if (err) {
          addSystemLog("[SETUP-WIFI] ERROR: Invalid JSON");
          request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String ssid = doc["ssid"] | "";
        String password = doc["password"] | "";

        addSystemLog("[SETUP-WIFI] SSID: " + ssid);

        if (ssid.isEmpty()) {
          addSystemLog("[SETUP-WIFI] ERROR: Missing SSID");
          request->send(400, "application/json", "{\"success\":false,\"error\":\"Missing required field: ssid\"}");
          return;
        }

        // Store pending WiFi test (will be processed in loop())
        pendingWiFiTestSSID = ssid;
        pendingWiFiTestPassword = password;
        pendingWiFiTestTime = millis();
        pendingWiFiTest = true;

        // Reset state
        currentSetupState = SETUP_IDLE;
        currentSetupError = "";
        currentSetupErrorCode = "";

        addSystemLog("[SETUP-WIFI] WiFi test queued");

        JsonDocument response;
        response["success"] = true;
        response["message"] = "WiFi test initiated";
        String json;
        serializeJson(response, json);
        request->send(200, "application/json", json);
      }
    }
  );

  // API: Register and claim (Phase 2 of setup)
  // Uses body accumulation pattern from trap for reliability
  server.on("/api/setup/register", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t *data, size_t len, size_t index, size_t total) {
      if (index == 0) request->_tempObject = (void*)new String();
      String* body = (String*)request->_tempObject;
      body->concat((char*)data, len);

      if (index + len == total) {
        addSystemLog("[SETUP-REG] === REGISTER REQUEST RECEIVED ===");

        // Check if WiFi is connected
        if (WiFi.status() != WL_CONNECTED) {
          addSystemLog("[SETUP-REG] ERROR: WiFi not connected");
          request->send(400, "application/json", "{\"success\":false,\"error\":\"WiFi not connected. Test WiFi first.\"}");
          return;
        }

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        request->_tempObject = nullptr;

        if (err) {
          addSystemLog("[SETUP-REG] ERROR: Invalid JSON");
          request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String email = doc["email"] | "";
        String accountPassword = doc["accountPassword"] | "";
        String deviceName = doc["deviceName"] | "Scout";
        bool isNewAccount = doc["isNewAccount"] | true;
        String timezone = doc["timezone"] | "UTC";

        addSystemLog("[SETUP-REG] Email: " + email);
        addSystemLog("[SETUP-REG] Device: " + deviceName);
        addSystemLog("[SETUP-REG] NewAccount: " + String(isNewAccount ? "true" : "false"));

        if (email.isEmpty() || accountPassword.isEmpty() || deviceName.isEmpty()) {
          addSystemLog("[SETUP-REG] ERROR: Missing required fields");
          request->send(400, "application/json",
            "{\"success\":false,\"error\":\"Missing required fields: email, accountPassword, deviceName\"}");
          return;
        }

        // Store registration data (WiFi creds already stored from test-wifi)
        pendingSetupEmail = email;
        pendingSetupAccountPassword = accountPassword;
        pendingSetupDeviceName = deviceName;
        pendingSetupIsNewAccount = isNewAccount;
        pendingSetupTimezone = timezone;
        pendingRegistrationTime = millis();
        pendingRegistration = true;

        addSystemLog("[SETUP-REG] Registration queued");

        JsonDocument response;
        response["success"] = true;
        response["message"] = "Registration initiated";
        String json;
        serializeJson(response, json);
        request->send(200, "application/json", json);
      }
    }
  );

  // API: Standalone mode (WiFi only, no cloud)
  server.on("/api/setup/standalone", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t *data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      deserializeJson(doc, data, len);

      String ssid = doc["ssid"] | "";
      String password = doc["password"] | "";

      if (ssid.isEmpty()) {
        request->send(400, "application/json", "{\"error\":\"SSID required\"}");
        return;
      }

      Serial.printf("[SETUP] Standalone mode: %s\n", ssid.c_str());
      addSystemLog("[SETUP] Standalone mode enabled");

      // Save credentials and mark as standalone
      saveWiFiCredentials(ssid, password);
      standaloneMode = true;
      devicePrefs.begin("wifi", false);
      devicePrefs.putBool("standalone", true);
      devicePrefs.end();

      request->send(200, "application/json", "{\"success\":true,\"message\":\"Standalone mode enabled. Rebooting...\"}");

      // Reboot after response
      delay(500);
      ESP.restart();
    }
  );

  // API: Legacy combined setup (for backward compatibility)
  server.on("/api/setup/connect", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t *data, size_t len, size_t index, size_t total) {
      if (index == 0) request->_tempObject = (void*)new String();
      String* body = (String*)request->_tempObject;
      body->concat((char*)data, len);

      if (index + len == total) {
        addSystemLog("[SETUP-CONNECT] === CONNECT REQUEST RECEIVED ===");

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        request->_tempObject = nullptr;

        if (err) {
          addSystemLog("[SETUP-CONNECT] ERROR: Invalid JSON");
          request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String ssid = doc["ssid"] | "";
        String password = doc["password"] | "";
        String email = doc["email"] | "";
        String accountPassword = doc["accountPassword"] | "";
        String deviceName = doc["deviceName"] | "Scout";
        bool isNewAccount = doc["isNewAccount"] | true;
        String timezone = doc["timezone"] | "UTC";

        addSystemLog("[SETUP-CONNECT] SSID: " + ssid);
        addSystemLog("[SETUP-CONNECT] Email: " + email);
        addSystemLog("[SETUP-CONNECT] Device: " + deviceName);

        if (ssid.isEmpty() || email.isEmpty() || accountPassword.isEmpty() || deviceName.isEmpty()) {
          addSystemLog("[SETUP-CONNECT] ERROR: Missing required fields");
          request->send(400, "application/json",
            "{\"success\":false,\"error\":\"Missing required fields: ssid, email, accountPassword, deviceName\"}");
          return;
        }

        // Store pending setup data (will be processed in loop() after response is sent)
        pendingSetupSSID = ssid;
        pendingSetupPassword = password;
        pendingSetupEmail = email;
        pendingSetupAccountPassword = accountPassword;
        pendingSetupDeviceName = deviceName;
        pendingSetupIsNewAccount = isNewAccount;
        pendingSetupTimezone = timezone;
        pendingSetupTime = millis();
        pendingSetup = true;

        addSystemLog("[SETUP-CONNECT] Setup queued, pendingSetup=true");

        JsonDocument response;
        response["success"] = true;
        response["message"] = "Setup initiated - device will connect and register shortly";
        String json;
        serializeJson(response, json);
        request->send(200, "application/json", json);
      }
    }
  );

  // Serve SPA from LittleFS (for non-root paths)
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  // API: Status
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["device_type"] = DEVICE_TYPE;
    doc["device_name"] = claimedDeviceName;
    doc["mac"] = getMacAddress();
    doc["ip"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    doc["uptime"] = millis() / 1000;
    doc["heap_free"] = ESP.getFreeHeap();
    doc["firmware_version"] = currentFirmwareVersion;
    doc["filesystem_version"] = currentFilesystemVersion;
    doc["camera_ready"] = cameraInitialized;
    doc["mqtt_connected"] = mqttReallyConnected;
    doc["claimed"] = deviceClaimed;
    doc["standalone"] = standaloneMode;
    doc["motion_events"] = motionEventCount;

    MotionConfig config = motionDetector.getConfig();
    JsonObject motion = doc["motion_config"].to<JsonObject>();
    motion["threshold"] = config.threshold;
    motion["min_size"] = config.minSizePercent;
    motion["max_size"] = config.maxSizePercent;

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
  });

  // API: Camera capture
  server.on("/api/capture", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (!cameraInitialized) {
      request->send(500, "text/plain", "Camera not initialized");
      return;
    }

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      request->send(500, "text/plain", "Capture failed");
      return;
    }

    AsyncWebServerResponse* response = request->beginResponse_P(
      200, "image/jpeg", fb->buf, fb->len);
    request->send(response);
    esp_camera_fb_return(fb);
  });

  // /camera - alias for /api/capture (SPA compatibility)
  server.on("/camera", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (!cameraInitialized) {
      request->send(500, "text/plain", "Camera not initialized");
      return;
    }

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      request->send(500, "text/plain", "Capture failed");
      return;
    }

    AsyncWebServerResponse* response = request->beginResponse_P(
      200, "image/jpeg", fb->buf, fb->len);
    request->send(response);
    esp_camera_fb_return(fb);
  });

  // /api/captures - alias for /api/gallery (SPA compatibility)
  server.on("/api/captures", HTTP_GET, [](AsyncWebServerRequest* request) {
    request->send(200, "application/json", getGalleryJson());
  });

  // /api/system-status - system info (matches Trap firmware)
  server.on("/api/system-status", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;

    // Memory stats
    doc["heapFree"] = ESP.getFreeHeap();
    doc["heapTotal"] = ESP.getHeapSize();
    doc["psramFree"] = psramFound() ? ESP.getFreePsram() : 0;
    doc["psramTotal"] = psramFound() ? ESP.getPsramSize() : 0;

    // Filesystem stats
    doc["fsFree"] = LittleFS.totalBytes() - LittleFS.usedBytes();
    doc["fsTotal"] = LittleFS.totalBytes();
    doc["fsUsed"] = LittleFS.usedBytes();

    // System info
    doc["cpuFreq"] = ESP.getCpuFreqMHz();
    doc["uptimeSeconds"] = millis() / 1000;
    doc["firmwareVersion"] = FIRMWARE_VERSION;
    doc["filesystemVersion"] = FILESYSTEM_VERSION;
    doc["macAddress"] = WiFi.macAddress();
    doc["ipAddress"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();

    // Debug: connection flags
    doc["wifiConnected"] = wifiConnected;
    doc["wifiStatus"] = WiFi.status();
    doc["deviceClaimed"] = deviceClaimed;
    doc["mqttConfigured"] = claimedMqttBroker.length() > 0;
    doc["mqttBroker"] = claimedMqttBroker;

    // Capture files
    JsonArray captures = doc.createNestedArray("captures");
    File dir = LittleFS.open(GALLERY_DIR, "r");
    if (dir) {
      while (File f = dir.openNextFile()) {
        if (!f.isDirectory()) {
          JsonObject capture = captures.createNestedObject();
          capture["name"] = String(f.name());
          capture["size"] = f.size();
        }
        f.close();
      }
      dir.close();
    }

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // API: Gallery list
  server.on("/api/gallery", HTTP_GET, [](AsyncWebServerRequest* request) {
    request->send(200, "application/json", getGalleryJson());
  });

  // API: Gallery image
  server.on("/api/gallery/*", HTTP_GET, [](AsyncWebServerRequest* request) {
    String path = request->url();
    path.replace("/api/gallery", GALLERY_DIR);

    if (LittleFS.exists(path)) {
      request->send(LittleFS, path, "image/jpeg");
    } else {
      request->send(404, "text/plain", "Not found");
    }
  });

  // API: Motion config
  server.on("/api/motion/config", HTTP_GET, [](AsyncWebServerRequest* request) {
    MotionConfig config = motionDetector.getConfig();
    JsonDocument doc;
    doc["threshold"] = config.threshold;
    doc["min_size"] = config.minSizePercent;
    doc["max_size"] = config.maxSizePercent;
    doc["block_size"] = config.blockSize;
    doc["cooldown"] = config.cooldownMs;

    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
  });

  // API: Update motion config
  server.on("/api/motion/config", HTTP_POST, [](AsyncWebServerRequest* request) {},
    NULL,
    [](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);

      if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
      }

      MotionConfig config = motionDetector.getConfig();

      if (doc.containsKey("threshold")) {
        config.threshold = doc["threshold"].as<uint8_t>();
      }
      if (doc.containsKey("min_size")) {
        config.minSizePercent = doc["min_size"].as<float>();
      }
      if (doc.containsKey("max_size")) {
        config.maxSizePercent = doc["max_size"].as<float>();
      }
      if (doc.containsKey("cooldown")) {
        config.cooldownMs = doc["cooldown"].as<uint16_t>();
      }

      motionDetector.setConfig(config);
      saveMotionConfig();

      request->send(200, "application/json", "{\"success\":true}");
    }
  );

  // API: System log
  server.on("/api/logs", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < MAX_LOG_ENTRIES; i++) {
      int idx = (logIndex + i) % MAX_LOG_ENTRIES;
      if (systemLog[idx].length() > 0) {
        arr.add(systemLog[idx]);
      }
    }
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
  });

  // API: System logs alias (SPA compatibility)
  server.on("/api/system-logs", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < MAX_LOG_ENTRIES; i++) {
      int idx = (logIndex + i) % MAX_LOG_ENTRIES;
      if (systemLog[idx].length() > 0) {
        arr.add(systemLog[idx]);
      }
    }
    String response;
    serializeJson(doc, response);
    request->send(200, "application/json", response);
  });

  // API: Device claim status
  server.on("/api/device/claim-status", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["claimed"] = deviceClaimed;
    doc["deviceType"] = DEVICE_TYPE;
    if (deviceClaimed) {
      doc["deviceId"] = claimedDeviceId;
      doc["deviceName"] = claimedDeviceName;
      doc["tenantId"] = claimedTenantId;
      doc["mqttClientId"] = claimedMqttClientId;
      doc["mqttBroker"] = claimedMqttBroker;
      doc["mqttConnected"] = mqttReallyConnected;
    } else {
      doc["macAddress"] = getMacAddress();
      doc["message"] = "Device not claimed - provisioning required";
    }

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // API: Claim device with claim code (matches Trap firmware)
  server.on("/api/device/claim", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t *data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);

      if (error) {
        request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
        return;
      }

      String claimCode = doc["claimCode"] | "";

      if (claimCode.isEmpty()) {
        request->send(400, "application/json", "{\"success\":false,\"error\":\"Claim code required\"}");
        return;
      }

      claimCode.trim();
      claimCode.toUpperCase();
      addSystemLog("[API] Claim request with code: " + claimCode);

      // Call claim device function
      bool result = claimDevice(claimCode);

      JsonDocument response;
      response["success"] = result;
      if (result) {
        response["message"] = "Device claimed successfully";
        response["deviceId"] = claimedDeviceId;
        response["deviceName"] = claimedDeviceName;
      } else {
        response["error"] = "Claim failed - invalid code or server error";
      }

      String json;
      serializeJson(response, json);
      request->send(result ? 200 : 400, "application/json", json);
    }
  );

  // API: Register and claim device (HMAC-based authentication) - legacy
  server.on("/api/device/register-claim", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t *data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);

      if (error) {
        request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
        return;
      }

      String email = doc["email"] | "";
      String password = doc["password"] | "";
      String deviceName = doc["deviceName"] | "Scout";
      bool isNewAccount = doc["isNewAccount"] | true;

      if (email.isEmpty()) {
        request->send(400, "application/json", "{\"success\":false,\"error\":\"Email required\"}");
        return;
      }

      addSystemLog("[API] Register-claim request for: " + email);

      // Call HMAC-based registration
      bool result = registerAndClaimDevice(email, password, deviceName, isNewAccount);

      JsonDocument response;
      response["success"] = result;
      if (result) {
        response["message"] = "Device registered and claimed successfully";
        response["deviceId"] = claimedDeviceId;
        response["deviceName"] = claimedDeviceName;
      } else {
        response["error"] = "Registration failed - check logs";
      }

      String json;
      serializeJson(response, json);
      request->send(result ? 200 : 500, "application/json", json);
    }
  );

  // API: Unclaim device
  server.on("/api/device/unclaim", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (!deviceClaimed) {
      request->send(400, "application/json", "{\"success\":false,\"error\":\"Device not claimed\"}");
      return;
    }

    // Clear claim credentials
    deviceClaimed = false;
    claimedDeviceId = "";
    claimedDeviceName = "Scout";
    claimedTenantId = "";
    claimedMqttBroker = "";
    claimedMqttUsername = "";
    claimedMqttPassword = "";
    claimedMqttClientId = "";
    standaloneMode = false;

    // Save cleared state
    saveClaimCredentials();

    // Disconnect MQTT
    mqttClient.disconnect();
    mqttReallyConnected = false;

    addSystemLog("[API] Device unclaimed");

    // Enable AP mode for captive portal while keeping WiFi connection
    if (!isAPMode && wifiConnected) {
      Serial.println("[UNCLAIM] Enabling AP mode for setup while staying connected to WiFi");
      WiFi.mode(WIFI_AP_STA);
      delay(100);

      String apName = "Scout-" + getMacAddressNoColons().substring(6);
      IPAddress apIP(192, 168, 4, 1);
      IPAddress gateway(192, 168, 4, 1);
      IPAddress subnet(255, 255, 255, 0);
      WiFi.softAPConfig(apIP, gateway, subnet);
      WiFi.softAP(apName.c_str());

      dnsServer.start(DNS_PORT, "*", apIP);
      isAPMode = true;
      addSystemLog("[UNCLAIM] AP started: " + apName);
    }

    request->send(200, "application/json", "{\"success\":true,\"message\":\"Device unclaimed\"}");
  });

  // API: WiFi config (for setup)
  server.on("/api/wifi", HTTP_POST, [](AsyncWebServerRequest* request) {},
    NULL,
    [](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      deserializeJson(doc, data, len);

      String ssid = doc["ssid"] | "";
      String password = doc["password"] | "";

      if (ssid.length() > 0) {
        saveWiFiCredentials(ssid, password);
        request->send(200, "application/json", "{\"success\":true}");

        // Reconnect to WiFi
        delay(1000);
        ESP.restart();
      } else {
        request->send(400, "application/json", "{\"error\":\"SSID required\"}");
      }
    }
  );

  // API: Debug - force MQTT reconnect
  server.on("/api/mqtt/reconnect", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["wifiConnected"] = wifiConnected;
    doc["wifiStatus"] = WiFi.status();
    doc["deviceClaimed"] = deviceClaimed;
    doc["standaloneMode"] = standaloneMode;
    doc["mqttBroker"] = claimedMqttBroker;
    doc["mqttUsername"] = claimedMqttUsername;
    doc["mqttPassword"] = claimedMqttPassword.length() > 0 ? "***SET***" : "***EMPTY***";
    doc["mqttClientId"] = claimedMqttClientId;
    doc["tenantId"] = claimedTenantId;

    // Test raw TCP connection to broker
    WiFiClient testClient;
    String broker = claimedMqttBroker;
    broker.replace("mqtt://", "");
    int colonPos = broker.indexOf(':');
    if (colonPos > 0) broker = broker.substring(0, colonPos);

    unsigned long tcpStart = millis();
    bool tcpConnected = testClient.connect(broker.c_str(), 1883, 5000);
    doc["tcpTestTime"] = millis() - tcpStart;
    doc["tcpTestResult"] = tcpConnected;
    if (tcpConnected) {
      testClient.stop();
    }

    // Force MQTT setup and connect
    mqttSetup();
    lastMqttReconnect = 0;  // Reset reconnect timer
    bool connected = mqttConnect();
    doc["connectAttempted"] = true;
    doc["connected"] = connected;
    doc["mqttState"] = mqttClient.state();

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // API: Standalone MQTT config
  server.on("/api/mqtt", HTTP_POST, [](AsyncWebServerRequest* request) {},
    NULL,
    [](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      deserializeJson(doc, data, len);

      claimedMqttBroker = doc["broker"] | "";
      claimedMqttUsername = doc["username"] | "";
      claimedMqttPassword = doc["password"] | "";
      claimedTenantId = doc["tenant_id"] | "";
      claimedMqttClientId = doc["client_id"] | getMacAddressNoColons();
      claimedDeviceName = doc["device_name"] | "Scout";

      if (claimedMqttBroker.length() > 0 && claimedTenantId.length() > 0) {
        standaloneMode = true;
        deviceClaimed = true;

        devicePrefs.begin("wifi", false);
        devicePrefs.putBool("standalone", true);
        devicePrefs.end();

        saveClaimCredentials();
        mqttSetup();

        request->send(200, "application/json", "{\"success\":true}");
      } else {
        request->send(400, "application/json", "{\"error\":\"Broker and tenant_id required\"}");
      }
    }
  );

  // ==========================================================================
  // Phase 1: Dashboard Endpoints
  // ==========================================================================

  // /data - Main polling endpoint (SPA Dashboard uses this)
  server.on("/data", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["triggered"] = detectionState;
    doc["threshold"] = 0;  // No ToF sensor
    doc["currentHourAverage"] = 0;  // No ToF sensor
    doc["calibrationOffset"] = calibrationOffset;
    doc["falseAlarmOffset"] = falseAlarmOffset;
    doc["overrideThreshold"] = overrideThreshold;
    JsonArray anomalies = doc["anomalies"].to<JsonArray>();
    // No anomalies for camera-only device

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // /reset - Clear detection state
  server.on("/reset", HTTP_GET, [](AsyncWebServerRequest* request) {
    detectionState = false;
    addSystemLog("Detection state reset via /reset");
    request->send(200, "text/plain", "OK");
  });

  // /auto.jpg - Auto-lit snapshot (no flash for Scout)
  server.on("/auto.jpg", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (!cameraInitialized) {
      request->send(500, "text/plain", "Camera not initialized");
      return;
    }

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      request->send(500, "text/plain", "Camera capture failed");
      return;
    }

    AsyncWebServerResponse* response = request->beginResponse_P(
      200, "image/jpeg", fb->buf, fb->len);
    response->addHeader("Cache-Control", "no-store");
    request->send(response);
    esp_camera_fb_return(fb);
  });

  // /toggleLED - Toggle onboard LED
  server.on("/toggleLED", HTTP_GET, [](AsyncWebServerRequest* request) {
    ledState = !ledState;
    digitalWrite(ONBOARD_LED_PIN, ledState ? HIGH : LOW);
    String msg = ledState ? "ON" : "OFF";
    request->send(200, "text/plain", msg);
  });

  // /ledStatus - Get LED state
  server.on("/ledStatus", HTTP_GET, [](AsyncWebServerRequest* request) {
    String status = ledState ? "ON" : "OFF";
    request->send(200, "text/plain", status);
  });

  // ==========================================================================
  // Phase 2: Test Alert & System Endpoints
  // ==========================================================================

  // /testAlert - Trigger test alert
  server.on("/testAlert", HTTP_GET, [](AsyncWebServerRequest* request) {
    addSystemLog("Test alert triggered via GUI");

    detectionState = true;

    // Capture image
    if (cameraInitialized) {
      camera_fb_t* fb = esp_camera_fb_get();
      if (fb) {
        saveImageToGallery(fb, "test");
        esp_camera_fb_return(fb);
      }
    }

    // Publish MQTT alert if connected
    if (mqttReallyConnected && mqttClient.connected()) {
      String topic = "devices/" + claimedDeviceId + "/alert";
      JsonDocument doc;
      doc["type"] = "test";
      doc["timestamp"] = time(nullptr);
      doc["device_id"] = claimedDeviceId;
      String payload;
      serializeJson(doc, payload);
      mqttClient.publish(topic.c_str(), payload.c_str());
    }

    request->send(200, "text/plain", "Test alert started - check /gallery or /captures");
  });

  // POST /api/capture - Capture photo and save to gallery (without triggering alert)
  server.on("/api/capture", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (!cameraInitialized) {
      request->send(500, "application/json", "{\"success\":false,\"error\":\"Camera not initialized\"}");
      return;
    }

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      request->send(500, "application/json", "{\"success\":false,\"error\":\"Capture failed\"}");
      return;
    }

    saveImageToGallery(fb, "manual");
    esp_camera_fb_return(fb);

    addSystemLog("Manual capture saved to gallery");
    request->send(200, "application/json", "{\"success\":true}");
  });

  // /api/system-info - Firmware info
  server.on("/api/system-info", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    doc["firmwareVersion"] = currentFirmwareVersion;
    doc["filesystemVersion"] = currentFilesystemVersion;

    // Include update timestamps (0 = never updated via OTA)
    doc["firmwareUpdateTime"] = firmwareUpdateTimestamp;
    doc["filesystemUpdateTime"] = filesystemUpdateTimestamp;

    doc["chipModel"] = ESP.getChipModel();
    doc["cpuFreq"] = ESP.getCpuFreqMHz();
    doc["flashSize"] = ESP.getFlashChipSize();
    doc["psramSize"] = ESP.getPsramSize();
    doc["macAddress"] = WiFi.macAddress();
    doc["sdkVersion"] = ESP.getSdkVersion();

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json; charset=utf-8", json);
  });

  // /reboot - Reboot with auth
  server.on("/reboot", HTTP_GET, [](AsyncWebServerRequest* request) {
    // Simple auth check (matches trap behavior)
    if (!request->authenticate("ops", "changeme")) {
      return request->requestAuthentication();
    }

    addSystemLog("Reboot command received from " + request->client()->remoteIP().toString());
    request->send(200, "text/plain", "Rebooting...");
    delay(1000);
    ESP.restart();
  });

  // /healthz - Health check endpoint
  server.on("/healthz", HTTP_GET, [](AsyncWebServerRequest* request) {
    request->send(200, "text/plain", "OK");
  });

  // /systemStatus - System status (JSON format for API clients)
  server.on("/systemStatus", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;

    // Uptime in human-readable format
    uint32_t upSec = millis() / 1000;
    uint32_t days = upSec / 86400;
    uint32_t hours = (upSec % 86400) / 3600;
    uint32_t mins = (upSec % 3600) / 60;
    uint32_t secs = upSec % 60;

    char uptimeBuf[64];
    if (days > 0) {
      snprintf(uptimeBuf, sizeof(uptimeBuf), "%ud %uh %um %us", days, hours, mins, secs);
    } else if (hours > 0) {
      snprintf(uptimeBuf, sizeof(uptimeBuf), "%uh %um %us", hours, mins, secs);
    } else {
      snprintf(uptimeBuf, sizeof(uptimeBuf), "%um %us", mins, secs);
    }

    doc["uptime"] = uptimeBuf;
    doc["heapFree"] = ESP.getFreeHeap();
    doc["heapTotal"] = ESP.getHeapSize();
    doc["psramFree"] = psramFound() ? ESP.getFreePsram() : 0;
    doc["psramTotal"] = psramFound() ? ESP.getPsramSize() : 0;
    doc["fsFree"] = LittleFS.totalBytes() - LittleFS.usedBytes();
    doc["fsTotal"] = LittleFS.totalBytes();
    doc["wifiRSSI"] = WiFi.RSSI();
    doc["ipAddress"] = WiFi.localIP().toString();
    doc["macAddress"] = WiFi.macAddress();

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // /logs - Plain text logs (auth required)
  server.on("/logs", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (!request->authenticate("ops", "changeme")) {
      return request->requestAuthentication();
    }

    String logs = "";
    for (int i = 0; i < MAX_LOG_ENTRIES; i++) {
      int idx = (logIndex + i) % MAX_LOG_ENTRIES;
      if (systemLog[idx].length() > 0) {
        logs += systemLog[idx] + "\n";
      }
    }

    request->send(200, "text/plain", logs);
  });

  // /sendHeartbeat - Trigger MQTT heartbeat
  server.on("/sendHeartbeat", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (mqttReallyConnected && mqttClient.connected()) {
      publishDeviceStatus();
      request->send(200, "text/plain", "Heartbeat sent");
    } else {
      request->send(503, "text/plain", "MQTT not connected");
    }
  });

  // ==========================================================================
  // Phase 3: Camera Settings Endpoints
  // ==========================================================================

  // GET /api/camera-settings
  server.on("/api/camera-settings", HTTP_GET, [](AsyncWebServerRequest* request) {
    sensor_t* s = esp_camera_sensor_get();
    JsonDocument doc;

    doc["framesize"] = s ? s->status.framesize : 0;
    doc["quality"] = s ? s->status.quality : 12;
    doc["brightness"] = s ? s->status.brightness : 0;
    doc["contrast"] = s ? s->status.contrast : 0;
    doc["saturation"] = s ? s->status.saturation : 0;
    doc["vflip"] = s ? s->status.vflip : 0;
    doc["hmirror"] = s ? s->status.hmirror : 0;

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  // POST /api/camera-settings
  server.on("/api/camera-settings", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, data, len);
      if (err) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
      }

      sensor_t* s = esp_camera_sensor_get();
      if (!s) {
        request->send(500, "application/json", "{\"error\":\"Camera not initialized\"}");
        return;
      }

      if (doc.containsKey("framesize")) {
        int fs = doc["framesize"].as<int>();
        if (fs >= 0 && fs <= 13) {
          s->set_framesize(s, (framesize_t)fs);
        }
      }
      if (doc.containsKey("quality")) {
        int q = doc["quality"].as<int>();
        if (q >= 4 && q <= 63) {
          s->set_quality(s, q);
        }
      }
      if (doc.containsKey("brightness")) {
        int b = doc["brightness"].as<int>();
        if (b >= -2 && b <= 2) {
          s->set_brightness(s, b);
        }
      }
      if (doc.containsKey("contrast")) {
        int c = doc["contrast"].as<int>();
        if (c >= -2 && c <= 2) {
          s->set_contrast(s, c);
        }
      }
      if (doc.containsKey("saturation")) {
        int sat = doc["saturation"].as<int>();
        if (sat >= -2 && sat <= 2) {
          s->set_saturation(s, sat);
        }
      }
      if (doc.containsKey("vflip")) {
        s->set_vflip(s, doc["vflip"].as<bool>() ? 1 : 0);
      }
      if (doc.containsKey("hmirror")) {
        s->set_hmirror(s, doc["hmirror"].as<bool>() ? 1 : 0);
      }

      addSystemLog("Camera settings updated via API");
      request->send(200, "application/json", "{\"success\":true}");
    });

  // ==========================================================================
  // Phase 4: Log Persistence Endpoints
  // ==========================================================================

  // /api/previous-logs - Logs from 1 boot ago
  server.on("/api/previous-logs", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    JsonArray logsArray = doc.to<JsonArray>();

    File f = LittleFS.open("/prevLogs.txt", "r");
    if (f) {
      int lineCount = 0;
      while (f.available() && lineCount < 100) {
        String line = f.readStringUntil('\n');
        line.trim();
        if (line.length() > 0) {
          logsArray.add(line);
          lineCount++;
        }
      }
      f.close();
    }

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json; charset=utf-8", json);
  });

  // /api/older-logs - Logs from 2 boots ago
  server.on("/api/older-logs", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    JsonArray logsArray = doc.to<JsonArray>();

    File f = LittleFS.open("/prevLogs2.txt", "r");
    if (f) {
      int lineCount = 0;
      while (f.available() && lineCount < 100) {
        String line = f.readStringUntil('\n');
        line.trim();
        if (line.length() > 0) {
          logsArray.add(line);
          lineCount++;
        }
      }
      f.close();
    }

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json; charset=utf-8", json);
  });

  // /api/access-logs - HTTP access logs
  server.on("/api/access-logs", HTTP_GET, [](AsyncWebServerRequest* request) {
    JsonDocument doc;
    JsonArray logsArray = doc.to<JsonArray>();

    for (int i = 0; i < accessLogCount; i++) {
      logsArray.add(accessLogs[i]);
    }

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json; charset=utf-8", json);
  });

  // ==========================================================================
  // Phase 5: Calibration Stub Endpoints (for future ToF sensor)
  // ==========================================================================

  // /setCalib - Store calibration value (no actual effect on camera-only device)
  server.on("/setCalib", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (request->hasArg("calib")) {
      calibrationOffset = request->arg("calib").toInt();
      addSystemLog("Calibration offset set to " + String(calibrationOffset) + " (stub)");
    }
    if (request->hasArg("overrideTh")) {
      overrideThreshold = request->arg("overrideTh").toInt();
      addSystemLog("Override threshold set to " + String(overrideThreshold) + " (stub)");
    }
    request->send(200, "text/plain", "OK");
  });

  // /recalib - Return message that recalibration is not applicable
  server.on("/recalib", HTTP_GET, [](AsyncWebServerRequest* request) {
    addSystemLog("Recalibration requested (not applicable for camera-only device)");
    request->send(200, "text/plain", "Not applicable for camera-only device");
  });

  // /resetCalib - Clear stored calibration values
  server.on("/resetCalib", HTTP_GET, [](AsyncWebServerRequest* request) {
    calibrationOffset = 0;
    falseAlarmOffset = 0;
    overrideThreshold = 0;
    addSystemLog("Calibration values reset (stub)");
    request->send(200, "text/plain", "OK");
  });

  // /falseAlarm - Log false alarm event
  server.on("/falseAlarm", HTTP_GET, [](AsyncWebServerRequest* request) {
    falseAlarmOffset += 10;
    addSystemLog("False alarm reported, offset now " + String(falseAlarmOffset) + " (stub)");
    String json = "{\"falseOff\":" + String(falseAlarmOffset) + ",\"threshold\":0}";
    request->send(200, "application/json", json);
  });

  // ==========================================================================
  // Phase 6: WiFi Update & Gallery Delete Endpoints
  // ==========================================================================

  // POST /api/wifi/update - Update WiFi credentials on claimed device
  server.on("/api/wifi/update", HTTP_POST, [](AsyncWebServerRequest* request){}, NULL,
    [](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
      Serial.println("[WIFI-UPDATE] === WiFi Update Request ===");
      addSystemLog("[WIFI-UPDATE] Received request");

      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);

      if (error) {
        Serial.printf("[WIFI-UPDATE] JSON parse error: %s\n", error.c_str());
        request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
        return;
      }

      String newSSID = doc["ssid"].as<String>();
      String newPassword = doc["password"].as<String>();

      if (newSSID.length() == 0) {
        request->send(400, "application/json", "{\"success\":false,\"error\":\"SSID is required\"}");
        return;
      }

      if (newPassword.length() < 8) {
        request->send(400, "application/json", "{\"success\":false,\"error\":\"Password must be at least 8 characters\"}");
        return;
      }

      Serial.printf("[WIFI-UPDATE] Updating WiFi to SSID: %s\n", newSSID.c_str());
      addSystemLog("[WIFI-UPDATE] Updating WiFi to: " + newSSID);

      // Save WiFi credentials (does NOT affect claim status)
      saveWiFiCredentials(newSSID, newPassword);

      JsonDocument response;
      response["success"] = true;
      response["message"] = "WiFi credentials updated. Device will restart and connect.";

      String json;
      serializeJson(response, json);
      request->send(200, "application/json", json);

      Serial.println("[WIFI-UPDATE] Credentials saved, rebooting in 1 second...");
      addSystemLog("[WIFI-UPDATE] Rebooting to apply new WiFi...");

      delay(1000);
      ESP.restart();
    }
  );

  // DELETE /captures/{filename} - Delete capture from gallery
  server.on("/captures/*", HTTP_DELETE, [](AsyncWebServerRequest* request) {
    String url = request->url();
    // Extract filename from URL (after /captures/)
    String filename = url.substring(10);  // "/captures/" is 10 chars

    if (filename.length() == 0 || filename.indexOf("..") >= 0) {
      request->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid filename\"}");
      return;
    }

    String filepath = String(GALLERY_DIR) + "/" + filename;

    if (!LittleFS.exists(filepath)) {
      request->send(404, "application/json", "{\"success\":false,\"error\":\"File not found\"}");
      return;
    }

    if (LittleFS.remove(filepath)) {
      addSystemLog("Deleted capture: " + filename);
      request->send(200, "application/json", "{\"success\":true}");
    } else {
      request->send(500, "application/json", "{\"success\":false,\"error\":\"Failed to delete\"}");
    }
  });

  // Serve captures from gallery directory
  server.on("/captures/*", HTTP_GET, [](AsyncWebServerRequest* request) {
    String url = request->url();
    String filename = url.substring(10);  // "/captures/" is 10 chars

    if (filename.length() == 0 || filename.indexOf("..") >= 0) {
      request->send(400, "text/plain", "Invalid filename");
      return;
    }

    String filepath = String(GALLERY_DIR) + "/" + filename;

    if (!LittleFS.exists(filepath)) {
      request->send(404, "text/plain", "Not found");
      return;
    }

    request->send(LittleFS, filepath, "image/jpeg");
  });

  // ElegantOTA for web-based updates
  ElegantOTA.begin(&server);

  // CRITICAL: Captive portal catch-all - redirect ALL unknown requests to /setup when in AP mode
  // This matches the EXACT pattern from the working Trap firmware:
  // 1. iOS requests captive.apple.com/hotspot-detect.html (or similar)
  // 2. DNS redirects to 192.168.4.1
  // 3. onNotFound catches it and redirects to /setup
  // 4. /setup handler redirects to /#/setup
  // 5. / handler serves index.html (content, not redirect)
  // 6. iOS sees content instead of 204 → shows captive portal popup
  server.onNotFound([](AsyncWebServerRequest* request) {
    if (isAPMode && !deviceClaimed && !standaloneMode) {
      Serial.println("[CAPTIVE] Redirecting to /setup: " + request->url());
      request->redirect("/setup");
    } else {
      request->send(404, "text/plain", "Not found");
    }
  });

  server.begin();
  Serial.println("[Web] Server started on port 80");
}

// =============================================================================
// Setup
// =============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Initialize LED pin
  pinMode(ONBOARD_LED_PIN, OUTPUT);
  digitalWrite(ONBOARD_LED_PIN, LOW);

  Serial.println("\n========================================");
  Serial.println("Scout Device Firmware");
  Serial.printf("Version: %s\n", FIRMWARE_VERSION);
  Serial.println("========================================\n");

  // Initialize LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("[FS] LittleFS mount failed");
  } else {
    Serial.println("[FS] LittleFS mounted");
    // Rotate logs on boot (keep 2 generations of previous logs)
    rotateLogs();
  }

  // Initialize edge classifier (loads /model.tflite from LittleFS if present)
  edgeClassifierInit();

  // Load configuration
  loadWiFiCredentials();
  loadClaimCredentials();
  loadMotionConfig();
  loadVersions();

  // Connect to WiFi
  if (savedSSID.length() > 0) {
    Serial.printf("[WiFi] Connecting to %s...\n", savedSSID.c_str());
    WiFi.begin(savedSSID.c_str(), savedPassword.c_str());

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
      delay(500);
      Serial.print(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());

      // Sync NTP first
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");

      // Wait for NTP sync (up to 10 seconds)
      Serial.print("[NTP] Syncing time");
      int ntpAttempts = 0;
      while (time(nullptr) < 1000000000 && ntpAttempts < 20) {
        delay(500);
        Serial.print(".");
        ntpAttempts++;
      }

      if (time(nullptr) >= 1000000000) {
        Serial.println(" OK");
        // Apply timezone AFTER NTP sync
        setenv("TZ", "PST8PDT,M3.2.0/2,M11.1.0/2", 1);
        tzset();
        time_t now = time(nullptr);
        struct tm timeinfo;
        localtime_r(&now, &timeinfo);
        char timeBuf[32];
        strftime(timeBuf, sizeof(timeBuf), "%b %d %H:%M:%S", &timeinfo);
        Serial.printf("[NTP] Local time: %s\n", timeBuf);
      } else {
        Serial.println(" FAILED");
      }

      // If unclaimed, also enable AP mode for captive portal setup
      if (!deviceClaimed && !standaloneMode) {
        Serial.println("[WiFi] Device unclaimed - enabling AP+STA mode for setup");
        WiFi.mode(WIFI_AP_STA);
        delay(100);

        String apName = "Scout-" + getMacAddressNoColons().substring(6);
        IPAddress apIP(192, 168, 4, 1);
        IPAddress gateway(192, 168, 4, 1);
        IPAddress subnet(255, 255, 255, 0);
        WiFi.softAPConfig(apIP, gateway, subnet);
        WiFi.softAP(apName.c_str());

        dnsServer.start(DNS_PORT, "*", apIP);
        isAPMode = true;
        Serial.printf("[WiFi] AP started: %s @ %s\n", apName.c_str(), WiFi.softAPIP().toString().c_str());
        addSystemLog("[WiFi] Unclaimed - AP enabled: " + apName);
      }
    } else {
      Serial.println("\n[WiFi] Connection failed");
    }
  }

  // Start AP mode if no WiFi or not connected
  if (!wifiConnected) {
    Serial.println("[WIFI] No saved WiFi credentials - entering AP mode for setup");
    addSystemLog("[WIFI] No saved credentials - entering AP mode");

    // Use AP_STA mode to allow WiFi scanning while in AP mode (CRITICAL for captive portal)
    WiFi.mode(WIFI_AP_STA);
    delay(100);  // Let WiFi mode settle

    String apName = "Scout-" + getMacAddressNoColons().substring(6);

    // Configure AP IP explicitly before starting
    IPAddress apIP(192, 168, 4, 1);
    IPAddress gateway(192, 168, 4, 1);
    IPAddress subnet(255, 255, 255, 0);
    WiFi.softAPConfig(apIP, gateway, subnet);

    // Open AP (no password) - matches trap captive portal approach
    bool apStarted = WiFi.softAP(apName.c_str());
    if (!apStarted) {
      Serial.println("[AP MODE] ERROR: softAP() returned false!");
      addSystemLog("[AP MODE] ERROR: Failed to start AP!");
    }

    apIP = WiFi.softAPIP();
    Serial.print("[AP MODE] Access Point started: ");
    Serial.println(apName);
    Serial.print("[AP MODE] IP address: ");
    Serial.println(apIP);
    Serial.println("[AP MODE] Connect to this network and navigate to http://192.168.4.1");

    addSystemLog("[AP MODE] Started AP: " + apName + " @ " + apIP.toString());
    isAPMode = true;

    // Start DNS server for captive portal (skip in standalone mode)
    if (!standaloneMode) {
      dnsServer.start(DNS_PORT, "*", apIP);
      Serial.println("[AP MODE] DNS server started for captive portal");
    } else {
      Serial.println("[AP MODE] Standalone mode - DNS server skipped");
    }

    // NOTE: WiFi scan will happen on-demand when user calls /api/wifi/scan
    // We don't scan at boot to avoid disrupting AP mode startup
    Serial.println("[AP MODE] Ready for connections. WiFi scan will happen on first API request.");
  }

  // Initialize camera
  initCamera();

  // Setup MQTT
  if ((deviceClaimed || standaloneMode) && wifiConnected) {
    addSystemLog("[SETUP] MQTT setup starting");
    mqttSetup();
    addSystemLog("[SETUP] MQTT setup complete, broker=" + claimedMqttBroker);
  } else {
    addSystemLog("[SETUP] MQTT skipped: claimed=" + String(deviceClaimed) + " standalone=" + String(standaloneMode) + " wifi=" + String(wifiConnected));
  }

  // Start web server
  setupWebServer();

  addSystemLog("Scout device started");
  Serial.println("\n[Setup] Complete!\n");
}

// =============================================================================
// Main Loop
// =============================================================================

// Process pending WiFi test (deferred from HTTP handler)
// Matches trap's processPendingWiFiTest() implementation exactly
void processPendingWiFiTest() {
  if (!pendingWiFiTest) return;

  // Wait 500ms for HTTP response to be fully sent (trap pattern)
  if (millis() - pendingWiFiTestTime < 500) return;

  pendingWiFiTest = false;  // Clear flag first to prevent re-entry

  // Reset state
  currentSetupState = SETUP_CONNECTING_WIFI;
  currentSetupStep = "Connecting to WiFi...";
  currentSetupError = "";
  currentSetupErrorCode = "";

  addSystemLog("[WIFI-TEST] ====== STARTING WIFI TEST ======");
  addSystemLog("[WIFI-TEST] SSID: " + pendingWiFiTestSSID);

  // Disconnect any previous WiFi connection
  addSystemLog("[WIFI-TEST] Disconnecting any previous connection...");
  WiFi.disconnect(true);
  delay(100);

  // Ensure we're in AP+STA mode (should already be, but be safe)
  if (WiFi.getMode() != WIFI_AP_STA) {
    WiFi.mode(WIFI_AP_STA);
    delay(100);
  }

  // Connect to WiFi (STA)
  addSystemLog("[WIFI-TEST] Connecting to WiFi: " + pendingWiFiTestSSID);
  WiFi.begin(pendingWiFiTestSSID.c_str(), pendingWiFiTestPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {  // 20 * 500ms = 10 seconds max
    delay(500);
    attempts++;
    if (attempts % 4 == 0) {
      currentSetupStep = "Connecting to WiFi... (" + String(attempts / 2) + "s)";
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    addSystemLog("[WIFI-TEST] WiFi connection failed after " + String(attempts * 500 / 1000) + " seconds");
    addSystemLog("[WIFI-TEST] WiFi status code: " + String(WiFi.status()));
    currentSetupState = SETUP_FAILED;
    currentSetupError = "Could not connect to WiFi network. Check password and try again.";
    currentSetupErrorCode = "wifi_failed";
    currentSetupStep = "WiFi connection failed";
    // Stay in AP+STA mode so user can retry
    return;
  }

  addSystemLog("[WIFI-TEST] WiFi connected, IP: " + WiFi.localIP().toString());
  wifiConnected = true;

  // Store credentials for registration phase
  pendingSetupSSID = pendingWiFiTestSSID;
  pendingSetupPassword = pendingWiFiTestPassword;

  // Save credentials for future use
  saveWiFiCredentials(pendingWiFiTestSSID, pendingWiFiTestPassword);

  addSystemLog("[WIFI-TEST] ====== WIFI TEST SUCCESSFUL ======");

  currentSetupState = SETUP_WIFI_CONNECTED;
  currentSetupStep = "WiFi connected! Ready for account setup.";
}

// Process pending registration (deferred from HTTP handler)
// Matches trap's processPendingRegistration() implementation exactly
void processPendingRegistration() {
  if (!pendingRegistration) return;

  // Wait 500ms for HTTP response to be fully sent (trap pattern)
  if (millis() - pendingRegistrationTime < 500) return;

  pendingRegistration = false;  // Clear flag first to prevent re-entry

  addSystemLog("[REGISTER] ====== STARTING REGISTRATION ======");
  addSystemLog("[REGISTER] Email: " + pendingSetupEmail);
  addSystemLog("[REGISTER] Device: " + pendingSetupDeviceName);

  // Sync time first (required for HMAC token)
  currentSetupState = SETUP_SYNCING_TIME;
  currentSetupStep = "Syncing time...";

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  int ntpAttempts = 0;
  while (time(nullptr) < 1000000000 && ntpAttempts < 20) {
    delay(500);
    ntpAttempts++;
  }

  if (time(nullptr) < 1000000000) {
    addSystemLog("[REGISTER] NTP sync failed");
    currentSetupState = SETUP_FAILED;
    currentSetupError = "Could not sync time. Check internet connection.";
    currentSetupErrorCode = "ntp_failed";
    currentSetupStep = "Time sync failed";
    saveSetupResult(false, "ntp_failed", "Could not sync time");
    return;
  }

  addSystemLog("[REGISTER] NTP synced");

  currentSetupState = SETUP_REGISTERING;
  currentSetupStep = "Registering device...";

  // Call HMAC-based registration
  bool result = registerAndClaimDevice(
    pendingSetupEmail,
    pendingSetupAccountPassword,
    pendingSetupDeviceName,
    pendingSetupIsNewAccount
  );

  if (result) {
    addSystemLog("[REGISTER] ====== REGISTRATION SUCCESSFUL ======");

    currentSetupState = SETUP_SAVING;
    currentSetupStep = "Saving configuration...";

    // Save claim credentials
    saveClaimCredentials();

    currentSetupState = SETUP_COMPLETE;
    currentSetupStep = "Setup complete!";
    setupNeedsReboot = true;

    // Switch from APSTA to STA only
    WiFi.mode(WIFI_STA);
    isAPMode = false;

    clearSetupResult();

  } else {
    addSystemLog("[REGISTER] Registration failed");
    currentSetupState = SETUP_FAILED;
    currentSetupError = "Could not register device. Check your account details.";
    currentSetupErrorCode = "registration_failed";
    currentSetupStep = "Registration failed";
    saveSetupResult(false, "registration_failed", currentSetupError);
  }

  // Clear sensitive pending data
  pendingSetupEmail = "";
  pendingSetupAccountPassword = "";
}

void loop() {
  // Handle OTA
  ElegantOTA.loop();

  // Process DNS requests for captive portal when in AP mode
  if (isAPMode) {
    dnsServer.processNextRequest();
    performWiFiScan();  // Check if async scan completed and cache results
  }

  // Process pending setup operations (deferred from HTTP handlers)
  processPendingWiFiTest();
  processPendingRegistration();

  // MQTT connection and loop
  if ((deviceClaimed || standaloneMode) && wifiConnected) {
    if (!mqttClient.connected()) {
      mqttConnect();
    }
    mqttClient.loop();

    // Periodic status publish (every 5 minutes)
    if (millis() - lastStatusPublish > 300000) {
      publishDeviceStatus();
    }
  }

  // Motion detection
  if (cameraInitialized && (deviceClaimed || standaloneMode)) {
    checkMotion();
  }

  // Small delay to prevent watchdog
  delay(10);
}

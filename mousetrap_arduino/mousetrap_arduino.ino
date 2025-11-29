/*
   MouseTrapToF-Cam.ino
   Consolidated sketch for an ESP32‑CAM based mouse trap system.
   Uses:
     • OV2640 camera (AI‑Thinker model) to serve still images on /camera.
     • VL6180X sensor on I2C2 (SDA=GPIO14, SCL=GPIO15) – if connected.
     • Onboard LED (LOW turns the LED off, HIGH turns it on) on GPIO4 for status indication.
     • Buzzer on GPIO41 for alert tones (if connected).
     • ElegantOTA for OTA updates.
     • An AsyncWebServer with endpoints (protected by IP whitelist/blacklist).
     • Preferences to persist IP filter settings.
     
   If the sensor or buzzer are not connected, the code logs the error and continues running.

   For Arduino IDE:
    Go to your Arduino libraries directory 
    Open ElegantOTA folder and then open src folder 
    Locate the ELEGANTOTA_USE_ASYNC_WEBSERVER macro in the ElegantOTA.h file, and set it to 1:
    #define ELEGANTOTA_USE_ASYNC_WEBSERVER 1
    Save the changes to the ElegantOTA.h file.

    Need to select appropriate PSRAM setting for board.
    Need to choose a "partition scheme" compatible with OTA.
    
    Partitions.csv file contents:
    # Name,   Type, SubType, Offset,   Size, Flags
    nvs,      data, nvs,     0x9000,   0x5000,
    otadata,  data, ota,     0xE000,   0x2000,
    app0,     app,  ota_0,   0x10000,  0x280000,
    app1,     app,  ota_1,   0x290000, 0x280000,
    littlefs, data, littlefs, 0x510000, 0xAEE000,
    coredump, data, coredump, 0xFFE000, 0x2000,

*/

// ==== helpers & per-device toggles ====
// ==== Servo pin – always a real pin in firmware; presence is runtime-gated ====
#ifndef SERVO_PIN
#define SERVO_PIN 48  // NEVER set to -1; use disableServo to gate behavior
#endif
//#define SERVO_PIN 48          // this device has NO servo; use 48 on servo units
#define TOF_XSHUT_PIN -1  // set to your XSHUT GPIO if wired; else leave -1
#define TOF_FORCE 0       // 0=AUTO, 1=VL6180X, 2=VL53L0X, 3=VL53L1X (optional)

#include "servo_optional.h"
#include "tof_autodetect.h"



// ======================================



// --------------------
// Pin Definitions
// --------------------

#define HIGH_POWER_LED_PIN 2
#define LED_PIN 1      // LED; LOW = off, HIGH = on
#define BUZZER_PIN 41  // Buzzer on GPIO41
#define BUTTON_PIN 42  // Changed from 12 to 32 to avoid conflicts with camera pins
#define I2C_SDA 21
#define I2C_SCL 47

#define CAPTURE_DIR "/captures"
constexpr int CAPTURE_DIR_LEN = sizeof(CAPTURE_DIR) - 1;





// --------------------
// Includes and Definitions
// --------------------
#define ELEGANTOTA_USE_ASYNC_WEBSERVER 1  // Enable AsyncWebServer support
#define DEBUG_ELEGANTOTA 1  // if ElegantOTA supports it
#include <ElegantOTA.h>
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <esp_wifi.h>  // For low-level WiFi scanning
#include <ESPmDNS.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
//#include <Adafruit_VL53L0X.h>
#include <Adafruit_VL6180X.h>
#include <time.h>
#include <Preferences.h>
#include <functional>
#include "esp_camera.h"
#include <stdlib.h>
#include <vector>
#include <algorithm>  // for std::sort in WiFi scan
#include "esp_heap_caps.h"  // for PSRAM alloc
#include <FS.h>
#define MAX_SAVED_IMAGES 20  // keep the newest N pictures
#include <LittleFS.h>
#define FS LittleFS  // handy alias ‑ you can still call it "SPIFFS"
#include <ESP32Servo.h>
#include "StringLiteralPlus.h"  // must be first, before any addSystemLog
#include "freertos/semphr.h"


//Crash kit
// ===== CrashKit (ESP32-S3) — snapshot previous run & page/task breadcrumbs =====
#include <esp_system.h>
#include <esp_mac.h>
#include <rom/rtc.h>
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>

#include "esp_log.h"

//MQTT for fleet management and OTA updates
#include <PubSubClient.h>
#include <Update.h>
#include <Preferences.h>

// HMAC-SHA256 for secure device claim tokens
#include <mbedtls/md.h>

// Debug instrumentation for PANIC crash debugging
#include "debug_framebuffer.h"
#include "debug_i2c.h"
#include "debug_tasks.h"
#include "debug_crashkit.h"
#include "debug_context.h"
#include "debug_dashboard.h"

// Device Claim Server Configuration
#ifndef CLAIM_SERVER_URL
#define CLAIM_SERVER_URL  "http://192.168.133.110:4000"
// #define CLAIM_SERVER_URL  "http://mtmon.wadehargrove.com:4000"
#endif

// HMAC-SHA256 Shared Secret for Device Claim Tokens
// IMPORTANT: Change this secret in production! Must match server-side secret.
#ifndef DEVICE_CLAIM_SECRET
#define DEVICE_CLAIM_SECRET "mousetrap-device-secret-change-in-production"
#endif

// Forward declaration of ClaimCredentials struct (needed for Arduino preprocessor)
// Full definition is in the HMAC Token Generation section below
struct ClaimCredentials {
  String token;      // HMAC-SHA256 hex-encoded token
  String timestamp;  // Unix timestamp string
  String mac;        // Device MAC address
};

// MQTT Configuration (defaults - overridden by claimed credentials)
#ifndef MQTT_BROKER
#define MQTT_BROKER  "192.168.133.110"
//#define MQTT_BROKER  "mtmon.wadehargrove.com"
#endif
#ifndef MQTT_PORT
#define MQTT_PORT    1883  // Use 8883 for TLS
#endif

// Legacy credentials (unused after device is claimed)
#ifndef MQTT_USER
#define MQTT_USER    ""  // Set if broker requires auth
#endif
#ifndef MQTT_PASS
#define MQTT_PASS    ""
#endif

// ======================================
// Device Claim Verification Results
// ======================================
// Enum for claim status verification - allows proper handling of network errors vs. explicit revocation
enum ClaimVerificationResult {
  CLAIM_VERIFIED,       // HTTP 200, {"claimed": true} - device is confirmed claimed
  EXPLICITLY_REVOKED,   // HTTP 410 or {"claimed": false} - server explicitly revoked device
  NETWORK_ERROR,        // Connection failed, timeout, etc. - assume device still claimed
  SERVER_ERROR          // HTTP 5xx errors - server issue, assume device still claimed
};

#ifndef TENANT_ID
#define TENANT_ID    "dev"  // Legacy - will use claimed tenantId
#endif

// Firmware version for OTA comparison
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "v1.0.0"  // Fallback - real version set by dashboard upload
#endif
#ifndef FILESYSTEM_VERSION
#define FILESYSTEM_VERSION "v1.0.0"  // Fallback - real version set by dashboard upload
#endif

// WebSocket tunnel removed - now using MQTT

#ifndef UPDATE_SIZE_UNKNOWN
#define UPDATE_SIZE_UNKNOWN 0xFFFFFFFF
#endif

void addSystemLog(const String &msg);  // Forward declaration

#ifdef LOG
#undef LOG
#endif


static inline void APP_LOG(const String& s) {
  Serial.println(s);
  addSystemLog(s);
}


// --- Build/boot info (adjust as needed) ---
static const char* BUILD_SEMVER = "mt-spa-ops-1";
static const char* BUILD_COMMIT = "local";
static unsigned long BOOT_MILLIS = 0;
static bool VERBOSE_HTTP = true; // set false to quiet logs

static void addStdHeaders(AsyncWebServerResponse* res) {
  res->addHeader("X-Build", BUILD_SEMVER);
  res->addHeader("X-Commit", BUILD_COMMIT);
  res->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
}

static String fmtUptime() {
  unsigned long ms = millis();
  unsigned long s = ms / 1000UL;
  unsigned long m = s / 60UL; s %= 60UL;
  unsigned long h = m / 60UL; m %= 60UL;
  unsigned long d = h / 24UL; h %= 24UL;
  char buf[64];
  snprintf(buf, sizeof(buf), "%lud %luh %lum %lus", d, h, m, s);
  return String(buf);
}

// --- Ops auth (Basic) ---
const char* OPS_USER = "ops";
const char* OPS_PASS = "changeme"; // TODO: set from a safer source if you have one

// -------- Request log ring buffer --------
struct LogEntry {
  unsigned long t_ms;
  String method;
  String url;
  String handler;
  int status;
};

static const size_t LOG_CAP = 120;
static LogEntry g_logs[LOG_CAP];
static size_t   g_log_head = 0;
static size_t   g_log_count = 0;

static void logHit(const char* method, const String& url, const char* handler, int status) {
  LogEntry &e = g_logs[g_log_head];
  e.t_ms   = millis();
  e.method = method;
  e.url    = url;
  e.handler= handler;
  e.status = status;
  g_log_head = (g_log_head + 1) % LOG_CAP;
  if (g_log_count < LOG_CAP) g_log_count++;
}

// Send helper: sets headers, status, logs, sends
static void sendWith(AsyncWebServerRequest* req,
                     AsyncWebServerResponse* res,
                     const char* handlerTag,
                     int statusCode)
{
  res->setCode(statusCode);               // ensure status
  res->addHeader("X-Handler", handlerTag);
  addStdHeaders(res);
  logHit(req->methodToString(), req->url(), handlerTag, statusCode);
  req->send(res);
}


int threshold = 25;  // Sensor detection threshold (mm)

// Debug instrumentation globals
FramebufferStats g_fb_stats;
SemaphoreHandle_t g_fb_mutex;
I2CSensorStats g_i2c_sensors[I2C_SENSOR_COUNT];
SemaphoreHandle_t g_i2c_mutex;
TaskStats g_task_stats[MAX_TRACKED_TASKS];
uint8_t g_task_count;
SemaphoreHandle_t g_task_mutex;
RTC_DATA_ATTR CrashContext g_crash_ctx;
SemaphoreHandle_t g_crash_mutex;
bool g_crash_kit_initialized = false;
RTC_DATA_ATTR ContextBuffer g_context_buf;
SemaphoreHandle_t g_context_mutex;
bool g_context_initialized = false;

//void addSystemLog(const String &msg);
// --- BEGIN PATCH: ChatGPT.ino (helpers) ---
// Safe stub if your project doesn't provide addSystemLog(String)
//static inline void addSystemLog(const String& s) __attribute__((weak));
//static inline void addSystemLog(const String& s) { /* no-op stub */ }

// Simple log helper (no extern/static conflicts)
//static inline void LOG(const String& s) { Serial.println(s); addSystemLog(s); }

// WebSocket code removed - using MQTT instead
static String g_macUpper;

// Keep base64 helpers (still used by some legacy code)
#include "mbedtls/base64.h"
static String b64Enc(const uint8_t* data,size_t n){ size_t cap=4*((n+2)/3)+1, out=0; std::unique_ptr<unsigned char[]>buf(new unsigned char[cap]); if(mbedtls_base64_encode(buf.get(),cap,&out,data,n)!=0)return String(); buf[ out ]=0; return String((char*)buf.get());}
static bool   b64Dec(const String&s,std::unique_ptr<uint8_t[]>&out,size_t&n){ size_t cap=(s.length()*3)/4+3; out.reset(new uint8_t[cap]); size_t got=0; int rc=mbedtls_base64_decode(out.get(),cap,&got,(const unsigned char*)s.c_str(),s.length()); if(rc!=0)return false; n=got; return true; }

// If your project already has b64Enc / b64Dec, provide aliases used by newer code
static inline String b64Encode(const uint8_t* p, size_t n) { return b64Enc(p, n); }
static inline bool   b64Decode(const String& in, std::unique_ptr<uint8_t[]>& out, size_t& outLen) { return b64Dec(in, out, outLen); }
// --- END PATCH: ChatGPT.ino (helpers) ---

// Keep MIME type helper (used by file serving)
static String guessContentType(const String& path) {
  String p = path; p.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return F("text/html; charset=utf-8");
  if (p.endsWith(".css"))  return F("text/css; charset=utf-8");
  if (p.endsWith(".js"))   return F("application/javascript; charset=utf-8");
  if (p.endsWith(".json")) return F("application/json; charset=utf-8");
  if (p.endsWith(".svg"))  return F("image/svg+xml");
  if (p.endsWith(".png"))  return F("image/png");
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return F("image/jpeg");
  if (p.endsWith(".gif"))  return F("image/gif");
  if (p.endsWith(".ico"))  return F("image/x-icon");
  if (p.endsWith(".txt") || p.endsWith(".log")) return F("text/plain; charset=utf-8");
  return F("application/octet-stream");
}

// WebSocket tunnel globals (legacy - can be removed when tunnel code is fully removed)
static volatile bool g_tunnelBusy = false;
static uint32_t g_tunnelBusyUntilMs = 0;
static const uint32_t TUNNEL_MAX_HANDLE_MS = 15000;
static bool g_otaActive = false;
static String g_otaId;

// Stub WebSocket functions (will be removed when tunnel code is cleaned up)
// #include <WebSocketsClient.h>  // REMOVED - using MQTT instead
// static WebSocketsClient g_ws;
#ifndef WS_HOST
#define WS_HOST "192.168.133.110"
//#define WS_HOST "mtmon.wadehargrove.com"
#endif
#ifndef WS_USE_TLS
#define WS_USE_TLS 1
#endif

static void wsSendJson(const JsonDocument& d) {
  // Stub - WebSocket disabled
  Serial.println("[WS] wsSendJson called but WebSocket is disabled");
}

// Forward declarations for WebSocket tunnel functions
static void wsSendStart(const char* id, int status, const String& contentType, bool base64Mode);
static void wsSendChunkText(const char* id, const char* data, size_t n);
static void wsSendChunkBase64(const char* id, const uint8_t* data, size_t n);
static void wsSendEnd(const char* id);

// === MQTT Globals ===
// Lazy initialization to avoid global constructor TCP crash
WiFiClient& getMqttWifiClient() {
  static WiFiClient* client = nullptr;
  if (!client) client = new WiFiClient();
  return *client;
}

PubSubClient& getMqttClient() {
  static PubSubClient* client = nullptr;
  if (!client) client = new PubSubClient(getMqttWifiClient());
  return *client;
}

// Macros for backward compatibility
#define mqttWifiClient getMqttWifiClient()
#define mqttClient getMqttClient()
static unsigned long lastMqttReconnect = 0;
static unsigned long lastClaimStatusCheck = 0;
static unsigned long lastNvsVerification = 0;  // Track last NVS claim status verification (periodic)
static bool mqttOtaInProgress = false;
static bool mqttReallyConnected = false;  // Track actual MQTT connection state
static unsigned long lastMqttActivity = 0;  // Track last successful MQTT operation
static bool fsUploadStarted = false;  // Track if LittleFS upload started (prevents crash checking Update.hasError() on uninitialized object)
static bool fwUploadStarted = false;  // Track if firmware upload started
static String mqttOtaType = "";  // "firmware" or "filesystem"
static size_t mqttOtaTotalBytes = 0;
static size_t mqttOtaWrittenBytes = 0;
static String mqttOtaSha256 = "";
static int mqttOtaLastProgress = -1;

// Version tracking (persisted across OTA updates)
Preferences versionPrefs;
static String currentFirmwareVersion = FIRMWARE_VERSION;
static String currentFilesystemVersion = FILESYSTEM_VERSION;
static unsigned long firmwareUpdateTimestamp = 0;     // Unix timestamp of last firmware update
static unsigned long filesystemUpdateTimestamp = 0;   // Unix timestamp of last filesystem update

// Device Claim & MQTT Credentials (persisted in Preferences)
Preferences devicePrefs;
static bool deviceClaimed = false;
static String claimedDeviceId = "";
static String claimedTenantId = "";
static String claimedMqttClientId = "";
static String claimedMqttUsername = "";
static String claimedMqttPassword = "";
static String claimedMqttBroker = MQTT_BROKER;
String claimedDeviceName = "";  // Non-static to allow extern declaration in debug_dashboard.h

// Captive Portal WiFi Credentials (persisted in Preferences)
static bool isAPMode = false;
static bool standaloneMode = false;  // Skip captive portal DNS when true
static String savedSSID = "";
static String savedPassword = "";

// Pending Setup from Captive Portal (processed in loop())
static bool pendingSetup = false;
static unsigned long pendingSetupTime = 0;
static String pendingSetupSSID = "";
static String pendingSetupPassword = "";
static String pendingSetupEmail = "";
static String pendingSetupAccountPassword = "";
static String pendingSetupDeviceName = "";
static bool pendingSetupIsNewAccount = true;  // true = create account, false = sign in

// Last setup attempt result (persisted to NVS for display after reboot)
typedef struct {
  bool attempted;      // Was a setup attempt made?
  bool success;        // Did it succeed?
  String errorCode;    // Error code (e.g., "invalid_credentials", "wifi_failed")
  String errorMessage; // Human-readable error message
} SetupResult;

// Forward declarations
void saveSetupResult(bool success, const String& errorCode, const String& errorMessage);
SetupResult loadSetupResult();
void clearSetupResult();

// Setup progress tracking (for real-time SPA updates via APSTA mode)
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

// Cached WiFi scan results for captive portal
struct CachedNetwork {
  String ssid;
  int rssi;
  int channel;  // WiFi channel for AP optimization
};
static std::vector<CachedNetwork> cachedNetworks;
static bool wifiScanInProgress = false;
static unsigned long lastScanTime = 0;

// Perform WiFi scan and cache results (call from loop when in AP mode)
void performWiFiScan() {
  // Auto-retry scan every 10 seconds if no networks cached
  if (!wifiScanInProgress && cachedNetworks.empty() && (millis() - lastScanTime > 10000)) {
    Serial.println("[WIFI-SCAN] No cached networks, retrying scan...");
    startWiFiScan();
    return;
  }

  if (wifiScanInProgress) {
    int result = WiFi.scanComplete();
    if (result >= 0) {
      // Scan complete, process results
      cachedNetworks.clear();
      for (int i = 0; i < result; i++) {
        String ssid = WiFi.SSID(i);
        if (ssid.length() > 0) {
          // Check for duplicate and keep strongest
          bool found = false;
          for (auto& net : cachedNetworks) {
            if (net.ssid == ssid) {
              found = true;
              if (WiFi.RSSI(i) > net.rssi) net.rssi = WiFi.RSSI(i);
              break;
            }
          }
          if (!found) {
            cachedNetworks.push_back({ssid, WiFi.RSSI(i)});
          }
        }
      }
      // Sort by signal strength
      std::sort(cachedNetworks.begin(), cachedNetworks.end(),
        [](const CachedNetwork& a, const CachedNetwork& b) { return a.rssi > b.rssi; });

      WiFi.scanDelete();
      wifiScanInProgress = false;
      lastScanTime = millis();
      Serial.printf("[WIFI-SCAN] Cached %d networks\n", cachedNetworks.size());
    } else if (result == WIFI_SCAN_FAILED) {
      Serial.println("[WIFI-SCAN] Scan failed, will retry");
      wifiScanInProgress = false;
      lastScanTime = millis();  // Will retry after 10s
    }
    // WIFI_SCAN_RUNNING (-1) means still scanning, just wait
  }
}

void startWiFiScan() {
  if (wifiScanInProgress) return;
  wifiScanInProgress = true;

  Serial.println("[WIFI-SCAN] Starting robust scan sequence...");
  addSystemLog("[WIFI-SCAN] Starting scan...");

  // Brief delay to let WiFi hardware settle
  delay(500);

  int n = -1;

  // Try multiple approaches with increasing aggressiveness
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
        // NOTE: AP restoration is handled after the loop below
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

    String macSuffix = g_macUpper.length() > 5 ? g_macUpper.substring(g_macUpper.length() - 5) : "0000";
    macSuffix.replace(":", "");
    String apName = "MouseTrap-" + macSuffix;

    // Configure AP IP before starting
    IPAddress apIP(192, 168, 4, 1);
    IPAddress gateway(192, 168, 4, 1);
    IPAddress subnet(255, 255, 255, 0);
    WiFi.softAPConfig(apIP, gateway, subnet);

    bool apStarted = WiFi.softAP(apName.c_str());
    if (apStarted) {
      Serial.printf("[WIFI-SCAN] AP restored: %s @ %s\n", apName.c_str(), WiFi.softAPIP().toString().c_str());
    } else {
      Serial.println("[WIFI-SCAN] WARNING: Failed to restore AP!");
      addSystemLog("[WIFI-SCAN] WARNING: AP restoration failed!");
    }
  }

  if (n > 0) {
    cachedNetworks.clear();
    for (int i = 0; i < n; i++) {
      String ssid = WiFi.SSID(i);
      if (ssid.length() > 0) {
        bool found = false;
        for (auto& net : cachedNetworks) {
          if (net.ssid == ssid) {
            found = true;
            if (WiFi.RSSI(i) > net.rssi) net.rssi = WiFi.RSSI(i);
            break;
          }
        }
        if (!found) {
          cachedNetworks.push_back({ssid, WiFi.RSSI(i)});
        }
      }
    }
    std::sort(cachedNetworks.begin(), cachedNetworks.end(),
      [](const CachedNetwork& a, const CachedNetwork& b) { return a.rssi > b.rssi; });
    Serial.printf("[WIFI-SCAN] Cached %d unique networks\n", cachedNetworks.size());
    addSystemLog("[WIFI-SCAN] Found " + String(cachedNetworks.size()) + " networks");
  } else {
    Serial.println("[WIFI-SCAN] All attempts failed");
    addSystemLog("[WIFI-SCAN] FAILED - no networks found");
  }

  WiFi.scanDelete();
  lastScanTime = millis();
  wifiScanInProgress = false;
}

// WebSocket tunnel functions removed - using MQTT instead

// API endpoint handlers (keep these - used by local web server)
static void tunnel_sendFileFromFS(const char* id, const String& pathIn) {
  String path = pathIn;
  if (path.endsWith("/")) path += "index.html";
  if (!LittleFS.exists(path)) {
    wsSendStart(id, 404, F("text/plain; charset=utf-8"), false);
    const String m = "not found: " + path;
    wsSendChunkText(id, m.c_str(), m.length());
    wsSendEnd(id);
    return;
  }
  File f = LittleFS.open(path, "r");
  if (!f) {
    wsSendStart(id, 500, F("text/plain; charset=utf-8"), false);
    wsSendChunkText(id, "open failed", 11);
    wsSendEnd(id);
    return;
  }
  const String ctype = guessContentType(path);
  const bool isText =
      ctype.startsWith("text/") ||
      ctype.indexOf("json") >= 0 ||
      ctype.indexOf("xml") >= 0 ||
      ctype.indexOf("javascript") >= 0 ||
      ctype.indexOf("svg") >= 0;
  wsSendStart(id, 200, ctype, !isText);
  uint8_t buf[2048];
  while (true) {
    size_t n = f.read(buf, sizeof(buf));
    if (n == 0) break;
    if (isText) wsSendChunkText(id, (const char*)buf, n);
    else        wsSendChunkBase64(id, buf, n);
  }
  f.close();
  wsSendEnd(id);
}

// Small utility to send complete text response
static void tunnel_sendText(const char* id, int status, const String& ctype, const String& body) {
  wsSendStart(id, status, ctype, false);
  wsSendChunkText(id, body.c_str(), body.length());
  wsSendEnd(id);
}

// Minimal status JSON (only safe WiFi fields)
static void tunnel_sendStatusJson(const char* id) {
  String j = "{";
  j += "\"mac\":\"" + WiFi.macAddress() + "\"";
  j += ",\"lan\":\"" + WiFi.localIP().toString() + "\"";
  j += ",\"rssi\":" + String(WiFi.RSSI());
  j += "}";
  tunnel_sendText(id, 200, F("application/json; charset=utf-8"), j);
}



// === NEW: home page (uses your existing menu helper) ===
// If your current "/" is built elsewhere, you can duplicate the exact body here.
// This version is minimal but styled by your global CSS if you keep /style.css in LittleFS.
// REPLACE ENTIRE FUNCTION
// REPLACE ENTIRE FUNCTION
static void tunnel_sendHomeHtml(const char* id) {
  // Minimal standalone page; IMPORTANT: links are RELATIVE (no leading slash)
  String html;
  html.reserve(2048);
  String displayName = (claimedDeviceName.length() > 0) ? claimedDeviceName : "MouseTrap";
  html += F("<!doctype html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>");
  html += displayName;
  html += F("</title>"
            "<style>body{background:#111;color:#ddd;font:14px system-ui;margin:0;padding:16px}"
            "a{color:#9fdcff;text-decoration:none} a:hover{text-decoration:underline}</style>"
            "</head><body>");
  html += "<h1>" + displayName + "</h1>";
  html += F("<p>This page is served over the WS tunnel (direct handling; no self-HTTP).</p>"
            "<ul>"
            "<li><a href='status'>Status JSON</a></li>"
            "<li><a href='data'>Data JSON (alias)</a></li>"
            "<li><a href='captures/'>Captures directory (LittleFS)</a></li>"
            "</ul>"
            "<p>Device: ");
  html += WiFi.macAddress();
  html += F(" &middot; ");
  html += WiFi.localIP().toString();
  html += F("</p></body></html>");

  tunnel_sendText(id, 200, F("text/html; charset=utf-8"), html);
}


// NEW: directory listing when a folder has no index.html
// REPLACE ENTIRE FUNCTION
static void tunnel_sendFsDirListing(const char* id, const String& dirPathIn) {
  String dirPath = dirPathIn;
  if (!dirPath.endsWith("/")) dirPath += "/";

  File dir = LittleFS.open(dirPath, "r");
  if (!dir || !dir.isDirectory()) {
    wsSendStart(id, 404, F("text/plain; charset=utf-8"), false);
    const String m = "not a directory: " + dirPath;
    wsSendChunkText(id, m.c_str(), m.length());
    wsSendEnd(id);
    if (dir) dir.close();
    return;
  }

  String html;
  html.reserve(4096);
  html += F("<!doctype html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Index of ");
  html += dirPath;
  html += F("</title>"
            "<style>body{background:#111;color:#ddd;font:14px system-ui;margin:0;padding:16px}"
            "a{color:#9fdcff;text-decoration:none} a:hover{text-decoration:underline}"
            "ul{list-style:none;padding:0;margin:0} li{padding:6px 0;border-bottom:1px solid #222}"
            "h2{margin:0 0 12px 0}</style></head><body><h2>Index of ");
  html += dirPath;
  html += F("</h2><ul>");

  // Parent link (relative "../") if not root
  if (dirPath.length() > 1) {
    html += F("<li><a href='../'>../</a></li>");
  }

  // Iterate entries
  while (true) {
    File entry = dir.openNextFile();
    if (!entry) break;
    const bool isDir = entry.isDirectory();
    String full = String(entry.name()); // absolute FS path
    entry.close();

    // Show name relative to current directory (no leading '/')
    String show = full;
    if (show.startsWith(dirPath)) show.remove(0, dirPath.length());

    // RELATIVE href: do NOT prefix with dirPath or leading '/'
    html += F("<li><a href='");
    html += show;
    if (isDir && !show.endsWith("/")) html += "/";
    html += F("'>");
    html += show;
    if (isDir && !show.endsWith("/")) html += "/";
    html += F("</a></li>");
  }
  dir.close();

  html += F("</ul></body></html>");
  tunnel_sendText(id, 200, F("text/html; charset=utf-8"), html);
}

static void wsSendStart(const char* id, int status, const String& contentType, bool base64Mode) {
  JsonDocument d;
  d["type"] = "httpRespStart";
  d["id"] = id;
  d["status"] = status;
  d["headers"]["Content-Type"] = contentType;
  if (base64Mode) d["headers"]["x-tunnel-base64"] = "1";
  wsSendJson(d);
}

static void wsSendChunkBase64(const char* id, const uint8_t* data, size_t n) {
  JsonDocument d;
  d["type"] = "httpRespChunk";
  d["id"]   = id;
  d["bodyBase64"] = b64Enc(data, n);
  wsSendJson(d);
}

static void wsSendChunkText(const char* id, const char* data, size_t n) {
  String chunk; chunk.reserve(n);
  for (size_t i=0;i<n;i++) chunk += (char)data[i];
  JsonDocument d;
  d["type"] = "httpRespChunk";
  d["id"]   = id;
  d["body"] = chunk;
  wsSendJson(d);
}

static void wsSendEnd(const char* id) {
  JsonDocument d;
  d["type"] = "httpRespEnd";
  d["id"] = id;
  wsSendJson(d);
}



// REPLACE: no self-HTTP; direct handling via FS & small dynamic endpoints
static void tunnel_handleHttpReqFromServer(const JsonDocument& m) {
  const char* id     = m["id"]     | "";
  const char* method = m["method"] | "GET";
  const char* path   = m["path"]   | "/";

  // Concurrency guard
  const uint32_t now = millis();
  if (g_tunnelBusy && (int32_t)(now - g_tunnelBusyUntilMs) < 0) {
    wsSendStart(id, 423, F("text/plain; charset=utf-8"), false);
    wsSendChunkText(id, "busy", 4);
    wsSendEnd(id);
    return;
  }
  g_tunnelBusy = true;
  g_tunnelBusyUntilMs = now + TUNNEL_MAX_HANDLE_MS;

  String p = String(path);
  if (p.isEmpty()) p = "/";

  bool isGet  = (strcasecmp(method, "GET")  == 0);
  bool isHead = (strcasecmp(method, "HEAD") == 0);
  bool isPost = (strcasecmp(method, "POST") == 0);

  // --- Dynamic JSON endpoints your UI likely uses early ---
  if (isGet && (p == "/status" || p == "/data")) {
    tunnel_sendStatusJson(id);                  // uses only WiFi.* fields; safe everywhere
    g_tunnelBusy = false;
    return;
  }

  // --- Files & directories from LittleFS (preserve styling/assets/UI) ---
  if (isGet || isHead) {
    // If it's a directory (ends with "/"), prefer index.html if present
    if (p.endsWith("/")) {
      if (LittleFS.exists(p + "index.html")) {
        tunnel_sendFileFromFS(id, p + "index.html");
        g_tunnelBusy = false;
        return;
      }
      // If no index.html, fall back to a simple directory listing
      tunnel_sendFsDirListing(id, p);
      g_tunnelBusy = false;
      return;
    }

    // If it's a concrete file path, serve it directly
    if (LittleFS.exists(p)) {
      tunnel_sendFileFromFS(id, p);
      g_tunnelBusy = false;
      return;
    }

    // Special case: plain "/" → try "/index.html" in FS
    if (p == "/") {
      if (LittleFS.exists("/index.html")) {
        tunnel_sendFileFromFS(id, "/index.html");
        g_tunnelBusy = false;
        return;
      }
      // nothing found → fallback minimal page so user sees something
      tunnel_sendHomeHtml(id);                  // keep as last resort only
      g_tunnelBusy = false;
      return;
    }
  }

  // Method not supported or unknown path
  if (!isGet && !isHead) {
    wsSendStart(id, 405, F("text/plain; charset=utf-8"), false);
    wsSendChunkText(id, "method not allowed", 19);
    wsSendEnd(id);
    g_tunnelBusy = false;
    return;
  }

  // 404 for everything else
  String msg = "not found: " + p;
  wsSendStart(id, 404, F("text/plain; charset=utf-8"), false);
  wsSendChunkText(id, msg.c_str(), msg.length());
  wsSendEnd(id);
  g_tunnelBusy = false;
}

static void handleApiCaptures(AsyncWebServerRequest* req) {
  AsyncResponseStream *res = req->beginResponseStream("application/json; charset=utf-8");
  res->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res->print("{\"files\":[");
  bool first = true;

  File dir = LittleFS.open("/captures", "r");
  if (dir && dir.isDirectory()) {
    while (true) {
      File f = dir.openNextFile();
      if (!f) break;
      if (f.isDirectory()) { f.close(); continue; }
      String full = String(f.name());
      String name = full;
      int slash = name.lastIndexOf('/'); if (slash >= 0) name = name.substring(slash + 1);
      String kind = "other";
      int dot = name.lastIndexOf('.'); if (dot >= 0) {
        String ext = name.substring(dot + 1); ext.toLowerCase();
        if (ext == "jpg" || ext == "jpeg" || ext == "png") kind = "image";
        else if (ext == "mjpg" || ext == "mjpeg") kind = "video";
      }
      if (!first) res->print(",");
      first = false;
      res->print("{\"name\":\"");
      for (size_t i = 0; i < name.length(); ++i) { char c = name[i]; if (c=='\\' || c=='\"') res->print('\\'); res->print(c); }
      res->print("\",\"size\":"); res->print(f.size());
      res->print(",\"kind\":\""); res->print(kind); res->print("\"}");
      f.close();
    }
    dir.close();
  }
  res->print("]}");
  req->send(res);
}

// Send /app/index.html with a debug tag so curl -i can identify the responder
static void sendSpaIndex(AsyncWebServerRequest* req, const char* tag) {
  AsyncWebServerResponse* r = req->beginResponse(LittleFS, "/app/index.html", "text/html");
  r->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  r->addHeader("X-Handler", tag);
  req->send(r);
}

// static void sendSpaIndex(AsyncWebServerRequest* req, const char* tag) {
//   AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//   res->addHeader("X-Handler", tag); // for curl -i debugging
//   req->send(res);
// }

// ===== LittleFS browser (read-only) for recovery =====

// Minimal JSON string escaper for filenames
static void jsonEscapePrint(AsyncResponseStream *res, const String &s) {
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s[i];
    if (c == '\\' || c == '\"') { res->print('\\'); res->print(c); }
    else if (c == '\n') res->print("\\n");
    else if (c == '\r') res->print("\\r");
    else if (c == '\t') res->print("\\t");
    else res->print(c);
  }
}

static void listDirRecursive(const String &dirPath,
                             AsyncResponseStream *res,
                             bool &first) {
  File dir = LittleFS.open(dirPath, "r");
  if (!dir || !dir.isDirectory()) { if (dir) dir.close(); return; }

  while (true) {
    File f = dir.openNextFile();
    if (!f) break;

    String full = String(f.name());  // e.g. "/app/assets/index-xxx.js"
    if (f.isDirectory()) {
      f.close();
      listDirRecursive(full, res, first);
      continue;
    }

    // Only allow files under /app
    if (!full.startsWith("/app/")) { f.close(); continue; }

    // Emit JSON record
    if (!first) res->print(",");
    first = false;
    res->print("{\"path\":\"");
    jsonEscapePrint(res, full);
    res->print("\",\"size\":");
    res->print(f.size());
    res->print("}");

    f.close();
  }
  dir.close();
}

// Read-only file lister with ArduinoJson v7 APIs (no deprecation warnings)
#include <ArduinoJson.h>

static void handleFsList(AsyncWebServerRequest* req) {
  // Normalize input
  String p = "/";
  if (req->hasParam("p")) p = req->getParam("p")->value();
  if (p.isEmpty()) p = "/";
  while (p.length() > 1 && p.endsWith("/")) p.remove(p.length() - 1);

  // Open directory (try with/without trailing slash)
  File dir = LittleFS.open(p);
  if (!dir || !dir.isDirectory()) {
    dir = LittleFS.open(p + "/");
  }

  JsonDocument doc;                // v7: no capacity template needed
  JsonArray files = doc["files"].to<JsonArray>();  // v7: nested array

  if (dir && dir.isDirectory()) {
    for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
      JsonObject o = files.add<JsonObject>();      // v7: create object entry
      String name = String(f.name());

      // Show basename relative to the listed folder
      if (name.startsWith(p)) name.remove(0, p.length());
      if (name.startsWith("/")) name.remove(0, 1);

      o["name"] = name;
      if (f.isDirectory()) {
        o["size"] = 0;
        o["kind"] = "dir";
      } else {
        o["size"] = (uint32_t)f.size();
        o["kind"] = "file";
      }
    }
  }

  String out;
  serializeJson(doc, out);         // v7: unchanged
  req->send(200, "application/json; charset=utf-8", out);
}


static String guessMime(const String &p) {
  String q = p; q.toLowerCase();
  if (q.endsWith(".html")) return "text/html";
  if (q.endsWith(".htm"))  return "text/html";
  if (q.endsWith(".js"))   return "application/javascript";
  if (q.endsWith(".css"))  return "text/css";
  if (q.endsWith(".svg"))  return "image/svg+xml";
  if (q.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

static void handleFsGet(AsyncWebServerRequest *req) {
  // e.g. /fs/get?p=/app/index.html
  if (!req->hasParam("p")) return req->send(400, "text/plain", "missing p");
  String p = req->getParam("p")->value();
  if (!p.startsWith("/app/")) return req->send(403, "text/plain", "path not allowed");
  if (!LittleFS.exists(p))    return req->send(404, "text/plain", "not found");

  // Stream the file; set Content-Disposition so browser downloads if you want
  auto *res = req->beginResponse(LittleFS, p, guessMime(p));
  String name = p.substring(p.lastIndexOf('/') + 1);
  res->addHeader("Cache-Control", "no-store");
  // comment out the next line if you prefer viewing in-browser
  res->addHeader("Content-Disposition", "attachment; filename=\"" + name + "\"");
  req->send(res);
}




// --- BEGIN PATCH: ChatGPT.ino ---
// Read-only calibration snapshot for SPA; no dependency on globals or order.
#include <Preferences.h>   // (safe to include multiple times)

static void handleApiCalib(AsyncWebServerRequest* req) {
  Preferences prefs;                  // local instance (no global needed)
  prefs.begin("settings", true);      // readOnly = true

  const int calibOff      = prefs.getInt("calibOff", 0);
  const int falseOff      = prefs.getInt("falseOff", 0);
  const int overrideTh    = prefs.getInt("overrideTh", 0);

  prefs.end();

  String j = "{";
  j += "\"threshold\":" + String(threshold) + ",";
  j += "\"calibrationOffset\":" + String(calibOff) + ",";
  j += "\"falseOff\":"           + String(falseOff) + ",";
  j += "\"overrideThreshold\":"  + String(overrideTh);

  // Optional: include a published snapshot if you have one
  // extern volatile int g_threshold_snapshot;
  // j += ",\"threshold\":" + String(g_threshold_snapshot);

  j += "}";
  req->send(200, "application/json; charset=utf-8", j);
}
// --- END PATCH: ChatGPT.ino ---




// --- BEGIN PATCH: ChatGPT.ino ---

static void tunnel_handleOtaCtrl(const JsonDocument& m){
  const char* cmd = m["command"] | "";
  const char* id  = m["id"]      | "";

  // Firmware OTA
  if (strcmp(cmd,"ota")==0){
  #if defined(ARDUINO_ESP32_RELEASE_3_0_0)
    bool ok = Update.begin();
  #else
    bool ok = Update.begin(UPDATE_SIZE_UNKNOWN);
  #endif
    if (!ok){
      JsonDocument r; r["id"]=id; r["ok"]=false; r["msg"]="firmware begin failed"; wsSendJson(r);
      Serial.println(F("[OTA] firmware begin failed"));
      g_otaActive=false; g_otaId=""; return;
    }
    g_otaActive=true; g_otaId=id;
    Serial.println(F("[OTA] firmware started"));
    return;
  }

  if (strcmp(cmd,"ota_end")==0){
    bool ok = g_otaActive ? Update.end(true) : false;
    JsonDocument r; r["id"]= g_otaId.length()? g_otaId.c_str(): id; r["ok"]=ok; r["reboot"]=ok; r["msg"]= ok?"firmware ok":"firmware end failed";
    wsSendJson(r);
    g_otaActive=false; g_otaId="";
    Serial.println(ok ? F("[OTA] firmware end OK") : F("[OTA] firmware end failed"));
    if (ok){ delay(500); ESP.restart(); }
    return;
  }

  // Filesystem OTA
  if (strcmp(cmd,"ota_fs")==0){
  #if defined(ARDUINO_ESP32_RELEASE_3_0_0)
    bool ok = Update.begin(UPDATE_SIZE_UNKNOWN, U_SPIFFS);
  #else
    bool ok = Update.begin(UPDATE_SIZE_UNKNOWN, U_SPIFFS);
  #endif
    if (!ok){
      JsonDocument r; r["id"]=id; r["ok"]=false; r["msg"]="filesystem begin failed"; wsSendJson(r);
      Serial.println(F("[OTA] filesystem begin failed"));
      g_otaActive=false; g_otaId=""; return;
    }
    g_otaActive=true; g_otaId=id;
    Serial.println(F("[OTA] filesystem started"));
    addSystemLog("WebSocket filesystem OTA started");
    return;
  }

  if (strcmp(cmd,"ota_fs_end")==0){
    bool ok = g_otaActive ? Update.end(true) : false;
    JsonDocument r; r["id"]= g_otaId.length()? g_otaId.c_str(): id; r["ok"]=ok; r["reboot"]=ok; r["msg"]= ok?"filesystem ok":"filesystem end failed";
    wsSendJson(r);
    g_otaActive=false; g_otaId="";
    Serial.println(ok ? F("[OTA] filesystem end OK") : F("[OTA] filesystem end failed"));
    if (ok){
      addSystemLog("WebSocket filesystem OTA complete, rebooting...");
      delay(500);
      ESP.restart();
    }
    return;
  }
}
// --- END PATCH: ChatGPT.ino ---



static void ws_tunnel_connect(){
  // REMOVED - using MQTT instead
  /*
  g_macUpper = WiFi.macAddress(); g_macUpper.toUpperCase();
  String url  = "/ws/devices?mac=" + g_macUpper;
  const char* host = WS_HOST;
  const bool useTLS = (WS_USE_TLS != 0);

  if (useTLS) g_ws.beginSSL(host, 443, url.c_str());
  else        g_ws.begin(host, 80,  url.c_str());

  g_ws.setReconnectInterval(5000);
  g_ws.enableHeartbeat(15000, 3000, 2);

  g_ws.onEvent([](WStype_t t, uint8_t* payload, size_t len) {
    switch (t) {
      case WStype_CONNECTED:
        Serial.println(F("[WS] connected"));
        break;
      case WStype_DISCONNECTED:
        Serial.println(F("[WS] disconnected"));
        break;
      case WStype_TEXT: {
        if (len == 0) return;
        String s((char*)payload, len);
        JsonDocument m;
        if (deserializeJson(m, s)) { Serial.println(F("[WS] bad JSON")); return; }

        // Accept typed httpReq and OTA command
        if (m["type"].is<const char*>() && strcmp(m["type"], "httpReq")==0 &&
            m["method"].is<const char*>() && m["path"].is<const char*>() && m["id"].is<const char*>()) {
          tunnel_handleHttpReqFromServer(m);
          return;
        }
        if (m["command"].is<const char*>()) {
          tunnel_handleOtaCtrl(m);
          return;
        }
        // Unknown payload — ignore quietly
        Serial.println(F("[WS] unknown payload; ignoring"));
        return;
      }
      case WStype_BIN: {
        if (!g_otaActive || len == 0) return;
        Update.write(payload, len);
        break;
      }
      default: break;
    }
  });
  */
}





void ws_tunnel_setup(){
  // Call this once after WiFi is connected
  ws_tunnel_connect();
}

void ws_tunnel_loop(){
  // Call this in your main loop
  // g_ws.loop();  // REMOVED - using MQTT instead
}

//End websocket tunnel

// ============================================================================
// MQTT Fleet Management & OTA
// ============================================================================

// ============================================================================
// Device Claim Code Provisioning
// ============================================================================

// Load claimed credentials from Preferences
void loadClaimedCredentials() {
  devicePrefs.begin("device", true);  // read-only
  deviceClaimed = devicePrefs.getBool("claimed", false);

  if (deviceClaimed) {
    claimedDeviceId = devicePrefs.getString("deviceId", "");
    claimedTenantId = devicePrefs.getString("tenantId", "");
    claimedMqttClientId = devicePrefs.getString("mqttClientId", "");
    claimedMqttUsername = devicePrefs.getString("mqttUsername", "");
    claimedMqttPassword = devicePrefs.getString("mqttPassword", "");
    claimedMqttBroker = devicePrefs.getString("mqttBroker", MQTT_BROKER);
    claimedDeviceName = devicePrefs.getString("deviceName", "Unclaimed Device");

    Serial.println("[CLAIM] Device credentials loaded from Preferences");
    Serial.println("[CLAIM] Verifying claim status with server...");

    // Verify with server (need WiFi first, so we'll do this in setup after WiFi connects)
    addSystemLog("[CLAIM] Device is claimed: " + claimedDeviceName);
  } else {
    Serial.println("[CLAIM] Device not claimed - provisioning required");
    addSystemLog("[CLAIM] Device not claimed - awaiting provisioning");
  }

  devicePrefs.end();
}

// Save claimed credentials to Preferences
void saveClaimedCredentials(const String& deviceId, const String& tenantId,
                            const String& mqttClientId, const String& mqttUsername,
                            const String& mqttPassword, const String& mqttBroker,
                            const String& deviceName) {
  devicePrefs.begin("device", false);  // read-write

  devicePrefs.putBool("claimed", true);
  devicePrefs.putString("deviceId", deviceId);
  devicePrefs.putString("tenantId", tenantId);
  devicePrefs.putString("mqttClientId", mqttClientId);
  devicePrefs.putString("mqttUsername", mqttUsername);
  devicePrefs.putString("mqttPassword", mqttPassword);
  devicePrefs.putString("mqttBroker", mqttBroker);
  devicePrefs.putString("deviceName", deviceName);

  devicePrefs.end();

  loadClaimedCredentials();  // Reload into memory

  // Restart mDNS with new hostname (e.g., kitchen.mousetrap.local)
  Serial.println("[CLAIM] Restarting mDNS with device-specific hostname...");
  MDNS.end();
  startMdnsService();

  // Reinitialize MQTT with new credentials
  if (mqttClient.connected()) mqttClient.disconnect();
  mqttSetup();

  Serial.println("[CLAIM] Credentials saved to Preferences");
  addSystemLog("[CLAIM] Device claimed successfully: " + deviceName);
}

// Clear claimed credentials (for re-provisioning)
void clearClaimedCredentials() {
  Serial.println("[CLAIM] ========================================");
  Serial.println("[CLAIM] CLEARING CLAIMED CREDENTIALS FROM NVS");
  Serial.println("[CLAIM] ========================================");
  Serial.printf("[CLAIM] Before clear - NVS state:\n");
  Serial.printf("[CLAIM]   - deviceClaimed: %s\n", deviceClaimed ? "true" : "false");
  Serial.printf("[CLAIM]   - claimedDeviceId: %s\n", claimedDeviceId.c_str());
  Serial.printf("[CLAIM]   - claimedDeviceName: %s\n", claimedDeviceName.c_str());
  Serial.printf("[CLAIM]   - claimedMqttClientId: %s\n", claimedMqttClientId.c_str());
  Serial.printf("[CLAIM]   - claimedMqttUsername: %s\n", claimedMqttUsername.c_str());
  Serial.printf("[CLAIM]   - claimedMqttBroker: %s\n", claimedMqttBroker.c_str());

  Serial.println("[CLAIM] Opening NVS 'device' namespace for clearing...");
  devicePrefs.begin("device", false);

  Serial.println("[CLAIM] Calling devicePrefs.clear() to erase all keys...");
  devicePrefs.clear();

  Serial.println("[CLAIM] Closing NVS namespace...");
  devicePrefs.end();

  Serial.println("[CLAIM] Resetting in-memory credential variables...");
  deviceClaimed = false;
  claimedDeviceId = "";
  claimedTenantId = "";
  claimedMqttClientId = "";
  claimedMqttUsername = "";
  claimedMqttPassword = "";
  claimedMqttBroker = MQTT_BROKER;
  claimedDeviceName = "";

  Serial.println("[CLAIM] ========================================");
  Serial.println("[CLAIM] ✓ Device credentials cleared from NVS");
  Serial.println("[CLAIM] ========================================");
  Serial.printf("[CLAIM] After clear - all variables reset:\n");
  Serial.printf("[CLAIM]   - deviceClaimed: %s\n", deviceClaimed ? "true" : "false");
  Serial.printf("[CLAIM]   - claimedDeviceId: %s\n", claimedDeviceId.c_str());
  Serial.printf("[CLAIM]   - claimedDeviceName: %s\n", claimedDeviceName.c_str());

  addSystemLog("[CLAIM] Device credentials cleared from NVS - ready for re-provisioning");
}

// Perform device claim via HTTP POST to claim server
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
  deviceInfo["hardwareVersion"] = "ESP32-CAM-V1.0";
  deviceInfo["macAddress"] = g_macUpper;
  deviceInfo["firmwareVersion"] = currentFirmwareVersion;
  deviceInfo["filesystemVersion"] = currentFilesystemVersion;

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

      String deviceId = data["deviceId"].as<String>();
      String tenantId = data["tenantId"].as<String>();
      String mqttClientId = data["mqttClientId"].as<String>();
      String mqttUsername = data["mqttUsername"].as<String>();
      String mqttPassword = data["mqttPassword"].as<String>();
      String mqttBroker = data["mqttBrokerUrl"].as<String>();
      String deviceName = data["deviceName"].as<String>();

      // Remove mqtt:// prefix if present
      mqttBroker.replace("mqtt://", "");
      mqttBroker.replace(":1883", "");

      saveClaimedCredentials(deviceId, tenantId, mqttClientId, mqttUsername,
                            mqttPassword, mqttBroker, deviceName);

      Serial.println("[CLAIM] Device claimed successfully!");
      addSystemLog("[CLAIM] Device claimed: " + deviceName);

      http.end();
      return true;
    } else {
      Serial.println("[CLAIM] Claim failed - invalid response");
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

// Verify revocation token with server
// Returns true only if server confirms the token is valid
// Returns false on ANY error (network, timeout, invalid token) - device stays claimed
bool verifyRevocationToken(const char* token) {
  Serial.println("[REVOKE-VERIFY] ========================================");
  Serial.println("[REVOKE-VERIFY] Verifying revocation token with server...");
  Serial.println("[REVOKE-VERIFY] ========================================");

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[REVOKE-VERIFY] WiFi not connected - rejecting revocation");
    Serial.println("[REVOKE-VERIFY] Result: FALSE (device stays claimed)");
    return false;
  }

  HTTPClient http;
  String url = String(CLAIM_SERVER_URL) + "/api/device/verify-revocation";

  Serial.printf("[REVOKE-VERIFY] Request URL: %s\n", url.c_str());
  Serial.printf("[REVOKE-VERIFY] MAC Address: %s\n", g_macUpper.c_str());
  Serial.printf("[REVOKE-VERIFY] Token: %.16s...\n", token);

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);  // 10 second timeout

  // Build request payload
  JsonDocument doc;
  doc["mac"] = g_macUpper;
  doc["token"] = token;

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[REVOKE-VERIFY] Sending POST request...\n");
  int httpCode = http.POST(payload);
  Serial.printf("[REVOKE-VERIFY] HTTP Response Code: %d\n", httpCode);

  if (httpCode == 200) {
    String response = http.getString();
    Serial.printf("[REVOKE-VERIFY] Response payload: %s\n", response.c_str());

    JsonDocument responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);

    if (error) {
      Serial.printf("[REVOKE-VERIFY] JSON parse error: %s\n", error.c_str());
      Serial.println("[REVOKE-VERIFY] Result: FALSE (device stays claimed)");
      http.end();
      return false;
    }

    bool valid = responseDoc["valid"] | false;

    if (valid) {
      Serial.println("[REVOKE-VERIFY] ========================================");
      Serial.println("[REVOKE-VERIFY] SERVER CONFIRMED TOKEN IS VALID");
      Serial.println("[REVOKE-VERIFY] Result: TRUE (proceed with unclaim)");
      Serial.println("[REVOKE-VERIFY] ========================================");
      http.end();
      return true;
    } else {
      const char* reason = responseDoc["reason"] | "unknown";
      Serial.printf("[REVOKE-VERIFY] Server rejected token: %s\n", reason);
      Serial.println("[REVOKE-VERIFY] Result: FALSE (device stays claimed)");
      http.end();
      return false;
    }
  } else if (httpCode < 0) {
    Serial.printf("[REVOKE-VERIFY] Network error: %s\n", http.errorToString(httpCode).c_str());
    Serial.println("[REVOKE-VERIFY] Result: FALSE (device stays claimed)");
    http.end();
    return false;
  } else {
    Serial.printf("[REVOKE-VERIFY] Unexpected HTTP code: %d\n", httpCode);
    Serial.println("[REVOKE-VERIFY] Result: FALSE (device stays claimed)");
    http.end();
    return false;
  }
}

// Check claim status with server (unauthenticated endpoint)
// Returns ClaimVerificationResult to distinguish between network errors and explicit revocation
ClaimVerificationResult checkClaimStatusWithServer() {
  Serial.println("[CLAIM-VERIFY] ========================================");
  Serial.println("[CLAIM-VERIFY] Checking claim status with server...");
  Serial.println("[CLAIM-VERIFY] ========================================");

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[CLAIM-VERIFY] WiFi not connected - treating as network error");
    Serial.println("[CLAIM-VERIFY] Result: NETWORK_ERROR (device stays claimed)");
    return NETWORK_ERROR;
  }

  HTTPClient http;
  String url = String(CLAIM_SERVER_URL) + "/api/device/claim-status?mac=" + g_macUpper;

  Serial.printf("[CLAIM-VERIFY] Request URL: %s\n", url.c_str());
  Serial.printf("[CLAIM-VERIFY] MAC Address: %s\n", g_macUpper.c_str());

  http.begin(url);
  http.setTimeout(10000);  // 10 second timeout (increased for network stability)

  int httpCode = http.GET();
  Serial.printf("[CLAIM-VERIFY] HTTP Response Code: %d\n", httpCode);

  if (httpCode == 200) {
    String response = http.getString();
    Serial.printf("[CLAIM-VERIFY] Response payload: %s\n", response.c_str());

    JsonDocument responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);

    if (error) {
      Serial.printf("[CLAIM-VERIFY] JSON parse error: %s\n", error.c_str());
      Serial.println("[CLAIM-VERIFY] Treating parse error as network issue");
      http.end();
      return NETWORK_ERROR;
    }

    bool claimed = responseDoc["claimed"] | false;

    if (claimed) {
      Serial.println("[CLAIM-VERIFY] ========================================");
      Serial.println("[CLAIM-VERIFY] SUCCESS: Server confirms device is claimed");
      Serial.println("[CLAIM-VERIFY] Result: CLAIM_VERIFIED");
      Serial.println("[CLAIM-VERIFY] ========================================");
      http.end();
      return CLAIM_VERIFIED;
    } else {
      Serial.println("[CLAIM-VERIFY] ========================================");
      Serial.println("[CLAIM-VERIFY] REVOCATION: Server says device is explicitly revoked");
      Serial.println("[CLAIM-VERIFY] Server returned: {\"claimed\": false}");
      Serial.println("[CLAIM-VERIFY] Result: EXPLICITLY_REVOKED");
      Serial.println("[CLAIM-VERIFY] ========================================");
      http.end();
      return EXPLICITLY_REVOKED;
    }
  } else if (httpCode == 410) {
    // HTTP 410 Gone - device has been explicitly revoked
    Serial.println("[CLAIM-VERIFY] ========================================");
    Serial.println("[CLAIM-VERIFY] REVOCATION: HTTP 410 Gone received");
    Serial.println("[CLAIM-VERIFY] Device has been revoked by server");
    Serial.println("[CLAIM-VERIFY] Result: EXPLICITLY_REVOKED");
    Serial.println("[CLAIM-VERIFY] ========================================");
    http.end();
    return EXPLICITLY_REVOKED;
  } else if (httpCode == 404 || httpCode < 0) {
    // Network error or device not found - treat as network issue
    Serial.printf("[CLAIM-VERIFY] Network error or 404 (code: %d)\n", httpCode);
    Serial.println("[CLAIM-VERIFY] This is likely a network/connectivity issue");
    Serial.println("[CLAIM-VERIFY] Device will STAY CLAIMED and retry later");
    Serial.println("[CLAIM-VERIFY] Result: NETWORK_ERROR");
    Serial.println("[CLAIM-VERIFY] ========================================");
    http.end();
    return NETWORK_ERROR;
  } else if (httpCode >= 500 && httpCode < 600) {
    // Server error - don't unclaim on server issues
    Serial.printf("[CLAIM-VERIFY] Server error (code: %d)\n", httpCode);
    Serial.println("[CLAIM-VERIFY] Server is experiencing issues");
    Serial.println("[CLAIM-VERIFY] Device will STAY CLAIMED and retry later");
    Serial.println("[CLAIM-VERIFY] Result: SERVER_ERROR");
    Serial.println("[CLAIM-VERIFY] ========================================");
    http.end();
    return SERVER_ERROR;
  } else {
    // Other HTTP errors - treat as network issue to be safe
    Serial.printf("[CLAIM-VERIFY] Unexpected HTTP code: %d\n", httpCode);
    Serial.println("[CLAIM-VERIFY] Treating as network issue to be safe");
    Serial.println("[CLAIM-VERIFY] Result: NETWORK_ERROR");
    Serial.println("[CLAIM-VERIFY] ========================================");
    http.end();
    return NETWORK_ERROR;
  }
}

// Unclaim device with source tracking (clears credentials and disconnects)
// source: 'factory_reset', 'local_ui', 'mqtt_revoke', 'claim_verify', 'unknown'
void unclaimDeviceWithSource(const char* source) {
  // ============================================================================
  // COMPREHENSIVE UNCLAIM LOGGING - Track why device is being unclaimed
  // ============================================================================
  Serial.println("[UNCLAIM] ========================================");
  Serial.println("[UNCLAIM] DEVICE UNCLAIM INITIATED");
  Serial.println("[UNCLAIM] ========================================");
  Serial.printf("[UNCLAIM] Source: %s\n", source);
  Serial.printf("[UNCLAIM] Timestamp: %lu ms\n", millis());
  Serial.printf("[UNCLAIM] Current device state:\n");
  Serial.printf("[UNCLAIM]   - deviceClaimed: %s\n", deviceClaimed ? "true" : "false");
  Serial.printf("[UNCLAIM]   - claimedDeviceId: %s\n", claimedDeviceId.c_str());
  Serial.printf("[UNCLAIM]   - claimedDeviceName: %s\n", claimedDeviceName.c_str());
  Serial.printf("[UNCLAIM]   - claimedTenantId: %s\n", claimedTenantId.c_str());
  Serial.printf("[UNCLAIM]   - claimedMqttClientId: %s\n", claimedMqttClientId.c_str());
  Serial.printf("[UNCLAIM]   - MQTT connected: %s\n", mqttClient.connected() ? "true" : "false");
  Serial.printf("[UNCLAIM]   - WiFi connected: %s\n", WiFi.status() == WL_CONNECTED ? "true" : "false");
  Serial.printf("[UNCLAIM]   - Free heap: %u bytes\n", ESP.getFreeHeap());

  // Add to system log for persistence
  addSystemLog("[UNCLAIM] Device unclaim initiated - Source: " + String(source) + ", MAC: " + g_macUpper);
  addSystemLog("[UNCLAIM] Device was: " + claimedDeviceName + " (ID: " + claimedDeviceId + ")");

  // Notify server if we're online (include source for audit logging)
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[UNCLAIM] Notifying server...");

    HTTPClient http;
    String url = String(CLAIM_SERVER_URL) + "/api/device/unclaim-notify";

    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);

    // Build request payload with source for audit trail
    JsonDocument doc;
    doc["mac"] = g_macUpper;
    doc["source"] = source;  // Tell server why unclaim happened

    String payload;
    serializeJson(doc, payload);

    Serial.printf("[UNCLAIM] Sending: %s\n", payload.c_str());
    int httpCode = http.POST(payload);

    if (httpCode == 200) {
      Serial.println("[UNCLAIM] Server notified successfully");
      addSystemLog("[UNCLAIM] Server notified of unclaim");
    } else {
      Serial.printf("[UNCLAIM] Server notification failed (HTTP %d) - device will retry on next boot\n", httpCode);
      addSystemLog("[UNCLAIM] Server notification failed - HTTP " + String(httpCode));
    }

    http.end();
  } else {
    Serial.println("[UNCLAIM] Offline - server will be notified when device reconnects");
    addSystemLog("[UNCLAIM] Offline - server notification deferred");
  }

  // Disconnect MQTT
  if (mqttClient.connected()) {
    Serial.println("[UNCLAIM] Disconnecting MQTT...");
    mqttClient.disconnect();
  }

  // Clear credentials
  Serial.println("[UNCLAIM] About to clear credentials from NVS...");
  clearClaimedCredentials();
  Serial.println("[UNCLAIM] Credentials cleared from NVS");

  // Restart mDNS with generic hostname (mousetrap.local)
  Serial.println("[UNCLAIM] Restarting mDNS with generic hostname...");
  MDNS.end();
  startMdnsService();

  // Reinitialize MQTT setup
  mqttSetup();

  Serial.println("[UNCLAIM] ========================================");
  Serial.println("[UNCLAIM] Device unclaimed successfully");
  Serial.println("[UNCLAIM] ========================================");
  addSystemLog("[UNCLAIM] Device unclaimed successfully - ready for re-provisioning");
}

// Unclaim device (legacy wrapper - uses 'unknown' source)
void unclaimDevice() {
  unclaimDeviceWithSource("unknown");
}

// ============================================================================
// HMAC-SHA256 Token Generation for Secure Device Claiming
// ============================================================================

// Note: ClaimCredentials struct is defined at the top of the file
// (required for Arduino preprocessor to generate correct function prototypes)

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

  // Clean up
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

// Generate complete claim credentials (token, timestamp, mac)
ClaimCredentials generateClaimCredentials() {
  ClaimCredentials creds;

  // Get MAC address (uppercase, with colons)
  creds.mac = WiFi.macAddress();
  creds.mac.toUpperCase();

  // Get current Unix timestamp
  time_t now = time(nullptr);

  // Ensure time is valid (synced via NTP)
  if (now < 1700000000) {  // Sanity check: timestamp should be after Nov 2023
    Serial.println("[CLAIM-TOKEN] WARNING: System time not synced, using 0 as timestamp");
    now = 0;
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

// Register and claim device in one step using HMAC token authentication
// This eliminates the need for manual claim codes
bool registerAndClaimDevice(const String& email, const String& password, const String& deviceName, bool isNewAccount = true) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[REGISTER-CLAIM] WiFi not connected");
    return false;
  }

  // Check if already claimed
  if (deviceClaimed) {
    Serial.println("[REGISTER-CLAIM] Device already claimed - must unclaim first");
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

  // DEBUG: Log network state before HTTP call
  Serial.println("[REGISTER-CLAIM] === DEBUG: Network State ===");
  Serial.printf("[REGISTER-CLAIM] WiFi.status() = %d\n", WiFi.status());
  Serial.printf("[REGISTER-CLAIM] WiFi.localIP() = %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("[REGISTER-CLAIM] WiFi.gatewayIP() = %s\n", WiFi.gatewayIP().toString().c_str());
  Serial.printf("[REGISTER-CLAIM] WiFi.subnetMask() = %s\n", WiFi.subnetMask().toString().c_str());
  Serial.printf("[REGISTER-CLAIM] WiFi.dnsIP() = %s\n", WiFi.dnsIP().toString().c_str());
  Serial.printf("[REGISTER-CLAIM] WiFi.RSSI() = %d dBm\n", WiFi.RSSI());

  // DEBUG: Try DNS resolution of server IP (even though it's an IP, this tests network stack)
  IPAddress serverIP;
  if (WiFi.hostByName("192.168.133.110", serverIP)) {
    Serial.printf("[REGISTER-CLAIM] DNS/IP lookup success: %s\n", serverIP.toString().c_str());
  } else {
    Serial.println("[REGISTER-CLAIM] WARNING: DNS/IP lookup failed!");
  }

  // DEBUG: Log free heap before HTTP
  Serial.printf("[REGISTER-CLAIM] Free heap before HTTP: %d bytes\n", ESP.getFreeHeap());
  Serial.println("[REGISTER-CLAIM] === END DEBUG ===");

  addSystemLog("[REGISTER-CLAIM] Attempting HTTP to: " + url);

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);  // 15 second timeout
  http.setConnectTimeout(10000);  // 10 second connect timeout

  // Build request payload
  JsonDocument doc;
  doc["mac"] = creds.mac;
  doc["claimToken"] = creds.token;
  doc["timestamp"] = creds.timestamp;
  doc["email"] = email;
  doc["password"] = password;
  doc["deviceName"] = deviceName;
  doc["isNewAccount"] = isNewAccount;

  // Add device info
  JsonObject deviceInfo = doc["deviceInfo"].to<JsonObject>();
  deviceInfo["hardwareVersion"] = "ESP32-CAM-V1.0";
  deviceInfo["firmwareVersion"] = currentFirmwareVersion;
  deviceInfo["filesystemVersion"] = currentFilesystemVersion;

  String payload;
  serializeJson(doc, payload);

  // Log payload without password
  Serial.printf("[REGISTER-CLAIM] Payload (password hidden): mac=%s, token=%s..., timestamp=%s, email=%s, deviceName=%s\n",
                creds.mac.c_str(), creds.token.substring(0, 16).c_str(),
                creds.timestamp.c_str(), email.c_str(), deviceName.c_str());
  Serial.printf("[REGISTER-CLAIM] Payload size: %d bytes\n", payload.length());

  Serial.println("[REGISTER-CLAIM] Starting HTTP POST...");
  unsigned long startTime = millis();
  int httpCode = http.POST(payload);
  unsigned long duration = millis() - startTime;

  Serial.printf("[REGISTER-CLAIM] HTTP POST completed in %lu ms\n", duration);
  Serial.printf("[REGISTER-CLAIM] HTTP Response Code: %d\n", httpCode);

  // DEBUG: Translate error codes
  if (httpCode < 0) {
    Serial.println("[REGISTER-CLAIM] === HTTP ERROR DETAILS ===");
    switch(httpCode) {
      case -1: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_CONNECTION_REFUSED (-1)"); break;
      case -2: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_SEND_HEADER_FAILED (-2)"); break;
      case -3: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_SEND_PAYLOAD_FAILED (-3)"); break;
      case -4: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_NOT_CONNECTED (-4)"); break;
      case -5: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_CONNECTION_LOST (-5)"); break;
      case -6: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_NO_STREAM (-6)"); break;
      case -7: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_NO_HTTP_SERVER (-7)"); break;
      case -8: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_TOO_LESS_RAM (-8)"); break;
      case -9: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_ENCODING (-9)"); break;
      case -10: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_STREAM_WRITE (-10)"); break;
      case -11: Serial.println("[REGISTER-CLAIM] ERROR: HTTPC_ERROR_READ_TIMEOUT (-11)"); break;
      default: Serial.printf("[REGISTER-CLAIM] ERROR: Unknown code %d\n", httpCode); break;
    }
    Serial.printf("[REGISTER-CLAIM] WiFi still connected: %s\n", WiFi.status() == WL_CONNECTED ? "YES" : "NO");
    Serial.printf("[REGISTER-CLAIM] Free heap after error: %d bytes\n", ESP.getFreeHeap());
    addSystemLog("[REGISTER-CLAIM] HTTP error code: " + String(httpCode));
    Serial.println("[REGISTER-CLAIM] === END ERROR DETAILS ===");
  }

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
      // Server returns data at top level for firmware compatibility
      // deviceId, tenantId at top level, mqttCredentials.username/password
      String deviceId = responseDoc["deviceId"].as<String>();
      String tenantId = responseDoc["tenantId"].as<String>();
      String mqttClientId = responseDoc["mqttClientId"].as<String>();
      String mqttBroker = responseDoc["mqttBroker"].as<String>();

      // MQTT credentials nested under mqttCredentials object
      JsonObject mqttCreds = responseDoc["mqttCredentials"];
      String mqttUsername = mqttCreds["username"].as<String>();
      String mqttPassword = mqttCreds["password"].as<String>();

      // deviceName from data.device or just use what we sent
      String respDeviceName = deviceName;

      // Remove mqtt:// prefix if present
      mqttBroker.replace("mqtt://", "");
      mqttBroker.replace(":1883", "");

      // Save credentials to NVS
      saveClaimedCredentials(deviceId, tenantId, mqttClientId, mqttUsername,
                            mqttPassword, mqttBroker, respDeviceName);

      Serial.println("[REGISTER-CLAIM] ========================================");
      Serial.println("[REGISTER-CLAIM] Device registered and claimed successfully!");
      Serial.println("[REGISTER-CLAIM] ========================================");
      Serial.printf("[REGISTER-CLAIM]   Device ID: %s\n", deviceId.c_str());
      Serial.printf("[REGISTER-CLAIM]   Device Name: %s\n", respDeviceName.c_str());
      Serial.printf("[REGISTER-CLAIM]   Tenant ID: %s\n", tenantId.c_str());
      Serial.printf("[REGISTER-CLAIM]   MQTT Broker: %s\n", mqttBroker.c_str());

      addSystemLog("[REGISTER-CLAIM] Device registered and claimed: " + respDeviceName);

      http.end();
      return true;
    } else {
      String errorMsg = responseDoc["error"].as<String>();
      Serial.printf("[REGISTER-CLAIM] Server returned success=false: %s\n", errorMsg.c_str());
      addSystemLog("[REGISTER-CLAIM] Failed: " + errorMsg);
      http.end();
      return false;
    }
  } else if (httpCode == 400) {
    String response = http.getString();
    Serial.printf("[REGISTER-CLAIM] Bad request (400): %s\n", response.c_str());
    addSystemLog("[REGISTER-CLAIM] Bad request - check parameters");
    http.end();
    return false;
  } else if (httpCode == 401) {
    String response = http.getString();
    Serial.printf("[REGISTER-CLAIM] Unauthorized (401): %s\n", response.c_str());
    addSystemLog("[REGISTER-CLAIM] Invalid credentials or token");
    http.end();
    return false;
  } else if (httpCode == 409) {
    String response = http.getString();
    Serial.printf("[REGISTER-CLAIM] Conflict (409): %s\n", response.c_str());
    addSystemLog("[REGISTER-CLAIM] Email already registered or device already claimed");
    http.end();
    return false;
  } else {
    Serial.printf("[REGISTER-CLAIM] HTTP error %d: %s\n", httpCode, http.getString().c_str());
    addSystemLog("[REGISTER-CLAIM] Failed - HTTP " + String(httpCode));
    http.end();
    return false;
  }
}

// ============================================================================
// WiFi Credential Management (for Captive Portal)
// ============================================================================

// Load WiFi credentials from Preferences
void loadWiFiCredentials() {
  devicePrefs.begin("wifi", true);  // read-only
  savedSSID = devicePrefs.getString("ssid", "");
  savedPassword = devicePrefs.getString("password", "");
  standaloneMode = devicePrefs.getBool("standalone", false);
  devicePrefs.end();

  if (savedSSID.length() > 0) {
    Serial.println("[WIFI] Loaded saved WiFi credentials");
  } else {
    Serial.println("[WIFI] No saved WiFi credentials found");
  }
  if (standaloneMode) {
    Serial.println("[WIFI] Standalone mode enabled");
  }
}

// Save WiFi credentials to Preferences
void saveWiFiCredentials(const String& newSSID, const String& newPassword) {
  devicePrefs.begin("wifi", false);  // read-write
  devicePrefs.putString("ssid", newSSID);
  devicePrefs.putString("password", newPassword);
  devicePrefs.end();

  savedSSID = newSSID;
  savedPassword = newPassword;

  Serial.println("[WIFI] WiFi credentials saved");
  addSystemLog("[WIFI] WiFi credentials saved: " + newSSID);
}

// ============================================================================
// MQTT Helper Functions
// ============================================================================

// Publish MQTT message helper
void mqttPublish(const char* topic, const char* payload, bool retained = false) {
  if (mqttClient.connected()) {
    mqttClient.publish(topic, payload, retained);
    Serial.printf("[MQTT] Published to %s: %s\n", topic, payload);
  }
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

// Publish OTA progress to cloud
void publishOtaProgress(const char* status, int progress, const char* error = nullptr) {
  if (!mqttClient.connected() || !deviceClaimed) return;

  char topic[256];
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/ota/progress",
           claimedTenantId.c_str(), claimedMqttClientId.c_str());

  JsonDocument doc;
  doc["type"] = mqttOtaType;
  doc["status"] = status;
  doc["progress"] = progress;
  doc["bytes_downloaded"] = mqttOtaWrittenBytes;
  doc["total_bytes"] = mqttOtaTotalBytes;
  if (error) doc["error"] = error;

  String payload;
  serializeJson(doc, payload);
  mqttPublish(topic, payload.c_str());

  mqttOtaLastProgress = progress;
}

// Publish device status (online, versions, etc.)
void publishDeviceStatus() {
  if (!mqttClient.connected() || !deviceClaimed) return;

  char topic[256];
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/status",
           claimedTenantId.c_str(), claimedMqttClientId.c_str());

  JsonDocument doc;
  doc["online"] = true;
  doc["device_name"] = claimedDeviceName;
  doc["firmware_version"] = currentFirmwareVersion;
  doc["filesystem_version"] = currentFilesystemVersion;
  doc["uptime"] = millis() / 1000;
  doc["heap_free"] = ESP.getFreeHeap();
  doc["rssi"] = WiFi.RSSI();
  doc["ip"] = WiFi.localIP().toString();

  String payload;
  serializeJson(doc, payload);

  Serial.printf("[MQTT] Publishing status to: %s\n", topic);
  Serial.printf("[MQTT] Payload: %s\n", payload.c_str());

  mqttPublish(topic, payload.c_str(), true);  // Retained
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
  DEBUG_SNAPSHOT("ota_update_begin");
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

  Serial.printf("[OTA] MQTT payload - version: '%s', url: '%s'\n", version ? version : "NULL", url ? url : "NULL");

  if (!version || !url) {
    Serial.println("[OTA] Invalid update message");
    return;
  }

  // Compare versions
  const char* currentVersion = (mqttOtaType == "firmware") ? currentFirmwareVersion.c_str() : currentFilesystemVersion.c_str();
  if (strcmp(version, currentVersion) <= 0) {
    Serial.printf("[OTA] Already up to date: %s (current: %s)\n", version, currentVersion);
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

// Forward declarations for variables and functions used in mqttCallback
extern bool detectionState;
extern time_t lastAlertTime;
extern time_t lastEmailTime;
void alertFunction();
bool captureSingleFrame(const String &fullPath, bool flash);

// Capture and upload a single snapshot via MQTT without triggering alarm
void captureAndUploadSnapshot() {
  Serial.println("[Snapshot] Starting silent snapshot capture");
  addSystemLog("[Snapshot] Capturing single image");

  // Generate unique filename with timestamp
  time_t now = time(nullptr);
  String filename = "/snapshot_" + String(now) + ".jpg";

  // Capture single frame (with flash)
  bool captureSuccess = captureSingleFrame(filename, true);

  if (!captureSuccess) {
    Serial.println("[Snapshot] Failed to capture image");
    addSystemLog("[Snapshot] Capture FAILED");
    return;
  }

  Serial.printf("[Snapshot] Image captured: %s\n", filename.c_str());
  addSystemLog("[Snapshot] Image captured successfully");

  // Read the captured image from LittleFS
  if (!LittleFS.exists(filename)) {
    Serial.println("[Snapshot] File not found after capture");
    addSystemLog("[Snapshot] File not found");
    return;
  }

  File imgFile = LittleFS.open(filename, "r");
  if (!imgFile) {
    Serial.println("[Snapshot] Failed to open image file");
    addSystemLog("[Snapshot] Failed to open file");
    return;
  }

  size_t fileSize = imgFile.size();
  Serial.printf("[Snapshot] Image size: %d bytes\n", fileSize);

  // Limit to ~200KB to avoid memory issues
  if (fileSize == 0 || fileSize > 200000) {
    Serial.printf("[Snapshot] Invalid file size: %d\n", fileSize);
    addSystemLog("[Snapshot] Invalid file size");
    imgFile.close();
    return;
  }

  // Allocate memory for image data
  uint8_t* imgData = (uint8_t*)malloc(fileSize);
  if (!imgData) {
    Serial.println("[Snapshot] Memory allocation failed");
    addSystemLog("[Snapshot] Out of memory");
    imgFile.close();
    return;
  }

  // Read image data
  size_t bytesRead = imgFile.read(imgData, fileSize);
  imgFile.close();

  if (bytesRead != fileSize) {
    Serial.printf("[Snapshot] Read error: %d / %d bytes\n", bytesRead, fileSize);
    addSystemLog("[Snapshot] File read error");
    free(imgData);
    return;
  }

  Serial.println("[Snapshot] Encoding image to base64...");

  // Base64 encode the image
  String base64Image = b64Enc(imgData, fileSize);
  free(imgData);  // Free memory immediately after encoding

  if (base64Image.length() == 0) {
    Serial.println("[Snapshot] Base64 encoding failed");
    addSystemLog("[Snapshot] Encoding FAILED");
    return;
  }

  Serial.printf("[Snapshot] Base64 encoded: %d bytes\n", base64Image.length());

  // Build MQTT topic: tenant/{tenantId}/device/{MAC}/camera/snapshot
  String snapshotTopic = "tenant/" + claimedTenantId + "/device/" +
                         claimedMqttClientId + "/camera/snapshot";

  // Build JSON payload
  JsonDocument snapshotDoc;
  snapshotDoc["timestamp"] = now;
  snapshotDoc["filename"] = filename.substring(filename.lastIndexOf('/') + 1);
  snapshotDoc["size"] = fileSize;
  snapshotDoc["image"] = base64Image;

  String snapshotPayload;
  serializeJson(snapshotDoc, snapshotPayload);

  // Publish to MQTT broker
  Serial.printf("[Snapshot] Publishing to: %s\n", snapshotTopic.c_str());
  addSystemLog("[Snapshot] Uploading via MQTT");

  bool published = mqttClient.publish(snapshotTopic.c_str(), snapshotPayload.c_str());

  if (published) {
    Serial.println("[Snapshot] Successfully uploaded to broker");
    addSystemLog("[Snapshot] Upload SUCCESS");
  } else {
    Serial.println("[Snapshot] Failed to publish to broker");
    addSystemLog("[Snapshot] Upload FAILED");
  }

  // Clean up: delete the temporary snapshot file
  LittleFS.remove(filename);
  Serial.printf("[Snapshot] Cleaned up temporary file: %s\n", filename.c_str());
}

// MQTT message callback
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("[MQTT] Message on %s\n", topic);

  // Update connection tracking - we received a message, so we're definitely connected
  mqttReallyConnected = true;
  lastMqttActivity = millis();

  // Parse JSON payload
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[MQTT] JSON parse error: %s\n", error.c_str());
    return;
  }

  // Handle firmware update
  if (strstr(topic, "/firmware/latest")) {
    mqttOtaType = "firmware";
    handleOtaNotification(doc);
    return;
  }

  // Handle filesystem update
  if (strstr(topic, "/filesystem/latest")) {
    mqttOtaType = "filesystem";
    handleOtaNotification(doc);
    return;
  }

  // Handle device revocation - REQUIRES TOKEN VERIFICATION
  if (strstr(topic, "/revoke")) {
    // Ignore empty retained "clear" messages (payload is null or empty)
    // These are published when a device is claimed to clear old revoke messages
    if (length == 0 || doc.isNull() || (length == 4 && memcmp(payload, "null", 4) == 0)) {
      // Silently ignore - this is normal for claimed devices
      return;
    }

    Serial.println("[MQTT-REVOKE] ========================================");
    Serial.println("[MQTT-REVOKE] REVOCATION COMMAND RECEIVED FROM SERVER");
    Serial.println("[MQTT-REVOKE] ========================================");
    Serial.printf("[MQTT-REVOKE] Topic: %s\n", topic);

    // Extract token from the revocation message
    const char* token = doc["token"];
    const char* action = doc["action"];

    if (!token || strlen(token) == 0) {
      Serial.println("[MQTT-REVOKE] REJECTED: No token in revocation message");
      Serial.println("[MQTT-REVOKE] Device will NOT unclaim without valid token");
      addSystemLog("[MQTT-REVOKE] Rejected revocation - missing token");
      return;
    }

    if (!action || strcmp(action, "revoke") != 0) {
      Serial.println("[MQTT-REVOKE] REJECTED: Invalid action in revocation message");
      addSystemLog("[MQTT-REVOKE] Rejected revocation - invalid action");
      return;
    }

    Serial.printf("[MQTT-REVOKE] Token received: %.16s...\n", token);
    Serial.println("[MQTT-REVOKE] Verifying token with server...");
    addSystemLog("[MQTT-REVOKE] Verifying revocation token with server...");

    // Verify the token with the server before unclaiming
    if (verifyRevocationToken(token)) {
      Serial.println("[MQTT-REVOKE] ========================================");
      Serial.println("[MQTT-REVOKE] TOKEN VERIFIED - Proceeding with unclaim");
      Serial.println("[MQTT-REVOKE] ========================================");
      addSystemLog("[MQTT-REVOKE] Token verified - unclaiming device");
      unclaimDeviceWithSource("mqtt_revoke");
    } else {
      Serial.println("[MQTT-REVOKE] ========================================");
      Serial.println("[MQTT-REVOKE] TOKEN VERIFICATION FAILED");
      Serial.println("[MQTT-REVOKE] Device will STAY CLAIMED");
      Serial.println("[MQTT-REVOKE] ========================================");
      addSystemLog("[MQTT-REVOKE] Token verification failed - staying claimed");
    }
    return;
  }

  // Handle commands
  if (strstr(topic, "/command/")) {
    const char* cmd = doc["command"];
    if (cmd) {
      Serial.printf("[MQTT] Command: %s\n", cmd);
      addSystemLog(String("[MQTT] Command received: ") + cmd);

      if (strcmp(cmd, "reboot") == 0) {
        ESP.restart();
      } else if (strcmp(cmd, "status") == 0) {
        publishDeviceStatus();
      } else if (strcmp(cmd, "clear_versions") == 0) {
        versionPrefs.begin("versions", false);
        versionPrefs.clear();
        versionPrefs.end();
        Serial.println("[MQTT] Cleared version preferences");
        addSystemLog("[MQTT] Cleared version preferences, rebooting...");
        delay(1000);
        ESP.restart();
      } else if (strcmp(cmd, "alert_reset") == 0) {
        // Clear alert state (same as physical button press)
        detectionState = false;
        lastAlertTime = 0;
        lastEmailTime = time(nullptr) - 3600;
        Serial.println("[MQTT] Alert cleared via server command");
        addSystemLog("[MQTT] Alert cleared via server command");

        // Publish confirmation back to server
        char topic[256];
        snprintf(topic, sizeof(topic), "tenant/%s/device/%s/alert_cleared",
                 claimedTenantId.c_str(), claimedMqttClientId.c_str());

        JsonDocument alertDoc;
        alertDoc["status"] = "cleared";
        alertDoc["timestamp"] = time(nullptr);

        String alertPayload;
        serializeJson(alertDoc, alertPayload);

        mqttClient.publish(topic, alertPayload.c_str());
        Serial.println("[MQTT] Published alert_cleared confirmation");
      } else if (strcmp(cmd, "capture_snapshot") == 0) {
        // Capture and send snapshot without triggering alarm
        Serial.println("[MQTT] Snapshot capture requested via server command");
        addSystemLog("[MQTT] Capturing snapshot via server command");
        captureAndUploadSnapshot();
      } else if (strcmp(cmd, "update_tenant") == 0) {
        // Update tenant credentials - used when moving device between tenants
        Serial.println("[MQTT-TENANT] ========================================");
        Serial.println("[MQTT-TENANT] TENANT UPDATE COMMAND RECEIVED");
        Serial.println("[MQTT-TENANT] ========================================");

        const char* newTenantId = doc["tenantId"];
        const char* newDeviceId = doc["deviceId"];
        const char* newDeviceName = doc["deviceName"];
        const char* moveId = doc["moveId"];  // Track the move operation

        if (newTenantId && newDeviceId) {
          Serial.printf("[MQTT-TENANT] Updating tenant from %s to %s\n",
                        claimedTenantId.c_str(), newTenantId);
          Serial.printf("[MQTT-TENANT] New device name: %s\n", newDeviceName ? newDeviceName : "(unchanged)");
          addSystemLog("[MQTT-TENANT] Updating tenant credentials");

          // Store old tenant for confirmation message
          String oldTenantId = claimedTenantId;

          // Update credentials in memory
          claimedTenantId = String(newTenantId);
          claimedDeviceId = String(newDeviceId);
          if (newDeviceName) claimedDeviceName = String(newDeviceName);

          // Persist to preferences using devicePrefs (same as saveClaimedCredentials)
          devicePrefs.begin("device", false);
          devicePrefs.putString("tenantId", claimedTenantId);
          devicePrefs.putString("deviceId", claimedDeviceId);
          devicePrefs.putString("deviceName", claimedDeviceName);
          devicePrefs.end();

          Serial.println("[MQTT-TENANT] Credentials saved to NVS");
          addSystemLog("[MQTT-TENANT] Tenant credentials saved, reconnecting...");

          // Disconnect and reconnect with new tenant
          mqttClient.disconnect();
          mqttReallyConnected = false;
          lastMqttReconnect = 0;  // Force immediate reconnect

          // The device will automatically reconnect with new credentials
          // and subscribe to new tenant's topics

          Serial.println("[MQTT-TENANT] ========================================");
          Serial.printf("[MQTT-TENANT] Tenant move complete: %s -> %s\n",
                        oldTenantId.c_str(), claimedTenantId.c_str());
          Serial.println("[MQTT-TENANT] Device will reconnect with new credentials");
          Serial.println("[MQTT-TENANT] ========================================");

          // Note: Confirmation will be sent after reconnecting to new tenant
          // via the regular status publish mechanism
        } else {
          Serial.println("[MQTT-TENANT] ERROR: Missing required fields (tenantId, deviceId)");
          addSystemLog("[MQTT-TENANT] ERROR: Invalid update_tenant command - missing fields");
        }
      } else if (strcmp(cmd, "rotate_credentials") == 0) {
        // Rotate MQTT credentials - ACK-based rotation for Dynamic Security
        // CRITICAL: Must publish ACK BEFORE disconnecting so server knows to update broker
        Serial.println("[MQTT-ROTATE] ========================================");
        Serial.println("[MQTT-ROTATE] CREDENTIAL ROTATION COMMAND RECEIVED");
        Serial.println("[MQTT-ROTATE] ========================================");

        const char* newPassword = doc["password"];
        const char* rotationId = doc["rotationId"];  // Track the rotation operation

        if (newPassword && strlen(newPassword) > 0) {
          Serial.printf("[MQTT-ROTATE] Rotation ID: %s\n", rotationId ? rotationId : "none");
          Serial.println("[MQTT-ROTATE] Updating MQTT password...");
          addSystemLog("[MQTT-ROTATE] Updating MQTT credentials");

          // Store old tenant/topic info for ACK
          String oldTenantId = claimedTenantId;
          String oldClientId = claimedMqttClientId;

          // Update password in memory
          claimedMqttPassword = String(newPassword);

          // Persist to NVS FIRST - this is critical!
          devicePrefs.begin("device", false);
          devicePrefs.putString("mqttPassword", claimedMqttPassword);
          devicePrefs.end();

          Serial.println("[MQTT-ROTATE] New credentials saved to NVS");
          addSystemLog("[MQTT-ROTATE] Credentials saved to NVS");

          // CRITICAL: Publish ACK BEFORE disconnecting
          // Server waits for this ACK before updating broker credentials
          if (rotationId && strlen(rotationId) > 0) {
            char ackTopic[256];
            snprintf(ackTopic, sizeof(ackTopic), "tenant/%s/device/%s/rotation_ack",
                     oldTenantId.c_str(), oldClientId.c_str());

            StaticJsonDocument<256> ackDoc;
            ackDoc["rotationId"] = rotationId;
            ackDoc["success"] = true;
            String ackPayload;
            serializeJson(ackDoc, ackPayload);

            Serial.printf("[MQTT-ROTATE] Publishing ACK to %s\n", ackTopic);
            bool ackSent = mqttClient.publish(ackTopic, ackPayload.c_str());

            // Process the MQTT client loop to ensure ACK is sent
            mqttClient.loop();
            delay(100);  // Small delay to ensure message is transmitted
            mqttClient.loop();

            if (ackSent) {
              Serial.println("[MQTT-ROTATE] ACK published successfully");
              addSystemLog("[MQTT-ROTATE] ACK sent, waiting for broker update...");
            } else {
              Serial.println("[MQTT-ROTATE] WARNING: Failed to publish ACK");
              addSystemLog("[MQTT-ROTATE] WARNING: ACK publish failed");
            }
          } else {
            Serial.println("[MQTT-ROTATE] WARNING: No rotationId - cannot send ACK");
            addSystemLog("[MQTT-ROTATE] WARNING: No rotationId provided");
          }

          // Now disconnect - server should have received ACK and updated broker
          Serial.println("[MQTT-ROTATE] Disconnecting to reconnect with new credentials...");
          mqttClient.disconnect();
          mqttReallyConnected = false;
          lastMqttReconnect = 0;  // Force immediate reconnect

          Serial.println("[MQTT-ROTATE] ========================================");
          Serial.println("[MQTT-ROTATE] Credential rotation complete");
          Serial.println("[MQTT-ROTATE] Device will reconnect with new password");
          Serial.println("[MQTT-ROTATE] ========================================");
        } else {
          Serial.println("[MQTT-ROTATE] ERROR: Missing password in rotation command");
          addSystemLog("[MQTT-ROTATE] ERROR: Invalid rotate_credentials - missing password");
        }
      }
    }
  }
}

// Connect to MQTT broker
bool mqttConnect() {
  if (mqttClient.connected()) return true;

  // Don't connect if device not claimed
  if (!deviceClaimed) {
    if (millis() - lastMqttReconnect > 30000) {  // Warn every 30 seconds
      Serial.println("[MQTT] Device not claimed - cannot connect to MQTT");
      addSystemLog("[MQTT] Device not claimed - skipping MQTT connect");
      lastMqttReconnect = millis();
    }
    return false;
  }

  // Don't retry too frequently
  if (millis() - lastMqttReconnect < 5000) return false;
  lastMqttReconnect = millis();

  // DEBUG: Log credentials state
  addSystemLog("[MQTT] Attempting connection...");
  addSystemLog("[MQTT] Broker: " + claimedMqttBroker);
  addSystemLog("[MQTT] Username: " + claimedMqttUsername);
  addSystemLog("[MQTT] Password: " + String(claimedMqttPassword.length() > 0 ? "SET" : "EMPTY"));
  addSystemLog("[MQTT] ClientId: " + claimedMqttClientId);

  // DEBUG: Test raw TCP connection first
  String broker = claimedMqttBroker;
  if (broker.startsWith("mqtt://")) broker = broker.substring(7);
  int colonPos = broker.indexOf(':');
  if (colonPos > 0) broker = broker.substring(0, colonPos);

  // Ensure the MQTT WiFiClient is in a clean state before connecting
  WiFiClient& wifiClient = getMqttWifiClient();
  if (wifiClient.connected()) {
    addSystemLog("[MQTT] WiFiClient was connected, stopping...");
    wifiClient.stop();
    delay(100);  // Give time for cleanup
  }
  wifiClient.setTimeout(15000);  // 15 second timeout (milliseconds!)

  // Don't pre-connect - let PubSubClient handle the connection
  // Just verify the broker string is clean
  addSystemLog("[MQTT] Using broker: " + broker);

  Serial.printf("[MQTT] Connecting to %s:%d...\n", claimedMqttBroker.c_str(), MQTT_PORT);

  // Use claimed client ID
  String clientId = claimedMqttClientId;

  // Last Will Testament - use claimed credentials
  char lwtTopic[256];
  snprintf(lwtTopic, sizeof(lwtTopic), "tenant/%s/device/%s/status",
           claimedTenantId.c_str(), claimedMqttClientId.c_str());
  const char* lwtPayload = "{\"online\":false}";

  // Connect with claimed credentials
  DEBUG_SNAPSHOT("mqtt_connect");
  Serial.printf("[MQTT] Connecting with clientId='%s', username='%s', password='%s'\n",
                clientId.c_str(), claimedMqttUsername.c_str(),
                claimedMqttPassword.length() > 0 ? "***SET***" : "***EMPTY***");
  bool connected = mqttClient.connect(
    clientId.c_str(),
    claimedMqttUsername.c_str(),
    claimedMqttPassword.c_str(),
    lwtTopic,
    1,      // QoS
    true,   // retain
    lwtPayload
  );

  if (!connected) {
    int rc = mqttClient.state();
    Serial.printf("[MQTT] Connect failed, rc=%d\n", rc);
    addSystemLog("[MQTT] Connect FAILED, rc=" + String(rc));
    // PubSubClient state codes:
    // -4: MQTT_CONNECTION_TIMEOUT
    // -3: MQTT_CONNECTION_LOST
    // -2: MQTT_CONNECT_FAILED
    // -1: MQTT_DISCONNECTED
    //  0: MQTT_CONNECTED
    //  1: MQTT_CONNECT_BAD_PROTOCOL
    //  2: MQTT_CONNECT_BAD_CLIENT_ID
    //  3: MQTT_CONNECT_UNAVAILABLE
    //  4: MQTT_CONNECT_BAD_CREDENTIALS
    //  5: MQTT_CONNECT_UNAUTHORIZED

    // Mark as disconnected
    mqttReallyConnected = false;

    // Check if authentication failed (rc=4: bad credentials, rc=5: not authorized)
    if (rc == 4 || rc == 5) {
      // Only check claim status once per minute to avoid crashes
      if (millis() - lastClaimStatusCheck > 60000) {
        Serial.println("[MQTT-AUTH] ========================================");
        Serial.println("[MQTT-AUTH] AUTHENTICATION FAILED - INVESTIGATING");
        Serial.println("[MQTT-AUTH] ========================================");
        Serial.printf("[MQTT-AUTH] MQTT error code: %d (%s)\n", rc,
                      rc == 4 ? "Bad credentials" : "Not authorized");
        Serial.printf("[MQTT-AUTH] Current credentials:\n");
        Serial.printf("[MQTT-AUTH]   - MQTT Username: %s\n", claimedMqttUsername.c_str());
        Serial.printf("[MQTT-AUTH]   - MQTT Client ID: %s\n", claimedMqttClientId.c_str());
        Serial.printf("[MQTT-AUTH]   - MQTT Broker: %s\n", claimedMqttBroker.c_str());
        Serial.printf("[MQTT-AUTH]   - Device ID: %s\n", claimedDeviceId.c_str());
        Serial.printf("[MQTT-AUTH]   - Device Name: %s\n", claimedDeviceName.c_str());
        Serial.println("[MQTT-AUTH] Checking claim status with server...");

        addSystemLog("[MQTT-AUTH] MQTT authentication failed (rc=" + String(rc) + ") - verifying claim status");
        lastClaimStatusCheck = millis();

        // Check with server, but don't unclaim on network errors
        ClaimVerificationResult result = checkClaimStatusWithServer();

        if (result == EXPLICITLY_REVOKED) {
          Serial.println("[MQTT-AUTH] ========================================");
          Serial.println("[MQTT-AUTH] EXPLICIT REVOCATION CONFIRMED");
          Serial.println("[MQTT-AUTH] ========================================");
          Serial.println("[MQTT-AUTH] Server confirmed device is revoked - unclaiming");
          Serial.println("[MQTT-AUTH] This was an intentional revocation, not a network issue");
          Serial.println("[MQTT-AUTH] ========================================");
          addSystemLog("[MQTT-AUTH] Server confirmed device revocation - unclaiming");
          unclaimDeviceWithSource("claim_verify");
        } else if (result == CLAIM_VERIFIED) {
          Serial.println("[MQTT-AUTH] ========================================");
          Serial.println("[MQTT-AUTH] Server confirms device is still claimed");
          Serial.println("[MQTT-AUTH] ========================================");
          Serial.println("[MQTT-AUTH] MQTT auth failed but device is still valid");
          Serial.println("[MQTT-AUTH] This is likely a credential sync issue");
          Serial.println("[MQTT-AUTH] Keeping device claimed - will retry connection");
          Serial.println("[MQTT-AUTH] ========================================");
          addSystemLog("[MQTT-AUTH] Server confirms claim - credentials may need sync, staying claimed");
        } else {
          // NETWORK_ERROR or SERVER_ERROR - stay claimed
          Serial.println("[MQTT-AUTH] ========================================");
          Serial.printf("[MQTT-AUTH] Could not verify claim status (result: %d)\n", result);
          Serial.println("[MQTT-AUTH] ========================================");
          Serial.println("[MQTT-AUTH] Auth failed but server check was inconclusive");
          Serial.println("[MQTT-AUTH] This could be a network or server issue");
          Serial.println("[MQTT-AUTH] Keeping device claimed - will retry connection");
          Serial.println("[MQTT-AUTH] Rationale:");
          Serial.println("[MQTT-AUTH]   - Network failures should not trigger unclaim");
          Serial.println("[MQTT-AUTH]   - Server errors should not trigger unclaim");
          Serial.println("[MQTT-AUTH]   - Credentials may need time to sync");
          Serial.println("[MQTT-AUTH]   - Only explicit revocation should unclaim");
          Serial.println("[MQTT-AUTH] ========================================");
          addSystemLog("[MQTT-AUTH] Auth failed but claim check inconclusive - STAYING CLAIMED");
        }
      } else {
        Serial.printf("[MQTT-AUTH] Authentication failed (rc=%d) but rate-limited (checked %lu ms ago)\n",
                      rc, millis() - lastClaimStatusCheck);
      }
    } else {
      Serial.println("[MQTT] Check network connectivity or server status");
    }

    return false;
  }

  Serial.println("[MQTT] Connected with claimed credentials!");
  Serial.printf("[MQTT] Client ID: %s\n", clientId.c_str());
  addSystemLog("[MQTT] Connected as " + claimedDeviceName);

  // Mark as really connected
  mqttReallyConnected = true;
  lastMqttActivity = millis();

  // Subscribe to topics using claimed IDs
  char topic[256];

  // Device revocation topic (highest priority - subscribe first)
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/revoke",
           claimedTenantId.c_str(), claimedMqttClientId.c_str());
  mqttClient.subscribe(topic);
  Serial.printf("[MQTT] Subscribed to revocation topic: %s\n", topic);

  // Device-specific commands
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/command/#",
           claimedTenantId.c_str(), claimedMqttClientId.c_str());
  mqttClient.subscribe(topic);
  Serial.printf("[MQTT] Subscribed to %s\n", topic);

  // OTA firmware updates
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/ota/firmware",
           claimedTenantId.c_str(), claimedMqttClientId.c_str());
  mqttClient.subscribe(topic);
  Serial.printf("[MQTT] Subscribed to %s\n", topic);

  // Tenant firmware updates
  snprintf(topic, sizeof(topic), "tenant/%s/firmware/latest", claimedTenantId.c_str());
  mqttClient.subscribe(topic);

  // Tenant filesystem updates
  snprintf(topic, sizeof(topic), "tenant/%s/filesystem/latest", claimedTenantId.c_str());
  mqttClient.subscribe(topic);

  // Global updates
  mqttClient.subscribe("global/firmware/latest");
  mqttClient.subscribe("global/filesystem/latest");

  // Publish online status
  publishDeviceStatus();

  return true;
}

// Static broker string to persist beyond mqttSetup() scope
// PubSubClient stores char* pointer, not a copy!
static char mqttBrokerDomain[64] = {0};

// MQTT setup (call in setup())
void mqttSetup() {
  // Use claimed broker if available, otherwise default
  String brokerStr = deviceClaimed ? claimedMqttBroker : String(MQTT_BROKER);

  // Strip mqtt:// prefix and :port suffix if present (defensive parsing)
  if (brokerStr.startsWith("mqtt://")) {
    brokerStr = brokerStr.substring(7);  // Remove "mqtt://"
  }
  int colonPos = brokerStr.indexOf(':');
  if (colonPos > 0) {
    brokerStr = brokerStr.substring(0, colonPos);  // Remove ":port"
  }

  // Copy to static buffer so it persists (PubSubClient only stores pointer!)
  strncpy(mqttBrokerDomain, brokerStr.c_str(), sizeof(mqttBrokerDomain) - 1);
  mqttBrokerDomain[sizeof(mqttBrokerDomain) - 1] = '\0';

  Serial.printf("[MQTT] Broker URL cleaned: '%s' -> '%s'\n",
                claimedMqttBroker.c_str(), mqttBrokerDomain);

  mqttClient.setServer(mqttBrokerDomain, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(51200);  // 50KB buffer for snapshot images (~30KB base64 + JSON)

  if (deviceClaimed) {
    Serial.printf("[MQTT] Configured for %s:%d (Claimed Device)\n", brokerStr.c_str(), MQTT_PORT);
    Serial.printf("[MQTT] Tenant: %s, Device: %s\n", claimedTenantId.c_str(), claimedDeviceName.c_str());
  } else {
    Serial.printf("[MQTT] Configured for %s:%d (UNCLAIMED - provisioning required)\n", brokerStr.c_str(), MQTT_PORT);
  }
}

// MQTT loop (call in loop())
void mqttLoop() {
  if (!mqttConnect()) {
    return;  // Not connected, will retry later
  }

  mqttClient.loop();

  // Periodically publish status (every 5 minutes)
  static unsigned long lastStatusPublish = 0;
  if (millis() - lastStatusPublish > 300000) {
    publishDeviceStatus();
    lastStatusPublish = millis();
  }
}

// End MQTT

// Note: ArRequestHandlerFunction defined later at line 3194

// ======== New Helpers for Logs & Memory ========
// ---------- Locks & flags ----------
static SemaphoreHandle_t g_syslogMux = NULL;  // protects RAM ring
static SemaphoreHandle_t g_fsMux     = NULL;  // protects LittleFS writes/rotations
static volatile bool     g_logsStreaming = false; // true while /systemLogs is streaming
static volatile bool     g_calibrating   = false; // if you already have one, reuse it
static volatile uint32_t g_lastSettingsSaveMs = 0; // set when user saves calibration

static inline void syslogLock()   { if (g_syslogMux) xSemaphoreTake(g_syslogMux, portMAX_DELAY); }
static inline void syslogUnlock() { if (g_syslogMux) xSemaphoreGive(g_syslogMux); }
static inline void fsLock()       { if (g_fsMux)     xSemaphoreTake(g_fsMux,     portMAX_DELAY); }
static inline void fsUnlock()     { if (g_fsMux)     xSemaphoreGive(g_fsMux); }

// Call once during setup()
static void initLocksOnce() {
  if (!g_syslogMux) g_syslogMux = xSemaphoreCreateMutex();
  if (!g_fsMux)     g_fsMux     = xSemaphoreCreateMutex();
}



// Consider logs "heavy" if free internal RAM is low or PSRAM is tight.
// ---------- Memory guard ----------
static inline bool isMemoryTight() {
  // Internal RAM free + largest contiguous block are strong signals
  size_t freeDRAM   = heap_caps_get_free_size(MALLOC_CAP_8BIT);
  size_t largestBlk = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  // Be conservative when either is low. Tweak thresholds if needed.
  return (freeDRAM < 40 * 1024) || (largestBlk < 12 * 1024);
}

// CrashStamp struct is declared in debug_dashboard.h, define the variable here
RTC_DATA_ATTR CrashStamp g_crashStamp;

static CrashStamp g_prevStamp;  // snapshot of previous run (RAM only)
static uint32_t g_prevReason = 0;

namespace CrashKit {
  static constexpr uint32_t MAGIC = 0xC0DEC0DE;
  static volatile bool s_pageActive = false;  // true inside PAGE_SCOPE (handlers)

  // ---- Call FIRST LINE of setup() ----
  inline void snapshotOnBoot() {
    g_prevStamp = g_crashStamp;  // copy last run's stamp
    g_prevReason = (uint32_t)esp_reset_reason();
  }

  inline void markPage(const char *page) {
    g_crashStamp.magic = MAGIC;
    strncpy(g_crashStamp.last_page, page, sizeof(g_crashStamp.last_page) - 1);
    g_crashStamp.last_page[sizeof(g_crashStamp.last_page) - 1] = 0;
    g_crashStamp.last_ms = millis();
    g_crashStamp.last_core = xPortGetCoreID();
    g_crashStamp.last_heap = ESP.getFreeHeap();
    g_crashStamp.last_biggest = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  }
  inline void markLine(uint32_t line) {
    g_crashStamp.last_line = line;
  }

  inline bool pageActive() {
    return s_pageActive;
  }

  inline const char *resetReasonToString(esp_reset_reason_t r) {
    switch (r) {
      case ESP_RST_POWERON: return "POWERON";
      case ESP_RST_BROWNOUT: return "BROWNOUT";
      case ESP_RST_INT_WDT: return "INT_WDT";
      case ESP_RST_TASK_WDT: return "TASK_WDT";
      case ESP_RST_WDT: return "WDT";
      case ESP_RST_PANIC: return "PANIC";
      case ESP_RST_SW: return "SW";
      case ESP_RST_EXT: return "EXT";
      case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
  #ifdef ESP_RST_USB
      case ESP_RST_USB: return "USB";
  #endif
      default: return "OTHER";
  }
}

using CrashKit::resetReasonToString;


// ---- Use this for boot emails; it reports the *previous* run ----
inline String makeBootCrashReport() {
  esp_reset_reason_t r = (esp_reset_reason_t)g_prevReason;
  String s = "reset=" + String((int)r) + " (" + resetReasonToString(r) + ")";
  if (g_prevStamp.magic == MAGIC) {
    s += " last_page='" + String(g_prevStamp.last_page) + "'";
    s += " core=" + String(g_prevStamp.last_core);
    s += " heap=" + String(g_prevStamp.last_heap);
    s += " biggest=" + String(g_prevStamp.last_biggest);
    s += " ms=" + String(g_prevStamp.last_ms);
    s += " line=" + String(g_prevStamp.last_line);
  } else {
    s += " last_page=''";
  }
  return s;
}
}

// RAII: stamps entry/exit of a handler so baseline code can’t overwrite it
struct PageScope {
  explicit PageScope(const char *n) {
    CrashKit::s_pageActive = true;
    CrashKit::markPage(n);
  }
  ~PageScope() {
    CrashKit::s_pageActive = false; /* keep stamp */
  }
};

// ---- Helper macros ----
#define PAGE_SCOPE(name) PageScope __page_scope__(name)
#define CRASH_MARK_LINE() CrashKit::markLine(__LINE__)
#define HEAP_SNAPSHOT(tag) Serial.printf("[heap] %s free=%u biggest=%u\n", tag, ESP.getFreeHeap(), (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT))
// ---- Standardized yields ----
#define TASK_YIELD_MS(ms) vTaskDelay(pdMS_TO_TICKS(ms))  // Use inside FreeRTOS tasks
#define NET_YIELD_EVERY(i, n) \
  do { \
    if (((i) & ((n)-1)) == 0) delay(0); \
  } while (0)  // Use in web handlers (n must be power of 2)
#define NET_YIELD() \
  do { delay(0); } while (0)  // Use in handlers when no loop counter exists



//Crash kit end

#include <Preferences.h>

// Force the servo output into a safe state whenever the flag is true
static void applyServoDisableState(const char* src) {
  // Log both value AND address to detect any accidental duplicate variable
  Serial.printf("[servo] disableServo=%d @%p (%s)\n",
                (int)disableServo, (void*)&disableServo, src);

  if (disableServo) {
    detachServo();                 // your wrapper detaches + tri-states pin
    pinMode(SERVO_PIN, INPUT);     // belt-and-suspenders
  }
}

// Read persisted value. If not present, keep compiled default.
// static void loadServoPrefEarly() {
//   Preferences p;
//   if (p.begin("trap", /*readOnly=*/true)) {
//     bool v = p.getBool("disableServo", disableServo);  // default = compiled value
//     p.end();
//     disableServo = v;
//   }
//   applyServoDisableState("boot/NVS");
// }

// Read-only load at boot. Does not write NVS.
static void loadServoPrefEarly() {
  Preferences prefs;
  bool v = true;                             // default = disabled (safe)
  if (prefs.begin("trap", /*readOnly=*/true)) {
    v = prefs.getBool("disableServo", true); // read only
    prefs.end();
  }
  disableServo = v;
  Serial.printf("[servo] disableServo=%d @%p (boot/NVS)\n", (int)disableServo, &disableServo);
}




// Break any lingering peripheral mapping quickly after servo.detach()
// (works across ESP32 Arduino 2.x/3.x without needing ledcDetachPin)
static inline void servoReleasePin(uint8_t pin) {
  pinMode(pin, INPUT);  // ensure no peripheral claims the pin
  delay(5);             // let the HAL settle
}


//New ToF Detection
// ---- Minimal I2C helpers for 16-bit addresses (VL6180X uses 16-bit regs) ----
static bool i2cWrite8(TwoWire &bus, uint8_t addr, uint16_t reg, uint8_t val) {
  bus.beginTransmission(addr);
  bus.write(uint8_t(reg >> 8));
  bus.write(uint8_t(reg & 0xFF));
  bus.write(val);
  return (bus.endTransmission() == 0);
}

static bool i2cRead8(TwoWire &bus, uint8_t addr, uint16_t reg, uint8_t &out) {
  bus.beginTransmission(addr);
  bus.write(uint8_t(reg >> 8));
  bus.write(uint8_t(reg & 0xFF));
  if (bus.endTransmission(false) != 0) return false;  // repeated START
  if (bus.requestFrom(int(addr), 1) != 1) return false;
  out = bus.read();
  return true;
}

// VL6180X: clear "Fresh Out Of Reset" (SYSTEM__FRESH_OUT_OF_RESET, 0x0016)
// Many clones sit here until you clear it. Safe to call anytime.
static void vl6180xSoftBoot(TwoWire &bus, uint8_t addr = 0x29) {
  uint8_t fr = 0;
  if (i2cRead8(bus, addr, 0x0016, fr) && fr) {
    i2cWrite8(bus, addr, 0x0016, 0x00);  // clear FRESH_OUT_OF_RESET
    delay(2);
  }
}

//End New ToF Detection

String preNTPLogBuffer;
bool ntpReady = false;

/* ───── panic traceback catcher ──────────────────────────────────── */
#include "esp_private/system_internal.h"  // backtrace routine

/* 8 bytes in RTC fast-mem survive a panic reset */
/* survives a panic reset — keep only these four */
RTC_DATA_ATTR uint32_t lastCrashPC = 0;     // faulting PC
RTC_DATA_ATTR uint32_t lastCrashRetPC = 0;  // return / next PC
RTC_DATA_ATTR uint32_t lastCrashAddr = 0;   // excvaddr (load/store)
RTC_DATA_ATTR uint32_t lastCrashCause = 0;  // exccause

static void IRAM_ATTR panicSaveFrame(XtExcFrame *f) {
  lastCrashPC = f->pc;           // where we crashed
  lastCrashRetPC = f->a0;        // return address / next PC
  lastCrashAddr = f->excvaddr;   // bad load/store address
  lastCrashCause = f->exccause;  // CPU cause code
}


static const char *causeStr(uint32_t c) {
  switch (c) {
    case 0: return "IllegalInstr";
    case 3: return "LoadStoreErr";
    case 4: return "LoadStoreAlign";
    case 5: return "LoadStorePriv";
    case 6: return "StoreProhib";
    case 9: return "InstrFetchErr";
    case 12: return "InstrFetchPriv";
    default: return "Other";
  }
}



/* ───── panic traceback catcher ──────────────────────────────────── */


static String PUBLIC_IP;

/* ---------- constants & pin selection ---------- */
//constexpr int SERVO_PIN = 48;       // free, non-camera GPIO on ESP32-S3-CAM
#define SERVO_ENABLE_PIN 14         // now using GPIO 14 to switch servo power
constexpr int SERVO_CHANNEL = 8;    // any LEDC channel 0-15 not used elsewhere
constexpr int SERVO_TIMER = 3;      // any free LEDC timer 0-3
constexpr int SERVO_MIN_US = 500;   // pulse width for 0 °
constexpr int SERVO_MAX_US = 2500;  // pulse width for 180 °
constexpr bool SERVO_ENABLED = false;

/* ------------------------------------------------------------------
 *  DEBUG: shorten the periodic re-cal timer so the bug reproduces
 *  quickly.  Default is  3600000 ms (1 h).  Use 300000 ms (5 min)
 *  while diagnosing.  Set back to 3600000 when finished.
 * ------------------------------------------------------------------*/
#define RECAL_PERIOD_MS 3600000  // 5 minutes  (use 3600000 in production)


/******************************************************************
 *  SERVO CONSTANTS  (top-of-file, right next to the attach helpers)
 ******************************************************************/
constexpr uint16_t SERVO_HOME_US = 1500;                           // 90 °
constexpr uint16_t SERVO_FIRE_US = 1000;                           // 45 ° CCW
constexpr uint16_t SERVO_REST_US = 1500;                           // back to centre
constexpr uint32_t SERVO_HOLD_MS = 400;                            // how long to keep it pulled
static const uint16_t SERVO_NEUTRAL_US = 1500;                     // your “88°” centre
static const uint16_t SERVO_KICK_US = 1100;                        // ≈45° CCW from centre
static constexpr uint32_t HEARTBEAT_PERIOD_MS = 5 * 60 * 1000UL;  // 15 minutes
static constexpr const char *HEARTBEAT_PATH = "/api/heartbeat?trap=mousetrap";

// in globals section
int overrideThreshold = 0;  // if >0, uses this value instead of calculated

TimerHandle_t reCalTimer = nullptr;  // << add this (if not already present)
volatile bool reCalFlag = false;     // set by the timer ISR/task

/* ------------------------------------------------------------------
 *  Forward declarations – the compiler must see these first
 * ------------------------------------------------------------------*/
static void sendHeartbeat();
void alertFunction();           // defined later
void setHighPowerLED(bool on);  // defined later
bool recordVideo(const String &filePath,
                 uint32_t durationMs = 10000);                      // defined later
bool captureSingleFrame(const String &fullPath, bool flash = true);  // defined later
void dumpCaptures();
String formatTime(time_t t);
String getHamburgerMenuHTML();
// Calibration & false‐alarm handlers
void handleCalibrationPage(AsyncWebServerRequest *req);
void handleSetCalibration(AsyncWebServerRequest *req);
void handleResetCalibration(AsyncWebServerRequest *req);
void handleFalseAlarm(AsyncWebServerRequest *req);
void handleRecalibrate(AsyncWebServerRequest *req);
bool recordVideoBuffered(const String &filePath, uint32_t durationMs);
void handleClearOverride(AsyncWebServerRequest *req);
struct FrameBuf;
struct VideoJob;
struct RecParams;
/* ───── flag so UI knows when a flush is running ───── */


void handleStream(AsyncWebServerRequest *);
void handleDownload(AsyncWebServerRequest *);
void handleGallery(AsyncWebServerRequest *);

static void videoFlushTask(void *pv);
static void videoRecordTask(void *pv);
void startVideoRecording(const String &filePath, uint32_t durationMs);
//startVideoRecording(String const&, unsigned long)

// Utility routines
void calibrateThreshold();
void notifyBootIP();
void notifyAlarmCleared(const char *reason);



/*-------------------------------------------------------------------*/
void addBootLog(const String &raw) {
  preNTPLogBuffer += raw + "\n";
}


void flushBootLog() {
  ntpReady = true;
  time_t now = time(nullptr);

  // Break buffer into lines
  int lineStart = 0;
  while (true) {
    int nextBreak = preNTPLogBuffer.indexOf('\n', lineStart);
    if (nextBreak < 0) break;
    String rawLine = preNTPLogBuffer.substring(lineStart, nextBreak);
    addSystemLog("[boot] " + rawLine);  // prefix or use formatTime()
    lineStart = nextBreak + 1;
  }

  preNTPLogBuffer = "";  // clear
}

// ---- Tunables --------------------------------------------------------------
static uint16_t preFlashMs   = 150;  // LED warmup for AE to settle
static uint16_t settleMs     = 40;   // after warmup, before capture
static uint16_t postOffMs    = 10;   // small delay after LED off

// ---- Simple camera lock (avoids concurrent fb_get during re-capture) -------
static SemaphoreHandle_t g_camMux = nullptr;
static inline void cameraLock() {
  if (!g_camMux) g_camMux = xSemaphoreCreateMutex();
  xSemaphoreTake(g_camMux, portMAX_DELAY);
}
static inline void cameraUnlock() {
  if (g_camMux) xSemaphoreGive(g_camMux);
}

// ---- Size-based darkness heuristic ----------------------------------------
// For JPEG @ quality≈12, bright scenes are bigger; dark scenes compress small.
// Threshold ≈ (pixels / 12), clamped to practical min/max.
static size_t jpegDarkThreshold(size_t w, size_t h) {
  size_t px = w * h;
  size_t th = px / 12;              // empirical for Q~12
  if (th < 16000)  th = 16000;      // floor for tiny frames
  if (th > 120000) th = 120000;     // cap for very large frames
  return th;
}

// ---- One shot that auto-decides to use LED, no pixformat switching ---------
static camera_fb_t* grabAutoLitJpeg(bool *usedFlashOut) {
  if (usedFlashOut) *usedFlashOut = false;

  // 1) Test shot with LED OFF
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb) debugFramebufferAllocated(fb);
  if (!fb) return nullptr;

  size_t threshold = jpegDarkThreshold(fb->width, fb->height);
  threshold = threshold - 12000;
  bool tooDark = (fb->len < threshold);
  addSystemLog("Checking light level...");
  addSystemLog(String(fb->len));
  addSystemLog(String("threshold = ") + threshold);
  addSystemLog(String("Bool tooDark = ") + tooDark);

  if (!tooDark) {
    // Looks bright enough—use this frame
    return fb;
  }

  // 2) Too dark: capture again with LED
  debugFramebufferReleased(fb);
  esp_camera_fb_return(fb);

  setHighPowerLED(true);
  delay(preFlashMs);

  // Discard one warmup frame to let auto-exposure converge with LED on
  camera_fb_t *tmp = esp_camera_fb_get();
  if (tmp) {
    debugFramebufferAllocated(tmp);
    debugFramebufferReleased(tmp);
    esp_camera_fb_return(tmp);
  }
  delay(settleMs);

  fb = esp_camera_fb_get();
  if (fb) debugFramebufferAllocated(fb);

  delay(postOffMs);
  setHighPowerLED(false);

  if (usedFlashOut) *usedFlashOut = true;
  return fb;  // may be nullptr if capture failed
}


Preferences preferences;

volatile bool disableServo = true;
// Single source of truth for changing the gate.
static void setDisableServo(bool v, const char* src) {
  disableServo = v;
  // persist
  Preferences p;
  if (p.begin("trap", /*readOnly=*/false)) {
    p.putBool("disableServo", v);
    p.end();
  }
  applyServoDisableState(src);
  Serial.printf("[servo] setDisableServo(%d) by %s @%p\n", (int)v, &disableServo);
}


// static inline void setDisableServo(bool v, const char* who) {
//   disableServo = v;
//   Serial.printf("[servo] setDisableServo(%d) by %s @%p\n", (int)v, who, &disableServo);
// }

int servoStartUS = 1500;                   // default: center
int servoEndUS = 1100;                     // default: 45° pull
RTC_DATA_ATTR uint32_t servoArmEpoch = 0;  // seconds since boot when we armed
RTC_DATA_ATTR bool servoArming = false;


void loadServoSettings() {
  servoStartUS = preferences.getInt("servoStart", 1500);
  servoEndUS = preferences.getInt("servoEnd", 1100);
}

// void saveServoSettings() {
//   preferences.putInt("servoStart", servoStartUS);
//   preferences.putInt("servoEnd", servoEndUS);
//   preferences.putBool("disableServo", disableServo);
// }

/* ---------- globals & forward declarations ---------- */
inline void logServo(const char *tag);  // fwd
int computeThreshold(uint16_t avg);
bool crashedWhileArming;

//Servo trapServo;  // global instance
SafeServo trapServo;  // name stays the same; calls stay the same


static void attachServoIfEnabled() {
  if (disableServo) { 
    detachServo();                 // belt + suspenders, makes pin safe
    return; 
  }
  if (!trapServo.attached()) {
    int ch = trapServo.attach(SERVO_PIN, 500, 2500);
    if (ch < 0) {
      addSystemLog("⚠️ Servo attach FAILED (first attach)");
      return;
    }
    addSystemLog(String("Servo attached on LEDC channel: ") + ch);
    // Optional: put the horn at a neutral position so it won’t “kick”
    // trapServo.writeMicroseconds(1500);
  }
}

// void setupServo();    // fwd
void triggerServo();  // fwd

/* ================================================================== */
/*        END  OF  SERVO  SUPPORT  BLOCK                               */
/* ================================================================== */


String lastImagePath = "";  // full path of most‑recent picture
bool photoQueued = false;   // set when sensor task grabs a new photo
bool videoMode = false;     // false = still photos (default), true = 10-s video

//bool spiffsOK = false;           // <- new global if you like
bool fsOK = false;  // <- new global if you like

String homePreview = "";  // path of the “headline” photo on /
bool eventArmed = true;   // true → we may still shoot photos this event

int calibrationOffset = 0;  // slider value [-100…100]
int falseAlarmOffset = 0;   // +5 mm increments via False Alarm button
volatile uint32_t calibDoneMillis = 0;

/* hourly calibration */
//TimerHandle_t reCalTimer = nullptr;
volatile bool reCalBusy = false;  // prevents overlapping calibrations



static volatile bool flushInProgress = false;
//VideoJob   *currentJob      = nullptr;  // points to the active job, else null

static const size_t PSRAM_LIMIT = 3 * 1024 * 1024UL;







// Removed duplicate - using ArRequestHandlerFunction instead (defined at line 3194)




#ifndef STASSID
#define STASSID "Pretty Fly for a Wi-Fi 2.4"
#define STAPSK "38404244"
#endif

const char *ssid = STASSID;
const char *password = STAPSK;
const char *emailServer = "http://192.168.133.110:3000";

// Captive Portal Configuration - Lazy initialization to avoid global constructor TCP crash
DNSServer& getDnsServer() {
  static DNSServer* dns = nullptr;
  if (!dns) dns = new DNSServer();
  return *dns;
}
#define dnsServer getDnsServer()
const byte DNS_PORT = 53;
// isAPMode, savedSSID, savedPassword now declared at top with other globals
//const char *emailServer = "https://mtmon.wadehargrove.com";
const char *emailResource = "/mouse-trap";
const String url = String(emailServer) + String(emailResource);

bool lastButtonState = HIGH;  // Because of pull-up, idle state is HIGH
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelay = 50;  // milliseconds
bool detectionState = false;
bool manualControlActive = false;     // When true, sensorTaskFunction will not toggle the LED
volatile bool buttonPressed = false;  // Set to true in the ISR when the button is pressed
bool ledState = false;
unsigned long ledOnTimestamp = 0;
bool highPowerLedState = false;  // Track if the 1W LED is on or off
unsigned long highPowerLedOnTimestamp = 0;

// Claiming mode state variables
bool claimingModeActive = false;
unsigned long buttonPressStartTime = 0;
unsigned long claimingModeStartTime = 0;
const unsigned long CLAIMING_MODE_BUTTON_HOLD_MS = 5000;  // 5 seconds
const unsigned long CLAIMING_MODE_DURATION_MS = 600000;   // 10 minutes

// Button handler constants and state
const unsigned long REBOOT_HOLD_MS = 2000;         // 2 seconds for reboot
const unsigned long FACTORY_RESET_HOLD_MS = 10000; // 10 seconds for factory reset
const unsigned long FEEDBACK_5S_MS = 5000;         // 5 second milestone beep

// Button state machine tracking
bool buttonBeep2sPlayed = false;   // Track if 2s milestone beep was played
bool buttonBeep5sPlayed = false;   // Track if 5s milestone beep was played
bool buttonBeep10sPlayed = false;  // Track if 10s factory reset tone was played
bool claimingModeNotified = false;
unsigned long lastClaimCheckTime = 0;
const unsigned long CLAIM_CHECK_INTERVAL_MS = 5000;  // Check every 5 seconds

// Global flag for camera initialization
bool cameraInitialized = false;

static uint8_t autoFlashLumaThreshold = 40;  // 0–255. Raise if you want flash more often.



// ---[ NEW: one bright frame, with optional pre‑flash, no filesystem ]--------
static camera_fb_t* grabOneJpegWithOptionalFlash(bool flash) {
  constexpr uint16_t PRE_FLASH_MS   = 150;
  constexpr uint16_t SETTLE_MS      = 40;
  constexpr uint16_t POST_LED_OFFMS = 10;

  camera_fb_t *fb = nullptr;

  if (flash) {
    setHighPowerLED(true);
    TASK_YIELD_MS(PRE_FLASH_MS);

    // Discard one dummy frame to train auto-exposure with LED on
    camera_fb_t *tmp = esp_camera_fb_get();
    if (tmp) {
      debugFramebufferAllocated(tmp);
      debugFramebufferReleased(tmp);
      esp_camera_fb_return(tmp);
    }

    TASK_YIELD_MS(SETTLE_MS);
  }

  fb = esp_camera_fb_get();
  if (fb) debugFramebufferAllocated(fb);

  if (flash) {
    TASK_YIELD_MS(POST_LED_OFFMS);
    setHighPowerLED(false);
  }

  return fb;
}

//const char *CAPTURE_DIR = "/captures";

void IRAM_ATTR buttonISR() {
  buttonPressed = true;
}

void beepReady() {
  for (int i = 0; i < 3; i++) {
    tone(BUZZER_PIN, 300);
    TASK_YIELD_MS(100);
    noTone(BUZZER_PIN);
    TASK_YIELD_MS(100);
  }
}

// Claiming Mode Functions
void beepClaimingMode() {
  // Play ascending tone sequence to indicate claiming mode
  tone(BUZZER_PIN, 400);
  TASK_YIELD_MS(150);
  tone(BUZZER_PIN, 600);
  TASK_YIELD_MS(150);
  tone(BUZZER_PIN, 800);
  TASK_YIELD_MS(150);
  noTone(BUZZER_PIN);
}

void notifyServerClaimingMode() {
  if (!WiFi.isConnected()) {
    Serial.println("[CLAIMING] Cannot notify server - WiFi not connected");
    return;
  }

  Serial.println("[CLAIMING] ========================================");
  Serial.println("[CLAIMING] Notifying server of claiming mode");
  Serial.println("[CLAIMING] ========================================");

  // Get device info
  String mac = WiFi.macAddress();
  String ip = WiFi.localIP().toString();

  // Construct JSON payload
  String payload = "{";
  payload += "\"mac\":\"" + mac + "\",";
  payload += "\"ip\":\"" + ip + "\"";
  payload += "}";

  Serial.println("[CLAIMING] MAC: " + mac);
  Serial.println("[CLAIMING] IP: " + ip);
  Serial.println("[CLAIMING] Payload: " + payload);

  HTTPClient http;
  String serverUrl = String(emailServer) + "/api/device/claiming-mode";

  Serial.println("[CLAIMING] Server URL: " + serverUrl);

  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  int httpCode = http.POST(payload);

  Serial.println("[CLAIMING] HTTP Response Code: " + String(httpCode));

  if (httpCode > 0) {
    String response = http.getString();
    Serial.println("[CLAIMING] Server Response: " + response);

    if (httpCode == 200) {
      Serial.println("[CLAIMING] ✓ Server notified successfully");
      claimingModeNotified = true;
      beepClaimingMode();
    } else {
      Serial.println("[CLAIMING] ✗ Server returned error code: " + String(httpCode));
    }
  } else {
    Serial.println("[CLAIMING] ✗ HTTP POST failed: " + http.errorToString(httpCode));
  }

  http.end();
  Serial.println("[CLAIMING] ========================================");
}

void enterClaimingMode() {
  if (claimingModeActive) return;  // Already in claiming mode

  // Check if device is already claimed
  if (deviceClaimed) {
    Serial.println("[CLAIMING] ========================================");
    Serial.println("[CLAIMING] DEVICE ALREADY CLAIMED - CANNOT ENTER CLAIMING MODE");
    Serial.println("[CLAIMING] Device must be unclaimed first");
    Serial.println("[CLAIMING] ========================================");

    // Error feedback - rapid low beeps
    for (int i = 0; i < 3; i++) {
      tone(BUZZER_PIN, 200);
      TASK_YIELD_MS(100);
      noTone(BUZZER_PIN);
      TASK_YIELD_MS(100);
    }

    addSystemLog("[CLAIMING] Attempted to enter claiming mode while already claimed - rejected");
    return;
  }

  Serial.println("[CLAIMING] ========================================");
  Serial.println("[CLAIMING] ENTERING CLAIMING MODE");
  Serial.println("[CLAIMING] Duration: 10 minutes");
  Serial.println("[CLAIMING] ========================================");

  claimingModeActive = true;
  claimingModeStartTime = millis();
  claimingModeNotified = false;

  // Notify server
  notifyServerClaimingMode();

  // Provide visual feedback - rapid LED blinks
  for (int i = 0; i < 5; i++) {
    setLED(true);
    TASK_YIELD_MS(100);
    setLED(false);
    TASK_YIELD_MS(100);
  }

  addSystemLog("[CLAIMING] Device entered claiming mode");
}

void exitClaimingMode() {
  if (!claimingModeActive) return;

  Serial.println("[CLAIMING] ========================================");
  Serial.println("[CLAIMING] EXITING CLAIMING MODE");
  Serial.println("[CLAIMING] ========================================");

  claimingModeActive = false;
  claimingModeNotified = false;

  // Update mDNS advertising to remove claiming flag
  updateMdnsTxtRecords();

  // Single beep to indicate exit
  tone(BUZZER_PIN, 400);
  TASK_YIELD_MS(200);
  noTone(BUZZER_PIN);

  addSystemLog("[CLAIMING] Device exited claiming mode");
}

void checkClaimCompletion() {
  if (!claimingModeActive) return;

  // Only check every 5 seconds to avoid hammering the server
  unsigned long now = millis();
  if (now - lastClaimCheckTime < CLAIM_CHECK_INTERVAL_MS) {
    return;
  }

  lastClaimCheckTime = now;

  if (!WiFi.isConnected()) {
    Serial.println("[CLAIMING] Cannot check claim status - WiFi not connected");
    return;
  }

  // Get MAC address
  String mac = WiFi.macAddress();
  String macWithoutColons = mac;
  macWithoutColons.replace(":", "");

  // Build check-claim URL
  String checkUrl = String(emailServer) + "/api/device/check-claim/" + macWithoutColons;

  Serial.println("[CLAIMING] Checking claim status: " + checkUrl);

  HTTPClient http;
  http.begin(checkUrl);

  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.println("[CLAIMING] Server response: " + payload);

    // Parse JSON response
    DynamicJsonDocument doc(2048);
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
      Serial.println("[CLAIMING] JSON parse error: " + String(error.c_str()));
      http.end();
      return;
    }

    bool claimed = doc["claimed"] | false;

    if (claimed) {
      Serial.println("[CLAIMING] ========================================");
      Serial.println("[CLAIMING] DEVICE HAS BEEN CLAIMED!");
      Serial.println("[CLAIMING] ========================================");

      // Extract credentials from response
      JsonObject data = doc["data"];
      String deviceId = data["deviceId"] | "";
      String tenantId = data["tenantId"] | "";
      String deviceName = data["deviceName"] | "";
      String mqttClientId = data["mqttClientId"] | "";
      String mqttUsername = data["mqttUsername"] | "";
      String mqttPassword = data["mqttPassword"] | "";
      String mqttBrokerUrl = data["mqttBrokerUrl"] | "";

      // Extract broker IP and port from URL (format: mqtt://192.168.1.100:1883)
      String mqttBroker = "192.168.133.110";  // Default
      int mqttPort = 1883;

      if (mqttBrokerUrl.startsWith("mqtt://")) {
        String brokerPart = mqttBrokerUrl.substring(7);  // Remove mqtt://
        int colonPos = brokerPart.indexOf(':');
        if (colonPos > 0) {
          mqttBroker = brokerPart.substring(0, colonPos);
          mqttPort = brokerPart.substring(colonPos + 1).toInt();
        } else {
          mqttBroker = brokerPart;
        }
      }

      Serial.println("[CLAIMING] Device ID: " + deviceId);
      Serial.println("[CLAIMING] Tenant ID: " + tenantId);
      Serial.println("[CLAIMING] Device Name: " + deviceName);
      Serial.println("[CLAIMING] MQTT Broker: " + mqttBroker);
      Serial.println("[CLAIMING] MQTT Client ID: " + mqttClientId);

      // Save credentials to NVS
      preferences.begin("config", false);
      preferences.putBool("claimed", true);
      preferences.putString("deviceId", deviceId);
      preferences.putString("deviceName", deviceName);
      preferences.putString("tenantId", tenantId);
      preferences.putString("mqttClientId", mqttClientId);
      preferences.putString("mqttUsername", mqttUsername);
      preferences.putString("mqttPassword", mqttPassword);
      preferences.putString("mqttBroker", mqttBroker);
      preferences.putInt("mqttPort", mqttPort);
      preferences.end();

      // Update global variables
      deviceClaimed = true;
      claimedDeviceId = deviceId;
      claimedDeviceName = deviceName;
      claimedTenantId = tenantId;
      claimedMqttClientId = mqttClientId;
      claimedMqttUsername = mqttUsername;
      claimedMqttPassword = mqttPassword;
      claimedMqttBroker = mqttBroker;
      // Note: Port is always MQTT_PORT (1883), no separate variable needed

      Serial.println("[CLAIMING] ✓ Credentials saved to NVS");

      // Play success tone sequence
      tone(BUZZER_PIN, 600);
      TASK_YIELD_MS(150);
      noTone(BUZZER_PIN);
      TASK_YIELD_MS(50);
      tone(BUZZER_PIN, 800);
      TASK_YIELD_MS(150);
      noTone(BUZZER_PIN);
      TASK_YIELD_MS(50);
      tone(BUZZER_PIN, 1000);
      TASK_YIELD_MS(200);
      noTone(BUZZER_PIN);

      // Blink LED rapidly
      for (int i = 0; i < 10; i++) {
        setLED(true);
        TASK_YIELD_MS(50);
        setLED(false);
        TASK_YIELD_MS(50);
      }

      addSystemLog("[CLAIMING] Device claimed successfully to tenant: " + tenantId);

      // Restart mDNS with new hostname (e.g., kitchen.mousetrap.local)
      Serial.println("[CLAIMING] Restarting mDNS with device-specific hostname...");
      MDNS.end();
      startMdnsService();

      // Exit claiming mode
      exitClaimingMode();

      // Connect to MQTT broker
      Serial.println("[CLAIMING] Connecting to MQTT broker...");
      mqttSetup();
      mqttConnect();

    } else {
      Serial.println("[CLAIMING] Still waiting for claim to complete...");
    }
  } else {
    Serial.println("[CLAIMING] HTTP error checking claim status: " + String(httpCode));
  }

  http.end();
}

void checkClaimingModeTimeout() {
  if (!claimingModeActive) return;

  unsigned long elapsed = millis() - claimingModeStartTime;

  if (elapsed >= CLAIMING_MODE_DURATION_MS) {
    Serial.println("[CLAIMING] Claiming mode timeout - exiting");
    exitClaimingMode();
  }
}

// Clear WiFi credentials from NVS for factory reset
void clearWiFiCredentials() {
  Serial.println("[FACTORY-RESET] Clearing WiFi credentials from NVS");
  devicePrefs.begin("wifi", false);  // read-write
  devicePrefs.clear();
  devicePrefs.end();

  savedSSID = "";
  savedPassword = "";

  Serial.println("[FACTORY-RESET] WiFi credentials cleared");
  addSystemLog("[FACTORY-RESET] WiFi credentials cleared from NVS");
}

// Perform factory reset - clears all credentials and restarts into AP mode
void performFactoryReset() {
  Serial.println("[BUTTON] ========================================");
  Serial.println("[BUTTON] FACTORY RESET INITIATED");
  Serial.println("[BUTTON] ========================================");
  addSystemLog("[BUTTON] Factory reset initiated");

  // Play long confirmation tone
  tone(BUZZER_PIN, 1000);
  delay(500);
  noTone(BUZZER_PIN);

  // Clear WiFi credentials from NVS
  clearWiFiCredentials();

  // Clear device claim status and MQTT credentials (LOCAL ONLY)
  // NOTE: Do NOT notify server - this allows device to recover its claim
  // If user wants to truly unclaim, they should use the dashboard
  Serial.println("[FACTORY-RESET] Clearing local credentials (server claim preserved for recovery)...");
  clearClaimedCredentials();

  // Ensure deviceClaimed is false
  deviceClaimed = false;

  Serial.println("[FACTORY-RESET] All credentials cleared, restarting into AP mode...");
  addSystemLog("[FACTORY-RESET] Restarting into AP mode");

  // Small delay to allow logs to flush
  delay(100);

  // Restart - device will boot into AP mode since WiFi credentials are cleared
  ESP.restart();
}

// New unified button handler with three functions:
// 1. Quick click (< 1 second): Reset alarm status
// 2. Hold 2-10 seconds + release: Reboot device
// 3. Hold 10 seconds: Factory reset
void handleButton() {
  bool reading = digitalRead(BUTTON_PIN);
  unsigned long now = millis();

  // Detect button press start (transition from HIGH to LOW)
  if (reading == LOW && lastButtonState == HIGH) {
    buttonPressStartTime = now;
    // Reset milestone flags for new press
    buttonBeep2sPlayed = false;
    buttonBeep5sPlayed = false;
    buttonBeep10sPlayed = false;
    Serial.println("[BUTTON] Button press detected");
  }

  // Check if button is still held down
  if (reading == LOW && lastButtonState == LOW) {
    unsigned long pressDuration = now - buttonPressStartTime;

    // 2 second milestone - double beep (reboot threshold reached)
    if (pressDuration >= REBOOT_HOLD_MS && !buttonBeep2sPlayed) {
      Serial.println("[BUTTON] 2 second hold - reboot threshold reached");
      // Double beep to indicate reboot point
      tone(BUZZER_PIN, 600);
      delay(100);
      noTone(BUZZER_PIN);
      delay(50);
      tone(BUZZER_PIN, 600);
      delay(100);
      noTone(BUZZER_PIN);
      buttonBeep2sPlayed = true;
    }

    // 5 second milestone - single beep (continuing toward factory reset)
    if (pressDuration >= FEEDBACK_5S_MS && !buttonBeep5sPlayed) {
      Serial.println("[BUTTON] 5 second hold - continuing toward factory reset");
      tone(BUZZER_PIN, 800);
      delay(150);
      noTone(BUZZER_PIN);
      buttonBeep5sPlayed = true;
    }

    // 10 second threshold - factory reset triggered automatically
    if (pressDuration >= FACTORY_RESET_HOLD_MS && !buttonBeep10sPlayed) {
      Serial.println("[BUTTON] 10 second hold - factory reset triggered");
      buttonBeep10sPlayed = true;
      // Perform factory reset immediately
      performFactoryReset();
      // Note: ESP.restart() is called in performFactoryReset(), so we won't return here
    }
  }

  // Button release handling (transition from LOW to HIGH)
  if (reading == HIGH && lastButtonState == LOW) {
    unsigned long pressDuration = now - buttonPressStartTime;
    Serial.printf("[BUTTON] Button released after %lu ms\n", pressDuration);

    if (pressDuration < 1000) {
      // Quick click (< 1 second) - Reset alarm status
      Serial.println("[BUTTON] Alarm reset");
      addSystemLog("[BUTTON] Alarm reset");

      // Clear alert state
      detectionState = false;
      lastAlertTime = 0;
      lastEmailTime = time(nullptr) - 3600;

      // Single beep confirmation
      tone(BUZZER_PIN, 500);
      delay(100);
      noTone(BUZZER_PIN);

      notifyAlarmCleared("button");

    } else if (pressDuration >= REBOOT_HOLD_MS && pressDuration < FACTORY_RESET_HOLD_MS) {
      // Hold 2-10 seconds and release - Reboot device
      Serial.println("[BUTTON] Rebooting device");
      addSystemLog("[BUTTON] Rebooting device");

      // Confirmation beep
      tone(BUZZER_PIN, 800);
      delay(200);
      noTone(BUZZER_PIN);

      // Small delay to allow logs to flush
      delay(100);

      ESP.restart();
    }
    // If pressDuration >= FACTORY_RESET_HOLD_MS, factory reset was already triggered above

    lastDebounceTime = now;
  }

  lastButtonState = reading;
}

// Legacy function name for backwards compatibility - calls handleButton()
void checkButtonForClaimingMode() {
  handleButton();
}

// mDNS Functions
String getMdnsHostname() {
  if (deviceClaimed && claimedDeviceName.length() > 0) {
    // Claimed device: use device name as hostname (e.g., "kitchen" -> "kitchen.local")
    // Sanitize device name: lowercase, replace spaces/special chars with hyphens
    String sanitized = claimedDeviceName;
    sanitized.toLowerCase();
    sanitized.replace(" ", "-");
    sanitized.replace("_", "-");
    // Remove any non-alphanumeric characters except hyphens
    String clean = "";
    for (int i = 0; i < sanitized.length(); i++) {
      char c = sanitized.charAt(i);
      if (isAlphaNumeric(c) || c == '-') {
        clean += c;
      }
    }
    return clean;
  } else {
    // Unclaimed device: use generic mousetrap hostname
    return "mousetrap";
  }
}

void startMdnsService() {
  String hostname = getMdnsHostname();

  if (!MDNS.begin(hostname.c_str())) {
    Serial.println("[mDNS] Failed to start mDNS service");
    return;
  }

  Serial.println("[mDNS] mDNS service started");
  Serial.println("[mDNS] Hostname: " + hostname + ".local");

  // Advertise HTTP service
  MDNS.addService("http", "tcp", 80);

  // Add initial TXT records
  updateMdnsTxtRecords();
}

void updateMdnsTxtRecords() {
  String mac = WiFi.macAddress();
  String ip = WiFi.localIP().toString();

  Serial.println("[mDNS] ========================================");
  Serial.println("[mDNS] Updating TXT records");
  Serial.println("[mDNS] Claiming mode: " + String(claimingModeActive ? "true" : "false"));
  Serial.println("[mDNS] MAC: " + mac);
  Serial.println("[mDNS] IP: " + ip);
  Serial.println("[mDNS] ========================================");

  // Update TXT records for HTTP service
  MDNS.addServiceTxt("http", "tcp", "device", "mousetrap");
  MDNS.addServiceTxt("http", "tcp", "mac", mac.c_str());
  MDNS.addServiceTxt("http", "tcp", "ip", ip.c_str());
  MDNS.addServiceTxt("http", "tcp", "claiming", claimingModeActive ? "true" : "false");

  if (deviceClaimed && claimedDeviceName.length() > 0) {
    MDNS.addServiceTxt("http", "tcp", "name", claimedDeviceName.c_str());
  } else {
    MDNS.addServiceTxt("http", "tcp", "name", "MouseTrap");
  }
}

SemaphoreHandle_t g_i2cMutex = nullptr;

static inline bool I2C_LOCK(uint32_t timeout_ms = 50) {
  if (!g_i2cMutex) return true;  // early boot before setup() creates it
  return xSemaphoreTake(g_i2cMutex, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}
static inline void I2C_UNLOCK() {
  if (g_i2cMutex) xSemaphoreGive(g_i2cMutex);
}


TwoWire I2CSensors = TwoWire(0);
// tofBegin(I2CSensors, 21, 47, 100000);  // start @100 kHz
// tofScan(I2CSensors);                   // logs any addresses found

// --------------------
// Averaging and Anomaly Logging for Sensor Data
// --------------------
#define ONE_HOUR 3600UL
#define WEEK_HOURS 168  // 7 days * 24 hours
#define MAX_ANOMALIES 20
#define ANOMALY_MIN_INTERVAL 10  // seconds

//int threshold = 25;  // Sensor detection threshold (mm)
uint8_t range = 200;
time_t lastAlertTime = 0;
time_t lastEmailTime = 0;
bool lastEmailSuccess = false;
unsigned long lastLEDToggleTime = 0;
float currentHourSum = 0;
unsigned long currentHourCount = 0;
time_t hourStartTime = 0;
float weeklyAverages[WEEK_HOURS] = { 0 };
int currentHourIndex = 0;

struct Anomaly {
  time_t timestamp;
  uint8_t reading;
};
Anomaly anomalyEvents[MAX_ANOMALIES];
int anomalyCount = 0;
time_t lastAnomalyTime = 0;

// Persisted IP filtering settings
String ipWhitelist = "*";  // Default: allow all
String ipBlacklist = "";   // Default: block none

// --------------------
// Logging Globals
// --------------------

#define MAX_ACCESS_LOGS 100
#define MAX_SYSTEM_LOGS 100
#define MAX_LOGFILE_BYTES 65536  // 64 KB before we rotate

String accessLogs[MAX_ACCESS_LOGS];
int accessLogCount = 0;

String systemLogs[MAX_SYSTEM_LOGS];
int systemLogCount = 0;  // counts total entries ever written

// ======== Replacement addSystemLog with Heartbeat Aggregation ========
void addSystemLog(const String &msg) {
  String nowStr = formatTime(time(nullptr));

  // Identify heartbeats (same heuristic you already have)
  String lower = msg; lower.toLowerCase();
  bool isHeartbeat = (lower.indexOf("heartbeat") >= 0) || lower.startsWith("[hb]");

  // Persistent rotation limit
  //const size_t MAX_LOGFILE_BYTES = 256 * 1024;  // keep your value if different

  static int      hbSlotIdx   = -1;
  static uint32_t hbCount     = 0;
  static int      hbSlotEpoch = -1;
  static int      hbLastRC    = -32768;

  if (isHeartbeat) {
    int rci = msg.indexOf("rc=");
    if (rci >= 0 && rci + 3 < (int)msg.length()) {
      hbLastRC = atoi(msg.c_str() + rci + 3);
    }
    hbCount++;

    // Build line text
    String summary = String("Heartbeat × ") + hbCount + " (last " + nowStr;
    if (hbLastRC != -32768) summary += String(", rc=") + hbLastRC;
    summary += ")";
    String line = nowStr + " " + summary;

    // Update ring under lock and decide if we need a new slot *inside* the lock
    syslogLock();
    bool needNewSlot = (hbSlotIdx < 0) || ((systemLogCount - hbSlotEpoch) >= MAX_SYSTEM_LOGS);
    if (needNewSlot) {
      hbSlotIdx   = systemLogCount % MAX_SYSTEM_LOGS;
      hbSlotEpoch = systemLogCount;
      systemLogs[hbSlotIdx] = line;
      systemLogCount++;
    } else {
      systemLogs[hbSlotIdx] = line;
    }
    syslogUnlock();

    // Skip FS writes while the page is streaming to avoid contention
    if (!g_logsStreaming) {
      const uint32_t EVERY_N = 20;
      if ((hbCount % EVERY_N) == 1) {
        fsLock();
        File f = LittleFS.open("/logs.txt", FILE_APPEND);
        if (f) {
          f.printf("%s\n", line.c_str());
          size_t sz = f.size();
          f.close();
          if (sz > MAX_LOGFILE_BYTES) {
            LittleFS.remove("/logs.older");
            LittleFS.rename("/logs.txt", "/logs.old");
            LittleFS.rename("/logs.old", "/logs.older");
            File nf = LittleFS.open("/logs.txt", "w");
            if (nf) nf.close();
          }
        }
        fsUnlock();
      }
    }
    return;
  }

  // -------- Non-heartbeat messages --------
  String line = nowStr + " " + msg;

  syslogLock();
  systemLogs[systemLogCount % MAX_SYSTEM_LOGS] = line;
  systemLogCount++;
  syslogUnlock();

  if (!g_logsStreaming) {
    fsLock();
    File f = LittleFS.open("/logs.txt", FILE_APPEND);
    if (f) {
      f.printf("%s\n", line.c_str());
      size_t sz = f.size();
      f.close();
      if (sz > MAX_LOGFILE_BYTES) {
        LittleFS.remove("/logs.older");
        LittleFS.rename("/logs.txt", "/logs.old");
        LittleFS.rename("/logs.old", "/logs.older");
        File nf = LittleFS.open("/logs.txt", "w");
        if (nf) nf.close();
      }
    }
    fsUnlock();
  }
}


// void addSystemLog(const String &msg) {
//   /* 1) build a fresh, time-stamped line  ---------------------------- */
//   String line = formatTime(time(nullptr)) + " " + msg;

//   /* 2) RAM circular buffer  ---------------------------------------- */
//   systemLogs[systemLogCount % MAX_SYSTEM_LOGS] = line;
//   systemLogCount++;

//   /* 3) append to LittleFS file  ------------------------------------ */
//   File f = LittleFS.open("/logs.txt", FILE_APPEND);
//   if (f) {
//     f.printf("%s\n", line.c_str());  // write full line, newline
//     size_t sz = f.size();
//     f.close();

//     if (sz > MAX_LOGFILE_BYTES) {  // simple rotation
//       LittleFS.remove("/logs.older");
//       LittleFS.rename("/logs.txt", "/logs.old");
//       LittleFS.rename("/logs.old", "/logs.older");
//       File nf = LittleFS.open("/logs.txt", "w");
//       if (nf) nf.close();
//     }
//   }
// }

/*  New lightweight overload for string literals ---------------------- */
// inline void addSystemLog(const char* msg)
// {
//   addSystemLog(String(msg));           // forward to the String version
// }

// void addSystemLog(const String& logEntry)
// {
//   /* -------- RAM circular buffer ---------- */
//   systemLogs[systemLogCount % MAX_SYSTEM_LOGS] = logEntry;
//   systemLogCount++;

//   /* -------- append to LittleFS file ------ */
//   File f = LittleFS.open("/logs.txt", FILE_APPEND);
//   if (f) {
//     f.printf("%s\n", logEntry.c_str());
//     size_t sz = f.size();
//     f.close();

//     /* -------- simple rotation ------------ */
//     if (sz > MAX_LOGFILE_BYTES) {
//       LittleFS.remove("/logs.older");                 // keep one backup
//       LittleFS.rename("/logs.txt",  "/logs.old");
//       LittleFS.rename("/logs.old",  "/logs.older");   // move previous -> older
//       File nf = LittleFS.open("/logs.txt", "w");      // fresh current
//       if (nf) nf.close();
//     }
//   }
// }


// void addSystemLog(const String& logEntry)            // ◄ take by const-ref, no copy
// {
//   /* ------- RAM circular buffer ----------------------------------------- */
//   systemLogs[systemLogCount % MAX_SYSTEM_LOGS] = logEntry;
//   systemLogCount++;

//   /* ------- persistent file --------------------------------------------- */
//   File f = LittleFS.open("/logs.txt", "a");
//   if (f) {
//     f.printf("%s\n", logEntry.c_str());               // no 128-byte truncation
//     size_t sz = f.size();                             // current file size
//     f.close();

//     /* rotate when the file grows past MAX_LOGFILE_BYTES */
//     if (sz > MAX_LOGFILE_BYTES) {
//       LittleFS.rename("/logs.txt", "/logs.old");
//       LittleFS.remove("/logs.older");                 // keep just one backup
//       LittleFS.rename("/logs.old", "/logs.older");
//       File nf = LittleFS.open("/logs.txt", "w");      // start fresh
//       if (nf) nf.close();
//     }
//   }
// }

// #define MAX_ACCESS_LOGS 100
// #define MAX_SYSTEM_LOGS 100
// String accessLogs[MAX_ACCESS_LOGS];
// int accessLogCount = 0;
// String systemLogs[MAX_SYSTEM_LOGS];
// int systemLogCount = 0;

// void addSystemLog(String logEntry) {
//   // — your circular buffer as before —
//   if (systemLogCount < MAX_SYSTEM_LOGS) {
//     systemLogs[systemLogCount++] = logEntry;
//   } else {
//     for (int i = 1; i < MAX_SYSTEM_LOGS; i++) {
//       systemLogs[i - 1] = systemLogs[i];
//     }
//     systemLogs[MAX_SYSTEM_LOGS - 1] = logEntry;
//   }

//   // — new: append to persistent file —
//   File f = LittleFS.open("/logs.txt", "a");
//   if (f) {
//     f.println(logEntry);
//     f.close();
//   }
// }

void addAccessLog(String logEntry) {
  if (accessLogCount < MAX_ACCESS_LOGS)
    accessLogs[accessLogCount++] = logEntry;
  else {
    for (int i = 1; i < MAX_ACCESS_LOGS; i++) {
      accessLogs[i - 1] = accessLogs[i];
    }
    accessLogs[MAX_ACCESS_LOGS - 1] = logEntry;
  }
}

// ----- quick helper so we don’t typo the same line ------------
static inline void logPath(const char *tag, const String &p) {
  const bool exists = LittleFS.exists(p) && !LittleFS.open(p, "r").isDirectory();
  addSystemLog(String("[PATH] ") + tag + " = \"" + p + "\"  (" + (exists ? "✔︎ exists" : "✘ MISSING") + ")");
}


void logEvent(String event, bool system = false) {
  String tStr = formatTime(time(nullptr));
  String entry = tStr + " - " + event;
  if (system)
    addSystemLog(entry);
  else
    addAccessLog(entry);
}

void logRequest(AsyncWebServerRequest *request) {
  String ip = request->client()->remoteIP().toString();
  String tStr = formatTime(time(nullptr));
  addAccessLog(tStr + " - " + ip);
}

// --------------------
// Time and Preferences Functions
// --------------------
String formatTime(time_t t) {
  char buf[32];
  struct tm timeinfo;
  localtime_r(&t, &timeinfo);
  strftime(buf, sizeof(buf), "%b %d %H:%M:%S", &timeinfo);
  return String(buf);
}

// Step 1: apply timezone rule from NVS (no Wi-Fi needed)
void applyTimeZone() {
  String rule = preferences.getString("tzRule", "");
  if (rule == "") {
    rule = "PST8PDT,M3.2.0/2,M11.1.0/2";  // fallback to Pacific
    preferences.putString("tzRule", rule);
    addBootLog("🕓 No tzRule in NVS; using fallback: " + rule);
  } else {
    addBootLog("🕓 Loaded tzRule from NVS: " + rule);
  }

  setenv("TZ", rule.c_str(), 1);
  tzset();

  time_t now = time(nullptr);
  struct tm tm_;
  localtime_r(&now, &tm_);
  addBootLog("🕓 tzset() applied. Local time: " + formatTime(now));
  addBootLog("🕓 tm_.tm_isdst = " + String(tm_.tm_isdst));
}

// void applyTimeZone() {
//   String rule = preferences.getString("tzRule", "PST8PDT,M3.2.0/2,M11.1.0/2");
//   setenv("TZ", rule.c_str(), 1);
//   tzset();
// }

// Step 2: wait for NTP time after Wi-Fi is connected
void syncNTP() {
  if (WiFi.status() != WL_CONNECTED) {
    addBootLog("⚠️ NTP skipped: no Wi-Fi");
    return;
  }

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Waiting for NTP");

  time_t now = time(nullptr);
  unsigned long start = millis();
  while (now < 1000000000 && millis() - start < 10000) {
    TASK_YIELD_MS(500);
    Serial.print(".");
    now = time(nullptr);
  }

  if (now >= 1000000000) {
    Serial.println();
    addBootLog("✅ NTP time synced");

    // 🟢 RE-APPLY rule before tzset
    String rule = preferences.getString("tzRule", "PST8PDT,M3.2.0/2,M11.1.0/2");
    setenv("TZ", rule.c_str(), 1);
    tzset();

    time_t localNow = time(nullptr);
    struct tm tm_;
    localtime_r(&localNow, &tm_);
    addBootLog("🕓 Re-applied tzset() after NTP: " + formatTime(localNow));
    addBootLog("🕓 tm_.tm_isdst = " + String(tm_.tm_isdst));
  } else {
    Serial.println(" ⚠️ Timed out");
    addBootLog("⚠️ NTP sync failed");
  }
}

// void syncNTP() {
//   if (WiFi.status() != WL_CONNECTED) {
//     addSystemLog("⚠️ NTP skipped: no Wi-Fi");
//     return;
//   }

//   configTime(0, 0, "pool.ntp.org", "time.nist.gov");
//   Serial.print("Waiting for NTP");

//   time_t now = time(nullptr);
//   unsigned long start = millis();
//   while (now < 1000000000 && millis() - start < 10000) {
//     delay(500);
//     Serial.print(".");
//     now = time(nullptr);
//   }

//   if (now >= 1000000000) {
//     Serial.println();
//     addSystemLog("✅ NTP time synced: " + formatTime(now));

//     // 🟢 Apply TZ *again* now that time is valid
//     String rule = preferences.getString("tzRule", "PST8PDT,M3.2.0/2,M11.1.0/2");
//     setenv("TZ", rule.c_str(), 1);  // <- set again after NTP
//     tzset();                        // <- now applies the rule correctly

//     //tzset();

//     // Optional: log confirmation
//     time_t localNow = time(nullptr);
//     struct tm tm_;
//     localtime_r(&localNow, &tm_);
//     addSystemLog("🕓 Re-applied tzset() after NTP: " + formatTime(localNow));
//     addSystemLog("🕓 tm_.tm_isdst = " + String(tm_.tm_isdst));
//   } else {
//     Serial.println(" ⚠️ Timed out");
//     addSystemLog("⚠️ NTP sync failed");
//   }
// }

// void syncNTP() {
//   if (WiFi.status() != WL_CONNECTED) {
//     addSystemLog("⚠️ NTP skipped: no Wi-Fi");
//     return;
//   }

//   configTime(0, 0, "pool.ntp.org", "time.nist.gov");
//   Serial.print("Waiting for NTP");

//   time_t now = time(nullptr);
//   unsigned long start = millis();
//   while (now < 1000000000 && millis() - start < 10000) {
//     delay(500);
//     Serial.print(".");
//     now = time(nullptr);
//   }

//   if (now >= 1000000000) {
//     Serial.println();
//     addSystemLog("✅ NTP time synced: " + formatTime(now));
//   } else {
//     Serial.println(" ⚠️ Timed out");
//     addSystemLog("⚠️ NTP sync failed");
//   }
// }


// void initTime() {
//   if (WiFi.status() != WL_CONNECTED) {
//     addSystemLog("⚠️ WiFi not connected – skipping NTP sync");
//     return;
//   }

//   configTime(0, 0, "pool.ntp.org", "time.nist.gov");

//   Serial.print("Waiting for NTP");
//   time_t now = time(nullptr);
//   unsigned long start = millis();
//   while (now < 1000000000 && millis() - start < 10000) {
//     delay(500);
//     Serial.print(".");
//     now = time(nullptr);
//   }

//   if (now < 1000000000) {
//     Serial.println(" ⚠️ NTP failed");
//     addSystemLog("⚠️ NTP failed");
//   } else {
//     Serial.println();
//     addSystemLog("✅ NTP time synced: " + String(formatTime(now)));
//   }

//   // Apply TZ
//   setenv("TZ", preferences.getString("tzRule", "PST8PDT,M3.2.0/2,M11.1.0/2").c_str(), 1);
//   tzset();
// }

// void initTime() {
//   /* 1 ) get UTC from NTP ------------------------------ */
//   configTime(0 /*gmtOffset*/, 0 /*dst*/,  // keep both at 0
//              "pool.ntp.org", "time.nist.gov");

//   Serial.print("Waiting for NTP");
//   time_t now = time(nullptr);
//   while (now < 1000000000) {  // waits until epoch makes sense
//     delay(500);
//     Serial.print('.');
//     now = time(nullptr);
//   }
//   Serial.println();


//   /* 2 ) apply local time-zone (+ DST rules) ------------ */
//   setenv("TZ", "PST8PDT,M3.2.0/2,M11.1.0/2", 1);
//   //                  ^      ^          ^
//   //   switch  02:00 2-nd Sun Mar | 02:00 1-st Sun Nov
//   tzset();  // <- **must** follow setenv()

//   now = time(nullptr);
//   Serial.println(String("Local time  : ") + formatTime(now));  // should read 20:22
//   struct tm tm_;
//   localtime_r(&now, &tm_);
//   Serial.printf("tm_isdst = %d\n", String(tm_.tm_isdst));  // 1 = PDT, 0 = PST
//   addSystemLog("tm_.tmisdst = " + String(tm_.tm_isdst));
// }

void loadSettings() {
  preferences.begin("settings", false);
  ipWhitelist = preferences.getString("whitelist", "*");
  ipBlacklist = preferences.getString("blacklist", "");
  videoMode = preferences.getBool("videoMode", true);
  calibrationOffset = preferences.getInt("calibOff", 0);
  falseAlarmOffset = preferences.getInt("falseOff", 0);
  if (falseAlarmOffset < 0) falseAlarmOffset = -falseAlarmOffset;
  overrideThreshold = preferences.getInt("overrideTh", 0);
  if (overrideThreshold > 0) {
    addBootLog("overrideThreshold = " + String(overrideThreshold));
    threshold = overrideThreshold;
    addBootLog(String("🔒 Threshold override active: ") + String(threshold) + " mm");
  }
  //disableServo = preferences.getBool("disableServo", disableServo);
  setDisableServo(preferences.getBool("disableServo", true), "NVS");
  Serial.printf("disableServo=%d\n", disableServo);
  String msg = String("loadSettings(): ") + String(disableServo) + " - " + (disableServo ? " 🛠️ Servo disabled" : " 🛠️ Servo enabled");
  addBootLog(msg);
  preferences.end();

  addBootLog(String("Preferences loaded:"));
  addBootLog(String("whitelist=") + String(ipWhitelist));
  addBootLog(String("blacklist=") + String(ipBlacklist));
  addBootLog(String("videoMode=") + String(videoMode));
  addBootLog(String("calibOff=") + String(calibrationOffset));
  addBootLog(String("falseOff=") + String(falseAlarmOffset));
  addBootLog(String("overrideThreshold=") + String(overrideThreshold));
  addBootLog(String("disableServo=") + String(disableServo));

  // If runtime prefs say to disable, ensure we detach even if compiled with a pin:
  if (disableServo) detachServo();
}

void saveSettings() {
  preferences.begin("settings", false);
  preferences.putString("whitelist", ipWhitelist);
  preferences.putString("blacklist", ipBlacklist);
  preferences.putBool("videoMode", videoMode);
  preferences.putInt("calibOff", calibrationOffset);
  preferences.putInt("falseOff", falseAlarmOffset);
  preferences.end();
}


// Fetch public IPv4 (plain text). Returns "" if unavailable.
String getPublicIP() {
  HTTPClient http;
  http.begin("http://api.ipify.org");  // simple HTTP avoids TLS weight
  int rc = http.GET();
  if (rc == 200) {
    String ip = http.getString();
    ip.trim();
    http.end();
    return ip;
  }
  http.end();
  return String();
}

// === Public IP cache (refresh no more than every 6 hours) ===
static time_t g_publicIpTs = 0;

static String ensurePublicIp(uint32_t timeoutMs = 2000) {
  time_t now = time(nullptr);
  if (PUBLIC_IP.length() > 0 && (now - g_publicIpTs) < (6*3600)) {
    return PUBLIC_IP;  // cached is still fresh
  }

  HTTPClient http;
  http.setTimeout(timeoutMs);
  // Any plain-text service works; you can keep api.ipify.org
  if (!http.begin("http://api.ipify.org")) return PUBLIC_IP; // keep old if fail

  int rc = http.GET();
  if (rc == 200) {
    String ip = http.getString(); ip.trim();
    if (ip.length()) {
      PUBLIC_IP = ip;
      g_publicIpTs = now;
      addSystemLog("Public IP refreshed: " + PUBLIC_IP);
    }
  }
  http.end();
  return PUBLIC_IP;
}

// heartbeat helper ()
static void sendHeartbeat() {
  addSystemLog(String("sendHeartbeat called"));
  if (WiFi.status() != WL_CONNECTED) return;

  // 1) Build JSON payload (same style as notifyBootIP, minus crash/trapId)
  JsonDocument doc;
  doc["mac"] = WiFi.macAddress();
  doc["lan"] = WiFi.localIP().toString();
  String wan = ensurePublicIp();     // cached; refreshes every ~6h
  if (wan.length()) doc["wan"] = wan;
  //if (PUBLIC_IP.length()) doc["wan"] = PUBLIC_IP;   // ok if missing
  

  String payload;
  serializeJson(doc, payload);

  // 2) POST to /api/heartbeat with JSON body
  String url = String(emailServer) + "/api/heartbeat";
  addSystemLog(url);

  HTTPClient h;
  h.setTimeout(3000);
  h.begin(url);
  h.addHeader("Content-Type", "application/json");

  addSystemLog("Heartbeat JSON: " + payload);
  int rc = h.POST(payload);
  Serial.print("[HB] POST /api/heartbeat body: ");
  Serial.println(payload);
  Serial.printf("[HB] http rc=%d\n", rc);
  addSystemLog(String("Heartbeat POST rc=") + rc);

  h.end();  // always free sockets/heap
}


void heartbeatTask(void * /*pv*/) {

  for (;;) {
    CrashKit::markPage("heartbeatTask");
    CrashKit::markLine(1);
    sendHeartbeat();
    vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_PERIOD_MS));   // e.g. 60 min
    TASK_YIELD_MS(50);
  }
}

void triggerServo() {
  Serial.printf("triggerServo() seen disableServo=%d @%p\n", (int)disableServo, (void*)&disableServo);

  //Serial.printf("triggerServo(): disableServo=%d, attached=%d\n", (int)disableServo, (int)trapServo.attached());

  if (disableServo) {
    addSystemLog("triggerServo(): Servo is disabled.");
    return;
  }

  // Always start from a known, detached state
  if (trapServo.attached()) {
    trapServo.detach();
    TASK_YIELD_MS(10);
  }
  servoReleasePin(SERVO_PIN);  // fully free the pin mapping
  TASK_YIELD_MS(10);

  // ---------- FIRST MOVE (to end) ----------
  attachServoIfEnabled();

  // //int ch = trapServo.attach(SERVO_PIN, 500, 2500);
  // if (ch < 0) {
  //   addSystemLog("⚠️ Servo attach FAILED (first attach)");
  //   return;
  // }
  // addSystemLog(String("Servo attached on LEDC channel: ") + ch);
  TASK_YIELD_MS(10);

  // Optional: your own logger (safe if attached)
  logServo("Before");

  // Crash window OPENS before rail power
  servoArming = true;
  preferences.begin("settings", false);
  preferences.putBool("srvArmFl", true);
  preferences.end();
  addSystemLog("[debug] srvArmFl set → true");

  digitalWrite(SERVO_ENABLE_PIN, HIGH);  // power servo on
  TASK_YIELD_MS(5);
  trapServo.writeMicroseconds(servoEndUS);

  TASK_YIELD_MS(400);
  digitalWrite(SERVO_ENABLE_PIN, LOW);  // power off

  trapServo.detach();
  TASK_YIELD_MS(15);
  servoReleasePin(SERVO_PIN);
  TASK_YIELD_MS(10);

  // ---------- SECOND MOVE (return to start) ----------
  // Re-open window (your logic mirrors original)
  servoArming = true;
  preferences.begin("settings", false);
  preferences.putBool("srvArmFl", true);
  preferences.end();

  attachServoIfEnabled();
  // ch = trapServo.attach(SERVO_PIN, 500, 2500);
  // if (ch < 0) {
  //   addSystemLog("⚠️ Servo re-attach FAILED (return move)");
  //   return;
  // }
  // addSystemLog(String("Servo attached on LEDC channel: ") + ch);
  TASK_YIELD_MS(5);

  digitalWrite(SERVO_ENABLE_PIN, HIGH);  // power servo on
  TASK_YIELD_MS(5);
  trapServo.writeMicroseconds(servoStartUS);  // return

  TASK_YIELD_MS(400);
  digitalWrite(SERVO_ENABLE_PIN, LOW);  // power off

  trapServo.detach();
  TASK_YIELD_MS(15);
  servoReleasePin(SERVO_PIN);

  // Crash window CLOSES on success
  preferences.begin("settings", false);
  preferences.putBool("srvArmFl", false);
  preferences.end();

  logServo("After");
}



/* ---------- tiny helper that dumps angle + pulse width ---------- */
inline void logServo(const char *tag) {
  if (!trapServo.attached()) {
    const String msg = String(tag) + ": (servo not attached)";
    Serial.println(msg);
    addSystemLog(msg);
    return;
  }

  const int us  = trapServo.readMicroseconds();  // int, can be -1 on error
  const int deg = trapServo.read();              // int, can be -1 on error

  // If either read failed, say so explicitly.
  if (us < 0 || deg < 0) {
    const String msg = String(tag) + ": (read error)";
    Serial.println(msg);
    addSystemLog(msg);
    return;
  }

  // Print consistently to Serial and your system log
  char buf[64];
  snprintf(buf, sizeof(buf), "%s: %d µs (%d °)", tag, us, deg);
  Serial.println(buf);
  addSystemLog(String(buf));
}

// inline void logServo(const char *tag) {
//   if (!trapServo.attached()) {
//     addSystemLog(String(tag) + ": (servo not attached)");
//     return;
//   }
//   char buf[48];
//   snprintf(buf, sizeof(buf), "%s: %4u µs (%3u °)",
//            tag,
//            trapServo.readMicroseconds(),
//            trapServo.read());
//   Serial.println(buf);
//   addSystemLog("buf: " + String(buf));
// }




void checkPhysicalButton() {
  // Debug: print current button state read
  bool reading = digitalRead(BUTTON_PIN);
  Serial.println("checkPhysicalButton() reading: " + String(reading));
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading == LOW && lastButtonState == HIGH) {
      detectionState = false;
      addSystemLog("Detection state cleared via PHYSICAL button.");
      lastAlertTime = 0;
      lastEmailTime = time(nullptr) - 3600;
      lastEmailSuccess = false;
      Serial.println("Physical button triggered alarm reset!");
      notifyAlarmCleared("button");
    }
  }
  lastButtonState = reading;
}

// --------------------
// CIDR Helper Functions
// --------------------
uint32_t ipStringToUint(const String &ipStr) {
  uint32_t ip = 0;
  int start = 0;
  for (int i = 0; i < 4; i++) {
    int dot = ipStr.indexOf('.', start);
    String part = (dot == -1) ? ipStr.substring(start) : ipStr.substring(start, dot);
    if (dot != -1) start = dot + 1;
    ip = (ip << 8) | part.toInt();
  }
  return ip;
}

uint32_t ipToUint(const IPAddress &ip) {
  return ((uint32_t)ip[0] << 24) | ((uint32_t)ip[1] << 16) | ((uint32_t)ip[2] << 8) | (uint32_t)ip[3];
}

bool ipInCIDR(const String &cidr, const IPAddress &ip) {
  int slashIndex = cidr.indexOf('/');
  if (slashIndex == -1) return false;
  String ipPart = cidr.substring(0, slashIndex);
  String maskPart = cidr.substring(slashIndex + 1);
  uint32_t cidrIP = ipStringToUint(ipPart);
  int maskLength = maskPart.toInt();
  if (maskLength < 0 || maskLength > 32) return false;
  uint32_t mask = maskLength == 0 ? 0 : 0xFFFFFFFFUL << (32 - maskLength);
  uint32_t remoteIP = ipToUint(ip);
  return (cidrIP & mask) == (remoteIP & mask);
}


// --------------------
// Access Control Functions
// --------------------
bool isAllowed(AsyncWebServerRequest *request) {
  IPAddress remoteIP = request->client()->remoteIP();
  String remote = remoteIP.toString();

  // For debugging:
  //Serial.println("==== [isAllowed] Checking IP: " + remote + " ====");
  //Serial.println("Whitelist: '" + ipWhitelist + "'");

  // 1) If whitelist is empty or "*", allow everyone and skip further checks.
  if (ipWhitelist == "" || ipWhitelist == "*") {
    //Serial.println("[isAllowed] Whitelist is empty or '*'; ALLOW all, ignoring any blacklist.");
    return true;
  }

  // 2) Otherwise, parse the whitelist. If the IP is listed (directly or by CIDR), allow; else block.
  int start = 0;
  while (start < ipWhitelist.length()) {
    int comma = ipWhitelist.indexOf(',', start);
    if (comma == -1) comma = ipWhitelist.length();
    String entry = ipWhitelist.substring(start, comma);
    entry.trim();
    //Serial.println("[isAllowed] Checking whitelist entry: '" + entry + "'");

    if (entry.indexOf('/') != -1) {
      // Entry is a CIDR (e.g. "192.168.1.0/24")
      if (ipInCIDR(entry, remoteIP)) {
        //Serial.println("[isAllowed] IP matches CIDR: " + entry + " => ALLOW");
        return true;
      }
    } else {
      // Entry is a direct IP (e.g. "192.168.1.100")
      if (entry == remote) {
        //Serial.println("[isAllowed] IP matches direct whitelist entry: " + entry + " => ALLOW");
        return true;
      }
    }
    start = comma + 1;
  }

  // If we didn’t find any match in the whitelist, we block.
  //Serial.println("[isAllowed] IP NOT found in whitelist => BLOCK");
  return false;
}


// Use the exact alias used by ESPAsyncWebServer
using ArRequestHandlerFunction = std::function<void(AsyncWebServerRequest*)>;

// Replace your existing protectHandler with this:
ArRequestHandlerFunction protectHandler(ArRequestHandlerFunction inner) {
  return [inner](AsyncWebServerRequest *request) {
    if (!isAllowed(request)) {
      String tStr = formatTime(time(nullptr));
      String ip = request->client()->remoteIP().toString();
      addAccessLog(tStr + " - " + ip + " was blocked");
      request->send(403, "text/plain", "Forbidden");
      return;
    }
    logRequest(request);
    inner(request);
  };
}

// AsyncWebHandler* protectHandler(AsyncWebHandler* handler) {
//   return [handler](AsyncWebServerRequest *request) {
//     if (!isAllowed(request)) {
//       String tStr = formatTime(time(nullptr));
//       String ip = request->client()->remoteIP().toString();
//       addAccessLog(tStr + " - " + ip + " was blocked");
//       request->send(403, "text/plain", "Forbidden");
//       return;
//     }
//     logRequest(request);
//     handler(request);
//   };
// }

void handleTriggerServo(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleTriggerServo");
  if (!isAllowed(req)) {
    return req->send(403, "text/plain", "forbidden");
  }
  addSystemLog("🔄 /servo endpoint hit by " + req->client()->remoteIP().toString());

  if (!disableServo) {
    triggerServo();
    TASK_YIELD_MS(500);
  } else {
    // servo is disabled, skip
  }
  req->send(200, "text/plain", "ok");
}


/* ----------------------------------------------------------
 *  /test  →  simple page with a “Test alert” button
 * --------------------------------------------------------*/
void handleTestPage(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleTestPage");
  if (!isAllowed(request)) {  // IP whitelist / blacklist
    request->send(403, "text/plain", "Forbidden");
    return;
  }
  logRequest(request);

  String html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Test alert</title>"
    "<style>body{background:#222;color:#ddd;font-family:Arial;padding:10px}"
    "button{padding:10px 20px;font-size:18px;background:#444;color:#ddd;"
    "border:none;cursor:pointer}button:hover{background:#555}</style>"
    "</head><body>";

  html += getHamburgerMenuHTML();
  html +=
    "<h1>Test alert</h1>"
    "<p>Press a button to simulate an event or just fire the servo.</p>"

    /* ------------- buttons ------------- */
    "<button onclick=\"triggerTest()\">🖱️ Test&nbsp;alert</button>"

    "&nbsp;&nbsp;" /* small gap between the two buttons */

    "<button "
    "onclick=\"fetch('/servo').then(()=>alert('Servo triggered'))\">"
    "🔄 Test&nbsp;Servo"
    "</button>"

    /* ------------- JS helper ------------- */
    "<script>"
    "function triggerTest(){"
    "fetch('/testAlert')" /* simple GET */
    ".then(r=>r.text())"
    ".then(txt=>alert(txt))"
    ".catch(err=>alert('Error: '+err));"
    "}"
    "</script>"

    "<br><br><a href='/'>Back</a>"
    "</body></html>";

  request->send(200, "text/html", html);
  //request->send(200, "text/plain", "✅ Test alert triggered – check /captures/");
}


/* ----------------------------------------------------
 *  handleTestAlert – GUI “Test alert” handler
 *  (run alertFunction in a standalone task so we don’t
 *   block the AsyncWebServer task and trip the WDT)
 * --------------------------------------------------*/
void testAlertTask(void * /*pv*/)  // small wrapper
{
  alertFunction();  // uses vTaskDelay etc.//   // pretend the trap tripped
  detectionState = true;
  vTaskDelete(nullptr);  // clean-up when done
}

void handleTestAlert(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleTestAlert");
  if (!isAllowed(request)) {  // ACL as usual
    request->send(403, "text/plain", "Forbidden");
    return;
  }
  logRequest(request);
  addSystemLog("🔧 Test-alert triggered via GUI");

  /* launch alertFunction on its own stack (12 kB) on core 0 */
  xTaskCreatePinnedToCore(
    testAlertTask,  // entry
    "TestAlert",    // name (debug)
    12288,          // stack words (increased from 4096 to prevent overflow)
    nullptr,        // param
    3,              // prio (same as sensor task)
    nullptr,        // task handle
    0);             // core

  request->send(200, "text/plain",
                "✅ Test alert started – check /gallery or /captures");
}


/* ----------------------------------------------------
 *  getHamburgerMenuHTML – builds the slide-out menu
 * --------------------------------------------------*/
String getHamburgerMenuHTML() {
  String menu;
  menu +=
    // ──────────────────────────────────────────────────────────
    //  Top bar “hamburger” button
    // ──────────────────────────────────────────────────────────
    "<div class='hamburger' onclick='toggleMenu()'>"
    "<div class='bar'></div><div class='bar'></div><div class='bar'></div>"
    "</div>"

    // ──────────────────────────────────────────────────────────
    //  Side-drawer container
    // ──────────────────────────────────────────────────────────
    "<div id='sideMenu' class='menu'>"

    // 1 · Dashboard
    "<a href='/' onclick='collapseMenu()'>Home</a>"

    // 2 · Settings
    "<a href='#' onclick='toggleSubMenu(\"settingsSubMenu\"); return false;'>Settings</a>"
    "<div id='settingsSubMenu' class='submenu'>"
    "<a href='/servoSettings' onclick='collapseMenu()'>Servo Settings</a>"
    "<a href='/calibration'   onclick='collapseMenu()'>Calibration</a>"
    "<a href='/options'       onclick='collapseMenu()'>Options</a>"
    "<a href='/settings'      onclick='collapseMenu()'>Access</a>"
    "</div>"

    // 3 · Logs & Diagnostics ( Status lives here )
    "<a href='#' onclick='toggleSubMenu(\"loggingSubMenu\"); return false;'>Logs &amp; Diagnostics</a>"
    "<div id='loggingSubMenu' class='submenu'>"
    "<a href='/systemStatus' onclick='collapseMenu()'>Status</a>"
    "<a href='/accessLogs'   onclick='collapseMenu()'>Access Logs</a>"
    "<a href='/systemLogs'   onclick='collapseMenu()'>System Logs</a>"
    "<a href='/previousLogs' onclick='collapseMenu()'>Prev Logs</a>"
    "<a href='/gallery'      onclick='collapseMenu()'>Gallery</a>"
    "</div>"

    // 4 · Maintenance
    "<a href='#' onclick='toggleSubMenu(\"maintenanceSubMenu\"); return false;'>Maintenance</a>"
    "<div id='maintenanceSubMenu' class='submenu'>"
    "<a href='/claim'    onclick='collapseMenu()'>Claim</a>"
    "<a href='/test'     onclick='collapseMenu()'>Test Alert</a>"
    "<a href='/firmware' onclick='collapseMenu()'>Firmware</a>"
    "<a href='/reboot'   onclick='collapseMenu()'>Reboot</a>"
    "</div>"

    "</div>"  // ── end #sideMenu ──


    // ──────────────────────────────────────────────────────────
    //  Behaviour
    // ──────────────────────────────────────────────────────────
    "<script>"
    "var currentPage = window.location.pathname;"
    "window.addEventListener('load', function () {"
    // Auto-expand Settings when relevant
    "if(currentPage.startsWith(' ')||"
    "currentPage.startsWith('/calibration')  ||"
    "currentPage.startsWith('/options')      ||"
    "currentPage.startsWith('/settings')){"
    "document.getElementById('settingsSubMenu').style.display='block';"
    // Auto-expand Logs & Diagnostics when relevant
    "} else if(currentPage.startsWith('/systemStatus') ||"
    "currentPage.startsWith('/accessLogs')  ||"
    "currentPage.startsWith('/systemLogs')  ||"
    "currentPage.startsWith('/previousLogs')||"
    "currentPage.startsWith('/gallery')){"
    "document.getElementById('loggingSubMenu').style.display='block';"
    // Auto-expand Maintenance when relevant
    "} else if(currentPage.startsWith('/claim')    ||"
    "currentPage.startsWith('/test')     ||"
    "currentPage.startsWith('/firmware') ||"
    "currentPage.startsWith('/reboot')){"
    "document.getElementById('maintenanceSubMenu').style.display='block';"
    "}"
    "});"

    "function toggleMenu(){"
    "var m=document.getElementById('sideMenu');"
    "m.style.display = (m.style.display === 'block') ? 'none' : 'block';"
    "}"

    "function toggleSubMenu(id){"
    "var s=document.getElementById(id);"
    "s.style.display = (s.style.display === 'block') ? 'none' : 'block';"
    "}"

    "function collapseMenu(){"
    "document.getElementById('sideMenu').style.display='none';"
    "}"
    "document.addEventListener('keydown', function(e) {"
    "  if (e.key === 'Escape') {"
    "    var m = document.getElementById('sideMenu');"
    "    if (m && m.style.display === 'block') {"
    "      collapseMenu();"
    "    }"
    "  }"
    "});"
    "</script>"

    // ──────────────────────────────────────────────────────────
    //  Styling
    // ──────────────────────────────────────────────────────────
    "<style>"
    ".hamburger{cursor:pointer;display:inline-block;padding:15px}"
    ".bar{width:25px;height:3px;background:#ddd;margin:4px 0;transition:.4s}"
    ".menu{display:none;position:fixed;top:0;left:0;height:100%;width:250px;"
    "background:#333;padding-top:60px;z-index:1000}"
    ".menu a{padding:10px 20px;text-decoration:none;font-size:18px;color:#ddd;"
    "display:block;transition:.3s}"
    ".menu a:hover{background:#575757}"
    ".submenu{display:none;padding-left:20px}"
    "</style>";

  return menu;
}


const char *framesizeToString(framesize_t frameSize) {
  switch (frameSize) {
    case FRAMESIZE_QVGA: return "QVGA";
    case FRAMESIZE_CIF: return "CIF";
    case FRAMESIZE_VGA: return "VGA";
    case FRAMESIZE_SVGA: return "SVGA";
    case FRAMESIZE_XGA: return "XGA";
    case FRAMESIZE_SXGA: return "SXGA";
    case FRAMESIZE_UXGA: return "UXGA";
    default: return "Unknown";
  }
}


void initCamera() {
  Serial.println("Initializing camera...");
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = 11;
  config.pin_d1 = 9;
  config.pin_d2 = 8;
  config.pin_d3 = 10;
  config.pin_d4 = 12;
  config.pin_d5 = 18;
  config.pin_d6 = 17;
  config.pin_d7 = 16;
  config.pin_xclk = 15;  // For ESP32-S3-CAM, XCLK is typically on GPIO15 (adjust if needed)
  config.pin_pclk = 13;
  config.pin_vsync = 6;
  config.pin_href = 7;
  config.pin_sccb_sda = 4;
  config.pin_sccb_scl = 5;
  config.pin_pwdn = -1;  // Not used on ESP32-S3-CAM
  config.pin_reset = -1;
  config.xclk_freq_hz = 20000000;

  if (psramFound()) {
    Serial.println("PSRAM found. Configuring for lower resolution anyway.");
    addSystemLog("PSRAM found.");
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.frame_size = FRAMESIZE_VGA;  // Use medium resolution for the frame buffer
    // config.frame_size = FRAMESIZE_UXGA;  // Use high resolution for the frame buffer
  } else {
    Serial.println("PSRAM not found. Configuring for lower resolution.");
    addSystemLog("No PSRAM found!");
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.frame_size = FRAMESIZE_VGA;  // Lower resolution to fit internal memory
  }

  config.jpeg_quality = 25;
  config.fb_count = 2;
  config.pixel_format = PIXFORMAT_JPEG;  // for streaming
  config.grab_mode = CAMERA_GRAB_LATEST;

  DEBUG_SNAPSHOT("camera_init");
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    addSystemLog(String("Camera init failed with error 0x") + String(err, HEX));
    cameraInitialized = false;
    return;
  }

  Serial.println("Camera init succeeded.");
  addSystemLog(String("Camera init succeeded."));
  cameraInitialized = true;

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    // Check for OV2640 sensor (AI‐Thinker model)
    if (s->id.PID == OV2640_PID) {
      Serial.println("OV2640 sensor detected. Applying specific settings.");
      addSystemLog("OV2640 sensor detected. Applying specific settings.");
      s->set_vflip(s, 1);
      s->set_brightness(s, 1);
      s->set_saturation(s, -2);
    } else {
      Serial.println("Sensor PID does not match OV2640. Current PID: " + String(s->id.PID));
      addSystemLog("Sensor PID does not match OV2640. Current PID: " + String(s->id.PID));
    }
    // For JPEG, force the sensor resolution to QVGA when PSRAM is available, else VGA.
    //s->set_framesize(s, psramFound() ? FRAMESIZE_QVGA : FRAMESIZE_VGA);
    s->set_framesize(s, FRAMESIZE_VGA);  // 640×480  → ~18 fps
    s->set_quality(s, 12);               // JPEG quality 0 (best) – 63 (worst)
    Serial.println("Framesize set based on PSRAM availability.");
    addSystemLog("Framesize set based on PSRAM availability.");
  } else {
    Serial.println("Failed to get sensor pointer.");
    addSystemLog("Failed to get sensor pointer.");
  }

  Serial.println("Camera initialized.");
  addSystemLog(String("Camera initialized at ") + framesizeToString(config.frame_size) + " resolution");
}

void handleCamera(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleCamera");
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    return;
  }
  if (!cameraInitialized) {
    request->send(500, "text/plain", "Camera not initialized");
    return;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (fb) debugFramebufferAllocated(fb);
  if (!fb) {
    request->send(500, "text/plain", "Camera capture failed");
    return;
  }

  // Holder to safely free fb either on last chunk or if the client disconnects early
  struct FbHolder {
    camera_fb_t *fb;
    volatile bool returned;
  };
  FbHolder *holder = new FbHolder{ fb, false };

  // If client disconnects before we finish, free the frame then
  request->onDisconnect([holder]() {
    if (!holder->returned && holder->fb) {
      debugFramebufferReleased(holder->fb);
      esp_camera_fb_return(holder->fb);
    }
    delete holder;
  });

  // Stream the JPEG using a chunked filler; free the fb after the last chunk
  AsyncWebServerResponse *res = request->beginResponse(
    "image/jpeg", fb->len,
    [holder](uint8_t *buffer, size_t maxLen, size_t index) -> size_t {
      if (!holder->fb) return 0;  // safety
      size_t remaining = holder->fb->len - index;
      size_t toSend = remaining > maxLen ? maxLen : remaining;
      memcpy(buffer, holder->fb->buf + index, toSend);
      if (index + toSend >= holder->fb->len) {
        debugFramebufferReleased(holder->fb);
        esp_camera_fb_return(holder->fb);
        holder->fb = nullptr;
        holder->returned = true;
      }
      return toSend;
    });

  res->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res->addHeader("Content-Disposition", "inline; filename=capture.jpg");
  request->send(res);
}

void handleAutoSnapshot(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleAutoSnapshot");
  if (!isAllowed(request)) { request->send(403, "text/plain", "Forbidden"); return; }
  if (!cameraInitialized)  { request->send(500, "text/plain", "Camera not initialized"); return; }

  cameraLock();   // serialize camera access
  bool usedFlash = false;
  camera_fb_t *fb = grabAutoLitJpeg(&usedFlash);
  cameraUnlock();

  if (!fb) { request->send(500, "text/plain", "Camera capture failed"); return; }

  struct FbHolder { camera_fb_t *fb; volatile bool returned; };
  FbHolder *holder = new FbHolder{ fb, false };

  request->onDisconnect([holder]() {
    if (!holder->returned && holder->fb) {
      debugFramebufferReleased(holder->fb);
      esp_camera_fb_return(holder->fb);
    }
    delete holder;
  });

  auto *res = request->beginResponse(
    "image/jpeg",
    holder->fb->len,
    [holder](uint8_t *buffer, size_t maxLen, size_t index) -> size_t {
      size_t remaining = holder->fb->len - index;
      size_t toSend = remaining > maxLen ? maxLen : remaining;
      memcpy(buffer, holder->fb->buf + index, toSend);
      if (index + toSend >= holder->fb->len) {
        debugFramebufferReleased(holder->fb);
        esp_camera_fb_return(holder->fb);
        holder->fb = nullptr;
        holder->returned = true;
      }
      return toSend;
    });

  res->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res->addHeader("Content-Disposition", "inline; filename=snapshot.jpg");
  res->addHeader("X-Flash", usedFlash ? "1" : "0");  // helpful for debugging
  request->send(res);
}





// --------------------
// VL6180X Sensor Setup
// --------------------
//Adafruit_VL6180X vl = Adafruit_VL6180X();
// --------------------
// ToF Sensor Setup (VL53L0X or VL6180X)
// --------------------
//Adafruit_VL53L0X l53;                      // NEW: VL53L0X driver
Adafruit_VL6180X vl = Adafruit_VL6180X();  // existing
bool sensorFound = false;
bool useVL53 = false;  // which driver we picked

static inline bool tofAckOnSensorsBus() {
  I2CSensors.beginTransmission(0x29);
  uint8_t e = I2CSensors.endTransmission(true);  // send STOP
  return (e == 0);
}

void initSensor() {
  Serial.println("Initializing ToF sensor...");

  tofScan(I2CSensors);

  // Bus is already up in setup(): I2CSensors.begin(I2C_SDA, I2C_SCL, 100000);
  // We deliberately do NOT read any ID registers here (clones can be weird).

  sensorFound = false;
  useVL53 = false;  // baseline

  // -------- Try VL53L0X first (your historical order), @100 kHz --------
  I2CSensors.setClock(100000);
  // if (l53.begin(0x29, false, &I2CSensors)) {
  //   useVL53 = true;
  //   sensorFound = true;
  //   Serial.println("Detected VL53L0X");
  //   addSystemLog("VL53L0X sensor found.");
  //   return;
  // }
  // Serial.println("VL53L0X init failed; trying VL6180X...");

  // -------- Try VL6180X next, @100 kHz (many clones are fine at 100 kHz) --------
  if (vl.begin(&I2CSensors)) {
    useVL53 = false;
    sensorFound = true;
    Serial.println("Detected VL6180X");
    addSystemLog("VL6180X sensor found.");
    return;
  }
  Serial.println("VL6180X init failed at 100 kHz; applying clone-friendly sequence...");

  // -------- Clone-friendly rescue: clear FRESH_OUT_OF_RESET, retry --------
  vl6180xSoftBoot(I2CSensors);  // clear 0x0016 if set
  delay(3);

  // Retry VL6180X @100 kHz after soft-boot
  if (vl.begin(&I2CSensors)) {
    useVL53 = false;
    sensorFound = true;
    Serial.println("Detected VL6180X (after soft-boot @100 kHz)");
    addSystemLog("VL6180X sensor found (soft-boot).");
    return;
  }

  // -------- Clock retries (some clones are picky) ------------------------
  // Retry @400 kHz (officially supported; some boards prefer it)
  I2CSensors.setClock(400000);
  delay(2);
  vl6180xSoftBoot(I2CSensors);
  if (vl.begin(&I2CSensors)) {
    useVL53 = false;
    sensorFound = true;
    Serial.println("Detected VL6180X (after soft-boot @400 kHz)");
    addSystemLog("VL6180X sensor found (400 kHz).");
    return;
  }

  // Retry @50 kHz (last resort for very noisy lines)
  I2CSensors.setClock(50000);
  delay(2);
  vl6180xSoftBoot(I2CSensors);
  if (vl.begin(&I2CSensors)) {
    useVL53 = false;
    sensorFound = true;
    Serial.println("Detected VL6180X (after soft-boot @50 kHz)");
    addSystemLog("VL6180X sensor found (50 kHz).");
    return;
  }

  // -------- Final fallback: try VL53L0X again @100 kHz (in case it was timing) ----
  I2CSensors.setClock(100000);
  // if (l53.begin(0x29, false, &I2CSensors)) {
  //   useVL53 = true;
  //   sensorFound = true;
  //   Serial.println("Detected VL53L0X (final retry)");
  //   addSystemLog("VL53L0X sensor found (final retry).");
  //   return;
  // }

  // If we got here, 0x29 ACKs but neither driver took it.
  sensorFound = false;
  addSystemLog("ToF present at 0x29 but driver init failed after soft-boot + clock retries.");
  Serial.println("ToF present at 0x29 but driver init failed.");
}


// void initSensor() {
//   Serial.println("Initializing ToF sensor...");

//   // Bus already up from setup()
//   tofScan(I2CSensors);

//   ToFType detected = detectToF(I2CSensors, TOF_XSHUT_PIN);
//   bool present = (detected != ToFType::NONE);
//   sensorFound  = false;        // will flip true on successful driver init
//   useVL53      = false;        // your legacy flag; true = VL53L0X/L1X path

//   if (!present) {
//     Serial.println(F("ToF (0x29) not ACKing on I2CSensors; skipping driver init."));
//     addSystemLog(String("ToF 0x29 not responding on SDA=") + I2C_SDA +
//                  " SCL=" + I2C_SCL + ". Check wiring/power/XSHUT.");
//     return;
//   }

//   addSystemLog(String("ToF presence @0x29 (") + tofName(detected) + ")");
//   Serial.print("Heuristic model: ");
//   Serial.println(tofName(detected));

//   // ----------- Try VL53L0X first when AUTO or explicitly L0X -----------
//   if (detected == ToFType::AUTO || detected == ToFType::VL53L0X) {
//     // Keep bus at 100 kHz for L0X
//     I2CSensors.setClock(100000);
//     if (l53.begin(0x29, false, &I2CSensors)) {
//       useVL53     = true;
//       sensorFound = true;
//       Serial.println("Detected VL53L0X");
//       addSystemLog("VL53L0X sensor found.");
//       return;
//     }
//     Serial.println("VL53L0X init failed; will try VL6180X next...");
//   }

//   // ----------- VL6180X path (explicit OR fallback) ----------------------
//   // *Important*: slow bus BEFORE calling vl.begin()
//   I2CSensors.setClock(50000);
//   delay(2);
//   if (detected == ToFType::VL6180X || detected == ToFType::AUTO) {
//     if (vl.begin(&I2CSensors)) {
//       useVL53     = false;
//       sensorFound = true;
//       Serial.println("Detected VL6180X");
//       addSystemLog("VL6180X sensor found.");
//       return;
//     }
//     Serial.println("VL6180X init failed.");
//   }

//   // ----------- Optional: VL53L1X support (only if you use it) ----------
//   // If you add Adafruit_VL53L1X l1x; uncomment this block:
//   /*
//   if (detected == ToFType::VL53L1X) {
//     I2CSensors.setClock(100000);
//     if (l1x.begin(0x29, &I2CSensors)) {
//       useVL53     = true;       // share same flag path
//       sensorFound = true;
//       Serial.println("Detected VL53L1X");
//       addSystemLog("VL53L1X sensor found.");
//       return;
//     }
//     Serial.println("VL53L1X init failed.");
//   }
//   */

//   // If we got here, a sensor ACKed at 0x29 but no driver took it.
//   sensorFound = false;
//   addSystemLog("ToF present at 0x29 but driver init failed (tried VL53L0X then VL6180X).");
//   Serial.println("ToF present at 0x29 but driver init failed.");
// }

// void initSensor() {
//   Serial.println("Initializing ToF sensor...");

//   // Bus is already up from setup(): I2CSensors.begin(I2C_SDA, I2C_SCL, 100000);
//   // Quick scan helps confirm 0x29 presence in the logs.
//   tofScan(I2CSensors);

//   // Heuristic model detect (also slows bus to 50 kHz automatically if VL6180X)
//   ToFType detected = detectToF(I2CSensors, TOF_XSHUT_PIN);
//   sensorFound = (detected != ToFType::NONE);
//   useVL53     = false;   // baseline (matches your previous logic)

//   if (!sensorFound) {
//     Serial.println(F("ToF (0x29) not ACKing on I2CSensors; skipping driver init."));
//     addSystemLog(String("ToF 0x29 not responding on SDA=") + I2C_SDA +
//                  " SCL=" + I2C_SCL + ". Check wiring/power/XSHUT.");
//     return;  // setup() will skip creating the sensor task
//   }

//   // Log what we *think* it is (informational only)
//   addSystemLog(String("ToF presence @0x29 (") + tofName(detected) + ")");
//   Serial.print("Heuristic model: ");
//   Serial.println(tofName(detected));

//   // Try the driver that matches detection first, then fall back to your old order.
//   // NOTE: Keep your existing objects: Adafruit_VL53L0X l53; Adafruit_VL6180X vl;

//   // ----- Case 1: VL53L0X path first -----
//   if (detected == ToFType::VL53L0X) {
//     if (l53.begin(VL53L0X_I2C_ADDR, false, &I2CSensors)) {
//       useVL53     = true;
//       sensorFound = true;
//       Serial.println("Detected VL53L0X");
//       addSystemLog("VL53L0X sensor found.");
//       return;
//     }
//     Serial.println("VL53L0X init failed; trying VL6180X...");
//   }

//   // ----- Case 2: VL6180X path first -----
//   if (detected == ToFType::VL6180X) {
//     if (vl.begin(&I2CSensors)) {
//       useVL53     = false;
//       sensorFound = true;
//       Serial.println("Detected VL6180X");
//       addSystemLog("VL6180X sensor found.");
//       return;
//     }
//     Serial.println("VL6180X init failed; trying VL53L0X...");
//   }

//   // ----- Case 3: VL53L1X or unknown: try your known drivers in your old order -----
//   if (l53.begin(VL53L0X_I2C_ADDR, false, &I2CSensors)) {
//     useVL53     = true;
//     sensorFound = true;
//     Serial.println("Detected VL53L0X (fallback)");
//     addSystemLog("VL53L0X sensor found (fallback).");
//     return;
//   }

//   if (vl.begin(&I2CSensors)) {
//     useVL53     = false;
//     sensorFound = true;
//     Serial.println("Detected VL6180X (fallback)");
//     addSystemLog("VL6180X sensor found (fallback).");
//     return;
//   }

//   // If we got here, 0x29 ACKed but neither driver initialized (likely VL53L1X without its lib)
//   sensorFound = false;
//   Serial.println("ToF present at 0x29 but driver init failed.");
//   addSystemLog("ToF present at 0x29 but driver init failed. If this unit is VL53L1X, add its driver or map it to an L0X/L6180 path.");
// }


// void initSensor() {

//   Serial.println("Initializing ToF sensor...");

//   // Start your sensor I2C bus (uses your existing I2CSensors object)
//   tofBegin(I2CSensors, 21, 47, 100000UL);

//   // Optional: scan so you can see 0x29 in the log
//   tofScan(I2CSensors);

//   // Auto-detect (or force via TOF_FORCE)
//   ToFType tofType = detectToF(I2CSensors, TOF_XSHUT_PIN);
//   bool tofFound = (tofType != ToFType::NONE);

//   if (!tofFound) {
//     Serial.println("ToF not detected. Sensor functions disabled.");
//     // keep your current behavior: do NOT create the sensor task
//   } else {
//     Serial.println("ToF sensor found!");

//     // Branch to your existing init paths without renaming anything:
//     if (tofType == ToFType::VL6180X) {
//       // e.g. vl6180xInit();   // keep your current function names
//     } else {
//       // e.g. vl53Init();      // keep your current function names (L0X/L1X)
//     }

//     // Start your current sensor task as-is (unchanged)
//     // xTaskCreatePinnedToCore(sensorTask, "sensor", ...);
//     // Serial.println("Sensor task started.");
//   }
// }


// void initSensor() {
//   Serial.println("Initializing ToF sensor...");

//     if (!tofAckOnSensorsBus()) {
//     sensorFound = false;
//     useVL53     = false;  // baseline
//     Serial.println(F("ToF (0x29) not ACKing on I2CSensors; skipping driver init."));
//     addSystemLog(String("ToF 0x29 not responding on SDA=") + I2C_SDA + " SCL=" + I2C_SCL + ". Check wiring/power/XSHUT.");
//     return;
//   }
//   // NOTE: Your OldGoodCode already brings up I2CSensors once.
//   // Do NOT re-init the bus here.

//   // Try VL53L0X first (new module)
//   if (l53.begin(VL53L0X_I2C_ADDR, false, &I2CSensors)) {
//     useVL53     = true;
//     sensorFound = true;
//     Serial.println("Detected VL53L0X");
//     addSystemLog(String("VL53L0X sensor found."));
//     return;
//   }

//   // Fall back to VL6180X (existing module)
//   if (vl.begin(&I2CSensors)) {
//     useVL53     = false;
//     sensorFound = true;
//     Serial.println("Detected VL6180X");
//     addSystemLog(String("VL6180X sensor found."));
//     return;
//   }

//   // None detected
//   sensorFound = false;
//   Serial.println("ToF not detected. Sensor functions disabled.");
//   addSystemLog(String("ToF not detected. Sensor functions disabled."));
// }


static uint8_t g_lastToFStatus = 0;

// Returns one measurement in mm; 0 means error/out-of-range.
// Also stashes the last driver-specific status code.
static inline uint16_t readToF_mm_once() {
  if (!sensorFound) {
    g_lastToFStatus = 0xFF;
    return 0;
  }

  if (!I2C_LOCK(50)) {       // couldn't get the bus quickly
    g_lastToFStatus = 0xFD;  // arbitrary "lock fail" marker
    return 0;
  }

  uint16_t out = 0;
  // if (useVL53) {
  //   VL53L0X_RangingMeasurementData_t m;
  //   l53.rangingTest(&m, false);       // Adafruit call (multiple I2C ops)
  //   g_lastToFStatus = m.RangeStatus;  // 0=OK, 4=out-of-range
  //   out = (m.RangeStatus != 4) ? (uint16_t)m.RangeMilliMeter : 0;
  // } else {
    uint8_t r = vl.readRange();
    uint8_t s = vl.readRangeStatus();
    g_lastToFStatus = s;  // 0=OK
    out = (s == VL6180X_ERROR_NONE) ? (uint16_t)r : 0;
  //}

  I2C_UNLOCK();
  return out;
}

// // static inline uint16_t readToF_mm_once() {
// //   if (!sensorFound) { g_lastToFStatus = 0xFF; return 0; }

// //   if (useVL53) {
// //     VL53L0X_RangingMeasurementData_t m;
// //     l53.rangingTest(&m, false);          // false = no debug prints
// //     g_lastToFStatus = m.RangeStatus;     // 0=OK, 4=out-of-range
// //     return (m.RangeStatus != 4) ? (uint16_t)m.RangeMilliMeter : 0;
// //   } else {
// //     uint8_t r = vl.readRange();
// //     uint8_t s = vl.readRangeStatus();
// //     g_lastToFStatus = s;                 // 0=OK
// //     return (s == VL6180X_ERROR_NONE) ? (uint16_t)r : 0;
// //   }
// // }

static inline uint8_t readToFStatus() {
  return g_lastToFStatus;
}

// void initSensor() {
//   Serial.println("Initializing VL6180X sensor...");
//   if (!vl.begin(&I2CSensors)) {
//     Serial.println("Failed to find VL6180X sensor. Skipping sensor functions.");
//     addSystemLog(String("Failed to find VL6180X sensor. Sensor functions disabled."));
//     sensorFound = false;
//   } else {
//     Serial.println("VL6180X sensor found!");
//     addSystemLog(String("VL6180X sensor found."));
//     sensorFound = true;
//   }
// }

/* ----------------------------------------------------
 *  captureSingleFrame  –  grab ONE bright JPEG
 *  fullPath must include “/captures/…jpg”
 *  flash==true  → use the 1 W LED
 * ----------------------------------------------------*/
bool captureSingleFrame(const String &fullPath, bool flash /*= true*/) {
  /* --- tweakable timings (ms) ----------------------- */
  constexpr uint16_t PRE_FLASH_MS = 150;  // light‑up before dummy frame (was 250)
  constexpr uint16_t SETTLE_MS = 40;      // tiny pause before real frame
  constexpr uint16_t POST_LED_OFF = 10;   // let rail recover

  camera_fb_t *fb = nullptr;

  /* ---------- 1) “pre‑flash” to train auto‑exposure --- */
  if (flash) {
    setHighPowerLED(true);
    //vTaskDelay(pdMS_TO_TICKS(PRE_FLASH_MS));
    TASK_YIELD_MS(PRE_FLASH_MS);

    /* discard one dummy frame */
    fb = esp_camera_fb_get();
    if (fb) {
      debugFramebufferAllocated(fb);
      debugFramebufferReleased(fb);
      esp_camera_fb_return(fb);
    }
    //vTaskDelay(pdMS_TO_TICKS(SETTLE_MS));
    TASK_YIELD_MS(SETTLE_MS);
  }

  /* ---------- 2) real capture ------------------------ */
  fb = esp_camera_fb_get();
  if (fb) debugFramebufferAllocated(fb);

  if (flash) {
    /* keep LED on a hair longer than exposure */
    //vTaskDelay(pdMS_TO_TICKS(POST_LED_OFF));
    TASK_YIELD_MS(POST_LED_OFF);
    setHighPowerLED(false);
  }

  /* ---------- 3) retry once if frame empty ---------- */
  if (!fb || fb->len == 0) {
    if (fb) {
      debugFramebufferReleased(fb);
      esp_camera_fb_return(fb);
    }

    if (flash) {
      setHighPowerLED(true);
      //vTaskDelay(pdMS_TO_TICKS(PRE_FLASH_MS));
      TASK_YIELD_MS(PRE_FLASH_MS);
    }

    fb = esp_camera_fb_get();
    if (fb) debugFramebufferAllocated(fb);

    if (flash) {
      //vTaskDelay(pdMS_TO_TICKS(POST_LED_OFF));
      TASK_YIELD_MS(POST_LED_OFF);
      setHighPowerLED(false);
    }

    if (!fb || fb->len == 0) {
      addSystemLog("⚠️  empty frame for " + fullPath);
      if (fb) {
        debugFramebufferReleased(fb);
        esp_camera_fb_return(fb);
      }
      return false;
    }
  }

  /* ---------- 4) write to LittleFS ------------------ */
  File f = LittleFS.open(fullPath, FILE_WRITE);
  if (!f) {
    addSystemLog("⚠️  open failed for " + fullPath);
    debugFramebufferReleased(fb);
    esp_camera_fb_return(fb);
    return false;
  }

  size_t wr = f.write(fb->buf, fb->len);
  size_t expected = fb->len;  // Save before releasing fb
  f.close();
  debugFramebufferReleased(fb);
  esp_camera_fb_return(fb);

  addSystemLog(String("📸 ") + fullPath + " : " + String(wr) + " / " + String(expected) + " bytes");
  return wr == expected;
}

/* ------- helper: write little-endian word -------- */
static void le32(File &f, uint32_t v) {
  f.write((uint8_t *)&v, 4);
}

struct FrameBuf {
  uint8_t *data;
  size_t len;
};

struct VideoJob  // flushed by videoFlushTask()
{
  char path[64];  // <<-- fixed buffer, plenty for "/captures/vid_YYYYMMDD_HHMM.mjpg"
  std::vector<FrameBuf> frames;
};


VideoJob *currentJob = nullptr;  // points to the active job, else null

static std::vector<String> getBufferedJobs() {
  std::vector<String> v;
  if (flushInProgress && currentJob)  // single-job model
    v.push_back(String(currentJob->path));
  return v;
}


struct RecParams  // handed to videoRecordTask()
{
  String path;
  uint32_t durationMs;
};

/*----------------------NOT USED------------------------------------------- */
bool recordVideoBuffered(const String &filePath, uint32_t durationMs) {
  const size_t PSRAM_LIMIT = 3 * 1024 * 1024UL;
  std::vector<FrameBuf> buf;
  buf.reserve(256);
  size_t psramUsed = 0;
  size_t frames = 0;
  uint32_t t0 = millis();

  setHighPowerLED(true);

  /* --------- CAPTURE into PSRAM --------- */
  while (millis() - t0 < durationMs) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) debugFramebufferAllocated(fb);
    if (!fb) {
      //vTaskDelay(pdMS_TO_TICKS(15));
      TASK_YIELD_MS(15);
      continue;
    }

    if (psramUsed + fb->len > PSRAM_LIMIT) {
      debugFramebufferReleased(fb);
      esp_camera_fb_return(fb);
      break;
    }
    uint8_t *copy = (uint8_t *)heap_caps_malloc(fb->len,
                                                MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!copy) {
      debugFramebufferReleased(fb);
      esp_camera_fb_return(fb);
      break;
    }

    memcpy(copy, fb->buf, fb->len);
    buf.push_back({ copy, fb->len });
    psramUsed += fb->len;
    ++frames;
    debugFramebufferReleased(fb);
    esp_camera_fb_return(fb);
  }

  setHighPowerLED(false);
  addSystemLog("🎞️  Buffered " + String(frames) + " frames (" + String(psramUsed / 1024) + " KB)");

  /* --------- FLUSH in BG TASK --------- */
  flushInProgress = true;

  /* capture variables by value so the lambda owns them */
  xTaskCreatePinnedToCore(
    [](void *p) {
      auto vec = std::move(*(std::vector<FrameBuf> *)p);
      String path = ((String *)p)[1];  // cheesy but works
      delete (std::vector<FrameBuf> *)p;

      File f = LittleFS.open(path, FILE_WRITE);
      if (!f) {
        addSystemLog("⚠️  open " + path + " failed");
        goto done;
      }

      for (auto &fb : vec) {
        f.print("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ");
        f.print(fb.len);
        f.print("\r\n\r\n");
        f.write(fb.data, fb.len);
        f.print("\r\n");
        heap_caps_free(fb.data);
        //vTaskDelay(pdMS_TO_TICKS(1));  // feed WDT
        TASK_YIELD_MS(1);
      }
      f.print("--frame--\r\n");
      f.close();
      addSystemLog("🎞️  Saved video → " + path);

  done:
      flushInProgress = false;
      vTaskDelete(nullptr);
    },
    "vidFlush", 8192,                           // 8 kB stack
    new std::vector<FrameBuf>(std::move(buf)),  // trick: payload
    1, nullptr, 1                               /* core 1 so Wi-Fi (core 0) keeps running */
  );

  return frames > 0;
}


//---------------------------------------------
// /stream – MJPEG playback
//---------------------------------------------
void handleStream(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleStream");
  if (!isAllowed(req) || !req->hasParam("f")) {
    addSystemLog("🚫 /stream blocked (missing param or ACL)");
    return req->send(403, "text/plain", "Forbidden");
  }

  String fn = req->getParam("f")->value();
  if (fn.indexOf("..") >= 0 || !fn.endsWith(".mjpg")) {
    addSystemLog("🚫 /stream blocked (bad file name: " + fn + ")");
    return req->send(400, "text/plain", "Bad file name");
  }

  File f = LittleFS.open(fn, "r");
  if (!f || f.isDirectory()) {
    addSystemLog("⚠️  /stream → file not found: " + fn);
    return req->send(404, "text/plain", "Video not found");
  }

  size_t sz = f.size();
  f.close();

  if (sz < 100) {
    addSystemLog("⚠️  /stream → file too small: " + fn + " (" + String(sz) + " bytes)");
    return req->send(503, "text/plain", "Video file too small or invalid");
  }

  addSystemLog("📽️  /stream sending " + fn + " (" + String(sz) + " bytes)");
  AsyncWebServerResponse *resp = req->beginResponse(LittleFS, fn,
                                                    "multipart/x-mixed-replace; boundary=frame");
  req->send(resp);
}


void startVideoRecording(const String &filePath, uint32_t durationMs) {
  auto *p = new RecParams{ filePath, durationMs };
  xTaskCreate(
    videoRecordTask,
    "VidRec",
    32 * 1024,
    p,
    tskIDLE_PRIORITY + 2,  // slightly higher so it actually runs
    nullptr);
}


/* --------------------------------------------------------------------------
   Task that copies buffered frames from PSRAM to LittleFS  (runs in background)
   -------------------------------------------------------------------------- */
/*********************************************************************
 *  Background flusher – runs in its own FreeRTOS task
 *  - job  : pointer created in startVideoRecording()
 ********************************************************************/
static void videoFlushTask(void *pv) {
  addSystemLog("VidFlush started on core " + String(xPortGetCoreID()));
  auto *job = static_cast<VideoJob *>(pv);

  // 1) create the lock
  const char *LOCK = "/.flush.lock";
  File lock = LittleFS.open(LOCK, FILE_WRITE);
  if (!lock) {
    addSystemLog("⚠️  Could not create " + String(LOCK));
  } else {
    lock.close();
  }

  // ── NEW: check for enough FS space ──────────────────────────
  {
    size_t fsFree = LittleFS.totalBytes() - LittleFS.usedBytes();
    size_t need = 0;
    // sum up raw JPEG data
    for (auto &f : job->frames) need += f.len;
    // add a modest per-frame overhead for headers & boundaries
    need += job->frames.size() * 64 + 64;
    if (fsFree < need) {
      addSystemLog("⚠️  Not enough FS space: need " + String(need) + " bytes, have " + String(fsFree));
      // clean up and bail
      LittleFS.remove(LOCK);
      flushInProgress = false;
      delete job;
      vTaskDelete(nullptr);
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────

  // 2) open the MJPEG file
  File vid = LittleFS.open(job->path, FILE_WRITE);
  size_t bytesWritten = 0;
  int framesWritten = 0;
  bool abortFlush = false;

  if (!vid) {
    addSystemLog("⚠️  Cannot open " + String(job->path));
    abortFlush = true;
  } else {
    // 3) write each buffered frame
    for (size_t i = 0; i < job->frames.size(); ++i) {
      FrameBuf &f = job->frames[i];

      String header = "--frame\r\n"
                      "Content-Type: image/jpeg\r\n"
                      "Content-Length: "
                      + String(f.len) + "\r\n\r\n";
      size_t hlen = vid.print(header);
      size_t plen = vid.write(f.data, f.len);
      size_t tlen = vid.print("\r\n");

      if (hlen < header.length() || plen < f.len || tlen < 2) {
        addSystemLog("⚠️  Frame " + String(i) + " write failed, aborting flush");
        abortFlush = true;
        break;
      }

      framesWritten++;
      bytesWritten += hlen + plen + tlen;

      heap_caps_free(f.data);
      //vTaskDelay(pdMS_TO_TICKS(5));
      TASK_YIELD_MS(5);
    }
  }

  // 4) finalize or clean up on error
  if (!abortFlush) {
    bytesWritten += vid.print("--frame--\r\n");
    vid.close();
    addSystemLog("🎞️  Saved video → " + String(job->path));
    addSystemLog("Flushed " + String(framesWritten) + " frames (" + String(bytesWritten) + " bytes)");
  } else {
    if (vid) vid.close();
    if (LittleFS.remove(job->path)) {
      addSystemLog("🗑️  Incomplete file removed: " + String(job->path));
    } else {
      addSystemLog("⚠️  Failed to remove incomplete " + String(job->path));
    }
  }

  // 5) tear down
  if (LittleFS.remove(LOCK)) {
    addSystemLog("Flush lock removed");
  } else {
    addSystemLog("⚠️  Could not remove " + String(LOCK));
  }

  flushInProgress = false;

  if (!abortFlush) {
    File chk = LittleFS.open(job->path, FILE_READ);
    if (chk) {
      addSystemLog("Final file size: " + String(chk.size()) + " bytes");
      chk.close();
    }
  }

  addSystemLog("VidFlush finished " + String(abortFlush ? "with errors" : "OK") + " (" + String(framesWritten) + " good frames)");
  delete job;
  vTaskDelete(nullptr);
}


/* -----------------------------------------------------------------*/
static void videoRecordTask(void *pv) {
  auto *params = static_cast<RecParams *>(pv);

  /* ---- copy the path & duration ---- */
  char pathBuf[64];
  strlcpy(pathBuf, params->path.c_str(), sizeof(pathBuf));
  const uint32_t dur = params->durationMs;  // local copy

  /* ---- allocate the job descriptor that will be passed
            to the flush-to-LittleFS task ----                */
  auto *job = new VideoJob;
  strlcpy(job->path, pathBuf, sizeof(job->path));
  // job->frames is the empty vector already
  currentJob = job;  // <-- NEW

  /* we can delete params now, all data copied */
  delete params;

  /* ---- capture loop ---- */
  const uint32_t t0 = millis();
  size_t usedPS = 0;

  setHighPowerLED(true);

  while (millis() - t0 < dur) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) debugFramebufferAllocated(fb);
    if (!fb) {
      //vTaskDelay(pdMS_TO_TICKS(15));
      TASK_YIELD_MS(15);
      continue;
    }
    if (usedPS + fb->len > PSRAM_LIMIT) {
      debugFramebufferReleased(fb);
      esp_camera_fb_return(fb);
      break;
    }

    uint8_t *copy = (uint8_t *)heap_caps_malloc(
      fb->len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!copy) {
      debugFramebufferReleased(fb);
      esp_camera_fb_return(fb);
      break;
    }

    memcpy(copy, fb->buf, fb->len);
    debugFramebufferReleased(fb);
    esp_camera_fb_return(fb);

    /* ---------- push frame into the job ---------- */
    job->frames.push_back({ copy, fb->len });
    usedPS += fb->len;

    //vTaskDelay(1);
    TASK_YIELD_MS(1);
  }

  setHighPowerLED(false);
  addSystemLog("PSRAM free: " + String(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)));

  /* ---- hand the job to the flusher ---- */
  flushInProgress = true;
  xTaskCreate(
    videoFlushTask,        // task entry
    "VidFlush",            // name
    16 * 1024,             // stack
    job,                   // parameter
    tskIDLE_PRIORITY + 1,  // priority
    nullptr);              // handle

  vTaskDelete(nullptr);  // recording task ends here
}

//---------------------------------------------
void handleDownloadRaw(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleDownloadRaw");
  if (!isAllowed(req) || !req->hasParam("f")) {
    addSystemLog("🚫 /download blocked (ACL or missing param)");
    return req->send(403, "text/plain", "Forbidden");
  }

  String path = req->getParam("f")->value();
  if (!path.startsWith(CAPTURE_DIR)) {
    path = String(CAPTURE_DIR) + "/" + path;
  }

  if (path.indexOf("..") >= 0 || !path.endsWith(".mjpg")) {
    addSystemLog("🚫 /download bad file name: " + path);
    return req->send(400, "text/plain", "Bad filename");
  }

  File src = LittleFS.open(path, "r");
  if (!src || src.isDirectory()) {
    addSystemLog("⚠️  /download not found: " + path);
    return req->send(404, "text/plain", "File not found");
  }

  size_t sz = src.size();
  if (sz < 100) {
    addSystemLog("⚠️  /download file too small: " + path + " (" + String(sz) + " bytes)");
    src.close();
    return req->send(503, "text/plain", "File is invalid or incomplete");
  }

  addSystemLog("⬇️  Downloading " + path + " (" + String(sz) + " bytes)");

  // Reopen to stream properly from the beginning
  src.close();
  File file = LittleFS.open(path, "r");

  AsyncWebServerResponse *resp = req->beginChunkedResponse(
    "video/x-motion-jpeg",
    [file](uint8_t *buf, size_t maxLen, size_t index) mutable -> size_t {
      if (!file || !file.available()) {
        if (file) file.close();
        return 0;
      }
      return file.read(buf, maxLen);
    });

  String base = path.substring(path.lastIndexOf('/') + 1);
  resp->addHeader("Content-Disposition", "attachment; filename=\"" + base + "\"");
  req->send(resp);
}


// 1) Add this handler somewhere in your setupEndpoints():
void handleView(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleView");
  if (!isAllowed(req) || !req->hasParam("f")) {
    return req->send(403, "text/plain", "Forbidden");
  }
  String path = req->getParam("f")->value();  // e.g. "/captures/vid_… .mjpg"
  // sanity: must live under /captures/
  if (!path.startsWith(String(CAPTURE_DIR) + "/") || !LittleFS.exists(path)) {
    logPath("handleView path: ", path);
    return req->send(404, "text/plain", "Not found");
  }

  // stream as MJPEG
  AsyncWebServerResponse *resp = req->beginResponse(
    LittleFS,
    path,
    "multipart/x-mixed-replace;boundary=frame");
  req->send(resp);
}


// ---------------------------------------------------------------------------
void handleViewClip(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleViewClip");
  if (!isAllowed(req) || !req->hasParam("f")) {
    addSystemLog("🚫 /view blocked (ACL or missing param)");
    return req->send(403, "text/plain", "Forbidden");
  }

  String fn = req->getParam("f")->value();
  if (fn.indexOf("..") >= 0 || !fn.endsWith(".mjpg")) {
    addSystemLog("🚫 /view bad file name: " + fn);
    return req->send(400, "text/plain", "Bad file name");
  }

  String path = fn.startsWith("/") ? fn : ("/captures/" + fn);
  File test = LittleFS.open(path, "r");
  if (!test || test.isDirectory()) {
    addSystemLog("⚠️  /view missing file: " + path);
    return req->send(404, "text/plain", "Video not found");
  }
  size_t sz = test.size();
  test.close();

  addSystemLog("🎬 Viewing " + path + " (" + String(sz) + " bytes)");

  String html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>" + fn + "</title>"
                                                                      "<style>body{margin:0;background:#000;color:#fff;font-family:sans-serif;}"
                                                                      ".controls{position:absolute;top:10px;left:10px;z-index:2}"
                                                                      ".controls button{background:#444;border:none;color:#ddd;padding:8px 12px;margin-right:6px;cursor:pointer;}"
                                                                      "#streamImg{width:100vw;height:100vh;object-fit:contain;}</style></head><body>"
                                                                      "<div class='controls'>"
                                                                      "<button onclick=\"play()\">▶️ Play</button>"
                                                                      "<button onclick=\"pause()\">⏸️ Pause</button>"
                                                                      "<a href='/download?f="
    + path + "' download style='color:#0af;margin-left:8px;'>⬇️ Download</a>"
             //"<a href='" + path + "' download style='color:#0af;margin-left:8px;'>⬇️ Download</a>"
             "</div>"
             "<img id='streamImg' src='/stream?f="
    + path + "'>"
             "<script>"
             "function play(){document.getElementById('streamImg').src='/stream?f="
    + path + "';}"
             "function pause(){document.getElementById('streamImg').src='';}"
             "</script></body></html>";

  req->send(200, "text/html", html);
}


void handleStreamClip(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleStreamClip");
  if (!isAllowed(req) || !req->hasParam("f")) {
    req->send(403, "text/plain", "Forbidden");
    return;
  }
  String fn = req->getParam("f")->value();
  if (fn.indexOf("..") >= 0 || !fn.endsWith(".mjpg")) {
    req->send(400, "text/plain", "Bad name");
    return;
  }
  String path = String(CAPTURE_DIR) + "/" + fn;
  // Stream it as multipart MJPEG
  AsyncWebServerResponse *response = req->beginResponse(LittleFS, path,
                                                        "multipart/x-mixed-replace; boundary=frame");
  response->addHeader("Connection", "close");
  req->send(response);
}

// --- Servo Settings Page Handlers (with Hamburger Menu preserved) ---

// Ensure these globals exist somewhere in your main sketch:
// uint16_t servoStartUS;
// uint16_t servoEndUS;
// bool disableServo = false;    // global flag to gate servo movement

// --- Global Definitions (add to the top of your main .ino file) ---
// Default start/end values and disable flag for the servo
//uint16_t servoStartUS = 2046;
//uint16_t servoEndUS = 1058;


// --- Servo Settings Page Handlers (with Hamburger Menu preserved) ---
void handleServoSettingsPage(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleServoSettingsPage");
  if (!isAllowed(req)) {
    req->send(403, "text/plain", "Forbidden");
    return;
  }

  // Load persisted values
  preferences.begin("settings", false);
  int currentStart = preferences.getUInt("servoStart", servoStartUS);
  int currentEnd = preferences.getUInt("servoEnd", servoEndUS);
  bool currentDisable = preferences.getBool("disableServo", false);
  preferences.end();

  // Build the page
  String html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<title>Servo Settings</title>"
    "<style>"
    "body{background:#222;color:#ddd;font-family:Arial;padding:10px}"
    "label{display:block;margin-top:10px}"
    "input{margin-left:10px;width:100px}"
    "button{margin-top:20px;padding:6px 12px;margin-left:10px}"
    "#servoSlider{width:300px;}"
    "</style></head><body>";

  html += getHamburgerMenuHTML();
  html += "<h1>Servo Settings</h1>";

  // Settings form
  html += "<form id='servoForm'>";
  html += "<label>Start Position (&micro;s):"
          "<input type='number' name='start' id='startInput' value='"
          + String(currentStart) + "' oninput='syncSlider(this.value)'>"
                                   "<button type='button' onclick='setFromSlider(\"startInput\", true)'>Set</button></label>";
  html += "<label>End Position (&micro;s):"
          "<input type='number' name='end' id='endInput' value='"
          + String(currentEnd) + "' oninput='syncSlider(this.value)'>"
                                 "<button type='button' onclick='setFromSlider(\"endInput\", true)'>Set</button></label>";

  html += "<label><input type='checkbox' name='disableServo'";
  if (currentDisable) html += " checked";
  html += "> Disable Servo</label>";
  html += "</form>";

  // Live-control slider, Save/Test buttons, script
  html += R"rawliteral(
<h2>Live Control</h2>
<input type="range" id="servoSlider" min="500" max="2500" value="1500"
       oninput="updateServo(this.value)">
<span id="servoVal">1500</span> µs
<br><br>
<button type="button" onclick="saveSettings()">Save</button>
<button type="button"
        onclick="fetch('/servo').then(()=>alert('Servo triggered'))">Test Servo</button>
<br><br>
<a href="/">⬅︎ Back</a>

<script>
function updateServo(val){
  document.getElementById('servoVal').innerText = val;
  fetch('/servoSet?val=' + val);
}
function setFromSlider(inputId, updateSlider){
  const sliderVal = document.getElementById('servoSlider').value;
  document.getElementById(inputId).value = sliderVal;
  if (updateSlider) {
    updateServo(sliderVal);
  }
}
function syncSlider(val){
  document.getElementById('servoSlider').value = val;
  updateServo(val);
}
function saveSettings(){
  const form = document.getElementById('servoForm');
  const data = new URLSearchParams(new FormData(form));
  fetch('/setServoSettings', {method:'POST', body:data})
    .then(resp => resp.ok ? location.reload() : alert('Save failed'));
}
</script>
)rawliteral";

  html += "</body></html>";

  req->send(200, "text/html", html);
}



// Handle form submission to save Servo Settings
void handleServoSettingsSave(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleServoSettingsSave");
  if (!isAllowed(req)) {
    req->send(403, "text/plain", "Forbidden");
    return;
  }
  /* ───── pull form fields ─────────────────────────────────────────────── */
  int newStart = req->hasParam("start", true)
                   ? req->getParam("start", true)->value().toInt()
                   : servoStartUS;

  int newEnd = req->hasParam("end", true)
                 ? req->getParam("end", true)->value().toInt()
                 : servoEndUS;

  bool newDisable = (req->hasParam("disableServo", true) && req->getParam("disableServo", true)->value() == "on");

  /* ───── persist & log only when values change ───────────────────────── */
  preferences.begin("settings", false);

  if (newStart != servoStartUS) {
    servoStartUS = newStart;
    preferences.putUInt("servoStart", newStart);
    addSystemLog("🛠️ servoStartUS → " + String(newStart) + " µs");
  }

  if (newEnd != servoEndUS) {
    servoEndUS = newEnd;
    preferences.putUInt("servoEnd", newEnd);
    addSystemLog("🛠️ servoEndUS   → " + String(newEnd) + " µs");
  }

  if (newDisable != disableServo) {
    disableServo = newDisable;
    preferences.putBool("disableServo", newDisable);
    addSystemLog(String("🛠️ disableServo → ") + (newDisable ? "true" : "false"));
  } else {
    /* still persist so the flag survives reboot */
    preferences.putBool("disableServo", newDisable);
  }

  preferences.end();
  req->send(200, "text/plain", "OK");
}



// Call this at the very top of setup() so we archive the last run's logs…
// Keeps TWO generations of previous logs for troubleshooting multi-reboot flows
// (e.g., registration attempt → reboot → standalone mode → reboot → check logs)
void rotateLogs() {
  // if there's a logs file from the last run…
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


// 3) Add these two new handlers somewhere below your other `handle…()` fns:
// ----------------------------------------------------------------------------

// 3a) Show the logs from the *previous* run:
void handlePreviousLogs(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handlePreviousLogs");
  if (!isAllowed(req)) {
    req->send(403, "text/plain", "Forbidden");
    return;
  }
  logRequest(req);
  String page =
    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Previous Logs</title>"
    "</head><body style='background:#222;color:#ddd;font-family:Arial;'>"
    + getHamburgerMenuHTML() + "<h1>Previous System Logs</h1><pre>";

  File f = LittleFS.open("/prevLogs.txt", "r");
  if (f) {
    int linesOut = 0;
    while (f.available()) {
      page += f.readStringUntil('\n') + "\n";
      NET_YIELD_EVERY(linesOut++, 8);
    }
    f.close();
  } else {
    page += "No previous logs found.\n";
  }

  page += "</pre><a href='/' style='color:#0af;'>Back</a>"
          "</body></html>";
  req->send(200, "text/html", page);
}


// 3b) Display runtime status (heap, FS, CPU, uptime…)
// ──────────────────────────────────────────────────────────────
//  /systemStatus  – show heap, PSRAM and LittleFS utilisation
// ──────────────────────────────────────────────────────────────
void handleSystemStatus(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleSystemStatus");
  if (!isAllowed(req)) {
    return req->send(403, "text/plain", "Forbidden");
  }
  if (flushInProgress) {
    return req->send(503, "text/plain",
                     "System Status unavailable: flushing video");
  }
  logRequest(req);

  // ── core stats ────────────────────────────────────────────────
  size_t heapFree = ESP.getFreeHeap();
  size_t heapTotal = ESP.getHeapSize();
  size_t heapUsed = heapTotal - heapFree;

  size_t psramTotal = psramFound() ? ESP.getPsramSize() : 0;
  size_t psramFree = psramFound() ? ESP.getFreePsram() : 0;
  size_t psramUsed = psramTotal ? (psramTotal - psramFree) : 0;

  size_t fsTotal = LittleFS.totalBytes();
  size_t fsUsed = LittleFS.usedBytes();

  uint32_t freqMHz = ESP.getCpuFreqMHz();
  uint32_t upSec = millis() / 1000;

  preferences.begin("settings", false);
  uint32_t fwEpoch = preferences.getULong("fw_epoch", 0);
  preferences.end();

  String fwTime;

  if (fwEpoch == 0) {
    fwTime = "— never —";
  } else {
    time_t t = (time_t)fwEpoch;  // properly widen to time_t
    struct tm tm;
    localtime_r(&t, &tm);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm);
    fwTime = String(buf);
  }


  // ── scan captures ─────────────────────────────────────────────
  struct FileInfo {
    String name;
    size_t size;
  };
  std::vector<FileInfo> entries;
  File dir = LittleFS.open(CAPTURE_DIR, "r");
  if (dir) {
    while (File f = dir.openNextFile()) {
      if (!f.isDirectory()) {
        entries.push_back({ String(f.name()), f.size() });
      }
    }
    dir.close();
    std::sort(entries.begin(), entries.end(),
              [](const FileInfo &a, const FileInfo &b) {
                return a.name > b.name;
              });
  }

  // ── build page ────────────────────────────────────────────────
  String page = R"rawliteral(
<!DOCTYPE html><html><head><meta charset='utf-8'>
<title>Status</title>
<style>
  body{background:#222;color:#ddd;font-family:Arial;padding:10px}
  ul{list-style:none;padding:0} li{margin:4px 0}
</style></head><body>
)rawliteral";

  page += getHamburgerMenuHTML();
  page += "<h1>System Status</h1><ul>";
  page += "<li><strong>Heap (DRAM):</strong> " + String(heapUsed)
          + " / " + String(heapTotal) + " bytes</li>";
  page += "<li><strong>PSRAM:</strong>     " + String(psramUsed)
          + " / " + String(psramTotal) + " bytes</li>";
  page += "<li><strong>LittleFS:</strong>  " + String(fsUsed)
          + " / " + String(fsTotal) + " bytes</li>";
  page += "<li><strong>CPU Freq:</strong>  " + String(freqMHz)
          + " MHz</li>";
  page += "<li><strong>Uptime:</strong>    " + String(upSec)
          + " s</li>";
  page += "<li><strong>Last FW update:</strong> " + fwTime + "</li>";
  page += "<li><strong>Servo start position:</strong> "
          + String(servoStartUS) + " µs</li>";
  page += "<li><strong>Servo end position:</strong>   "
          + String(servoEndUS) + " µs</li>";
  page += "</ul>";

  page += "<h2>Files in /captures</h2><ul>";
  for (auto &e : entries) {
    float mb = e.size / 1024.0 / 1024.0;
    page += "<li>" + e.name + " (" + String(mb, 2) + " MB)</li>";
    NET_YIELD();
  }
  page += "</ul>";

  // Add claim status and unclaim button
  page += "<h2>Device Claim Status</h2>";
  if (deviceClaimed) {
    page += "<ul>";
    page += "<li><strong>Status:</strong> <span style='color:#0f0'>✓ Claimed</span></li>";
    page += "<li><strong>Device Name:</strong> " + claimedDeviceName + "</li>";
    page += "<li><strong>Device ID:</strong> " + claimedDeviceId + "</li>";
    page += "<li><strong>MQTT Broker:</strong> " + claimedMqttBroker + "</li>";
    page += "<li><strong>MQTT Connected:</strong> " + String(mqttReallyConnected ? "Yes" : "No") + "</li>";
    page += "</ul>";
    page += "<p><a href='/claim' style='color:#f00;text-decoration:none;padding:8px 16px;background:#444;border-radius:4px;display:inline-block'>Unclaim Device</a></p>";
  } else {
    page += "<p style='color:#fa0'>⚠ Device Not Claimed</p>";
    page += "<p><a href='/claim' style='color:#0bf;text-decoration:none;padding:8px 16px;background:#444;border-radius:4px;display:inline-block'>Claim Device</a></p>";
  }

  page += "<a href='/'>⬅︎ Back</a></body></html>";

  req->send(200, "text/html", page);
}



/*************************************************
 *  alertFunction – called when the trap trips
 *************************************************/
void alertFunction() {
  const time_t now = time(nullptr);
  if (!eventArmed) return;  // already shot our two photos
  eventArmed = false;       // disarm for this event

  /*  ----------  rate-limit the whole routine  ----------  */
  if (lastAlertTime != 0 && (now - lastAlertTime) < 30) {  // 30-s minimum gap
    return;
  }
  lastAlertTime = now;

  /*  ----------  build filename & save to LittleFS  ----------  */
  char ts[20];
  struct tm tmNow;
  localtime_r(&now, &tmNow);
  strftime(ts, sizeof(ts), "%Y%m%d_%H%M", &tmNow);

  if (!videoMode) {  // ← still-photo branch unchanged
    if (!disableServo) {
      triggerServo();
      TASK_YIELD_MS(500);
    }
    String path1 = String(CAPTURE_DIR) + "/img_" + ts + "_a.jpg";
    captureSingleFrame(path1);

    //vTaskDelay(pdMS_TO_TICKS(1000));
    TASK_YIELD_MS(1000);
    String path2 = String(CAPTURE_DIR) + "/img_" + ts + "_b.jpg";
    captureSingleFrame(path2);
    homePreview = path2;  // show on dashboard
  } else {                // ← video branch
    String vPath = String(CAPTURE_DIR) + "/vid_" + ts + ".mjpg";
    if (!disableServo) {
      triggerServo();
      TASK_YIELD_MS(500);
    }
    startVideoRecording(vPath, 10 * 1000);  // 10-s clip
    addSystemLog("Video recording task started → " + vPath);
  }

  /*  ----------  e-mail notification (rate-limited like before)  ----------  */
  if ((now - lastEmailTime > 3600) || !lastEmailSuccess) {
    HTTPClient http;
    // Same base you use for notifyBootIP()
    String url = String(emailServer) + "/mouse-trap";

    if (http.begin(url)) {
      http.addHeader("Content-Type", "application/json");

      // Build JSON like notifyBootIP(), but NO crash object and NO boot trapId.
      JsonDocument doc;
      doc["event"] = "trigger";                          // <-- lets server mark ALERT
      doc["status"] = "Trap triggered";                  // free text for email body
      doc["mac"]    = WiFi.macAddress();
      doc["lan"]    = WiFi.localIP().toString();
      if (PUBLIC_IP.length()) doc["wan"] = PUBLIC_IP;

      // Keep your image link if you want it in the email/logs
      doc["imageUrl"] = String("http://") + WiFi.localIP().toString()
                        + String("/captures/img_") + String(ts) + String(".jpg");

      String body; serializeJson(doc, body);
      http.setTimeout(1500);
      Serial.print("[ALERT] POST /mouse-trap body: ");
      Serial.println(body);
      addSystemLog("[ALERT] POST /mouse-trap body: ");
      addSystemLog(body);

      int code = http.POST(body);
      Serial.printf("[ALERT] http rc=%d\n", code);
      
      if (code > 0 && code < 400) {
        addSystemLog("Alert POST OK (HTTP " + String(code) + ")");
        lastEmailSuccess = true;
      } else {
        addSystemLog("Alert POST FAIL (HTTP " + String(code) + ")");
        lastEmailSuccess = false;
      }
      http.end();
    } else {
      addSystemLog("Alert POST FAIL (begin error)");
      lastEmailSuccess = false;
    }
    lastEmailTime = now;
  }

  /*  ----------  MQTT alert notification  ----------  */
  if (mqttClient.connected()) {
    String alertTopic = "tenant/" + claimedTenantId + "/device/" + claimedMqttClientId + "/alert";

    JsonDocument alertDoc;
    alertDoc["alert_type"] = "trap_triggered";
    alertDoc["message"] = "Motion detected";
    alertDoc["severity"] = "high";
    alertDoc["timestamp"] = now;

    String alertPayload;
    serializeJson(alertDoc, alertPayload);

    mqttClient.publish(alertTopic.c_str(), alertPayload.c_str());
    Serial.println("[MQTT] Published alert: " + alertPayload);
    addSystemLog("[MQTT] Alert published to broker");

    // Upload captured image via MQTT
    if (!videoMode && homePreview.length() > 0) {
      Serial.println("[MQTT] Uploading snapshot: " + homePreview);
      addSystemLog("[MQTT] Uploading snapshot via MQTT");

      File imgFile = LittleFS.open(homePreview, "r");
      if (imgFile) {
        size_t fileSize = imgFile.size();
        Serial.printf("[MQTT] Image size: %d bytes\n", fileSize);

        if (fileSize > 0 && fileSize < 200000) {  // Max ~200KB
          uint8_t* imgData = (uint8_t*)malloc(fileSize);
          if (imgData) {
            size_t bytesRead = imgFile.read(imgData, fileSize);
            imgFile.close();

            if (bytesRead == fileSize) {
              // Publish image via MQTT
              String snapshotTopic = "tenant/" + claimedTenantId + "/device/" + claimedMqttClientId + "/camera/snapshot";

              // Create JSON with metadata and base64 image
              JsonDocument snapshotDoc;
              snapshotDoc["timestamp"] = now;
              snapshotDoc["filename"] = homePreview.substring(homePreview.lastIndexOf('/') + 1);
              snapshotDoc["size"] = fileSize;

              // Base64 encode image
              String base64Image = b64Enc(imgData, fileSize);
              snapshotDoc["image"] = base64Image;

              String snapshotPayload;
              serializeJson(snapshotDoc, snapshotPayload);

              bool published = mqttClient.publish(snapshotTopic.c_str(), snapshotPayload.c_str());
              if (published) {
                Serial.println("[MQTT] Snapshot uploaded successfully");
                addSystemLog("[MQTT] Snapshot uploaded to broker");
              } else {
                Serial.println("[MQTT] Failed to publish snapshot");
                addSystemLog("[MQTT] Snapshot upload FAILED");
              }
            }
            free(imgData);
          } else {
            Serial.println("[MQTT] Failed to allocate memory for image");
            addSystemLog("[MQTT] Snapshot upload FAILED - no memory");
            imgFile.close();
          }
        } else {
          Serial.printf("[MQTT] Image size invalid: %d bytes\n", fileSize);
          addSystemLog("[MQTT] Snapshot upload FAILED - invalid size");
          imgFile.close();
        }
      } else {
        Serial.println("[MQTT] Failed to open image file: " + homePreview);
        addSystemLog("[MQTT] Snapshot upload FAILED - file not found");
      }
    }
  } else {
    Serial.println("[MQTT] Cannot publish alert - not connected");
    addSystemLog("[MQTT] Alert NOT published - disconnected");
  }

  /*  ----------  e-mail notification (rate-limited like before)  ----------  */
  // if ((now - lastEmailTime > 3600) || !lastEmailSuccess) {
  //   WiFiClient client;
  //   HTTPClient http;

  //   // Ensure this is set globally to: "http://<server>:3000/mouse-trap"
  //   // const String url = String(emailServer) + String(emailResource);

  //   if (http.begin(client, url)) {
  //     http.addHeader("Content-Type", "application/json");

  //     // Gather MAC/IP
  //     String mac = WiFi.macAddress();
  //     mac.toUpperCase();
  //     String ip = WiFi.localIP().toString();

  //     // Build JSON
  //     // If you prefer static sizing: StaticJsonDocument<320> doc;
  //     JsonDocument doc;
  //     doc["trapId"] = "trap1";
  //     doc["status"] = "mouseCaught";
  //     doc["mac"] = mac;  // ← include MAC
  //     doc["ip"] = ip;    // ← include IP (LAN)
  //     doc["imageUrl"] = String("http://") + WiFi.localIP().toString()
  //                       + String("/captures/img_") + String(ts) + String(".jpg");

  //     String body;
  //     serializeJson(doc, body);
  //     http.setTimeout(1500);

  //     int code = http.POST(body);
  //     if (code > 0 && code < 400) {
  //       addSystemLog("E-mail OK (HTTP " + String(code) + ")");
  //       lastEmailSuccess = true;
  //     } else {
  //       addSystemLog("E-mail FAIL (HTTP " + String(code) + ")");
  //       lastEmailSuccess = false;
  //     }
  //     http.end();
  //   } else {
  //     addSystemLog("E-mail FAIL (HTTP begin error)");
  //     lastEmailSuccess = false;
  //   }
  //   lastEmailTime = now;
  // }

  /*  ----------  audible “chirp”  ----------  */
  for (int i = 0; i < 3; ++i) {
    tone(BUZZER_PIN, 300);
    //vTaskDelay(pdMS_TO_TICKS(100));
    TASK_YIELD_MS(100);
    noTone(BUZZER_PIN);
    //vTaskDelay(pdMS_TO_TICKS(100));
    TASK_YIELD_MS(100);
  }

  /*  ----------  clean-up  ----------  */
  // esp_camera_fb_return(fb);
}






void setLED(bool state) {
  if (state) {
    if (!ledState) {
      ledOnTimestamp = millis();
    }
    digitalWrite(LED_PIN, HIGH);
    ledState = true;
  } else {
    digitalWrite(LED_PIN, LOW);
    ledState = false;
    ledOnTimestamp = 0;
  }
}



void handleToggleLED(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleToggleLED");
  // Toggle the NEW LED
  setHighPowerLED(!highPowerLedState);
  // Respond with its new state
  String msg = (highPowerLedState ? "ON" : "OFF");
  request->send(200, "text/plain", msg);
}

void handleLEDStatus(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleLEDStatus");
  // Report the NEW LED state
  String status = (highPowerLedState ? "ON" : "OFF");
  request->send(200, "text/plain", status);
}


void sensorTaskFunction(void *pvParameters) {
  Serial.println("Sensor task started.");
  if (!sensorFound) {
    for (;;) {
      if (!CrashKit::pageActive()) {
        CrashKit::markPage("sensorTask");
        CrashKit::markLine(1);
      }
      //vTaskDelay(pdMS_TO_TICKS(1000));
      TASK_YIELD_MS(1000);
      //yield();
    }
  }
  unsigned long lastHeartbeat = millis();
  hourStartTime = time(nullptr);
  currentHourSum = 0;
  currentHourCount = 0;

  for (;;) {
    NET_YIELD();  // Allow background tasks to run
    //uint8_t currentRange = vl.readRange();
    debugI2CTransactionStart(I2C_SENSOR_VL6180X);
    uint16_t currentRange16 = readToF_mm_once();
    uint8_t currentRange = (currentRange16 > 255) ? 255 : (uint8_t)currentRange16;
    range = currentRange;

    // Record I2C transaction result
    bool i2cSuccess = (currentRange16 > 0 && currentRange16 < 0xFFFF);
    debugI2CTransactionEnd(I2C_SENSOR_VL6180X, i2cSuccess, i2cSuccess ? 0 : 1);

    bool sensorState;

    /* in sensorTaskFunction() just before you test (range < threshold) */
    if (millis() - calibDoneMillis < 2000) {  // ignore for 2 s after calib
      sensorState = false;
    } else {
      if (range == 0) {
        // read error or timeout → skip
        continue;
      } else {
        int useThreshold = (overrideThreshold > 0) ? overrideThreshold : threshold;
        sensorState = (range < useThreshold);
      }
    }

    // ---------- NEW: trigger photo on first detection ----------
    sensorState = (range < threshold);
    time_t now = time(nullptr);
    static time_t lastSecondUpdate = 0;

    if (!detectionState && sensorState) {
      detectionState = true;
      addSystemLog(String("🐁 Trap triggered! Range: ") + range + " mm (threshold: " + threshold + " mm)");
      alertFunction();
      //captureAndStorePhoto();            // <‑‑ flash & save
      lastAlertTime = 0;  // reset alert timing
    }
    if (now - lastSecondUpdate >= 1) {
      currentHourSum += range;
      currentHourCount++;
      lastSecondUpdate = now;
    }
    if (now - hourStartTime >= ONE_HOUR) {
      float hourAvg = (currentHourCount > 0) ? (currentHourSum / currentHourCount) : 0;
      weeklyAverages[currentHourIndex] = hourAvg;
      currentHourIndex = (currentHourIndex + 1) % WEEK_HOURS;
      currentHourSum = 0;
      currentHourCount = 0;
      hourStartTime = now;
      Serial.println("Hourly average updated: " + String(hourAvg));
    }

    //Heartbeat log every 5 seconds.
    if (millis() - lastHeartbeat >= 5000) {
      Serial.println("Sensor task heartbeat");
      lastHeartbeat = millis();
    }

    if (currentHourCount > 0) {
      float runningAvg = currentHourSum / currentHourCount;
      if ((range < threshold) && (now - lastAnomalyTime >= ANOMALY_MIN_INTERVAL) && (abs((int)range - (int)runningAvg) >= 30)) {
        if (anomalyCount < MAX_ANOMALIES) {
          anomalyEvents[anomalyCount].timestamp = now;
          anomalyEvents[anomalyCount].reading = range;
          anomalyCount++;
        } else {
          for (int i = 1; i < MAX_ANOMALIES; i++) {
            anomalyEvents[i - 1] = anomalyEvents[i];
          }
          anomalyEvents[MAX_ANOMALIES - 1].timestamp = now;
          anomalyEvents[MAX_ANOMALIES - 1].reading = range;
        }
        lastAnomalyTime = now;
        Serial.println("Anomaly logged: " + String(range) + " mm at " + String(now));
      }
    }
    static unsigned long lastLogTime = 0;
    static uint8_t lastLoggedRange = 0;
    static unsigned long lastSystemLogTime = 0;
    if ((millis() - lastLogTime > 60000) || (abs((int)range - (int)lastLoggedRange) > 5)) {
      //uint8_t status = vl.readRangeStatus();
      uint8_t status = readToFStatus();

      Serial.print("Range: ");
      Serial.print(range);
      Serial.print(" mm, Status: ");
      Serial.println(status);

      // Add to system log every 5 minutes (not every minute to avoid log spam)
      if (millis() - lastSystemLogTime > 300000) {  // 5 minutes
        addSystemLog(String("Sensor reading: ") + range + " mm (threshold: " + threshold + " mm)");
        lastSystemLogTime = millis();
      }

      lastLogTime = millis();
      lastLoggedRange = range;
    }

    //bool sensorState = (range < threshold);
    if (!detectionState && sensorState) {
      Serial.println("Object Detected!");
      addSystemLog("Object detected.");
      detectionState = true;
      lastAlertTime = 0;
    }
    if (detectionState) {
      if (!manualControlActive) {
        if (millis() - lastLEDToggleTime >= 200) {
          digitalWrite(LED_PIN, HIGH);
          //vTaskDelay(pdMS_TO_TICKS(50));
          TASK_YIELD_MS(50);
          digitalWrite(LED_PIN, LOW);
          lastLEDToggleTime = millis();
        }
      }
      alertFunction();
    } else {
      if (!manualControlActive) {
        digitalWrite(LED_PIN, LOW);
      }
    }
    NET_YIELD();
    //vTaskDelay(pdMS_TO_TICKS(100));
    TASK_YIELD_MS(100);
  }
}


// --------------------
// Web Request Handlers
// --------------------
void handleRoot(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleRoot");

  // In AP mode (captive portal), redirect to setup wizard
  if (isAPMode) {
    Serial.println("[ROOT] AP mode detected - redirecting to setup");
    request->redirect("/app/#/setup");
    return;
  }

  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    String tStr = formatTime(time(nullptr));
    String ip = request->client()->remoteIP().toString();
    addAccessLog(tStr + " - " + ip + " was blocked");
    return;
  }
  logRequest(request);

  String displayName = (claimedDeviceName.length() > 0) ? claimedDeviceName : "MouseTrap";
  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<title>" + displayName + "</title>";
  html += "<style>";
  html += "body { background-color: #222; color: #ddd; font-family: Arial, sans-serif; margin: 0; padding: 10px; }";
  html += ".container { display: flex; flex-direction: column; align-items: center; }";
  html += ".chart-container { width: 100%; max-width: 600px; height: 200px; }";
  html += ".camera-container { margin-bottom: 20px; }";
  html += ".button-container { text-align: center; margin-top: 10px; }";
  html += ".camera-button { background-color: #444; color: #ddd; border: none; padding: 10px 20px; margin: 5px; cursor: pointer; font-size: 16px; width: 150px; }";
  html += ".camera-button:hover { background-color: #555; }";
  html += "#triggerIndicator { display: none; font-size: 24px; color: red; animation: flash 1s infinite; margin: 10px; }";
  html += "@keyframes flash { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }";
  html += "</style></head><body>";
  html += getHamburgerMenuHTML();
  html += "<div class='container'>";
  html += "<div class='camera-container'>";
  String imgSrc = homePreview.length() ? homePreview : "/auto.jpg";
  html += "  <img id='cameraImage' src='" + imgSrc + "' "
                                                     "style='width:100%; max-width:600px; height:auto; display:block; margin:0 auto;' "
                                                     "onerror='retryPreview();'><br>";
  html += "  <div class='button-container'>";
  html += "    <button class='camera-button' onclick='refreshCamera()'>Refresh</button>";
  html += "    <button class='camera-button' id='liveButton' onclick='toggleLive()'>Live Off</button>";
  html += "    <button class='camera-button' id='toggleLEDButton' onclick='toggleLED()'>Toggle LED</button>";
  html += "  </div>";
  html += "</div>";
  html += "<div id='triggerIndicator'>TRAP TRIGGERED!</div>";
  html += "<h1>" + displayName + "</h1>";
  html += "<div class='chart-container'><canvas id='rangeChart'></canvas></div>";
  html += "<h2>Anomalous Events</h2>";
  html += "<ul id='anomalyList'></ul>";
  // html += "<button onclick='fetch(\"/reset\")'>Reset Alarm</button>";
  html += "<div class='button-container'>";
  html += "  <button class='camera-button' onclick='fetch(\"/reset\")'>Reset Alarm</button>";
  html +=   "<button class='camera-button' onclick=\"fetch('/falseAlarm')"
            ".then(r=>r.json())"
            ".then(j=>{"
            "document.getElementById('falseOffDisplay').innerText=j.falseOff;"
            "document.getElementById('thresholdDisplay').innerText=j.threshold;"
            "initThresh=j.threshold;"
            "});\">False Alarm</button>";
  html += "</div>";
  html += "<div class='button-container'>";
  html += "  <button class='camera-button' onclick='sendHeartbeat()'>Send Heartbeat</button>";
  html += "</div>";

  // Add claim link if device is unclaimed
  if (!deviceClaimed) {
    html += "<div style='margin-top: 20px; padding: 15px; background: #fff3cd; color: #856404; border-radius: 5px; text-align: center;'>";
    html += "⚠️ <strong>Device Not Claimed</strong><br>";
    html += "<a href='/claim' style='color: #007bff; text-decoration: none; font-weight: bold;'>Click here to claim this device</a>";
    html += "</div>";
  }

  html += "</div>";
  html += "<script src='https://cdn.jsdelivr.net/npm/chart.js'></script>";
  html += "<script>";
  html += "var liveMode = false; var liveTimer = null;";
  html += "function refreshCamera() {";
  html += "  console.log('Refresh button clicked');";
  html += "  var url = (typeof liveMode !== 'undefined' && liveMode) ? '/camera' : '/auto.jpg';";
  html += "  document.getElementById('cameraImage').src = url + '?t=' + new Date().getTime();";
  html += "}";
  html += "function sendHeartbeat(){";
  html += "  fetch('/sendHeartbeat?t=' + Date.now())";
  html += "    .then(r => r.json())";
  html += "    .then(_ => console.log('Heartbeat triggered'))";
  html += "    .catch(err => console.error('sendHeartbeat failed', err));";
  html += "}";
  html += "function retryPreview(){";
  html += "  setTimeout(refreshCamera, 500);";  // retry after 0.5 s
  html += "}";
  html += "function toggleLive() {";
  html += "  console.log('Toggle Live button clicked');";
  html += "  liveMode = !liveMode;";
  html += "  var btn = document.getElementById('liveButton');";
  html += "  if (liveMode) {";
  html += "    btn.textContent = 'Live On';";
  html += "    liveTimer = setInterval(refreshCamera, 100);";
  html += "  } else {";
  html += "    btn.textContent = 'Live Off';";
  html += "    clearInterval(liveTimer);";
  html += "  }";
  html += "}";
  html += "function toggleLED() {";
  html += "  console.log('Toggle LED button clicked');";
  html += "  fetch('/toggleLED?t=' + new Date().getTime())";
  html += "    .then(response => response.text())";
  html += "    .then(result => {";
  html += "      console.log('ToggleLED response: ' + result);";
  html += "      document.getElementById('toggleLEDButton').innerText = 'LED is ' + result;";
  html += "    })";
  html += "    .catch(err => console.error(err));";
  html += "}";
  html += "function updateLEDStatus() {";
  html += "  fetch('/ledStatus?t=' + new Date().getTime())";
  html += "    .then(response => response.text())";
  html += "    .then(result => {";
  html += "      document.getElementById('toggleLEDButton').innerText = 'LED is ' + result;";
  html += "    })";
  html += "    .catch(err => console.error(err));";
  html += "}";
  html += "setInterval(updateLEDStatus, 5000);";
  html += "function updateTrapStatus() {";
  html += "  fetch('/data?t=' + new Date().getTime())";
  html += "    .then(response => response.json())";
  html += "    .then(data => {";
  html += "      var indicator = document.getElementById('triggerIndicator');";
  html += "      if(data.triggered) {";
  html += "        indicator.style.display = 'block';";
  html += "      } else {";
  html += "        indicator.style.display = 'none';";
  html += "      }";
  html += "    })";
  html += "    .catch(err => console.error(err));";
  html += "}";
  html += "setInterval(updateTrapStatus, 2000);";
  html += "var ctx = document.getElementById('rangeChart').getContext('2d');";
  html += "var rangeChart = new Chart(ctx, { type: 'line', data: { labels: [], datasets: [{ label: 'Hourly Average (mm)', data: [], borderColor: '#90EE90', backgroundColor: 'rgba(144,238,144,0.2)', tension: 0.1, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Hour (oldest to newest)' }, ticks: { color: '#ddd' } }, y: { title: { display: true, text: 'Range (mm)' }, ticks: { color: '#ddd' } } }, plugins: { legend: { labels: { color: '#ddd' } } } } });";
  html += "function fetchData() { fetch('/data').then(response => response.json()).then(data => {";
  html += "    var labels = []; var averages = [];";
  html += "    if(data.weekly && data.weekly.length > 0 && data.weekly.some(val => val != 0)) {";
  html += "      labels = data.weekly.map((val, index) => index);";
  html += "      averages = data.weekly;";
  html += "    } else {";
  html += "      labels = [0]; averages = [data.currentHourAverage];";
  html += "    }";
  html += "    rangeChart.data.labels = labels;";
  html += "    rangeChart.data.datasets[0].data = averages;";
  html += "    rangeChart.options.scales.x.min = 0;";
  html += "    rangeChart.options.scales.x.max = labels.length - 1;";
  html += "    rangeChart.update();";
  html += "    var list = document.getElementById('anomalyList');";
  html += "    list.innerHTML = '';";
  html += "    data.anomalies.forEach(event => {";
  html += "      var li = document.createElement('li');";
  html += "      li.textContent = 'Time: ' + new Date(event.timestamp * 1000).toLocaleString() + ' , Reading: ' + event.reading + ' mm';";
  html += "      list.appendChild(li);";
  html += "    });";
  html += "  }).catch(err => console.error(err));";
  html += "}";
  html += "setInterval(fetchData, 2000); fetchData();";
  html += "</script></body></html>";

  request->send(200, "text/html", html);
}

void handleData(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleData");
  //StaticJsonDocument<1024> doc;
  JsonDocument doc;
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    return;
  }
  //JsonArray weekly = doc.createNestedArray("weekly");
  JsonArray weekly = doc["weekly"].to<JsonArray>();
  int count = 0;
  if (weeklyAverages[0] == 0 && currentHourIndex == 0) {
    count = 0;
  } else if (weeklyAverages[currentHourIndex] == 0) {
    count = currentHourIndex;
    for (int i = 0; i < count; i++) {
      weekly.add(weeklyAverages[i]);
    }
  } else {
    count = WEEK_HOURS;
    for (int i = currentHourIndex; i < WEEK_HOURS; i++) {
      weekly.add(weeklyAverages[i]);
    }
    for (int i = 0; i < currentHourIndex; i++) {
      weekly.add(weeklyAverages[i]);
    }
  }
  float currentHourAverage = (currentHourCount > 0) ? (currentHourSum / currentHourCount) : 0;
  doc["currentHourAverage"] = currentHourAverage;
  doc["triggered"] = detectionState;
  doc["threshold"] = threshold;
  doc["calibrationOffset"] = calibrationOffset;
  doc["falseAlarmOffset"] = falseAlarmOffset;
  doc["overrideThreshold"] = overrideThreshold;
  //JsonArray anomalies = doc.createNestedArray("anomalies");
  JsonArray anomalies = doc["anomalies"].to<JsonArray>();
  for (int i = 0; i < anomalyCount; i++) {
    JsonObject event = anomalies.add<JsonObject>();
    event["timestamp"] = anomalyEvents[i].timestamp;
    event["reading"] = anomalyEvents[i].reading;
  }
  String output;
  serializeJson(doc, output);
  request->send(200, "application/json", output);
}

// ---------------------------------------------------------------------------
void handleReplay(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleReplay");
  if (!isAllowed(request) || !request->hasParam("f")) {
    request->send(403, "text/plain", "Forbidden");
    return;
  }
  String base = request->getParam("f")->value();  // e.g. vid_…mjpg
  if (base.indexOf("..") >= 0 || !base.endsWith(".mjpg")) {
    request->send(400, "text/plain", "Bad name");  // simple sanity check
    return;
  }

  String full = String(CAPTURE_DIR) + "/" + base;  // /captures/vid_…
  if (!LittleFS.exists(full)) {
    request->send(404, "text/plain", "Not found");
    return;
  }

  /* ---- build a chunked response ---- */
  AsyncWebServerResponse *res =
    request->beginChunkedResponse("multipart/x-mixed-replace; boundary=frame",
                                  [full](uint8_t *buf, size_t maxLen, size_t index) -> size_t {
                                    static File f;             // file handle survives between calls
                                    static uint8_t state = 0;  // 0 = header, 1 = jpeg data, 2 = CRLF

                                    if (index == 0) {  // first call → open the file
                                      f = LittleFS.open(full, "r");
                                      state = 0;
                                    }

                                    if (!f) return 0;  // error / finished

                                    size_t sent = 0;

                                    while (sent < maxLen && f.available()) {
                                      if (state == 0) {  // send boundary + headers
                                        const char *hdr = "--frame\r\n"
                                                          "Content-Type: image/jpeg\r\n\r\n";
                                        size_t hl = strlen(hdr);
                                        size_t copy = min(hl, maxLen - sent);
                                        memcpy(buf + sent, hdr, copy);
                                        sent += copy;
                                        if (copy == hl) state = 1;
                                        else break;             // buffer full
                                      } else if (state == 1) {  // stream JPEG bytes
                                        size_t copy = f.read(buf + sent, maxLen - sent);
                                        sent += copy;
                                        if (copy == 0) {  // end of this JPEG (0xFFD9)
                                          state = 2;
                                        }
                                      } else {  // state 2  →  send CRLF
                                        const char *crlf = "\r\n";
                                        if (maxLen - sent >= 2) {
                                          memcpy(buf + sent, crlf, 2);
                                          sent += 2;
                                          state = 0;  // next frame
                                        } else break;
                                      }
                                    }

                                    if (!f.available() && state == 0) {  // finished whole file
                                      f.close();
                                      return 0;  // terminates chunked response
                                    }
                                    return sent;
                                  });

  /* disable cache so the browser re-requests every time */
  res->addHeader("Cache-Control", "no-store");
  request->send(res);
}


void handleReset(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleReset");
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    String tStr = formatTime(time(nullptr));
    String ip = request->client()->remoteIP().toString();
    addAccessLog(tStr + " - " + ip + " was blocked");
    return;
  }
  logRequest(request);
  String ip = request->client()->remoteIP().toString();
  addSystemLog("Reset command from " + ip);
  detectionState = false;
  addSystemLog("Detection state cleared via web reset.");
  lastAlertTime = 0;
  lastEmailTime = time(nullptr) - 3600;
  lastEmailSuccess = false;
  detectionState = false;
  eventArmed = true;  // <‑‑ allow photos next time

  notifyAlarmCleared("web");
  beepReady();

  request->send(200, "text/plain", "Alarm reset");
}

void handleSettings(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleSettings");
  String tStr = formatTime(time(nullptr));
  String ip = request->client()->remoteIP().toString();
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    addAccessLog(tStr + " - " + ip + " access was blocked");
    return;
  }
  addAccessLog(tStr + " - " + ip + " accessed settings");
  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<title>Settings</title><style>";
  html += "body { background-color: #222; color: #ddd; font-family: Arial, sans-serif; padding: 10px; }";
  html += "input[type='text'] { width: 100%; padding: 10px; margin: 6px 0; background-color: #444; border: none; color: #ddd; }";
  html += "button { background-color: #444; color: #ddd; border: none; padding: 10px 20px; margin-top: 10px; cursor: pointer; }";
  html += "button:hover { background-color: #555; }";
  html += "</style></head><body>";
  html += getHamburgerMenuHTML();
  html += "<h1>Settings</h1>";
  html += "<form action='/setSettings' method='GET'>";
  html += "<label for='ipWhitelist'>IP Whitelist (CIDR allowed, comma separated):</label><br>";
  html += "<input type='text' id='ipWhitelist' name='ipWhitelist' value='" + ipWhitelist + "'><br>";
  html += "<label for='ipBlacklist'>IP Blacklist (CIDR allowed, comma separated):</label><br>";
  html += "<input type='text' id='ipBlacklist' name='ipBlacklist' value='" + ipBlacklist + "'><br>";
  html += "<button type='submit'>Save Settings</button>";
  html += "</form><br><a href='/'>Back</a>";
  html += "</body></html>";
  request->send(200, "text/html", html);
}

void handleSetSettings(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleSetSettings");
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    String tStr = formatTime(time(nullptr));
    String ip = request->client()->remoteIP().toString();
    addAccessLog(tStr + " - " + ip + " was blocked");
    return;
  }
  if (request->hasParam("overrideTh")) {
    int v = request->getParam("overrideTh")->value().toInt();
    overrideThreshold = v;
    preferences.putInt("overrideTh", v);
    addSystemLog("🔧 Override threshold set to " + String(v) + " mm");
  }
  const AsyncWebParameter *pWhitelist = request->getParam("ipWhitelist", false);
  const AsyncWebParameter *pBlacklist = request->getParam("ipBlacklist", false);
  if (pWhitelist != nullptr && pBlacklist != nullptr) {
    String newWhitelist = pWhitelist->value();
    String newBlacklist = pBlacklist->value();
    if (newWhitelist == "*" && newBlacklist == "*") {
      ipWhitelist = "*";
      ipBlacklist = "";
      addSystemLog("Invalid configuration: both lists '*' submitted. Overriding to allow all.");
    } else {
      ipWhitelist = newWhitelist;
      ipBlacklist = newBlacklist;
      addSystemLog("Settings updated by " + request->client()->remoteIP().toString());
    }
    request->send(200, "text/plain", "Settings updated.");
    saveSettings();
  } else {
    request->send(400, "text/plain", "Missing parameters.");
  }
}

void handleAccessLogs(AsyncWebServerRequest *request) {
  PAGE_SCOPE("accessLogs");
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    String tStr = formatTime(time(nullptr));
    String ip = request->client()->remoteIP().toString();
    addAccessLog(tStr + " - " + ip + " was blocked");
    return;
  }
  logRequest(request);
  String page = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Access Logs</title><style>";
  page += "body { background-color: #222; color: #ddd; font-family: Arial, sans-serif; padding: 10px; }";
  page += "</style></head><body>" + getHamburgerMenuHTML();
  page += "<h1>Access Logs</h1><pre>";
  for (int i = 0; i < accessLogCount; i++) {
    page += accessLogs[i] + "\n";
    if ((i & 7) == 7) NET_YIELD();
  }
  page += "</pre><a href='/'>Back</a></body></html>";
  request->send(200, "text/html", page);
}

// ---------- /systemLogs (ring-safe, no STL, busy guard, FS quiesce) ----------
void handleSystemLogs(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleSystemLogs");
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    String tStr = formatTime(time(nullptr));
    String ip = request->client()->remoteIP().toString();
    addAccessLog(tStr + " - " + ip + " was blocked");
    return;
  }
  logRequest(request);

  // Signal other tasks to avoid FS writes while we stream (see addSystemLog).
  g_logsStreaming = true;

  // Snapshot ring state
  const int cap = MAX_SYSTEM_LOGS;
  int totalEver, available, startIdx;
  syslogLock();
  totalEver  = systemLogCount;
  available  = (totalEver < cap) ? totalEver : cap;
  startIdx   = (totalEver - available) % cap;
  if (startIdx < 0) startIdx += cap;
  syslogUnlock();

  // If system is busy (right after Save/calibration starts) or RAM is tight,
  // auto-trim the view to reduce work.
  bool justSaved = (millis() - g_lastSettingsSaveMs) < 1500;
  bool busyNow   = g_calibrating || justSaved || isMemoryTight();

  int show = available;
  if (busyNow && show > 60) show = 60;        // show fewer lines under load
  if (!busyNow && show > 100) show = 100;     // hard cap as a sanity check

  // We keep the menu, but keep everything small and streamed.
  AsyncResponseStream *res = request->beginResponseStream("text/html");
  res->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res->print("<!DOCTYPE html><html><head><meta charset='utf-8'><title>System Logs</title>"
             "<style>body{background:#222;color:#ddd;font-family:Arial,sans-serif;padding:10px}"
             "pre{white-space:pre-wrap}</style></head><body>");
  res->print(getHamburgerMenuHTML());
  res->print("<h1>System Logs</h1>");
  if (busyNow) {
    res->print("<p>⚠️ Busy/low-memory mode: showing last ");
    res->print(show);
    res->print(" lines.</p>");
  }
  res->print("<pre>");

  // Print only the tail we decided to show
  int skip = available - show;
  if (skip < 0) skip = 0;

  for (int i = 0; i < show; ++i) {
    int ringPos = (startIdx + skip + i) % cap;
    String line;
    syslogLock();
    line = systemLogs[ringPos];   // deep-copies String contents
    syslogUnlock();

    res->print(line);
    res->print("\n");
    if ((i & 7) == 7) { NET_YIELD(); }
  }

  res->print("</pre><a href='/'>Back</a></body></html>");
  request->send(res);

  // Allow FS writes again
  g_logsStreaming = false;
}

// void handleSystemLogs(AsyncWebServerRequest *request) {
//   PAGE_SCOPE("handleSystemLogs");  // <— records page/core/heap in case of crash
//   if (!isAllowed(request)) {
//     request->send(403, "text/plain", "Forbidden");
//     String tStr = formatTime(time(nullptr));
//     String ip = request->client()->remoteIP().toString();
//     addAccessLog(tStr + " - " + ip + " was blocked");
//     return;
//   }
//   logRequest(request);
//   String page = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>System Logs</title><style>";
//   page.reserve(16 * 1024);  // <— reduces heap churn/fragmentation
//   page += "body { background-color: #222; color: #ddd; font-family: Arial, sans-serif; padding: 10px; }";
//   page += "</style></head><body>" + getHamburgerMenuHTML();
//   page += "<h1>System Logs</h1><pre>";
//   for (int i = 0; i < systemLogCount; i++) {
//     page += systemLogs[i] + "\n";
//     NET_YIELD_EVERY(i, 8);  // <— lets async_tcp breathe w/out changing design
//     CRASH_MARK_LINE();      // <— advances “last_line” while looping (optional)
//   }
//   page += "</pre><a href='/'>Back</a></body></html>";
//   request->send(200, "text/html", page);
// }

void handleReboot(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleReboot");
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    String tStr = formatTime(time(nullptr));
    String ip = request->client()->remoteIP().toString();
    addAccessLog(tStr + " - " + ip + " was blocked");
    return;
  }
  logEvent("Reboot command received from " + request->client()->remoteIP().toString(), true);
  request->send(200, "text/plain", "Rebooting...");
  TASK_YIELD_MS(1000);
  ESP.restart();
}


// ─────────────────────────────────────────────────────────────
/* --- BEGIN PATCH: ChatGPT.ino --- */
#include <ArduinoJson.h>  // ensure this is included near the top

// POST /deletePhotos  (JSON body; accepts { "files":[...] } or bare [ ... ])
void handleDeletePhotos(AsyncWebServerRequest* req,
                        uint8_t* data, size_t len, size_t index, size_t total)
{
  // Accumulate body across chunks
  if (index == 0) {
    req->_tempObject = new String();
  }
  auto* body = static_cast<String*>(req->_tempObject);
  body->concat(reinterpret_cast<const char*>(data), len);

  if (index + len != total) return;    // wait for final chunk

  // Parse JSON (v7: JsonDocument auto-grows; no reserve() needed)
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, *body);
  delete body;                          // free temp
  req->_tempObject = nullptr;

  if (err) {
    addSystemLog(String("[gallery] delete: JSON parse error: ") + err.c_str());
    return req->send(400, "text/plain", "Bad JSON");
  }

  // Accept either { "files":[...]} or bare array [...]
  JsonArray files = doc.is<JsonArray>() ? doc.as<JsonArray>()
                                        : doc["files"].as<JsonArray>();
  if (files.isNull()) {
    return req->send(400, "text/plain", "Bad JSON: no files[]");
  }

  // Build response
  JsonDocument out;                     // auto-grow
  out["ok"] = true;
  uint32_t deleted = 0;
  JsonArray missing = out["missing"].to<JsonArray>();
  JsonArray errors  = out["errors" ].to<JsonArray>();

  // Delete each requested file (normalize to /captures/…)
  for (JsonVariant v : files) {
    const char* nm = v.is<const char*>() ? v.as<const char*>() : nullptr;
    if (!nm || !*nm) { errors.add("empty-name"); continue; }

    String path = nm;
    if (!path.startsWith("/captures/")) path = "/captures/" + path;

    // Safety: constrain deletes to /captures/
    if (!path.startsWith("/captures/")) { errors.add(nm); continue; }

    if (!LittleFS.exists(path)) { missing.add(nm); continue; }

    if (LittleFS.remove(path)) ++deleted; else errors.add(nm);
  }
  out["deleted"] = deleted;

  String resp; serializeJson(out, resp);
  req->send(200, "application/json", resp);
}
/* --- END PATCH: ChatGPT.ino --- */

// void handleDeletePhotos(AsyncWebServerRequest *request,
//                         uint8_t *data,
//                         size_t len,
//                         size_t index,
//                         size_t total) {
//   PAGE_SCOPE("handleDeletePhotos");
//   /* 1) ACL + flush guard */
//   if (!isAllowed(request)) {
//     request->send(403, "text/plain", "Forbidden");
//     return;
//   }

//   if (flushInProgress || LittleFS.exists("/.flush.lock")) {
//     return request->send(503, "text/plain",
//                          "Gallery busy saving last video, try again in a moment");
//   }

//   // if (flushInProgress) {
//   //     request->send(503, "text/plain",
//   //                   "Busy saving last video – try again in a moment");
//   //     return;
//   // }

//   /* 2) parse body */
//   // DynamicJsonDocument doc(1024);
//   JsonDocument doc;
//   auto err = deserializeJson(doc, data, len);
//   if (err) {
//     request->send(400, "text/plain", "Bad JSON");
//     return;
//   }
//   JsonArray arr = doc["files"];
//   if (arr.isNull()) {
//     request->send(400, "text/plain", "Missing 'files' array");
//     return;
//   }

//   /* 3) iterate & delete */
//   const String capPrefix = String(CAPTURE_DIR) + "/";
//   int deleted = 0, missing = 0, failed = 0;

//   for (JsonVariant v : arr) {
//     String path = v.as<String>();  // whatever the browser sent

//     /* normalise → always "/captures/xxx.mjpg|jpg" */
//     if (!path.startsWith(capPrefix))
//       path = capPrefix + path;

//     /* security: refuse anything fishy */
//     if (path.indexOf("..") >= 0) {
//       ++failed;
//       continue;
//     }

//     /* stats */
//     if (!LittleFS.exists(path)) {
//       ++missing;
//       continue;
//     }
//     if (LittleFS.remove(path)) {
//       ++deleted;
//     } else {
//       ++failed;
//     }
//   }

//   /* 4) respond */
//   String msg = "Deleted " + String(deleted) + ", missing " + String(missing) + ", failed " + String(failed);
//   request->send(200, "text/plain", msg);
// }


void handleFlushStatus(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleFlushStatus");
  if (!isAllowed(req)) return req->send(403, "text/plain", "Forbidden");

  String page = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Flush Status</title>"
                "<style>body{background:#222;color:#ddd;font-family:Arial;padding:10px}</style></head><body>";

  page += "<h1>Flush Status</h1><ul>";

  if (LittleFS.exists("/.flush.lock")) {
    page += "<li>🕒 Flush is <strong>IN PROGRESS</strong></li>";
  } else {
    page += "<li>✅ No flush in progress</li>";
  }

  extern VideoJob *currentJob;  // defined globally
  if (flushInProgress && currentJob) {
    page += "<li>Flushing: " + String(currentJob->path) + "</li>";
    page += "<li>Buffered frames: " + String(currentJob->frames.size()) + "</li>";
  } else {
    page += "<li>No active VideoJob</li>";
  }

  page += "</ul><a href='/'>⬅ Back</a></body></html>";
  req->send(200, "text/html", page);
}

//------------------------------------------------------------------
//  GET  /options           – show the form
//------------------------------------------------------------------
void handleOptions(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleOptions");
  if (!isAllowed(request)) {
    request->send(403);
    return;
  }
  logRequest(request);

  String html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Options</title>"
    "<style>body{background:#222;color:#ddd;font-family:Arial;padding:10px}"
    "label{font-size:18px}</style></head><body>";

  html += getHamburgerMenuHTML();
  html += "<h1>Options</h1>"
          "<form action='/setOptions' method='GET'>"
          "<label>"
          "<input type='checkbox' name='video' value='1' "
          + String(videoMode ? "checked" : "") + ">"
                                                 "  Record 10-s video instead of two still photos"
                                                 "</label><br><br>"
                                                 "<button type='submit'>Save</button>"
                                                 "</form>"
                                                 "<br><a href='/'>Back</a></body></html>";

  request->send(200, "text/html", html);
}

//------------------------------------------------------------------
//  GET /setOptions?video=1 | 0
//------------------------------------------------------------------
void handleSetOptions(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleSetOptions");
  if (!isAllowed(request)) {
    request->send(403);
    return;
  }
  logRequest(request);

  videoMode = request->hasParam("video");  // checked box → present
  saveSettings();

  addSystemLog("Options changed: videoMode=" + String(videoMode));

  request->send(200, "text/plain",
                String("✅ Options saved – video mode ")
                  + (videoMode ? "ON" : "OFF"));
}

int computeThreshold(uint16_t avg) {
  if (overrideThreshold > 0) {
    return overrideThreshold;
  }
  const int baseOffset = 15;  // Detection margin: trigger when object is this many mm closer than baseline
  int t = int(avg)
          - baseOffset           // Baseline minus detection margin
          - falseAlarmOffset     // Additional margin to avoid false alarms
          + calibrationOffset;   // User adjustment (can be positive or negative)
  // Ensure threshold is at least 10mm to prevent spurious triggers at extreme range
  return max(10, t);
}




/*-------------------------------------------------------------------------- */
void handleGallery(AsyncWebServerRequest *request) {
  PAGE_SCOPE("handleGallery");  // <— records page/core/heap/line
  if (!isAllowed(request)) {
    request->send(403, "text/plain", "Forbidden");
    return;
  }

  // safety: if task is gone but bool is still true, reset it
  if (flushInProgress && !LittleFS.exists("/.flush.lock")) {
    addSystemLog("ℹ️  flushInProgress reset (task finished)");
    flushInProgress = false;
  }

  if (flushInProgress) {
    return request->send(503, "text/plain",
                         "Gallery busy saving last video – try again in a moment");
  }

  // ---- collect latest captures ----
  std::vector<String> files;
  File dir = LittleFS.open(CAPTURE_DIR, "r");
  while (dir && dir.isDirectory()) {
    File f = dir.openNextFile();
    if (!f) break;
    String fn = String(f.name());  // "/captures/vid_…"
    //if (fn.endsWith(".jpg") || fn.endsWith(".mjpg")) files.push_back(fn);
    if (fn.endsWith(".jpg")) {
      files.push_back(String(CAPTURE_DIR) + "/" + fn);
    } else if (fn.endsWith(".mjpg")) {
      files.push_back(fn);
    }
    NET_YIELD();
  }
  dir.close();

  std::sort(files.begin(), files.end());
  //if (files.size() > 10) files.erase(files.begin(), files.end() - 10);
  std::reverse(files.begin(), files.end());  // newest first

  // ---- HTML ----
  String html = R"rawliteral(
<!DOCTYPE html><html>
<head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Gallery</title>
<style>
 body{background:#222;color:#ddd;font-family:Arial;margin:0;padding:12px}
 a{color:#0af;text-decoration:none}
 ul{list-style:none;padding:0}
 li{margin:4px 0}
 .btn{padding:6px 12px;background:#444;color:#ddd;border:none;cursor:pointer}
 .btn:hover{background:#555}
 input[type=checkbox]{transform:scale(1.2);margin-right:6px}
</style></head><body>
)rawliteral";

  html += getHamburgerMenuHTML();
  html += "<h1>Gallery</h1>";

  if (files.empty()) {
    html += "<p>No captures found.</p>";
  } else {
    html += R"rawliteral(
<label><input id='chkAll' type='checkbox' onchange='toggleAll(this)'> Select all</label>
<button class='btn' onclick='deleteSelected()'>Delete selected</button>
<ul>
)rawliteral";

    size_t idx = 0;
    for (const String &path : files) {
      String name = path.substring(path.lastIndexOf('/') + 1);
      bool isVid = path.endsWith(".mjpg");

      html += "<li><label><input type='checkbox' name='pic' value='" + path + "'>";

      if (isVid) {
        html += "▶️ <a href='/view?f=" + path + "' target='_blank'>Play</a> | "
                                                    //"⬇️ <a href='/download?f=" + path + "' download>Download</a> "
                                                    "⬇️ <a href='/download?f="
                + name + "' download>Download</a> "
                         //"⬇️ <a href='" + path + "' download>Download</a> "
                         "<em>("
                + name + ")</em>";
      } else {
        html += "<a href='" + path + "' target='_blank'>" + name + "</a>";
      }
      html += "</label></li>";
      NET_YIELD_EVERY(idx++, 8);  // NEW: keep AsyncTCP fed
    }
    html += "</ul>";
  }

  // ---------- JS ----------
  html += R"rawliteral(
<script>
function toggleAll(master){
  document.querySelectorAll('input[name="pic"]')
          .forEach(cb => cb.checked = master.checked);
}
function deleteSelected(){
  const boxes = document.querySelectorAll('input[name="pic"]:checked');
  if(!boxes.length) { alert('Nothing selected'); return; }
  // const files = Array.from(boxes).map(b=>b.value);
  const files = Array.from(boxes).map(b =>b.value.startsWith("/captures/") ? b.value : "/captures/"+b.value);
  fetch('/deletePhotos',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({files})})
    .then(r=>r.text())
    .then(msg=>{ alert(msg); location.reload(); })
    .catch(err=>alert('Delete failed: '+err));
}
</script>
<br><a href='/' class='btn'>Back</a>
</body></html>
)rawliteral";

  request->send(200, "text/html", html);
}

// Lazy initialization to avoid global constructor TCP crash
AsyncWebServer& getServer() {
  static AsyncWebServer* srv = nullptr;
  if (!srv) srv = new AsyncWebServer(80);
  return *srv;
}
#define server getServer()

static void handleJsLog(AsyncWebServerRequest* req) {
  if (!req->hasParam("m", true)) return req->send(400, "text/plain", "missing m");
  String msg = req->getParam("m", true)->value();
  addSystemLog("[JS] " + msg);
  req->send(204);
}


// === SPA route wiring (only one block like this; call once) ===
static inline bool wantsHtml(AsyncWebServerRequest* r) {
  auto* h = r->getHeader("Accept");
  return h && h->value().indexOf("text/html") != -1;
}

// SPA shell: no-store
static void sendIndex(AsyncWebServerRequest* req, const char* tag) {
  AsyncWebServerResponse* r = req->beginResponse(LittleFS, "/app/index.html", "text/html");
  r->addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  r->addHeader("X-Handler", tag);
  req->send(r);
}

// static void sendIndex(AsyncWebServerRequest* req, const char* tag) {
//   AsyncWebServerResponse* r = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//   r->addHeader("X-Handler", tag);
//   req->send(r);
// }

// Send 404 text/plain with a debug tag
static void send404(AsyncWebServerRequest* req, const char* tag) {
  AsyncWebServerResponse* r = req->beginResponse(404, "text/plain", "Not found");
  r->addHeader("X-Handler", tag);
  req->send(r);
}

// static void send404(AsyncWebServerRequest* req, const char* tag) {
//   AsyncWebServerResponse* r = req->beginResponse(404, "text/plain", "Not found");
//   r->addHeader("X-Handler", tag);
//   req->send(r);
// }

void registerSpaRoutes() {
  // 1) Static assets
  server.serveStatic("/app/assets/", LittleFS, "/app/assets/")
        .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");

  // 2) SPA shell for /app and /app/ (serve directly; GET/HEAD allowed)
  server.on("/app", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
    if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
      // Check if filesystem is mounted and file exists
      if (!LittleFS.exists("/app/index.html")) {
        auto* res = req->beginResponse(503, "text/html",
          "<html><body><h1>503 Service Unavailable</h1>"
          "<p>The web interface has not been uploaded to this device yet.</p>"
          "<p>Please upload the filesystem via OTA or ElegantOTA.</p></body></html>");
        sendWith(req, res, "nf-spa-missing", 503);
        return;
      }
      auto* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
      sendWith(req, res, "nf-spa-root", 200);
    } else {
      auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
      sendWith(req, res, "nf-405", 405);
    }
  }));

  server.on("/app/", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
    if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
      // Check if filesystem is mounted and file exists
      if (!LittleFS.exists("/app/index.html")) {
        auto* res = req->beginResponse(503, "text/html",
          "<html><body><h1>503 Service Unavailable</h1>"
          "<p>The web interface has not been uploaded to this device yet.</p>"
          "<p>Please upload the filesystem via OTA or ElegantOTA.</p></body></html>");
        sendWith(req, res, "nf-spa-missing", 503);
        return;
      }
      auto* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
      sendWith(req, res, "nf-spa-root", 200);
    } else {
      auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
      sendWith(req, res, "nf-405", 405);
    }
  }));

  // 3) Public health
  server.on("/healthz", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
    if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
      char buf[256];
      snprintf(buf, sizeof(buf),
        "{\"status\":\"ok\",\"uptime\":\"%s\",\"heap_free\":%u,\"psram_free\":%u}",
        fmtUptime().c_str(), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
      auto* res = req->beginResponse(200, "application/json", buf);
      sendWith(req, res, "ops-healthz", 200);
    } else {
      auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
      sendWith(req, res, "nf-405", 405);
    }
  }));

  // 4) Auth helper
  auto requireAuth = [](AsyncWebServerRequest* req) -> bool {
    if (!req->authenticate(OPS_USER, OPS_PASS)) { req->requestAuthentication(); return false; }
    return true;
  };

  // 5) Ops: version / uptime / metrics (auth; GET/HEAD)
  server.on("/version.txt", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
    if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
      auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
      sendWith(req, res, "nf-405", 405); return;
    }
    if (!requireAuth(req)) return;
    String body = String(BUILD_SEMVER) + " (" + BUILD_COMMIT + ")\n";
    auto* res = req->beginResponse(200, "text/plain", body);
    sendWith(req, res, "ops-version", 200);
  }));

  server.on("/uptime.txt", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
    if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
      auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
      sendWith(req, res, "nf-405", 405); return;
    }
    if (!requireAuth(req)) return;
    String body = fmtUptime() + "\n";
    auto* res = req->beginResponse(200, "text/plain", body);
    sendWith(req, res, "ops-uptime", 200);
  }));

  server.on("/metrics", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
    if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
      auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
      sendWith(req, res, "nf-405", 405); return;
    }
    if (!requireAuth(req)) return;
    char buf[512];
    int n = snprintf(buf, sizeof(buf),
      "esp_uptime_seconds %lu\n"
      "esp_heap_free_bytes %u\n"
      "esp_psram_free_bytes %u\n",
      (unsigned long)(millis()/1000UL), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    auto* res = req->beginResponse(200, "text/plain", String(buf).substring(0, n));
    sendWith(req, res, "ops-metrics", 200);
  }));

  // 6) Ops: reboot (auth) - use the existing handleReboot function
  server.on("/reboot", HTTP_GET, protectHandler(handleReboot));

  // 7) NotFound routing (SPA fallback vs 404)
  server.onNotFound(protectHandler([](AsyncWebServerRequest* req) {
    // Handle CORS preflight OPTIONS requests first
    if (req->method() == HTTP_OPTIONS) {
      Serial.println("[CORS] OPTIONS preflight request handled");
      req->send(200);
      return;
    }

    const String url = req->url();
    const bool isGetOrHead = (req->method() == HTTP_GET || req->method() == HTTP_HEAD);

    if (url.startsWith("/app/assets/")) {
      auto* res = req->beginResponse(404, "text/plain", "Not found");
      sendWith(req, res, "nf-assets-404", 404);
      return;
    }

    if (isGetOrHead && url.startsWith("/app/")) {
      const int last = url.lastIndexOf('/');
      const int dot  = url.indexOf('.', (last >= 0 ? last + 1 : 0));
      if (dot < 0) {
        auto* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
        sendWith(req, res, "nf-spa", 200);
        return;
      }
      auto* res = req->beginResponse(404, "text/plain", "Not found");
      sendWith(req, res, "nf-404", 404);
      return;
    }

    auto* res = req->beginResponse(404, "text/plain", "Not found");
    sendWith(req, res, "nf-404", 404);
  }));
}


// void registerSpaRoutes() {
//   // 1) Static assets (real files only; 404 on miss handled below)
//   server.serveStatic("/app/assets/", LittleFS, "/app/assets/")
//         .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");

//   // 2) SPA shell for /app and /app/ (serve directly; no redirects)
//   server.on("/app", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
//     if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
//       auto* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//       sendWith(req, res, "nf-spa-root", 200);
//     } else {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//     }
//   }));

//   server.on("/app/", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
//     if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
//       auto* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//       sendWith(req, res, "nf-spa-root", 200);
//     } else {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//     }
//   }));

//   // 3) Ops: health (public)
//   server.on("/healthz", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
//     if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
//       char buf[256];
//       snprintf(buf, sizeof(buf),
//         "{\"status\":\"ok\",\"uptime\":\"%s\",\"heap_free\":%u,\"psram_free\":%u}",
//         fmtUptime().c_str(), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//       auto* res = req->beginResponse(200, "application/json", buf);
//       sendWith(req, res, "ops-healthz", 200);
//     } else {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//     }
//   }));

//   // 4) Ops: auth-protected helper
//   auto requireAuth = [](AsyncWebServerRequest* req) -> bool {
//     if (!req->authenticate(OPS_USER, OPS_PASS)) {
//       req->requestAuthentication();
//       return false;
//     }
//     return true;
//   };

//   // 5) Ops: version/uptime/metrics (auth)
//   server.on("/version.txt", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//       return;
//     }
//     if (!requireAuth(req)) return;
//     String body = String(BUILD_SEMVER) + " (" + BUILD_COMMIT + ")\n";
//     auto* res = req->beginResponse(200, "text/plain", body);
//     sendWith(req, res, "ops-version", 200);
//   }));

//   server.on("/uptime.txt", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//       return;
//     }
//     if (!requireAuth(req)) return;
//     String body = fmtUptime() + "\n";
//     auto* res = req->beginResponse(200, "text/plain", body);
//     sendWith(req, res, "ops-uptime", 200);
//   }));

//   server.on("/metrics", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//       return;
//     }
//     if (!requireAuth(req)) return;
//     char buf[512];
//     int n = snprintf(buf, sizeof(buf),
//       "esp_uptime_seconds %lu\n"
//       "esp_heap_free_bytes %u\n"
//       "esp_psram_free_bytes %u\n",
//       (unsigned long)(millis()/1000UL), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//     auto* res = req->beginResponse(200, "text/plain", String(buf).substring(0, n));
//     sendWith(req, res, "ops-metrics", 200);
//   }));

//   // 6) Ops: /logs (text) and /logs.json (JSON), auth-protected
//   server.on("/logs", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//       return;
//     }
//     if (!requireAuth(req)) return;

//     String body;
//     body.reserve(2048);
//     // Print newest→oldest
//     size_t printed = 0;
//     for (size_t i = 0; i < g_log_count; ++i) {
//       size_t idx = (g_log_head + LOG_CAP - 1 - i) % LOG_CAP;
//       const LogEntry &e = g_logs[idx];
//       char line[256];
//       snprintf(line, sizeof(line), "%9lu ms  %-4s  %-3d  %-14s  %s\n",
//                e.t_ms, e.method.c_str(), e.status, e.handler.c_str(), e.url.c_str());
//       body += line;
//       if (++printed >= LOG_CAP) break;
//     }
//     auto* res = req->beginResponse(200, "text/plain", body);
//     sendWith(req, res, "ops-logs", 200);
//   }));

//   server.on("/logs.json", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) {
//       auto* res = req->beginResponse(405, "text/plain", "Method Not Allowed");
//       sendWith(req, res, "nf-405", 405);
//       return;
//     }
//     if (!requireAuth(req)) return;

//     String body = "[";
//     for (size_t i = 0; i < g_log_count; ++i) {
//       size_t idx = (g_log_head + LOG_CAP - 1 - i) % LOG_CAP;
//       const LogEntry &e = g_logs[idx];
//       char line[384];
//       snprintf(line, sizeof(line),
//         "%s{\"t_ms\":%lu,\"method\":\"%s\",\"status\":%d,\"handler\":\"%s\",\"url\":%s}",
//         (i==0 ? "" : ","), e.t_ms, e.method.c_str(), e.status, e.handler.c_str(),
//         String("\"" + e.url + "\"").c_str());
//       body += line;
//     }
//     body += "]";
//     auto* res = req->beginResponse(200, "application/json", body);
//     sendWith(req, res, "ops-logs-json", 200);
//   }));

//   // 7) NotFound routing
//   server.onNotFound(protectHandler([](AsyncWebServerRequest* req) {
//     const String url = req->url();
//     const bool isGetOrHead = (req->method() == HTTP_GET || req->method() == HTTP_HEAD);

//     if (url.startsWith("/app/assets/")) {
//       auto* res = req->beginResponse(404, "text/plain", "Not found");
//       sendWith(req, res, "nf-assets-404", 404);
//       return;
//     }

//     if (isGetOrHead && url.startsWith("/app/")) {
//       const int last = url.lastIndexOf('/');
//       const int dot  = url.indexOf('.', (last >= 0 ? last + 1 : 0));
//       if (dot < 0) {
//         auto* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//         sendWith(req, res, "nf-spa", 200);
//         return;
//       }
//       auto* res = req->beginResponse(404, "text/plain", "Not found");
//       sendWith(req, res, "nf-404", 404);
//       return;
//     }

//     auto* res = req->beginResponse(404, "text/plain", "Not found");
//     sendWith(req, res, "nf-404", 404);
//   }));
// }

// void registerSpaRoutes() {
//   // 1) Static assets
//   server.serveStatic("/app/assets/", LittleFS, "/app/assets/")
//         .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");

//   // 2) SPA shell for /app and /app/ (serve for GET or HEAD)
//   server.on("/app", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
//     if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
//       AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//       res->addHeader("X-Handler", "nf-spa-root");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }
//     req->send(405); // Method Not Allowed
//   }));

//   server.on("/app/", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
//     if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
//       AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//       res->addHeader("X-Handler", "nf-spa-root");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }
//     req->send(405);
//   }));

//   // 3) Ops: public health
//   server.on("/healthz", HTTP_ANY, protectHandler([](AsyncWebServerRequest* req) {
//     if (req->method() == HTTP_GET || req->method() == HTTP_HEAD) {
//       char buf[256];
//       snprintf(buf, sizeof(buf),
//         "{\"status\":\"ok\",\"uptime\":\"%s\",\"heap_free\":%u,\"psram_free\":%u}",
//         fmtUptime().c_str(), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//       AsyncWebServerResponse* res = req->beginResponse(200, "application/json", buf);
//       res->addHeader("X-Handler", "ops-healthz");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }
//     req->send(405);
//   }));

//   // 3b) Ops: auth-protected
//   auto requireAuth = [](AsyncWebServerRequest* req) -> bool {
//     if (!req->authenticate(OPS_USER, OPS_PASS)) {
//       req->requestAuthentication();
//       return false;
//     }
//     return true;
//   };

//   server.on("/version.txt", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) { req->send(405); return; }
//     if (!requireAuth(req)) return;
//     String body = String(BUILD_SEMVER) + " (" + BUILD_COMMIT + ")\n";
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", body);
//     res->addHeader("X-Handler", "ops-version");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   server.on("/uptime.txt", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) { req->send(405); return; }
//     if (!requireAuth(req)) return;
//     String body = fmtUptime() + "\n";
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", body);
//     res->addHeader("X-Handler", "ops-uptime");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   server.on("/metrics", HTTP_ANY, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!(req->method() == HTTP_GET || req->method() == HTTP_HEAD)) { req->send(405); return; }
//     if (!requireAuth(req)) return;
//     char buf[512];
//     int n = snprintf(buf, sizeof(buf),
//       "esp_uptime_seconds %lu\n"
//       "esp_heap_free_bytes %u\n"
//       "esp_psram_free_bytes %u\n",
//       (unsigned long)(millis()/1000UL), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", String(buf).substring(0, n));
//     res->addHeader("X-Handler", "ops-metrics");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // 4) NotFound routing (GET or HEAD for SPA fallback)
//   server.onNotFound(protectHandler([](AsyncWebServerRequest* req) {
//     const String url = req->url();
//     const bool isGetOrHead = (req->method() == HTTP_GET || req->method() == HTTP_HEAD);

//     // /app/assets/* missing → 404
//     if (url.startsWith("/app/assets/")) {
//       AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//       res->addHeader("X-Handler", "nf-assets-404");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }

//     // /app/... extension-less paths → SPA shell (GET or HEAD)
//     if (isGetOrHead && url.startsWith("/app/")) {
//       const int last = url.lastIndexOf('/');
//       const int dot  = url.indexOf('.', (last >= 0 ? last + 1 : 0));
//       if (dot < 0) {
//         AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//         res->addHeader("X-Handler", "nf-spa");
//         addStdHeaders(res);
//         req->send(res);
//         return;
//       }
//       AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//       res->addHeader("X-Handler", "nf-404");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }

//     // Outside /app → 404
//     AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//     res->addHeader("X-Handler", "nf-404");
//     addStdHeaders(res);
//     req->send(res);
//   }));
// }

// void registerSpaRoutes() {
//   // 1) Static assets
//   server.serveStatic("/app/assets/", LittleFS, "/app/assets/")
//         .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");

//   // 2) SPA shell for /app and /app/ (no redirects to avoid loops)
//   server.on("/app", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//     res->addHeader("X-Handler", "nf-spa-root");
//     addStdHeaders(res);
//     req->send(res);
//   }));
//   server.on("/app/", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//     res->addHeader("X-Handler", "nf-spa-root");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // 3) Ops endpoints
//   // 3a) Public health check
//   server.on("/healthz", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     char buf[256];
//     snprintf(buf, sizeof(buf),
//       "{\"status\":\"ok\",\"uptime\":\"%s\",\"heap_free\":%u,\"psram_free\":%u}",
//       fmtUptime().c_str(), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//     AsyncWebServerResponse* res = req->beginResponse(200, "application/json", buf);
//     res->addHeader("X-Handler", "ops-healthz");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // 3b) Auth-protected endpoints
//   auto requireAuth = [](AsyncWebServerRequest* req) -> bool {
//     if (!req->authenticate(OPS_USER, OPS_PASS)) {
//       req->requestAuthentication(); // sends 401 with WWW-Authenticate
//       return false;
//     }
//     return true;
//   };

//   server.on("/version.txt", HTTP_GET, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!requireAuth(req)) return;
//     String body = String(BUILD_SEMVER) + " (" + BUILD_COMMIT + ")\n";
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", body);
//     res->addHeader("X-Handler", "ops-version");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   server.on("/uptime.txt", HTTP_GET, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!requireAuth(req)) return;
//     String body = fmtUptime() + "\n";
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", body);
//     res->addHeader("X-Handler", "ops-uptime");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   server.on("/metrics", HTTP_GET, protectHandler([&](AsyncWebServerRequest* req) {
//     if (!requireAuth(req)) return;
//     char buf[512];
//     int n = snprintf(buf, sizeof(buf),
//       "esp_uptime_seconds %lu\n"
//       "esp_heap_free_bytes %u\n"
//       "esp_psram_free_bytes %u\n",
//       (unsigned long)(millis()/1000UL), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", String(buf).substring(0, n));
//     res->addHeader("X-Handler", "ops-metrics");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // 4) NotFound routing: assets → 404, extension-less /app/... → SPA, others → 404
//   server.onNotFound(protectHandler([](AsyncWebServerRequest* req) {
//     const String url = req->url();
//     const bool isGet = (req->method() == HTTP_GET);

//     if (url.startsWith("/app/assets/")) {
//       AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//       res->addHeader("X-Handler", "nf-assets-404");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }

//     if (isGet && url.startsWith("/app/")) {
//       const int last = url.lastIndexOf('/');
//       const int dot  = url.indexOf('.', (last >= 0 ? last + 1 : 0));
//       if (dot < 0) {
//         AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//         res->addHeader("X-Handler", "nf-spa");
//         addStdHeaders(res);
//         req->send(res);
//         return;
//       }
//       AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//       res->addHeader("X-Handler", "nf-404");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }

//     AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//     res->addHeader("X-Handler", "nf-404");
//     addStdHeaders(res);
//     req->send(res);
//   }));
// }


// void registerSpaRoutes() {
//   // Assets
//   server.serveStatic("/app/assets/", LittleFS, "/app/assets/")
//         .setCacheControl("no-store, no-cache, must-revalidate, max-age=0");

//   // SPA shell for both /app and /app/
//   server.on("/app", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//     res->addHeader("X-Handler", "nf-spa-root");
//     addStdHeaders(res);
//     req->send(res);
//   }));
//   server.on("/app/", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//     res->addHeader("X-Handler", "nf-spa-root");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // Ops: /healthz
//   server.on("/healthz", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     char buf[256];
//     snprintf(buf, sizeof(buf),
//       "{\"status\":\"ok\",\"uptime\":\"%s\",\"heap_free\":%u,\"psram_free\":%u}",
//       fmtUptime().c_str(), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//     AsyncWebServerResponse* res = req->beginResponse(200, "application/json", buf);
//     res->addHeader("X-Handler", "ops-healthz");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // Ops: /version.txt
//   server.on("/version.txt", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     String body = String(BUILD_SEMVER) + " (" + BUILD_COMMIT + ")\n";
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", body);
//     res->addHeader("X-Handler", "ops-version");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // Ops: /uptime.txt
//   server.on("/uptime.txt", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     String body = fmtUptime() + "\n";
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", body);
//     res->addHeader("X-Handler", "ops-uptime");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // Ops: /metrics (Prometheus-ish snapshot)
//   server.on("/metrics", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
//     char buf[512];
//     // Note: keep simple—no dynamic labels to save bytes
//     int n = snprintf(buf, sizeof(buf),
//       "esp_uptime_seconds %lu\n"
//       "esp_heap_free_bytes %u\n"
//       "esp_psram_free_bytes %u\n",
//       (unsigned long)(millis()/1000UL), ESP.getFreeHeap(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
//     AsyncWebServerResponse* res = req->beginResponse(200, "text/plain", String(buf).substring(0, n));
//     res->addHeader("X-Handler", "ops-metrics");
//     addStdHeaders(res);
//     req->send(res);
//   }));

//   // NotFound: assets 404 vs SPA fallback vs plain 404s
//   server.onNotFound(protectHandler([](AsyncWebServerRequest* req) {
//     const String url = req->url();
//     const bool isGet = (req->method() == HTTP_GET);

//     if (VERBOSE_HTTP) {
//       Serial.printf("[HTTP] %s %s\n", req->methodToString(), url.c_str());
//     }

//     if (url.startsWith("/app/assets/")) {
//       AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//       res->addHeader("X-Handler", "nf-assets-404");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }

//     if (isGet && url.startsWith("/app/")) {
//       const int last = url.lastIndexOf('/');
//       const int dot  = url.indexOf('.', (last >= 0 ? last + 1 : 0));
//       if (dot < 0) {
//         AsyncWebServerResponse* res = req->beginResponse(LittleFS, "/app/index.html", "text/html");
//         res->addHeader("X-Handler", "nf-spa");
//         addStdHeaders(res);
//         req->send(res);
//         return;
//       }
//       AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//       res->addHeader("X-Handler", "nf-404");
//       addStdHeaders(res);
//       req->send(res);
//       return;
//     }

//     AsyncWebServerResponse* res = req->beginResponse(404, "text/plain", "Not found");
//     res->addHeader("X-Handler", "nf-404");
//     addStdHeaders(res);
//     req->send(res);
//   }));
// }







/*---------------------------------------------------
  Endpoint registration
---------------------------------------------------*/
// ------------------------------------------------------------------
// Wire up all of your endpoints, including the gallery & static files
// ------------------------------------------------------------------

void setupEndpoints() {
  Serial.println("[DEBUG] setupEndpoints() ENTERED - first line of function");
  addSystemLog("[DEBUG] setupEndpoints() ENTERED - first line of function");

  // Register root handler BEFORE SPA routes to ensure it takes precedence
  server.on("/", HTTP_GET, protectHandler(handleRoot));

  registerSpaRoutes();
  // === PATCH START: SPA routes (fix redirect loop) ===

  // — your existing dynamic routes —
  server.on("/data", HTTP_GET, protectHandler(handleData));
  server.on("/reset", HTTP_GET, protectHandler(handleReset));
  server.on("/settings", HTTP_GET, protectHandler(handleSettings));
  server.on("/setSettings", HTTP_GET, protectHandler(handleSetSettings));
  server.on("/accessLogs", HTTP_GET, protectHandler(handleAccessLogs));
  server.on("/systemLogs", HTTP_GET, protectHandler(handleSystemLogs));
  // Reboot endpoint already registered at line 6297 - don't duplicate
  // server.on("/reboot", HTTP_GET, protectHandler(handleReboot));
  server.on("/camera", HTTP_GET, protectHandler(handleCamera));
  server.on("/toggleLED", HTTP_GET, protectHandler(handleToggleLED));
  server.on("/ledStatus", HTTP_GET, protectHandler(handleLEDStatus));
  server.on("/test", HTTP_GET, protectHandler(handleTestPage));
  server.on("/testAlert", HTTP_GET, protectHandler(handleTestAlert));
  server.on("/options", HTTP_GET, protectHandler(handleOptions));
  server.on("/setOptions", HTTP_GET, protectHandler(handleSetOptions));
  server.on("/replay", HTTP_GET, protectHandler(handleReplay));


  server.on("/previousLogs", HTTP_GET, protectHandler(handlePreviousLogs));

  // JSON API endpoints for logs (for Svelte app)
  server.on("/api/system-logs", HTTP_GET, protectHandler([](AsyncWebServerRequest *req) {
    // Return system logs as JSON array
    JsonDocument doc;
    JsonArray logsArray = doc.to<JsonArray>();

    const int cap = MAX_SYSTEM_LOGS;
    int totalEver, available, startIdx;
    syslogLock();
    totalEver  = systemLogCount;
    available  = (totalEver < cap) ? totalEver : cap;
    startIdx   = (totalEver - available) % cap;
    if (startIdx < 0) startIdx += cap;
    syslogUnlock();

    // Limit to last 100 entries
    int show = (available > 100) ? 100 : available;
    int skip = available - show;

    for (int i = 0; i < show; ++i) {
      int ringPos = (startIdx + skip + i) % cap;
      String line;
      syslogLock();
      line = systemLogs[ringPos];
      syslogUnlock();
      logsArray.add(line);
    }

    String json;
    serializeJson(doc, json);
    req->send(200, "application/json; charset=utf-8", json);
  }));

  server.on("/api/previous-logs", HTTP_GET, protectHandler([](AsyncWebServerRequest *req) {
    // Return previous logs as JSON array (read from file)
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
    req->send(200, "application/json; charset=utf-8", json);
  }));

  // Older logs (2 boots ago) - for troubleshooting multi-reboot flows like registration
  server.on("/api/older-logs", HTTP_GET, protectHandler([](AsyncWebServerRequest *req) {
    // Return older logs as JSON array (from 2 boots ago)
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
    req->send(200, "application/json; charset=utf-8", json);
  }));

  // Note: /systemStatus handler is registered below with JSON/HTML content negotiation
  server.on("/calibration", HTTP_GET, protectHandler(handleCalibrationPage));
  server.on("/setCalib", HTTP_GET, protectHandler(handleSetCalibration));
  server.on("/recalib", HTTP_GET, protectHandler(handleRecalibrate));
  server.on("/resetCalib", HTTP_GET, protectHandler(handleResetCalibration));
  server.on("/falseAlarm", HTTP_GET, protectHandler(handleFalseAlarm));
  server.on("/stream", HTTP_GET, protectHandler(handleStream));
  server.on("/download", HTTP_GET, protectHandler(handleDownloadRaw));
  server.on("/gallery", HTTP_GET, protectHandler(handleGallery));
  server.on("/view", HTTP_GET, protectHandler(handleViewClip));  // existing
  server.on("/servo", HTTP_GET, protectHandler(handleTriggerServo));
  server.on("/servoSettings", HTTP_GET, protectHandler(handleServoSettingsPage));
  server.on("/setServoSettings", HTTP_POST, protectHandler(handleServoSettingsSave));
  server.on("/flushStatus", HTTP_GET, protectHandler(handleFlushStatus));
  server.on("/clearOverride", HTTP_GET, protectHandler(handleClearOverride));
  server.on("/auto.jpg", HTTP_GET, protectHandler(handleAutoSnapshot));  // NEW

  // Debug dashboard endpoints
  server.on("/debug", HTTP_GET, handleDebugDashboard);
  server.on("/api/debug-stats", HTTP_GET, handleDebugStatsAPI);

  server.on("/jslog", HTTP_POST, protectHandler(handleJsLog));
  server.on("/api/calib", HTTP_GET, protectHandler(handleApiCalib));
  server.on("/api/system-info", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
    JsonDocument doc;
    doc["firmwareVersion"] = currentFirmwareVersion;

    // Use version from Preferences (set by MQTT OTA) - NEVER read version.json
    doc["filesystemVersion"] = currentFilesystemVersion;

    // Always include update timestamps (0 = never updated via OTA)
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
    req->send(200, "application/json; charset=utf-8", json);
  }));

  // System status endpoint - returns uptime, heap, etc. as JSON
  server.on("/systemStatus", HTTP_GET, protectHandler([](AsyncWebServerRequest* req) {
    // Check if client wants JSON (for API) or HTML (for browser)
    String acceptHeader = "";
    if (req->hasHeader("Accept")) {
      acceptHeader = req->header("Accept");
    }

    if (acceptHeader.indexOf("application/json") >= 0) {
      // Return JSON for API clients
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
      } else if (mins > 0) {
        snprintf(uptimeBuf, sizeof(uptimeBuf), "%um %us", mins, secs);
      } else {
        snprintf(uptimeBuf, sizeof(uptimeBuf), "%us", secs);
      }

      doc["uptime"] = String(uptimeBuf);
      doc["uptimeSeconds"] = upSec;
      doc["heapFree"] = ESP.getFreeHeap();
      doc["heapTotal"] = ESP.getHeapSize();
      doc["psramFree"] = psramFound() ? ESP.getFreePsram() : 0;
      doc["psramTotal"] = psramFound() ? ESP.getPsramSize() : 0;
      doc["fsUsed"] = LittleFS.usedBytes();
      doc["fsTotal"] = LittleFS.totalBytes();
      doc["cpuFreq"] = ESP.getCpuFreqMHz();

      String json;
      serializeJson(doc, json);
      req->send(200, "application/json; charset=utf-8", json);
    } else {
      // Return HTML for browser (existing implementation)
      handleSystemStatus(req);
    }
  }));
  server.on("/fs/list", HTTP_GET, protectHandler(handleFsList));
  server.on("/fs/get",  HTTP_GET, protectHandler(handleFsGet));
  server.on("/api/captures", HTTP_GET, protectHandler(handleApiCaptures));

  // Device Provisioning API Endpoints
  server.on("/api/device/claim-status", HTTP_GET, [](AsyncWebServerRequest* req) {
    JsonDocument doc;
    doc["claimed"] = deviceClaimed;
    if (deviceClaimed) {
      doc["deviceId"] = claimedDeviceId;
      doc["deviceName"] = claimedDeviceName;
      doc["tenantId"] = claimedTenantId;
      doc["mqttClientId"] = claimedMqttClientId;
      doc["mqttBroker"] = claimedMqttBroker;
      doc["mqttConnected"] = mqttReallyConnected;
    } else {
      doc["macAddress"] = g_macUpper;
      doc["message"] = "Device not claimed - provisioning required";
    }

    String json;
    serializeJson(doc, json);
    req->send(200, "application/json", json);
  });

  server.on("/api/device/claim", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t *data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);

      if (error) {
        req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
        return;
      }

      if (!doc["claimCode"].is<const char*>()) {
        req->send(400, "application/json", "{\"success\":false,\"error\":\"Missing claimCode\"}");
        return;
      }

      String claimCode = doc["claimCode"].as<String>();

      // Perform claim
      bool success = claimDevice(claimCode);

      if (success) {
        JsonDocument response;
        response["success"] = true;
        response["message"] = "Device claimed successfully";
        response["deviceName"] = claimedDeviceName;
        response["deviceId"] = claimedDeviceId;

        String json;
        serializeJson(response, json);
        req->send(200, "application/json", json);

        // Reconnect MQTT with new credentials
        delay(100);
        mqttSetup();

        // Force immediate MQTT connection
        lastMqttReconnect = 0;  // Reset rate limiter
        mqttConnect();  // Connect immediately
      } else {
        req->send(500, "application/json", "{\"success\":false,\"error\":\"Claim failed - check claim code and server connectivity\"}");
      }
    }
  );

  server.on("/api/device/unclaim", HTTP_POST, [](AsyncWebServerRequest* req) {
    // ============================================================================
    // COMPREHENSIVE HTTP UNCLAIM ENDPOINT LOGGING
    // ============================================================================
    IPAddress clientIP = req->client()->remoteIP();
    Serial.println("[HTTP-UNCLAIM] ========================================");
    Serial.println("[HTTP-UNCLAIM] UNCLAIM REQUEST RECEIVED VIA HTTP");
    Serial.println("[HTTP-UNCLAIM] ========================================");
    Serial.printf("[HTTP-UNCLAIM] Request from IP: %s\n", clientIP.toString().c_str());
    Serial.printf("[HTTP-UNCLAIM] Request timestamp: %lu ms\n", millis());
    Serial.printf("[HTTP-UNCLAIM] User-Agent: %s\n", req->hasHeader("User-Agent") ? req->header("User-Agent").c_str() : "unknown");
    Serial.printf("[HTTP-UNCLAIM] Current device: %s (ID: %s)\n", claimedDeviceName.c_str(), claimedDeviceId.c_str());
    Serial.printf("[HTTP-UNCLAIM] MAC: %s\n", g_macUpper.c_str());
    Serial.println("[HTTP-UNCLAIM] ========================================");

    String logMsg = "[HTTP-UNCLAIM] Unclaim request from IP: " + clientIP.toString() +
                    " for device: " + claimedDeviceName + " (MAC: " + g_macUpper + ")";
    addSystemLog(logMsg);

    JsonDocument doc;
    doc["success"] = true;
    doc["message"] = "Device credentials cleared - ready for re-provisioning";

    String json;
    serializeJson(doc, json);
    req->send(200, "application/json", json);

    Serial.println("[HTTP-UNCLAIM] HTTP response sent - initiating unclaim process...");

    // Unclaim device (will notify server if online)
    unclaimDeviceWithSource("local_ui");
  });

  // ============================================================================
  // WiFi Scan Endpoint (for Captive Portal Setup)
  // Returns cached networks, triggers rescan if empty or ?rescan=1
  // ============================================================================
  server.on("/api/wifi/scan", HTTP_GET, [](AsyncWebServerRequest* req) {
    Serial.println("[WIFI-SCAN] === Scan endpoint called ===");
    addSystemLog("[WIFI-SCAN] Endpoint called");

    // Check if rescan requested or cache is empty
    bool forceRescan = req->hasParam("rescan");
    Serial.printf("[WIFI-SCAN] forceRescan=%d, cacheSize=%d, inProgress=%d\n",
                  forceRescan, cachedNetworks.size(), wifiScanInProgress);

    if ((forceRescan || cachedNetworks.empty()) && !wifiScanInProgress) {
      Serial.println("[WIFI-SCAN] Triggering fresh scan...");
      addSystemLog("[WIFI-SCAN] Triggering scan...");
      startWiFiScan();  // This is synchronous, will block
      Serial.println("[WIFI-SCAN] Scan completed");
      addSystemLog("[WIFI-SCAN] Scan done, found " + String(cachedNetworks.size()));
    }

    // Build response
    JsonDocument doc;
    doc["scanning"] = false;  // Scan is synchronous so always done when we respond
    JsonArray networks = doc["networks"].to<JsonArray>();

    // Add cached networks
    Serial.printf("[WIFI-SCAN] Returning %d cached networks\n", cachedNetworks.size());
    for (const auto& net : cachedNetworks) {
      JsonObject network = networks.add<JsonObject>();
      network["ssid"] = net.ssid;
      network["rssi"] = net.rssi;
      network["secure"] = true;
      Serial.printf("[WIFI-SCAN]   %s (%d dBm)\n", net.ssid.c_str(), net.rssi);
    }

    // If still no networks, add manual entry option hint
    if (cachedNetworks.empty()) {
      Serial.println("[WIFI-SCAN] WARNING: No networks found! Adding fallback...");
      addSystemLog("[WIFI-SCAN] No networks - adding manual option");
      // Add a placeholder so the UI knows scan worked but found nothing
      JsonObject network = networks.add<JsonObject>();
      network["ssid"] = "[No networks found - Enter manually]";
      network["rssi"] = -100;
      network["secure"] = true;
    }

    String json;
    serializeJson(doc, json);
    Serial.printf("[WIFI-SCAN] Response: %s\n", json.c_str());
    req->send(200, "application/json", json);
  });

  // ============================================================================
  // WiFi Update Endpoint (for claimed devices that lost WiFi credentials)
  // Updates WiFi credentials without affecting claim status
  // ============================================================================
  server.on("/api/wifi/update", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t *data, size_t len, size_t index, size_t total) {
      Serial.println("[WIFI-UPDATE] === WiFi Update Request ===");
      addSystemLog("[WIFI-UPDATE] Received request");

      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);

      if (error) {
        Serial.printf("[WIFI-UPDATE] JSON parse error: %s\n", error.c_str());
        req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
        return;
      }

      String newSSID = doc["ssid"].as<String>();
      String newPassword = doc["password"].as<String>();

      if (newSSID.length() == 0) {
        req->send(400, "application/json", "{\"success\":false,\"error\":\"SSID is required\"}");
        return;
      }

      if (newPassword.length() < 8) {
        req->send(400, "application/json", "{\"success\":false,\"error\":\"Password must be at least 8 characters\"}");
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
      req->send(200, "application/json", json);

      Serial.println("[WIFI-UPDATE] Credentials saved, rebooting in 1 second...");
      addSystemLog("[WIFI-UPDATE] Rebooting to apply new WiFi...");

      // Restart device to apply new WiFi settings
      delay(1000);
      ESP.restart();
    }
  );

  // ============================================================================
  // Setup Connect Endpoint (for Captive Portal - handles full setup flow)
  // ============================================================================
  // CORS preflight handler for setup endpoints
  // ============================================================================
  // Setup Status Endpoint - Returns last setup attempt result
  // ============================================================================
  server.on("/api/setup/status", HTTP_GET, [](AsyncWebServerRequest* req) {
    SetupResult result = loadSetupResult();

    JsonDocument doc;
    doc["attempted"] = result.attempted;
    doc["success"] = result.success;
    doc["errorCode"] = result.errorCode;
    doc["errorMessage"] = result.errorMessage;

    String json;
    serializeJson(doc, json);
    req->send(200, "application/json", json);
  });

  // Clear setup status (called after user acknowledges error)
  server.on("/api/setup/status/clear", HTTP_POST, [](AsyncWebServerRequest* req) {
    clearSetupResult();
    req->send(200, "application/json", "{\"success\":true}");
  });

  // Setup Progress Endpoint - Real-time status for SPA polling during APSTA setup
  server.on("/api/setup/progress", HTTP_GET, [](AsyncWebServerRequest* req) {
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
    req->send(200, "application/json", json);
  });

  // Reset setup state (allow retry without reboot)
  server.on("/api/setup/reset", HTTP_POST, [](AsyncWebServerRequest* req) {
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

    req->send(200, "application/json", "{\"success\":true}");
  });

  // Trigger reboot (called after successful setup)
  server.on("/api/setup/reboot", HTTP_POST, [](AsyncWebServerRequest* req) {
    req->send(200, "application/json", "{\"success\":true,\"message\":\"Rebooting...\"}");
    delay(500);
    ESP.restart();
  });

  // ============================================================================
  // Test WiFi endpoint - Connect to WiFi only, stay in AP+STA mode
  // Phase 1 of two-phase setup: test WiFi before asking for account info
  // ============================================================================
  server.on("/api/setup/test-wifi", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    Serial.println("[CORS] OPTIONS preflight for /api/setup/test-wifi");
    req->send(200);
  });
  server.on("/api/setup/test-wifi", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (index == 0) req->_tempObject = (void*)new String();
      String* body = (String*)req->_tempObject;
      body->concat((char*)data, len);

      if (index + len == total) {
        addSystemLog("[SETUP-WIFI] === TEST WIFI REQUEST RECEIVED ===");

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        req->_tempObject = nullptr;

        if (err) {
          addSystemLog("[SETUP-WIFI] ERROR: Invalid JSON");
          req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String ssid = doc["ssid"] | "";
        String password = doc["password"] | "";

        addSystemLog("[SETUP-WIFI] SSID: " + ssid);

        if (ssid.isEmpty()) {
          addSystemLog("[SETUP-WIFI] ERROR: Missing SSID");
          req->send(400, "application/json", "{\"success\":false,\"error\":\"Missing required field: ssid\"}");
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
        req->send(200, "application/json", json);
      }
    }
  );

  // ============================================================================
  // Register endpoint - Complete registration (assumes WiFi already connected)
  // Phase 2 of two-phase setup: register device after WiFi is confirmed working
  // ============================================================================
  server.on("/api/setup/register", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    Serial.println("[CORS] OPTIONS preflight for /api/setup/register");
    req->send(200);
  });
  server.on("/api/setup/register", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (index == 0) req->_tempObject = (void*)new String();
      String* body = (String*)req->_tempObject;
      body->concat((char*)data, len);

      if (index + len == total) {
        addSystemLog("[SETUP-REG] === REGISTER REQUEST RECEIVED ===");

        // Check if WiFi is connected
        if (WiFi.status() != WL_CONNECTED) {
          addSystemLog("[SETUP-REG] ERROR: WiFi not connected");
          req->send(400, "application/json", "{\"success\":false,\"error\":\"WiFi not connected. Test WiFi first.\"}");
          return;
        }

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        req->_tempObject = nullptr;

        if (err) {
          addSystemLog("[SETUP-REG] ERROR: Invalid JSON");
          req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String email = doc["email"] | "";
        String accountPassword = doc["accountPassword"] | "";
        String deviceName = doc["deviceName"] | "";
        bool isNewAccount = doc["isNewAccount"] | true;

        addSystemLog("[SETUP-REG] Email: " + email);
        addSystemLog("[SETUP-REG] Device: " + deviceName);
        addSystemLog("[SETUP-REG] NewAccount: " + String(isNewAccount ? "true" : "false"));

        if (email.isEmpty() || accountPassword.isEmpty() || deviceName.isEmpty()) {
          addSystemLog("[SETUP-REG] ERROR: Missing required fields");
          req->send(400, "application/json",
            "{\"success\":false,\"error\":\"Missing required fields: email, accountPassword, deviceName\"}");
          return;
        }

        // Store registration data (WiFi creds already stored from test-wifi)
        pendingSetupEmail = email;
        pendingSetupAccountPassword = accountPassword;
        pendingSetupDeviceName = deviceName;
        pendingSetupIsNewAccount = isNewAccount;
        pendingRegistrationTime = millis();
        pendingRegistration = true;

        addSystemLog("[SETUP-REG] Registration queued");

        JsonDocument response;
        response["success"] = true;
        response["message"] = "Registration initiated";
        String json;
        serializeJson(response, json);
        req->send(200, "application/json", json);
      }
    }
  );

  server.on("/api/setup/connect", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    Serial.println("[CORS] OPTIONS preflight for /api/setup/connect");
    req->send(200);
  });
  server.on("/api/setup/connect", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (index == 0) req->_tempObject = (void*)new String();
      String* body = (String*)req->_tempObject;
      body->concat((char*)data, len);

      if (index + len == total) {
        addSystemLog("[SETUP-CONNECT] === CONNECT REQUEST RECEIVED ===");

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        req->_tempObject = nullptr;  // Clear pointer to prevent double-free

        if (err) {
          addSystemLog("[SETUP-CONNECT] ERROR: Invalid JSON");
          req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String ssid = doc["ssid"] | "";
        String password = doc["password"] | "";
        String email = doc["email"] | "";
        String accountPassword = doc["accountPassword"] | "";
        String deviceName = doc["deviceName"] | "";
        bool isNewAccount = doc["isNewAccount"] | true;  // Default to create account

        addSystemLog("[SETUP-CONNECT] SSID: " + ssid);
        addSystemLog("[SETUP-CONNECT] Email: " + email);
        addSystemLog("[SETUP-CONNECT] Device: " + deviceName);
        addSystemLog("[SETUP-CONNECT] NewAccount: " + String(isNewAccount ? "true" : "false"));

        if (ssid.isEmpty() || email.isEmpty() || accountPassword.isEmpty() || deviceName.isEmpty()) {
          addSystemLog("[SETUP-CONNECT] ERROR: Missing required fields");
          req->send(400, "application/json",
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
        pendingSetupTime = millis();
        pendingSetup = true;

        addSystemLog("[SETUP-CONNECT] Setup queued, pendingSetup=true");

        // Send immediate response
        JsonDocument response;
        response["success"] = true;
        response["message"] = "Setup initiated - device will connect and register shortly";
        String json;
        serializeJson(response, json);
        req->send(200, "application/json", json);
      }
    }
  );

  // ============================================================================
  // Standalone Mode Endpoint - Skip cloud registration, just connect to WiFi
  // ============================================================================
  server.on("/api/setup/standalone", HTTP_OPTIONS, [](AsyncWebServerRequest* req) {
    Serial.println("[CORS] OPTIONS preflight for /api/setup/standalone");
    req->send(200);
  });
  server.on("/api/setup/standalone", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (index == 0) req->_tempObject = (void*)new String();
      String* body = (String*)req->_tempObject;
      body->concat((char*)data, len);

      if (index + len == total) {
        addSystemLog("[STANDALONE] Request received");

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        req->_tempObject = nullptr;  // Clear pointer to prevent double-free

        if (err) {
          req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String ssid = doc["ssid"] | "";
        String password = doc["password"] | "";

        if (ssid.isEmpty()) {
          req->send(400, "application/json", "{\"success\":false,\"error\":\"SSID required\"}");
          return;
        }

        addSystemLog("[STANDALONE] Saving WiFi: " + ssid);

        // Save WiFi credentials
        devicePrefs.begin("wifi", false);
        devicePrefs.putString("ssid", ssid);
        devicePrefs.putString("password", password);
        devicePrefs.putBool("standalone", true);  // Flag for standalone mode
        devicePrefs.end();

        addSystemLog("[STANDALONE] Credentials saved, rebooting...");

        JsonDocument response;
        response["success"] = true;
        response["message"] = "Standalone mode enabled - rebooting";
        String json;
        serializeJson(response, json);
        req->send(200, "application/json", json);

        // Reboot after short delay
        delay(500);
        ESP.restart();
      }
    }
  );

  // ============================================================================
  // DEBUG: Direct registration endpoint (bypasses WiFi reconnect)
  // ============================================================================
  server.on("/api/debug/register", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
      if (index == 0) req->_tempObject = (void*)new String();
      String* body = (String*)req->_tempObject;
      body->concat((char*)data, len);

      if (index + len == total) {
        addSystemLog("[DEBUG-REGISTER] === DIRECT REGISTRATION TEST ===");

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, *body);
        delete body;
        req->_tempObject = nullptr;

        if (err) {
          req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
          return;
        }

        String email = doc["email"] | "";
        String accountPassword = doc["accountPassword"] | "";
        String deviceName = doc["deviceName"] | "";
        bool isNewAccount = doc["isNewAccount"] | false;  // Default to sign-in for debug

        addSystemLog("[DEBUG-REGISTER] Email: " + email);
        addSystemLog("[DEBUG-REGISTER] Device: " + deviceName);
        addSystemLog("[DEBUG-REGISTER] isNewAccount: " + String(isNewAccount ? "true" : "false"));

        if (email.isEmpty() || deviceName.isEmpty()) {
          req->send(400, "application/json",
            "{\"success\":false,\"error\":\"Missing email or deviceName\"}");
          return;
        }

        // Directly call registerAndClaimDevice
        addSystemLog("[DEBUG-REGISTER] Calling registerAndClaimDevice()...");
        bool result = registerAndClaimDevice(email, accountPassword, deviceName, isNewAccount);

        JsonDocument response;
        response["success"] = result;
        response["message"] = result ? "Registration successful" : "Registration failed - check logs";
        String json;
        serializeJson(response, json);
        req->send(200, "application/json", json);
      }
    }
  );

  // ============================================================================
  // DEBUG: MQTT credentials endpoint (for debugging auth issues)
  // ============================================================================
  server.on("/api/debug/mqtt-creds", HTTP_GET, [](AsyncWebServerRequest* req) {
    // Basic auth check
    if (!req->authenticate("ops", "changeme")) {
      return req->requestAuthentication();
    }

    JsonDocument doc;
    doc["broker"] = claimedMqttBroker;
    doc["username"] = claimedMqttUsername;
    doc["password"] = claimedMqttPassword;  // WARNING: Sensitive! Remove in production
    doc["clientId"] = claimedMqttClientId;
    doc["deviceClaimed"] = deviceClaimed;

    String json;
    serializeJson(doc, json);
    req->send(200, "application/json", json);
  });

  // ============================================================================
  // Device Claim/Unclaim Page
  // ============================================================================
  server.on("/claim", HTTP_GET, [](AsyncWebServerRequest* req) {
    String html = String(R"HTMLEND(
<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Device Claim</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
.container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
h1 { color: #333; margin-bottom: 20px; }
.status { padding: 15px; border-radius: 5px; margin-bottom: 20px; }
.claimed { background: #d4edda; color: #155724; }
.unclaimed { background: #fff3cd; color: #856404; }
input { width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 5px; font-size: 16px; margin-bottom: 15px; }
button { width: 100%; padding: 14px; background: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; margin-bottom: 10px; }
button:hover { background: #0056b3; }
button.unclaim { background: #dc3545; }
button.unclaim:hover { background: #c82333; }
.message { padding: 10px; border-radius: 5px; margin-top: 15px; display: none; }
.success { background: #d4edda; color: #155724; display: block; }
.error { background: #f8d7da; color: #721c24; display: block; }
</style>
</head><body>
<div class="container">
  <h1>Device Claim</h1>
  <div id="statusBox" class="status"></div>
  <div id="claimSection" style="display:none;">
    <input type="text" id="claimCode" placeholder="Enter claim code" maxlength="8" style="text-transform: uppercase;">
    <button onclick="claim()">Claim Device</button>
  </div>
  <div id="unclaimSection" style="display:none;">
    <button class="unclaim" onclick="unclaim()">Unclaim Device</button>
  </div>
  <div id="message" class="message"></div>
  <p style="margin-top: 20px; text-align: center;"><a href="/">← Back to Home</a></p>
</div>
<script>
fetch('/api/device/claim-status').then(r => r.json()).then(data => {
  const statusBox = document.getElementById('statusBox');
  if (data.claimed) {
    statusBox.className = 'status claimed';
    statusBox.innerHTML = '<strong>✓ Device Claimed</strong><br>Name: ' + data.deviceName + '<br>ID: ' + data.deviceId;
    document.getElementById('unclaimSection').style.display = 'block';
  } else {
    statusBox.className = 'status unclaimed';
    statusBox.innerHTML = '<strong>⚠ Device Not Claimed</strong><br>MAC: ' + data.macAddress;
    document.getElementById('claimSection').style.display = 'block';
  }
});
function claim() {
  const code = document.getElementById('claimCode').value.trim().toUpperCase();
  const msg = document.getElementById('message');
  if (!code) { alert('Please enter a claim code'); return; }
  msg.style.display = 'none';
  msg.textContent = 'Claiming device...';
  fetch('/api/device/claim', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({claimCode: code})
  }).then(r => r.json()).then(data => {
    msg.style.display = 'block';
    if (data.success) {
      msg.className = 'message success';
      msg.textContent = '✓ ' + data.message;
      setTimeout(() => location.reload(), 2000);
    } else {
      msg.className = 'message error';
      msg.textContent = '✗ ' + (data.error || 'Claim failed');
    }
  }).catch(err => {
    msg.style.display = 'block';
    msg.className = 'message error';
    msg.textContent = '✗ Error: ' + err.message;
  });
}
function unclaim() {
  if (!confirm('Are you sure you want to unclaim this device? This will clear all credentials and the device will need to be reclaimed.')) return;
  const msg = document.getElementById('message');
  msg.style.display = 'none';
  fetch('/api/device/unclaim', {
    method: 'POST'
  }).then(r => r.json()).then(data => {
    msg.style.display = 'block';
    if (data.success) {
      msg.className = 'message success';
      msg.textContent = '✓ ' + data.message;
      setTimeout(() => location.reload(), 2000);
    } else {
      msg.className = 'message error';
      msg.textContent = '✗ Error unclaiming device';
    }
  }).catch(err => {
    msg.style.display = 'block';
    msg.className = 'message error';
    msg.textContent = '✗ Error: ' + err.message;
  });
}
</script>
</body></html>
)HTMLEND");
    req->send(200, "text/html", html);
  });

  // ============================================================================
  // Captive Portal Routes (for WiFi Setup)
  // ============================================================================

  // Captive portal setup page - serves the SPA from LittleFS
  server.on("/setup", HTTP_GET, [](AsyncWebServerRequest* req) {
    // Serve the SPA - it will show the Setup wizard when loaded
    req->redirect("/app/#/setup");
  });

  // API endpoint to configure WiFi and claim device
  server.on("/api/device/configure", HTTP_POST, [](AsyncWebServerRequest* req){}, NULL,
    [](AsyncWebServerRequest* req, uint8_t *data, size_t len, size_t index, size_t total) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, data, len);

      if (error) {
        req->send(400, "application/json", "{\"success\":false,\"error\":\"Invalid JSON\"}");
        return;
      }

      String newSSID = doc["ssid"].as<String>();
      String newPassword = doc["password"].as<String>();
      String claimCode = doc["claimCode"].as<String>();

      if (newSSID.length() == 0) {
        req->send(400, "application/json", "{\"success\":false,\"error\":\"SSID is required\"}");
        return;
      }

      // Save WiFi credentials
      saveWiFiCredentials(newSSID, newPassword);

      // Attempt to claim if claim code provided
      bool claimed = false;
      if (claimCode.length() > 0) {
        claimed = claimDevice(claimCode);
      }

      JsonDocument response;
      response["success"] = true;
      response["message"] = claimed ?
        "Device configured and claimed successfully!" :
        "WiFi configured! Device will restart and connect.";
      response["redirectUrl"] = "http://192.168.133.21";

      String json;
      serializeJson(response, json);
      req->send(200, "application/json", json);

      // Restart device to apply new WiFi settings
      delay(1000);
      ESP.restart();
    }
  );

  // Captive portal redirect - catches all requests when in AP mode
  server.onNotFound([](AsyncWebServerRequest* req) {
    if (isAPMode) {
      req->redirect("/setup");
    } else {
      req->send(404, "text/plain", "Not Found");
    }
  });

  server.on("/sendHeartbeat", HTTP_GET, [](AsyncWebServerRequest* request) {
    addSystemLog("HTTP /sendHeartbeat");
    sendHeartbeat();  // <-- your C++ function runs here
    request->send(200, "application/json", "{\"ok\":true}");
  });

  server.on("/servoSet", HTTP_GET, protectHandler([](AsyncWebServerRequest *req) {
    if (disableServo) {
      return req->send(409, "text/plain", "Servo disabled");
    }
    if (!req->hasParam("val")) {
      return req->send(400, "text/plain", "Missing val");
    }
    int val = req->getParam("val")->value().toInt();
    trapServo.writeMicroseconds(val);
    req->send(200, "text/plain", "OK");
  }));

 
  /* serve every /captures/… request straight from LittleFS */
  server.serveStatic("/captures", LittleFS, CAPTURE_DIR "/")
    .setFilter([](AsyncWebServerRequest *r) {
      return isAllowed(r);
    });

  server.on(
    "/deletePhotos",
    HTTP_POST,
    /* onRequest: just ACL, no body yet */
    protectHandler([](AsyncWebServerRequest *req) {
      /* nothing to do here – the real work happens in the body handler */
    }),
    /* onUpload */ NULL,
    /* onBody   */ handleDeletePhotos  // <-- the function above
  );

  // — firmware redirect —
  server.on("/firmware", HTTP_GET,
            protectHandler([](AsyncWebServerRequest *r) {
              r->redirect("/update");
            }));

  // — LittleFS OTA upload endpoint —
  Serial.println("[DEBUG] Registering /uploadfs endpoint...");
  addSystemLog("[DEBUG] Registering /uploadfs endpoint...");

  server.on("/uploadfs", HTTP_POST,
    // onRequest (called when upload completes)
    [](AsyncWebServerRequest *request) {
      Serial.println("[uploadfs] onRequest callback executing");
      addSystemLog("[uploadfs] onRequest callback executing");

      // Check basic auth
      if (!request->authenticate("ops", "changeme")) {
        Serial.println("[uploadfs] Auth failed");
        addSystemLog("[uploadfs] Auth failed in onRequest");
        return request->requestAuthentication();
      }

      Serial.printf("[uploadfs] fsUploadStarted=%d, Update.hasError()=%d\n", fsUploadStarted, Update.hasError());
      addSystemLog(String("[uploadfs] fsUploadStarted=") + (fsUploadStarted?"true":"false") + " hasError=" + (Update.hasError()?"true":"false"));

      // Only check Update.hasError() if upload actually started
      bool success = fsUploadStarted && !Update.hasError();
      AsyncWebServerResponse *response = request->beginResponse(200, "text/plain",
        success ? "LittleFS Update Success! Rebooting..." : "LittleFS Update Failed!");
      response->addHeader("Connection", "close");
      request->send(response);

      if (success) {
        addSystemLog("LittleFS OTA update successful, rebooting...");
        fsUploadStarted = false;  // Reset flag
        delay(1000);
        ESP.restart();
      } else {
        if (fsUploadStarted) {
          addSystemLog("LittleFS OTA update failed: " + String(Update.errorString()));
        } else {
          addSystemLog("LittleFS OTA update failed: No file uploaded");
        }
        fsUploadStarted = false;  // Reset flag
      }
    },
    // onUpload (called for each chunk)
    [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
      // Log every chunk for debugging
      Serial.printf("[uploadfs] onUpload: index=%u len=%u final=%d\n", index, len, final);

      // Check basic auth
      if (!request->authenticate("ops", "changeme")) {
        Serial.println("[uploadfs] Auth failed in onUpload");
        addSystemLog("[uploadfs] Auth failed in onUpload");
        return;
      }

      if (index == 0) {
        fsUploadStarted = true;  // Mark upload as started
        Serial.printf("LittleFS Update Start: %s\n", filename.c_str());
        addSystemLog("Starting LittleFS OTA update: " + filename);

        // Unmount filesystem before update
        Serial.println("[OTA] Unmounting LittleFS before update...");
        LittleFS.end();

        // Begin update with filesystem partition type
        // U_SPIFFS works for both SPIFFS and LittleFS
        DEBUG_SNAPSHOT("ota_filesystem_update");
        if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_SPIFFS)) {
          Update.printError(Serial);
          addSystemLog("LittleFS OTA begin failed");
        }
      }

      // Write chunk
      if (Update.write(data, len) != len) {
        Update.printError(Serial);
      }

      if (final) {
        if (Update.end(true)) {
          Serial.printf("LittleFS Update Success: %u bytes\n", index + len);
          addSystemLog("LittleFS OTA complete: " + String(index + len) + " bytes");
        } else {
          Update.printError(Serial);
          addSystemLog("LittleFS OTA end failed");
        }
      }
    }
  );

  Serial.println("[DEBUG] /uploadfs endpoint registered successfully");
  addSystemLog("[DEBUG] /uploadfs endpoint registered successfully");

  // — Firmware OTA upload endpoint —
  Serial.println("[DEBUG] Registering /uploadfw endpoint...");
  addSystemLog("[DEBUG] Registering /uploadfw endpoint...");

  server.on("/uploadfw", HTTP_POST,
    // onRequest (called when upload completes)
    [](AsyncWebServerRequest *request) {
      // Check basic auth
      if (!request->authenticate("ops", "changeme")) {
        return request->requestAuthentication();
      }

      bool success = !Update.hasError();
      AsyncWebServerResponse *response = request->beginResponse(200, "text/plain",
        success ? "Firmware Update Success! Rebooting..." : "Firmware Update Failed!");
      response->addHeader("Connection", "close");
      request->send(response);

      if (success) {
        addSystemLog("Firmware OTA update successful, rebooting...");
        delay(1000);
        ESP.restart();
      } else {
        addSystemLog("Firmware OTA update failed: " + String(Update.errorString()));
      }
    },
    // onUpload (called for each chunk)
    [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
      // Check basic auth
      if (!request->authenticate("ops", "changeme")) {
        return;
      }

      if (index == 0) {
        Serial.printf("Firmware Update Start: %s\n", filename.c_str());
        addSystemLog("Starting Firmware OTA update: " + filename);

        // Begin update with firmware partition type
        DEBUG_SNAPSHOT("ota_firmware_update");
        if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
          Update.printError(Serial);
          addSystemLog("Firmware OTA begin failed");
        }
      }

      // Write chunk
      if (Update.write(data, len) != len) {
        Update.printError(Serial);
      }

      if (final) {
        if (Update.end(true)) {
          Serial.printf("Firmware Update Success: %u bytes\n", index + len);
          addSystemLog("Firmware OTA complete: " + String(index + len) + " bytes");
        } else {
          Update.printError(Serial);
          addSystemLog("Firmware OTA end failed");
        }
      }
    }
  );

}

void setHighPowerLED(bool state) {
  if (state) {
    digitalWrite(HIGH_POWER_LED_PIN, HIGH);  // NEW LED ON
    highPowerLedState = true;
    highPowerLedOnTimestamp = millis();  // Record the time it was turned on
  } else {
    digitalWrite(HIGH_POWER_LED_PIN, LOW);  // NEW LED OFF
    highPowerLedState = false;
  }
}




void calibrateThreshold() {
  PAGE_SCOPE("calibrateThreshold");
  CrashKit::markLine(100);
  if (!sensorFound) return;

  if (overrideThreshold > 0) {
    threshold = overrideThreshold;
    addSystemLog("Skipping calibration from calibrateThreshold(). Threshold override active: " + String(threshold) + " mm");
    return;
  }

  g_calibrating = true;
  const unsigned long CALIB_MS = 10000;
  unsigned long start = millis();

  // NEW: track valid-sample stats only
  uint32_t sum = 0;
  uint16_t cnt = 0;
  uint16_t minv = 0xFFFF, maxv = 0;

  while (millis() - start < CALIB_MS) {
    uint16_t d = readToF_mm_once();

    // Ignore known bad reads
    if (d == 0) {           // invalid read or out-of-range in your driver
      TASK_YIELD_MS(50);
      CRASH_MARK_LINE();
      continue;
    }
    // For VL6180X, clamp obvious nonsense
    if (!useVL53 && d > 250) { // VL6180X is ~0..~200–250mm
      TASK_YIELD_MS(50);
      CRASH_MARK_LINE();
      continue;
    }

    sum += d;
    cnt++;
    if (d < minv) minv = d;
    if (d > maxv) maxv = d;

    TASK_YIELD_MS(50);
    CRASH_MARK_LINE();
  }

  int defaultOffset = -50;

  if (cnt > 0) {
    // NEW: trim one min & max if we have enough samples
    if (cnt >= 3) {
      sum -= minv;
      sum -= maxv;
      cnt -= 2;
    }
    uint16_t avg = sum / cnt;

    threshold = computeThreshold(avg);  // you already account for calibrationOffset & falseAlarmOffset

    Serial.printf("Calib %u samples (trimmed), avg=%u → threshold=%u (calibOff=%d, falseOff=%d, defaultOffset=%d)\n",
                  cnt, avg, threshold, calibrationOffset, falseAlarmOffset, defaultOffset);
    addSystemLog(formatTime(time(nullptr)) + " Calibration done (" + String(cnt)
                 + " samples). Average = " + String(avg) + "mm. calibrationOffset = "
                 + String(calibrationOffset) + ". falseAlarmOffset = " + String(falseAlarmOffset)
                 + ". Default offset = " + String(defaultOffset) + ". Threshold = " + String(threshold) + " mm.");
  } else {
    Serial.println("Calib failed: no valid samples");
    addSystemLog(formatTime(time(nullptr)) + " Calibration failed. No samples collected.");
  }

  g_calibrating = false;
  CrashKit::markLine(200);
}

void recalibTask(void *p) {
  reCalBusy = true;
  if (overrideThreshold > 0) {
    threshold = overrideThreshold;
    addSystemLog("Early return from recalibTask(). Threshold override active: " + String(threshold) + " mm");
    reCalBusy = false;
    vTaskDelete(nullptr);  // <— make the task end cleanly
    return;                // (never reached, but fine)
  }
  calibrateThreshold();  // ~10 s loop
  calibDoneMillis = millis();
  addSystemLog("Re-calibration finished. Threshold=" + String(threshold) + " mm");
  reCalBusy = false;
  vTaskDelete(nullptr);
}

void IRAM_ATTR reCalTimerCb(TimerHandle_t) {
  PAGE_SCOPE("reCalTimerCb");
  if (overrideThreshold == 0) reCalFlag = true;  // just set the flag
  /* if overrideThreshold > 0 the timer is stopped anyway */
}

void handleCalibrationPage(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleCalibrationPage");
  if (!isAllowed(req)) {
    req->send(403, "text/plain", "Forbidden");
    return;
  }

  // reload from NVS so the UI always shows the last-saved values
  calibrationOffset = preferences.getInt("calibOff", calibrationOffset);
  overrideThreshold = preferences.getInt("overrideTh", overrideThreshold);
  // if override is active, apply it immediately
  if (overrideThreshold > 0) {
    threshold = overrideThreshold;
  }

  String html = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Calibration Settings</title>
<style>
  body{background:#222;color:#ddd;font-family:Arial;padding:10px}
  .btn{margin:8px 4px;padding:6px 12px;background:#444;color:#ddd;border:none;cursor:pointer}
  .btn:hover{background:#555}
  label{display:block;margin:8px 0}
</style>
</head><body>)rawliteral"
                + getHamburgerMenuHTML() +
                R"rawliteral(
  <h1>Calibration Settings</h1>

  <p><strong>False-Alarm Offset:</strong>
     <span id="falseOffDisplay">)rawliteral"
                + String(falseAlarmOffset) +
                R"rawliteral(</span> mm</p>

  <p><strong>Current Threshold:</strong>
     <span id="thresholdDisplay">)rawliteral"
                + String(threshold) +
                R"rawliteral(</span> mm</p>

  <label>
    Calibration Offset:
    <input id="calib" type="range" min="-1000" max="1000"
           value=")rawliteral"
                + String(calibrationOffset) +
                R"rawliteral(" oninput="offChanged(this.value)">
    <span id="offsetDisplay">)rawliteral"
                + String(calibrationOffset) +
                R"rawliteral(</span> mm
  </label>

  <label>
    Override Threshold (mm):
    <input id="overrideTh" type="number" value=")rawliteral"
                + String(overrideThreshold) +
                R"rawliteral(">
  </label>

  <button class="btn" onclick="saveCalibration()">💾 Save</button>
  <button class="btn" onclick="clearOverride()">🗑️ Clear Override</button>
  <button class="btn" id="recalBtn" onclick="recalibrate()">🔁 Recalibrate</button>

  <br><br><a href="/" style="color:#0af;">⬅︎ Back</a>

  <script>
    function offChanged(v){
      document.getElementById('offsetDisplay').innerText = v;
    }
    async function saveCalibration(){
      const params = new URLSearchParams();
      params.set('calib',    document.getElementById('calib').value);
      params.set('overrideTh', document.getElementById('overrideTh').value);
      await fetch('/setCalib?'+params.toString());
      location.reload();
    }
    async function clearOverride(){
      await fetch('/setCalib?overrideTh=0');
      location.reload();
    }
    async function recalibrate(){
      const btn = document.getElementById('recalBtn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Recalibrating...'; }
      try {
        const r = await fetch('/recalib');          // mapped to handleRecalibrate
        const t = await r.text();
        alert(t);                                   // e.g., "Re-calibration started"
      } catch (e) {
        alert('Recalibrate failed: ' + e);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔁 Recalibrate'; }
      }
    }

    // If an override is active, recalibration will be ignored server-side.
    // Disable the button client-side for clarity until the user clears override.
    (function(){
      const ovr = parseInt(document.getElementById('overrideTh').value || '0', 10);
      if (ovr > 0) {
        const b = document.getElementById('recalBtn');
        if (b) { b.disabled = true; b.title = 'Clear override to recalibrate'; }
      }
    })();

  </script>
</body></html>
)rawliteral";

  req->send(200, "text/html", html);
}


// Calibration page: slider [-100–100], shows current falseAlarmOffset
// void handleCalibrationPage(AsyncWebServerRequest *req) {
//   if (!isAllowed(req)) {
//     req->send(403, "text/plain", "Forbidden");
//     return;
//   }

//   //loadSettings();  // get latest values from NVS
//   overrideThreshold = preferences.getInt("overrideTh", 0);

//   // if an override was saved, apply it immediately
//   if (overrideThreshold > 0) {
//     threshold = overrideThreshold;
//   }

//   int calibOff = calibrationOffset;  // –100 … +100
//   int currThresh = threshold;        // current threshold in mm

// String html = R"rawliteral(
// <!DOCTYPE html>
// <html><head><meta charset='utf-8'>
// <title>Calibration Settings</title>
// <style>
//   body{background:#222;color:#ddd;font-family:Arial;padding:10px}
//   .btn{margin:8px 4px;padding:6px 12px;background:#444;color:#ddd;border:none;cursor:pointer}
//   .btn:hover{background:#555}
// </style>
// </head><body>)rawliteral"
//   + getHamburgerMenuHTML() +
// R"rawliteral(
//   <h1>Calibration Settings</h1>

//   <p><strong>False-Alarm Offset:</strong>
//      <span id="falseOffDisplay">)rawliteral"
//   + String(falseAlarmOffset) +
// R"rawliteral(</span> mm</p>

//   <p><strong>Current Threshold:</strong>
//      <span id="thresholdDisplay">)rawliteral"
//   + String(currThresh) +
// R"rawliteral(</span> mm</p>

//   <form action="/setCalib" method="GET">
//     <label>
//       Calibration Offset:
//       <input type="range" name="calibOff" min="-1000" max="1000"
//              value=")rawliteral"
//   + String(calibrationOffset) +
// R"rawliteral(" oninput="offChanged(this.value)">
//       <span id="offsetDisplay">)rawliteral"
//   + String(calibrationOffset) +
// R"rawliteral(</span>
//     </label>
//     <br>

//   </form>

//   <label>Override threshold (mm):
//     <input type="number" id="overrideTh" value="<!--=overrideThreshold-->">
//   </label>
//   <button class="btn" onclick="saveCalibration()">💾 Save Settings</button>
//   <button class="btn" onclick="clearOverride()">🗑️ Clear Override</button>

//   <br><br><a href="/" style="color:#0af;">Back</a>
//   <button class="btn"
//         onclick="fetch('/setCalib?overrideTh=0', { method:'GET' })
//                   .then(()=>location.reload())">
//   🗑️ Clear Override
//   </button>


//   <button class="btn" onclick="fetch('/recalib').then(()=>alert('Recalibrating…'))">
//     🔄 Recalibrate now
//   </button>
//   <button class="btn" onclick="resetCalib()">🗑️ Reset Calibration</button>

//   <br><br><a href="/" style="color:#0af;">⬅︎ Back</a>

//   <script>
//     function offChanged(v) {
//       document.getElementById('offsetDisplay').innerText = v;
//     }
//     function resetCalib(){
//       fetch('/resetCalib')
//         .then(r=>r.text())
//         .then(msg=>{ alert(msg); location.reload(); })
//         .catch(e=>alert('Reset failed: '+e));
//     }
//   </script>
//   <script>
//   async function saveCalibration() {
//     // grab the slider value and override field
//     const calibVal    = document.getElementById("calib").value;
//     const overrideVal = document.getElementById("overrideTh").value;

//     const params = new URLSearchParams();
//     params.set("calib", calibVal);
//     params.set("overrideTh", overrideVal);

//     try {
//       await fetch("/setCalibration?" + params.toString());
//       // reload the same page so your inputs show the new stored values
//       location.reload();
//     } catch (err) {
//       alert("Save failed: " + err);
//     }
//   }

//   async function clearOverride() {
//     try {
//       // overrideTh=0 clears it on the server
//       await fetch("/setCalibration?overrideTh=0");
//       location.reload();
//     } catch (err) {
//       alert("Clear override failed: " + err);
//     }
//   }
//   </script>

// </body></html>
// )rawliteral";

// req->send(200, "text/html", html);
// }

void handleSetCalibration(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleSetCalibration");
  if (!isAllowed(req)) {
    return req->send(403, "text/plain", "Forbidden");
  }

  // must have at least one of them
  if (!req->hasArg("calib") && !req->hasArg("overrideTh")) {
    return req->send(400, "text/plain", "Missing calib or overrideTh");
  }

  // ▲ Open NVS namespace for *all* writes in this function
  preferences.begin("settings", false);

  // 1) Slider moved?
  if (req->hasArg("calib")) {
    int newOff = req->arg("calib").toInt();  // e.g. –100…+100
    int delta = newOff - calibrationOffset;
    if (delta != 0) {
      calibrationOffset = newOff;
      preferences.putInt("calibOff", calibrationOffset);
      addSystemLog(formatTime(time(nullptr))
                   + " 🔧 Calibration offset set to "
                   + String(calibrationOffset) + " mm");
      // live-adjust
      threshold = max(0, int(threshold) + delta);
      addSystemLog(formatTime(time(nullptr))
                   + " ✅ Active threshold now "
                   + String(threshold) + " mm");
    }
  }

  // 2) Override typed in?
  if (req->hasArg("overrideTh")) {
    int newOvr = req->arg("overrideTh").toInt();
    if (newOvr > 0) {
      // set override
      overrideThreshold = newOvr;
      preferences.putInt("overrideTh", overrideThreshold);
      addSystemLog(formatTime(time(nullptr))
                   + " 🔧 Override threshold set to "
                   + String(overrideThreshold) + " mm");
      threshold = overrideThreshold;
      addSystemLog(formatTime(time(nullptr))
                   + " ✅ Active threshold now "
                   + String(threshold) + " mm");
    } else {
      // clear override
      overrideThreshold = 0;
      preferences.remove("overrideTh");
      addSystemLog(formatTime(time(nullptr))
                   + " 🔧 Override threshold cleared");
      g_lastSettingsSaveMs = millis();

      // recalc from sensor or offsets
      //calibrateThreshold();
      //xTaskCreatePinnedToCore(recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 1);
      if (!reCalBusy) {
        xTaskCreatePinnedToCore(recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 1);
        addSystemLog("Re-calibration scheduled.");
      } else {
        addSystemLog("Re-calibration request skipped: already running.");
      }
      //addSystemLog(formatTime(time(nullptr)) + " ✅ Threshold recalculated to " + String(threshold) + " mm");
    }
    preferences.end();
  }

  req->send(200, "text/plain", "OK");
}

// void handleSetCalibration(AsyncWebServerRequest *req) {
//   if (!isAllowed(req) ||
//       (!req->hasArg("calib") && !req->hasArg("overrideTh"))) {
//     req->send(400, "text/plain", "Missing calib or overrideTh");
//     return;
//   }
//   if (overrideThreshold > 0) {
//     threshold = overrideThreshold;
//     addSystemLog("Threshold override active: " + String(threshold) + " mm");
//     return;
//   }


//   // 1) slider moved?
//   if (req->hasArg("calib")) {
//     int newOff = req->arg("calib").toInt();
//     int delta  = newOff - calibrationOffset;
//     if (delta != 0) {
//       calibrationOffset = newOff;
//       preferences.putInt("calibOff", calibrationOffset);
//       addSystemLog(
//         formatTime(time(nullptr))
//         + " 🔧 Calibration offset set to " + String(calibrationOffset) + " mm"
//       );
//       // live-adjust the threshold by the same delta
//       threshold = max(0, int(threshold) + delta);
//       addSystemLog(
//         formatTime(time(nullptr))
//         + " ✅ Active threshold now " + String(threshold) + " mm"
//       );
//     }
//   }

//   // 2) override typed in?
//   if (req->hasArg("overrideTh")) {
//     int newOvr = req->arg("overrideTh").toInt();
//     if (newOvr != overrideThreshold) {
//       overrideThreshold = newOvr;
//       preferences.putInt("overrideTh", overrideThreshold);
//       addSystemLog(
//         formatTime(time(nullptr))
//         + " 🔧 Override threshold set to " + String(overrideThreshold) + " mm"
//       );
//       // override takes immediate effect
//       threshold = overrideThreshold;
//       addSystemLog(
//         formatTime(time(nullptr))
//         + " ✅ Active threshold now " + String(threshold) + " mm"
//       );
//     }
//   }

//   req->send(200, "text/plain", "OK");
// }


void handleResetCalibration(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleResetCalibration");
  if (!isAllowed(req)) {
    return req->send(403, "text/plain", "Forbidden");
  }

  // 1) clear everything
  calibrationOffset = 0;
  falseAlarmOffset = 0;
  overrideThreshold = 0;

  // 2) persist to NVS
  preferences.putInt("calibOff", calibrationOffset);
  preferences.putInt("falseOff", falseAlarmOffset);
  preferences.putInt("overrideTh", overrideThreshold);

  // 3) log what happened here
  addSystemLog("Calibration offsets reset to 0");
  addSystemLog("Override threshold cleared");
  g_lastSettingsSaveMs = millis();


  // 4) live-update the running threshold
  //threshold = /* either your default-recalc or simply zero */ overrideThreshold;
  //calibrateThreshold();
  //xTaskCreatePinnedToCore(recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 1);
  if (!reCalBusy) {
    xTaskCreatePinnedToCore(recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 1);
    addSystemLog("Re-calibration scheduled.");
  } else {
    addSystemLog("Re-calibration request skipped: already running.");
  }


  // 5) reply to the client
  req->send(200, "text/plain", "OK");
}

void handleClearOverride(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleClearOverride");
  if (!isAllowed(req))
    return req->send(403, "text/plain", "Forbidden");

  // clear the override in RAM + NVS
  overrideThreshold = 0;
  preferences.putInt("overrideTh", 0);
  addSystemLog("🔄 Override threshold cleared");
  g_lastSettingsSaveMs = millis();


  // recompute a fresh threshold
  //calibrateThreshold();
  //xTaskCreatePinnedToCore(recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 1);
  if (!reCalBusy) {
    xTaskCreatePinnedToCore(recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 1);
    addSystemLog("Re-calibration scheduled.");
  } else {
    addSystemLog("Re-calibration request skipped: already running.");
  }


  req->send(200, "text/plain", "OK");
}


// void handleResetCalibration(AsyncWebServerRequest *req) {
//   if (!isAllowed(req)) {
//     req->send(403);
//     return;
//   }

//   if (overrideThreshold > 0) {
//     threshold = overrideThreshold;
//     addSystemLog("Can't reset calibration. Threshold override active: " + String(threshold) + " mm." + "Set override threshold to zero to clear.");
//     return;
//   }

//   // Undo both offsets in the live threshold
//   threshold += (calibrationOffset + falseAlarmOffset);

//   // Zero the offsets and persist
//   calibrationOffset = 0;
//   falseAlarmOffset = 0;
//   saveSettings();

//   Serial.printf("ResetCalib: threshold=%u, calibOff=0, falseOff=0\n", threshold);
//   addSystemLog("Calibration reset ⇒ threshold " + String(threshold) + " mm");

//   String json =
//     "{\"calibOff\":0,\"falseOff\":0,\"threshold\":" + String(threshold) + "}";
//   req->send(200, "application/json", json);
// }


void handleRecalibrate(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleRecalibrate");
  if (!isAllowed(req)) {
    req->send(403);
    return;
  }
  if (overrideThreshold > 0) {
    threshold = overrideThreshold;
    addSystemLog("Can't recalibrate.  Threshold override active: " + String(threshold) + " mm");
    return;
  }

  // launch once, low priority, on core 1
  xTaskCreatePinnedToCore(
    recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 0);

  //addSystemLog("Re-calibrated ⇒ threshold " + String(threshold) + " mm");

  req->send(200, "text/plain", "Re-calibration started");
}


// --- False Alarm button increments false offset ---
void handleFalseAlarm(AsyncWebServerRequest *req) {
  PAGE_SCOPE("handleFalseAlarm");
  if (!isAllowed(req)) {
    return req->send(403, "text/plain", "Forbidden");
  }
  if (overrideThreshold > 0) {
    threshold = overrideThreshold;
    addSystemLog("Can't set false alarm offset. Threshold override active: " + String(threshold) + " mm");
    return;
  }

  const int STEP = 10;       // +5 mm each false alarm
  falseAlarmOffset += STEP;  // store
  threshold -= STEP;         // apply immediately

  saveSettings();
  addSystemLog("False alarm ⇒ threshold " + String(threshold) + " mm (falseOff=" + String(falseAlarmOffset) + ")");
  String json = "{\"falseOff\":" + String(falseAlarmOffset) + ",\"threshold\":" + String(threshold) + "}";
  req->send(200, "application/json", json);
  //req->send(200, "text/plain", "False Alarm offset: " + String(falseAlarmOffset));
}


void notifyBootIP() {
  /* 1) Get public IP (you were already caching PUBLIC_IP) */
  String ip = PUBLIC_IP;
  ip.trim();
  addSystemLog("Public IP: " + ip);

  /* 2) Build JSON for the relay -------------------------------------- */
  String url = String(emailServer) + "/mouse-trap";  // same route

  HTTPClient relay;
  relay.setTimeout(3000);
  relay.begin(url);
  relay.addHeader("Content-Type", "application/json");

  JsonDocument doc; // keep your ArduinoJson v6 usage

  // ---- REQUIRED fields your relay already renders ----
  // Boot subject includes reset reason; status includes IP + crash summary
  String crashLine  = CrashKit::makeBootCrashReport();
  String statusLine = ip + "\nCrash: " + crashLine;

  String trapIdLine = "boot (" + String(CrashKit::resetReasonToString(esp_reset_reason())) + ")";

  doc["trapId"] = trapIdLine;
  doc["status"] = statusLine;
  doc["mac"]    = WiFi.macAddress();

  // NEW: send LAN/WAN explicitly (server also infers as fallback)
  doc["lan"]    = WiFi.localIP().toString();
  if (ip.length()) doc["wan"] = ip;

  // ---- Keep the structured crash object too ----
  doc["crash"]["summary"]      = crashLine;
  doc["crash"]["reason_code"]  = (int)esp_reset_reason();
  doc["crash"]["last_page"]    = g_crashStamp.last_page;
  doc["crash"]["last_line"]    = g_crashStamp.last_line;
  doc["crash"]["last_core"]    = (int)g_crashStamp.last_core;
  doc["crash"]["last_heap"]    = (int)g_crashStamp.last_heap;
  doc["crash"]["last_biggest"] = (int)g_crashStamp.last_biggest;
  doc["crash"]["stamped"]      = (g_crashStamp.magic == 0xC0DEC0DE && g_crashStamp.last_page[0] != 0);
  //doc["mac"] = WiFi.macAddress();            // keep MAC in the payload
  //doc["lan"] = WiFi.localIP().toString();    // LAN IP
  //if (PUBLIC_IP.length()) doc["wan"] = PUBLIC_IP;   // WAN if you have it

  String payload;
  serializeJson(doc, payload);

  addSystemLog("Boot email payload: " + payload);

  /* 3) Send ----------------------------------------------------------- */
  int code = relay.POST(payload);
  if (code == 200) {
    addSystemLog("Boot-up IP email queued");
  } else {
    addSystemLog("Relay POST failed: " + String(code));
  }
  relay.end();
}

void notifyAlarmCleared(const char *reason) {
  // Reason = "web", "button", or "auto"
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String(emailServer) + "/mouse-trap";
  HTTPClient http;
  http.setTimeout(3000);
  if (!http.begin(url)) return;
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;  // same pattern you already use
  doc["event"]  = "cleared";
  doc["reason"] = reason;
  doc["mac"]    = WiFi.macAddress();
  doc["lan"]    = WiFi.localIP().toString();
  if (PUBLIC_IP.length()) doc["wan"] = PUBLIC_IP;

  String payload;
  serializeJson(doc, payload);
  int rc = http.POST(payload);
  http.end();

  addSystemLog(String("[notify] alarm cleared (") + reason + "), rc=" + String(rc));

  // Also publish via MQTT to notify server dashboard
  if (deviceClaimed && mqttClient.connected()) {
    char topic[256];
    snprintf(topic, sizeof(topic), "tenant/%s/device/%s/alert_cleared",
             claimedTenantId.c_str(), claimedMqttClientId.c_str());

    JsonDocument mqttDoc;
    mqttDoc["status"] = "cleared";
    mqttDoc["reason"] = reason;
    mqttDoc["timestamp"] = time(nullptr);

    String mqttPayload;
    serializeJson(mqttDoc, mqttPayload);

    mqttClient.publish(topic, mqttPayload.c_str());
    addSystemLog(String("[MQTT] Published alert_cleared (") + reason + ")");
  }
}


bool resetIndicatesFault(esp_reset_reason_t r) {
  // Everything except a normal boot, deep-sleep wake, or software reset
  return r == ESP_RST_BROWNOUT || r == ESP_RST_PANIC || r == ESP_RST_INT_WDT || r == ESP_RST_TASK_WDT;
}

// /* helper: human-readable reset reason */
// static const char *resetReasonToString(esp_reset_reason_t r) {
//   switch (r) {
//     case ESP_RST_POWERON: return "POWERON";
//     case ESP_RST_BROWNOUT: return "BROWNOUT";
//     case ESP_RST_INT_WDT: return "INT_WDT";
//     case ESP_RST_TASK_WDT: return "TASK_WDT";
//     case ESP_RST_SW: return "SW";
//     case ESP_RST_PANIC: return "PANIC";
//     case ESP_RST_EXT: return "EXT";
//     case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
//     default: return "OTHER";
//   }
// }

void syncFwStampOnBoot() {
  preferences.begin("settings", false);
  if (!preferences.isKey("fw_epoch")) {  // first ever run
    preferences.putUInt("fw_epoch",
                        (uint32_t)time(nullptr));
  }
  preferences.end();
}

void dumpFsPartition() {
  const esp_partition_t* p = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "littlefs");
  if (p) {
    addSystemLog(String("[FS] Partition label=") + (p->label?p->label:"(none)") +
                 " addr=0x" + String(p->address, HEX) +
                 " size=" + String(p->size));
  } else {
    addSystemLog("[FS] LittleFS partition not found via ESP-IDF");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);  // Match test sketch - give radio time to initialize

  // ========== EARLY WIFI SCAN ==========
  // Do this FIRST before anything else can interfere
  // Same approach as working test sketch
  Serial.println("\n[WIFI-SCAN] Early boot scan starting...");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  int scanCount = WiFi.scanNetworks();
  Serial.printf("[WIFI-SCAN] Found %d networks\n", scanCount);

  cachedNetworks.clear();
  for (int i = 0; i < scanCount && i < 20; i++) {
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    int channel = WiFi.channel(i);
    if (ssid.length() > 0) {
      bool found = false;
      for (auto& net : cachedNetworks) {
        if (net.ssid == ssid) {
          found = true;
          if (rssi > net.rssi) {
            net.rssi = rssi;
            net.channel = channel;  // Update channel if stronger signal
          }
          break;
        }
      }
      if (!found) {
        cachedNetworks.push_back({ssid, rssi, channel});
        Serial.printf("[WIFI-SCAN]   %s (%d dBm, ch %d)\n", ssid.c_str(), rssi, channel);
      }
    }
  }
  WiFi.scanDelete();
  std::sort(cachedNetworks.begin(), cachedNetworks.end(),
    [](const CachedNetwork& a, const CachedNetwork& b) { return a.rssi > b.rssi; });
  Serial.printf("[WIFI-SCAN] Cached %d unique networks\n", cachedNetworks.size());
  // ========== END EARLY WIFI SCAN ==========

  CrashKit::snapshotOnBoot();                                          // 1) capture prior run
  addSystemLog(String("[crash] ") + CrashKit::makeBootCrashReport());  // 2) log it
                                                                       // (do NOT call markPage("boot"))


  // CrashKit::markPage("boot");
  // CrashKit::markLine(__LINE__);
  esp_log_level_set("i2c", ESP_LOG_WARN);
  esp_log_level_set("i2c.master", ESP_LOG_WARN);
  esp_log_level_set("i2c.common", ESP_LOG_WARN);

  dumpFsPartition();

  TASK_YIELD_MS(100);

  // Initialize debug instrumentation
  debugFramebufferInit();
  debugI2CInit();
  debugTasksInit();
  debugCrashKitInit();
  debugContextInit();
  addSystemLog("[debug] All debug modules initialized");

  //CrashKit::onBootReport(addSystemLog);   // now this function exists

  // Figure out why we rebooted
  esp_reset_reason_t reason = esp_reset_reason();
  //addBootLog("[boot] Reset reason: " + String((int)reason) + " (" + resetReasonToString(reason) + ")");
  addBootLog("[boot] Reset reason: " + String((int)reason) + " (" + CrashKit::resetReasonToString(reason) + ")");

    // ---- EARLY: load the stored setting and immediately enforce it ----
  loadServoPrefEarly();               // READ from NVS -> sets disableServo
  applyServoDisableState("boot");     // detaches/tri-states if disabled




  if (reason == ESP_RST_PANIC || reason == ESP_RST_INT_WDT || reason == ESP_RST_TASK_WDT) {
    char buf[160];
    snprintf(buf, sizeof(buf),
             "[panic] cause=%u (%s)  PC=0x%08lX  ret=0x%08lX  addr=0x%08lX",
             lastCrashCause, causeStr(lastCrashCause),
             lastCrashPC, lastCrashRetPC, lastCrashAddr);
    addBootLog(buf);
  }

  BOOT_MILLIS = millis();

  // ===== SERVO DISABLE — one-time boot decision =====
  bool bootDisable = false;

  // (A) Keep your existing fault-guard checks, but write into bootDisable
  //     Example (replace this example with your actual conditions):
  // if (reason == ESP_RST_WDT || reason == ESP_RST_BROWNOUT || reason == ESP_RST_PANIC) {
  //   bootDisable = true;  // DO NOT touch disableServo here
  // }

  // (B) Restore preference, but let it be overridden by your guard
  Preferences p;
  if (p.begin("trap", /*readOnly=*/true)) {
    // If key missing, defaults to the current bootDisable (guard wins if already true)
    bootDisable = p.getBool("disableServo", bootDisable);
    p.end();
  }

  // (C) Apply once to both RAM + hardware
  setDisableServo(bootDisable, bootDisable ? "boot/guard+NVS" : "boot/NVS");

  // (optional, for visibility)
  //addSystemLog("[servo/init] disableServo=%d @%p", (int)disableServo, (void*)&disableServo);


  /* call once near the top of setup() */
  syncFwStampOnBoot();
  
  // loadServoPrefEarly();

  /* ───────────────── Servo crash-guard (must run before loadSettings) ───── */
  preferences.begin("settings", false);
  if (!preferences.isKey("disableServo") && preferences.isKey("srvDis")) {
    bool flag = preferences.getBool("srvDis", false);
    preferences.putBool("disableServo", flag);  // store under new key
    preferences.remove("srvDis");               // clean up old entry
  }

  // DEFAULT = true (disabled) if key missing
  if (!preferences.isKey("disableServo")) {
    preferences.putBool("disableServo", true);
  }

  //disableServo = preferences.getBool("disableServo", disableServo);
  //setDisableServo(prefs.getBool("disableServo", true), "NVS");

  preferences.end();

  // after you load 'disableServo' from Preferences:
  if (disableServo) {
    addSystemLog("Servo disabled at boot; forcing safe state");
    trapServo.detach();          // makes control pin Hi-Z and power-off if SERVO_PWR_EN
    pinMode(SERVO_PIN, INPUT);   // belt-and-suspenders; SafeServo also does this
  }

  // visibility in logs
  Serial.printf("disableServo=%d\n", (int)disableServo);
  addBootLog(String("disableServo=") + (disableServo ? "1" : "0"));

  preferences.begin("settings", false);
  bool pending = preferences.getBool("srvArmFl", false);
  // esp_reset_reason_t r = esp_reset_reason();  // ① new line
  // addBootLog("[boot] Reset reason: " + String((int)reason) + " (" +
  //          resetReasonToString(reason) + ")");

  // if (reason == ESP_RST_PANIC || reason == ESP_RST_INT_WDT ||
  //     reason == ESP_RST_TASK_WDT) {
  //   char line[96];
  //   snprintf(line,sizeof(line),
  //           "[panic] PC=0x%08lX  addr=0x%08lX  (decode with 'xtensa-esp32s3-elf-addr2line')",
  //           lastCrashPC, lastCrashAddr);
  //   addBootLog(line);
  // }

  /* fire only if crash-window open AND reset was not SW or power-on */
  if (pending && !(reason == ESP_RST_SW || reason == ESP_RST_POWERON)) {  // ② new test
    preferences.putBool("srvArmFl", false);
    preferences.putBool("disableServo", true);
    //disableServo = true;
    setDisableServo(true, "boot/…");
    addSystemLog("[servo] Auto-disabled after reset reason " + String((int)reason));
  }
  preferences.end();


  TASK_YIELD_MS(100);

  //addBootLog("" + msg);

  Serial.println("Serial output started!");  // Test message




  Serial.println("------------------------------------------------------");
  Serial.println("Startup sequence...");

  addBootLog("Startup sequence...");

  // Serial.println(F("Mounting LittleFS…"));
  // if (!LittleFS.begin(true, "/littlefs", 10, "littlefs")) {  // <- here
  //   Serial.println(F("❌ LittleFS mount failed!"));
  //   addBootLog(String("❌ LittleFS mount failed!"));
  // } else {
  //   fsOK = true;
  //     FSInfo64 info;
  //   size_t total = 0, used = 0;
  //   if (LittleFS.info64(info)) { total = (size_t)info.totalBytes; used = (size_t)info.usedBytes; }
  //   addBootLog(String("[FS] LittleFS mounted. total=") + total + " used=" + used);

  //   size_t total = LittleFS.totalBytes();
  //   size_t used = LittleFS.usedBytes();
  //   size_t free = total - used;

  //   addBootLog(String("📦 FS free: ") + String(free / 1024) + " KB / " + String(total / 1024) + " KB");

  //   Serial.printf("✅ LittleFS OK  (%u KB total, %u KB used)\n", total / 1024, used / 1024);
  //   addBootLog(String("✅ LittleFS OK  (") + String(total / 1024) + " KB total, " + String(used / 1024) + " KB used)");


  //   // remove stale flush lock if it’s there
  //   if (LittleFS.exists("/.flush.lock")) {
  //     Serial.println("⚠️ Stale .flush.lock found → removing");
  //     LittleFS.remove("/.flush.lock");
  //   }
  //   //flushInProgress = false;     // make sure flag is reset
  //   //currentJob      = nullptr;   // (optional safety)

  //   /* first boot: create /captures */
  //   if (!LittleFS.exists(CAPTURE_DIR)) {
  //     if (LittleFS.mkdir(CAPTURE_DIR)) {
  //       Serial.printf("Created capture directory %s\n", CAPTURE_DIR);
  //       addSystemLog(String("Created capture directory ") + CAPTURE_DIR);
  //     } else {
  //       Serial.printf("❌ Failed to create capture directory %s\n", CAPTURE_DIR);
  //       addSystemLog(String("❌ Failed to create capture directory ") + CAPTURE_DIR);
  //     }
  //   } else {
  //     addBootLog(String("✅ Capture directory already exists ") + String(CAPTURE_DIR));
  //   }
  // }
  Serial.println(F("Mounting LittleFS…"));

  if (!LittleFS.begin(/*formatOnFail=*/true, "/littlefs", 10, "littlefs")) {
    Serial.println(F("❌ LittleFS mount failed!"));
    addBootLog(F("❌ LittleFS mount failed!"));
  } else {
    // Core 3.x LittleFS: use totalBytes()/usedBytes(), not FSInfo64/info64()
    size_t total = LittleFS.totalBytes();
    size_t used  = LittleFS.usedBytes();
    size_t free  = (total > used) ? (total - used) : 0;

    addBootLog(String("[FS] LittleFS mounted. total=") + total + " used=" + used);
    addBootLog(String("📦 FS free: ") + String(free / 1024) + " KB / " + String(total / 1024) + " KB");

    Serial.printf("✅ LittleFS OK  (%u KB total, %u KB used)\n",
                  (unsigned)(total / 1024), (unsigned)(used / 1024));
    addBootLog(String("✅ LittleFS OK  (") + String(total / 1024) +
              " KB total, " + String(used / 1024) + " KB used)");

    // Remove stale flush lock if present
    if (LittleFS.exists("/.flusher.lock")) { // or "/.flush.lock" if that’s your file
      Serial.println(F("⚠️ Stale .flusher.lock found → removing"));
      LittleFS.remove("/.flusher.lock");
    }

    // Ensure /captures exists
    if (!LittleFS.exists(CAPTURE_DIR)) {
      if (LittleFS.mkdir(CAPTURE_DIR)) {
        Serial.printf("Created capture directory %s\n", CAPTURE_DIR);
        addSystemLog(String("Created capture directory ") + CAPTURE_DIR);
      } else {
        Serial.printf("❌ Failed to create capture directory %s\n", CAPTURE_DIR);
        addSystemLog(String("❌ Failed to create capture directory ") + CAPTURE_DIR);
      }
    } else {
      addBootLog(String("✅ Capture directory already exists ") + String(CAPTURE_DIR));
    }
  }



  rotateLogs();

  //checkPSRAM();

  // Initialize WiFi mode first (required before MAC address is available)
  WiFi.mode(WIFI_STA);

  // Get MAC address using esp_read_mac (more reliable than WiFi.macAddress() before connection)
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  g_macUpper = String(macStr);

  Serial.print("[SETUP] MAC address: ");
  Serial.println(g_macUpper);

  String lastMacOctet = g_macUpper.substring(g_macUpper.length() - 5);
  lastMacOctet.replace(":", "");

  // Load WiFi credentials from Preferences
  loadWiFiCredentials();

  // Check if we have saved WiFi credentials
  // If not, go directly to AP mode (captive portal) for setup
  if (savedSSID.length() == 0) {
    Serial.println("[WIFI] No saved WiFi credentials - entering AP mode for setup");
    addSystemLog("[WIFI] No saved credentials - entering AP mode");

    // Use AP_STA mode to allow WiFi scanning while in AP mode
    WiFi.mode(WIFI_AP_STA);  // AP+STA mode for scanning capability
    delay(100);  // Let WiFi mode settle

    String apName = "MouseTrap-" + lastMacOctet;

    // Configure AP IP explicitly before starting
    IPAddress apIP(192, 168, 4, 1);
    IPAddress gateway(192, 168, 4, 1);
    IPAddress subnet(255, 255, 255, 0);
    WiFi.softAPConfig(apIP, gateway, subnet);

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
    Serial.println("[AP MODE] Connect to this network and navigate to http://192.168.4.1/setup");

    addSystemLog("[AP MODE] Started AP: " + apName + " @ " + apIP.toString());
    addSystemLog("[AP MODE] Visit http://192.168.4.1/setup to configure");

    isAPMode = true;

    // Start DNS server for captive portal (skip in standalone mode)
    if (!standaloneMode) {
      dnsServer.start(DNS_PORT, "*", apIP);
      Serial.println("[AP MODE] DNS server started for captive portal");
    } else {
      Serial.println("[AP MODE] Standalone mode - DNS server skipped, browse to http://192.168.4.1");
    }

    // Start initial WiFi scan for network list (works in AP_STA mode)
    // IMPORTANT: Need delay for WiFi hardware to stabilize before scanning
    Serial.println("[WIFI-SCAN] Waiting 2s for WiFi hardware to stabilize...");
    delay(2000);
    Serial.println("[WIFI-SCAN] Starting initial scan in AP_STA mode...");
    startWiFiScan();

  } else {
    // We have saved credentials - try to connect
    const char* wifiSSID = savedSSID.c_str();
    const char* wifiPassword = savedPassword.c_str();
  Serial.println("[WIFI] Using saved WiFi credentials");

  // Connect to WiFi
  Serial.println("[DEBUG] About to connect to WiFi...");
  Serial.flush();
  Serial.print("Connecting to ");
  Serial.println(wifiSSID);

  // WiFi.mode already set above when getting MAC address
  Serial.println("[DEBUG] Calling WiFi.begin()...");
  Serial.flush();
  WiFi.begin(wifiSSID, wifiPassword);
  Serial.println("[DEBUG] WiFi.begin() returned");
  Serial.flush();
  int connectionAttempts = 0;
  const int MAX_ATTEMPTS = 3;
  while (connectionAttempts < MAX_ATTEMPTS && WiFi.status() != WL_CONNECTED) {
    int waitTime = 0;
    while (waitTime < 60 && WiFi.status() != WL_CONNECTED) {
      TASK_YIELD_MS(1000);
      Serial.print(".");
      waitTime++;
    }
    if (WiFi.status() != WL_CONNECTED) {
      connectionAttempts++;
      Serial.print("Connection attempt ");
      Serial.print(connectionAttempts);
      Serial.println(" failed, retrying...");
      addSystemLog("WiFi connection failed, retrying...");
      WiFi.begin(wifiSSID, wifiPassword);
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected in Station mode");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    addBootLog(String("WiFi connected with IP: ") + WiFi.localIP().toString());
    isAPMode = false;

    // mDNS will be started after loading claimed credentials
  } else {
    // WiFi connection failed - start Access Point mode (AP_STA allows scanning)
    Serial.println("\n[AP MODE] WiFi connection failed - starting Access Point");
    addSystemLog("[AP MODE] WiFi connection failed - starting Access Point");

    WiFi.mode(WIFI_AP_STA);
    String apName = "MouseTrap-" + lastMacOctet;

    // Start AP on the strongest network's channel (from boot scan)
    // This prevents channel-change disconnects during setup
    int apChannel = 1;  // Default channel
    if (!cachedNetworks.empty()) {
      apChannel = cachedNetworks[0].channel;
      Serial.printf("[AP MODE] Using channel %d (strongest network: %s)\n",
                    apChannel, cachedNetworks[0].ssid.c_str());
      addSystemLog("[AP MODE] Starting on ch " + String(apChannel) + " (" + cachedNetworks[0].ssid + ")");
    }
    WiFi.softAP(apName.c_str(), "", apChannel);

    IPAddress apIP = WiFi.softAPIP();
    Serial.print("[AP MODE] Access Point started: ");
    Serial.println(apName);
    Serial.print("[AP MODE] IP address: ");
    Serial.println(apIP);
    Serial.printf("[AP MODE] Channel: %d\n", apChannel);
    Serial.println("[AP MODE] Connect to this network and navigate to http://192.168.4.1/setup");

    addSystemLog("[AP MODE] Started AP: " + apName + " @ " + apIP.toString() + " ch " + String(apChannel));
    addSystemLog("[AP MODE] Visit http://192.168.4.1/setup to configure");

    isAPMode = true;

    // Start DNS server for captive portal (skip in standalone mode)
    if (!standaloneMode) {
      dnsServer.start(DNS_PORT, "*", apIP);
      Serial.println("[AP MODE] DNS server started for captive portal");
    } else {
      Serial.println("[AP MODE] Standalone mode - DNS server skipped, browse to http://192.168.4.1");
    }

    // Start initial WiFi scan for network list
    startWiFiScan();
    }
  }  // End of else block for "has saved credentials"

  // Continue with rest of setup regardless of WiFi mode

  // WebSocket tunnel removed - using MQTT instead
  // ws_tunnel_setup();  // REMOVED

  // MAC address already initialized above (needed for AP name)
  // g_macUpper was set before WiFi connection

  // Load persisted firmware/filesystem versions
  loadVersions();

  // Load device claim credentials from Preferences
  loadClaimedCredentials();

  // Start mDNS service (now that device name is loaded)
  if (!isAPMode) {
    startMdnsService();
  }

  // Verify claim status with server if device thinks it's claimed
  if (deviceClaimed) {
    Serial.println("[STARTUP-CLAIM] ========================================");
    Serial.println("[STARTUP-CLAIM] DEVICE STARTUP CLAIM VERIFICATION");
    Serial.println("[STARTUP-CLAIM] ========================================");
    Serial.printf("[STARTUP-CLAIM] Device believes it is claimed:\n");
    Serial.printf("[STARTUP-CLAIM]   - Device ID: %s\n", claimedDeviceId.c_str());
    Serial.printf("[STARTUP-CLAIM]   - Device Name: %s\n", claimedDeviceName.c_str());
    Serial.printf("[STARTUP-CLAIM]   - Tenant ID: %s\n", claimedTenantId.c_str());
    Serial.printf("[STARTUP-CLAIM]   - MQTT Client ID: %s\n", claimedMqttClientId.c_str());
    Serial.printf("[STARTUP-CLAIM]   - MQTT Username: %s\n", claimedMqttUsername.c_str());
    Serial.println("[STARTUP-CLAIM] Verifying claim status with server...");

    // Wait for network to stabilize after boot
    Serial.println("[STARTUP-CLAIM] Waiting 5 seconds for network to stabilize...");
    delay(5000);

    ClaimVerificationResult result = checkClaimStatusWithServer();

    if (result == EXPLICITLY_REVOKED) {
      Serial.println("[STARTUP-CLAIM] ========================================");
      Serial.println("[STARTUP-CLAIM] EXPLICIT REVOCATION DETECTED");
      Serial.println("[STARTUP-CLAIM] ========================================");
      Serial.println("[STARTUP-CLAIM] Server explicitly revoked device during startup verification");
      Serial.println("[STARTUP-CLAIM] Action: Unclaiming device and clearing credentials");
      Serial.println("[STARTUP-CLAIM] ========================================");
      addSystemLog("[STARTUP-CLAIM] Device revoked by server during startup verification");
      unclaimDevice();
    } else if (result == CLAIM_VERIFIED) {
      Serial.println("[STARTUP-CLAIM] ========================================");
      Serial.println("[STARTUP-CLAIM] SUCCESS - Claim status verified successfully");
      Serial.println("[STARTUP-CLAIM] ========================================");
      addSystemLog("[STARTUP-CLAIM] Claim verified with server at startup");
    } else {
      // NETWORK_ERROR or SERVER_ERROR - stay claimed
      Serial.println("[STARTUP-CLAIM] ========================================");
      Serial.printf("[STARTUP-CLAIM] Could not verify claim status (result: %d)\n", result);
      Serial.println("[STARTUP-CLAIM] This is likely a network or server issue");
      Serial.println("[STARTUP-CLAIM] Device will STAY CLAIMED and keep trying to connect");
      Serial.println("[STARTUP-CLAIM] ========================================");
      Serial.println("[STARTUP-CLAIM] Rationale:");
      Serial.println("[STARTUP-CLAIM]   - Network issues should not trigger unclaim");
      Serial.println("[STARTUP-CLAIM]   - Server errors should not trigger unclaim");
      Serial.println("[STARTUP-CLAIM]   - Only explicit revocation should unclaim device");
      Serial.println("[STARTUP-CLAIM]   - Device will retry connection attempts");
      Serial.println("[STARTUP-CLAIM] ========================================");
      addSystemLog("[STARTUP-CLAIM] Could not verify claim status - network issue, STAYING CLAIMED");
    }
  } else {
    Serial.println("[STARTUP-CLAIM] Device is unclaimed - skipping server verification");
  }

  // Initialize MQTT (only if still claimed after verification)
  mqttSetup();

  loadSettings();

  applyTimeZone();

  syncNTP();

  initLocksOnce();

  //static String PUBLIC_IP;
  PUBLIC_IP = getPublicIP();  // cache once; refresh later if you want


  /* ---- after you have loaded overrideThreshold from NVS --------------- */
  reCalTimer = xTimerCreate("reCal",
                            pdMS_TO_TICKS(RECAL_PERIOD_MS),  // 1 h
                            pdTRUE, nullptr, reCalTimerCb);

  if (overrideThreshold == 0) {
    xTimerStart(reCalTimer, 0);
    addBootLog("Auto-recal timer started (1 h)");
  } else {
    addBootLog("🔒 Threshold override (" + String(overrideThreshold) + " mm) – auto-recal disabled");
  }
  /* ---- --------------- --------------- --------------- --------------- */



  flushBootLog();

  sendHeartbeat();

  lastEmailTime = time(nullptr) - 3600;

  notifyBootIP();

  //dumpCaptures();

  // Initialize hardware pins
  Serial.println("Configuring pins...");
  pinMode(HIGH_POWER_LED_PIN, OUTPUT);
  digitalWrite(HIGH_POWER_LED_PIN, LOW);  // Make sure the big LED is off at startup
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Safe to call on all units; runtime-gated by disableServo.
  initServo();


  Serial.println("Attaching button interrupt on GPIO " + String(BUTTON_PIN));
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), buttonISR, FALLING);

  initCamera();
  TASK_YIELD_MS(5000);

  g_i2cMutex = xSemaphoreCreateMutex();
  I2CSensors.begin(I2C_SDA, I2C_SCL, 100000);
  I2CSensors.setTimeOut(50);  // avoid long I2C stalls (ms), harmless if not used

  initSensor();

  //overrideThreshold = preferences.getInt("overrideTh", 0);
  if (overrideThreshold > 0) {
    //threshold = overrideThreshold;
    addSystemLog(String("overrideThreshold = ") + overrideThreshold);
    addSystemLog(String("Skipping sensor calibration.  Override threshold > 0: ") + threshold);
  } else {
    // fall back to a fresh calibration run
    addSystemLog(String("overrideThreshold = ") + overrideThreshold);
    addSystemLog("Running calibrateThreshold() from setup().");
    calibrateThreshold();  // your existing function sets `threshold`
    //xTaskCreatePinnedToCore(recalibTask, "ReCal", 4096, nullptr, 1, nullptr, 1);
  }

  //setupServo();

  // ── Auto-disable servo if we brown-outed within 10 s of arming it
  if (resetIndicatesFault(reason)) {
    uint32_t now = (uint32_t)(esp_timer_get_time() / 1000000ULL);
    uint32_t last = preferences.getUInt("srvArm", 0);  // timestamp we saved at arm-time
    if (last && (now - last) < 10) {                   // brown-out happened right after servo ON
      //disableServo = true;
      setDisableServo(true, "boot/…");
      preferences.putBool("disableServo", true);  // remember across boots
      addSystemLog("[servo] Auto-disabled after brown-out");
    }
  } else {
    //disableServo = preferences.getBool("disableServo", false);  // restore flag on normal boots
    //INTERESTING
  }

  pinMode(SERVO_ENABLE_PIN, OUTPUT);
  digitalWrite(SERVO_ENABLE_PIN, LOW);  // keep servo powered off by default
  //if (!disableServo && SERVO_PIN >= 0 && SERVO_PIN < 49) {
  //servoArmEpoch = (uint32_t)(esp_timer_get_time() / 1'000'000ULL);
  //servoArming = true;                        // ── set the crash flag

  /* >>> crash-window OPENS before rail power <<< */
  // preferences.begin("settings", false);
  // preferences.putBool("srvArmFl", true);
  // preferences.end();
  // addSystemLog("[debug] srvArmFl set → true");

  // pinMode(SERVO_ENABLE_PIN, OUTPUT);
  // digitalWrite(SERVO_ENABLE_PIN, LOW);  // keep servo powered off by default


  //   int ch = trapServo.attach(SERVO_PIN, 500, 2500);

  //   if (ch >= 0) {
  //     //Serial.printf("Servo attached on LEDC channel ", String(ch));
  //     addSystemLog("Servo attached on LEDC channel: " + String(ch));
  //     //addSystemLog("Servo attached on LEDC channel:");
  //     //addSystemLog(String(ch));
  //     //addSystemLog(msg);
  //   } else {
  //     //Serial.println("⚠️ Servo attach failed");
  //     addSystemLog(String("⚠️ Servo attach failed"));
  //   }
  // } else {
  //   //Serial.println(F("[servo] Skipped — disabledServo flag set"));
  //   //addSystemLog("[servo] Skipped — disabledServo flag set");
  //   Serial.println("Servo not enabled.  Interesting values: disableServo = " + String(disableServo) + ", SERVO_PIN = " + SERVO_PIN);
  //   addSystemLog("Servo not enabled.  Interesting values: disableServo = " + String(disableServo) + ", SERVO_PIN = " + SERVO_PIN);
  // }
  //pinMode(SERVO_ENABLE_PIN, OUTPUT);
  //digitalWrite(SERVO_ENABLE_PIN, LOW);  // keep servo powered off by default
  //trapServo.attach(SERVO_PIN);          // set up your servo PWM
  // int ch = trapServo.attach(SERVO_PIN, 500, 2500);

  // if (ch >= 0) {
  //   //Serial.printf("Servo attached on LEDC channel ", String(ch));
  //   addSystemLog("Servo attached on LEDC channel: " + String(ch));
  //   //addSystemLog("Servo attached on LEDC channel:");
  //   //addSystemLog(String(ch));
  //   //addSystemLog(msg);
  // } else {
  //   //Serial.println("⚠️ Servo attach failed");
  //   addSystemLog(String("⚠️ Servo attach failed"));
  //}

  digitalWrite(LED_PIN, LOW);

  if (sensorFound) {
    xTaskCreatePinnedToCore(sensorTaskFunction, "SensorTask", 8192, NULL, 1, NULL, 0);
  } else {
    Serial.println("Sensor task not created because sensor not found.");
  }

  setupEndpoints();
  preferences.begin("settings", /* read-write = */ false);  // open "sys" namespace
  bool crashedWhileArming = servoArming || preferences.getBool("srvArmFl", false);
  loadServoSettings();
  delay(1000);
  ElegantOTA.begin(&server);

  // Add CORS headers for captive portal (iOS uses captive.apple.com domain)
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");

  server.begin();
  Serial.println("Async Web Server started.");
  // right after "Async Web Server started." (end of setup)
  CrashKit::markPage("idle");
  CrashKit::markLine(__LINE__);
  addSystemLog("Async Web Server started.");

  /* create a 60-minute auto-reload timer */
  // reCalTimer = xTimerCreate("reCalTimer",
  //                           pdMS_TO_TICKS(60 * 60 * 1000),  // 60 min
  //                           pdTRUE,                         // auto-reload
  //                           nullptr, reCalTimerCb);
  //xTimerStart(reCalTimer, 0);


  ElegantOTA.onEnd([](bool ok) {
    if (!ok) return;  // ignore failed uploads

    preferences.begin("settings", false);  // ① OPEN
    preferences.putUInt("fw_epoch",
                        (uint32_t)time(nullptr));
    preferences.end();  // ② CLOSE  (flushes to NVS)

    addSystemLog("🔄 Firmware updated at " + String(formatTime(time(nullptr))));
  });

  // Startup indication: flash LED and buzzer.
  digitalWrite(LED_PIN, LOW);
  tone(BUZZER_PIN, 300);
  digitalWrite(LED_PIN, HIGH);
  TASK_YIELD_MS(200);
  digitalWrite(LED_PIN, LOW);
  noTone(BUZZER_PIN);
  TASK_YIELD_MS(100);
  for (int i = 0; i < 2; i++) {
    tone(BUZZER_PIN, 300);
    digitalWrite(LED_PIN, HIGH);
    TASK_YIELD_MS(100);
    digitalWrite(LED_PIN, LOW);
    noTone(BUZZER_PIN);
    TASK_YIELD_MS(100);
  }
  TASK_YIELD_MS(1000);

  // add in setup() (any time after Wi-Fi is up)
  xTaskCreatePinnedToCore(heartbeatTask, "hb", 4096, nullptr, 2, nullptr, 0);

    // ---- LATE: re-apply in case any init code tried to attach the servo ----
  applyServoDisableState("end-setup");


  Serial.println("Startup sequence completed.");
  addSystemLog("Startup sequence complete.");

  if (!CrashKit::pageActive()) {
    CrashKit::markPage("idle");
    CrashKit::markLine(__LINE__);
  }
}


void dumpCaptures() {
  Serial.println("\n=== Files in /captures ===");
  File dir = LittleFS.open(CAPTURE_DIR, "r");
  if (!dir) {
    Serial.println("Cannot open dir");
    addSystemLog("Cannot open captures directory!");
    return;
  }

  File f = dir.openNextFile();
  while (f) {
    Serial.println(f.name());  // will show /captures/img_YYYYMMDD_HHMMSS.jpg
    f = dir.openNextFile();
  }
  Serial.println("=========================\n");
}


//------------------------------------------------------------------
//  Capture a photo, save to LittleFS, queue it for e‑mail
//------------------------------------------------------------------
bool captureAndStorePhoto() {
  /* ---------- basic guards ---------- */
  if (!cameraInitialized) return false;

  if (!fsOK) {
    addSystemLog("LittleFS not available – skip photo save");
    return false;
  }

  /* ---------- 1) Illuminate scene ---------- */
  setHighPowerLED(true);  // turn on 1 W LED
  TASK_YIELD_MS(60);      // ≈60–80 ms – tweak if needed

  /* ---------- 2) Capture ---------- */
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb) debugFramebufferAllocated(fb);
  setHighPowerLED(false);  // always turn it off again
  if (!fb) {
    addSystemLog("⚠️  captureAndStorePhoto: fb == NULL");
    return false;
  }

  /* ---------- 3) Build file‑name & write ---------- */
  time_t now = time(nullptr);
  struct tm tmInfo;
  char ts[20];  // "20250419_151337"
  localtime_r(&now, &tmInfo);
  strftime(ts, sizeof(ts), "%Y%m%d_%H%M%S", &tmInfo);

  String fileName = String(CAPTURE_DIR) + "/img_" + ts + ".jpg";

  File f = LittleFS.open(fileName, FILE_WRITE);
  if (!f) {
    addSystemLog("⚠️  captureAndStorePhoto: failed to open " + fileName);
    debugFramebufferReleased(fb);
    esp_camera_fb_return(fb);
    return false;
  }
  f.write(fb->buf, fb->len);
  f.close();
  debugFramebufferReleased(fb);
  esp_camera_fb_return(fb);

  lastImagePath = fileName;
  photoQueued = true;

  addSystemLog("📸 Saved picture " + fileName + " (" + String(fb->len) + " bytes)");

  /* ---------- 4) House‑keep: keep at most MAX_SAVED_IMAGES ---------- */
  File root = LittleFS.open(CAPTURE_DIR);
  if (!root) {
    addSystemLog("⚠️  Could not open " + String(CAPTURE_DIR) + " for clean‑up");
    return true;  // picture is safe; just continue
  }

  /* collect all jpg names so we can sort chronologically (name already
     encodes the timestamp) */
  std::vector<String> jpgNames;
  File file = root.openNextFile();
  while (file) {
    String n = String(file.name());
    if (!file.isDirectory() && n.endsWith(".jpg"))
      jpgNames.push_back(n);
    file = root.openNextFile();
  }
  root.close();

  if (jpgNames.size() > MAX_SAVED_IMAGES) {
    std::sort(jpgNames.begin(), jpgNames.end());  // oldest → newest
    size_t toDelete = jpgNames.size() - MAX_SAVED_IMAGES;
    for (size_t i = 0; i < toDelete; ++i) {
      LittleFS.remove(jpgNames[i]);
      addSystemLog("🗑️  Deleted old photo " + jpgNames[i]);
    }
  }

  return true;
}

// ============================================================================
// Setup Result Functions - Save/Load/Clear setup attempt results
// ============================================================================
void saveSetupResult(bool success, const String& errorCode, const String& errorMessage) {
  Preferences prefs;
  prefs.begin("setup", false);
  prefs.putBool("attempted", true);
  prefs.putBool("success", success);
  prefs.putString("errorCode", errorCode);
  prefs.putString("errorMsg", errorMessage);
  prefs.end();
  addSystemLog("[SETUP] Saved result: success=" + String(success ? "true" : "false") + ", error=" + errorCode);
}

SetupResult loadSetupResult() {
  SetupResult result = {false, false, "", ""};
  Preferences prefs;
  prefs.begin("setup", true);  // Read-only
  result.attempted = prefs.getBool("attempted", false);
  result.success = prefs.getBool("success", false);
  result.errorCode = prefs.getString("errorCode", "");
  result.errorMessage = prefs.getString("errorMsg", "");
  prefs.end();
  return result;
}

void clearSetupResult() {
  Preferences prefs;
  prefs.begin("setup", false);
  prefs.clear();
  prefs.end();
}

// ============================================================================
// Try to recover claim from server (device may have lost NVS but server has record)
// Returns true if claim was recovered and credentials saved to NVS
// ============================================================================
bool tryRecoverClaim() {
  // Sync NTP time first (needed for claim token)
  addSystemLog("[RECOVER] Syncing NTP time for claim token...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  const time_t MIN_VALID_TIME = 1577836800;  // Jan 1, 2020
  int ntpAttempts = 0;
  while (time(nullptr) < MIN_VALID_TIME && ntpAttempts < 10) {
    delay(500);
    ntpAttempts++;
  }

  if (time(nullptr) < MIN_VALID_TIME) {
    addSystemLog("[RECOVER] NTP sync failed - cannot generate claim token");
    return false;
  }

  // Generate claim token
  time_t now = time(nullptr);
  String timestamp = String(now);
  String mac = g_macUpper;  // XX:XX:XX:XX:XX:XX format

  // HMAC-SHA256(MAC:timestamp, secret)
  String data = mac + ":" + timestamp;
  uint8_t hash[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)DEVICE_CLAIM_SECRET, strlen(DEVICE_CLAIM_SECRET));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)data.c_str(), data.length());
  mbedtls_md_hmac_finish(&ctx, hash);
  mbedtls_md_free(&ctx);

  String claimToken = "";
  for (int i = 0; i < 32; i++) {
    char hex[3];
    sprintf(hex, "%02x", hash[i]);
    claimToken += hex;
  }

  // Call server recover-claim endpoint
  String serverUrl = String(CLAIM_SERVER_URL) + "/api/setup/recover-claim";
  addSystemLog("[RECOVER] Calling server: " + serverUrl);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  JsonDocument reqDoc;
  reqDoc["mac"] = mac;
  reqDoc["claimToken"] = claimToken;
  reqDoc["timestamp"] = timestamp;

  String reqBody;
  serializeJson(reqDoc, reqBody);

  int httpCode = http.POST(reqBody);
  addSystemLog("[RECOVER] HTTP response code: " + String(httpCode));

  if (httpCode != 200) {
    // Device not claimed or error - need full registration
    String response = http.getString();
    addSystemLog("[RECOVER] Not claimed or error: " + response);
    http.end();
    return false;
  }

  // Parse response
  String response = http.getString();
  http.end();

  JsonDocument respDoc;
  DeserializationError err = deserializeJson(respDoc, response);
  if (err) {
    addSystemLog("[RECOVER] JSON parse error: " + String(err.c_str()));
    return false;
  }

  if (!respDoc["success"].as<bool>() || !respDoc["recovered"].as<bool>()) {
    addSystemLog("[RECOVER] Server returned success=false");
    return false;
  }

  // Extract credentials
  String deviceId = respDoc["deviceId"].as<String>();
  String tenantId = respDoc["tenantId"].as<String>();
  String mqttClientId = respDoc["mqttClientId"].as<String>();
  String mqttBroker = respDoc["mqttBroker"].as<String>();
  String mqttUsername = respDoc["mqttCredentials"]["username"].as<String>();
  String mqttPassword = respDoc["mqttCredentials"]["password"].as<String>();
  String deviceName = respDoc["deviceName"].as<String>();

  addSystemLog("[RECOVER] Claim recovered! Device: " + deviceName);
  addSystemLog("[RECOVER] Tenant: " + tenantId);

  // Save credentials to NVS (same format as processPendingRegistration)
  currentSetupStep = "Saving recovered credentials...";
  currentSetupState = SETUP_SAVING;

  // Save device/claim credentials
  Preferences prefs;
  prefs.begin("device", false);
  prefs.putBool("claimed", true);
  prefs.putString("deviceId", deviceId);
  prefs.putString("tenantId", tenantId);
  prefs.putString("mqttClientId", mqttClientId);
  prefs.putString("mqttBroker", mqttBroker);
  prefs.putString("mqttUsername", mqttUsername);
  prefs.putString("mqttPassword", mqttPassword);
  prefs.putString("deviceName", deviceName);
  prefs.end();

  // Save WiFi credentials
  prefs.begin("wifi", false);
  prefs.putString("ssid", pendingSetupSSID);
  prefs.putString("password", pendingSetupPassword);
  prefs.end();

  addSystemLog("[RECOVER] Credentials saved to NVS");

  // Update global state
  deviceClaimed = true;
  claimedDeviceId = deviceId;
  claimedTenantId = tenantId;
  claimedMqttClientId = mqttClientId;
  claimedMqttBroker = mqttBroker;
  claimedMqttUsername = mqttUsername;
  claimedMqttPassword = mqttPassword;
  claimedDeviceName = deviceName;

  // Set recovered state for SPA
  recoveredDeviceName = deviceName;
  currentSetupState = SETUP_CLAIM_RECOVERED;
  currentSetupStep = "Connection restored! Device \"" + deviceName + "\" is ready.";
  setupNeedsReboot = true;

  addSystemLog("[RECOVER] ====== CLAIM RECOVERED SUCCESSFULLY ======");

  // Connect to MQTT now that we have credentials
  mqttSetup();
  mqttConnect();

  // Turn off AP mode - device is now claimed and connected
  addSystemLog("[RECOVER] Disabling AP mode - device is claimed");
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  isAPMode = false;

  addSystemLog("[RECOVER] Device is now in station mode, connected to WiFi and MQTT");
  return true;
}

// ============================================================================
// Process Pending WiFi Test (Phase 1 of two-phase setup)
// Connect to WiFi in AP+STA mode, stay connected for registration
// ============================================================================
void processPendingWiFiTest() {
  if (!pendingWiFiTest) return;

  // Wait a bit for HTTP response to be fully sent
  if (millis() - pendingWiFiTestTime < 500) return;

  pendingWiFiTest = false;  // Clear flag first to prevent re-entry

  // Reset state
  currentSetupState = SETUP_CONNECTING_WIFI;
  currentSetupStep = "Connecting to WiFi...";
  currentSetupError = "";
  currentSetupErrorCode = "";

  addSystemLog("[WIFI-TEST] ====== STARTING WIFI TEST ======");
  addSystemLog("[WIFI-TEST] SSID: " + pendingWiFiTestSSID);

  // ===== STEP 0: Disconnect any previous WiFi connection =====
  addSystemLog("[WIFI-TEST] Disconnecting any previous connection...");
  WiFi.disconnect(true);  // true = also clear stored credentials
  delay(100);

  // AP is already on the correct channel (started on strongest network's channel at boot)
  // No need to scan or change channels - this keeps the phone connected!
  currentSetupStep = "Connecting to WiFi...";
  addSystemLog("[WIFI-TEST] AP channel: " + String(WiFi.channel()) + " (set at boot from strongest network)");

  // Ensure we're in AP+STA mode (should already be, but be safe)
  if (WiFi.getMode() != WIFI_AP_STA) {
    WiFi.mode(WIFI_AP_STA);
    delay(100);
  }

  // ===== STEP 1: Connect to WiFi (STA) =====
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

  // Store the working credentials for registration phase
  pendingSetupSSID = pendingWiFiTestSSID;
  pendingSetupPassword = pendingWiFiTestPassword;

  addSystemLog("[WIFI-TEST] ====== WIFI TEST SUCCESSFUL ======");

  // ===== STEP 4: Check if device is already claimed on server =====
  // If so, recover credentials and skip account setup
  currentSetupState = SETUP_CHECKING_CLAIM;
  currentSetupStep = "Checking device status...";
  addSystemLog("[WIFI-TEST] Checking if device is already claimed...");

  if (tryRecoverClaim()) {
    // Claim was recovered - device is already set up!
    addSystemLog("[WIFI-TEST] Claim recovered - skipping account setup");
    return;
  }

  // Device is not claimed - proceed to account setup
  currentSetupState = SETUP_WIFI_CONNECTED;
  currentSetupStep = "WiFi connected! Ready for account setup.";
  addSystemLog("[WIFI-TEST] Device not claimed - needs account setup");
}

// ============================================================================
// Process Pending Registration (Phase 2 of two-phase setup)
// Complete registration after WiFi is confirmed working
// ============================================================================
void processPendingRegistration() {
  if (!pendingRegistration) return;

  // Wait a bit for HTTP response to be fully sent
  if (millis() - pendingRegistrationTime < 500) return;

  pendingRegistration = false;  // Clear flag first to prevent re-entry

  addSystemLog("[REGISTER] ====== STARTING REGISTRATION ======");
  addSystemLog("[REGISTER] Email: " + pendingSetupEmail);
  addSystemLog("[REGISTER] Device: " + pendingSetupDeviceName);

  // WiFi should already be connected from test-wifi phase
  if (WiFi.status() != WL_CONNECTED) {
    addSystemLog("[REGISTER] ERROR: WiFi not connected!");
    currentSetupState = SETUP_FAILED;
    currentSetupError = "WiFi disconnected. Please test WiFi connection again.";
    currentSetupErrorCode = "wifi_disconnected";
    currentSetupStep = "WiFi not connected";
    return;
  }

  // ===== STEP 1: Sync NTP time =====
  currentSetupState = SETUP_SYNCING_TIME;
  currentSetupStep = "Syncing time...";
  addSystemLog("[REGISTER] Syncing NTP time...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  const time_t MIN_VALID_TIME = 1577836800;  // Jan 1, 2020
  int ntpAttempts = 0;
  time_t now = time(nullptr);
  while (now < MIN_VALID_TIME && ntpAttempts < 20) {
    delay(500);
    now = time(nullptr);
    ntpAttempts++;
    if (ntpAttempts % 4 == 0) {
      currentSetupStep = "Syncing time... (" + String(ntpAttempts * 500 / 1000) + "s)";
    }
  }

  if (now < MIN_VALID_TIME) {
    addSystemLog("[REGISTER] NTP sync timeout, epoch=" + String((unsigned long)now));
    currentSetupState = SETUP_FAILED;
    currentSetupError = "Could not sync time with internet. Check your network connection.";
    currentSetupErrorCode = "ntp_failed";
    currentSetupStep = "Time sync failed";
    return;
  }

  addSystemLog("[REGISTER] Time synced, epoch: " + String((unsigned long)now));

  // ===== STEP 2: Generate claim token =====
  currentSetupState = SETUP_REGISTERING;
  currentSetupStep = "Registering device...";
  addSystemLog("[REGISTER] Generating claim credentials...");
  ClaimCredentials creds = generateClaimCredentials();
  addSystemLog("[REGISTER] MAC=" + String(creds.mac) + ", timestamp=" + String(creds.timestamp));

  // ===== STEP 3: Call server =====
  String url = String(CLAIM_SERVER_URL) + "/api/setup/register-and-claim";
  addSystemLog("[REGISTER] Calling server: " + url);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  JsonDocument reqDoc;
  reqDoc["email"] = pendingSetupEmail;
  reqDoc["password"] = pendingSetupAccountPassword;
  reqDoc["deviceName"] = pendingSetupDeviceName;
  reqDoc["mac"] = creds.mac;
  reqDoc["claimToken"] = creds.token;
  reqDoc["timestamp"] = creds.timestamp;
  reqDoc["isNewAccount"] = pendingSetupIsNewAccount;

  String reqBody;
  serializeJson(reqDoc, reqBody);

  int httpCode = http.POST(reqBody);
  addSystemLog("[REGISTER] HTTP response code: " + String(httpCode));

  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();
    addSystemLog("[REGISTER] Got success response");

    JsonDocument resDoc;
    DeserializationError err = deserializeJson(resDoc, response);

    if (err) {
      addSystemLog("[REGISTER] ERROR: Could not parse server response");
      currentSetupState = SETUP_FAILED;
      currentSetupError = "Invalid response from server.";
      currentSetupErrorCode = "invalid_response";
      currentSetupStep = "Registration failed";
      http.end();
      return;
    }

    // ===== STEP 4: Save credentials =====
    currentSetupState = SETUP_SAVING;
    currentSetupStep = "Saving configuration...";

    String tenantId = resDoc["tenantId"] | "";
    String deviceId = resDoc["deviceId"] | "";
    String mqttPassword = resDoc["mqttPassword"] | "";
    String deviceName = resDoc["deviceName"] | pendingSetupDeviceName;
    String brokerHost = resDoc["brokerHost"] | MQTT_BROKER;
    int brokerPort = resDoc["brokerPort"] | MQTT_PORT;

    addSystemLog("[REGISTER] Saving claim data: tenant=" + tenantId + ", device=" + deviceId);

    Preferences prefs;
    prefs.begin("claim", false);
    prefs.putBool("claimed", true);
    prefs.putString("tenantId", tenantId);
    prefs.putString("deviceId", deviceId);
    prefs.putString("deviceName", deviceName);
    prefs.putString("mqttUser", creds.mac);
    prefs.putString("mqttPass", mqttPassword);
    prefs.putString("mqttBroker", brokerHost);
    prefs.putInt("mqttPort", brokerPort);
    prefs.end();

    // Save WiFi credentials
    prefs.begin("wifi", false);
    prefs.putString("ssid", pendingSetupSSID);
    prefs.putString("pass", pendingSetupPassword);
    prefs.end();

    addSystemLog("[REGISTER] Configuration saved successfully");

    // Mark setup complete
    currentSetupState = SETUP_COMPLETE;
    currentSetupStep = "Setup complete!";

    addSystemLog("[REGISTER] ====== REGISTRATION SUCCESSFUL ======");
    saveSetupResult(true, "", "");

    // Update global state and connect to MQTT
    deviceClaimed = true;
    claimedTenantId = tenantId;
    claimedDeviceId = deviceId;
    claimedMqttClientId = creds.mac;
    claimedMqttBroker = brokerHost;
    claimedMqttUsername = creds.mac;
    claimedMqttPassword = mqttPassword;

    // Connect to MQTT now that we have credentials
    mqttSetup();
    mqttConnect();

    // Turn off AP mode - device is now claimed and connected
    addSystemLog("[REGISTER] Disabling AP mode - device is claimed");
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
    isAPMode = false;

    addSystemLog("[REGISTER] Device is now in station mode, connected to WiFi and MQTT");

  } else {
    // Handle error response
    String response = http.getString();
    addSystemLog("[REGISTER] HTTP error: " + String(httpCode) + " - " + response);

    JsonDocument resDoc;
    deserializeJson(resDoc, response);
    String errorMsg = resDoc["error"] | "Registration failed";

    currentSetupState = SETUP_FAILED;
    currentSetupStep = "Registration failed";

    if (httpCode == 401) {
      currentSetupError = "Invalid email or password.";
      currentSetupErrorCode = "invalid_credentials";
    } else if (httpCode == 409) {
      currentSetupError = errorMsg;
      currentSetupErrorCode = "account_exists";
    } else if (httpCode < 0) {
      currentSetupError = "Could not connect to server. Check internet connection.";
      currentSetupErrorCode = "connection_error";
    } else {
      currentSetupError = errorMsg;
      currentSetupErrorCode = "server_error";
    }

    addSystemLog("[REGISTER] Setup failed: " + currentSetupError);
    saveSetupResult(false, currentSetupErrorCode, currentSetupError);
  }

  http.end();
}

// ============================================================================
// Process Pending Setup from Captive Portal (APSTA Mode - Real-time feedback)
// Called from loop() after setup request is received via /api/setup/connect
// Uses AP+STA mode to keep AP running so SPA can poll progress in real-time
// LEGACY: Combined flow for backward compatibility
// ============================================================================
void processPendingSetup() {
  if (!pendingSetup) return;

  // Wait a bit for HTTP response to be fully sent
  if (millis() - pendingSetupTime < 500) return;

  pendingSetup = false;  // Clear flag first to prevent re-entry

  // Reset state
  currentSetupState = SETUP_CONNECTING_WIFI;
  currentSetupStep = "Starting setup...";
  currentSetupError = "";
  currentSetupErrorCode = "";
  setupNeedsReboot = false;

  // ===== STEP 1: Log setup start =====
  addSystemLog("[SETUP] ====== STARTING SETUP PROCESS (APSTA MODE) ======");
  addSystemLog("[SETUP] SSID: " + pendingSetupSSID);
  addSystemLog("[SETUP] Email: " + pendingSetupEmail);
  addSystemLog("[SETUP] Device: " + pendingSetupDeviceName);

  // ===== STEP 2: Scan for target network to find its channel =====
  // In AP+STA mode, both interfaces MUST be on the same channel
  currentSetupStep = "Scanning for network...";
  addSystemLog("[SETUP] Scanning for target network channel...");

  // Temporarily switch to STA mode for reliable scanning
  WiFi.mode(WIFI_STA);
  delay(100);

  int targetChannel = 1;  // Default fallback
  int n = WiFi.scanNetworks();
  addSystemLog("[SETUP] Found " + String(n) + " networks");

  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) == pendingSetupSSID) {
      targetChannel = WiFi.channel(i);
      addSystemLog("[SETUP] Target network '" + pendingSetupSSID + "' found on channel " + String(targetChannel));
      break;
    }
  }
  WiFi.scanDelete();

  if (targetChannel == 1 && n > 0) {
    addSystemLog("[SETUP] WARNING: Target network not found in scan, using channel 1");
  }

  // ===== STEP 3: Switch to AP+STA mode with correct channel =====
  currentSetupStep = "Connecting to WiFi...";
  addSystemLog("[SETUP] Switching to AP+STA mode on channel " + String(targetChannel) + "...");
  WiFi.mode(WIFI_AP_STA);
  delay(100);

  // Restart AP on the correct channel
  String macSuffix = g_macUpper.length() > 5 ? g_macUpper.substring(g_macUpper.length() - 5) : "0000";
  macSuffix.replace(":", "");
  String apName = "MouseTrap-" + macSuffix;
  WiFi.softAP(apName.c_str(), "", targetChannel);  // Empty password for open AP
  delay(500);  // Allow mode switch to settle
  addSystemLog("[SETUP] AP restarted on channel " + String(targetChannel) + ", IP: " + WiFi.softAPIP().toString());

  // ===== STEP 4: Connect to WiFi (STA) =====
  addSystemLog("[SETUP] Connecting to WiFi: " + pendingSetupSSID);
  WiFi.begin(pendingSetupSSID.c_str(), pendingSetupPassword.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    attempts++;
    if (attempts % 5 == 0) {
      currentSetupStep = "Connecting to WiFi... (" + String(attempts) + "s)";
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    addSystemLog("[SETUP] WiFi connection failed after " + String(attempts) + " attempts");
    addSystemLog("[SETUP] WiFi status code: " + String(WiFi.status()));
    currentSetupState = SETUP_FAILED;
    currentSetupError = "Could not connect to WiFi network. Check password and try again.";
    currentSetupErrorCode = "wifi_failed";
    currentSetupStep = "WiFi connection failed";
    // Stay in AP+STA mode so user can retry - don't reboot
    return;
  }

  addSystemLog("[SETUP] WiFi connected, IP: " + WiFi.localIP().toString());
  currentSetupStep = "WiFi connected, syncing time...";

  // Give WiFi stack time to fully initialize
  delay(2000);

  // ===== STEP 5: Sync NTP time =====
  currentSetupState = SETUP_SYNCING_TIME;
  addSystemLog("[SETUP] Syncing NTP time...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  const time_t MIN_VALID_TIME = 1577836800;  // Jan 1, 2020
  int ntpAttempts = 0;
  time_t now = time(nullptr);
  while (now < MIN_VALID_TIME && ntpAttempts < 20) {
    delay(500);
    now = time(nullptr);
    ntpAttempts++;
    if (ntpAttempts % 4 == 0) {
      currentSetupStep = "Syncing time... (" + String(ntpAttempts * 500 / 1000) + "s)";
    }
  }

  if (now < MIN_VALID_TIME) {
    addSystemLog("[SETUP] NTP sync timeout, epoch=" + String((unsigned long)now));
    currentSetupState = SETUP_FAILED;
    currentSetupError = "Could not sync time with internet. Check your network connection.";
    currentSetupErrorCode = "ntp_failed";
    currentSetupStep = "Time sync failed";
    return;
  }

  addSystemLog("[SETUP] Time synced, epoch: " + String((unsigned long)now));

  // ===== STEP 6: Generate claim token =====
  currentSetupState = SETUP_REGISTERING;
  currentSetupStep = "Registering device...";
  addSystemLog("[SETUP] Generating claim credentials...");
  ClaimCredentials creds = generateClaimCredentials();
  addSystemLog("[SETUP] MAC=" + String(creds.mac) + ", timestamp=" + String(creds.timestamp));

  // ===== STEP 7: Call server =====
  String url = String(CLAIM_SERVER_URL) + "/api/setup/register-and-claim";
  addSystemLog("[SETUP] Calling server: " + url);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  JsonDocument reqDoc;
  reqDoc["email"] = pendingSetupEmail;
  reqDoc["password"] = pendingSetupAccountPassword;
  reqDoc["deviceName"] = pendingSetupDeviceName;
  reqDoc["mac"] = creds.mac;
  reqDoc["claimToken"] = creds.token;
  reqDoc["timestamp"] = creds.timestamp;
  reqDoc["isNewAccount"] = pendingSetupIsNewAccount;

  String reqBody;
  serializeJson(reqDoc, reqBody);

  int httpCode = http.POST(reqBody);
  addSystemLog("[SETUP] HTTP response code: " + String(httpCode));

  if (httpCode == 200 || httpCode == 201) {
    String response = http.getString();
    addSystemLog("[SETUP] Got success response");

    JsonDocument respDoc;
    DeserializationError jsonErr = deserializeJson(respDoc, response);

    if (jsonErr) {
      addSystemLog("[SETUP] JSON parse error: " + String(jsonErr.c_str()));
      currentSetupState = SETUP_FAILED;
      currentSetupError = "Server returned invalid response. Please try again.";
      currentSetupErrorCode = "server_error";
      currentSetupStep = "Server error";
      http.end();
      return;
    }

    if (respDoc["success"].as<bool>()) {
      // ===== STEP 7: Save credentials =====
      currentSetupState = SETUP_SAVING;
      currentSetupStep = "Saving credentials...";
      addSystemLog("[SETUP] Saving credentials to NVS...");

      deviceClaimed = true;
      claimedDeviceId = respDoc["deviceId"].as<String>();
      claimedDeviceName = pendingSetupDeviceName;
      claimedTenantId = respDoc["tenantId"].as<String>();
      claimedMqttUsername = respDoc["mqttCredentials"]["username"].as<String>();
      claimedMqttPassword = respDoc["mqttCredentials"]["password"].as<String>();

      devicePrefs.begin("device", false);
      devicePrefs.putBool("claimed", true);
      devicePrefs.putString("deviceId", claimedDeviceId);
      devicePrefs.putString("deviceName", claimedDeviceName);
      devicePrefs.putString("tenantId", claimedTenantId);
      devicePrefs.putString("mqttClientId", respDoc["mqttClientId"].as<String>());
      devicePrefs.putString("mqttUsername", claimedMqttUsername);
      devicePrefs.putString("mqttPassword", claimedMqttPassword);
      devicePrefs.putString("mqttBroker", respDoc["mqttBroker"].as<String>());
      devicePrefs.end();

      devicePrefs.begin("wifi", false);
      devicePrefs.putString("ssid", pendingSetupSSID);
      devicePrefs.putString("password", pendingSetupPassword);
      devicePrefs.end();

      addSystemLog("[SETUP] Credentials saved");
      addSystemLog("[SETUP] DeviceID: " + claimedDeviceId);
      clearSetupResult();  // Clear any previous error on success

      // ===== SUCCESS! =====
      currentSetupState = SETUP_COMPLETE;
      currentSetupStep = "Setup complete!";
      setupNeedsReboot = true;  // Signal to SPA that reboot is needed
      addSystemLog("[SETUP] ====== SETUP COMPLETE - WAITING FOR REBOOT COMMAND ======");

    } else {
      String error = respDoc["error"].as<String>();
      addSystemLog("[SETUP] Server rejected: " + error);
      currentSetupState = SETUP_FAILED;
      currentSetupError = error;
      currentSetupErrorCode = "server_rejected";
      currentSetupStep = "Registration failed";
    }
  } else if (httpCode < 0) {
    addSystemLog("[SETUP] HTTP connection error: " + String(httpCode) + " - " + http.errorToString(httpCode));
    currentSetupState = SETUP_FAILED;
    currentSetupError = "Could not connect to server. Check internet connection.";
    currentSetupErrorCode = "connection_error";
    currentSetupStep = "Connection error";
  } else if (httpCode == 401) {
    String errorBody = http.getString();
    addSystemLog("[SETUP] Authentication error (401): " + errorBody.substring(0, 200));

    JsonDocument errDoc;
    String errorMsg = "Invalid email or password";
    if (deserializeJson(errDoc, errorBody) == DeserializationError::Ok) {
      if (errDoc.containsKey("error")) {
        errorMsg = errDoc["error"].as<String>();
      }
    }
    currentSetupState = SETUP_FAILED;
    currentSetupError = errorMsg;
    currentSetupErrorCode = "invalid_credentials";
    currentSetupStep = "Authentication failed";
  } else {
    String errorBody = http.getString();
    addSystemLog("[SETUP] HTTP " + String(httpCode) + ": " + errorBody.substring(0, 200));

    JsonDocument errDoc;
    String errorMsg = "Registration failed (HTTP " + String(httpCode) + ")";
    if (deserializeJson(errDoc, errorBody) == DeserializationError::Ok) {
      if (errDoc.containsKey("error")) {
        errorMsg = errDoc["error"].as<String>();
      }
    }
    currentSetupState = SETUP_FAILED;
    currentSetupError = errorMsg;
    currentSetupErrorCode = "registration_failed";
    currentSetupStep = "Registration failed";
  }

  http.end();
}

void loop() {

  // Process DNS requests for captive portal when in AP mode
  if (isAPMode) {
    dnsServer.processNextRequest();
    performWiFiScan();  // Check if async scan completed and cache results
  }

  // Process pending setup from captive portal (deferred to allow HTTP response to send)
  processPendingWiFiTest();    // Phase 1: Test WiFi connection only
  processPendingRegistration(); // Phase 2: Register (after WiFi confirmed)
  processPendingSetup();       // Legacy: Combined flow (for backward compatibility)

  static uint32_t lastStamp = 0;
  if (!CrashKit::pageActive() && millis() - lastStamp >= 500) {
    CrashKit::markPage("loop");
    CrashKit::markLine(__LINE__);
    lastStamp = millis();
  }

  /* ── Heap low-water-mark monitor ───────────────────────────── */
  static uint32_t lowHeap = ESP.getFreeHeap();  // start at current value
  static uint32_t lastMinute = 0;               // time of last 1-min check
  static uint32_t lastReport = 0;               // time of last 1-h log

  uint32_t now = millis();

  /* every 60 s update the running minimum */
  if (now - lastMinute >= 60000) {
    lastMinute = now;
    lowHeap = min(lowHeap, ESP.getFreeHeap());
  }

  /* every 60 min write one line to the system log */
  if (now - lastReport >= 3600000) {
    lastReport = now;
    addSystemLog("[heap] low-water mark: " + String(lowHeap) + " bytes");
    lowHeap = ESP.getFreeHeap();  // reset for next hour
  }
  /* ─────────────────────────────────────────────────────────── */

  /* ── NVS Claim Status Verification (every 5 minutes) ─────── */
  if (now - lastNvsVerification >= 300000) {  // Every 5 minutes (300000 ms)
    lastNvsVerification = now;

    // Verify NVS claim credentials are still present
    Serial.println("[NVS-VERIFY] ========================================");
    Serial.println("[NVS-VERIFY] PERIODIC CLAIM STATUS CHECK");
    Serial.println("[NVS-VERIFY] ========================================");
    Serial.printf("[NVS-VERIFY] Timestamp: %lu ms (uptime: %.1f hours)\n", now, now / 3600000.0);
    Serial.printf("[NVS-VERIFY] Claim Status:\n");
    Serial.printf("[NVS-VERIFY]   - deviceClaimed: %s\n", deviceClaimed ? "TRUE" : "FALSE");

    if (deviceClaimed) {
      Serial.printf("[NVS-VERIFY]   - claimedDeviceId: %s\n",
                    claimedDeviceId.length() > 0 ? "PRESENT" : "MISSING");
      Serial.printf("[NVS-VERIFY]   - claimedDeviceName: %s\n",
                    claimedDeviceName.length() > 0 ? claimedDeviceName.c_str() : "MISSING");
      Serial.printf("[NVS-VERIFY]   - claimedMqttClientId: %s\n",
                    claimedMqttClientId.length() > 0 ? "PRESENT" : "MISSING");
      Serial.printf("[NVS-VERIFY]   - claimedMqttUsername: %s\n",
                    claimedMqttUsername.length() > 0 ? "PRESENT" : "MISSING");
      Serial.printf("[NVS-VERIFY]   - claimedMqttPassword: %s\n",
                    claimedMqttPassword.length() > 0 ? "PRESENT" : "MISSING");
      Serial.printf("[NVS-VERIFY]   - MQTT Connected: %s\n",
                    mqttReallyConnected ? "YES" : "NO");

      // Check for credential integrity
      bool credentialsIntact = (claimedDeviceId.length() > 0 &&
                                claimedMqttClientId.length() > 0 &&
                                claimedMqttUsername.length() > 0 &&
                                claimedMqttPassword.length() > 0);

      if (credentialsIntact) {
        Serial.println("[NVS-VERIFY] ✓ All claim credentials present and intact");
      } else {
        Serial.println("[NVS-VERIFY] ⚠️ WARNING: Claim credentials are INCOMPLETE!");
        Serial.println("[NVS-VERIFY] This may indicate NVS corruption or partial clear");
        addSystemLog("[NVS-VERIFY] WARNING: Incomplete claim credentials detected!");
      }
    } else {
      Serial.println("[NVS-VERIFY]   - Device is UNCLAIMED");
      Serial.printf("[NVS-VERIFY]   - WiFi: %s\n", WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
      Serial.printf("[NVS-VERIFY]   - AP Mode: %s\n", isAPMode ? "Active" : "Inactive");
    }

    Serial.println("[NVS-VERIFY] ========================================");
  }
  /* ─────────────────────────────────────────────────────────── */

  /* ── Debug instrumentation periodic monitoring ─────────────── */
  static unsigned long lastDebugUpdate = 0;
  if (now - lastDebugUpdate > 10000) {  // Every 10 seconds
    debugTasksMonitor();
    debugFramebufferCheckStale();
    debugI2CCheckHealth();
    lastDebugUpdate = now;
  }
  /* ─────────────────────────────────────────────────────────── */

  /* ── Claiming mode button check, polling, and timeout ──────── */
  checkButtonForClaimingMode();
  checkClaimCompletion();  // Poll server to check if claimed
  checkClaimingModeTimeout();
  /* ─────────────────────────────────────────────────────────── */

  ElegantOTA.loop();

  // WebSocket tunnel removed
  // ws_tunnel_loop();  // REMOVED

  // MQTT fleet management
  mqttLoop();

  // If the high-power LED is on and has been on for 10 seconds, turn it off.
  if (highPowerLedState && (millis() - highPowerLedOnTimestamp >= 10000)) {
    Serial.println("Safety override: High-power LED turned off after 10 seconds.");
    addSystemLog("Safety override: High-power LED turned off after 10 seconds.");
    setHighPowerLED(false);
  }



  NET_YIELD();
  TASK_YIELD_MS(10);
}
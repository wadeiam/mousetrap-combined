/**
 * Scout Device Firmware
 *
 * Entry point monitoring with AI-powered rodent detection.
 * Detects motion, filters by size, and sends images to server for classification.
 *
 * Hardware: ESP32-S3-CAM (same as trap device)
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

#include "camera_pins.h"
#include "motion_detect.h"

// =============================================================================
// Version and Configuration
// =============================================================================

#define FIRMWARE_VERSION "v0.1.0"
#define FILESYSTEM_VERSION "v0.1.0"
#define DEVICE_TYPE "scout"

// MQTT settings
#define MQTT_PORT 1883
#define MQTT_BUFFER_SIZE 50000  // 50KB for image payloads

// Motion detection settings
#define MOTION_CHECK_INTERVAL 500   // ms between motion checks
#define MOTION_COOLDOWN 3000        // ms after detection
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

// MQTT
WiFiClient mqttWifiClient;
PubSubClient mqttClient(mqttWifiClient);
unsigned long lastMqttReconnect = 0;
unsigned long lastStatusPublish = 0;
bool mqttReallyConnected = false;

// Camera
bool cameraInitialized = false;

// Motion detection
MotionDetector motionDetector;
unsigned long lastMotionCheck = 0;
uint32_t motionEventCount = 0;

// Web server
AsyncWebServer server(80);

// System log (circular buffer)
#define MAX_LOG_ENTRIES 50
String systemLog[MAX_LOG_ENTRIES];
int logIndex = 0;

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
  strftime(timeStr, sizeof(timeStr), "%H:%M:%S", localtime(&now));

  systemLog[logIndex] = String(timeStr) + " " + msg;
  logIndex = (logIndex + 1) % MAX_LOG_ENTRIES;

  Serial.println("[Log] " + msg);
}

String getMacAddress() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(macStr);
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
  claimedMqttClientId = devicePrefs.getString("mqttClientId", getMacAddress());
  claimedServerUrl = devicePrefs.getString("serverUrl", "");
  devicePrefs.end();

  if (deviceClaimed) {
    Serial.println("[Claim] Device is claimed: " + claimedDeviceName);
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
  motionPrefs.begin("motion", true);

  MotionConfig config;
  config.threshold = motionPrefs.getUChar("threshold", 25);
  config.minSizePercent = motionPrefs.getFloat("minSize", 1.0);
  config.maxSizePercent = motionPrefs.getFloat("maxSize", 30.0);
  config.blockSize = motionPrefs.getUShort("blockSize", 16);
  config.cooldownMs = motionPrefs.getUShort("cooldown", MOTION_COOLDOWN);

  motionPrefs.end();

  motionDetector.setConfig(config);

  Serial.printf("[Motion] Config: thresh=%d, min=%.1f%%, max=%.1f%%\n",
                config.threshold, config.minSizePercent, config.maxSizePercent);
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

void mqttSetup() {
  String broker = claimedMqttBroker;
  if (broker.startsWith("mqtt://")) broker = broker.substring(7);

  int colonPos = broker.indexOf(':');
  if (colonPos > 0) broker = broker.substring(0, colonPos);

  if (broker.length() == 0) {
    Serial.println("[MQTT] No broker configured");
    return;
  }

  mqttClient.setServer(broker.c_str(), MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);

  Serial.printf("[MQTT] Configured for %s:%d\n", broker.c_str(), MQTT_PORT);
}

bool mqttConnect() {
  if (mqttClient.connected()) return true;
  if (!deviceClaimed && !standaloneMode) return false;
  if (millis() - lastMqttReconnect < 5000) return false;

  lastMqttReconnect = millis();

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddress();

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

  // OTA topics
  snprintf(topic, sizeof(topic), "tenant/%s/device/%s/ota/#",
           claimedTenantId.c_str(), clientId.c_str());
  mqttClient.subscribe(topic);

  // Publish initial status
  publishDeviceStatus();

  addSystemLog("MQTT connected");
  return true;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.printf("[MQTT] Message on %s\n", topic);

  // Parse JSON payload
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[MQTT] JSON parse error: %s\n", err.c_str());
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
    } else if (command == "capture") {
      addSystemLog("Manual capture requested");
      // Trigger immediate capture
      camera_fb_t* fb = esp_camera_fb_get();
      if (fb) {
        MotionResult result = {true, false, 0, 0, fb->width, fb->height, 100.0, 1, 1, 1.0};
        publishMotionEvent(fb, result);
        esp_camera_fb_return(fb);
      }
    } else if (command == "status") {
      publishDeviceStatus();
    }
  }

  // Handle OTA
  if (topicStr.indexOf("/ota/") >= 0) {
    String url = doc["url"] | "";
    if (url.length() > 0) {
      addSystemLog("OTA update triggered");
      // TODO: Implement OTA download
    }
  }
}

void publishDeviceStatus() {
  if (!mqttClient.connected()) return;

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddress();

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
// Motion Events
// =============================================================================

void publishMotionEvent(camera_fb_t* frame, MotionResult& result) {
  if (!mqttClient.connected()) {
    Serial.println("[Motion] MQTT not connected, skipping publish");
    return;
  }

  motionEventCount++;

  String clientId = claimedMqttClientId.length() > 0 ? claimedMqttClientId : getMacAddress();

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

  if (result.detected && !result.sizeFiltered) {
    // Motion detected and passed size filter - potential rodent!
    publishMotionEvent(fb, result);
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
  // Serve SPA from LittleFS
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
  AsyncCallbackJsonWebHandler* motionConfigHandler = new AsyncCallbackJsonWebHandler(
    "/api/motion/config",
    [](AsyncWebServerRequest* request, JsonVariant& json) {
      MotionConfig config = motionDetector.getConfig();

      if (json.containsKey("threshold")) {
        config.threshold = json["threshold"].as<uint8_t>();
      }
      if (json.containsKey("min_size")) {
        config.minSizePercent = json["min_size"].as<float>();
      }
      if (json.containsKey("max_size")) {
        config.maxSizePercent = json["max_size"].as<float>();
      }

      motionDetector.setConfig(config);
      saveMotionConfig();

      request->send(200, "application/json", "{\"success\":true}");
    }
  );
  server.addHandler(motionConfigHandler);

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
      claimedMqttClientId = doc["client_id"] | getMacAddress();
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

  // ElegantOTA for web-based updates
  ElegantOTA.begin(&server);

  server.begin();
  Serial.println("[Web] Server started on port 80");
}

// =============================================================================
// Setup
// =============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("Scout Device Firmware");
  Serial.printf("Version: %s\n", FIRMWARE_VERSION);
  Serial.println("========================================\n");

  // Initialize LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("[FS] LittleFS mount failed");
  } else {
    Serial.println("[FS] LittleFS mounted");
  }

  // Load configuration
  loadWiFiCredentials();
  loadClaimCredentials();
  loadMotionConfig();

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

      // Sync time
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    } else {
      Serial.println("\n[WiFi] Connection failed");
    }
  }

  // Start AP mode if no WiFi or not connected
  if (!wifiConnected) {
    String apName = "Scout-" + getMacAddress().substring(6);
    WiFi.softAP(apName.c_str(), "scoutsetup");
    Serial.printf("[WiFi] AP Mode: %s (password: scoutsetup)\n", apName.c_str());
    Serial.printf("[WiFi] Configure at http://%s\n", WiFi.softAPIP().toString().c_str());
  }

  // Initialize camera
  initCamera();

  // Setup MQTT
  if ((deviceClaimed || standaloneMode) && wifiConnected) {
    mqttSetup();
  }

  // Start web server
  setupWebServer();

  addSystemLog("Scout device started");
  Serial.println("\n[Setup] Complete!\n");
}

// =============================================================================
// Main Loop
// =============================================================================

void loop() {
  // Handle OTA
  ElegantOTA.loop();

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

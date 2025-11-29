/*
 * AP+STA Mode Test Sketch for ESP32-S3
 *
 * This sketch tests whether the ESP32-S3 can operate in simultaneous
 * AP and STA mode (WIFI_AP_STA).
 *
 * Expected behavior:
 * 1. Device creates AP "APSTA_Test"
 * 2. Device connects to home WiFi as STA
 * 3. Both should work simultaneously
 * 4. Serial output shows status of both interfaces
 */

#include <WiFi.h>

// Configure your home WiFi credentials
const char* STA_SSID = "Pretty Fly for a Wi-Fi 2.4";
const char* STA_PASS = "38404244";

// AP configuration
const char* AP_SSID = "APSTA_Test";
const char* AP_PASS = "testpass123";

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n=================================");
  Serial.println("ESP32-S3 AP+STA Mode Test");
  Serial.println("=================================\n");

  // First, scan for networks in STA mode to find target channel
  Serial.println("[0] Scanning for networks (STA mode)...");
  WiFi.mode(WIFI_STA);
  delay(100);

  int n = WiFi.scanNetworks();
  int targetChannel = 1;  // default
  Serial.printf("    Found %d networks:\n", n);
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    int ch = WiFi.channel(i);
    int rssi = WiFi.RSSI(i);
    Serial.printf("      %s (ch:%d, rssi:%d)\n", ssid.c_str(), ch, rssi);
    if (ssid == STA_SSID) {
      targetChannel = ch;
      Serial.printf("    >>> Target network found on channel %d\n", targetChannel);
    }
  }
  WiFi.scanDelete();

  // Set WiFi mode to AP+STA
  Serial.println("\n[1] Setting WiFi mode to WIFI_AP_STA...");
  WiFi.mode(WIFI_AP_STA);
  delay(100);

  wifi_mode_t currentMode = WiFi.getMode();
  Serial.printf("    Current mode: %d (expected 3 for AP_STA)\n", currentMode);

  if (currentMode != WIFI_AP_STA) {
    Serial.println("    ERROR: Failed to set AP_STA mode!");
  } else {
    Serial.println("    OK: AP_STA mode set successfully");
  }

  // Start the Access Point on the same channel as target network
  Serial.println("\n[2] Starting Access Point...");
  Serial.printf("    SSID: %s\n", AP_SSID);
  Serial.printf("    Channel: %d (matching target network)\n", targetChannel);

  bool apStarted = WiFi.softAP(AP_SSID, AP_PASS, targetChannel);
  delay(500);

  if (apStarted) {
    IPAddress apIP = WiFi.softAPIP();
    Serial.printf("    OK: AP started at IP: %s\n", apIP.toString().c_str());
  } else {
    Serial.println("    ERROR: Failed to start AP!");
  }

  // Connect to home WiFi as Station
  Serial.println("\n[3] Connecting to WiFi as Station...");
  Serial.printf("    SSID: %s\n", STA_SSID);

  WiFi.begin(STA_SSID, STA_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("    OK: Connected to %s\n", STA_SSID);
    Serial.printf("    STA IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("    RSSI: %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println("    ERROR: Failed to connect as STA!");
    Serial.printf("    Status: %d\n", WiFi.status());
  }

  // Verify both interfaces are still active
  Serial.println("\n[4] Verifying both interfaces...");

  currentMode = WiFi.getMode();
  Serial.printf("    WiFi mode: %d\n", currentMode);

  bool apActive = (currentMode == WIFI_AP_STA || currentMode == WIFI_AP);
  bool staActive = WiFi.status() == WL_CONNECTED;

  Serial.printf("    AP active: %s (IP: %s)\n",
    apActive ? "YES" : "NO",
    WiFi.softAPIP().toString().c_str());
  Serial.printf("    STA active: %s (IP: %s)\n",
    staActive ? "YES" : "NO",
    WiFi.localIP().toString().c_str());

  // Check channel alignment (both must use same channel)
  uint8_t apChannel = WiFi.channel();
  Serial.printf("    Channel: %d\n", apChannel);

  Serial.println("\n=================================");
  if (apActive && staActive) {
    Serial.println("SUCCESS: AP+STA mode is working!");
    Serial.println("Both interfaces are active.");
  } else {
    Serial.println("FAILURE: AP+STA mode not fully working");
  }
  Serial.println("=================================\n");

  Serial.println("Monitoring status every 5 seconds...\n");
}

void loop() {
  static unsigned long lastPrint = 0;

  if (millis() - lastPrint > 5000) {
    lastPrint = millis();

    wifi_mode_t mode = WiFi.getMode();
    bool staConnected = WiFi.status() == WL_CONNECTED;
    int apClients = WiFi.softAPgetStationNum();

    Serial.printf("[%lu] Mode:%d | STA:%s (RSSI:%d) | AP clients:%d\n",
      millis() / 1000,
      mode,
      staConnected ? "connected" : "disconnected",
      staConnected ? WiFi.RSSI() : 0,
      apClients);
  }
}

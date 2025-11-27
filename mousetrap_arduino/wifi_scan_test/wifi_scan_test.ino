// Minimal WiFi scan test for ESP32-S3
#include <WiFi.h>

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n=== WiFi Scan Test ===");

  // Set to station mode
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  Serial.println("Starting scan...");

  int n = WiFi.scanNetworks();

  Serial.printf("Scan complete. Found %d networks:\n", n);

  for (int i = 0; i < n; i++) {
    Serial.printf("  %d: %s (%d dBm) %s\n",
      i + 1,
      WiFi.SSID(i).c_str(),
      WiFi.RSSI(i),
      WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "secured"
    );
  }

  Serial.println("\n=== Test Complete ===");
}

void loop() {
  delay(10000);

  // Rescan every 10 seconds
  Serial.println("\nRescanning...");
  int n = WiFi.scanNetworks();
  Serial.printf("Found %d networks\n", n);
  for (int i = 0; i < n; i++) {
    Serial.printf("  %s (%d dBm)\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i));
  }
}

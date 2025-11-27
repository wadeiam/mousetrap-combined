#pragma once
#include <Arduino.h>
#include <Wire.h>

// Safe, generic I2C scanner (does NOT probe any ToF ID registers)
inline void tofScan(TwoWire &bus){
  Serial.print(F("I2C scan:"));
  uint8_t n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    bus.beginTransmission(a);
    if (bus.endTransmission() == 0) {
      Serial.printf(" 0x%02X", a);
      n++;
    }
  }
  Serial.printf("  (found %u)\n", n);
}

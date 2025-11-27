#pragma once
#include <Arduino.h>
#include <ESP32Servo.h>

// Keep the hardware pin constant in one place.
// We will NOT hardcode presence; runtime gating uses disableServo.
#ifndef SERVO_PIN
#define SERVO_PIN 48
#endif

// Provided by your .ino (Preferences-loaded)
extern volatile bool disableServo;

// servo_optional.h  — drop-in replacement for your SafeServo
class SafeServo {
public:
  SafeServo() : _attached(false), _ch(-1), _pin(-1) {}

  int attach(int pin, int minUs = 500, int maxUs = 2500) {
    _pin = pin;
    if (disableServo) {
      // Disabled at attach time: make sure we are "safe"
      triStatePin();
      powerOff();
      return -1;
    }
    if (pin < 0 || pin > 48) return -1;   // reject invalid pins -> no HAL spam

    _ch = _inner.attach(pin, minUs, maxUs);
    _attached = (_ch >= 0);
    if (_attached) {
      powerOn();
      Serial.printf("Servo attached on LEDC channel: %d\n", _ch);
    }
    return _ch;
  }

  void detach() {
    // ALWAYS detach and make the pin safe, even when disabled
    if (_attached) {
      _inner.detach();
      _attached = false;
    }
    triStatePin();
    powerOff();
  }

  // NOTE: cannot be const because ESP32Servo::attached() is non-const
  bool attached() {
    if (disableServo) return false;       // report as not attached when disabled
    return _attached && _inner.attached();
  }

  void writeMicroseconds(int us) {
    if (disableServo) { detach(); return; }  // immediately make safe if toggled
    if (!_attached) return;
    _inner.writeMicroseconds(us);
  }

  void write(int angle) {
    if (disableServo) { detach(); return; }  // immediately make safe if toggled
    if (!_attached) return;
    _inner.write(angle);
  }

  // Pass-throughs your code uses in logServo()
  int readMicroseconds() {
    if (disableServo || !_attached) return -1;
    return _inner.readMicroseconds();
  }

  int read() {
    if (disableServo || !_attached) return -1;
    return _inner.read();
  }

private:
  void triStatePin() {
    // Put the control pin in Hi-Z so the servo can't twitch
    if (_pin >= 0) pinMode(_pin, INPUT);
#ifdef SERVO_PIN
    // If you have a global SERVO_PIN define, ensure that one is safe too
    pinMode(SERVO_PIN, INPUT);
#endif
  }

  void powerOff() {
#ifdef SERVO_PWR_EN
    // If you have a power-enable FET for the servo rail, cut it
    pinMode(SERVO_PWR_EN, OUTPUT);
    digitalWrite(SERVO_PWR_EN, LOW);
#endif
  }

  void powerOn() {
#ifdef SERVO_PWR_EN
    pinMode(SERVO_PWR_EN, OUTPUT);
    digitalWrite(SERVO_PWR_EN, HIGH);
#endif
  }

  Servo _inner;
  bool  _attached;
  int   _ch;
  int   _pin;
};


// ---- Compatibility wrappers so your sketch compiles unchanged ----
extern SafeServo trapServo;            // defined in your .ino
inline void initServo() { /* no-op by design; you re-attach on demand */ }
inline void detachServo() { trapServo.detach(); }

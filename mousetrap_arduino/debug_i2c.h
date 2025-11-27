/*
 * debug_i2c.h
 *
 * I2C Health Monitoring for ESP32-S3
 *
 * Tracks I2C transaction success/failure rates for VL6180X/VL53L0X sensors.
 * Detects I2C bus hangs and communication issues.
 *
 * Usage:
 *   1. Call debugI2CInit() during setup
 *   2. Wrap sensor reads with debugI2CTransactionStart() and debugI2CTransactionEnd()
 *   3. Call debugI2CPrintStats() to view statistics
 *   4. Use debugI2CCheckHealth() to detect bus hangs
 *
 * Thread-safe: Yes (uses mutex)
 * Overhead: Minimal (~0.1% CPU)
 */

#ifndef DEBUG_I2C_H
#define DEBUG_I2C_H

#include <Arduino.h>
#include <Wire.h>

// I2C sensor types for tracking
typedef enum {
    I2C_SENSOR_VL6180X,
    I2C_SENSOR_VL53L0X,
    I2C_SENSOR_UNKNOWN,
    I2C_SENSOR_COUNT
} I2CSensorType;

// Statistics structure for I2C tracking
typedef struct {
    uint32_t total_transactions;       // Total I2C operations attempted
    uint32_t successful_transactions;  // Successfully completed operations
    uint32_t failed_transactions;      // Failed operations
    uint32_t timeout_errors;           // Transactions that timed out
    uint32_t nack_errors;              // Not-acknowledged errors
    uint32_t bus_errors;               // Bus error conditions
    float success_rate_percentage;     // Success rate (0-100%)
    unsigned long last_success_ms;     // Timestamp of last successful transaction
    unsigned long last_failure_ms;     // Timestamp of last failed transaction
    unsigned long longest_transaction_us; // Longest transaction time in microseconds
    unsigned long total_transaction_time_us; // Total time spent in transactions
    uint32_t consecutive_failures;     // Current streak of failures
    uint32_t max_consecutive_failures; // Longest failure streak
    bool bus_healthy;                  // Overall bus health status
} I2CStats;

// Per-sensor statistics
typedef struct {
    I2CStats stats;
    uint8_t address;                   // I2C address of this sensor
    char name[16];                     // Sensor name for logging
    unsigned long transaction_start_us; // Transaction timing
} I2CSensorStats;

// Global I2C statistics accessible from anywhere
extern I2CSensorStats g_i2c_sensors[I2C_SENSOR_COUNT];
extern SemaphoreHandle_t g_i2c_mutex;

// Configuration
#define I2C_HANG_THRESHOLD_MS 5000     // Consider bus hung if no success in 5 seconds
#define I2C_FAILURE_STREAK_WARN 5      // Warn after 5 consecutive failures
#define I2C_TIMEOUT_US 10000           // Individual transaction timeout (10ms)

/**
 * Initialize the I2C debug system
 * Call this once during setup(), after Wire.begin()
 */
inline void debugI2CInit() {
    memset(g_i2c_sensors, 0, sizeof(g_i2c_sensors));
    g_i2c_mutex = xSemaphoreCreateMutex();

    // Initialize sensor names
    strcpy(g_i2c_sensors[I2C_SENSOR_VL6180X].name, "VL6180X");
    strcpy(g_i2c_sensors[I2C_SENSOR_VL53L0X].name, "VL53L0X");
    strcpy(g_i2c_sensors[I2C_SENSOR_UNKNOWN].name, "Unknown");

    // Mark all sensors as healthy initially
    for (int i = 0; i < I2C_SENSOR_COUNT; i++) {
        g_i2c_sensors[i].stats.bus_healthy = true;
    }

    Serial.println("[I2C-DEBUG] I2C health monitoring initialized");
}

/**
 * Set the I2C address for a sensor type
 *
 * @param sensor Sensor type
 * @param address I2C address (7-bit)
 */
inline void debugI2CSetSensorAddress(I2CSensorType sensor, uint8_t address) {
    if (sensor >= I2C_SENSOR_COUNT) return;

    if (g_i2c_mutex) {
        xSemaphoreTake(g_i2c_mutex, portMAX_DELAY);
    }

    g_i2c_sensors[sensor].address = address;
    Serial.printf("[I2C-DEBUG] Sensor %s assigned address 0x%02X\n",
                  g_i2c_sensors[sensor].name, address);

    if (g_i2c_mutex) {
        xSemaphoreGive(g_i2c_mutex);
    }
}

/**
 * Start timing an I2C transaction
 * Call before beginning I2C communication
 *
 * @param sensor Sensor type being accessed
 */
inline void debugI2CTransactionStart(I2CSensorType sensor) {
    if (sensor >= I2C_SENSOR_COUNT || !g_i2c_mutex) return;

    xSemaphoreTake(g_i2c_mutex, portMAX_DELAY);

    g_i2c_sensors[sensor].transaction_start_us = micros();
    g_i2c_sensors[sensor].stats.total_transactions++;

    xSemaphoreGive(g_i2c_mutex);
}

/**
 * End an I2C transaction and record result
 * Call after I2C communication completes
 *
 * @param sensor Sensor type that was accessed
 * @param success true if transaction succeeded, false if failed
 * @param error_type Optional error type: 0=none, 1=timeout, 2=nack, 3=bus_error
 */
inline void debugI2CTransactionEnd(I2CSensorType sensor, bool success, uint8_t error_type = 0) {
    if (sensor >= I2C_SENSOR_COUNT || !g_i2c_mutex) return;

    xSemaphoreTake(g_i2c_mutex, portMAX_DELAY);

    I2CStats* stats = &g_i2c_sensors[sensor].stats;

    // Calculate transaction time
    unsigned long transaction_time_us = micros() - g_i2c_sensors[sensor].transaction_start_us;
    stats->total_transaction_time_us += transaction_time_us;

    if (transaction_time_us > stats->longest_transaction_us) {
        stats->longest_transaction_us = transaction_time_us;
    }

    if (success) {
        stats->successful_transactions++;
        stats->last_success_ms = millis();
        stats->consecutive_failures = 0;
        stats->bus_healthy = true;
    } else {
        stats->failed_transactions++;
        stats->last_failure_ms = millis();
        stats->consecutive_failures++;

        if (stats->consecutive_failures > stats->max_consecutive_failures) {
            stats->max_consecutive_failures = stats->consecutive_failures;
        }

        // Track error types
        switch (error_type) {
            case 1: stats->timeout_errors++; break;
            case 2: stats->nack_errors++; break;
            case 3: stats->bus_errors++; break;
        }

        // Check if we should warn
        if (stats->consecutive_failures >= I2C_FAILURE_STREAK_WARN) {
            Serial.printf("[I2C-WARN] %s: %u consecutive failures!\n",
                         g_i2c_sensors[sensor].name, stats->consecutive_failures);
            stats->bus_healthy = false;
        }
    }

    // Recalculate success rate
    if (stats->total_transactions > 0) {
        stats->success_rate_percentage =
            (100.0f * stats->successful_transactions) / stats->total_transactions;
    }

    xSemaphoreGive(g_i2c_mutex);
}

/**
 * Check overall I2C bus health
 *
 * @return true if bus appears healthy, false if hung or failing
 */
inline bool debugI2CCheckHealth() {
    if (!g_i2c_mutex) return true;

    bool overall_healthy = true;

    xSemaphoreTake(g_i2c_mutex, portMAX_DELAY);

    for (int i = 0; i < I2C_SENSOR_COUNT; i++) {
        I2CStats* stats = &g_i2c_sensors[i].stats;

        // Skip sensors that haven't been used
        if (stats->total_transactions == 0) continue;

        // Check for bus hang (no successful transaction in threshold time)
        if (stats->last_success_ms > 0) {
            unsigned long time_since_success = millis() - stats->last_success_ms;

            if (time_since_success > I2C_HANG_THRESHOLD_MS) {
                Serial.printf("[I2C-HANG] %s: No successful transaction in %lu ms\n",
                             g_i2c_sensors[i].name, time_since_success);
                stats->bus_healthy = false;
                overall_healthy = false;
            }
        }

        // Check success rate
        if (stats->success_rate_percentage < 50.0f && stats->total_transactions > 10) {
            Serial.printf("[I2C-HEALTH] %s: Low success rate (%.1f%%)\n",
                         g_i2c_sensors[i].name, stats->success_rate_percentage);
            stats->bus_healthy = false;
            overall_healthy = false;
        }
    }

    xSemaphoreGive(g_i2c_mutex);

    return overall_healthy;
}

/**
 * Print comprehensive I2C statistics
 * Safe to call from any task
 */
inline void debugI2CPrintStats() {
    if (!g_i2c_mutex) return;

    xSemaphoreTake(g_i2c_mutex, portMAX_DELAY);

    Serial.println("\n========== I2C STATISTICS ==========");

    for (int i = 0; i < I2C_SENSOR_COUNT; i++) {
        I2CStats* stats = &g_i2c_sensors[i].stats;

        // Skip sensors that haven't been used
        if (stats->total_transactions == 0) continue;

        Serial.printf("\n--- %s (0x%02X) ---\n",
                     g_i2c_sensors[i].name, g_i2c_sensors[i].address);
        Serial.printf("Total Transactions:     %u\n", stats->total_transactions);
        Serial.printf("Successful:             %u\n", stats->successful_transactions);
        Serial.printf("Failed:                 %u\n", stats->failed_transactions);
        Serial.printf("  - Timeouts:           %u\n", stats->timeout_errors);
        Serial.printf("  - NACKs:              %u\n", stats->nack_errors);
        Serial.printf("  - Bus Errors:         %u\n", stats->bus_errors);
        Serial.printf("Success Rate:           %.2f%%\n", stats->success_rate_percentage);
        Serial.printf("Consecutive Failures:   %u (max: %u)\n",
                     stats->consecutive_failures, stats->max_consecutive_failures);

        if (stats->total_transactions > 0) {
            float avg_time_us = (float)stats->total_transaction_time_us / stats->total_transactions;
            Serial.printf("Avg Transaction Time:   %.1f µs\n", avg_time_us);
            Serial.printf("Max Transaction Time:   %lu µs\n", stats->longest_transaction_us);
        }

        if (stats->last_success_ms > 0) {
            Serial.printf("Last Success:           %lu ms ago\n",
                         millis() - stats->last_success_ms);
        }

        Serial.printf("Bus Health:             %s\n",
                     stats->bus_healthy ? "✓ HEALTHY" : "⚠️  UNHEALTHY");
    }

    Serial.println("\n====================================\n");

    xSemaphoreGive(g_i2c_mutex);
}

/**
 * Reset I2C statistics (useful for testing)
 *
 * @param sensor Sensor to reset, or I2C_SENSOR_COUNT to reset all
 */
inline void debugI2CReset(I2CSensorType sensor = I2C_SENSOR_COUNT) {
    if (!g_i2c_mutex) return;

    xSemaphoreTake(g_i2c_mutex, portMAX_DELAY);

    if (sensor == I2C_SENSOR_COUNT) {
        // Reset all sensors
        for (int i = 0; i < I2C_SENSOR_COUNT; i++) {
            uint8_t addr = g_i2c_sensors[i].address;
            char name_copy[16];
            strcpy(name_copy, g_i2c_sensors[i].name);

            memset(&g_i2c_sensors[i], 0, sizeof(I2CSensorStats));

            g_i2c_sensors[i].address = addr;
            strcpy(g_i2c_sensors[i].name, name_copy);
            g_i2c_sensors[i].stats.bus_healthy = true;
        }
        Serial.println("[I2C-DEBUG] All statistics reset");
    } else if (sensor < I2C_SENSOR_COUNT) {
        // Reset specific sensor
        uint8_t addr = g_i2c_sensors[sensor].address;
        char name_copy[16];
        strcpy(name_copy, g_i2c_sensors[sensor].name);

        memset(&g_i2c_sensors[sensor], 0, sizeof(I2CSensorStats));

        g_i2c_sensors[sensor].address = addr;
        strcpy(g_i2c_sensors[sensor].name, name_copy);
        g_i2c_sensors[sensor].stats.bus_healthy = true;

        Serial.printf("[I2C-DEBUG] %s statistics reset\n", name_copy);
    }

    xSemaphoreGive(g_i2c_mutex);
}

// Define global variables (must be defined in .ino or .cpp file)
// Add this to your .ino file:
// I2CSensorStats g_i2c_sensors[I2C_SENSOR_COUNT] = {0};
// SemaphoreHandle_t g_i2c_mutex = NULL;

#endif // DEBUG_I2C_H

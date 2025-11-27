/*
 * debug_framebuffer.h
 *
 * Camera Memory Leak Detection for ESP32-S3
 *
 * Tracks camera framebuffer allocations and releases to detect memory leaks.
 * Monitors PSRAM usage by camera operations and provides comprehensive statistics.
 *
 * Usage:
 *   1. Call debugFramebufferInit() during setup
 *   2. Wrap fb = esp_camera_fb_get() with debugFramebufferAllocated(fb)
 *   3. Wrap esp_camera_fb_return(fb) with debugFramebufferReleased(fb)
 *   4. Call debugFramebufferPrintStats() to view statistics
 *
 * Thread-safe: Yes (uses mutex)
 * Overhead: Minimal (~0.1% CPU)
 */

#ifndef DEBUG_FRAMEBUFFER_H
#define DEBUG_FRAMEBUFFER_H

#include <Arduino.h>
#include "esp_camera.h"
#include "esp_heap_caps.h"

// Statistics structure for framebuffer tracking
typedef struct {
    uint32_t total_allocations;      // Total number of framebuffers allocated
    uint32_t total_releases;         // Total number of framebuffers released
    uint32_t current_outstanding;    // Currently unreleased framebuffers
    uint32_t peak_outstanding;       // Maximum number of outstanding buffers
    uint32_t leak_warnings;          // Number of times leak threshold was exceeded
    uint32_t psram_used_bytes;       // Current PSRAM usage by camera
    uint32_t psram_peak_bytes;       // Peak PSRAM usage by camera
    unsigned long last_alloc_ms;     // Timestamp of last allocation
    unsigned long last_release_ms;   // Timestamp of last release
} FramebufferStats;

// Global statistics accessible from anywhere
extern FramebufferStats g_fb_stats;

// Mutex for thread-safe access
extern SemaphoreHandle_t g_fb_mutex;

// Configuration
#define FB_LEAK_THRESHOLD 3          // Warn if more than 3 buffers outstanding
#define FB_STALE_TIMEOUT_MS 10000    // Warn if buffer held >10 seconds

/**
 * Initialize the framebuffer debug system
 * Call this once during setup()
 */
inline void debugFramebufferInit() {
    memset(&g_fb_stats, 0, sizeof(g_fb_stats));
    g_fb_mutex = xSemaphoreCreateMutex();
    Serial.println("[FB-DEBUG] Framebuffer tracking initialized");
}

/**
 * Record a framebuffer allocation
 * Call immediately after esp_camera_fb_get()
 *
 * @param fb Pointer to the allocated framebuffer (can be NULL)
 */
inline void debugFramebufferAllocated(camera_fb_t* fb) {
    if (!g_fb_mutex) return;

    xSemaphoreTake(g_fb_mutex, portMAX_DELAY);

    g_fb_stats.total_allocations++;
    g_fb_stats.last_alloc_ms = millis();

    if (fb != NULL) {
        g_fb_stats.current_outstanding++;

        // Update peak outstanding
        if (g_fb_stats.current_outstanding > g_fb_stats.peak_outstanding) {
            g_fb_stats.peak_outstanding = g_fb_stats.current_outstanding;
        }

        // Update PSRAM usage
        g_fb_stats.psram_used_bytes = heap_caps_get_total_size(MALLOC_CAP_SPIRAM) -
                                      heap_caps_get_free_size(MALLOC_CAP_SPIRAM);

        if (g_fb_stats.psram_used_bytes > g_fb_stats.psram_peak_bytes) {
            g_fb_stats.psram_peak_bytes = g_fb_stats.psram_used_bytes;
        }

        // Check for leak condition
        if (g_fb_stats.current_outstanding > FB_LEAK_THRESHOLD) {
            g_fb_stats.leak_warnings++;
            Serial.printf("[FB-LEAK] WARNING: %u framebuffers outstanding (threshold: %u)\n",
                         g_fb_stats.current_outstanding, FB_LEAK_THRESHOLD);
        }
    } else {
        Serial.println("[FB-DEBUG] WARNING: esp_camera_fb_get() returned NULL");
    }

    xSemaphoreGive(g_fb_mutex);
}

/**
 * Record a framebuffer release
 * Call immediately before esp_camera_fb_return()
 *
 * @param fb Pointer to the framebuffer being released
 */
inline void debugFramebufferReleased(camera_fb_t* fb) {
    if (!g_fb_mutex || fb == NULL) return;

    xSemaphoreTake(g_fb_mutex, portMAX_DELAY);

    g_fb_stats.total_releases++;
    g_fb_stats.last_release_ms = millis();

    if (g_fb_stats.current_outstanding > 0) {
        g_fb_stats.current_outstanding--;
    } else {
        Serial.println("[FB-ERROR] Release called with no outstanding buffers!");
    }

    // Update PSRAM usage
    g_fb_stats.psram_used_bytes = heap_caps_get_total_size(MALLOC_CAP_SPIRAM) -
                                  heap_caps_get_free_size(MALLOC_CAP_SPIRAM);

    xSemaphoreGive(g_fb_mutex);
}

/**
 * Check if buffers are being held too long (stale detection)
 * Call periodically (e.g., every 5 seconds)
 *
 * @return true if stale buffers detected
 */
inline bool debugFramebufferCheckStale() {
    if (!g_fb_mutex) return false;

    bool is_stale = false;

    xSemaphoreTake(g_fb_mutex, portMAX_DELAY);

    if (g_fb_stats.current_outstanding > 0) {
        unsigned long held_time = millis() - g_fb_stats.last_alloc_ms;
        if (held_time > FB_STALE_TIMEOUT_MS) {
            Serial.printf("[FB-STALE] WARNING: %u buffers held for %lu ms\n",
                         g_fb_stats.current_outstanding, held_time);
            is_stale = true;
        }
    }

    xSemaphoreGive(g_fb_mutex);

    return is_stale;
}

/**
 * Print comprehensive framebuffer statistics
 * Safe to call from any task
 */
inline void debugFramebufferPrintStats() {
    if (!g_fb_mutex) return;

    xSemaphoreTake(g_fb_mutex, portMAX_DELAY);

    Serial.println("\n========== FRAMEBUFFER STATISTICS ==========");
    Serial.printf("Total Allocations:    %u\n", g_fb_stats.total_allocations);
    Serial.printf("Total Releases:       %u\n", g_fb_stats.total_releases);
    Serial.printf("Currently Outstanding: %u\n", g_fb_stats.current_outstanding);
    Serial.printf("Peak Outstanding:     %u\n", g_fb_stats.peak_outstanding);
    Serial.printf("Leak Warnings:        %u\n", g_fb_stats.leak_warnings);
    Serial.printf("PSRAM Used:           %u KB\n", g_fb_stats.psram_used_bytes / 1024);
    Serial.printf("PSRAM Peak:           %u KB\n", g_fb_stats.psram_peak_bytes / 1024);

    if (g_fb_stats.total_allocations != g_fb_stats.total_releases) {
        Serial.printf("⚠️  LEAK DETECTED: %d buffers not released!\n",
                     g_fb_stats.total_allocations - g_fb_stats.total_releases);
    } else {
        Serial.println("✓ No leaks detected (allocations == releases)");
    }

    Serial.println("==========================================\n");

    xSemaphoreGive(g_fb_mutex);
}

/**
 * Reset statistics (useful for testing)
 */
inline void debugFramebufferReset() {
    if (!g_fb_mutex) return;

    xSemaphoreTake(g_fb_mutex, portMAX_DELAY);

    // Keep current_outstanding as it reflects actual state
    uint32_t current = g_fb_stats.current_outstanding;
    memset(&g_fb_stats, 0, sizeof(g_fb_stats));
    g_fb_stats.current_outstanding = current;

    xSemaphoreGive(g_fb_mutex);

    Serial.println("[FB-DEBUG] Statistics reset");
}

// Define global variables (must be defined in .ino or .cpp file)
// Add this to your .ino file:
// FramebufferStats g_fb_stats = {0};
// SemaphoreHandle_t g_fb_mutex = NULL;

#endif // DEBUG_FRAMEBUFFER_H

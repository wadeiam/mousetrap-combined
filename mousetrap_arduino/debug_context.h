/*
 * debug_context.h
 *
 * Context Snapshots for ESP32-S3
 *
 * Captures system state before critical operations to aid debugging.
 * Stores snapshots in RTC memory to survive reboots.
 *
 * Usage:
 *   1. Call debugContextInit() during setup
 *   2. Use DEBUG_SNAPSHOT() macro before risky operations
 *   3. Call debugContextPrintSnapshots() to view snapshot history
 *
 * Thread-safe: Yes (uses mutex)
 * Persistence: Data survives reboot via RTC memory
 * Overhead: Minimal (~0.05% CPU per snapshot)
 */

#ifndef DEBUG_CONTEXT_H
#define DEBUG_CONTEXT_H

#include <Arduino.h>
#include "esp_system.h"
#include "esp_attr.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// Snapshot buffer configuration
#define MAX_SNAPSHOTS 10
#define SNAPSHOT_LABEL_LEN 48

// Context snapshot entry
typedef struct {
    char label[SNAPSHOT_LABEL_LEN];    // Description of operation
    char task_name[16];                // Name of task that created snapshot
    unsigned long timestamp_ms;        // When snapshot was taken
    uint32_t free_heap_bytes;          // Free heap at snapshot time
    uint32_t free_psram_bytes;         // Free PSRAM at snapshot time
    uint32_t min_free_heap_bytes;      // Minimum free heap ever seen
    uint16_t task_count;               // Number of FreeRTOS tasks
    uint8_t core_id;                   // CPU core (0 or 1)
} ContextSnapshot;

// Snapshot buffer structure (stored in RTC memory)
typedef struct {
    // Magic number to verify valid data
    uint32_t magic;

    // Circular buffer of snapshots
    ContextSnapshot snapshots[MAX_SNAPSHOTS];
    uint8_t snapshot_index;            // Current write position
    uint8_t snapshot_count;            // Total snapshots stored

    // Operational statistics
    uint32_t total_snapshots_taken;    // Lifetime counter
    unsigned long first_snapshot_ms;   // Time of first snapshot
    unsigned long last_snapshot_ms;    // Time of most recent snapshot

} ContextBuffer;

// Store in RTC memory (survives reset but not power loss)
extern RTC_DATA_ATTR ContextBuffer g_context_buf;

// Regular RAM for mutex
extern SemaphoreHandle_t g_context_mutex;
extern bool g_context_initialized;

// Magic number to identify valid context buffer
#define CONTEXT_BUFFER_MAGIC 0xC0FFEE42

/**
 * Initialize the context snapshot system
 * Call this once during setup()
 */
inline void debugContextInit() {
    g_context_mutex = xSemaphoreCreateMutex();

    // Check if we have valid context from previous boot
    bool valid_context = (g_context_buf.magic == CONTEXT_BUFFER_MAGIC);

    if (valid_context) {
        Serial.println("[CONTEXT] Context buffer restored from RTC memory");
        Serial.printf("[CONTEXT] %u lifetime snapshots, last at %lu ms\n",
                     g_context_buf.total_snapshots_taken,
                     g_context_buf.last_snapshot_ms);
    } else {
        // First boot or invalid context - initialize
        memset(&g_context_buf, 0, sizeof(g_context_buf));
        g_context_buf.magic = CONTEXT_BUFFER_MAGIC;
        Serial.println("[CONTEXT] Context buffer initialized (first boot)");
    }

    g_context_initialized = true;
    Serial.println("[CONTEXT] Context snapshot system ready");
}

/**
 * Take a context snapshot
 * Use the DEBUG_SNAPSHOT() macro instead of calling directly
 *
 * @param label Description of the operation (e.g., "Before camera init")
 */
inline void debugContextTakeSnapshot(const char* label) {
    if (!g_context_mutex) return;

    xSemaphoreTake(g_context_mutex, portMAX_DELAY);

    // Get snapshot index
    ContextSnapshot* snap = &g_context_buf.snapshots[g_context_buf.snapshot_index];

    // Store label
    strncpy(snap->label, label, SNAPSHOT_LABEL_LEN - 1);
    snap->label[SNAPSHOT_LABEL_LEN - 1] = '\0';

    // Get task information
    TaskHandle_t current_task = xTaskGetCurrentTaskHandle();
    const char* task_name = pcTaskGetName(current_task);
    strncpy(snap->task_name, task_name, sizeof(snap->task_name) - 1);
    snap->task_name[sizeof(snap->task_name) - 1] = '\0';

    // Capture system state
    snap->timestamp_ms = millis();
    snap->free_heap_bytes = ESP.getFreeHeap();
    snap->free_psram_bytes = ESP.getFreePsram();
    snap->min_free_heap_bytes = ESP.getMinFreeHeap();
    snap->task_count = uxTaskGetNumberOfTasks();
    snap->core_id = xPortGetCoreID();

    // Update circular buffer index
    g_context_buf.snapshot_index = (g_context_buf.snapshot_index + 1) % MAX_SNAPSHOTS;

    if (g_context_buf.snapshot_count < MAX_SNAPSHOTS) {
        g_context_buf.snapshot_count++;
    }

    // Update statistics
    g_context_buf.total_snapshots_taken++;
    g_context_buf.last_snapshot_ms = snap->timestamp_ms;

    if (g_context_buf.first_snapshot_ms == 0) {
        g_context_buf.first_snapshot_ms = snap->timestamp_ms;
    }

    xSemaphoreGive(g_context_mutex);
}

/**
 * Macro to take a snapshot with automatic labeling
 * Usage examples:
 *   DEBUG_SNAPSHOT("Before camera init");
 *   DEBUG_SNAPSHOT("Before WiFi connect");
 *   DEBUG_SNAPSHOT("Before MQTT publish");
 */
#define DEBUG_SNAPSHOT(description) debugContextTakeSnapshot(description " @ " __FILE__ ":" TOSTRING(__LINE__))

// Helper macro for stringification
#define TOSTRING(x) STRINGIFY(x)
#define STRINGIFY(x) #x

/**
 * Take a snapshot with function name
 * Use this inside functions to automatically include function name
 */
#define DEBUG_SNAPSHOT_FUNC() debugContextTakeSnapshot(__FUNCTION__)

/**
 * Print all stored snapshots
 * Shows snapshots in chronological order
 */
inline void debugContextPrintSnapshots() {
    if (!g_context_mutex) return;

    xSemaphoreTake(g_context_mutex, portMAX_DELAY);

    Serial.println("\n========== CONTEXT SNAPSHOTS ==========");
    Serial.printf("Total snapshots taken: %u\n", g_context_buf.total_snapshots_taken);
    Serial.printf("Showing last %u snapshots:\n\n", g_context_buf.snapshot_count);

    if (g_context_buf.snapshot_count > 0) {
        // Calculate starting point for chronological order
        uint8_t start_idx = (g_context_buf.snapshot_count < MAX_SNAPSHOTS)
                            ? 0
                            : g_context_buf.snapshot_index;

        for (uint8_t i = 0; i < g_context_buf.snapshot_count; i++) {
            uint8_t idx = (start_idx + i) % MAX_SNAPSHOTS;
            ContextSnapshot* snap = &g_context_buf.snapshots[idx];

            Serial.printf("[%02d] %s\n", i + 1, snap->label);
            Serial.printf("     Time:      %lu ms\n", snap->timestamp_ms);
            Serial.printf("     Task:      %s (core %u)\n", snap->task_name, snap->core_id);
            Serial.printf("     Heap Free: %u bytes (%.1f KB)\n",
                         snap->free_heap_bytes, snap->free_heap_bytes / 1024.0f);
            Serial.printf("     PSRAM Free: %u bytes (%.1f KB)\n",
                         snap->free_psram_bytes, snap->free_psram_bytes / 1024.0f);
            Serial.printf("     Min Heap:  %u bytes (%.1f KB)\n",
                         snap->min_free_heap_bytes, snap->min_free_heap_bytes / 1024.0f);
            Serial.printf("     Tasks:     %u\n", snap->task_count);
            Serial.println();
        }
    } else {
        Serial.println("  (no snapshots taken yet)\n");
    }

    Serial.println("========================================\n");

    xSemaphoreGive(g_context_mutex);
}

/**
 * Print a compact summary of recent snapshots
 * Useful for quick debugging
 */
inline void debugContextPrintSummary() {
    if (!g_context_mutex) return;

    xSemaphoreTake(g_context_mutex, portMAX_DELAY);

    Serial.println("\n[CONTEXT] Recent snapshots:");

    if (g_context_buf.snapshot_count > 0) {
        // Show last 3 snapshots
        uint8_t show_count = min((uint8_t)3, g_context_buf.snapshot_count);

        for (uint8_t i = 0; i < show_count; i++) {
            // Get most recent snapshots first
            uint8_t idx = (g_context_buf.snapshot_index - 1 - i + MAX_SNAPSHOTS) % MAX_SNAPSHOTS;

            // Make sure we don't go beyond valid data
            if (i >= g_context_buf.snapshot_count) break;

            ContextSnapshot* snap = &g_context_buf.snapshots[idx];

            Serial.printf("  %lu ms: %s [Heap: %.1f KB]\n",
                         snap->timestamp_ms,
                         snap->label,
                         snap->free_heap_bytes / 1024.0f);
        }
    } else {
        Serial.println("  (no snapshots)");
    }

    Serial.println();

    xSemaphoreGive(g_context_mutex);
}

/**
 * Get the most recent snapshot
 *
 * @param snap Pointer to ContextSnapshot to fill
 * @return true if snapshot available, false if buffer empty
 */
inline bool debugContextGetLatest(ContextSnapshot* snap) {
    if (!g_context_mutex || !snap) return false;

    bool available = false;

    xSemaphoreTake(g_context_mutex, portMAX_DELAY);

    if (g_context_buf.snapshot_count > 0) {
        uint8_t latest_idx = (g_context_buf.snapshot_index - 1 + MAX_SNAPSHOTS) % MAX_SNAPSHOTS;
        memcpy(snap, &g_context_buf.snapshots[latest_idx], sizeof(ContextSnapshot));
        available = true;
    }

    xSemaphoreGive(g_context_mutex);

    return available;
}

/**
 * Detect memory drops between snapshots
 * Returns true if significant heap decrease detected
 *
 * @param threshold_bytes Threshold for "significant" drop (default 10KB)
 * @return true if memory drop detected
 */
inline bool debugContextDetectMemoryDrop(uint32_t threshold_bytes = 10240) {
    if (!g_context_mutex) return false;

    bool drop_detected = false;

    xSemaphoreTake(g_context_mutex, portMAX_DELAY);

    if (g_context_buf.snapshot_count >= 2) {
        // Compare latest two snapshots
        uint8_t latest_idx = (g_context_buf.snapshot_index - 1 + MAX_SNAPSHOTS) % MAX_SNAPSHOTS;
        uint8_t previous_idx = (g_context_buf.snapshot_index - 2 + MAX_SNAPSHOTS) % MAX_SNAPSHOTS;

        ContextSnapshot* latest = &g_context_buf.snapshots[latest_idx];
        ContextSnapshot* previous = &g_context_buf.snapshots[previous_idx];

        if (previous->free_heap_bytes > latest->free_heap_bytes) {
            uint32_t drop = previous->free_heap_bytes - latest->free_heap_bytes;

            if (drop >= threshold_bytes) {
                Serial.printf("[CONTEXT] ⚠️  Memory drop detected: %u bytes (%.1f KB)\n",
                             drop, drop / 1024.0f);
                Serial.printf("  Previous: %s (%.1f KB free)\n",
                             previous->label, previous->free_heap_bytes / 1024.0f);
                Serial.printf("  Latest:   %s (%.1f KB free)\n",
                             latest->label, latest->free_heap_bytes / 1024.0f);
                drop_detected = true;
            }
        }
    }

    xSemaphoreGive(g_context_mutex);

    return drop_detected;
}

/**
 * Clear all snapshots
 * Useful for starting fresh after debugging
 */
inline void debugContextClear() {
    if (!g_context_mutex) return;

    xSemaphoreTake(g_context_mutex, portMAX_DELAY);

    uint32_t magic = g_context_buf.magic;
    uint32_t total = g_context_buf.total_snapshots_taken;

    memset(&g_context_buf, 0, sizeof(g_context_buf));
    g_context_buf.magic = magic;
    g_context_buf.total_snapshots_taken = total;

    xSemaphoreGive(g_context_mutex);

    Serial.println("[CONTEXT] Snapshot buffer cleared");
}

// Define global variables (must be defined in .ino or .cpp file)
// Add this to your .ino file:
// RTC_DATA_ATTR ContextBuffer g_context_buf = {0};
// SemaphoreHandle_t g_context_mutex = NULL;
// bool g_context_initialized = false;

#endif // DEBUG_CONTEXT_H

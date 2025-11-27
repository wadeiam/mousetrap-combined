/*
 * debug_tasks.h
 *
 * FreeRTOS Task Stack Monitoring for ESP32-S3
 *
 * Monitors stack usage for all FreeRTOS tasks to detect stack overflow
 * before it causes a crash. Tracks SensorTask, HeartbeatTask, and other tasks.
 *
 * Usage:
 *   1. Call debugTasksInit() during setup
 *   2. Call debugTasksRegister() for each task after creation
 *   3. Call debugTasksMonitor() periodically (e.g., every 10 seconds)
 *   4. Use debugTasksPrintStats() to view statistics
 *
 * Thread-safe: Yes (uses FreeRTOS API which is thread-safe)
 * Overhead: Minimal (~0.1% CPU when called periodically)
 */

#ifndef DEBUG_TASKS_H
#define DEBUG_TASKS_H

#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// Maximum number of tasks to track
#define MAX_TRACKED_TASKS 10

// Task statistics structure
typedef struct {
    TaskHandle_t handle;               // FreeRTOS task handle
    char name[16];                     // Task name
    uint32_t stack_size;               // Total stack size in bytes
    uint32_t stack_high_water_mark;    // Minimum free stack ever (bytes)
    float usage_percentage;            // Current stack usage (0-100%)
    uint32_t peak_usage_percentage;    // Peak stack usage ever seen
    bool overflow_warning;             // True if usage > 80%
    unsigned long last_check_ms;       // Timestamp of last check
    UBaseType_t priority;              // Task priority
    eTaskState state;                  // Current task state
} TaskStats;

// Global task tracking
extern TaskStats g_task_stats[MAX_TRACKED_TASKS];
extern uint8_t g_task_count;
extern SemaphoreHandle_t g_task_mutex;

// Configuration
#define TASK_USAGE_WARNING_THRESHOLD 80  // Warn if stack usage > 80%
#define TASK_USAGE_CRITICAL_THRESHOLD 95 // Critical if stack usage > 95%

/**
 * Initialize the task monitoring system
 * Call this once during setup()
 */
inline void debugTasksInit() {
    memset(g_task_stats, 0, sizeof(g_task_stats));
    g_task_count = 0;
    g_task_mutex = xSemaphoreCreateMutex();

    Serial.println("[TASK-DEBUG] Task stack monitoring initialized");
}

/**
 * Register a task for monitoring
 * Call after creating each FreeRTOS task
 *
 * @param handle Task handle returned by xTaskCreate
 * @param name Task name for logging
 * @param stack_size Stack size in bytes (same as xTaskCreate)
 * @return true if registered successfully, false if tracking array full
 */
inline bool debugTasksRegister(TaskHandle_t handle, const char* name, uint32_t stack_size) {
    if (!g_task_mutex || g_task_count >= MAX_TRACKED_TASKS) {
        Serial.println("[TASK-ERROR] Cannot register task - tracking array full");
        return false;
    }

    xSemaphoreTake(g_task_mutex, portMAX_DELAY);

    TaskStats* task = &g_task_stats[g_task_count];
    task->handle = handle;
    strncpy(task->name, name, sizeof(task->name) - 1);
    task->name[sizeof(task->name) - 1] = '\0';
    task->stack_size = stack_size;
    task->overflow_warning = false;
    task->priority = uxTaskPriorityGet(handle);

    g_task_count++;

    xSemaphoreGive(g_task_mutex);

    Serial.printf("[TASK-DEBUG] Registered task '%s' (stack: %u bytes)\n",
                  name, stack_size);

    return true;
}

/**
 * Get task state as a readable string
 */
inline const char* debugTasksGetStateName(eTaskState state) {
    switch (state) {
        case eRunning:   return "Running";
        case eReady:     return "Ready";
        case eBlocked:   return "Blocked";
        case eSuspended: return "Suspended";
        case eDeleted:   return "Deleted";
        default:         return "Unknown";
    }
}

/**
 * Monitor all registered tasks and update statistics
 * Call this periodically (e.g., every 10 seconds)
 *
 * @return true if all tasks healthy, false if any warnings
 */
inline bool debugTasksMonitor() {
    if (!g_task_mutex) return true;

    bool all_healthy = true;

    xSemaphoreTake(g_task_mutex, portMAX_DELAY);

    for (uint8_t i = 0; i < g_task_count; i++) {
        TaskStats* task = &g_task_stats[i];

        // Get current stack high water mark (minimum free stack)
        // Note: uxTaskGetStackHighWaterMark returns in words (4 bytes on ESP32)
        UBaseType_t hwm_words = uxTaskGetStackHighWaterMark(task->handle);
        task->stack_high_water_mark = hwm_words * 4;  // Convert to bytes

        // Calculate usage percentage
        uint32_t used_bytes = task->stack_size - task->stack_high_water_mark;
        task->usage_percentage = (100.0f * used_bytes) / task->stack_size;

        // Track peak usage
        if (task->usage_percentage > task->peak_usage_percentage) {
            task->peak_usage_percentage = task->usage_percentage;
        }

        // Get task state
        task->state = eTaskGetState(task->handle);

        // Update timestamp
        task->last_check_ms = millis();

        // Check for overflow warning
        if (task->usage_percentage >= TASK_USAGE_CRITICAL_THRESHOLD) {
            Serial.printf("[TASK-CRITICAL] ⚠️  %s: CRITICAL stack usage %.1f%% (%u/%u bytes)\n",
                         task->name, task->usage_percentage, used_bytes, task->stack_size);
            task->overflow_warning = true;
            all_healthy = false;
        } else if (task->usage_percentage >= TASK_USAGE_WARNING_THRESHOLD) {
            if (!task->overflow_warning) {  // Only warn once
                Serial.printf("[TASK-WARN] %s: High stack usage %.1f%% (%u/%u bytes)\n",
                             task->name, task->usage_percentage, used_bytes, task->stack_size);
                task->overflow_warning = true;
            }
            all_healthy = false;
        } else {
            task->overflow_warning = false;
        }
    }

    xSemaphoreGive(g_task_mutex);

    return all_healthy;
}

/**
 * Print comprehensive task statistics
 * Safe to call from any task
 */
inline void debugTasksPrintStats() {
    if (!g_task_mutex) return;

    xSemaphoreTake(g_task_mutex, portMAX_DELAY);

    Serial.println("\n========== TASK STATISTICS ==========");
    Serial.printf("Tracking %u tasks:\n\n", g_task_count);

    for (uint8_t i = 0; i < g_task_count; i++) {
        TaskStats* task = &g_task_stats[i];

        uint32_t used_bytes = task->stack_size - task->stack_high_water_mark;

        Serial.printf("--- %s ---\n", task->name);
        Serial.printf("Stack Size:        %u bytes\n", task->stack_size);
        Serial.printf("Stack Used:        %u bytes (%.1f%%)\n",
                     used_bytes, task->usage_percentage);
        Serial.printf("Stack Free (HWM):  %u bytes\n", task->stack_high_water_mark);
        Serial.printf("Peak Usage:        %.1f%%\n", task->peak_usage_percentage);
        Serial.printf("Priority:          %u\n", task->priority);
        Serial.printf("State:             %s\n", debugTasksGetStateName(task->state));

        if (task->overflow_warning) {
            Serial.println("Status:            ⚠️  WARNING - High usage!");
        } else {
            Serial.println("Status:            ✓ Healthy");
        }

        Serial.println();
    }

    // Print system-wide task info
    Serial.println("--- System Tasks ---");
    Serial.printf("Number of tasks:   %u\n", uxTaskGetNumberOfTasks());

    xSemaphoreGive(g_task_mutex);

    Serial.println("====================================\n");
}

/**
 * Get statistics for a specific task by name
 *
 * @param name Task name to search for
 * @param stats Pointer to TaskStats structure to fill
 * @return true if task found, false otherwise
 */
inline bool debugTasksGetStats(const char* name, TaskStats* stats) {
    if (!g_task_mutex || !stats) return false;

    bool found = false;

    xSemaphoreTake(g_task_mutex, portMAX_DELAY);

    for (uint8_t i = 0; i < g_task_count; i++) {
        if (strcmp(g_task_stats[i].name, name) == 0) {
            memcpy(stats, &g_task_stats[i], sizeof(TaskStats));
            found = true;
            break;
        }
    }

    xSemaphoreGive(g_task_mutex);

    return found;
}

/**
 * Print a compact one-line summary of all tasks
 * Useful for periodic logging
 */
inline void debugTasksPrintSummary() {
    if (!g_task_mutex) return;

    xSemaphoreTake(g_task_mutex, portMAX_DELAY);

    Serial.print("[TASK-SUMMARY] ");
    for (uint8_t i = 0; i < g_task_count; i++) {
        Serial.printf("%s:%.0f%% ",
                     g_task_stats[i].name,
                     g_task_stats[i].usage_percentage);
    }
    Serial.println();

    xSemaphoreGive(g_task_mutex);
}

/**
 * Check if a specific task exists and is not deleted
 *
 * @param name Task name to check
 * @return true if task exists and is active
 */
inline bool debugTasksIsAlive(const char* name) {
    if (!g_task_mutex) return false;

    bool alive = false;

    xSemaphoreTake(g_task_mutex, portMAX_DELAY);

    for (uint8_t i = 0; i < g_task_count; i++) {
        if (strcmp(g_task_stats[i].name, name) == 0) {
            alive = (g_task_stats[i].state != eDeleted);
            break;
        }
    }

    xSemaphoreGive(g_task_mutex);

    return alive;
}

// Define global variables (must be defined in .ino or .cpp file)
// Add this to your .ino file:
// TaskStats g_task_stats[MAX_TRACKED_TASKS] = {0};
// uint8_t g_task_count = 0;
// SemaphoreHandle_t g_task_mutex = NULL;

#endif // DEBUG_TASKS_H

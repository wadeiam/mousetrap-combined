// Global Svelte stores for shared state

import { writable, derived } from 'svelte/store';
import * as api from './api.js';

// ============================================================================
// Device Status (polled from /status endpoint)
// ============================================================================

export const deviceStatus = writable({
  threshold: 0,
  sensorReading: 0,
  detectionState: false,
  uptime: '',
  wifiRSSI: 0,
  heap: 0,
  psram: 0,
  lastUpdate: null,
});

// ============================================================================
// UI State
// ============================================================================

export const menuOpen = writable(false);

export const loading = writable(false);

export const error = writable(null); // { message: string, details?: any }

// ============================================================================
// User Preferences (localStorage)
// ============================================================================

function createLocalStore(key, initialValue) {
  const stored = localStorage.getItem(key);
  const initial = stored ? JSON.parse(stored) : initialValue;

  const { subscribe, set, update } = writable(initial);

  return {
    subscribe,
    set: (value) => {
      localStorage.setItem(key, JSON.stringify(value));
      set(value);
    },
    update: (fn) => {
      update((current) => {
        const newValue = fn(current);
        localStorage.setItem(key, JSON.stringify(newValue));
        return newValue;
      });
    },
  };
}

export const userPrefs = createLocalStore('mousetrap-prefs', {
  theme: 'dark', // future: light/dark toggle
  refreshInterval: 5000, // ms for auto-refresh on dashboard
});

// ============================================================================
// Derived Stores
// ============================================================================

export const isDetectionActive = derived(
  deviceStatus,
  ($status) => $status.detectionState
);

export const statusColor = derived(
  deviceStatus,
  ($status) => {
    if (!$status.lastUpdate) return 'gray';
    if ($status.detectionState) return 'red';
    return 'green';
  }
);

// ============================================================================
// Device Type (scout vs trap)
// ============================================================================

// Writable store holding the device type reported by the firmware.
// null = unknown (default to trap-compatible behavior so nothing breaks).
export const deviceType = writable(null);

// Convenience derived stores for template conditions.
export const isScout = derived(deviceType, ($t) => $t === 'scout');
export const isTrap = derived(deviceType, ($t) => $t === 'trap');

/**
 * Fetch device type from /api/device/claim-status and populate the store.
 * Errors are swallowed: if the device can't respond, deviceType remains null
 * and the UI falls back to showing everything (trap-compatible default).
 */
export async function initDeviceType() {
  try {
    const response = await api.getClaimStatus();
    const type = (response && response.deviceType) || null;
    deviceType.set(type);
    return type;
  } catch (err) {
    // Silently ignore - leave deviceType as null
    return null;
  }
}

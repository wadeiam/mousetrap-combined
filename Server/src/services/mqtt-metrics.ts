// Shared MQTT metrics counters — incremented by mqtt.service.ts, read by diagnostics.routes.ts
export const mqttMetrics = {
  staleMessagesCleared: 0,
  deviceNotFoundErrors: 0,
  messagesReceived: 0,
  lastReset: Date.now(),
};

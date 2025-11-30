import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { api } from '../services/api';
import { Device } from '../types';

type RouteParams = {
  DeviceDetail: {
    deviceId: string;
    deviceName?: string;
  };
};

export function DeviceDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'DeviceDetail'>>();
  const { deviceId, deviceName } = route.params;

  const [device, setDevice] = useState<Device | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRequestingSnapshot, setIsRequestingSnapshot] = useState(false);
  const [snapshotImage, setSnapshotImage] = useState<string | null>(null);
  const [snapshotTimestamp, setSnapshotTimestamp] = useState<number | null>(null);
  const [isClearingAlerts, setIsClearingAlerts] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);

  const fetchDevice = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    const result = await api.getDevice(deviceId);
    if (result.success && result.data) {
      setDevice(result.data);
      // Load existing snapshot if available
      if (result.data.last_snapshot) {
        setSnapshotImage(result.data.last_snapshot);
        setSnapshotTimestamp(result.data.last_snapshot_timestamp || null);
      }
    }

    setIsLoading(false);
    setIsRefreshing(false);
  };

  const handleRequestSnapshot = async () => {
    if (!device) return;

    if (device.status === 'offline') {
      Alert.alert('Device Offline', 'Cannot request snapshot from an offline device');
      return;
    }

    setIsRequestingSnapshot(true);

    const result = await api.requestSnapshot(deviceId);

    if (result.success) {
      // Poll for the snapshot a few times
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const deviceResult = await api.getDevice(deviceId);
        if (deviceResult.success && deviceResult.data) {
          const newSnapshot = deviceResult.data.last_snapshot;
          const newTimestamp = deviceResult.data.last_snapshot_timestamp;

          // Check if we got a new snapshot
          if (newSnapshot && newTimestamp && newTimestamp !== snapshotTimestamp) {
            setSnapshotImage(newSnapshot);
            setSnapshotTimestamp(newTimestamp);
            setDevice(deviceResult.data);
            clearInterval(pollInterval);
            setIsRequestingSnapshot(false);
          }
        }

        // Stop polling after 10 attempts (10 seconds)
        if (attempts >= 10) {
          clearInterval(pollInterval);
          setIsRequestingSnapshot(false);
        }
      }, 1000);
    } else {
      Alert.alert('Error', result.error || 'Failed to request snapshot');
      setIsRequestingSnapshot(false);
    }
  };

  const handleClearAlerts = async () => {
    if (!device) return;

    Alert.alert(
      'Clear Alerts',
      `Are you sure you want to clear all alerts for ${device.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setIsClearingAlerts(true);
            const result = await api.clearAlerts(deviceId);
            setIsClearingAlerts(false);

            if (result.success) {
              Alert.alert('Success', result.data?.message || 'Alerts cleared');
              fetchDevice(); // Refresh device state
            } else {
              Alert.alert('Error', result.error || 'Failed to clear alerts');
            }
          },
        },
      ]
    );
  };

  const handleTriggerTestAlert = async () => {
    if (!device) return;

    Alert.alert(
      'Trigger Test Alert',
      `This will create a test alert for ${device.name} and send notifications to all emergency contacts. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trigger',
          onPress: async () => {
            setIsTriggering(true);
            const result = await api.triggerTestAlert(deviceId);
            setIsTriggering(false);

            if (result.success) {
              Alert.alert('Test Alert Sent', result.data?.message || 'Test alert created');
              fetchDevice(); // Refresh device state
            } else {
              Alert.alert('Error', result.error || 'Failed to trigger test alert');
            }
          },
        },
      ]
    );
  };

  useFocusEffect(
    useCallback(() => {
      fetchDevice();
    }, [deviceId])
  );

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: deviceName || 'Device Details',
    });
  }, [navigation, deviceName]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return '#4caf50';
      case 'offline':
        return '#f44336';
      case 'alerting':
        return '#ff9800';
      default:
        return '#9e9e9e';
    }
  };

  const formatUptime = (seconds: number | null | undefined) => {
    if (!seconds) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatSignalStrength = (rssi: number | null | undefined) => {
    if (rssi === null || rssi === undefined) return 'N/A';
    if (rssi > -50) return `Excellent (${rssi} dBm)`;
    if (rssi > -60) return `Good (${rssi} dBm)`;
    if (rssi > -70) return `Fair (${rssi} dBm)`;
    return `Weak (${rssi} dBm)`;
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0f4c75" />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Device not found</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => fetchDevice()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => fetchDevice(true)}
          tintColor="#0f4c75"
        />
      }
    >
      {/* Status Card */}
      <View style={styles.card}>
        <View style={styles.statusHeader}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(device.status) }]}>
            <Text style={styles.statusText}>{device.status}</Text>
          </View>
          {device.trap_state && (
            <View style={styles.trapBadge}>
              <Text style={styles.trapText}>
                {device.trap_state === 'triggered' ? '🚨 Triggered' : '✅ Set'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.deviceName}>{device.name}</Text>
        <Text style={styles.deviceMac}>{device.mac_address}</Text>
        {device.location && (
          <Text style={styles.deviceLocation}>📍 {device.location}</Text>
        )}
      </View>

      {/* Camera Snapshot Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Camera Snapshot</Text>
          <TouchableOpacity
            style={[
              styles.snapshotButton,
              (device.status === 'offline' || isRequestingSnapshot) && styles.snapshotButtonDisabled
            ]}
            onPress={handleRequestSnapshot}
            disabled={device.status === 'offline' || isRequestingSnapshot}
          >
            {isRequestingSnapshot ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.snapshotButtonText}>Request Snapshot</Text>
            )}
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {snapshotImage ? (
            <View style={styles.snapshotContainer}>
              <View style={styles.snapshotImageWrapper}>
                <Image
                  source={{ uri: `data:image/jpeg;base64,${snapshotImage}` }}
                  style={styles.snapshotImage}
                  resizeMode="contain"
                />
                {snapshotTimestamp && (() => {
                  const ageMs = Date.now() - snapshotTimestamp;
                  const ageMinutes = Math.floor(ageMs / 60000);
                  const isStale = ageMinutes >= 2; // Consider stale after 2 minutes

                  if (isStale) {
                    let ageText: string;
                    if (ageMinutes < 60) {
                      ageText = `${ageMinutes} min ago`;
                    } else if (ageMinutes < 1440) {
                      const hours = Math.floor(ageMinutes / 60);
                      ageText = `${hours} hour${hours > 1 ? 's' : ''} ago`;
                    } else {
                      const days = Math.floor(ageMinutes / 1440);
                      ageText = `${days} day${days > 1 ? 's' : ''} ago`;
                    }

                    return (
                      <View style={styles.staleOverlay}>
                        <Text style={styles.staleText}>{ageText}</Text>
                      </View>
                    );
                  }
                  return null;
                })()}
              </View>
              {snapshotTimestamp && (() => {
                const date = new Date(snapshotTimestamp);
                const pad = (n: number) => n.toString().padStart(2, '0');
                const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
                return (
                  <Text style={styles.snapshotTimestamp}>
                    Captured: {dateStr} {timeStr}
                  </Text>
                );
              })()}
            </View>
          ) : (
            <View style={styles.noSnapshotContainer}>
              <Text style={styles.noSnapshotIcon}>📷</Text>
              <Text style={styles.noSnapshotText}>No snapshot available</Text>
              <Text style={styles.noSnapshotHint}>
                {device.status === 'offline'
                  ? 'Device is offline'
                  : 'Tap "Request Snapshot" to capture an image'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Network Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Network</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Signal Strength</Text>
            <Text style={styles.infoValue}>{formatSignalStrength(device.rssi)}</Text>
          </View>
          {device.ip_address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>IP Address</Text>
              <Text style={[styles.infoValue, styles.mono]}>{device.ip_address}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Device Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Device Info</Text>
        <View style={styles.card}>
          {device.firmware_version && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Firmware</Text>
              <Text style={styles.infoValue}>{device.firmware_version}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Uptime</Text>
            <Text style={styles.infoValue}>{formatUptime(device.uptime)}</Text>
          </View>
          {device.battery_level !== null && device.battery_level !== undefined && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Battery</Text>
              <Text style={[
                styles.infoValue,
                device.battery_level < 20 && styles.lowValue
              ]}>
                🔋 {device.battery_level}%
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Timestamps */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity</Text>
        <View style={styles.card}>
          {device.last_seen_at && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Last Seen</Text>
              <Text style={styles.infoValue}>
                {new Date(device.last_seen_at).toLocaleString()}
              </Text>
            </View>
          )}
          {device.created_at && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Registered</Text>
              <Text style={styles.infoValue}>
                {new Date(device.created_at).toLocaleDateString()}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions</Text>
        <View style={styles.card}>
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={[styles.actionButton, styles.clearButton, isClearingAlerts && styles.actionButtonDisabled]}
              onPress={handleClearAlerts}
              disabled={isClearingAlerts}
            >
              {isClearingAlerts ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.actionButtonIcon}>🔕</Text>
                  <Text style={styles.actionButtonText}>Clear Alerts</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.testButton,
                (device.status === 'offline' || isTriggering) && styles.actionButtonDisabled
              ]}
              onPress={handleTriggerTestAlert}
              disabled={device.status === 'offline' || isTriggering}
            >
              {isTriggering ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.actionButtonIcon}>🔔</Text>
                  <Text style={styles.actionButtonText}>Test Alert</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          {device.status === 'offline' && (
            <Text style={styles.actionHint}>Device must be online to trigger test alerts</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  errorText: {
    color: '#f44336',
    fontSize: 16,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#0f4c75',
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  trapBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
  },
  trapText: {
    color: '#fff',
    fontSize: 12,
  },
  deviceName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  deviceMac: {
    fontSize: 14,
    color: '#888',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8,
  },
  deviceLocation: {
    fontSize: 14,
    color: '#aaa',
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  snapshotButton: {
    backgroundColor: '#0f4c75',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 140,
    alignItems: 'center',
  },
  snapshotButtonDisabled: {
    backgroundColor: '#555',
    opacity: 0.6,
  },
  snapshotButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  snapshotContainer: {
    alignItems: 'center',
  },
  snapshotImageWrapper: {
    width: '100%',
    position: 'relative',
  },
  snapshotImage: {
    width: '100%',
    height: 240,
    borderRadius: 8,
    backgroundColor: '#1a1a2e',
  },
  staleOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  staleText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  snapshotTimestamp: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
    textAlign: 'center',
  },
  noSnapshotContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noSnapshotIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  noSnapshotText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
    marginBottom: 8,
  },
  noSnapshotHint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a5a',
  },
  infoLabel: {
    fontSize: 14,
    color: '#888',
  },
  infoValue: {
    fontSize: 14,
    color: '#fff',
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  lowValue: {
    color: '#f44336',
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 8,
  },
  clearButton: {
    backgroundColor: '#6c757d',
  },
  testButton: {
    backgroundColor: '#ff9800',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonIcon: {
    fontSize: 18,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  actionHint: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 12,
  },
});

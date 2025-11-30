import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../services/api';
import { Device } from '../types';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function DevicesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchDevices = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    const result = await api.getDevices();
    if (result.success && result.data) {
      setDevices(result.data);
    }

    setIsLoading(false);
    setIsRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      fetchDevices();
    }, [])
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return '#4caf50';
      case 'offline':
        return '#f44336';
      default:
        return '#9e9e9e';
    }
  };

  const getTrapStateIcon = (state: string) => {
    switch (state) {
      case 'triggered':
        return '🚨';
      case 'set':
        return '✅';
      default:
        return '❓';
    }
  };

  const handleDevicePress = (device: Device) => {
    navigation.navigate('DeviceDetail', {
      deviceId: device.id,
      deviceName: device.name,
    });
  };

  const renderDevice = ({ item }: { item: Device }) => (
    <TouchableOpacity
      style={styles.deviceCard}
      onPress={() => handleDevicePress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.deviceHeader}>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMac}>{item.mac_address}</Text>
        </View>
        <View style={styles.statusContainer}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>

      <View style={styles.deviceStats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Trap</Text>
          <Text style={styles.statValue}>{getTrapStateIcon(item.trap_state)} {item.trap_state}</Text>
        </View>

        {item.battery_level !== null && (
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Battery</Text>
            <Text style={[
              styles.statValue,
              item.battery_level < 20 && styles.lowBattery
            ]}>
              🔋 {item.battery_level}%
            </Text>
          </View>
        )}

        {item.last_seen_at && (
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Last Seen</Text>
            <Text style={styles.statValue}>
              {new Date(item.last_seen_at).toLocaleTimeString()}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0f4c75" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={devices}
        renderItem={renderDevice}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchDevices(true)}
            tintColor="#0f4c75"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🪤</Text>
            <Text style={styles.emptyText}>No devices found</Text>
            <Text style={styles.emptySubtext}>
              Add devices through the web dashboard
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  list: {
    padding: 16,
  },
  deviceCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a5a',
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  deviceMac: {
    fontSize: 12,
    color: '#888',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#fff',
    textTransform: 'capitalize',
  },
  deviceStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 14,
    color: '#fff',
  },
  lowBattery: {
    color: '#f44336',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#888',
  },
});

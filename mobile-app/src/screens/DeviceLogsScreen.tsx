import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { api } from '../services/api';

type RouteParams = {
  DeviceLogs: {
    deviceId: string;
    deviceName?: string;
  };
};

type LogType = 'system' | 'previous' | 'older' | 'access';

const LOG_TABS: { key: LogType; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'previous', label: 'Previous' },
  { key: 'older', label: 'Older' },
  { key: 'access', label: 'Access' },
];

export function DeviceLogsScreen() {
  const route = useRoute<RouteProp<RouteParams, 'DeviceLogs'>>();
  const { deviceId } = route.params;

  const [activeTab, setActiveTab] = useState<LogType>('system');
  const [logs, setLogs] = useState<Record<LogType, string[] | null>>({
    system: null,
    previous: null,
    older: null,
    access: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const fetchLogs = useCallback(async (logType: LogType, refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    const result = await api.getDeviceLogs(deviceId, logType);
    if (result.success && result.data) {
      const lines = Array.isArray(result.data) ? result.data : [String(result.data)];
      setLogs(prev => ({ ...prev, [logType]: lines }));
    } else {
      setError(result.error || 'Failed to fetch logs');
      setLogs(prev => ({ ...prev, [logType]: null }));
    }

    setIsLoading(false);
    setIsRefreshing(false);
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      fetchLogs(activeTab);
    }, [fetchLogs, activeTab])
  );

  const handleTabChange = (tab: LogType) => {
    setActiveTab(tab);
    setFilter('');
    if (!logs[tab]) {
      fetchLogs(tab);
    }
  };

  const currentLogs = logs[activeTab];
  const filteredLogs = currentLogs
    ? filter
      ? currentLogs.filter(line => line.toLowerCase().includes(filter.toLowerCase()))
      : currentLogs
    : null;

  return (
    <View style={styles.container}>
      {/* Segmented Control */}
      <View style={styles.segmentedControl}>
        {LOG_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.segment, activeTab === tab.key && styles.segmentActive]}
            onPress={() => handleTabChange(tab.key)}
          >
            <Text style={[styles.segmentText, activeTab === tab.key && styles.segmentTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Filter */}
      <View style={styles.filterContainer}>
        <TextInput
          style={styles.filterInput}
          placeholder="Filter logs..."
          placeholderTextColor="#666"
          value={filter}
          onChangeText={setFilter}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Log Content */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0f4c75" />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => fetchLogs(activeTab)}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filteredLogs && filteredLogs.length > 0 ? (
        <ScrollView
          style={styles.logScroll}
          contentContainerStyle={styles.logContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => fetchLogs(activeTab, true)}
              tintColor="#0f4c75"
            />
          }
        >
          {filteredLogs.map((line, i) => (
            <Text key={i} style={styles.logLine}>{line}</Text>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>
            {filter ? 'No matching log lines' : 'No logs available'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  segmentedControl: {
    flexDirection: 'row',
    margin: 12,
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: '#0f4c75',
  },
  segmentText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#fff',
  },
  filterContainer: {
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  filterInput: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#2a2a5a',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#f44336',
    fontSize: 15,
    marginBottom: 16,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#0f4c75',
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    padding: 12,
  },
  logLine: {
    color: '#ddd',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
    paddingVertical: 1,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    color: '#888',
    fontSize: 15,
  },
});

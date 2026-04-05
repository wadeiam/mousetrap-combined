import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { api } from '../services/api';

type RouteParams = {
  ConnectivityHistory: {
    deviceId: string;
    deviceName?: string;
  };
};

interface ConnectivityEvent {
  id: number;
  event: 'online' | 'offline';
  createdAt: string;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

export function ConnectivityHistoryScreen() {
  const route = useRoute<RouteProp<RouteParams, 'ConnectivityHistory'>>();
  const { deviceId } = route.params;

  const [events, setEvents] = useState<ConnectivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    const result = await api.getDeviceConnectivity(deviceId);
    if (result.success && result.data) {
      setEvents(result.data as ConnectivityEvent[]);
    } else {
      setError(result.error || 'Failed to load connectivity history');
    }

    setIsLoading(false);
    setIsRefreshing(false);
  }, [deviceId]);

  useFocusEffect(
    useCallback(() => {
      fetchEvents();
    }, [fetchEvents])
  );

  const renderEvent = ({ item, index }: { item: ConnectivityEvent; index: number }) => {
    const isOnline = item.event === 'online';
    const timestamp = new Date(item.createdAt);

    // Calculate duration until next event (previous in list = newer)
    let duration: string | null = null;
    if (index > 0) {
      const nextEvent = events[index - 1];
      const nextTimestamp = new Date(nextEvent.createdAt);
      const diff = nextTimestamp.getTime() - timestamp.getTime();
      if (diff > 0) {
        duration = `${isOnline ? 'Online' : 'Offline'} for ${formatDuration(diff)}`;
      }
    } else if (index === 0 && isOnline) {
      // Most recent event and it's online — show duration since then
      const diff = Date.now() - timestamp.getTime();
      duration = `Online for ${formatDuration(diff)}`;
    }

    return (
      <View style={styles.eventRow}>
        <View style={styles.eventLeft}>
          <View style={[styles.dot, isOnline ? styles.dotOnline : styles.dotOffline]} />
          <View>
            <Text style={styles.eventText}>{isOnline ? 'Online' : 'Offline'}</Text>
            {duration && <Text style={styles.durationText}>{duration}</Text>}
          </View>
        </View>
        <Text style={styles.timestampText}>
          {timestamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          {'  '}
          {timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0f4c75" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={events.length === 0 ? styles.emptyContainer : styles.listContent}
      data={events}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderEvent}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => fetchEvents(true)}
          tintColor="#0f4c75"
        />
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>No connectivity events yet</Text>
          <Text style={styles.emptyHint}>
            Events will appear here as the device goes online and offline.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  listContent: {
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#f44336',
    fontSize: 16,
  },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  eventLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotOnline: {
    backgroundColor: '#4caf50',
  },
  dotOffline: {
    backgroundColor: '#f44336',
  },
  eventText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  durationText: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  timestampText: {
    color: '#888',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyHint: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
});

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert as RNAlert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../services/api';
import { Alert } from '../types';

export function AlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');

  const fetchAlerts = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    const result = await api.getAlerts({ resolved: filter === 'resolved' });
    if (result.success && result.data) {
      setAlerts(result.data);
    }

    setIsLoading(false);
    setIsRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      fetchAlerts();
    }, [filter])
  );

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '#f44336';
      case 'high':
        return '#ff9800';
      case 'medium':
        return '#ffeb3b';
      case 'low':
        return '#4caf50';
      default:
        return '#9e9e9e';
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'trap_triggered':
        return '🪤';
      case 'offline':
        return '📵';
      case 'online':
        return '📶';
      case 'low_battery':
        return '🔋';
      default:
        return '⚠️';
    }
  };

  const handleAcknowledge = async (alert: Alert) => {
    const result = await api.acknowledgeAlert(alert.id);
    if (result.success) {
      fetchAlerts();
    } else {
      RNAlert.alert('Error', result.error || 'Failed to acknowledge alert');
    }
  };

  const handleResolve = async (alert: Alert) => {
    RNAlert.alert(
      'Resolve Alert',
      'Are you sure you want to resolve this alert?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resolve',
          onPress: async () => {
            const result = await api.resolveAlert(alert.id);
            if (result.success) {
              fetchAlerts();
            } else {
              RNAlert.alert('Error', result.error || 'Failed to resolve alert');
            }
          },
        },
      ]
    );
  };

  const renderAlert = ({ item }: { item: Alert }) => (
    <View style={[styles.alertCard, { borderLeftColor: getSeverityColor(item.severity) }]}>
      <View style={styles.alertHeader}>
        <Text style={styles.alertIcon}>{getAlertIcon(item.alert_type)}</Text>
        <View style={styles.alertInfo}>
          <Text style={styles.alertDevice}>{item.device_name}</Text>
          <Text style={styles.alertType}>
            {item.alert_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </Text>
        </View>
        <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(item.severity) }]}>
          <Text style={styles.severityText}>{item.severity}</Text>
        </View>
      </View>

      <Text style={styles.alertMessage}>{item.message}</Text>

      <View style={styles.alertFooter}>
        <Text style={styles.alertTime}>
          {new Date(item.created_at).toLocaleString()}
        </Text>

        {!item.resolved_at && (
          <View style={styles.alertActions}>
            {!item.acknowledged && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleAcknowledge(item)}
              >
                <Text style={styles.actionText}>Acknowledge</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionButton, styles.resolveButton]}
              onPress={() => handleResolve(item)}
            >
              <Text style={styles.actionText}>Resolve</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, filter === 'active' && styles.filterActive]}
          onPress={() => setFilter('active')}
        >
          <Text style={[styles.filterText, filter === 'active' && styles.filterTextActive]}>
            Active
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, filter === 'resolved' && styles.filterActive]}
          onPress={() => setFilter('resolved')}
        >
          <Text style={[styles.filterText, filter === 'resolved' && styles.filterTextActive]}>
            Resolved
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0f4c75" />
        </View>
      ) : (
        <FlatList
          data={alerts}
          renderItem={renderAlert}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => fetchAlerts(true)}
              tintColor="#0f4c75"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>✅</Text>
              <Text style={styles.emptyText}>
                No {filter} alerts
              </Text>
              <Text style={styles.emptySubtext}>
                {filter === 'active'
                  ? 'All clear! No alerts need attention.'
                  : 'No resolved alerts in history.'}
              </Text>
            </View>
          }
        />
      )}
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
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
    backgroundColor: '#16213e',
  },
  filterActive: {
    backgroundColor: '#0f4c75',
  },
  filterText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#fff',
  },
  list: {
    padding: 16,
    paddingTop: 8,
  },
  alertCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  alertInfo: {
    flex: 1,
  },
  alertDevice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  alertType: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  severityText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'uppercase',
  },
  alertMessage: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 12,
  },
  alertFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertTime: {
    fontSize: 12,
    color: '#666',
  },
  alertActions: {
    flexDirection: 'row',
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0f4c75',
    borderRadius: 6,
    marginLeft: 8,
  },
  resolveButton: {
    backgroundColor: '#4caf50',
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
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
    textAlign: 'center',
  },
});

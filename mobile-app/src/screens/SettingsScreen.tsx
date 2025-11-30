import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { notificationService } from '../services/notifications';
import { NotificationPreferences, EscalationPreset, EscalationPresetConfig, EmergencyContact, EmergencyContactType } from '../types';

// Preset descriptions for the UI
const PRESET_INFO: Record<EscalationPreset, { name: string; description: string }> = {
  relaxed: { name: 'Relaxed', description: 'Slower escalation (L4 at 8h)' },
  normal: { name: 'Normal', description: 'Balanced timing (L4 at 4h)' },
  aggressive: { name: 'Aggressive', description: 'Faster escalation (L4 at 2h)' },
  custom: { name: 'Custom', description: 'Set your own timing' },
};

const CONTACT_TYPE_INFO: Record<EmergencyContactType, { name: string; icon: keyof typeof Ionicons.glyphMap; placeholder: string }> = {
  app_user: { name: 'App User', icon: 'person', placeholder: 'User email address' },
  sms: { name: 'SMS', icon: 'chatbubble', placeholder: 'Phone number' },
  email: { name: 'Email', icon: 'mail', placeholder: 'Email address' },
};

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Escalation state
  const [escalationPreset, setEscalationPreset] = useState<EscalationPreset>('normal');
  const [criticalOverrideDnd, setCriticalOverrideDnd] = useState(true);
  const [presets, setPresets] = useState<EscalationPresetConfig[]>([]);
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [showDndWarning, setShowDndWarning] = useState(false);

  // Emergency contacts state
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactType, setNewContactType] = useState<EmergencyContactType>('sms');
  const [newContactValue, setNewContactValue] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactLevel, setNewContactLevel] = useState(4);
  const [isAddingContact, setIsAddingContact] = useState(false);

  const fetchPreferences = async () => {
    setIsLoading(true);
    const result = await api.getNotificationPreferences();
    if (result.success && result.data) {
      setPreferences(result.data);
      setEscalationPreset(result.data.escalation_preset || 'normal');
      setCriticalOverrideDnd(result.data.critical_override_dnd ?? true);
    }
    setIsLoading(false);
  };

  const fetchEscalationData = async () => {
    const [presetsResult, settingsResult, contactsResult] = await Promise.all([
      api.getEscalationPresets(),
      api.getEscalationSettings(),
      api.getEmergencyContacts(),
    ]);

    if (presetsResult.success && presetsResult.data) {
      setPresets(presetsResult.data);
    }
    if (settingsResult.success && settingsResult.data) {
      setEscalationPreset(settingsResult.data.preset || 'normal');
      setCriticalOverrideDnd(settingsResult.data.criticalOverrideDnd ?? true);
    }
    if (contactsResult.success && contactsResult.data) {
      setEmergencyContacts(contactsResult.data);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchPreferences();
      fetchEscalationData();
    }, [])
  );

  const updatePreference = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!preferences) return;

    const newPreferences = { ...preferences, [key]: value };
    setPreferences(newPreferences);

    setIsSaving(true);
    const result = await api.updateNotificationPreferences({ [key]: value });
    setIsSaving(false);

    if (!result.success) {
      // Revert on failure
      setPreferences(preferences);
      Alert.alert('Error', result.error || 'Failed to update preference');
    }
  };

  const updateEscalationPreset = async (preset: EscalationPreset) => {
    const oldPreset = escalationPreset;
    setEscalationPreset(preset);
    setShowPresetPicker(false);

    const result = await api.updateEscalationSettings({ preset });
    if (!result.success) {
      setEscalationPreset(oldPreset);
      Alert.alert('Error', result.error || 'Failed to update escalation preset');
    }
  };

  const handleDndOverrideToggle = (value: boolean) => {
    if (!value && criticalOverrideDnd) {
      // User is trying to disable DND override - show warning
      setShowDndWarning(true);
    } else {
      updateDndOverride(value);
    }
  };

  const updateDndOverride = async (value: boolean) => {
    const oldValue = criticalOverrideDnd;
    setCriticalOverrideDnd(value);
    setShowDndWarning(false);

    const result = await api.updateEscalationSettings({
      criticalOverrideDnd: value,
      dndOverrideAcknowledged: !value, // Mark as acknowledged if they disabled it
    });

    if (!result.success) {
      setCriticalOverrideDnd(oldValue);
      Alert.alert('Error', result.error || 'Failed to update setting');
    }
  };

  const handleAddContact = async () => {
    if (!newContactValue.trim()) {
      Alert.alert('Error', 'Please enter a contact value');
      return;
    }

    setIsAddingContact(true);
    const result = await api.addEmergencyContact({
      contact_type: newContactType,
      contact_value: newContactValue.trim(),
      contact_name: newContactName.trim() || undefined,
      escalation_level: newContactLevel,
    });
    setIsAddingContact(false);

    if (result.success && result.data) {
      setEmergencyContacts([...emergencyContacts, result.data]);
      setShowAddContact(false);
      setNewContactValue('');
      setNewContactName('');
      setNewContactType('sms');
      setNewContactLevel(4);
    } else {
      Alert.alert('Error', result.error || 'Failed to add contact');
    }
  };

  const handleDeleteContact = (contact: EmergencyContact) => {
    Alert.alert(
      'Delete Contact',
      `Remove ${contact.contact_name || contact.contact_value} from emergency contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await api.deleteEmergencyContact(contact.id);
            if (result.success) {
              setEmergencyContacts(emergencyContacts.filter(c => c.id !== contact.id));
            } else {
              Alert.alert('Error', result.error || 'Failed to delete contact');
            }
          },
        },
      ]
    );
  };

  const handleTestNotification = async () => {
    setIsTesting(true);
    const result = await api.sendTestNotification();
    setIsTesting(false);

    if (result.success) {
      Alert.alert(
        'Test Sent',
        `Notification sent to ${result.data?.sent || 0} device(s)`
      );
    } else {
      Alert.alert('Error', result.error || 'Failed to send test notification');
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: logout,
        },
      ]
    );
  };

  const formatMinutes = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getPresetTiming = (preset: EscalationPreset): string => {
    const config = presets.find(p => p.id === preset);
    if (!config) return '';
    return `L4 at ${formatMinutes(config.timing.level4)}`;
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0f4c75" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <View style={styles.userInfo}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {user?.name?.charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
            <View style={styles.userDetails}>
              <Text style={styles.userName}>{user?.name}</Text>
              <Text style={styles.userEmail}>{user?.email}</Text>
              <Text style={styles.userRole}>{user?.role}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Notification Preferences */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Trap Alerts</Text>
              <Text style={styles.settingDescription}>
                Notify when a trap is triggered
              </Text>
            </View>
            <Switch
              value={preferences?.trap_alerts ?? true}
              onValueChange={(value) => updatePreference('trap_alerts', value)}
              trackColor={{ false: '#767577', true: '#0f4c75' }}
              thumbColor={preferences?.trap_alerts ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Device Offline</Text>
              <Text style={styles.settingDescription}>
                Notify when a device goes offline
              </Text>
            </View>
            <Switch
              value={preferences?.device_offline ?? true}
              onValueChange={(value) => updatePreference('device_offline', value)}
              trackColor={{ false: '#767577', true: '#0f4c75' }}
              thumbColor={preferences?.device_offline ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Device Online</Text>
              <Text style={styles.settingDescription}>
                Notify when a device comes back online
              </Text>
            </View>
            <Switch
              value={preferences?.device_online ?? false}
              onValueChange={(value) => updatePreference('device_online', value)}
              trackColor={{ false: '#767577', true: '#0f4c75' }}
              thumbColor={preferences?.device_online ? '#fff' : '#f4f3f4'}
            />
          </View>

          <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Low Battery</Text>
              <Text style={styles.settingDescription}>
                Notify when battery is low
              </Text>
            </View>
            <Switch
              value={preferences?.low_battery ?? true}
              onValueChange={(value) => updatePreference('low_battery', value)}
              trackColor={{ false: '#767577', true: '#0f4c75' }}
              thumbColor={preferences?.low_battery ? '#fff' : '#f4f3f4'}
            />
          </View>
        </View>
      </View>

      {/* Escalation Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alert Escalation</Text>
        <Text style={styles.sectionSubtitle}>
          Alerts escalate over time if not acknowledged, to ensure humane treatment of trapped mice
        </Text>
        <View style={styles.card}>
          {/* Preset Selector */}
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => setShowPresetPicker(true)}
          >
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Escalation Speed</Text>
              <Text style={styles.settingDescription}>
                {PRESET_INFO[escalationPreset].name} - {getPresetTiming(escalationPreset)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#888" />
          </TouchableOpacity>

          {/* DND Override */}
          <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Override Do Not Disturb</Text>
              <Text style={styles.settingDescription}>
                Critical alerts (4+ hours) bypass quiet hours
              </Text>
            </View>
            <Switch
              value={criticalOverrideDnd}
              onValueChange={handleDndOverrideToggle}
              trackColor={{ false: '#767577', true: '#0f4c75' }}
              thumbColor={criticalOverrideDnd ? '#fff' : '#f4f3f4'}
            />
          </View>
        </View>
      </View>

      {/* Emergency Contacts */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Emergency Contacts</Text>
            <Text style={styles.sectionSubtitle}>
              Notified when alerts reach critical level (4+)
            </Text>
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddContact(true)}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {emergencyContacts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={48} color="#666" />
            <Text style={styles.emptyText}>No emergency contacts</Text>
            <Text style={styles.emptySubtext}>
              Add contacts to notify when alerts reach critical level
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {emergencyContacts.map((contact, index) => (
              <View
                key={contact.id}
                style={[
                  styles.contactRow,
                  index === emergencyContacts.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={styles.contactIcon}>
                  <Ionicons
                    name={CONTACT_TYPE_INFO[contact.contact_type].icon}
                    size={20}
                    color="#0f4c75"
                  />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>
                    {contact.contact_name || contact.contact_value}
                  </Text>
                  <Text style={styles.contactValue}>
                    {contact.contact_name ? contact.contact_value : CONTACT_TYPE_INFO[contact.contact_type].name}
                    {' '}&bull;{' '}Level {contact.escalation_level}+
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteContact(contact)}
                >
                  <Ionicons name="trash-outline" size={20} color="#f44336" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Test Notification */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test</Text>
        <TouchableOpacity
          style={[styles.button, isTesting && styles.buttonDisabled]}
          onPress={handleTestNotification}
          disabled={isTesting}
        >
          {isTesting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send Test Notification</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.button, styles.logoutButton]}
          onPress={handleLogout}
        >
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>MouseTrap Monitor v1.0.0</Text>

      {/* Preset Picker Modal */}
      <Modal
        visible={showPresetPicker}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPresetPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Escalation Speed</Text>
            <Text style={styles.modalSubtitle}>
              How quickly alerts escalate if not acknowledged
            </Text>

            {presets.map((preset) => (
              <TouchableOpacity
                key={preset.id}
                style={[
                  styles.presetOption,
                  escalationPreset === preset.id && styles.presetOptionSelected,
                ]}
                onPress={() => updateEscalationPreset(preset.id)}
              >
                <View style={styles.presetInfo}>
                  <Text style={[
                    styles.presetName,
                    escalationPreset === preset.id && styles.presetNameSelected,
                  ]}>
                    {preset.name}
                  </Text>
                  <Text style={styles.presetDescription}>{preset.description}</Text>
                  <Text style={styles.presetTiming}>
                    L2: {formatMinutes(preset.timing.level2)} | L3: {formatMinutes(preset.timing.level3)} | L4: {formatMinutes(preset.timing.level4)} | L5: {formatMinutes(preset.timing.level5)}
                  </Text>
                </View>
                {escalationPreset === preset.id && (
                  <Ionicons name="checkmark-circle" size={24} color="#0f4c75" />
                )}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowPresetPicker(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* DND Warning Modal */}
      <Modal
        visible={showDndWarning}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDndWarning(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.warningIcon}>
              <Ionicons name="warning" size={48} color="#ff9800" />
            </View>
            <Text style={styles.modalTitle}>Are You Sure?</Text>
            <Text style={styles.warningText}>
              Disabling this means you won't receive critical alerts during quiet hours.
            </Text>
            <Text style={styles.warningTextBold}>
              A trapped mouse can die in under 12 hours. Delayed response could cause suffering.
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={() => setShowDndWarning(false)}
              >
                <Text style={styles.modalButtonPrimaryText}>Keep Enabled</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => updateDndOverride(false)}
              >
                <Text style={styles.modalButtonSecondaryText}>Disable Anyway</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Contact Modal */}
      <Modal
        visible={showAddContact}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAddContact(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Emergency Contact</Text>

            {/* Contact Type Selector */}
            <Text style={styles.inputLabel}>Contact Type</Text>
            <View style={styles.typeSelector}>
              {(Object.keys(CONTACT_TYPE_INFO) as EmergencyContactType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.typeOption,
                    newContactType === type && styles.typeOptionSelected,
                  ]}
                  onPress={() => setNewContactType(type)}
                >
                  <Ionicons
                    name={CONTACT_TYPE_INFO[type].icon}
                    size={20}
                    color={newContactType === type ? '#fff' : '#888'}
                  />
                  <Text style={[
                    styles.typeOptionText,
                    newContactType === type && styles.typeOptionTextSelected,
                  ]}>
                    {CONTACT_TYPE_INFO[type].name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Contact Value */}
            <Text style={styles.inputLabel}>
              {newContactType === 'sms' ? 'Phone Number' : newContactType === 'email' ? 'Email Address' : 'User Email'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={CONTACT_TYPE_INFO[newContactType].placeholder}
              placeholderTextColor="#666"
              value={newContactValue}
              onChangeText={setNewContactValue}
              keyboardType={newContactType === 'sms' ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
            />

            {/* Contact Name */}
            <Text style={styles.inputLabel}>Display Name (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Mom, Spouse, Neighbor"
              placeholderTextColor="#666"
              value={newContactName}
              onChangeText={setNewContactName}
            />

            {/* Escalation Level */}
            <Text style={styles.inputLabel}>Notify at Level</Text>
            <View style={styles.levelSelector}>
              {[4, 5].map((level) => (
                <TouchableOpacity
                  key={level}
                  style={[
                    styles.levelOption,
                    newContactLevel === level && styles.levelOptionSelected,
                  ]}
                  onPress={() => setNewContactLevel(level)}
                >
                  <Text style={[
                    styles.levelOptionText,
                    newContactLevel === level && styles.levelOptionTextSelected,
                  ]}>
                    Level {level}+
                  </Text>
                  <Text style={styles.levelOptionSubtext}>
                    {level === 4 ? 'Critical (4+ hours)' : 'Emergency (8+ hours)'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={() => setShowAddContact(false)}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary, isAddingContact && styles.buttonDisabled]}
                onPress={handleAddContact}
                disabled={isAddingContact}
              >
                {isAddingContact ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalButtonPrimaryText}>Add Contact</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    overflow: 'hidden',
  },
  emptyCard: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  userInfo: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0f4c75',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  userEmail: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  userRole: {
    fontSize: 12,
    color: '#0f4c75',
    marginTop: 4,
    textTransform: 'capitalize',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a5a',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: '#888',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a5a',
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 2,
  },
  contactValue: {
    fontSize: 12,
    color: '#888',
  },
  deleteButton: {
    padding: 8,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0f4c75',
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#0f4c75',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#0f4c7580',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#f44336',
  },
  version: {
    textAlign: 'center',
    color: '#666',
    fontSize: 12,
    marginTop: 8,
    marginBottom: 32,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalCloseButton: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#888',
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonPrimary: {
    backgroundColor: '#0f4c75',
  },
  modalButtonSecondary: {
    backgroundColor: '#2a2a5a',
  },
  modalButtonPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonSecondaryText: {
    color: '#888',
    fontSize: 16,
  },

  // Preset picker styles
  presetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    marginBottom: 10,
  },
  presetOptionSelected: {
    borderWidth: 2,
    borderColor: '#0f4c75',
  },
  presetInfo: {
    flex: 1,
  },
  presetName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  presetNameSelected: {
    color: '#0f4c75',
  },
  presetDescription: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  presetTiming: {
    fontSize: 11,
    color: '#666',
  },

  // Warning modal styles
  warningIcon: {
    alignItems: 'center',
    marginBottom: 16,
  },
  warningText: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 12,
  },
  warningTextBold: {
    fontSize: 14,
    color: '#ff9800',
    textAlign: 'center',
    fontWeight: '600',
  },

  // Add contact modal styles
  inputLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  typeOption: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    gap: 4,
  },
  typeOptionSelected: {
    backgroundColor: '#0f4c75',
  },
  typeOptionText: {
    fontSize: 12,
    color: '#888',
  },
  typeOptionTextSelected: {
    color: '#fff',
  },
  levelSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  levelOption: {
    flex: 1,
    padding: 12,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    alignItems: 'center',
  },
  levelOptionSelected: {
    backgroundColor: '#0f4c75',
  },
  levelOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginBottom: 2,
  },
  levelOptionTextSelected: {
    color: '#fff',
  },
  levelOptionSubtext: {
    fontSize: 10,
    color: '#666',
  },
});

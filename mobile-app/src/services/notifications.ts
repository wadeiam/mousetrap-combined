import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

export interface NotificationData {
  type: string;
  alertId?: string;
  deviceId?: string;
  alertType?: string;
  severity?: string;
  [key: string]: unknown;
}

// Check if we're running in Expo Go (no native modules for notifications)
const isExpoGo = Constants.appOwnership === 'expo';

// Conditionally import expo-notifications only when not in Expo Go
let Notifications: typeof import('expo-notifications') | null = null;
let Device: typeof import('expo-device') | null = null;

if (!isExpoGo) {
  try {
    Notifications = require('expo-notifications');
    Device = require('expo-device');

    // Configure how notifications appear when app is in foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (e) {
    console.log('expo-notifications not available');
  }
}

class NotificationService {
  private pushToken: string | null = null;
  private notificationListener: any = null;
  private responseListener: any = null;

  async initialize(): Promise<string | null> {
    if (isExpoGo || !Notifications || !Device) {
      console.log('Push notifications require a development build (not Expo Go)');
      return null;
    }

    // Must be a physical device
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    // Check/request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permissions not granted');
      return null;
    }

    // Get the Expo push token
    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;

      if (!projectId) {
        console.log('EAS project ID not configured - using native token');
        const token = await Notifications.getDevicePushTokenAsync();
        this.pushToken = token.data;
      } else {
        const token = await Notifications.getExpoPushTokenAsync({
          projectId,
        });
        this.pushToken = token.data;
      }

      console.log('Push token:', this.pushToken);
    } catch (error) {
      console.error('Error getting push token:', error);
      return null;
    }

    // Configure Android channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0f4c75',
      });

      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Trap Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#f44336',
        sound: 'default',
      });
    }

    return this.pushToken;
  }

  async registerWithServer(): Promise<boolean> {
    if (!this.pushToken) {
      console.log('No push token available');
      return false;
    }

    const platform = Platform.OS as 'ios' | 'android';
    const deviceName = Device?.deviceName || `${Device?.brand} ${Device?.modelName}` || 'Unknown Device';

    const result = await api.registerPushToken(this.pushToken, platform, deviceName);

    if (result.success) {
      console.log('Push token registered with server');
      return true;
    } else {
      console.error('Failed to register push token:', result.error);
      return false;
    }
  }

  async unregisterFromServer(): Promise<void> {
    if (!this.pushToken) return;

    await api.removePushToken(this.pushToken);
    this.pushToken = null;
  }

  addNotificationReceivedListener(callback: (notification: any) => void): void {
    if (!Notifications) return;
    this.notificationListener = Notifications.addNotificationReceivedListener(callback);
  }

  addNotificationResponseListener(callback: (response: any) => void): void {
    if (!Notifications) return;
    this.responseListener = Notifications.addNotificationResponseReceivedListener(callback);
  }

  removeListeners(): void {
    if (!Notifications) return;
    if (this.notificationListener) {
      Notifications.removeNotificationSubscription(this.notificationListener);
      this.notificationListener = null;
    }
    if (this.responseListener) {
      Notifications.removeNotificationSubscription(this.responseListener);
      this.responseListener = null;
    }
  }

  getPushToken(): string | null {
    return this.pushToken;
  }

  async setBadgeCount(count: number): Promise<void> {
    if (!Notifications) return;
    await Notifications.setBadgeCountAsync(count);
  }

  async getBadgeCount(): Promise<number> {
    if (!Notifications) return 0;
    return await Notifications.getBadgeCountAsync();
  }

  async clearBadge(): Promise<void> {
    if (!Notifications) return;
    await Notifications.setBadgeCountAsync(0);
  }

  async scheduleLocalNotification(
    title: string,
    body: string,
    data?: NotificationData,
    seconds: number = 1
  ): Promise<string | null> {
    if (!Notifications) {
      console.log('Local notifications require development build');
      return null;
    }
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: data || {},
          sound: 'default',
        },
        trigger: seconds > 0 ? { seconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL } : null,
      });
      return id;
    } catch (error) {
      console.error('Error scheduling notification:', error);
      return null;
    }
  }

  async cancelAllScheduledNotifications(): Promise<void> {
    if (!Notifications) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async dismissAllNotifications(): Promise<void> {
    if (!Notifications) return;
    await Notifications.dismissAllNotificationsAsync();
  }
}

export const notificationService = new NotificationService();

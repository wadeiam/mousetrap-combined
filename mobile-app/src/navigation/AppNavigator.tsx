import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { notificationService, NotificationData } from '../services/notifications';
import { LoginScreen } from '../screens/LoginScreen';
import { DevicesScreen } from '../screens/DevicesScreen';
import { DeviceDetailScreen } from '../screens/DeviceDetailScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Main: undefined;
  Login: undefined;
  DeviceDetail: { deviceId: string; deviceName?: string };
};

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Devices: '🪤',
    Alerts: '⚠️',
    Settings: '⚙️',
  };
  return (
    <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.6 }}>
      {icons[name] || '?'}
    </Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor: '#0f4c75',
        tabBarInactiveTintColor: '#888',
        tabBarStyle: {
          backgroundColor: '#16213e',
          borderTopColor: '#2a2a5a',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
        },
        headerStyle: {
          backgroundColor: '#1a1a2e',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: '700',
        },
      })}
    >
      <Tab.Screen
        name="Devices"
        component={DevicesScreen}
        options={{ title: 'My Traps' }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{ title: 'Alerts' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  // Set up notification listeners when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    // Handle notifications received while app is in foreground
    notificationService.addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification);
      // You could show an in-app alert here
    });

    // Handle notification taps
    notificationService.addNotificationResponseListener((response) => {
      console.log('Notification tapped:', response);
      const data = response.notification.request.content.data as NotificationData;

      // Navigate based on notification type
      if (data?.type === 'alert' && data.alertId) {
        // Could navigate to specific alert detail
        console.log('Navigate to alert:', data.alertId);
      }
    });

    return () => {
      notificationService.removeListeners();
    };
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0f4c75" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="DeviceDetail"
              component={DeviceDetailScreen}
              options={{
                headerShown: true,
                headerStyle: {
                  backgroundColor: '#1a1a2e',
                },
                headerTintColor: '#fff',
                headerTitleStyle: {
                  fontWeight: '700',
                },
              }}
            />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
  },
});

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { notificationService } from '../services/notifications';
import { User, AuthState } from '../types';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Check for existing token on app start
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('authToken');
      if (token) {
        api.setToken(token);
        const result = await api.getProfile();
        if (result.success && result.data) {
          setState({
            user: result.data,
            token,
            isLoading: false,
            isAuthenticated: true,
          });

          // Initialize push notifications
          await initializePushNotifications();
          return;
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    }

    setState({
      user: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,
    });
  };

  const initializePushNotifications = async () => {
    try {
      const token = await notificationService.initialize();
      if (token) {
        await notificationService.registerWithServer();
      }
    } catch (error) {
      console.error('Failed to initialize push notifications:', error);
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true }));

    const result = await api.login(email, password);

    if (result.success && result.data) {
      setState({
        user: result.data.user,
        token: result.data.token,
        isLoading: false,
        isAuthenticated: true,
      });

      // Initialize push notifications after login
      await initializePushNotifications();

      return { success: true };
    }

    setState(prev => ({ ...prev, isLoading: false }));
    return { success: false, error: result.error };
  }, []);

  const logout = useCallback(async () => {
    try {
      // Unregister push token
      await notificationService.unregisterFromServer();
      notificationService.removeListeners();
    } catch (error) {
      console.error('Failed to unregister push token:', error);
    }

    await api.logout();
    setState({
      user: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,
    });
  }, []);

  const refreshUser = useCallback(async () => {
    const result = await api.getProfile();
    if (result.success && result.data) {
      setState(prev => ({ ...prev, user: result.data ?? null }));
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

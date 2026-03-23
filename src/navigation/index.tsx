import React, { useState, useEffect, useCallback } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, AppState } from 'react-native';

import { RootStackParamList, MainTabParamList, UserRole } from '../types';
import { Colors, Typography } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useUserProfile } from '../context/UserProfileContext';

import IssueListScreen from '../screens/IssueListScreen';
import ReportIssueScreen from '../screens/ReportIssueScreen';
import ProfileScreen from '../screens/ProfileScreen';
import IssueDetailScreen from '../screens/IssueDetailScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import ReportsScreen from '../screens/ReportsScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';

// ─── Tab bar icons ────────────────────────────────────────────────────────────

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Issues: '☰',
    Report: '＋',
    Admin: '⚙',
    Profile: '◯',
  };

  return (
    <View style={styles.tabIconContainer}>
      <Text style={[styles.tabIconText, focused && styles.tabIconFocused]}>
        {icons[label] ?? label[0]}
      </Text>
    </View>
  );
}

// ─── Bottom Tab Navigator ────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabNavigator({ userRole }: { userRole: UserRole }) {
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';
  const [openIssueCount, setOpenIssueCount] = useState<number>(0);
  const { orgId } = useUserProfile();

  // orgId comes from context — no need to re-fetch auth or profile here.
  const fetchOpenCount = useCallback(async () => {
    if (!orgId) return;
    const { count } = await supabase
      .from('issues')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('status', 'open');
    setOpenIssueCount(count ?? 0);
  }, [orgId]);

  useEffect(() => {
    fetchOpenCount();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchOpenCount();
    });
    return () => sub.remove();
  }, [fetchOpenCount]);

  return (
    <Tab.Navigator
      initialRouteName="Profile"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarIcon: ({ focused }) => (
          <TabIcon label={route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen
        name="Issues"
        component={IssueListScreen}
        options={{ tabBarBadge: openIssueCount > 0 ? openIssueCount : undefined }}
      />
      <Tab.Screen name="Report" component={ReportIssueScreen} />
      {isAdminOrManager && (
        <Tab.Screen name="Admin" component={AdminDashboardScreen} />
      )}
    </Tab.Navigator>
  );
}

// ─── Root Stack ───────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator({ userRole }: { userRole: UserRole }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main">
        {() => <MainTabNavigator userRole={userRole} />}
      </Stack.Screen>
      <Stack.Screen
        name="IssueDetail"
        component={IssueDetailScreen}
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ presentation: 'card', animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconText: {
    fontSize: 20,
    color: Colors.textMuted,
  },
  tabIconFocused: {
    color: Colors.primary,
  },
});

import React, { useState, useEffect, useCallback } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, AppState } from 'react-native';

import { RootStackParamList, MainTabParamList, UserRole } from '../types';
import { Colors, Typography } from '../constants/theme';
import { supabase } from '../lib/supabase';
import Icon from '../components/Icon';

import IssueListScreen from '../screens/IssueListScreen';
import ReportIssueScreen from '../screens/ReportIssueScreen';
import ProfileScreen from '../screens/ProfileScreen';
import IssueDetailScreen from '../screens/IssueDetailScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import ReportsScreen from '../screens/ReportsScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import ReportIncidentDetailsScreen from '../screens/ReportIncidentDetailsScreen';
import ReportIncidentReviewScreen from '../screens/ReportIncidentReviewScreen';
import ScanJoinCodeScreen from '../screens/ScanJoinCodeScreen';
import ChooseReportOrgScreen from '../screens/ChooseReportOrgScreen';
import ManageOrganisationScreen from '../screens/ManageOrganisationScreen';
import { IncidentDraftProvider } from '../context/IncidentDraftContext';
import { ReportTargetProvider } from '../context/ReportTargetContext';

// ─── Tab bar icons ────────────────────────────────────────────────────────────

const TAB_ICONS: Record<string, { active: React.ComponentProps<typeof Icon>['name']; inactive: React.ComponentProps<typeof Icon>['name'] }> = {
  Report: { active: 'add-circle', inactive: 'add-circle-outline' },
  Issues: { active: 'list', inactive: 'list-outline' },
  Admin: { active: 'settings', inactive: 'settings-outline' },
  Profile: { active: 'person-circle', inactive: 'person-circle-outline' },
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons = TAB_ICONS[label];
  return (
    <Icon
      name={focused ? icons.active : icons.inactive}
      size="lg"
      color={focused ? Colors.primary : Colors.textMuted}
    />
  );
}

// ─── Bottom Tab Navigator ────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabNavigator({ userRole }: { userRole: UserRole }) {
  const isAdminOrManager = userRole === 'officer_admin' || userRole === 'supervisor';
  const [openIssueCount, setOpenIssueCount] = useState<number>(0);

  const fetchOpenCount = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single();
    if (!profile?.org_id) return;
    const { count } = await supabase
      .from('snags')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)
      .eq('status', 'flagged');
    setOpenIssueCount(count ?? 0);
  }, []);

  useEffect(() => {
    fetchOpenCount();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchOpenCount();
    });
    return () => sub.remove();
  }, [fetchOpenCount]);

  return (
    <Tab.Navigator
      initialRouteName="Report"
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
      <Tab.Screen name="Report" component={ReportIssueScreen} />
      <Tab.Screen
        name="Issues"
        component={IssueListScreen}
        options={{
          tabBarLabel: 'Snags',
          tabBarBadge: openIssueCount > 0 ? openIssueCount : undefined,
        }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
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
    <IncidentDraftProvider>
      <ReportTargetProvider>
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
        <Stack.Screen
          name="ReportIncidentDetails"
          component={ReportIncidentDetailsScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ReportIncidentReview"
          component={ReportIncidentReviewScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ScanOrgCode"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        >
          {({ navigation }) => (
            <ScanJoinCodeScreen
              onComplete={() => navigation.goBack()}
              onBack={() => navigation.goBack()}
            />
          )}
        </Stack.Screen>
        <Stack.Screen
          name="ChooseReportOrg"
          component={ChooseReportOrgScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ManageOrganisation"
          component={ManageOrganisationScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
      </ReportTargetProvider>
    </IncidentDraftProvider>
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
});

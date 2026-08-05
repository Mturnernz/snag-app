import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';

import { TourAnchorId } from '@snag/onboarding-guide';

import { RootStackParamList, MainTabParamList, UserRole } from '../types';
import { Colors, Typography } from '../constants/theme';
import Icon from '../components/Icon';
import TourAnchor from '../components/TourAnchor';

import IssueListScreen from '../screens/IssueListScreen';
import ReportIssueScreen from '../screens/ReportIssueScreen';
import ProfileScreen from '../screens/ProfileScreen';
import IssueDetailScreen from '../screens/IssueDetailScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import ReportsScreen from '../screens/ReportsScreen';
import ReportIncidentDetailsScreen from '../screens/ReportIncidentDetailsScreen';
import ReportIncidentReviewScreen from '../screens/ReportIncidentReviewScreen';
import ScanJoinCodeScreen from '../screens/ScanJoinCodeScreen';
import ChooseReportOrgScreen from '../screens/ChooseReportOrgScreen';
import ManageOrganisationScreen from '../screens/ManageOrganisationScreen';
import ManageSitesScreen from '../screens/ManageSitesScreen';
import ManageWorkGroupsScreen from '../screens/ManageWorkGroupsScreen';
import MentionsScreen from '../screens/MentionsScreen';
import DocumentLibraryScreen from '../screens/DocumentLibraryScreen';
import HelpGuideScreen from '../screens/HelpGuideScreen';
import { IncidentDraftProvider } from '../context/IncidentDraftContext';
import { ReportTargetProvider } from '../context/ReportTargetContext';
import { BadgeProvider, useBadge } from '../context/BadgeContext';
import { OfflineQueueProvider } from '../context/OfflineQueueContext';

// ─── Tab bar icons ────────────────────────────────────────────────────────────

const TAB_ICONS: Record<string, { active: React.ComponentProps<typeof Icon>['name']; inactive: React.ComponentProps<typeof Icon>['name'] }> = {
  Report: { active: 'add-circle', inactive: 'add-circle-outline' },
  Issues: { active: 'list', inactive: 'list-outline' },
  Admin: { active: 'settings', inactive: 'settings-outline' },
  Profile: { active: 'person-circle', inactive: 'person-circle-outline' },
};

/** The walkthrough's anchor for each tab. Wrapping the icon rather than the
 *  whole tab button keeps the spotlight on something the size of a control:
 *  the button is a quarter of the bar wide and mostly empty. */
const TAB_ANCHORS: Record<string, TourAnchorId> = {
  Report: 'tab-report',
  Issues: 'tab-snags',
  Admin: 'tab-manager',
  Profile: 'tab-profile',
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons = TAB_ICONS[label];
  return (
    <TourAnchor id={TAB_ANCHORS[label]}>
      <Icon
        name={focused ? icons.active : icons.inactive}
        size="lg"
        color={focused ? Colors.primary : Colors.textMuted}
      />
    </TourAnchor>
  );
}

// ─── Bottom Tab Navigator ────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabNavigator({ userRole }: { userRole: UserRole }) {
  const isAdminOrManager = userRole === 'officer_admin' || userRole === 'supervisor';
  const { openIssueCount, mentionCount } = useBadge();

  return (
    <Tab.Navigator
      // `Report` is where the app opens, and it is deliberately not a prop any
      // more: it used to be, so the retired onboarding carousel could land
      // somebody on Snags when it finished. The walkthrough navigates by step
      // instead, which means it can move somebody more than once.
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
      {isAdminOrManager && (
        <Tab.Screen name="Admin" component={AdminDashboardScreen} options={{ tabBarLabel: 'Manager' }} />
      )}
      {/* Profile is declared last so it stays the right-most tab for every role. */}
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarBadge: mentionCount > 0 ? mentionCount : undefined,
        }}
      />
    </Tab.Navigator>
  );
}

// ─── Root Stack ───────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator({ userRole }: { userRole: UserRole }) {
  return (
    <BadgeProvider>
    <OfflineQueueProvider>
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
        <Stack.Screen
          name="ManageSites"
          component={ManageSitesScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="ManageWorkGroups"
          component={ManageWorkGroupsScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Mentions"
          component={MentionsScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="DocumentLibrary"
          component={DocumentLibraryScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="HelpGuide"
          component={HelpGuideScreen}
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
      </Stack.Navigator>
      </ReportTargetProvider>
    </IncidentDraftProvider>
    </OfflineQueueProvider>
    </BadgeProvider>
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

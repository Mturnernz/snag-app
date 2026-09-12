import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Typography } from '../constants/theme';
import { MainTabParamList, RootStackParamList } from '../types';
import SnagListScreen from '../screens/SnagListScreen';
import WeekendScreen from '../screens/WeekendScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SnagDetailScreen from '../screens/SnagDetailScreen';
import HouseholdScreen from '../screens/HouseholdScreen';
import LocationTagsScreen from '../screens/LocationTagsScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  // [inactive, active] — filled is reserved for the active tab.
  Snags: ['list-outline', 'list'],
  Weekend: ['hammer-outline', 'hammer'],
  Profile: ['person-circle-outline', 'person-circle'],
};

function MainTabs() {
  return (
    <Tab.Navigator
      // The list. Adding something is a bar at the foot of it rather than a
      // tab of its own, so there is nowhere else to open — and opening here is
      // how one person finds out what the other added, which with no
      // notifications anywhere in this product is the only way there is.
      initialRouteName="Snags"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
        },
        tabBarLabelStyle: {
          fontSize: Typography.xs,
          fontWeight: Typography.medium,
        },
        tabBarIcon: ({ focused, color }) => {
          const [inactive, active] = TAB_ICONS[route.name];
          return (
            <Ionicons
              name={focused ? active : inactive}
              size={IconSize.lg}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen name="Snags" component={SnagListScreen} options={{ tabBarLabel: 'List' }} />
      <Tab.Screen name="Weekend" component={WeekendScreen} options={{ tabBarLabel: 'Weekend' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'You' }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainTabs} />
      {/* A sheet, not a push. Triage is a dozen small decisions in a row, and
          a modal presentation keeps the list underneath between them. */}
      <Stack.Screen
        name="SnagDetail"
        component={SnagDetailScreen}
        options={{ presentation: 'modal' }}
      />
      <Stack.Screen name="Household" component={HouseholdScreen} />
      <Stack.Screen name="LocationTags" component={LocationTagsScreen} />
    </Stack.Navigator>
  );
}

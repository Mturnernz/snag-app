import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Typography } from '../constants/theme';
import { MainTabParamList, RootStackParamList } from '../types';
import SnagListScreen from '../screens/SnagListScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import HouseScreen from '../screens/HouseScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SnagDetailScreen from '../screens/SnagDetailScreen';
import HouseholdScreen from '../screens/HouseholdScreen';
import LocationTagsScreen from '../screens/LocationTagsScreen';
import ThingDetailScreen from '../screens/ThingDetailScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  // [inactive, active] — filled is reserved for the active tab.
  Snags: ['list-outline', 'list'],
  House: ['home-outline', 'home'],
  Schedule: ['calendar-outline', 'calendar'],
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
      {/* What's *there*, beside the list of what's wrong. Named "House"
          rather than "My House" because the moment there is a bach, "my
          house" is the wrong name for half of what it holds — the property
          name goes in the screen header instead. */}
      <Tab.Screen name="House" component={HouseScreen} options={{ tabBarLabel: 'House' }} />
      {/* The same work by date rather than by room — when things were added and
          finished, and when the repeating ones come round. It reads the list
          and never writes to it: one scheduling mechanism, or neither is
          trustworthy. Last of the three because it is the one you go to with a
          question, where the other two are where the work is done. */}
      <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ tabBarLabel: 'Schedule' }} />
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
      {/* A sheet, for the same reason SnagDetail is one: filling in a heat
          pump is a page of small independent facts, each written as it is
          typed, with the record it came from still underneath. */}
      <Stack.Screen
        name="ThingDetail"
        component={ThingDetailScreen}
        options={{ presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}

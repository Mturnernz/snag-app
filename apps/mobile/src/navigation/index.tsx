import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Typography } from '../constants/theme';
import { MainTabParamList, RootStackParamList } from '../types';
import CaptureScreen from '../screens/CaptureScreen';
import SnagListScreen from '../screens/SnagListScreen';
import WeekendScreen from '../screens/WeekendScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SnagDetailScreen from '../screens/SnagDetailScreen';
import HouseholdScreen from '../screens/HouseholdScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  // [inactive, active] — filled is reserved for the active tab.
  Capture: ['camera-outline', 'camera'],
  Snags: ['list-outline', 'list'],
  Weekend: ['hammer-outline', 'hammer'],
  Profile: ['person-circle-outline', 'person-circle'],
};

function MainTabs() {
  return (
    <Tab.Navigator
      // Capture, not the list. Logging something is the thing done most often
      // and the thing most sensitive to friction; reading the list is a
      // deliberate act someone taps through to.
      initialRouteName="Capture"
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
      <Tab.Screen name="Capture" component={CaptureScreen} options={{ tabBarLabel: 'Add' }} />
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
      <Stack.Screen name="SnagDetail" component={SnagDetailScreen} />
      <Stack.Screen name="Household" component={HouseholdScreen} />
    </Stack.Navigator>
  );
}

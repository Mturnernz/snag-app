import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Typography } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { MainTabParamList, RootStackParamList } from '../types';
import SnagListScreen from '../screens/SnagListScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import HouseScreen from '../screens/HouseScreen';
import ProjectsScreen from '../screens/ProjectsScreen';
import ProjectDetailScreen from '../screens/ProjectDetailScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SnagDetailScreen from '../screens/SnagDetailScreen';
import HouseholdScreen from '../screens/HouseholdScreen';
import LocationTagsScreen from '../screens/LocationTagsScreen';
import PasteAdviceScreen from '../screens/PasteAdviceScreen';
import ThingDetailScreen from '../screens/ThingDetailScreen';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  // [inactive, active] — filled is reserved for the active tab.
  Snags: ['list-outline', 'list'],
  House: ['home-outline', 'home'],
  Projects: ['construct-outline', 'construct'],
  Schedule: ['calendar-outline', 'calendar'],
  Profile: ['person-circle-outline', 'person-circle'],
};

function MainTabs() {
  const { profile } = useHousehold();

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
      {/* What we're *changing* about the place — renovations, rebuilds, the
          heat pump going in, planned or already done.

          A fifth tab rather than a mode on the House tab. Both describe the
          fabric of the place, which is why it sits beside it — but a tab with
          two minds is how a tab becomes two tabs badly, and this app has
          already removed a `By room / By kind` rail for exactly that.

          **Five is the ceiling, not a direction.** At 375pt each tab gets 75pt,
          and `Projects` and `Schedule` are both eight characters at 11px: they
          fit with nothing to spare. If a sixth noun ever arrives the answer is
          not a sixth tab — it is that two of these five were never really
          different.

          **It can be put away, and then there are four.** Not every household
          has a renovation, and a tab that answers nothing about your house is
          a fifth of the only navigation this app has. Turned off it is not
          registered at all rather than hidden with `tabBarButton: () => null`:
          a route that exists but cannot be reached is one deep link away from
          a screen the person has said they do not want, and `snag://` plus the
          web build both have deep links. The jobs filed against a renovation
          go with it — see `excludeProjectSnags`. */}
      {profile.projectsEnabled ? (
        <Tab.Screen name="Projects" component={ProjectsScreen} options={{ tabBarLabel: 'Projects' }} />
      ) : null}
      {/* The same work by date rather than by room — when things were added and
          finished, and when the repeating ones come round. It reads the list
          and never writes to it: one scheduling mechanism, or neither is
          trustworthy. Last of the four because it is the one you go to with a
          question, where the others are where the work is done. */}
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
      {/* A push, not a sheet, unlike SnagDetail and ThingDetail. Those are a
          dozen small decisions taken against a list still visible underneath. A
          project is a page you read — three figures, a set of parts that open,
          and a folder — and deep enough that a sheet would spend its height
          covering the tab it came from.

          Registered whatever the setting says, unlike the tab. Nothing routes
          here with projects off — the tab is gone and the jobs that named a
          renovation are filtered out of every list — but a `/projects/<id>`
          link somebody was sent before they turned it off should open the page
          rather than fall through to the list with no explanation. The setting
          is about what the app offers, not about what it refuses to show when
          asked directly. */}
      <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
      <Stack.Screen name="Household" component={HouseholdScreen} />
      <Stack.Screen name="LocationTags" component={LocationTagsScreen} />
      {/* A push, not a sheet: it is a paste and then a list of what that paste
          would change, and both want the whole height. */}
      <Stack.Screen name="PasteAdvice" component={PasteAdviceScreen} />
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

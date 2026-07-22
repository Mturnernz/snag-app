import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList, ROLE_LABELS } from '../types';
import { Colors, Radius, Spacing, Typography, Shadow, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  getMemberships, setActiveOrg, searchPublicOrgs, Membership, PublicOrg,
} from '../lib/supabase';
import { useReportTarget } from '../context/ReportTargetContext';
import { useToast } from '../hooks/useToast';
import ScreenHeader from '../components/ScreenHeader';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const RECENT_KEY = 'snag.recentPublicOrg';

export default function ChooseReportOrgScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { showToast } = useToast();
  const { setTarget } = useReportTarget();

  const [query, setQuery] = useState('');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [publicOrgs, setPublicOrgs] = useState<PublicOrg[]>([]);
  const [recent, setRecent] = useState<PublicOrg | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    // Deactivated orgs aren't reportable — hide them from the picker.
    getMemberships().then((ms) => setMemberships(ms.filter((m) => m.org_active)));
    AsyncStorage.getItem(RECENT_KEY).then((raw) => {
      if (raw) {
        try { setRecent(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
  }, []);

  useEffect(() => {
    searchPublicOrgs(query).then(setPublicOrgs);
  }, [query]);

  async function handlePickMemberOrg(m: Membership) {
    if (switching) return;
    if (m.is_active) {
      navigation.goBack();
      return;
    }
    setSwitching(m.org_id);
    const { error } = await setActiveOrg(m.org_id);
    setSwitching(null);
    if (!error) {
      showToast(`Now reporting to ${m.org_name}`);
      navigation.goBack();
    } else {
      showToast(error.message ?? 'Could not switch organisation');
    }
  }

  function handlePickPublicOrg(org: PublicOrg) {
    setTarget({ orgId: org.org_id, orgName: org.org_name });
    AsyncStorage.setItem(RECENT_KEY, JSON.stringify(org));
    navigation.goBack();
  }

  const membershipOrgIds = new Set(memberships.map((m) => m.org_id));
  const filteredMemberships = query.trim()
    ? memberships.filter((m) => m.org_name.toLowerCase().includes(query.trim().toLowerCase()))
    : memberships;
  // Orgs you belong to appear in "Your organisations", not the public grid.
  const gridOrgs = publicOrgs.filter((o) => !membershipOrgIds.has(o.org_id));
  const showRecent = recent && !membershipOrgIds.has(recent.org_id) && !query.trim();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Choose an Organisation" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.searchWrap}>
          <Icon name="search-outline" size="sm" color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search organisations"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
        </View>

        {showRecent && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RECENT</Text>
            <TouchableOpacity style={styles.memberRow} onPress={() => handlePickPublicOrg(recent!)} activeOpacity={0.7}>
              <Avatar name={recent!.org_name} size={36} />
              <View style={styles.memberRowText}>
                <Text style={styles.memberRowName}>{recent!.org_name}</Text>
                <Text style={styles.memberRowRole}>Public organisation</Text>
              </View>
              <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {filteredMemberships.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>YOUR ORGANISATIONS</Text>
            {filteredMemberships.map((m) => (
              <TouchableOpacity
                key={m.org_id}
                style={styles.memberRow}
                onPress={() => handlePickMemberOrg(m)}
                disabled={switching !== null}
                activeOpacity={0.7}
              >
                <Avatar name={m.org_name} size={36} />
                <View style={styles.memberRowText}>
                  <Text style={styles.memberRowName}>{m.org_name}</Text>
                  <Text style={styles.memberRowRole}>{ROLE_LABELS[m.role]}</Text>
                </View>
                {m.is_active ? (
                  <Icon name="checkmark-circle" size="md" color={Colors.primary} />
                ) : (
                  <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PUBLIC ORGANISATIONS</Text>
          {gridOrgs.length === 0 ? (
            <Text style={styles.emptyText}>
              {query.trim()
                ? 'No public organisations match your search.'
                : 'No organisations are accepting public reports yet.'}
            </Text>
          ) : (
            <View style={styles.grid}>
              {gridOrgs.map((org) => (
                <TouchableOpacity
                  key={org.org_id}
                  style={styles.gridCard}
                  onPress={() => handlePickPublicOrg(org)}
                  activeOpacity={0.8}
                >
                  <Avatar name={org.org_name} size={44} />
                  <Text style={styles.gridCardName} numberOfLines={2}>{org.org_name}</Text>
                  <View style={styles.publicBadge}>
                    <Text style={styles.publicBadgeText}>Public</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  memberRowText: {
    flex: 1,
    gap: 2,
  },
  memberRowName: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  memberRowRole: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  gridCard: {
    flexBasis: '48%',
    flexGrow: 1,
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  gridCardName: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  publicBadge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.chip,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  publicBadgeText: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.primary,
  },
  emptyText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});

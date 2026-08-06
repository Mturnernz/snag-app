import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../../types';
import { getSitesWithDetail, createSite, SiteDetail } from '../../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../../constants/theme';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../hooks/useToast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// The list, and the one place a site is created. Everything *about* a site is
// on SiteDetailScreen — this tab deliberately holds no settings, so there is no
// second place to change a thing the detail screen also changes.
export default function SitesTab() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { showToast } = useToast();

  const [sites, setSites] = useState<SiteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setSites(await getSitesWithDetail());
    setLoading(false);
  }, []);

  // Fires on mount as well as on every return, so there is no separate mount
  // effect — renaming a site or assigning its first Site Lead happens on the
  // detail screen, and the counts here are stale the moment someone comes back.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function handleCreate() {
    const name = newSiteName.trim();
    if (!name) return;
    setCreating(true);
    const { error } = await createSite(name);
    setCreating(false);
    if (error) {
      showToast(error.message ?? 'Could not create site');
      return;
    }
    setNewSiteName('');
    showToast('Site created');
    const fresh = await getSitesWithDetail();
    setSites(fresh);
    // Straight into the new site: it has no members, no Site Lead and no
    // default owner, and naming it was only the first of those decisions.
    const created = fresh.find((s) => !sites.some((existing) => existing.id === s.id));
    if (created) navigation.navigate('SiteDetail', { siteId: created.id });
  }

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const active = sites.filter((s) => !s.archivedAt);
  const archived = sites.filter((s) => s.archivedAt);

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>SITES</Text>
          <Text style={styles.sectionCount}>{active.length} site{active.length !== 1 ? 's' : ''}</Text>
        </View>

        {active.map((site) => (
          <SiteRow key={site.id} site={site} onPress={() => navigation.navigate('SiteDetail', { siteId: site.id })} />
        ))}

        {active.length === 0 && (
          <EmptyState
            icon="location-outline"
            title="No sites yet"
            message="Add your first site below — every report has to land somewhere."
          />
        )}

        <Card variant="elevated" style={styles.card}>
          <Text style={styles.fieldLabel}>Add a site</Text>
          <View style={styles.rowButtons}>
            <TextInput
              style={[styles.input, styles.flex1]}
              placeholder="e.g. North Warehouse"
              placeholderTextColor={Colors.textMuted}
              value={newSiteName}
              onChangeText={setNewSiteName}
              onSubmitEditing={handleCreate}
              returnKeyType="done"
            />
            <Button label="Add" onPress={handleCreate} loading={creating} disabled={!newSiteName.trim()} />
          </View>
        </Card>

        {/* Archived sites stay listed — a closed site is the one thing an admin
            comes back for, either to read its history or to reopen it. Kept in
            their own group so they never pad the count above. */}
        {archived.length > 0 && (
          <>
            <View style={[styles.sectionHeader, styles.archivedHeader]}>
              <Text style={styles.sectionLabel}>ARCHIVED</Text>
              <Text style={styles.sectionCount}>{archived.length}</Text>
            </View>
            {archived.map((site) => (
              <SiteRow
                key={site.id}
                site={site}
                archived
                onPress={() => navigation.navigate('SiteDetail', { siteId: site.id })}
              />
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function SiteRow({
  site, archived, onPress,
}: { site: SiteDetail; archived?: boolean; onPress: () => void }) {
  // Only for an active site: an archived one having no Site Lead is not a gap
  // to chase, it is a site nobody works at.
  const noLead = !archived && site.supervisorIds.length === 0;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Card variant="elevated" style={[styles.siteCard, archived && styles.siteCardArchived]}>
        <Icon
          name={archived ? 'archive-outline' : 'location-outline'}
          size="md"
          color={archived ? Colors.textMuted : Colors.primary}
        />
        <View style={styles.siteInfo}>
          <Text style={styles.siteName} numberOfLines={1}>{site.name}</Text>
          <Text style={styles.siteMeta} numberOfLines={1}>
            {archived ? 'Archived · no new reports' : (
              <>
                {site.memberIds.length} member{site.memberIds.length !== 1 ? 's' : ''}
                {' · '}
                {site.supervisorIds.length} Site Lead{site.supervisorIds.length !== 1 ? 's' : ''}
                {site.publicReportToken ? ' · Public QR' : ''}
              </>
            )}
          </Text>
          {noLead && (
            <Text style={styles.siteWarn} numberOfLines={1}>
              No Site Lead — only a Manager can investigate here
            </Text>
          )}
        </View>
        <Icon name="chevron-forward" size="md" color={Colors.textMuted} />
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  card: { gap: Spacing.sm },
  section: { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },
  sectionCount: { fontSize: Typography.xs, color: Colors.textMuted },
  fieldLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  flex1: { flex: 1 },
  rowButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },

  archivedHeader: { marginTop: Spacing.md },
  siteCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  siteCardArchived: { opacity: 0.65 },
  siteInfo: { flex: 1, gap: 2 },
  siteName: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  siteMeta: { fontSize: Typography.sm, color: Colors.textMuted },
  siteWarn: { fontSize: Typography.xs, color: Colors.serious },
});

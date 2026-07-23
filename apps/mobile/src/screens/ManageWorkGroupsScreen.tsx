import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Profile, UserRole } from '../types';
import {
  supabase, getOrgMembers, getOrgSites, createSite, getWorkGroupsWithDetail, createWorkGroup,
  updateWorkGroup, assignWorkGroupSupervisor, removeWorkGroupSupervisor, deleteWorkGroup, WorkGroupDetail,
} from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET, WorkGroupPalette } from '../constants/theme';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';

export default function ManageWorkGroupsScreen() {
  const insets = useSafeAreaInsets();

  const [role, setRole] = useState<UserRole | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [workGroups, setWorkGroups] = useState<WorkGroupDetail[]>([]);
  const [supervisors, setSupervisors] = useState<Profile[]>([]);
  const [managingGroup, setManagingGroup] = useState<WorkGroupDetail | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState<string>(WorkGroupPalette[0]);
  const [newGroupSiteIds, setNewGroupSiteIds] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Sites — for scoping a work group to one site, or leaving it for all.
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [showNewSiteInput, setShowNewSiteInput] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);

  const canManageWorkGroups = role === 'officer_admin' || role === 'supervisor';

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setCurrentUserId(user.id);

    const { data } = await supabase.from('profiles').select('role, org_id').eq('id', user.id).single();

    if (data) {
      setRole(data.role as UserRole);
      setIsAdmin(data.role === 'officer_admin');

      if (data.role === 'officer_admin' || data.role === 'supervisor') {
        if (data.org_id) getOrgSites(data.org_id).then(setSites);
        const groups = await getWorkGroupsWithDetail();
        setWorkGroups(groups);
        getOrgMembers().then((members) => setSupervisors(members.filter((m) => m.role === 'supervisor')));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Called after any change to a work group so both the list and (if open)
  // the "Manage" modal's snapshot stay in sync — uses the freshly-fetched
  // array directly rather than reading back from React state to avoid a
  // stale-closure race.
  async function refreshWorkGroups() {
    const groups = await getWorkGroupsWithDetail();
    setWorkGroups(groups);
    setManagingGroup((prev) => (prev ? groups.find((g) => g.id === prev.id) ?? null : null));
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    const { error } = await createWorkGroup(newGroupName.trim(), newGroupColor, newGroupSiteIds);
    setCreatingGroup(false);
    if (!error) {
      setNewGroupName('');
      setNewGroupColor(WorkGroupPalette[0]);
      setNewGroupSiteIds([]);
      await refreshWorkGroups();
    } else {
      Alert.alert('Error', error.message ?? 'Could not create work group');
    }
  }

  async function handleCreateSiteInline() {
    if (!newSiteName.trim()) return;
    setCreatingSite(true);
    const { error } = await createSite(newSiteName.trim());
    setCreatingSite(false);
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not create site');
      return;
    }
    setNewSiteName('');
    setShowNewSiteInput(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single();
      if (profile?.org_id) {
        const fresh = await getOrgSites(profile.org_id);
        setSites(fresh);
        const created = fresh.find((s) => !sites.some((existing) => existing.id === s.id));
        if (created) setNewGroupSiteIds((prev) => [...prev, created.id]);
      }
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Manage Work Groups" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (!canManageWorkGroups) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Manage Work Groups" />
        <View style={styles.loadingContainer}>
          <EmptyState
            icon="lock-closed-outline"
            title="Managers and Site Leads only"
            message="Only a manager or Site Lead can manage work groups."
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage Work Groups" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <Card variant="elevated" style={styles.wgCard}>
          <Text style={styles.hint}>
            Route snags to a team (e.g. Vehicles, Kitchen, Facilities) after they're submitted. A "Submit" default
            group appears automatically once you add your first one.
          </Text>

          {workGroups.filter((g) => !g.isDefault).map((wg) => (
            <View key={wg.id} style={styles.wgRow}>
              <View style={[styles.wgSwatch, { backgroundColor: wg.color ?? Colors.textMuted }]} />
              <View style={styles.wgInfo}>
                <Text style={styles.wgName}>{wg.name}</Text>
                <Text style={styles.wgMeta}>
                  {wg.siteNames.length > 0 ? wg.siteNames.join(', ') : 'All sites'} · {wg.supervisorIds.length} Site Lead{wg.supervisorIds.length !== 1 ? 's' : ''}
                </Text>
              </View>
              <Button label="Manage" variant="outline" onPress={() => setManagingGroup(wg)} />
            </View>
          ))}

          {workGroups.filter((g) => !g.isDefault).length === 0 && (
            <Text style={styles.hintMuted}>No work groups yet — add one below.</Text>
          )}

          <Text style={styles.fieldLabel}>Add a work group</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Vehicles"
            placeholderTextColor={Colors.textMuted}
            value={newGroupName}
            onChangeText={setNewGroupName}
          />

          <Text style={styles.fieldLabel}>Sites</Text>
          <SiteMultiSelect sites={sites} selectedIds={newGroupSiteIds} onChange={setNewGroupSiteIds} />
          {isAdmin && (
            showNewSiteInput ? (
              <View style={styles.rowButtons}>
                <TextInput
                  style={[styles.input, styles.flex1]}
                  placeholder="New site name"
                  placeholderTextColor={Colors.textMuted}
                  value={newSiteName}
                  onChangeText={setNewSiteName}
                />
                <Button label="Add" onPress={handleCreateSiteInline} loading={creatingSite} />
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowNewSiteInput(true)}>
                <Text style={styles.linkText}>+ New site</Text>
              </TouchableOpacity>
            )
          )}

          <Text style={styles.fieldLabel}>Colour</Text>
          <View style={styles.paletteRow}>
            {WorkGroupPalette.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.swatchOption, { backgroundColor: c }, newGroupColor === c && styles.swatchOptionActive]}
                onPress={() => setNewGroupColor(c)}
              />
            ))}
          </View>

          <Button
            label="Add Work Group"
            onPress={handleCreateGroup}
            loading={creatingGroup}
            disabled={!newGroupName.trim()}
            fullWidth
            style={styles.topGap}
          />
        </Card>
      </ScrollView>

      <WorkGroupSupervisorModal
        group={managingGroup}
        supervisors={supervisors}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        sites={sites}
        onSitesChanged={setSites}
        onClose={() => setManagingGroup(null)}
        onChanged={refreshWorkGroups}
      />
    </View>
  );
}

// ── Work group supervisor modal ──────────────────────────────────────────────
// Lists every org Site Lead with an assign/unassign toggle. A manager can
// toggle anyone; a Site Lead can only self-assign/self-unassign.
function WorkGroupSupervisorModal({
  group,
  supervisors,
  isAdmin,
  currentUserId,
  sites,
  onSitesChanged,
  onClose,
  onChanged,
}: {
  group: WorkGroupDetail | null;
  supervisors: Profile[];
  isAdmin: boolean;
  currentUserId: string | null;
  sites: { id: string; name: string }[];
  onSitesChanged: (sites: { id: string; name: string }[]) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<string>(WorkGroupPalette[0]);
  const [editSiteIds, setEditSiteIds] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showNewSiteInput, setShowNewSiteInput] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!group) return;
    setEditName(group.name);
    setEditColor(group.color ?? WorkGroupPalette[0]);
    setEditSiteIds(group.siteIds);
    setShowNewSiteInput(false);
    setNewSiteName('');
  }, [group?.id]);

  if (!group) return null;

  async function handleSaveEdit() {
    if (!group || !editName.trim()) return;
    setSavingEdit(true);
    const { error } = await updateWorkGroup(group.id, editName.trim(), editColor, editSiteIds);
    setSavingEdit(false);
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not update work group');
    } else {
      await onChanged();
    }
  }

  async function handleCreateSiteInline() {
    if (!newSiteName.trim()) return;
    setCreatingSite(true);
    const { error } = await createSite(newSiteName.trim());
    setCreatingSite(false);
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not create site');
      return;
    }
    setNewSiteName('');
    setShowNewSiteInput(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single();
      if (profile?.org_id) {
        const fresh = await getOrgSites(profile.org_id);
        const created = fresh.find((s) => !sites.some((existing) => existing.id === s.id));
        onSitesChanged(fresh);
        if (created) setEditSiteIds((prev) => [...prev, created.id]);
      }
    }
  }

  // A Site Lead can only self-assign/self-unassign; a manager can toggle anyone.
  function canToggle(userId: string) {
    return isAdmin || userId === currentUserId;
  }

  function handleDelete() {
    if (!group) return;
    Alert.alert(
      'Delete work group?',
      `"${group.name}" will be deleted. Any open snags assigned to it go back to Unassigned — resolved snags keep their history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await deleteWorkGroup(group.id);
            setDeleting(false);
            if (error) {
              Alert.alert('Error', error.message ?? 'Could not delete work group');
            } else {
              onClose();
              await onChanged();
            }
          },
        },
      ]
    );
  }

  async function toggle(userId: string, active: boolean) {
    if (!group || !canToggle(userId)) return;
    setBusy(userId);
    const { error } = active
      ? await removeWorkGroupSupervisor(group.id, userId)
      : await assignWorkGroupSupervisor(group.id, userId);
    if (error) Alert.alert('Error', error.message ?? 'Could not update this work group');
    await onChanged();
    setBusy(null);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>{group.name}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size="md" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScroll}>
            <Text style={styles.sectionLabel}>DETAILS</Text>
            <TextInput
              style={styles.input}
              placeholder="Work group name"
              placeholderTextColor={Colors.textMuted}
              value={editName}
              onChangeText={setEditName}
            />

            <Text style={styles.fieldLabel}>Sites</Text>
            <SiteMultiSelect sites={sites} selectedIds={editSiteIds} onChange={setEditSiteIds} />
            {isAdmin && (
              showNewSiteInput ? (
                <View style={styles.rowButtons}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    placeholder="New site name"
                    placeholderTextColor={Colors.textMuted}
                    value={newSiteName}
                    onChangeText={setNewSiteName}
                  />
                  <Button label="Add" onPress={handleCreateSiteInline} loading={creatingSite} />
                </View>
              ) : (
                <TouchableOpacity onPress={() => setShowNewSiteInput(true)}>
                  <Text style={styles.linkText}>+ New site</Text>
                </TouchableOpacity>
              )
            )}

            <Text style={styles.fieldLabel}>Colour</Text>
            <View style={styles.paletteRow}>
              {WorkGroupPalette.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.swatchOption, { backgroundColor: c }, editColor === c && styles.swatchOptionActive]}
                  onPress={() => setEditColor(c)}
                />
              ))}
            </View>

            <Button
              label="Save Changes"
              onPress={handleSaveEdit}
              loading={savingEdit}
              disabled={!editName.trim()}
              fullWidth
              style={styles.topGap}
            />

            <View style={styles.divider} />

            <Text style={styles.sectionLabel}>SITE LEADS</Text>
            <Text style={styles.modalHint}>
              {isAdmin
                ? 'Snags routed here auto-assign to the Site Lead if exactly one is set.'
                : 'You can assign or unassign yourself. Only a manager can change other Site Leads.'}
            </Text>
            {supervisors.map((s) => {
              const active = group.supervisorIds.includes(s.id);
              const enabled = canToggle(s.id);
              return (
                <View key={s.id} style={styles.assignRow}>
                  <Text style={styles.assignName} numberOfLines={1}>{s.name || s.email}</Text>
                  <TouchableOpacity
                    style={[styles.toggle, active && styles.toggleActive, !enabled && styles.toggleDisabled]}
                    onPress={() => toggle(s.id, active)}
                    disabled={!enabled || busy === s.id}
                    activeOpacity={0.7}
                  >
                    {busy === s.id ? (
                      <ActivityIndicator size="small" color={active ? Colors.white : Colors.primary} />
                    ) : (
                      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
                        {active ? 'Site Lead' : 'Assign'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
            {supervisors.length === 0 && (
              <Text style={styles.hintMuted}>No Site Leads in this organisation yet.</Text>
            )}

            {isAdmin && !group.isDefault && (
              <>
                <View style={styles.divider} />
                <Button
                  label="Delete Work Group"
                  variant="dangerOutline"
                  icon="trash-outline"
                  onPress={handleDelete}
                  loading={deleting}
                  fullWidth
                  style={styles.topGap}
                />
              </>
            )}
          </ScrollView>

          <Button label="Done" onPress={onClose} fullWidth style={styles.topGap} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// A work group with no sites selected applies to every site in the org —
// "All sites" is a shortcut that clears the selection, not a real site id.
function SiteMultiSelect({
  sites,
  selectedIds,
  onChange,
}: {
  sites: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
  }

  return (
    <View style={styles.siteChipRow}>
      <TouchableOpacity
        style={[styles.siteChip, selectedIds.length === 0 && styles.siteChipActive]}
        onPress={() => onChange([])}
        activeOpacity={0.7}
      >
        <Text style={[styles.siteChipText, selectedIds.length === 0 && styles.siteChipTextActive]}>All sites</Text>
      </TouchableOpacity>
      {sites.map((s) => {
        const active = selectedIds.includes(s.id);
        return (
          <TouchableOpacity
            key={s.id}
            style={[styles.siteChip, active && styles.siteChipActive]}
            onPress={() => toggle(s.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.siteChipText, active && styles.siteChipTextActive]}>{s.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, padding: Spacing.xl },

  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  wgCard: { gap: Spacing.sm },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  hintMuted: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  fieldLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary, marginTop: Spacing.xs },
  topGap: { marginTop: Spacing.sm },
  rowButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flex1: { flex: 1 },
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
  wgRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  wgSwatch: { width: 40, height: 40, borderRadius: Radius.button },
  wgInfo: { flex: 1, gap: 2 },
  wgName: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },
  wgMeta: { fontSize: Typography.xs, color: Colors.textMuted },
  paletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  swatchOption: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatchOptionActive: { borderColor: Colors.textPrimary },
  siteChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  siteChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: 17,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  siteChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  siteChipText: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  siteChipTextActive: { color: Colors.primary, fontWeight: Typography.semibold },
  linkText: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.primary, marginTop: Spacing.xs },

  // Work group supervisor modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    padding: Spacing.lg, gap: Spacing.sm, maxHeight: '85%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { flex: 1, fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  modalHint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  modalScroll: { marginTop: Spacing.sm },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  assignRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  assignName: { flex: 1, fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },
  toggle: {
    minWidth: 84, height: 34, paddingHorizontal: Spacing.sm, borderRadius: Radius.button,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleDisabled: { opacity: 0.5 },
  toggleText: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  toggleTextActive: { color: Colors.white },
});

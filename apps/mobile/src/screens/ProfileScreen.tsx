import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  deleteMyAccount, deleteStoredFiles, getAllProjects, getMyOrphanFilePaths, getSnags, signOut,
  setProjectsEnabled, upsertProfile,
} from '../lib/supabase';
import { looseEnds, type LooseEnd } from '@snag/supabase-queries';
import { showAlert } from '../lib/alert';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * How many loose ends are ever drawn at once.
 *
 * Five is a sitting's worth. The count above the list stays honest about the
 * total, but a scrolling wall of them is precisely the completeness meter this
 * whole section is built not to become.
 */
const LOOSE_END_LIMIT = 5;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { profile, household, members, locations, properties, reloadAccount } = useHousehold();
  const { showToast } = useToast();

  const [name, setName] = useState(profile.displayName);
  const [saving, setSaving] = useState(false);
  const [ends, setEnds] = useState<LooseEnd[]>([]);
  const [endsOpen, setEndsOpen] = useState(false);
  const [savingProjects, setSavingProjects] = useState(false);

  /**
   * Turning the Projects tab on or off.
   *
   * Pressing the half that is already lit writes nothing — it is a no-op
   * rather than a write that touches the row to say what the row already says,
   * the same rule capture's priority pills held to.
   *
   * `reloadAccount` rather than local state, because the answer decides whether
   * a *tab* exists: the navigator reads it from the profile in context, so the
   * one that came back from the write has to be the one everything reads.
   */
  async function setProjects(enabled: boolean) {
    if (enabled === profile.projectsEnabled || savingProjects) return;
    setSavingProjects(true);
    try {
      await setProjectsEnabled(enabled);
      await reloadAccount();
      showToast(enabled ? 'Projects are back' : 'Projects put away');
    } catch (err: any) {
      showAlert("Couldn't change that", err?.message ?? 'Please try again.');
    } finally {
      setSavingProjects(false);
    }
  }

  /**
   * What the app knows is half-finished and can name the next move for.
   *
   * **Two reads, and neither is fatal.** They are the same two the Schedule tab
   * already makes, and a list of optional tidying must never be the thing that
   * stops somebody signing out — this screen is also the escape hatch from a
   * broken session.
   */
  const loadEnds = useCallback(async () => {
    try {
      // With projects off, neither the renovations nor the jobs filed against
      // one are asked for: a loose end has to name one obvious next action, and
      // "record what the laundry left behind" is not one when the page holding
      // that laundry has been put away.
      const [projects, snags] = await Promise.all([
        profile.projectsEnabled ? getAllProjects() : Promise.resolve([]),
        getSnags({ excludeProjectSnags: !profile.projectsEnabled }),
      ]);
      setEnds(looseEnds({ projects, snags, properties }));
    } catch {
      setEnds([]);
    }
  }, [properties, profile.projectsEnabled]);

  useFocusEffect(useCallback(() => { loadEnds(); }, [loadEnds]));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = name.trim() !== profile.displayName && name.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    try {
      await upsertProfile(name.trim());
      await reloadAccount();
      showToast('Saved');
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    setConfirmDelete(false);
    try {
      // Files first. The storage delete policy asks whether you are a member of
      // the household a file's folder names, so an account that has just deleted
      // itself can no longer clear up after itself — and deleteStoredFiles never
      // throws, so every refusal would pass in silence. Same rule as deleting a
      // household, for the same reason. See 20260914161000.
      await deleteStoredFiles(await getMyOrphanFilePaths());
      await deleteMyAccount();
      // The session now belongs to an account that doesn't exist. signOut is
      // bounded and falls back to dropping the stored session, so it gets out
      // even though nothing it asks the server can succeed.
      await signOut();
    } catch (err: any) {
      showAlert("Couldn't delete your account", err?.message ?? 'Please try again.');
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Avatar name={profile.displayName} size={64} ring />
        <Text style={styles.name}>{profile.displayName}</Text>
      </View>

      <Card elevation="md" style={styles.section}>
        <Text style={styles.sectionTitle}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoCapitalize="words"
        />
        {dirty ? (
          <Button label="Save" onPress={handleSave} loading={saving} fullWidth />
        ) : null}
      </Card>

      {/* ── Worth finishing ───────────────────────────────────────────
          **Quiet, and absent at zero.** One muted line that expands, sitting
          below the name card rather than above it, in no colour and on no
          elevated surface — everything else on this screen is a white card, and
          this deliberately is not one.

          The rule it is built against is the House tab's, one screen further
          on: *a global completeness meter is the shaming number that gets an
          app closed and not reopened.* So there is no percentage, no progress
          bar and no denominator of everything — only a count of concrete things
          somebody could do, the same shape as the shopping pill's "2 things to
          get". Each entry has to be a fact from a column, have one obvious next
          action, and have a payoff nameable in a sentence; anything that fails
          one of those is left out, which is why the list is short and usually
          empty.

          Collapsed by default, because the person opening the You tab came to
          change their name or sign out. */}
      {ends.length > 0 ? (
        <View style={styles.ends}>
          <Pressable
            onPress={() => setEndsOpen((open) => !open)}
            style={styles.endsHead}
            accessibilityRole="button"
            accessibilityState={{ expanded: endsOpen }}
            accessibilityLabel={
              ends.length === 1 ? '1 thing worth finishing' : `${ends.length} things worth finishing`
            }
          >
            <Text style={styles.endsTitle}>
              {ends.length === 1 ? '1 thing worth finishing' : `${ends.length} things worth finishing`}
            </Text>
            <Icon
              name={endsOpen ? 'chevron-up' : 'chevron-down'}
              size="sm"
              color={Colors.textMuted}
            />
          </Pressable>

          {endsOpen ? (
            <View style={styles.endsList}>
              {/* Capped, and the cap is the point: a wall of them would be the
                  meter this is built not to be. The count above stays honest;
                  the line below says why the rest are not drawn. */}
              {ends.slice(0, LOOSE_END_LIMIT).map((end, i) => (
                <Pressable
                  key={`${end.kind}-${end.projectId ?? end.snagId ?? i}`}
                  onPress={() => {
                    if (end.projectId) navigation.navigate('ProjectDetail', { projectId: end.projectId });
                    else if (end.snagId) navigation.navigate('SnagDetail', { snagId: end.snagId });
                    else navigation.navigate('Household');
                  }}
                  style={styles.end}
                  accessibilityRole="button"
                  accessibilityLabel={end.title}
                >
                  <View style={styles.endBody}>
                    <Text style={styles.endTitle}>{end.title}</Text>
                    <Text style={styles.endDetail}>{end.detail}</Text>
                  </View>
                  <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
                </Pressable>
              ))}
              {ends.length > LOOSE_END_LIMIT ? (
                <Text style={styles.endsMore}>More once these are done.</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable onPress={() => navigation.navigate('Household')}>
        <Card elevation="md" style={styles.linkRow}>
          <Icon name="home-outline" size="md" color={Colors.primary} />
          <View style={styles.linkBody}>
            <Text style={styles.linkTitle}>{household.name}</Text>
            <Text style={styles.linkHint}>
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </Text>
          </View>
          <Icon name="chevron-forward" size="md" color={Colors.textMuted} />
        </Card>
      </Pressable>

      {/*
        The tags are the one piece of setup a household actually outgrows —
        `Elsewhere` was the escape hatch until this screen existed. It lives here
        rather than at capture because it is a sit-down job, and capture is not.
      */}
      <Pressable onPress={() => navigation.navigate('LocationTags')}>
        <Card elevation="md" style={styles.linkRow}>
          <Icon name="pricetags-outline" size="md" color={Colors.primary} />
          <View style={styles.linkBody}>
            <Text style={styles.linkTitle}>Location tags</Text>
            <Text style={styles.linkHint}>
              {locations.length} offered when you add something
            </Text>
          </View>
          <Icon name="chevron-forward" size="md" color={Colors.textMuted} />
        </Card>
      </Pressable>

      {/* ── Projects on or off ──
          **A setting about this person's screen, not about the house.** It is
          the only one in the app that is: everything else the schema remembers
          is per household or per property, because there is one house and two
          people disagreeing about whether it has a dryer is not a state worth
          modelling. This is not that — a renovation is a third noun, not every
          household has one, and a tab that answers nothing about your house is
          a fifth of the only navigation this app has.

          Two named halves rather than one switch that toggles, the same
          argument the GST pill and capture's priority step already make: a lone
          control leaves the other answer as the unlabelled absence of a press,
          and here that unlabelled answer removes a tab.

          The hint says what *else* goes, because the tab is the visible half
          and the punch list is the surprising one — jobs filed against a
          renovation leave the list too, since with no project page to open they
          are rows naming something unreachable. */}
      <Card elevation="md" style={styles.section}>
        <Text style={styles.sectionTitle}>Projects</Text>
        <Text style={styles.linkHint}>
          Renovations, quotes and what they cost. Turning this off hides the tab and the jobs
          filed against a renovation. Nothing is deleted, and this is yours alone — it doesn't
          change what anyone else sees.
        </Text>
        <View style={styles.modeRow}>
          <Pressable
            onPress={() => setProjects(true)}
            disabled={savingProjects}
            style={[styles.mode, profile.projectsEnabled && styles.modeOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: profile.projectsEnabled }}
            accessibilityLabel="Show projects"
          >
            <Text style={[styles.modeLabel, profile.projectsEnabled && styles.modeLabelOn]}>
              Show projects
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setProjects(false)}
            disabled={savingProjects}
            style={[styles.mode, !profile.projectsEnabled && styles.modeOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: !profile.projectsEnabled }}
            accessibilityLabel="Hide projects"
          >
            <Text style={[styles.modeLabel, !profile.projectsEnabled && styles.modeLabelOn]}>
              Hide them
            </Text>
          </Pressable>
        </View>
      </Card>

      <Button
        label="Sign out"
        variant="outline"
        onPress={async () => {
          const { forced } = await signOut();
          if (forced) showToast('Signed out');
        }}
        fullWidth
        style={styles.signOut}
      />

      {/* Signing out is the everyday door and deleting is the other one, so it
          sits below, quieter, and asks for the name to be typed — the same gate
          deleting a place uses, for the same reason: this one takes other
          people's work with it if you are the only one in the house. */}
      <Button
        label="Delete my account"
        variant="ghost"
        onPress={() => setConfirmDelete(true)}
        fullWidth
      />
      <Text style={styles.deleteHint}>
        Any household you're the only one in goes with you, and so does everything in it. Ones you
        share stay, and so does what you filed in them.
      </Text>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete your account?"
        message={
          "You'll be signed out for good. Any household you're the only one in is deleted with " +
          'every job, item and photo in it. This cannot be undone.'
        }
        confirmLabel="Delete"
        confirmText={profile.displayName}
        destructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDelete(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxxl },
  header: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  name: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  linkBody: { flex: 1 },
  linkTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  linkHint: { fontSize: Typography.sm, color: Colors.textMuted },
  // The app's one chip: a sunken well when off, solid fern when on, no border
  // either way. Never `primaryLight` — that is the tint behind fern *text*, and
  // using it for one rail and solid fern for another made two controls doing
  // the same job look like two different controls.
  modeRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  mode: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  modeOn: { backgroundColor: Colors.primary },
  modeLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  modeLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  signOut: { marginTop: Spacing.md },
  // No card, no elevation, no hue. Everything else on this screen is a white
  // card on the plaster ground; this is deliberately quieter than all of it.
  ends: { marginBottom: Spacing.md },
  endsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.xs,
  },
  endsTitle: { fontSize: Typography.sm, color: Colors.textMuted },
  endsList: { paddingHorizontal: Spacing.xs },
  end: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    minHeight: MIN_TOUCH_TARGET,
  },
  endBody: { flex: 1, minWidth: 0 },
  endTitle: { fontSize: Typography.sm, color: Colors.textPrimary },
  endDetail: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  endsMore: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  deleteHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
});

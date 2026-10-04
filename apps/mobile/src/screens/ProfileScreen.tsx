import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import InstallCard from '../components/InstallCard';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  deleteMyAccount, deleteStoredFiles, getAllProjects, getMyAccountDeletions, getMyData,
  getMyOrphanFilePaths, getSnags,
  signOut, upsertProfile,
} from '../lib/supabase';
import { describePlaces, exportDateStamp, looseEnds, type LooseEnd } from '@snag/supabase-queries';
import { saveFile } from '../lib/download';
import { showAlert } from '../lib/alert';
import { openUrl } from '../lib/openUrl';
import { PORTAL_URL } from '../lib/appUrl';
import { AccountDeletion, RootStackParamList } from '../types';

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
  const insets = useEdgeInsets();
  const { profile, household, members, locations, properties, reloadAccount } = useHousehold();
  const { showToast } = useToast();

  const [name, setName] = useState(profile.displayName);
  const [saving, setSaving] = useState(false);
  const [ends, setEnds] = useState<LooseEnd[]>([]);
  const [endsOpen, setEndsOpen] = useState(false);
  const [gathering, setGathering] = useState(false);

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
  /** What deleting would actually delete, read when Delete is pressed. Null when it couldn't be read. */
  const [deletes, setDeletes] = useState<AccountDeletion[] | null>(null);

  /**
   * Asks the server what would go before asking the person. A household goes
   * only if this account owns it and nobody else is in it (20261004100000), and
   * the confirmation names it rather than warning in general.
   */
  async function askDeleteAccount() {
    try {
      setDeletes(await getMyAccountDeletions());
    } catch (err) {
      console.error('Failed to read what deleting would delete:', err);
      setDeletes(null);
    }
    setConfirmDelete(true);
  }

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

  /**
   * Everything Snag holds that this account can see, as one JSON file.
   *
   * One read, one file. The server decides what is in it (RLS, as the
   * caller), so nothing here filters. It is a single JSON document rather
   * than a zip, because a zip would be a dependency for a button pressed once
   * a year. A refusal is a sentence rather than a thrown screen, because this
   * is also the screen people sign out from.
   */
  async function handleDownloadData() {
    if (gathering) return;
    setGathering(true);
    try {
      const data = await getMyData();
      const fileName = `snag-data-${exportDateStamp()}.json`;
      const saved = await saveFile(fileName, JSON.stringify(data, null, 2), 'application/json');
      showToast(saved.path ? `Saved to ${saved.path}` : 'Your data is downloading');
    } catch (err: any) {
      showAlert("Couldn't gather your data", err?.message ?? 'Please try again.');
    } finally {
      setGathering(false);
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

      {/* No Projects switch here for v1. The tab is off by default, and on only
          for the accounts it was turned on for in SQL
          (20260929214206_projects_are_off_for_v1). A switch that offered it to
          everybody would be offering a renovation tab the launch does not
          include. `profiles.projects_enabled` still decides the tab. */}

      {/* The list's card asks once; this stays for as long as Snag is open
          in a browser tab, for somebody who closed the card and wants it
          back. Absent everywhere else. */}
      <InstallCard variant="row" />

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

      {/* A copy of what is kept, which the Privacy Act says a person may ask
          for. Quiet, beside the account's other rare doors. */}
      <Button
        label="Download my data"
        variant="ghost"
        onPress={handleDownloadData}
        loading={gathering}
        fullWidth
      />

      {/* Signing out is the everyday door and deleting is the other one, so it
          sits below, quieter, and asks for the name to be typed — the same gate
          deleting a place uses, for the same reason: this one takes other
          people's work with it if you are the only one in the house. */}
      <Button
        label="Delete my account"
        variant="ghost"
        onPress={askDeleteAccount}
        fullWidth
      />
      <Text style={styles.deleteHint}>
        A household goes with you only if you made it and nobody else is in it. Ones you share
        stay, and a place you own that somebody else is on is handed to them.
      </Text>

      {/* The statement Create account links to, reachable again once signed
          in — the right to see and correct what is kept is not only for the
          moment of signing up. */}
      <View style={styles.legalLinks}>
        <Pressable
          onPress={() => openUrl(`${PORTAL_URL}/privacy`)}
          style={styles.privacyLink}
          accessibilityRole="link"
        >
          <Text style={styles.privacyText}>Privacy statement</Text>
        </Pressable>
        <Pressable
          onPress={() => openUrl(`${PORTAL_URL}/terms`)}
          style={styles.privacyLink}
          accessibilityRole="link"
        >
          <Text style={styles.privacyText}>Terms</Text>
        </Pressable>
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete your account?"
        message={describeAccountDeletion(deletes)}
        confirmLabel="Delete"
        confirmText={profile.displayName}
        destructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDelete(false)}
      />
    </ScrollView>
  );
}

/**
 * The confirmation's words: what would actually be deleted, by name. Unread
 * (null) says the rule rather than guessing at the answer.
 */
export function describeAccountDeletion(deletes: AccountDeletion[] | null): string {
  const end = 'This cannot be undone.';
  if (deletes === null) {
    return "You'll be signed out for good. A household you made and nobody else is in is deleted " +
      `with every job, item and photo in it; everything you share stays. ${end}`;
  }
  if (deletes.length === 0) {
    return "You'll be signed out for good. Nothing is deleted with you: you leave each household, " +
      `and a place you own that somebody else is on is handed to them. ${end}`;
  }
  const named = deletes.map((d) => {
    const places = d.propertyNames.filter((n) => n !== d.householdName);
    return places.length > 0 ? `${d.householdName} (${describePlaces(places, '')})` : d.householdName;
  });
  return `You'll be signed out for good, and ${describePlaces(named, '')} — nobody else is in ` +
    `${deletes.length === 1 ? 'it' : 'them'} — ${deletes.length === 1 ? 'is' : 'are'} deleted with ` +
    `every job, item and photo. Everything you share stays. ${end}`;
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
  legalLinks: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xl },
  privacyLink: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
  },
  privacyText: { fontSize: Typography.sm, color: Colors.textMuted },
  deleteHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
});

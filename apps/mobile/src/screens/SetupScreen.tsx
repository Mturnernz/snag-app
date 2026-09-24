import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  acceptInvitation, createHousehold, declineInvitation, getMyInvitations, signOut, upsertProfile,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { parseJoinToken } from '../lib/joinLink';
import { InvitationToMe, Profile } from '../types';

interface Props {
  /** Null for an account that hasn't given a name yet. */
  profile: Profile | null;
  onReady: () => Promise<void>;
  /**
   * A link pasted on the waiting screen. It hands the code to the same join
   * question a scanned or tapped link reaches — one way in, not two.
   */
  onJoinToken?: (token: string) => void;
}

/**
 * Everything between signing up and using the app — which for a household is
 * two text fields, once, ever.
 *
 * The retired product needed eleven screens here: choose or create an
 * organisation, scan or paste a join code, pick a site, set up an admin, watch
 * an onboarding carousel. All of that existed to get a stranger into a company.
 * Nobody is a stranger to their own house.
 *
 * The second person doesn't create anything — they're invited by the first, at
 * the address they sign up with, and this is where they answer it.
 *
 * **That answer used to be nobody's to give.** Adding somebody required them to
 * have already signed up *and* saved a name; before that, the person doing the
 * adding got *That account has not finished signing up yet*, which named an
 * order nothing had published and blamed the wrong end. Now the invitation
 * waits at the address, this screen finds it, and the person it names decides —
 * Join, or No thanks. An invitation you can't refuse is an instruction.
 */
export default function SetupScreen({ profile, onReady, onJoinToken }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [householdName, setHouseholdName] = useState('');
  const [saving, setSaving] = useState(false);
  const [joining, setJoining] = useState(false);
  const [invitations, setInvitations] = useState<InvitationToMe[]>([]);
  const [checking, setChecking] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [pasted, setPasted] = useState('');
  const pastedToken = parseJoinToken(pasted);

  // Only ever looked for once there is a profile to accept with — accept_invitation
  // needs one, and asking before the name is saved would find nothing and say so
  // for the wrong reason.
  const loadInvitations = useCallback(async () => {
    if (!profile) return;
    setChecking(true);
    try {
      setInvitations(await getMyInvitations());
    } catch (err) {
      console.error('Failed to check for invitations:', err);
    } finally {
      setChecking(false);
    }
  }, [profile]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  async function handleCreate() {
    if (!name.trim() || !householdName.trim()) return;
    setSaving(true);
    try {
      await upsertProfile(name.trim());
      await createHousehold(householdName.trim());
      await onReady();
    } catch (err: any) {
      showAlert("Couldn't set that up", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleWaitToBeAdded() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Saving the name is what lets this account accept: accept_invitation
      // needs a profile, because a household member with no name is a blank row
      // in every list. Unlike before, nobody else is blocked while it is missing.
      await upsertProfile(name.trim());
      setJoining(true);
      setInvitations(await getMyInvitations());
    } catch (err: any) {
      showAlert("Couldn't save your name", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAnswer(invitationId: string, join: boolean) {
    setAnswering(true);
    try {
      if (join) {
        await acceptInvitation(invitationId);
        // App.tsx re-gates on this and lands them in the house.
        await onReady();
      } else {
        await declineInvitation(invitationId);
        setInvitations(await getMyInvitations());
      }
    } catch (err: any) {
      showAlert("Couldn't do that", err?.message ?? 'Please try again.');
    } finally {
      setAnswering(false);
    }
  }

  // An invitation is worth showing the moment it exists, whichever branch they
  // are on: somebody who signed up first and is staring at "Set up your house"
  // should not have to guess that the answer is behind the second button.
  if (invitations.length > 0) {
    const invitation = invitations[0];
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Icon name="home-outline" size="xxl" color={Colors.primary} />
        <Text style={styles.title}>{invitation.householdName} wants to add you</Text>
        <Text style={styles.body}>
          {invitation.invitedByName} invited you. Everyone in a household can see and change
          everything in it, and you can leave whenever you like.
        </Text>
        <Button
          label="Join"
          onPress={() => handleAnswer(invitation.id, true)}
          loading={answering}
          disabled={answering}
          fullWidth
        />
        <Button
          label="No thanks"
          variant="outline"
          onPress={() => handleAnswer(invitation.id, false)}
          disabled={answering}
          fullWidth
        />
      </View>
    );
  }

  if (joining) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Icon name="home-outline" size="xxl" color={Colors.primary} />
        <Text style={styles.title}>You're ready</Text>
        <Text style={styles.body}>
          Ask whoever set up your household to invite you — they'll need the email address you
          just signed up with. Snag doesn't email you, so their invitation will simply be here when
          you next look.
        </Text>
        <Button
          label="Check again"
          onPress={loadInvitations}
          loading={checking}
          disabled={checking}
          fullWidth
        />

        {/* The other way in. Somebody who signed up before they were sent
            anything had *Check again* and nothing else; if a link has since
            arrived in a message, pasting it here is quicker than finding and
            tapping it. */}
        {onJoinToken ? (
          <View style={styles.paste}>
            <Text style={styles.label}>Been sent a link?</Text>
            <TextInput
              style={styles.input}
              value={pasted}
              onChangeText={setPasted}
              placeholder="Paste it here"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Paste an invite link"
            />
            {pasted.trim() && !pastedToken ? (
              <Text style={styles.pasteMiss}>That doesn't look like a Snag invite link.</Text>
            ) : null}
            <Button
              label="Use this link"
              variant="outline"
              onPress={() => pastedToken && onJoinToken(pastedToken)}
              disabled={!pastedToken}
              fullWidth
            />
          </View>
        ) : null}
        <Button label="Sign out" variant="ghost" onPress={() => signOut()} fullWidth />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.xxxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Icon name="home" size="xxl" color={Colors.primary} />
        <Text style={styles.title}>Set up your house</Text>

        <Text style={styles.label}>What should we call you?</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Mike"
          placeholderTextColor={Colors.textMuted}
          maxLength={80}
          autoCapitalize="words"
        />

        <Text style={styles.label}>And the house?</Text>
        <TextInput
          style={styles.input}
          value={householdName}
          onChangeText={setHouseholdName}
          placeholder="Home"
          placeholderTextColor={Colors.textMuted}
          maxLength={80}
          autoCapitalize="words"
        />

        <Button
          label="Create it"
          onPress={handleCreate}
          loading={saving}
          disabled={!name.trim() || !householdName.trim() || saving}
          fullWidth
          style={styles.primaryAction}
        />

        <Text style={styles.divider}>or</Text>

        <Button
          label="Someone else set ours up"
          variant="outline"
          onPress={handleWaitToBeAdded}
          disabled={!name.trim() || saving}
          fullWidth
        />

        <Button label="Sign out" variant="ghost" onPress={() => signOut()} fullWidth />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, gap: Spacing.sm, alignItems: 'stretch' },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.xl,
    gap: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  body: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },
  paste: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.lg },
  pasteMiss: { fontSize: Typography.sm, color: Colors.textMuted },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  primaryAction: { marginTop: Spacing.xl },
  divider: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: Typography.sm,
    marginVertical: Spacing.sm,
  },
});

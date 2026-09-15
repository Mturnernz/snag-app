import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { acceptInvitationByToken, getInvitationByToken, upsertProfile } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { InvitationByToken, Profile } from '../types';

interface Props {
  token: string;
  /**
   * Null for somebody who has just signed up, which is the normal case here —
   * they scanned a code, so they have an account and nothing else yet. The name
   * is asked for on this screen rather than on Setup, because a scanner is not
   * setting up a house and must never be shown a screen that says they are.
   */
  profile: Profile | null;
  /** Re-reads the account in App.tsx — joining changes which household it shows. */
  onJoined: () => Promise<void>;
  /** Takes the code out of the address bar and returns to wherever they were. */
  onDismiss: () => void;
}

/**
 * The far end of a QR code: what you see having pointed your camera at one.
 *
 * It is a gate in App.tsx rather than a route, because it has to be answerable
 * *before* the navigator exists — the normal case is somebody who has just
 * signed up and has no household for the navigator to render. `/join/<token>`
 * is deliberately absent from `linking.ts` for the same reason: a matched path
 * would send React Navigation somewhere while this is trying to ask a question.
 *
 * **It runs before a profile exists**, and that is the fix for the bug that
 * shipped: the gate used to require one, so a brand-new scanner fell through to
 * Setup — whose first offer is *Create it* and which says nothing about a code.
 * Alyssa scanned 32 Le Roy and made a second household of the same name. So if
 * there is no name yet this screen asks for it, and joining is still one press.
 *
 * Three answers, and all three are real:
 *
 * - **A live code** names the house and who is offering it, and asks. An
 *   invitation you can't refuse is an instruction.
 * - **A dead code** — expired, or revoked — says so in words and offers the way
 *   on. Somebody scanning yesterday's screenshot is not an error state.
 * - **A code for a house you're already in** says that instead of asking, because
 *   people scan twice and the second scan must not read as a fresh invitation.
 */
export default function JoinScreen({ token, profile, onJoined, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const [invitation, setInvitation] = useState<InvitationByToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState(profile?.displayName ?? '');

  const needsName = !profile;

  const load = useCallback(async () => {
    try {
      setInvitation(await getInvitationByToken(token));
    } catch (err) {
      console.error('Failed to read the join code:', err);
      setInvitation(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleJoin() {
    if (needsName && !name.trim()) return;
    setJoining(true);
    try {
      // accept_invitation_by_token refuses an account with no profile, because a
      // household member with no name is a blank row in every list. Saving it
      // here keeps that true without making them visit a screen about setting
      // up a house they are not setting up.
      if (needsName) await upsertProfile(name.trim());
      await acceptInvitationByToken(token);
      // Clear the code first: onJoined re-gates the whole app, and a token left
      // in the address bar would ask the same question again on the next reload.
      onDismiss();
      await onJoined();
    } catch (err: any) {
      showAlert("Couldn't join", err?.message ?? 'Please try again.');
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!invitation) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Icon name="time-outline" size="xxl" color={Colors.textMuted} />
        <Text style={styles.title}>That code has expired</Text>
        <Text style={styles.body}>
          A join code lasts a day. Ask whoever showed it to you for a new one.
        </Text>
        <Button label="Carry on" onPress={onDismiss} fullWidth />
      </View>
    );
  }

  if (invitation.alreadyAMember) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Icon name="checkmark-circle-outline" size="xxl" color={Colors.primary} />
        <Text style={styles.title}>You're already in {invitation.householdName}</Text>
        <Text style={styles.body}>Nothing to do — the code was for a house you're in.</Text>
        <Button label="Carry on" onPress={onDismiss} fullWidth />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.centered, { paddingTop: insets.top }]}
        keyboardShouldPersistTaps="handled"
      >
        <Icon name="home-outline" size="xxl" color={Colors.primary} />
        <Text style={styles.title}>Join {invitation.householdName}?</Text>
        <Text style={styles.body}>
          {invitation.invitedByName} shared this code. Everyone in a household can see and change
          everything in it, and you can leave whenever you like.
        </Text>

        {needsName ? (
          <>
            <Text style={styles.label}>What should we call you?</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Alyssa"
              placeholderTextColor={Colors.textMuted}
              maxLength={80}
              autoCapitalize="words"
              accessibilityLabel="What should we call you?"
            />
          </>
        ) : null}

        <Button
          label="Join"
          onPress={handleJoin}
          loading={joining}
          disabled={joining || (needsName && !name.trim())}
          fullWidth
          style={styles.joinButton}
        />
        <Button
          label="No thanks"
          variant="outline"
          onPress={onDismiss}
          disabled={joining}
          fullWidth
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  label: {
    alignSelf: 'stretch',
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  input: {
    alignSelf: 'stretch',
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
  joinButton: { marginTop: Spacing.sm },
  centered: {
    flexGrow: 1,
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
    textAlign: 'center',
  },
  body: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
});

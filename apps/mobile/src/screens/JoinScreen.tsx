import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Spacing, Typography } from '../constants/theme';
import { acceptInvitationByToken, getInvitationByToken } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { InvitationByToken } from '../types';

interface Props {
  token: string;
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
 * Three answers, and all three are real:
 *
 * - **A live code** names the house and who is offering it, and asks. An
 *   invitation you can't refuse is an instruction.
 * - **A dead code** — expired, or revoked — says so in words and offers the way
 *   on. Somebody scanning yesterday's screenshot is not an error state.
 * - **A code for a house you're already in** says that instead of asking, because
 *   people scan twice and the second scan must not read as a fresh invitation.
 */
export default function JoinScreen({ token, onJoined, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const [invitation, setInvitation] = useState<InvitationByToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

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
    setJoining(true);
    try {
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
    <View style={[styles.centered, { paddingTop: insets.top }]}>
      <Icon name="home-outline" size="xxl" color={Colors.primary} />
      <Text style={styles.title}>Join {invitation.householdName}?</Text>
      <Text style={styles.body}>
        {invitation.invitedByName} shared this code. Everyone in a household can see and change
        everything in it, and you can leave whenever you like.
      </Text>
      <Button label="Join" onPress={handleJoin} loading={joining} disabled={joining} fullWidth />
      <Button
        label="No thanks"
        variant="outline"
        onPress={onDismiss}
        disabled={joining}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
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

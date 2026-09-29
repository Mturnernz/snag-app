import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import SetupShell, { setupStyles } from '../SetupShell';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import { Group, Row } from '../../components/Grouped';
import { Colors, Spacing } from '../../constants/theme';
import {
  acceptInvitation, createHousehold, declineInvitation, getMyInvitations, signOut,
} from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import { parseJoinToken } from '../../lib/joinLink';
import { InvitationToMe } from '../../types';
import { firstName, type StepProps } from '../types';

type Page = 'choose' | 'name' | 'waiting';

/**
 * A house of your own, or somebody else's — the phone's *Set up as new* or
 * *Transfer from another*.
 *
 * One step with three pages rather than three steps, because it is one
 * question: which house is this person in. The dots count it once.
 *
 * **An invitation beats the question.** Somebody who has been asked into a
 * house and is looking at "Start a new house" must not have to guess that the
 * answer is behind the other door — Alyssa made a second 32 Le Roy that way,
 * one gate over. So when one is waiting it is the whole screen, and it is a
 * choice rather than an instruction: Join, or No thanks.
 *
 * Nothing here emails anybody, and the waiting page says so. What the
 * invitation row buys is that the two people can do their halves in either
 * order; telling each other is still done out loud.
 */
export default function HouseholdStep({
  ctx, progress, onBack, onNext, onReady, onJoinToken,
}: StepProps) {
  const [page, setPage] = useState<Page>('choose');
  const [invitations, setInvitations] = useState<InvitationToMe[]>([]);
  const [checking, setChecking] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [houseName, setHouseName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pasted, setPasted] = useState('');
  const pastedToken = parseJoinToken(pasted);

  // A name is saved by the step before, and accept_invitation needs one — so
  // by now there is always a profile to look invitations up with.
  const loadInvitations = useCallback(async () => {
    if (!ctx.profile) return;
    setChecking(true);
    try {
      setInvitations(await getMyInvitations());
    } catch (err) {
      console.error('Failed to check for invitations:', err);
    } finally {
      setChecking(false);
    }
  }, [ctx.profile]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  async function handleAnswer(invitationId: string, join: boolean) {
    setAnswering(true);
    try {
      if (join) {
        await acceptInvitation(invitationId);
        await onReady();
        onNext();
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

  async function handleCreate() {
    const name = houseName.trim();
    if (!name) return;
    setCreating(true);
    try {
      // One answer, both names. A household and its first place are two rows
      // but one thing to the person naming them, and "Home" under a house they
      // called 32 Le Roy is a name nobody chose.
      await createHousehold(name, name);
      await onReady();
      onNext();
    } catch (err: any) {
      showAlert("Couldn't set that up", err?.message ?? 'Please try again.');
    } finally {
      setCreating(false);
    }
  }

  if (invitations.length > 0) {
    const invitation = invitations[0];
    return (
      <SetupShell
        progress={progress}
        onBack={onBack}
        icon="home-outline"
        title={`${invitation.householdName} wants to add you`}
        body={`${invitation.invitedByName} invited you. Everyone in a household can see and change everything in it, and you can leave whenever you like.`}
        primary={{
          label: 'Join',
          onPress: () => handleAnswer(invitation.id, true),
          loading: answering,
        }}
        secondary={{
          label: 'No thanks',
          onPress: () => handleAnswer(invitation.id, false),
          disabled: answering,
        }}
      />
    );
  }

  if (page === 'name') {
    return (
      <SetupShell
        progress={progress}
        onBack={() => setPage('choose')}
        icon="home-outline"
        title="What do you call your place?"
        body="The name on the list everyone in the house shares."
        primary={{
          label: 'Create it',
          onPress: handleCreate,
          disabled: !houseName.trim(),
          loading: creating,
        }}
      >
        <TextInput
          style={setupStyles.input}
          value={houseName}
          onChangeText={setHouseName}
          maxLength={80}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleCreate}
          accessibilityLabel="Your place's name"
          autoFocus
        />
      </SetupShell>
    );
  }

  if (page === 'waiting') {
    return (
      <SetupShell
        progress={progress}
        onBack={() => setPage('choose')}
        icon="hourglass-outline"
        title="You're ready"
        body="Ask whoever set up your house to invite you — with a link, or the email address you signed up with. Snag doesn't email you, so their invitation will simply be here when you next look."
        primary={{ label: 'Check again', onPress: loadInvitations, loading: checking }}
        secondary={{ label: 'Start a new house instead', onPress: () => setPage('name') }}
      >
        {/* The other way in. A link that has since arrived in a message is
            quicker pasted here than found and tapped. */}
        {onJoinToken ? (
          <View style={styles.paste}>
            <Text style={setupStyles.label}>Been sent a link?</Text>
            <TextInput
              style={setupStyles.input}
              value={pasted}
              onChangeText={setPasted}
              placeholder="Paste it here"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Paste an invite link"
            />
            {pasted.trim() && !pastedToken ? (
              <Text style={setupStyles.hint}>That doesn't look like a Snag invite link.</Text>
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
      </SetupShell>
    );
  }

  const first = firstName(ctx.profile?.displayName);
  return (
    <SetupShell
      progress={progress}
      onBack={onBack}
      icon="sparkles-outline"
      title={first ? `Nice to meet you, ${first}` : 'Nice to meet you'}
      body="Are you setting up your house, or joining one somebody already has?"
    >
      <Group>
        <Row
          leading={<Icon name="add-circle-outline" size="lg" color={Colors.primary} />}
          title="Start a new house"
          subtitle="You'll be the first one in it"
          onPress={() => setPage('name')}
        />
        <Row
          leading={<Icon name="people-outline" size="lg" color={Colors.primary} />}
          title="Join someone's house"
          subtitle="They'll send you a link, or invite your email"
          onPress={() => setPage('waiting')}
        />
      </Group>
      {/* A whole button rather than a word in a sentence: a 13pt link is a
          target nobody can hit one-handed. */}
      <Button label="Not you? Sign out" variant="ghost" onPress={() => signOut()} fullWidth />
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  paste: { gap: Spacing.sm, marginTop: Spacing.sm },
});

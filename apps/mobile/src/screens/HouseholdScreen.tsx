import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { Invitation, InvitationToMe } from '../types';
import { useToast } from '../hooks/useToast';
import {
  acceptInvitation, cancelInvitation, createInviteLink, createProperty, declineInvitation,
  deleteHousehold, deleteProperty, deleteStoredFiles, getHouseholdFilePaths,
  getHouseholdInvitations, getMyInvitations, getPropertyMemberIds, getSnags, getThings,
  inviteToHousehold, removeMember, renameProperty, revokeInviteLink, setPropertyMember,
} from '../lib/supabase';
import { joinUrl } from '@snag/supabase-queries';
import { APP_URL } from '../lib/appUrl';
import { copyToClipboard } from '../lib/clipboard';
import QrCode, { QrCaption } from '../components/QrCode';
import { showAlert } from '../lib/alert';

/**
 * The whole of household management: who's here, where the places are, adding
 * one more person — and, since 20260914160000, taking any of it away again.
 *
 * Adding is by email address, and **the address does not need an account yet**.
 * It used to: `add_member_by_email` refused anybody who hadn't both signed up
 * and saved a name, so the honest answer to "add my partner" was *That account
 * has not finished signing up yet* — shown to the one person who couldn't do
 * anything about it, naming an order nothing had published. An invitation waits
 * on the address instead, so the two halves can happen in either order.
 *
 * **Nothing is emailed and nothing here says it was.** That is the line the
 * retired product crossed: its `invite_user` wrote the row, returned, and the
 * app said "Invite sent" — and no invite was ever emailed for the life of the
 * feature. The failure was the claim, not the row. A waiting invitation is
 * called waiting, and telling them is still something you do out loud.
 *
 * Removing is the half that was missing. Every RPC behind it refuses the case
 * that strands a row nobody can reach — the last member of a household, the
 * last place in one — and says which, so the way out is named rather than
 * guessed at.
 */
export default function HouseholdScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const {
    household, members, profile, properties, activeProperty, refresh, reloadAccount,
  } = useHousehold();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [newPlace, setNewPlace] = useState('');
  const [addingPlace, setAddingPlace] = useState(false);
  /** property id -> the profile ids linked to it. */
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [busyLink, setBusyLink] = useState(false);

  /** Which places a newly invited person lands on. Only asked once there's a choice. */
  const [startOn, setStartOn] = useState<string[]>([]);

  /** Invitations this household is waiting on, and ones waiting on me. */
  const [waiting, setWaiting] = useState<Invitation[]>([]);
  const [mine, setMine] = useState<InvitationToMe[]>([]);
  const [busyInvite, setBusyInvite] = useState(false);
  /** The household's one live join code, if it is being shared right now. */
  const [link, setLink] = useState<Invitation | null>(null);
  const [busyLink2, setBusyLink2] = useState(false);

  /** The place being renamed, and the text so far. Null when nothing is. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  // Submitting a field also blurs it, so both handlers fire from two different
  // render closures holding the same `renaming` — two RPCs and two toasts for
  // one edit. Clearing the state doesn't help; the second closure never sees it.
  const renameBusy = useRef(false);

  /** Who's about to be removed — them, or you leaving. */
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDeleteHouse, setConfirmDeleteHouse] = useState(false);
  /** The place about to go, with the count of what goes with it. */
  const [confirmPlace, setConfirmPlace] = useState<
    { id: string; name: string; snags: number; things: number } | null
  >(null);

  const alone = members.length <= 1;

  // Only meaningful once there is more than one place: with one, everybody in
  // the household is on it and there is nothing to show.
  const loadLinks = useCallback(async () => {
    if (properties.length < 2) return;
    try {
      const pairs = await Promise.all(
        properties.map(async (p) => [p.id, await getPropertyMemberIds(p.id)] as const)
      );
      setLinks(Object.fromEntries(pairs));
    } catch (err) {
      console.error('Failed to load property links:', err);
    }
  }, [properties]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  // Both directions of the same table: who this house is waiting on, and who is
  // waiting on me. The second is why an invitation to somebody who already has
  // a household isn't invisible — with no switcher, that would be an invitation
  // nothing could ever show them.
  const loadInvitations = useCallback(async () => {
    try {
      const [ours, toMe] = await Promise.all([
        getHouseholdInvitations(household.id),
        getMyInvitations(),
      ]);
      // One table, two ways of being addressed. A link is not a person waiting,
      // so it never belongs in the Waiting rows under Who's here.
      setWaiting(ours.filter((i) => !i.token));
      setLink(ours.find((i) => !!i.token) ?? null);
      setMine(toMe);
    } catch (err) {
      console.error('Failed to load invitations:', err);
    }
  }, [household.id]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  // Default the new-member places to the one being looked at, so the common
  // answer is already selected and the question costs nothing to skip.
  useEffect(() => {
    setStartOn((current) => {
      const live = current.filter((id) => properties.some((p) => p.id === id));
      if (live.length > 0) return live;
      const fallback = activeProperty?.id ?? properties[0]?.id;
      return fallback ? [fallback] : [];
    });
  }, [properties, activeProperty]);

  async function handleAddPlace() {
    const name = newPlace.trim();
    if (!name) return;
    setAddingPlace(true);
    try {
      await createProperty(household.id, name);
      setNewPlace('');
      await refresh();
      showToast(`${name} added`);
    } catch (err: any) {
      showAlert("Couldn't add that place", err?.message ?? 'Please try again.');
    } finally {
      setAddingPlace(false);
    }
  }

  async function handleRename() {
    if (!renaming || renameBusy.current) return;
    const name = renaming.value.trim();
    const was = properties.find((p) => p.id === renaming.id)?.name;
    setRenaming(null);
    if (!name || name === was) return;
    renameBusy.current = true;
    try {
      await renameProperty(renaming.id, name);
      await refresh();
      showToast('Renamed');
    } catch (err: any) {
      showAlert("Couldn't rename that place", err?.message ?? 'Please try again.');
    } finally {
      renameBusy.current = false;
    }
  }

  async function handleToggleLink(propertyId: string, profileId: string, linked: boolean) {
    setBusyLink(true);
    try {
      await setPropertyMember(propertyId, profileId, linked);
      await loadLinks();
      await refresh();
    } catch (err: any) {
      showAlert("Couldn't change that", err?.message ?? 'Please try again.');
    } finally {
      setBusyLink(false);
    }
  }

  async function handleInvite() {
    const address = email.trim();
    if (!address) return;
    setAdding(true);
    try {
      // With one place everyone shares it, so the default (all properties) is
      // right. With a bach it is not: someone invited to the household should
      // not silently land on every place — nor on whichever one happened to be
      // first, which is what this did before the chips above existed.
      await inviteToHousehold(
        household.id,
        address,
        properties.length > 1 ? startOn : undefined
      );
      setEmail('');
      await loadInvitations();
      // Deliberately not "Invite sent". Nothing was sent. What is true is that
      // the invitation is now waiting, and that they still have to hear it from
      // you — which is the whole of what the retired product got wrong.
      showToast('Waiting for them — tell them to sign up with that address');
    } catch (err: any) {
      showAlert("Couldn't invite them", err?.message ?? 'Please try again.');
    } finally {
      setAdding(false);
    }
  }

  async function handleShowCode() {
    setBusyLink2(true);
    try {
      setLink(await createInviteLink(
        household.id,
        properties.length > 1 ? startOn : undefined
      ));
    } catch (err: any) {
      showAlert("Couldn't make a code", err?.message ?? 'Please try again.');
    } finally {
      setBusyLink2(false);
    }
  }

  async function handleStopSharing() {
    setBusyLink2(true);
    try {
      await revokeInviteLink(household.id);
      setLink(null);
      showToast('Code stopped');
    } catch (err: any) {
      showAlert("Couldn't stop sharing", err?.message ?? 'Please try again.');
    } finally {
      setBusyLink2(false);
    }
  }

  async function handleCancelInvite(invitationId: string) {
    try {
      await cancelInvitation(invitationId);
      await loadInvitations();
      showToast('Invitation cancelled');
    } catch (err: any) {
      showAlert("Couldn't cancel that", err?.message ?? 'Please try again.');
    }
  }

  async function handleAnswerInvite(invitationId: string, join: boolean) {
    setBusyInvite(true);
    try {
      if (join) {
        await acceptInvitation(invitationId);
        // App.tsx re-gates: getMyHousehold reads newest-join-first, so this is
        // the household the app shows from here.
        await reloadAccount();
      } else {
        await declineInvitation(invitationId);
        await loadInvitations();
        showToast('Declined');
      }
    } catch (err: any) {
      showAlert("Couldn't do that", err?.message ?? 'Please try again.');
    } finally {
      setBusyInvite(false);
    }
  }

  async function handleRemoveMember(profileId: string) {
    setConfirmRemove(null);
    try {
      await removeMember(household.id, profileId);
      await refresh();
      showToast('Removed');
    } catch (err: any) {
      showAlert("Couldn't remove them", err?.message ?? 'Please try again.');
    }
  }

  async function handleLeave() {
    setConfirmLeave(false);
    try {
      await removeMember(household.id, profile.id);
      // App.tsx re-gates on this: it lands on whichever household is left, or
      // on Setup when there is none.
      await reloadAccount();
    } catch (err: any) {
      showAlert("Couldn't leave", err?.message ?? 'Please try again.');
    }
  }

  async function handleDeleteHousehold() {
    setConfirmDeleteHouse(false);
    try {
      // Files first, and this is the one place that order is inverted. The
      // storage delete policy asks `home.is_member(<household id>)`, so
      // deleting the household takes away the permission to clean up after it
      // — and deleteStoredFiles never throws, so every refusal would pass in
      // silence. See 20260914161000.
      await deleteStoredFiles(await getHouseholdFilePaths(household.id));
      await deleteHousehold(household.id);
      await reloadAccount();
    } catch (err: any) {
      showAlert("Couldn't delete this household", err?.message ?? 'Please try again.');
    }
  }

  /** Counts what a place is holding, so the confirmation can name it rather than warn in general. */
  async function askDeletePlace(propertyId: string, name: string) {
    try {
      const [snags, things] = await Promise.all([
        getSnags({ propertyId }),
        getThings(propertyId),
      ]);
      setConfirmPlace({ id: propertyId, name, snags: snags.length, things: things.length });
    } catch (err: any) {
      showAlert("Couldn't check that place", err?.message ?? 'Please try again.');
    }
  }

  async function handleDeletePlace() {
    if (!confirmPlace) return;
    const { id, name } = confirmPlace;
    setConfirmPlace(null);
    try {
      // The RPC answers with every storage key its cascade just orphaned —
      // photos and manuals both — because SQL cannot clear them itself.
      const orphaned = await deleteProperty(id);
      await deleteStoredFiles(orphaned);
      await refresh();
      showToast(`${name} deleted`);
    } catch (err: any) {
      showAlert("Couldn't delete that place", err?.message ?? 'Please try again.');
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader title={household.name} onBack={() => navigation.goBack()} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Who's here</Text>
          {members.map((member) => {
            const isYou = member.profileId === profile.id;
            return (
              <View key={member.profileId} style={styles.memberRow}>
                <Avatar name={member.displayName} size={36} />
                <Text style={styles.memberName}>
                  {member.displayName}
                  {isYou ? ' (you)' : ''}
                </Text>
                {/* Nothing to remove when you're the only one here: the RPC
                    refuses it, and the way out is the button at the foot. */}
                {!isYou && !alone ? (
                  <Pressable
                    onPress={() => setConfirmRemove({ id: member.profileId, name: member.displayName })}
                    style={styles.rowAction}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${member.displayName}`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {/* A waiting invitation is drawn lighter than a member and says so in
              words, because the one thing it must never read as is somebody who
              is already here. */}
          {waiting.map((invitation) => (
            <View key={invitation.id} style={styles.memberRow}>
              <View style={styles.waitingMark}>
                <Icon name="hourglass-outline" size="sm" color={Colors.textMuted} />
              </View>
              <View style={styles.waitingBody}>
                <Text style={styles.waitingEmail} numberOfLines={1}>{invitation.email}</Text>
                <Text style={styles.waitingHint}>Waiting — they need to sign up with this address</Text>
              </View>
              <Pressable
                onPress={() => handleCancelInvite(invitation.id)}
                style={styles.rowAction}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Cancel the invitation to ${invitation.email}`}
              >
                <Icon name="close" size="sm" color={Colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </Card>

        {/* An invitation addressed to me. It lives here rather than only on the
            Setup screen because somebody who already has a household never sees
            that screen, and an invitation nothing can show is the silent
            failure this whole mechanism exists to avoid. */}
        {mine.map((invitation) => (
          <Card key={invitation.id} elevation="md" style={styles.section}>
            <Text style={styles.sectionTitle}>{invitation.householdName} wants to add you</Text>
            <Text style={styles.sectionHint}>
              {invitation.invitedByName} invited you. Joining replaces the household this app is
              showing you; you can leave again at any time.
            </Text>
            <View style={styles.answerRow}>
              <Button
                label="No thanks"
                variant="outline"
                onPress={() => handleAnswerInvite(invitation.id, false)}
                disabled={busyInvite}
                style={styles.answerButton}
              />
              <Button
                label="Join"
                onPress={() => handleAnswerInvite(invitation.id, true)}
                disabled={busyInvite}
                style={styles.answerButton}
              />
            </View>
          </Card>
        ))}

        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Places</Text>
          <Text style={styles.sectionHint}>
            A second place — a bach, a rental — keeps its own list, its own tags and its own
            people.
          </Text>
          {properties.map((place) => (
            <View key={place.id} style={styles.placeRow}>
              <View style={styles.placeHeader}>
                <Icon name="home-outline" size="md" color={Colors.primary} />
                {renaming?.id === place.id ? (
                  <TextInput
                    style={[styles.input, styles.renameInput]}
                    value={renaming.value}
                    onChangeText={(value) => setRenaming({ id: place.id, value })}
                    onBlur={handleRename}
                    onSubmitEditing={handleRename}
                    maxLength={80}
                    autoCapitalize="words"
                    autoFocus
                    accessibilityLabel={`Rename ${place.name}`}
                  />
                ) : (
                  <Pressable
                    style={styles.placeNameTap}
                    onPress={() => setRenaming({ id: place.id, value: place.name })}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${place.name}`}
                  >
                    <Text style={styles.placeName}>{place.name}</Text>
                  </Pressable>
                )}
                {/* The last place can't go: a household with none can't receive
                    a snag, which is why create_household makes one. */}
                {properties.length > 1 ? (
                  <Pressable
                    onPress={() => askDeletePlace(place.id, place.name)}
                    style={styles.rowAction}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${place.name}`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
              {properties.length > 1 ? (
                <View style={styles.linkRow}>
                  {members.map((member) => {
                    const linked = (links[place.id] ?? []).includes(member.profileId);
                    return (
                      <Pressable
                        key={member.profileId}
                        onPress={() => handleToggleLink(place.id, member.profileId, !linked)}
                        disabled={busyLink}
                        style={[styles.linkChip, linked && styles.linkChipOn]}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: linked }}
                      >
                        <Icon
                          name={linked ? 'checkmark-circle' : 'ellipse-outline'}
                          size="sm"
                          color={linked ? Colors.white : Colors.textMuted}
                        />
                        <Text style={[styles.linkLabel, linked && styles.linkLabelOn]}>
                          {member.profileId === profile.id ? 'You' : member.displayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ))}
          <TextInput
            style={styles.input}
            value={newPlace}
            onChangeText={setNewPlace}
            placeholder="The bach"
            placeholderTextColor={Colors.textMuted}
            maxLength={80}
            autoCapitalize="words"
          />
          <Button
            label="Add a place"
            variant="outline"
            onPress={handleAddPlace}
            loading={addingPlace}
            disabled={!newPlace.trim() || addingPlace}
            fullWidth
            icon="add-outline"
          />
        </Card>

        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Add someone</Text>
          <Text style={styles.sectionHint}>
            Invite the address they'll sign up with. They don't need an account yet — the
            invitation waits until they do. Snag doesn't email them, so tell them yourself.
          </Text>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="alyssa@example.com"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
            />
          </View>
          {/* Asked only once there's a choice to make. It used to send them to
              whichever place happened to be first in the adder's list, and the
              hint underneath asserted that as though somebody had decided it. */}
          {properties.length > 1 ? (
            <>
              <Text style={styles.sectionHint}>Where do they start?</Text>
              <View style={styles.linkRow}>
                {properties.map((place) => {
                  const on = startOn.includes(place.id);
                  return (
                    <Pressable
                      key={place.id}
                      onPress={() =>
                        setStartOn((current) =>
                          on ? current.filter((id) => id !== place.id) : [...current, place.id]
                        )
                      }
                      style={[styles.linkChip, on && styles.linkChipOn]}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Start on ${place.name}`}
                    >
                      <Icon
                        name={on ? 'checkmark-circle' : 'ellipse-outline'}
                        size="sm"
                        color={on ? Colors.white : Colors.textMuted}
                      />
                      <Text style={[styles.linkLabel, on && styles.linkLabelOn]}>{place.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          <Button
            label="Invite them"
            onPress={handleInvite}
            loading={adding}
            disabled={!email.trim() || adding || (properties.length > 1 && startOn.length === 0)}
            fullWidth
            icon="person-add-outline"
          />

          {/* The same invitation, addressed to whoever holds the code instead of
              to an address — one table, one accept path, not a second way in.
              Nothing here scans: their own camera opens the link, which is the
              point, because they haven't installed Snag yet. */}
          <View style={styles.codeBlock}>
            <Text style={styles.orLine}>or, if they're standing right here</Text>
            {link?.token ? (
              <>
                <QrCode value={joinUrl(APP_URL, link.token)} />
                <QrCaption text={joinUrl(APP_URL, link.token)} />
                <Text style={styles.codeHint}>
                  Point their camera at this. It opens Snag and asks them to join — good for a
                  day, and only for whoever you show it to.
                </Text>
                <View style={styles.codeActions}>
                  <Button
                    label="Copy link"
                    variant="outline"
                    onPress={async () => {
                      await copyToClipboard(joinUrl(APP_URL, link.token!));
                      showToast('Link copied');
                    }}
                    style={styles.codeButton}
                  />
                  <Button
                    label="Stop sharing"
                    variant="outline"
                    onPress={handleStopSharing}
                    disabled={busyLink2}
                    style={styles.codeButton}
                  />
                </View>
              </>
            ) : (
              <Button
                label="Show a QR code"
                variant="outline"
                onPress={handleShowCode}
                loading={busyLink2}
                disabled={busyLink2 || (properties.length > 1 && startOn.length === 0)}
                fullWidth
                icon="qr-code-outline"
              />
            )}
          </View>
        </Card>

        <View style={styles.note}>
          <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
          <Text style={styles.noteText}>
            {properties.length > 1
              ? 'Everyone linked to a place can see and change everything at that place. The only permission here is which places someone is on.'
              : 'Everyone in a household can see and change everything. There are no permissions to manage.'}
          </Text>
        </View>

        {/*
          Leaving and deleting are the same door seen from two sides, and which
          one you get is decided by whether anybody else is here: remove_member
          refuses the last member of a household and delete_household refuses
          one that still has somebody in it, so offering both at once would put
          a button on screen that can only ever answer with an error.
        */}
        {alone ? (
          <Button
            label="Delete this household"
            variant="outline"
            onPress={() => setConfirmDeleteHouse(true)}
            fullWidth
            style={styles.leave}
          />
        ) : (
          <Button
            label="Leave this household"
            variant="outline"
            onPress={() => setConfirmLeave(true)}
            fullWidth
            style={styles.leave}
          />
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!confirmRemove}
        title={`Remove ${confirmRemove?.name ?? ''}?`}
        message="They lose this household and everything at its places. Anything they filed stays, still in their name."
        confirmLabel="Remove"
        destructive
        onConfirm={() => confirmRemove && handleRemoveMember(confirmRemove.id)}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        visible={confirmLeave}
        title={`Leave ${household.name}?`}
        message="You lose the list, the house record and the places. Anything you filed stays, still in your name."
        confirmLabel="Leave"
        destructive
        onConfirm={handleLeave}
        onCancel={() => setConfirmLeave(false)}
      />

      <ConfirmDialog
        visible={confirmDeleteHouse}
        title={`Delete ${household.name}?`}
        message="You're the only one here, so this deletes the household and everything in it — every place, every snag, every photo. It cannot be undone."
        confirmLabel="Delete"
        confirmText={household.name}
        destructive
        onConfirm={handleDeleteHousehold}
        onCancel={() => setConfirmDeleteHouse(false)}
      />

      <ConfirmDialog
        visible={!!confirmPlace}
        title={`Delete ${confirmPlace?.name ?? ''}?`}
        message={
          confirmPlace
            ? `${confirmPlace.snags} ${confirmPlace.snags === 1 ? 'snag' : 'snags'} and ` +
              `${confirmPlace.things} ${confirmPlace.things === 1 ? 'thing' : 'things'} go with it, ` +
              'along with its rooms and every photo. It cannot be undone.'
            : undefined
        }
        confirmLabel="Delete"
        confirmText={confirmPlace?.name}
        destructive
        onConfirm={handleDeletePlace}
        onCancel={() => setConfirmPlace(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  sectionHint: { fontSize: Typography.sm, color: Colors.textMuted },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  memberName: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  // Muted and small on purpose: removing somebody is rare, and a destructive
  // control drawn loudly is one that gets pressed by accident.
  rowAction: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // A waiting invitation carries no avatar: an avatar is a person who is here,
  // and the whole job of this row is to not read as one.
  waitingMark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.sunken,
  },
  waitingBody: { flex: 1, minWidth: 0 },
  waitingEmail: { fontSize: Typography.base, color: Colors.textSecondary },
  waitingHint: { fontSize: Typography.sm, color: Colors.textMuted },
  answerRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  answerButton: { flex: 1 },
  codeBlock: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  orLine: { fontSize: Typography.sm, color: Colors.textMuted, textAlign: 'center' },
  codeHint: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  codeActions: { flexDirection: 'row', gap: Spacing.sm },
  codeButton: { flex: 1 },
  placeRow: {
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  placeHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  // minWidth: 0 so a long name shrinks rather than pushing the × off the card.
  placeNameTap: { flex: 1, minWidth: 0, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  placeName: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  renameInput: { flex: 1, minWidth: 0, marginBottom: 0 },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.button,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  linkChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  linkLabel: { fontSize: Typography.sm, color: Colors.textSecondary },
  linkLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  addRow: { marginTop: Spacing.xs },
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
    marginBottom: Spacing.sm,
  },
  note: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.xs },
  noteText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
  leave: { marginBottom: Spacing.xxxl },
});

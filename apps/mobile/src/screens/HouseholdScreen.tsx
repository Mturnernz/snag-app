import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { describePlaces } from '@snag/supabase-queries';

import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import InviteLinkPanel from '../components/InviteLinkPanel';
import { Pill, TextButton } from '../components/Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { Invitation, InvitationToMe, PlaceMember } from '../types';
import { useToast } from '../hooks/useToast';
import {
  acceptInvitation, cancelInvitation, createHousehold, declineInvitation,
  deleteHousehold, deleteProperty, deleteStoredFiles, getHouseholdFilePaths,
  getHouseholdInvitations, getMyInvitations, getPlaceMembers, getSnags, getThings,
  inviteToHousehold, removeMember, renameProperty, setPropertyLocation,
  setPropertyMember, transferPropertyOwnership,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { rememberHousehold } from '../lib/currentHome';

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
 *
 * **Grouped by place, with an owner on each (20261004100000).** People are let
 * into a place, not a household, and only a place's owner can add, remove,
 * share or delete. On 4 October 2026 a joiner — then made an owner of the whole
 * household — removed the two people who had built it and deleted their own
 * account, which took the household with it. So the × and *Make owner* are the
 * owner's, *Leave* is everybody's, and the server refuses the rest in words.
 *
 * **A home is a household (5 October 2026).** This screen is the household the
 * app is showing, which has one place; the bach is a household of its own,
 * reached from the picker at the top of each tab. *Add another home* makes a
 * new household rather than a second place in this one, so nobody here sees it
 * unless they are invited to it.
 */
export default function HouseholdScreen() {
  const navigation = useNavigation();
  const {
    household, members, profile, properties: allHomes, refresh, reloadAccount,
  } = useHousehold();
  // Every home this person is in is in `allHomes`; this screen is one
  // household's, and the others' places are not its business.
  const properties = useMemo(
    () => allHomes.filter((p) => p.householdId === household.id),
    [allHomes, household.id],
  );
  const { showToast } = useToast();

  const [newPlace, setNewPlace] = useState('');
  const [addingPlace, setAddingPlace] = useState(false);
  /** Who is on each place, and who owns it. */
  const [people, setPeople] = useState<PlaceMember[]>([]);
  const [busyLink, setBusyLink] = useState(false);

  /** Invitations this household is waiting on, and ones waiting on me. */
  const [waiting, setWaiting] = useState<Invitation[]>([]);
  const [links, setLinks] = useState<Invitation[]>([]);
  const [mine, setMine] = useState<InvitationToMe[]>([]);
  const [busyInvite, setBusyInvite] = useState(false);

  /** The place whose email box is open, and what is typed in it. Secondary to the link. */
  const [emailFor, setEmailFor] = useState<{ placeId: string; value: string } | null>(null);
  const [adding, setAdding] = useState(false);

  /** The place being renamed, and the text so far. Null when nothing is. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  /** Which place is having its suburb and town typed in, if any. */
  const [locating, setLocating] = useState<
    { id: string; suburb: string; town: string } | null
  >(null);
  const locateBusy = useRef(false);
  // Submitting a field also blurs it, so both handlers fire from two different
  // render closures holding the same `renaming` — two RPCs and two toasts for
  // one edit. Clearing the state doesn't help; the second closure never sees it.
  const renameBusy = useRef(false);

  /** Somebody about to be taken off a place, or you leaving one. */
  const [confirmRemove, setConfirmRemove] = useState<
    { placeId: string; placeName: string; id: string; name: string } | null
  >(null);
  /** Somebody about to be made an owner of a place. */
  const [confirmOwner, setConfirmOwner] = useState<
    { placeId: string; placeName: string; id: string; name: string } | null
  >(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDeleteHouse, setConfirmDeleteHouse] = useState(false);
  /** The place about to go, with the count of what goes with it. */
  const [confirmPlace, setConfirmPlace] = useState<
    { id: string; name: string; snags: number; things: number } | null
  >(null);

  const alone = members.length <= 1;
  const ownsHousehold = members.some((m) => m.profileId === profile.id && m.role === 'owner');

  const peopleOn = (placeId: string) => people.filter((m) => m.propertyId === placeId);
  const ownsPlace = (placeId: string) =>
    people.some((m) => m.propertyId === placeId && m.profileId === profile.id && m.role === 'owner');

  const loadPeople = useCallback(async () => {
    try {
      setPeople(await getPlaceMembers(properties.map((p) => p.id)));
    } catch (err) {
      console.error('Failed to load who is on each place:', err);
    }
  }, [properties]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  // Both directions of the same table: who this house is waiting on, and who is
  // waiting on me. The second is how somebody who already has a household is
  // asked into another: setup never shows them anything again.
  const loadInvitations = useCallback(async () => {
    try {
      const [ours, toMe] = await Promise.all([
        getHouseholdInvitations(household.id),
        getMyInvitations(),
      ]);
      // One table, two ways of being addressed. A link is not a person waiting,
      // so it never belongs in the Waiting rows.
      setWaiting(ours.filter((i) => !i.token));
      setLinks(ours.filter((i) => !!i.token));
      setMine(toMe);
    } catch (err) {
      console.error('Failed to load invitations:', err);
    }
  }, [household.id]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  /** The live link for exactly this place. An old one naming no place counts while there is one place. */
  function linkFor(placeId: string): Invitation | null {
    return links.find((i) =>
      (i.propertyIds.length === 1 && i.propertyIds[0] === placeId)
      || (i.propertyIds.length === 0 && properties.length === 1)) ?? null;
  }

  function setLinkFor(placeId: string, next: Invitation | null) {
    setLinks((current) => {
      const rest = current.filter((i) => i !== linkFor(placeId));
      return next ? [...rest, next] : rest;
    });
  }

  /**
   * Another home is another household — the bach, a rental, a parent's place —
   * owned by whoever adds it and seen by nobody else until they invite them.
   * One name for both, as setup writes it. Remembered first, so the account
   * re-read opens on it and this screen becomes its screen, ready to share.
   */
  async function handleAddHome() {
    const name = newPlace.trim();
    if (!name) return;
    setAddingPlace(true);
    try {
      const home = await createHousehold(name, name);
      await rememberHousehold(home.id);
      setNewPlace('');
      await reloadAccount();
      showToast(`${name} added`);
    } catch (err: any) {
      showAlert("Couldn't add that home", err?.message ?? 'Please try again.');
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
      // A home's household takes its place's name (20261005120000), and the
      // household is read with the account, so both are read again.
      await refresh();
      await reloadAccount();
      showToast('Renamed');
    } catch (err: any) {
      showAlert("Couldn't rename that place", err?.message ?? 'Please try again.');
    } finally {
      renameBusy.current = false;
    }
  }

  /**
   * Where a place is, for the one question its name cannot answer.
   *
   * Suburb and town, and deliberately not a street address: the only thing it
   * is read for is finding a tradesman in the right part of the country, and it
   * rides out of the app in every briefed extract — which is a file that gets
   * forwarded. Saved on blur like the rename beside it, and both values go
   * together so whichever field was left last cannot half-write the answer.
   */
  async function handleLocation() {
    if (!locating || locateBusy.current) return;
    const place = properties.find((p) => p.id === locating.id);
    const suburb = locating.suburb.trim();
    const town = locating.town.trim();
    const unchanged = suburb === (place?.suburb ?? '') && town === (place?.town ?? '');
    setLocating(null);
    if (unchanged) return;
    locateBusy.current = true;
    try {
      await setPropertyLocation(locating.id, suburb, town);
      await refresh();
      showToast(suburb || town ? 'Saved' : 'Cleared');
    } catch (err: any) {
      showAlert("Couldn't save where that is", err?.message ?? 'Please try again.');
    } finally {
      locateBusy.current = false;
    }
  }

  /** Puts somebody already in the household on a place. Owners only; the server says so too. */
  async function handleAddToPlace(placeId: string, profileId: string) {
    setBusyLink(true);
    try {
      await setPropertyMember(placeId, profileId, true);
      await loadPeople();
      await refresh();
    } catch (err: any) {
      showAlert("Couldn't add them", err?.message ?? 'Please try again.');
    } finally {
      setBusyLink(false);
    }
  }

  /**
   * Takes somebody off a place, or you. Leaving the last place you are on in
   * this household leaves the household too, so the account is re-read then.
   */
  async function handleRemoveFromPlace() {
    if (!confirmRemove) return;
    const { placeId, id } = confirmRemove;
    setConfirmRemove(null);
    try {
      await setPropertyMember(placeId, id, false);
      if (id === profile.id) {
        await reloadAccount();
        return;
      }
      await loadPeople();
      await refresh();
      showToast('Removed');
    } catch (err: any) {
      showAlert("Couldn't do that", err?.message ?? 'Please try again.');
    }
  }

  async function handleMakeOwner() {
    if (!confirmOwner) return;
    const { placeId, id, name, placeName } = confirmOwner;
    setConfirmOwner(null);
    try {
      await transferPropertyOwnership(placeId, id);
      await loadPeople();
      showToast(`${name} owns ${placeName} too`);
    } catch (err: any) {
      showAlert("Couldn't hand it on", err?.message ?? 'Please try again.');
    }
  }

  async function handleInvite(placeId: string) {
    const address = emailFor?.placeId === placeId ? emailFor.value.trim() : '';
    if (!address) return;
    setAdding(true);
    try {
      await inviteToHousehold(household.id, address, [placeId]);
      setEmailFor(null);
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
        // Another home, alongside this one: open on it, since somebody who has
        // just said yes is about to look at it.
        const joined = mine.find((i) => i.id === invitationId);
        if (joined) await rememberHousehold(joined.householdId);
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
      {/* ScreenHeader pads the top inset itself; padding here too doubled it. */}
      <View>
        <ScreenHeader title={household.name} onBack={() => navigation.goBack()} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* An invitation addressed to me. It lives here rather than only on the
            Setup screen because somebody who already has a household never sees
            that screen, and an invitation nothing can show is the silent
            failure this whole mechanism exists to avoid. */}
        {mine.map((invitation) => {
          const where = describePlaces(invitation.propertyNames ?? [], invitation.householdName);
          return (
            <Card key={invitation.id} elevation="md" style={styles.section}>
              <Text style={styles.sectionTitle}>Join {where}?</Text>
              <Text style={styles.sectionHint}>
                {invitation.invitedByName} invited you to {where}. It joins your other homes — switch
                between them from the top of the List — and you can leave whenever you like.
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
          );
        })}

        {/* One card per place, because people are let into a place rather than
            into the household: the bach's people are not the house's. Each
            place has an owner, and only the owner can add, remove or share. */}
        {properties.map((place) => {
          const onPlace = peopleOn(place.id);
          const owner = ownsPlace(place.id);
          const waitingHere = waiting.filter((i) => i.propertyIds.includes(place.id)
            || (i.propertyIds.length === 0 && properties.length === 1));
          const notHere = members.filter((m) => !onPlace.some((p) => p.profileId === m.profileId));
          const emailOpen = emailFor?.placeId === place.id;
          return (
            <Card key={place.id} elevation="md" style={styles.section}>
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
                    <Text style={styles.sectionTitle}>{place.name}</Text>
                  </Pressable>
                )}
                {/* The last place can't go: a household with none can't receive
                    a snag, which is why create_household makes one. And only
                    its owner can delete it. */}
                {owner && properties.length > 1 ? (
                  <Pressable
                    onPress={() => askDeletePlace(place.id, place.name)}
                    style={styles.rowAction}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${place.name}`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>

              {/* Under the name, because it is a fact about the place rather
                  than an action on it. */}
              {locating?.id === place.id ? (
                <View style={styles.whereRow}>
                  <TextInput
                    style={[styles.input, styles.whereInput]}
                    value={locating.suburb}
                    onChangeText={(suburb) => setLocating({ ...locating, suburb })}
                    onBlur={handleLocation}
                    onSubmitEditing={handleLocation}
                    placeholder="Suburb"
                    placeholderTextColor={Colors.textMuted}
                    maxLength={80}
                    autoCapitalize="words"
                    autoFocus
                    accessibilityLabel={`Suburb for ${place.name}`}
                  />
                  <TextInput
                    style={[styles.input, styles.whereInput]}
                    value={locating.town}
                    onChangeText={(town) => setLocating({ ...locating, town })}
                    onBlur={handleLocation}
                    onSubmitEditing={handleLocation}
                    placeholder="Town or city"
                    placeholderTextColor={Colors.textMuted}
                    maxLength={80}
                    autoCapitalize="words"
                    accessibilityLabel={`Town for ${place.name}`}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => setLocating({
                    id: place.id,
                    suburb: place.suburb ?? '',
                    town: place.town ?? '',
                  })}
                  style={styles.whereTap}
                  accessibilityRole="button"
                  accessibilityLabel={`Where ${place.name} is`}
                >
                  <Icon name="location-outline" size="sm" color={Colors.textMuted} />
                  <Text style={styles.whereLabel}>
                    {[place.suburb, place.town].filter(Boolean).join(', ')
                      || 'Say where it is, for finding somebody local'}
                  </Text>
                </Pressable>
              )}

              {onPlace.map((person) => {
                const isYou = person.profileId === profile.id;
                return (
                  <View key={person.profileId} style={styles.memberRow}>
                    <Avatar name={person.displayName} size={36} />
                    <View style={styles.memberBody}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {person.displayName}
                        {isYou ? ' (you)' : ''}
                      </Text>
                      {person.role === 'owner' ? (
                        <Text style={styles.ownerLabel}>Owner</Text>
                      ) : null}
                    </View>
                    {/* Anybody can leave, unless nobody would be left. */}
                    {isYou && onPlace.length > 1 ? (
                      <TextButton
                        label="Leave"
                        accessibilityLabel={`Leave ${place.name}`}
                        onPress={() => setConfirmRemove({
                          placeId: place.id, placeName: place.name, id: person.profileId, name: person.displayName,
                        })}
                      />
                    ) : null}
                    {!isYou && owner && person.role !== 'owner' ? (
                      <Pill
                        label="Make owner"
                        accessibilityLabel={`Make ${person.displayName} an owner of ${place.name}`}
                        onPress={() => setConfirmOwner({
                          placeId: place.id, placeName: place.name, id: person.profileId, name: person.displayName,
                        })}
                      />
                    ) : null}
                    {/* The × is the owner's alone. A member taking the owner
                        off was the first step of 4 October 2026. */}
                    {!isYou && owner ? (
                      <Pressable
                        onPress={() => setConfirmRemove({
                          placeId: place.id, placeName: place.name, id: person.profileId, name: person.displayName,
                        })}
                        style={styles.rowAction}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${person.displayName}`}
                      >
                        <Icon name="close" size="sm" color={Colors.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}

              {/* A waiting invitation is drawn lighter than a member and says so
                  in words, because the one thing it must never read as is
                  somebody who is already here. */}
              {waitingHere.map((invitation) => (
                <View key={invitation.id} style={styles.memberRow}>
                  <View style={styles.waitingMark}>
                    <Icon name="hourglass-outline" size="sm" color={Colors.textMuted} />
                  </View>
                  <View style={styles.waitingBody}>
                    <Text style={styles.waitingEmail} numberOfLines={1}>{invitation.email}</Text>
                    <Text style={styles.waitingHint}>Waiting — they need to sign up with this address</Text>
                  </View>
                  {owner ? (
                    <Pressable
                      onPress={() => handleCancelInvite(invitation.id)}
                      style={styles.rowAction}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel the invitation to ${invitation.email}`}
                    >
                      <Icon name="close" size="sm" color={Colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {owner && notHere.length > 0 ? (
                <View style={styles.linkRow}>
                  {notHere.map((m) => (
                    <Pill
                      key={m.profileId}
                      label={`+ ${m.displayName}`}
                      accessibilityLabel={`Add ${m.displayName} to ${place.name}`}
                      disabled={busyLink}
                      onPress={() => handleAddToPlace(place.id, m.profileId)}
                    />
                  ))}
                </View>
              ) : null}

              {owner ? (
                <View style={styles.codeBlock}>
                  <Text style={styles.subTitle}>Share {place.name}</Text>
                  {/* The link first, into the phone's own share sheet, with the
                      QR beside it. It lets them into this place only, as a
                      member. The address invitation stays, second. */}
                  <InviteLinkPanel
                    householdId={household.id}
                    placeName={place.name}
                    propertyIds={[place.id]}
                    link={linkFor(place.id)}
                    onLink={(next) => setLinkFor(place.id, next)}
                  />
                  {emailOpen ? (
                    <View style={styles.addRow}>
                      <TextInput
                        style={styles.input}
                        value={emailFor?.value ?? ''}
                        onChangeText={(value) => setEmailFor({ placeId: place.id, value })}
                        placeholder="Their email address"
                        placeholderTextColor={Colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        inputMode="email"
                        autoFocus
                        accessibilityLabel="Their email address"
                      />
                      <Text style={styles.sectionHint}>
                        Snag doesn't email them — the invitation waits until they sign up with it,
                        so tell them yourself.
                      </Text>
                      <Button
                        label="Invite them"
                        variant="outline"
                        onPress={() => handleInvite(place.id)}
                        loading={adding}
                        disabled={!emailFor?.value.trim() || adding}
                        fullWidth
                        icon="person-add-outline"
                      />
                    </View>
                  ) : (
                    <TextButton
                      label="Or invite an email address"
                      accessibilityLabel={`Invite an email address to ${place.name}`}
                      onPress={() => setEmailFor({ placeId: place.id, value: '' })}
                    />
                  )}
                </View>
              ) : (
                <Text style={styles.sectionHint}>
                  The owner of {place.name} decides who is on it.
                </Text>
              )}
            </Card>
          );
        })}

        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Add another home</Text>
          <Text style={styles.sectionHint}>
            A bach, a rental, a parent's place — a separate household with its own list and its
            own people. Only people you invite will see it.
          </Text>
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
            label="Add another home"
            variant="outline"
            onPress={handleAddHome}
            loading={addingPlace}
            disabled={!newPlace.trim() || addingPlace}
            fullWidth
            icon="add-outline"
          />
        </Card>

        <View style={styles.note}>
          <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
          <Text style={styles.noteText}>
            Everyone on a place can see and change its jobs and its house record. Only its owner
            can add or remove people, share it or delete it. Anybody can leave.
          </Text>
        </View>

        {/*
          Leaving and deleting are the same door seen from two sides, and which
          one you get is decided by whether anybody else is here: remove_member
          refuses the last member of a household and delete_household refuses
          one that still has somebody in it — or a caller who does not own it.
        */}
        {alone ? (
          ownsHousehold ? (
            <Button
              label="Delete this household"
              variant="outline"
              onPress={() => setConfirmDeleteHouse(true)}
              fullWidth
              style={styles.leave}
            />
          ) : null
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
        title={confirmRemove?.id === profile.id
          ? `Leave ${confirmRemove?.placeName ?? ''}?`
          : `Remove ${confirmRemove?.name ?? ''} from ${confirmRemove?.placeName ?? ''}?`}
        message={confirmRemove?.id === profile.id
          ? "You lose its jobs and its house record. Anything you filed stays, still in your name."
          : 'They lose its jobs and its house record. Anything they filed stays, still in their name.'}
        confirmLabel={confirmRemove?.id === profile.id ? 'Leave' : 'Remove'}
        destructive
        onConfirm={handleRemoveFromPlace}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        visible={!!confirmOwner}
        title={`Make ${confirmOwner?.name ?? ''} an owner of ${confirmOwner?.placeName ?? ''}?`}
        message="An owner can add and remove people — you included — share it, and delete it."
        confirmLabel="Make owner"
        onConfirm={handleMakeOwner}
        onCancel={() => setConfirmOwner(null)}
      />

      <ConfirmDialog
        visible={confirmLeave}
        title={`Leave ${household.name}?`}
        message="You lose the list, the house record and the places. A place you own that somebody else is on is handed to them. Anything you filed stays, still in your name."
        confirmLabel="Leave"
        destructive
        onConfirm={handleLeave}
        onCancel={() => setConfirmLeave(false)}
      />

      <ConfirmDialog
        visible={confirmDeleteHouse}
        title={`Delete ${household.name}?`}
        message="You're the only one here, so this deletes the household and everything in it — every place, every job, every photo. It cannot be undone."
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
            ? `${confirmPlace.snags} ${confirmPlace.snags === 1 ? 'job' : 'jobs'} and ` +
              `${confirmPlace.things} ${confirmPlace.things === 1 ? 'item' : 'items'} go with it, ` +
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
  memberBody: { flex: 1, minWidth: 0 },
  memberName: { fontSize: Typography.base, color: Colors.textPrimary },
  // A label, not a hue: ownership is a fact about a person, not a state.
  ownerLabel: { fontSize: Typography.xs, color: Colors.textMuted, fontWeight: Typography.semibold },
  subTitle: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
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
  whereRow: { flexDirection: 'row', gap: Spacing.sm },
  // minWidth: 0 because on web a TextInput is an <input> with an intrinsic
  // ~20-character width that `min-width: auto` will not shrink below, and a
  // flexed one grows past the card and off the screen edge.
  whereInput: { flex: 1, minWidth: 0, marginBottom: 0 },
  whereTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  whereLabel: { flex: 1, fontSize: Typography.xs, color: Colors.textMuted },
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

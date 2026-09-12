import React, { useCallback, useEffect, useState } from 'react';
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
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  addMemberByEmail, createProperty, getPropertyMemberIds, setPropertyMember,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';

/**
 * The whole of household management: who's in it, and adding one more person.
 *
 * Adding is by email address, against an account that already exists. There is
 * no invite token, no email delivery and no pending state — which also means
 * none of the ways the retired product's invite pipeline failed. That one wrote
 * the invite row and returned; the RPC succeeded, the app said "Invite sent",
 * and no invite was ever emailed for the entire life of the feature. Nothing
 * that can't fail silently is worth building here for two people.
 */
export default function HouseholdScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { household, members, profile, properties, refresh, reloadAccount } = useHousehold();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [newPlace, setNewPlace] = useState('');
  const [addingPlace, setAddingPlace] = useState(false);
  /** property id -> the profile ids linked to it. */
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [busyLink, setBusyLink] = useState(false);

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

  async function handleAdd() {
    const address = email.trim();
    if (!address) return;
    setAdding(true);
    try {
      // With one place everyone shares it, so the default (all properties) is
      // right. With a bach it is not: someone added to the household should
      // not silently land on every place, so the caller names them.
      await addMemberByEmail(
        household.id,
        address,
        properties.length > 1 ? properties.slice(0, 1).map((p) => p.id) : undefined
      );
      setEmail('');
      await refresh();
      await reloadAccount();
      showToast('Added to the household');
    } catch (err: any) {
      showAlert("Couldn't add them", err?.message ?? 'Please try again.');
    } finally {
      setAdding(false);
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
          {members.map((member) => (
            <View key={member.profileId} style={styles.memberRow}>
              <Avatar name={member.displayName} size={36} />
              <Text style={styles.memberName}>
                {member.displayName}
                {member.profileId === profile.id ? ' (you)' : ''}
              </Text>
            </View>
          ))}
        </Card>

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
                <Text style={styles.placeName}>{place.name}</Text>
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
            They need to sign up first. Then add them with the address they used.
            {properties.length > 1
              ? ` They'll start on ${properties[0].name}; link them to anywhere else above.`
              : ''}
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
          <Button
            label="Add to household"
            onPress={handleAdd}
            loading={adding}
            disabled={!email.trim() || adding}
            fullWidth
            icon="person-add-outline"
          />
        </Card>

        <View style={styles.note}>
          <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
          <Text style={styles.noteText}>
            {properties.length > 1
              ? 'Everyone linked to a place can see and change everything at that place. The only permission here is which places someone is on.'
              : 'Everyone in a household can see and change everything. There are no permissions to manage.'}
          </Text>
        </View>
      </ScrollView>
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
  memberName: { fontSize: Typography.base, color: Colors.textPrimary },
  placeRow: {
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  placeHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  placeName: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
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
});

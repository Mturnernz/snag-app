import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
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
import { addMemberByEmail } from '../lib/supabase';
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
  const { household, members, profile, refresh, reloadAccount } = useHousehold();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    const address = email.trim();
    if (!address) return;
    setAdding(true);
    try {
      await addMemberByEmail(household.id, address);
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
          <Text style={styles.sectionTitle}>Add someone</Text>
          <Text style={styles.sectionHint}>
            They need to sign up first. Then add them with the address they used.
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
            Everyone in a household can see and change everything. There are no permissions to
            manage.
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

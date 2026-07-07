import React, { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  SnagKind,
  KIND_LABELS,
  RootStackParamList,
} from '../types';
import { Colors, Spacing, Typography, IconSize, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase, getProfile, getDefaultSiteId, createSnag } from '../lib/supabase';
import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import Chip from '../components/Chip';
import Button from '../components/Button';
import Icon from '../components/Icon';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as SnagKind[])
  .filter((k) => k === 'fixit' || k === 'improvement') // hazard/incident belong to the serious lane
  .map((k) => ({ key: k, label: KIND_LABELS[k] }));

export default function ReportIssueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const photoPickerRef = useRef<PhotoPickerHandle>(null);

  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<SnagKind>('fixit');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const profile = await getProfile(user.id);
      setOrgId(profile?.org_id ?? null);
    })();
  }, []);

  async function handleSubmit() {
    if (!description.trim()) {
      Alert.alert('Description required', "Tell us what's wrong.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const profile = await getProfile(user.id);
      if (!profile?.org_id) throw new Error('No organisation found');

      const siteId = await getDefaultSiteId(profile.org_id);
      if (!siteId) throw new Error('No site found for your organisation');

      const photoPaths = await photoPickerRef.current?.getPhotoUrls() ?? [];

      const { data, error } = await createSnag({
        kind,
        description: description.trim(),
        severity: null,
        photoPaths,
        latitude: null,
        longitude: null,
        siteId,
      });

      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReference(data?.reference ?? null);
      setSubmitted(true);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not submit snag.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setDescription('');
    setKind('fixit');
    photoPickerRef.current?.reset();
    setSubmitted(false);
    setReference(null);
  }

  if (submitted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Report a Snag</Text>
        </View>
        <View style={styles.successContainer}>
          <View style={styles.successIconWrap}>
            <Icon name="checkmark" size={IconSize.xl} color={Colors.white} />
          </View>
          <Text style={styles.successTitle}>Snag reported!</Text>
          <Text style={styles.successMessage}>
            {reference ? `${reference} has` : 'Your snag has'} been submitted and the team will be notified.
          </Text>
          <Button label="Report Another Snag" onPress={resetForm} fullWidth />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Report a Snag</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <PhotoPicker ref={photoPickerRef} orgId={orgId} onUploadingChange={setIsPhotoUploading} />

        {/* Description — the only required field on the fast path */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>
              What's wrong? <Text style={styles.required}>*</Text>
            </Text>
            <Text style={[styles.charCount, description.length > 270 && styles.charCountWarn]}>
              {description.length} / 300
            </Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="e.g. Broken fire exit door in the main warehouse"
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={300}
          />
        </View>

        {/* Type — always visible, no longer tucked behind a collapse */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Type</Text>
          <Chip options={KIND_OPTIONS} value={kind} onChange={setKind} variant="segmented" />
        </View>

        {/* Submit — one primary action */}
        <Button
          label="Submit Report"
          onPress={handleSubmit}
          loading={submitting}
          disabled={isPhotoUploading}
          fullWidth
        />

        {/* Serious lane — clearly clickable, but visually quieter than the primary CTA */}
        <Button
          label="Report a Serious Incident"
          variant="seriousOutline"
          icon="warning-outline"
          onPress={() => navigation.navigate('ReportIncidentDetails')}
          fullWidth
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },

  fieldGroup: {
    gap: Spacing.sm,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  required: {
    color: Colors.danger,
  },
  charCount: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },
  charCountWarn: {
    color: Colors.danger,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  textArea: {
    minHeight: 100,
    paddingTop: Spacing.sm,
  },

  // Success confirmation
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  successTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});

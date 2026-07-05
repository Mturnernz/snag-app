import React, { useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  IssueCategory,
  IssuePriority,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  RootStackParamList,
} from '../types';
import { Colors, Spacing, Typography, IconSize, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase } from '../lib/supabase';
import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import CollapsibleSection from '../components/CollapsibleSection';
import Chip from '../components/Chip';
import Button from '../components/Button';
import Icon from '../components/Icon';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as IssueCategory[]).map((c) => ({
  key: c,
  label: CATEGORY_LABELS[c],
}));

const PRIORITY_OPTIONS = (Object.keys(PRIORITY_LABELS) as IssuePriority[]).map((p) => ({
  key: p,
  label: PRIORITY_LABELS[p],
}));

export default function ReportIssueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const photoPickerRef = useRef<PhotoPickerHandle>(null);

  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IssueCategory>('niggle');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please give the issue a title.');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('organisation_id')
        .eq('id', user.id)
        .single();

      if (!profile?.organisation_id) throw new Error('No organisation found');

      const photoUrl = await photoPickerRef.current?.getPhotoUrl() ?? null;

      const { error } = await supabase.from('issues').insert({
        title: title.trim(),
        description: description.trim() || null,
        photo_url: photoUrl,
        category,
        priority,
        status: 'open',
        reporter_id: user.id,
        organisation_id: profile.organisation_id,
      });

      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not submit issue.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setTitle('');
    setDescription('');
    setCategory('niggle');
    setPriority('medium');
    photoPickerRef.current?.reset();
    setSubmitted(false);
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
            Your issue has been submitted and the team will be notified.
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
        <PhotoPicker ref={photoPickerRef} onUploadingChange={setIsPhotoUploading} />

        {/* Title — the only required field on the fast path */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>
              Title <Text style={styles.required}>*</Text>
            </Text>
            <Text style={[styles.charCount, title.length > 108 && styles.charCountWarn]}>
              {title.length} / 120
            </Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="e.g. Broken fire exit door"
            placeholderTextColor={Colors.textMuted}
            value={title}
            onChangeText={setTitle}
            returnKeyType="next"
            maxLength={120}
          />
        </View>

        {/* Submit — one primary action */}
        <Button
          label="Submit Report"
          onPress={handleSubmit}
          loading={submitting}
          disabled={isPhotoUploading}
          fullWidth
        />

        {/* Serious lane — subordinate, deliberately quieter than the primary CTA */}
        <TouchableOpacity
          style={styles.incidentLink}
          onPress={() => navigation.navigate('ReportIncidentDetails')}
          activeOpacity={0.7}
        >
          <Icon name="warning-outline" size="sm" color={Colors.serious} />
          <Text style={styles.incidentLinkText}>Report a serious incident instead</Text>
        </TouchableOpacity>

        {/* Progressive disclosure — everything else, collapsed by default */}
        <CollapsibleSection label="More details">
          <View style={styles.fieldGroup}>
            <View style={styles.fieldLabelRow}>
              <Text style={styles.fieldLabel}>Description</Text>
              <Text style={[styles.charCount, description.length > 270 && styles.charCountWarn]}>
                {description.length} / 300
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe the issue in more detail..."
              placeholderTextColor={Colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={300}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Category</Text>
            <Chip options={CATEGORY_OPTIONS} value={category} onChange={setCategory} variant="chip" />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Priority</Text>
            <Chip options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} variant="segmented" />
          </View>
        </CollapsibleSection>
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

  incidentLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  incidentLinkText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.serious,
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

import React, { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { IssuePriority, PRIORITY_LABELS, RootStackParamList } from '../types';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useIncidentDraft } from '../context/IncidentDraftContext';
import ScreenHeader from '../components/ScreenHeader';
import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import Chip from '../components/Chip';
import Button from '../components/Button';
import CategoryBadge from '../components/CategoryBadge';
import ConfirmDialog from '../components/ConfirmDialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PRIORITY_OPTIONS = (Object.keys(PRIORITY_LABELS) as IssuePriority[]).map((p) => ({
  key: p,
  label: PRIORITY_LABELS[p],
}));

export default function ReportIncidentDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const photoPickerRef = useRef<PhotoPickerHandle>(null);
  const { draft, setDraft, setSubmitHandler } = useIncidentDraft();

  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [priority, setPriority] = useState<IssuePriority>(draft.priority);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const touched = title.trim().length > 0 || description.trim().length > 0;

  function handleBack() {
    if (touched) {
      setConfirmDiscard(true);
    } else {
      navigation.goBack();
    }
  }

  function handleNext() {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please describe what happened.');
      return;
    }

    setDraft({ title: title.trim(), description: description.trim(), priority, hasPhoto: !!photoPickerRef.current });

    setSubmitHandler(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { error: 'Not authenticated' };

        const { data: profile } = await supabase
          .from('profiles')
          .select('organisation_id')
          .eq('id', user.id)
          .single();

        if (!profile?.organisation_id) return { error: 'No organisation found' };

        const photoUrl = await photoPickerRef.current?.getPhotoUrl() ?? null;

        const { data, error } = await supabase.from('issues').insert({
          title: title.trim(),
          description: description.trim() || null,
          photo_url: photoUrl,
          category: 'health_and_safety',
          priority,
          status: 'open',
          reporter_id: user.id,
          organisation_id: profile.organisation_id,
        }).select('id').single();

        if (error) return { error: error.message };
        return { issueId: data?.id };
      } catch (err: any) {
        return { error: err.message ?? 'Could not submit incident report.' };
      }
    });

    navigation.navigate('ReportIncidentReview');
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Report a Serious Incident" tone="serious" onBack={handleBack} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Use this for anything involving injury, a near-miss, or a serious health & safety hazard.
          This creates a formal record for your organisation.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.lockedCategory}>
            <CategoryBadge category="health_and_safety" />
            <Text style={styles.lockedHint}>Locked for this flow</Text>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>
            What happened <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Forklift near-miss in loading bay"
            placeholderTextColor={Colors.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={120}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Details</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe what happened, who was involved, and any immediate actions taken..."
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            maxLength={500}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Evidence</Text>
          <PhotoPicker ref={photoPickerRef} onUploadingChange={setIsPhotoUploading} />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Severity</Text>
          <Chip options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} variant="segmented" />
        </View>

        <Button
          label="Next: Review"
          variant="serious"
          onPress={handleNext}
          disabled={isPhotoUploading}
          fullWidth
        />
      </ScrollView>

      <ConfirmDialog
        visible={confirmDiscard}
        title="Discard this report?"
        message="What you've entered so far will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          navigation.goBack();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  intro: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    backgroundColor: Colors.seriousBg,
    borderRadius: Radius.card,
    padding: Spacing.md,
  },
  fieldGroup: {
    gap: Spacing.sm,
  },
  fieldLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  required: {
    color: Colors.danger,
  },
  lockedCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  lockedHint: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
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
    minHeight: 120,
    paddingTop: Spacing.sm,
  },
});

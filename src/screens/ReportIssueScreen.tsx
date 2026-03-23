import React, { useState, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import {
  IssueCategory,
  IssuePriority,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
} from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase, uploadIssuePhoto } from '../lib/supabase';
import { useUserProfile } from '../context/UserProfileContext';

const CATEGORIES: IssueCategory[] = [
  'niggle',
  'broken_equipment',
  'health_and_safety',
  'other',
];

const PRIORITIES: IssuePriority[] = ['low', 'medium', 'high'];

export default function ReportIssueScreen() {
  const insets = useSafeAreaInsets();
  const { userId, orgId } = useUserProfile();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<IssueCategory>('niggle');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // ─── Photo picker ──────────────────────────────────────────────────────────

  // Store the upload promise in a ref so handleSubmit can access it synchronously
  // even if the user taps Submit while compression is still in progress.
  const uploadTaskRef = useRef<Promise<string | null> | null>(null);

  function startCompressAndUpload(uri: string) {
    const fileName = `${Date.now()}.jpg`;
    setIsPhotoUploading(true);
    // Build the full compression→upload pipeline as a single promise chain,
    // assigned to the ref synchronously before any async work begins.
    // This eliminates the race condition where handleSubmit ran before
    // the previous async compressAndUpload set state.
    const task = ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    )
      .then(compressed => uploadIssuePhoto(compressed.uri, fileName))
      .finally(() => setIsPhotoUploading(false));

    uploadTaskRef.current = task;
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
      exif: false,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      startCompressAndUpload(uri);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
      exif: false,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      startCompressAndUpload(uri);
    }
  }


  // ─── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please give the issue a title.');
      return;
    }
    if (!userId || !orgId) {
      Alert.alert('Error', 'Not signed in.');
      return;
    }

    setSubmitting(true);
    try {
      // Await the upload pipeline started when the photo was picked.
      // uploadTaskRef.current is set synchronously so it's always available
      // even if the user submits before compression completes.
      let photoUrl: string | null = null;
      if (photoUri) {
        photoUrl = await (uploadTaskRef.current ?? Promise.resolve(null));
      }

      const { error } = await supabase.from('issues').insert({
        title: title.trim(),
        description: description.trim() || null,
        photo_url: photoUrl,
        category,
        priority,
        status: 'open',
        reporter_id: userId,
        organisation_id: orgId,
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
    setPhotoUri(null);
    setIsPhotoUploading(false);
    uploadTaskRef.current = null;
    setSubmitted(false);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Report a Snag</Text>
        </View>
        <View style={styles.successContainer}>
          <View style={styles.successIconWrap}>
            <Text style={styles.successIcon}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Snag reported!</Text>
          <Text style={styles.successMessage}>
            Your issue has been submitted and the team will be notified.
          </Text>
          <TouchableOpacity style={styles.submitButton} onPress={resetForm} activeOpacity={0.85}>
            <Text style={styles.submitLabel}>Report Another Snag</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
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
        {/* Photo area */}
        {photoUri ? (
          <View style={styles.photoPreviewContainer}>
            <Image
              source={{ uri: photoUri }}
              style={styles.photoPreview}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            {isPhotoUploading && (
              <View style={styles.photoUploadingOverlay}>
                <ActivityIndicator color={Colors.white} size="small" />
                <Text style={styles.photoUploadingText}>Uploading…</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.photoRemoveButton}
              onPress={() => { setPhotoUri(null); uploadTaskRef.current = null; setIsPhotoUploading(false); }}
            >
              <Text style={styles.photoRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.photoArea}>
            <Text style={styles.photoAreaIcon}>📷</Text>
            <Text style={styles.photoAreaLabel}>Add a photo</Text>
            <View style={styles.photoButtonRow}>
              <TouchableOpacity style={styles.photoButton} onPress={takePhoto} activeOpacity={0.7}>
                <Text style={styles.photoButtonText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoButton} onPress={pickFromLibrary} activeOpacity={0.7}>
                <Text style={styles.photoButtonText}>Choose from Library</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Form */}
        <View style={styles.form}>
          {/* Title */}
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

          {/* Description */}
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

          {/* Category */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.segmentRow}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.segmentOption,
                    category === cat && styles.segmentOptionActive,
                  ]}
                  onPress={() => setCategory(cat)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      category === cat && styles.segmentLabelActive,
                    ]}
                    numberOfLines={2}
                  >
                    {CATEGORY_LABELS[cat]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Priority */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Priority</Text>
            <View style={styles.priorityRow}>
              {PRIORITIES.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityOption,
                    priority === p && styles.priorityOptionActive,
                  ]}
                  onPress={() => setPriority(p)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.priorityLabel,
                      priority === p && styles.priorityLabelActive,
                    ]}
                  >
                    {PRIORITY_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.submitLabel}>Submit Report</Text>
            )}
          </TouchableOpacity>
        </View>
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

  // Photo
  photoArea: {
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: Spacing.md,
  },
  photoAreaIcon: { fontSize: 32 },
  photoAreaLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  photoButtonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    width: '100%',
  },
  photoButton: {
    flex: 1,
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  photoButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  photoPreviewContainer: {
    position: 'relative',
    borderRadius: Radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  photoPreview: {
    width: '100%',
    height: 220,
  },
  photoUploadingOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  photoUploadingText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  photoRemoveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: Typography.bold,
  },

  // Form
  form: {
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

  // Category segmented
  segmentRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  segmentOption: {
    flex: 1,
    minWidth: '45%',
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.sm,
  },
  segmentOptionActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  segmentLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  segmentLabelActive: {
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },

  // Priority row
  priorityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  priorityOption: {
    flex: 1,
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  priorityLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  priorityLabelActive: {
    color: Colors.white,
    fontWeight: Typography.semibold,
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
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  successIcon: {
    fontSize: 40,
    color: Colors.white,
    fontWeight: Typography.bold,
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

  // Submit button
  submitButton: {
    height: MIN_TOUCH_TARGET + 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
});

import React, { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Typography, IconSize, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import { getSiteByPublicToken, createPublicSnagByToken, PublicIntakeSite } from '../lib/supabase';
import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import Button from '../components/Button';
import Icon from '../components/Icon';

interface Props {
  token: string;
  userId: string;
}

// Landing screen for a scanned per-site QR code — reached before the normal
// session gate in App.tsx, never inside RootNavigator/the tab bar. Deliberately
// standalone rather than reusing ReportIssueScreen: that screen assumes a full
// navigation stack (org switcher, work groups, serious-incident escalation)
// none of which applies to a one-off anonymous scan-and-report.
export default function PublicQrReportScreen({ token, userId }: Props) {
  const insets = useSafeAreaInsets();
  const photoPickerRef = useRef<PhotoPickerHandle>(null);

  const [site, setSite] = useState<PublicIntakeSite | null | undefined>(undefined); // undefined = loading
  const [photosBlocked, setPhotosBlocked] = useState(false);
  const [description, setDescription] = useState('');
  const [isHazard, setIsHazard] = useState(false);
  const [reporterName, setReporterName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    getSiteByPublicToken(token).then(setSite);
  }, [token]);

  async function handleSubmit() {
    if (!description.trim()) {
      Alert.alert('Description required', "Tell us what's wrong.");
      return;
    }
    if (photosBlocked) {
      Alert.alert('Photo not ready', 'One of your photos is still uploading or failed to upload. Retry or remove it before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const photoPaths = (await photoPickerRef.current?.getPhotoUrls()) ?? [];
      const { data, error } = await createPublicSnagByToken({
        token,
        description: description.trim(),
        photoPaths,
        isHazard,
        reporterName: reporterName.trim() || null,
      });
      if (error) throw error;
      setReference(data?.reference ?? null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not submit your report.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setDescription('');
    setIsHazard(false);
    setReporterName('');
    photoPickerRef.current?.reset();
    setSubmitted(false);
    setReference(null);
  }

  if (site === undefined) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (site === null) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Icon name="qr-code-outline" size={IconSize.xxl} color={Colors.textSecondary} />
        <Text style={styles.successTitle}>This QR code isn't active</Text>
        <Text style={styles.successMessage}>
          It may have been disabled or replaced. Check with the site for an updated code.
        </Text>
      </View>
    );
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
          <Text style={styles.successTitle}>Got it, thanks for flagging this.</Text>
          <Text style={styles.successMessage}>
            {reference ?? 'Your report'} is on its way to {site.siteName} — the team will take a look.
          </Text>
          <Button label="Report Another" onPress={resetForm} fullWidth />
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
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.targetPill}>
          <Icon name="location-outline" size="sm" color={Colors.primary} />
          <Text style={styles.targetPillText}>
            Reporting to: <Text style={styles.targetPillOrg}>{site.siteName}, {site.orgName}</Text>
          </Text>
        </View>

        <PhotoPicker ref={photoPickerRef} pathPrefix={userId} onBlockingChange={setPhotosBlocked} />

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

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Your name (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="So the team knows who reported this"
            placeholderTextColor={Colors.textMuted}
            value={reporterName}
            onChangeText={setReporterName}
          />
        </View>

        <View style={styles.hazardRow}>
          <View style={styles.hazardText}>
            <Text style={styles.fieldLabel}>This is a safety hazard</Text>
            <Text style={styles.hazardHint}>Flags the report for urgent attention</Text>
          </View>
          <Switch
            value={isHazard}
            onValueChange={setIsHazard}
            trackColor={{ false: Colors.border, true: Colors.seriousBg }}
            thumbColor={isHazard ? Colors.serious : Colors.surface}
          />
        </View>

        <Button
          label="Submit Report"
          onPress={handleSubmit}
          loading={submitting}
          disabled={photosBlocked}
          fullWidth
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary },
  scrollContent: { padding: Spacing.lg, gap: Spacing.lg },

  targetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  targetPillText: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary },
  targetPillOrg: { fontWeight: Typography.semibold, color: Colors.textPrimary },

  fieldGroup: { gap: Spacing.xs },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  required: { color: Colors.danger },
  charCount: { fontSize: Typography.xs, color: Colors.textMuted },
  charCountWarn: { color: Colors.danger },
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
  textArea: { minHeight: 84 },

  hazardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
  },
  hazardText: { flex: 1, gap: 2 },
  hazardHint: { fontSize: Typography.xs, color: Colors.textMuted },

  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  successIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary, textAlign: 'center' },
  successMessage: { fontSize: Typography.base, color: Colors.textSecondary, textAlign: 'center' },
});

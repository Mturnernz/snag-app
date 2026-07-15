import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types';
import { Colors, Spacing, Typography } from '../constants/theme';
import { useIncidentDraft } from '../context/IncidentDraftContext';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import CategoryBadge from '../components/CategoryBadge';
import PriorityBadge from '../components/PriorityBadge';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Serious-lane acknowledgment — a slow fade/settle rather than the niggle
// lane's pulse. Composed, not celebratory: this is a formal H&S record.
function SeriousSuccessBlock({ reference, onDone }: { reference: string | null; onDone: () => void }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 500 });
    translateY.value = withTiming(0, { duration: 500 });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.successContainer, animatedStyle]}>
      <Icon name="shield-checkmark-outline" size="xxl" color={Colors.serious} />
      <Text style={styles.successTitle}>This has been logged</Text>
      <Text style={styles.successMessage}>
        {reference ? `${reference} is now` : 'This is now'} a formal record, and the right people have been notified.
      </Text>
      <Button label="Done" variant="serious" onPress={onDone} fullWidth />
    </Animated.View>
  );
}

export default function ReportIncidentReviewScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { draft, reset, submit } = useIncidentDraft();

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    const { error, reference: ref } = await submit();
    setSubmitting(false);
    if (error) {
      Alert.alert('Error', error);
      return;
    }
    setReference(ref ?? null);
    setSubmitted(true);
    // Same acknowledgment haptic as the niggle lane, but no visual pulse —
    // the fade/settle below carries the "composed, not celebratory" tone.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleDone() {
    reset();
    navigation.navigate('Main');
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Report a Serious Incident" tone="serious" onBack={handleDone} />
        <SeriousSuccessBlock reference={reference} onDone={handleDone} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Review Report" tone="serious" />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <Text style={styles.intro}>
          Check the details below before submitting. This will create a formal, timestamped record.
        </Text>

        <Card variant="elevated" style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Type</Text>
            <CategoryBadge kind={draft.kind} />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Severity</Text>
            <PriorityBadge severity={draft.severity} />
          </View>
          <View style={styles.divider} />
          <Text style={styles.label}>What happened</Text>
          <Text style={styles.value}>{draft.description}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Evidence</Text>
            <Text style={styles.value}>
              {draft.photoCount > 0
                ? `${draft.photoCount} photo${draft.photoCount !== 1 ? 's' : ''} attached`
                : 'No photo attached'}
            </Text>
          </View>
        </Card>

        <Button label="Submit Incident Report" variant="serious" onPress={handleSubmit} loading={submitting} fullWidth />
        <Button label="Back to Edit" variant="outline" onPress={() => navigation.goBack()} fullWidth />
        <Button label="Discard" variant="ghost" onPress={() => setConfirmDiscard(true)} fullWidth />
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
          reset();
          navigation.navigate('Main');
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
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  intro: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  card: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: Spacing.xs,
  },
  value: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xs,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
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
    marginBottom: Spacing.md,
  },
});

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography } from '../constants/theme';
import Card from '../components/Card';
import Icon from '../components/Icon';

interface Props {
  onSelectManual: () => void;
  onSelectScan: () => void;
  onBack: () => void;
}

// Shown between "what's your name" and the actual code-resolution step in
// the sign-up stepper, so scanning isn't the only door in — mirrors
// OrgChoiceScreen's card style for the in-app (post-auth) equivalent.
export default function JoinMethodScreen({ onSelectManual, onSelectScan, onBack }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.inner}>
        <Text style={styles.heading}>Join your workplace</Text>
        <Text style={styles.subheading}>How would you like to find your organisation?</Text>

        <TouchableOpacity onPress={onSelectManual} activeOpacity={0.85}>
          <Card variant="elevated" style={styles.optionCard}>
            <Icon name="keypad-outline" size="xl" color={Colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Enter Company Code</Text>
              <Text style={styles.optionDesc}>Type the 8-character code from your admin</Text>
            </View>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity onPress={onSelectScan} activeOpacity={0.85}>
          <Card variant="elevated" style={styles.optionCard}>
            <Icon name="qr-code-outline" size="xl" color={Colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Scan QR Code</Text>
              <Text style={styles.optionDesc}>Scan the workplace code posted on-site</Text>
            </View>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity onPress={onBack} style={styles.backRow}>
          <Icon name="arrow-back" size="sm" color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.lg },
  heading: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary, textAlign: 'center' },
  subheading: { fontSize: Typography.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: -Spacing.sm },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  optionDesc: { fontSize: Typography.sm, color: Colors.textSecondary },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  backText: { fontSize: Typography.sm, color: Colors.primary },
});

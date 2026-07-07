import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getOrgByJoinCode, joinOrgViaCode, OrgJoinPreview } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Card from '../components/Card';
import Icon from '../components/Icon';

interface Props {
  onComplete: () => void;
  onBack: () => void;
}

export default function ScanJoinCodeScreen({ onComplete, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [preview, setPreview] = useState<OrgJoinPreview | null>(null);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan({ data }: BarcodeScanningResult) {
    if (scanned) return;
    setScanned(true);
    setError(null);

    const { data: org, error: lookupError } = await getOrgByJoinCode(data);
    if (lookupError || !org) {
      setError('That QR code is not a valid Snag join code.');
      setScanned(false);
      return;
    }
    setScannedCode(data);
    setPreview(org);
  }

  async function handleJoin() {
    if (!scannedCode) return;
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setAccepting(true);
    setError(null);
    const { error: joinError } = await joinOrgViaCode(scannedCode, name.trim());
    setAccepting(false);
    if (joinError) {
      setError(joinError.message ?? 'That join code is invalid or has expired.');
      return;
    }
    onComplete();
  }

  function retry() {
    setPreview(null);
    setScannedCode(null);
    setName('');
    setError(null);
    setScanned(false);
  }

  if (preview) {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <Text style={styles.heading}>Join {preview.org_name}</Text>
          <Text style={styles.subheading}>You'll join as a worker.</Text>

          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={Colors.textMuted}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            onSubmitEditing={handleJoin}
            autoFocus
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Button label="Join" onPress={handleJoin} loading={accepting} fullWidth />
          <TouchableOpacity onPress={retry} style={styles.backRow}>
            <Icon name="arrow-back" size="sm" color={Colors.primary} />
            <Text style={styles.backText}>Scan a different code</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (!permission) {
    return <View style={[styles.container, { paddingTop: insets.top }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.inner}>
          <Icon name="camera-outline" size="xxl" color={Colors.textSecondary} />
          <Text style={styles.heading}>Camera access needed</Text>
          <Text style={styles.subheading}>Snag needs your camera to scan a join QR code.</Text>
          <Button label="Grant Camera Access" onPress={requestPermission} fullWidth />
          <TouchableOpacity onPress={onBack} style={styles.backRow}>
            <Icon name="arrow-back" size="sm" color={Colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleScan}
      >
        <View style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.overlayText}>Point your camera at the workplace QR code</Text>
          {error && <Text style={styles.overlayError}>{error}</Text>}
        </View>
      </CameraView>
      <Card variant="flat" style={styles.bottomBar}>
        <TouchableOpacity onPress={onBack} style={styles.backRow}>
          <Icon name="arrow-back" size="sm" color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    padding: Spacing.xl,
  },
  frame: {
    width: 220,
    height: 220,
    borderRadius: Radius.card,
    borderWidth: 3,
    borderColor: Colors.white,
  },
  overlayText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    textAlign: 'center',
  },
  overlayError: {
    color: Colors.white,
    backgroundColor: Colors.danger,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.sm,
    textAlign: 'center',
  },
  bottomBar: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
    alignItems: 'stretch',
  },
  heading: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subheading: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: -Spacing.sm,
  },
  input: {
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  errorText: {
    fontSize: Typography.sm,
    color: Colors.danger,
    backgroundColor: Colors.priority.highBg,
    borderRadius: Radius.button,
    padding: Spacing.sm,
    textAlign: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  backText: {
    fontSize: Typography.sm,
    color: Colors.primary,
  },
});

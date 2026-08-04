import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from '../lib/camera';
import { getOrgByJoinCode, joinOrgViaCode, getMemberships, setActiveOrg, OrgJoinPreview } from '../lib/supabase';
import { parseScannedJoinCode } from '../lib/joinLink';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Card from '../components/Card';
import Icon from '../components/Icon';

const LOOKUP_FAILED = "We couldn't check that code just now. Check your connection and try again.";

interface Props {
  onComplete: () => void;
  onBack: () => void;
  /** Pre-auth mode (login screen): a successful scan reports the org back to
   *  the caller instead of joining — joining needs a signed-in user. */
  onCodeScanned?: (org: { code: string; orgId: string; orgName: string }) => void;
  /** Skip the camera: look this code up on mount and go straight to the
   *  join step. Used after sign-up to resume a scan made on the login page. */
  initialCode?: string;
  /** Paired with `initialCode` — when the name was already collected earlier
   *  in the flow (the sign-up stepper), join immediately instead of asking
   *  for it again on the preview step. */
  initialName?: string;
  /** Skip the camera entirely and open straight into manual code entry —
   *  used when the caller offered an explicit "Enter Company Code" choice
   *  rather than defaulting to the camera. */
  startInManualEntry?: boolean;
}

export default function ScanJoinCodeScreen({
  onComplete, onBack, onCodeScanned, initialCode, initialName, startInManualEntry,
}: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [preview, setPreview] = useState<OrgJoinPreview | null>(null);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Always manual on web. `expo-camera` does ship a web scanner, but it decodes
  // by pulling jsQR off a CDN inside a `blob:` Web Worker, which the app's CSP
  // refuses — so the viewfinder would render and never resolve a code. A
  // full-screen camera that cannot work is a worse door than a code field,
  // and manual entry is already an equal path — both converge on the same
  // `resolveCode`. `isManualOnly` below keeps the manual view's Back button
  // from "returning" to a camera this platform never had.
  //
  // That is also why the camera comes from `../lib/camera` rather than
  // `expo-camera` directly: on web that resolves to a stub, so the module
  // whose import alone spawns that worker is never pulled in.
  const isManualOnly = Boolean(startInManualEntry) || Platform.OS === 'web';
  const [manualEntry, setManualEntry] = useState(isManualOnly);
  const [manualCode, setManualCode] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  // Resume mode: the code came from the login page's scan, or from the
  // `?join=` link on a poster. Look it up and jump straight to the join step —
  // or, if the name was already collected too (the sign-up stepper), join
  // immediately instead of asking again.
  useEffect(() => {
    if (!initialCode) return;
    (async () => {
      const { org, code: matched, failed } = await getOrgByJoinCode(initialCode);
      if (failed) {
        setError(LOOKUP_FAILED);
        return;
      }
      if (!org || !matched) {
        setError('That join code is no longer valid — it may have been regenerated. Scan the poster again.');
        return;
      }
      if (initialName && initialName.trim()) {
        setAccepting(true);
        const { error: joinError } = await joinOrgViaCode(matched, initialName.trim());
        setAccepting(false);
        if (joinError) {
          setError(joinError.message ?? 'That join code is invalid or has expired.');
          setName(initialName);
          setScannedCode(matched);
          setPreview(org);
          return;
        }
        onComplete();
        return;
      }
      await routeToOrg(org, matched);
    })();
  }, [initialCode]);

  // Shared by the camera scan and the manual-entry path — resolves a code
  // string to an org and routes into the same scan/switch/join steps either
  // way. Returns whether resolution succeeded (caller resets its own busy
  // state on failure).
  async function resolveCode(code: string, invalidMessage: string): Promise<boolean> {
    const { org, code: matched, failed } = await getOrgByJoinCode(code);
    // A code nobody recognises and a lookup that never completed are different
    // problems and get different words. Telling someone their perfectly good
    // code is invalid sends them to re-read the poster; the code isn't the
    // thing to check.
    if (failed) {
      setError(LOOKUP_FAILED);
      return false;
    }
    if (!org || !matched) {
      setError(invalidMessage);
      return false;
    }

    return routeToOrg(org, matched);
  }

  // What to do once a code has resolved to an org.
  async function routeToOrg(org: OrgJoinPreview, code: string): Promise<boolean> {
    // Pre-auth mode: report the org back to the login screen.
    if (onCodeScanned) {
      onCodeScanned({ code, orgId: org.org_id, orgName: org.org_name });
      return true;
    }

    // Already a member? The scan is a switch, not a join — no name prompt.
    const memberships = await getMemberships();
    if (memberships.some((m) => m.org_id === org.org_id)) {
      const { error: switchError } = await setActiveOrg(org.org_id);
      if (switchError) {
        setError(switchError.message ?? 'Could not switch organisation.');
        return false;
      }
      setSwitchedTo(org.org_name);
      return true;
    }

    setScannedCode(code);
    setPreview(org);
    return true;
  }

  async function handleScan({ data }: BarcodeScanningResult) {
    if (scanned) return;
    setScanned(true);
    setError(null);
    // The QR encodes a link now; bare-code posters are already on walls, so
    // parseScannedJoinCode takes either.
    const code = parseScannedJoinCode(data);
    if (!code) {
      setError('That QR code is not a Snag join code.');
      setScanned(false);
      return;
    }
    const ok = await resolveCode(code, 'That QR code is not a valid Snag join code.');
    if (!ok) setScanned(false);
  }

  async function handleManualSubmit() {
    const code = manualCode.trim();
    if (!code) return;
    setManualSubmitting(true);
    setError(null);
    await resolveCode(code, 'That code is not a valid Snag join code.');
    setManualSubmitting(false);
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

  if (switchedTo) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.inner}>
          <Icon name="swap-horizontal-outline" size="xxl" color={Colors.primary} />
          <Text style={styles.heading}>Now reporting to {switchedTo}</Text>
          <Text style={styles.subheading}>
            Everything you flag and view is scoped to this organisation until you switch again.
          </Text>
          <Button label="Done" onPress={onComplete} fullWidth />
        </View>
      </View>
    );
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

  if (manualEntry) {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <Text style={styles.heading}>Enter your company code</Text>
          <Text style={styles.subheading}>Ask an admin for your organisation's 8-character join code.</Text>

          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="ABCD1234"
            placeholderTextColor={Colors.textMuted}
            value={manualCode}
            onChangeText={(t) => setManualCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            // 8 for the current format, 10 for the lowercase-hex codes of orgs
            // that predate it — capping at 8 made those literally untypeable.
            maxLength={10}
            returnKeyType="done"
            onSubmitEditing={handleManualSubmit}
            autoFocus
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Button label="Continue" onPress={handleManualSubmit} loading={manualSubmitting} disabled={!manualCode.trim()} fullWidth />
          <TouchableOpacity
            onPress={() => {
              // Reached directly (not via the camera's "Or enter your code"
              // link), or on a platform with no camera at all — there's no
              // camera state to fall back to, so back means back to the
              // caller's own choice step.
              if (isManualOnly) { onBack(); return; }
              setManualEntry(false); setManualCode(''); setError(null);
            }}
            style={styles.backRow}
          >
            <Icon name="arrow-back" size="sm" color={Colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Resume-a-scan mode never needs the camera: show a spinner while the code
  // is looked up, or the error if the code has been regenerated since.
  if (initialCode) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.inner}>
          {error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={onBack} style={styles.backRow}>
                <Icon name="arrow-back" size="sm" color={Colors.primary} />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator color={Colors.primary} />
          )}
        </View>
      </View>
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
          <TouchableOpacity onPress={() => setManualEntry(true)} style={styles.backRow}>
            <Icon name="keypad-outline" size="sm" color={Colors.primary} />
            <Text style={styles.backText}>Or enter your company code</Text>
          </TouchableOpacity>
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
        <TouchableOpacity onPress={() => setManualEntry(true)} style={styles.backRow}>
          <Icon name="keypad-outline" size="sm" color={Colors.primary} />
          <Text style={styles.backText}>Or enter your company code</Text>
        </TouchableOpacity>
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
    gap: Spacing.sm,
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
  codeInput: {
    textAlign: 'center',
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    letterSpacing: 4,
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

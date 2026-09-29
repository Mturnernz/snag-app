import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import {
  currentInstallEnv, readInstallDismissed, shouldOfferInstall, writeInstallDismissed,
  type InstallPlatform,
} from '../lib/installState';

interface Props {
  /**
   * `card` is the dismissible one at the top of the list, asked once. `row`
   * is the You tab's, which stays for as long as Snag is in a browser tab,
   * because somebody who closed the card may want it back.
   */
  variant?: 'card' | 'row';
  /** For tests. The running app reads its own environment. */
  env?: { web: boolean; installed: boolean; platform: InstallPlatform };
}

/**
 * *Add Snag to your home screen*, shown only where it means something: the
 * web build, open in a phone's browser tab, not already installed.
 *
 * **Quiet, and it asks once.** A white group with no hue, since this is
 * neither a state nor something to act on now. The × is final on this device
 * (`installState.ts`). This screen evicted two filter rails for charging
 * vertical rent on every visit, and a card that came back every time would be
 * the third.
 *
 * On Android with Chrome's prompt in hand (`useInstallPrompt`) it offers
 * **Install**, which is one tap. Otherwise it gives the steps: Safari's share
 * sheet on an iPhone, Chrome's menu on Android.
 */
export default function InstallCard({ variant = 'card', env }: Props) {
  const [dismissed, setDismissed] = useState(() => (variant === 'card' ? readInstallDismissed() : false));
  const [installed, setInstalled] = useState(false);
  const { canPrompt, prompt } = useInstallPrompt();

  const seen = env ?? { web: Platform.OS === 'web', ...currentInstallEnv() };
  if (
    installed ||
    !shouldOfferInstall({ web: seen.web, installed: seen.installed, platform: seen.platform, dismissed })
  ) {
    return null;
  }

  const steps =
    seen.platform === 'ios'
      ? 'In Safari, tap Share, then Add to Home Screen.'
      : 'In Chrome, open the menu (the three dots), then Install app.';

  async function install() {
    if (await prompt()) setInstalled(true);
  }

  return (
    <View style={[styles.card, variant === 'row' && styles.row]} accessibilityRole="summary">
      <Icon name="phone-portrait-outline" size="md" color={Colors.textMuted} />
      <View style={styles.body}>
        <Text style={styles.title}>Add Snag to your home screen</Text>
        <Text style={styles.detail}>
          {seen.platform === 'android' && canPrompt
            ? 'It opens full screen, like any other app.'
            : `It opens full screen, like any other app. ${steps}`}
        </Text>
        {seen.platform === 'android' && canPrompt ? (
          <Pressable
            onPress={install}
            style={styles.installTap}
            accessibilityRole="button"
            accessibilityLabel="Install Snag"
          >
            <View style={styles.installPill}>
              <Text style={styles.installLabel}>Install</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
      {variant === 'card' ? (
        <Pressable
          onPress={() => {
            writeInstallDismissed();
            setDismissed(true);
          }}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Not now"
        >
          <Icon name="close" size="sm" color={Colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    paddingVertical: Spacing.md,
    paddingLeft: Spacing.lg,
    marginBottom: Spacing.md,
  },
  row: { marginBottom: 0, paddingRight: Spacing.lg },
  body: { flex: 1, minWidth: 0, gap: 2, paddingTop: 2 },
  title: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  detail: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },
  installTap: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  installPill: {
    backgroundColor: Colors.sunken,
    borderRadius: 999,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  installLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -Spacing.sm,
  },
});

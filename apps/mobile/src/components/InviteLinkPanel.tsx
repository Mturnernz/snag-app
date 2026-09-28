import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { joinUrl } from '@snag/supabase-queries';

import Button from './Button';
import QrCode, { QrCaption } from './QrCode';
import { Colors, Spacing, Typography } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import { createInviteLink, revokeInviteLink } from '../lib/supabase';
import { APP_URL } from '../lib/appUrl';
import { copyToClipboard } from '../lib/clipboard';
import { shareLink } from '../lib/share';
import { showAlert } from '../lib/alert';
import { Invitation } from '../types';

interface Props {
  householdId: string;
  householdName: string;
  /**
   * The places a newcomer starts on, when there is more than one to choose
   * from. Undefined means every place — right while there is only one.
   */
  propertyIds?: string[];
  /** The household's live join code, if there is one. Owned by the caller, which reads it. */
  link: Invitation | null;
  onLink: (link: Invitation | null) => void;
}

/**
 * Sharing a way in: the link through the phone's own share sheet, then a QR
 * code for somebody standing in the same kitchen.
 *
 * **One component, used by the Household screen and by the *Bring someone in*
 * step of first-run setup**, so both mint, reuse and stop a code the same way.
 * The rule that matters lives here once: sharing **reuses the live code**
 * rather than minting another, because minting kills the old one — and sharing
 * to a second person must not break the link the first has not opened yet.
 *
 * Nothing here sends anything, and nothing says it did. The share sheet is the
 * phone's; the words go wherever the person chooses to put them.
 */
export default function InviteLinkPanel({
  householdId, householdName, propertyIds, link, onLink,
}: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  // Asked only once there's a choice, and a choice of nothing is not an answer.
  const blocked = !!propertyIds && propertyIds.length === 0;

  async function handleShareLink() {
    setBusy(true);
    try {
      let live = link;
      if (!live?.token) {
        live = await createInviteLink(householdId, propertyIds);
        onLink(live);
      }
      const outcome = await shareLink(
        joinUrl(APP_URL, live.token!),
        `Join ${householdName} on Snag — the link is good for a day.`,
      );
      if (outcome === 'copied') showToast('Link copied — paste it into a message');
      if (outcome === 'failed') showToast('Copy the link from under the code');
    } catch (err: any) {
      showAlert("Couldn't make a link", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleShowCode() {
    setBusy(true);
    try {
      onLink(await createInviteLink(householdId, propertyIds));
    } catch (err: any) {
      showAlert("Couldn't make a code", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleStopSharing() {
    setBusy(true);
    try {
      await revokeInviteLink(householdId);
      onLink(null);
      showToast('Code stopped');
    } catch (err: any) {
      showAlert("Couldn't stop sharing", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Button
        label="Share an invite link"
        onPress={handleShareLink}
        loading={busy}
        disabled={busy || blocked}
        fullWidth
        icon="share-outline"
      />

      <View style={styles.codeBlock}>
        {link?.token ? (
          <>
            <Text style={styles.orLine}>or let them scan it</Text>
            <QrCode value={joinUrl(APP_URL, link.token)} />
            <QrCaption text={joinUrl(APP_URL, link.token)} />
            <View style={styles.codeActions}>
              <Button
                label="Copy link"
                variant="outline"
                onPress={async () => {
                  await copyToClipboard(joinUrl(APP_URL, link.token!));
                  showToast('Link copied');
                }}
                style={styles.codeButton}
              />
              <Button
                label="Stop sharing"
                variant="outline"
                onPress={handleStopSharing}
                disabled={busy}
                style={styles.codeButton}
              />
            </View>
          </>
        ) : (
          <Button
            label="Show a QR code"
            variant="outline"
            onPress={handleShowCode}
            loading={busy}
            disabled={busy || blocked}
            fullWidth
            icon="qr-code-outline"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm, alignSelf: 'stretch' },
  codeBlock: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  orLine: { fontSize: Typography.sm, color: Colors.textMuted, textAlign: 'center' },
  codeActions: { flexDirection: 'row', gap: Spacing.sm },
  codeButton: { flex: 1 },
});

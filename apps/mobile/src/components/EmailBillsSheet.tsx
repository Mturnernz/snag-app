import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { Group, PrimaryButton, TextButton, groupedStyles } from './Grouped';
import { Colors, Fonts, Spacing, Typography } from '../constants/theme';
import { getProjectInboxAddress, rotateProjectInbox } from '../lib/supabase';
import { copyToClipboard } from '../lib/clipboard';
import { useToast } from '../hooks/useToast';

interface Props {
  visible: boolean;
  projectId: string;
  onClose: () => void;
}

/**
 * This project's address for bills, and one button that copies it.
 *
 * **It is asked for, never shown by default.** The address is minted the first
 * time somebody opens this, so a project nobody emails never has one to leak —
 * and a line of hex on the project page would be vertical rent on every visit
 * for something done once, when the address goes into a contact.
 *
 * The line under it says the two facts that decide whether it works: it must
 * be forwarded from the address you sign in with, and what arrives waits to be
 * checked. Both are true of the server rather than hopes about it —
 * `home.inbox_for` refuses anybody else, and a review reaches no figure until it
 * is allocated.
 *
 * *Change the address* is quiet and asks nothing: the old address simply stops
 * working, which is exactly what somebody pressing it wants.
 */
export default function EmailBillsSheet({ visible, projectId, onClose }: Props) {
  const { showToast } = useToast();
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setAddress(null);
    setError(null);
    getProjectInboxAddress(projectId)
      .then((next) => { if (live) setAddress(next); })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't get the address");
      });
    return () => { live = false; };
  }, [visible, projectId]);

  async function copy() {
    if (!address) return;
    showToast((await copyToClipboard(address)) ? 'Address copied' : address);
  }

  async function rotate() {
    if (busy) return;
    setBusy(true);
    try {
      setAddress(await rotateProjectInbox(projectId));
      showToast('New address — the old one no longer works');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't change the address");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      title="Email bills to this job"
      onClose={onClose}
      closeLabel="Done"
      footer={<PrimaryButton label="Copy address" onPress={copy} disabled={!address} />}
    >
      <Group>
        <View style={styles.addressBox}>
          {address ? (
            <Text style={styles.address} selectable accessibilityLabel={`Address: ${address}`}>
              {address}
            </Text>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={Colors.primary} />
          )}
        </View>
      </Group>
      <Text style={groupedStyles.hint}>
        Forward bills from the address you sign in with. Each one waits here to be checked before it
        counts.
      </Text>
      {address ? <TextButton label="Change the address" onPress={rotate} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  addressBox: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  address: { fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textPrimary },
  error: { fontSize: Typography.sm, color: Colors.danger },
});

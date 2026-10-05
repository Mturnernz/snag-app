import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import Sheet from './Sheet';
import Button from './Button';
import { Segmented } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';

export type ShareNotes = 'out' | 'in';

interface Props {
  visible: boolean;
  jobCount: number;
  /** How many photographs made it into the file. Null while it is being made. */
  photoCount: number | null;
  notes: ShareNotes;
  onNotes: (next: ShareNotes) => void;
  /** The PDF is built when the sheet opens, so *Share* acts on a file in hand. */
  state: 'preparing' | 'ready' | 'failed';
  /** Why it could not be made, in words. */
  error?: string | null;
  /** A phone's share sheet can take a file; most desktop browsers cannot. */
  canShare: boolean;
  busy?: boolean;
  onShare: () => void;
  onDownload: () => void;
  onEmail: () => void;
  onClose: () => void;
}

/**
 * Jobs picked off the list, as a PDF for somebody to quote on.
 *
 * **The file is made when the sheet opens, not when Share is pressed.** A
 * browser lets `navigator.share` run only inside a tap, and fetching twenty
 * photographs outlasts one — so a PDF built on the press would reach the share
 * sheet after the browser had stopped listening. Built first, the press hands
 * over a file already in hand.
 *
 * **What goes to WhatsApp, Messenger or an email is the phone's own sheet**,
 * so this offers one *Share* rather than a button per app. A desktop browser
 * mostly cannot share a file: there it is *Download PDF*, and *Email*, which
 * downloads it and opens a new message saying to attach it — a `mailto:` link
 * cannot carry a file, and pretending otherwise would be a message that
 * arrives with nothing in it.
 *
 * **The notes are asked, two named halves, out by default.** A job's notes are
 * the household talking to itself; the description, the room and the photos
 * are what somebody quoting needs.
 */
export default function ShareJobsSheet({
  visible, jobCount, photoCount, notes, onNotes, state, error, canShare, busy = false,
  onShare, onDownload, onEmail, onClose,
}: Props) {
  const jobs = `${jobCount} ${jobCount === 1 ? 'job' : 'jobs'}`;
  const facts = photoCount === null
    ? jobs
    : `${jobs} · ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`;
  const ready = state === 'ready';

  return (
    <Sheet
      visible={visible}
      title={jobCount === 1 ? 'Share this job' : 'Share these jobs'}
      subtitle={facts}
      onClose={onClose}
      footer={
        <View style={styles.actions}>
          {canShare ? (
            <>
              <Button
                label="Share"
                icon="share-outline"
                onPress={onShare}
                loading={busy}
                disabled={!ready || busy}
                fullWidth
              />
              <Button
                label="Download PDF"
                variant="outline"
                onPress={onDownload}
                disabled={!ready || busy}
                fullWidth
              />
            </>
          ) : (
            <>
              <Button
                label="Download PDF"
                icon="download-outline"
                onPress={onDownload}
                loading={busy}
                disabled={!ready || busy}
                fullWidth
              />
              <Button
                label="Email"
                variant="outline"
                onPress={onEmail}
                disabled={!ready || busy}
                fullWidth
              />
            </>
          )}
        </View>
      }
    >
      <Text style={styles.body}>
        A PDF to send to somebody for a quote: each job's words, room and photos, with a page asking
        for a price per job. No names and no street — only the suburb.
      </Text>

      <Text style={styles.label}>The jobs' notes</Text>
      <Segmented
        options={[
          { value: 'out', label: 'Leave them out' },
          { value: 'in', label: 'Put them in' },
        ]}
        value={notes}
        onChange={onNotes}
        accessibilityLabel="The jobs' notes"
      />

      <View style={styles.status} accessibilityLiveRegion="polite">
        {state === 'preparing' ? (
          <>
            <ActivityIndicator size="small" color={Colors.textMuted} />
            <Text style={styles.statusText}>Making the PDF…</Text>
          </>
        ) : state === 'failed' ? (
          <Text style={[styles.statusText, styles.statusFailed]}>
            {error ?? "Couldn't make the PDF."}
          </Text>
        ) : canShare ? null : (
          <Text style={styles.statusText}>
            This browser can't share a file — download it, or email it as an attachment.
          </Text>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: Typography.base, color: Colors.textSecondary, marginBottom: Spacing.md },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32, marginTop: Spacing.md },
  statusText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted },
  // Ink, not clay: clay is spent on an overdue date and nothing else.
  statusFailed: { color: Colors.textPrimary },
  actions: { gap: Spacing.sm },
});

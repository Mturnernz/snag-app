import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import Card from './Card';
import Icon from './Icon';
import LinkedText from './LinkedText';
import ConfirmDialog from './ConfirmDialog';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { describeSupportStatus, supportIsOpen } from '@snag/supabase-queries';
import type { SupportRequest } from '../types';

interface Props {
  request: SupportRequest;
  busy?: boolean;
  /** Resolves true once the reply is sent, so the box can empty. */
  onReply: (body: string) => Promise<boolean>;
  onClose: () => void;
  onAskAgain: () => void;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

/**
 * The question asked of SnagHQ about this job, and what came back.
 *
 * It sits directly above the assessment card, because that is where SnagHQ's
 * answer lands: a reply here says *there is an assessment below*, and the two
 * read as one conversation.
 *
 * **The status is stated in words, every state of it** — waiting, seen,
 * replied and how long the job stays shared, closed. The one that matters most
 * is the last: SnagHQ can see this job while the question is open and not
 * after, and the household should never have to work out which it is.
 *
 * **Close it** ends SnagHQ's access at once. It asks first, and says that is
 * what it does, because it cannot be undone except by asking again.
 */
export default function SupportCard({ request, busy = false, onReply, onClose, onAskAgain }: Props) {
  const [draft, setDraft] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const open = supportIsOpen(request);
  const trimmed = draft.trim();

  const send = async () => {
    if (!trimmed || busy) return;
    if (await onReply(trimmed)) setDraft('');
  };

  return (
    <Card elevation="md" style={styles.card}>
      <View style={styles.headRow}>
        <Icon name="chatbubbles-outline" size="sm" color={Colors.textSecondary} />
        <Text style={styles.title}>Asked SnagHQ</Text>
      </View>
      <Text style={styles.status}>{describeSupportStatus(request)}</Text>

      <View style={styles.message}>
        <Text style={styles.author}>
          You asked<Text style={styles.date}>{'  '}{day(request.createdAt)}</Text>
        </Text>
        <LinkedText style={styles.body}>{request.question}</LinkedText>
      </View>

      {request.messages.map((m) => (
        <View key={m.id} style={styles.message}>
          <Text style={styles.author}>
            {m.fromStaff ? `${m.authorName} at SnagHQ` : m.authorName}
            <Text style={styles.date}>{'  '}{day(m.createdAt)}</Text>
          </Text>
          {m.body ? <LinkedText style={styles.body}>{m.body}</LinkedText> : null}
          {m.withAdvice ? (
            <Text style={styles.withAdvice}>Sent an assessment — it's on this job, below.</Text>
          ) : null}
        </View>
      ))}

      {open ? (
        <>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Reply to SnagHQ"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={4000}
            accessibilityLabel="Reply to SnagHQ"
          />
          <View style={styles.actions}>
            <Pressable
              onPress={() => setConfirmClose(true)}
              disabled={busy}
              style={styles.textAction}
              accessibilityRole="button"
              accessibilityLabel="Close this question"
            >
              <Text style={styles.textActionLabel}>Close it</Text>
            </Pressable>
            <Pressable
              onPress={send}
              disabled={!trimmed || busy}
              style={[styles.send, (!trimmed || busy) && styles.sendOff]}
              accessibilityRole="button"
              accessibilityLabel="Send reply"
            >
              <Text style={[styles.sendLabel, (!trimmed || busy) && styles.sendLabelOff]}>Send</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          <Pressable
            onPress={onAskAgain}
            disabled={busy}
            style={styles.textAction}
            accessibilityRole="button"
            accessibilityLabel="Ask SnagHQ again"
          >
            <Text style={styles.textActionLabel}>Ask again</Text>
          </Pressable>
        </View>
      )}

      <ConfirmDialog
        visible={confirmClose}
        title="Close this question?"
        message="SnagHQ won't be able to see this job any more. What they said stays here."
        confirmLabel="Close it"
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  status: { fontSize: Typography.sm, color: Colors.textSecondary },
  message: { gap: 2, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  author: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  date: { fontWeight: Typography.regular, color: Colors.textMuted, fontSize: Typography.xs },
  body: { fontSize: Typography.sm, color: Colors.textPrimary, lineHeight: 20 },
  withAdvice: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 20 },
  input: {
    minHeight: 72,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
    padding: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
    marginTop: Spacing.xs,
  },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textAction: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  textActionLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.semibold },
  send: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: Colors.sunken },
  sendLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.white },
  sendLabelOff: { color: Colors.textMuted },
});

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Icon from './Icon';
import MoneyField from './MoneyField';
import Attachments from './Attachments';
import ConfirmDialog from './ConfirmDialog';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { formatMoney, inclGst } from '@snag/supabase-queries';
import type { ExpectedCostInput, ExpectedCostLineInput } from '@snag/supabase-queries';
import { ProjectElement, ProjectExpectedCost, ProjectExpectedCostLine } from '../types';

interface Props {
  visible: boolean;
  elements: ProjectElement[];
  /** Whether the part layer is drawn. An implicit part has no name anybody chose. */
  showElements: boolean;
  /** Null to add a new one; a row to edit and to hold its payment lines. */
  existing: ProjectExpectedCost | null;
  /** The payment lines under `existing`. Ignored while adding. */
  lines: ProjectExpectedCostLine[];
  householdId: string;
  onSave: (input: ExpectedCostInput) => Promise<void>;
  /**
   * Says whether somebody has agreed this. Its own call, never part of
   * `onSave` — it is the only write here that changes what a total says.
   * Absent while the row does not exist yet: the answer rides in `onSave`.
   */
  onConfirm?: (confirmed: boolean) => Promise<void>;
  onDelete?: () => Promise<void>;
  onAddLine: (input: ExpectedCostLineInput) => Promise<void>;
  onUpdateLine: (lineId: string, input: Partial<ExpectedCostLineInput>) => Promise<void>;
  onDeleteLine: (lineId: string) => Promise<void>;
  onClose: () => void;
}

const emptyLine = { name: '', reference: '', amount: '', incl: true, photoPaths: [] as string[], documentPaths: [] as string[] };

/**
 * A cost somebody has told you to expect — and, once it exists, the record of
 * what has actually gone out against it.
 *
 * The architect says *"you'll need an engineer, and the council will want their
 * share"*. That is the beat the money model could not hold: no vendor, no quote,
 * no invoice — just a number from somebody who knows the industry.
 *
 * Recording it as an **item with no price** made it worth nought to every figure
 * on the page, which is how the live renovation ended up with a *Geotech
 * engineer* row contributing zero while everybody's mental arithmetic carried
 * $4,000 for it. Recording it as a **quote** would be inventing a commitment
 * from a firm that has never heard of you, and it would then turn up under who
 * is owed what.
 *
 * So this writes the one row in the feature whose number is allowed to be
 * somebody's estimate. **It is never committed and never invoiced** — it reaches
 * the forecast and nothing else, and every figure it touches names it as a guess.
 *
 * **Once it exists, it can be opened again.** A guess made in the first week is
 * rarely the final word, and the only way to fix it used to be deleting the row
 * and losing the payments already recorded against it.
 *
 * **Payments against it are their own thing, deliberately thin.** An initial
 * payment to the architect, a second instalment — each with a reference number
 * and maybe a receipt. Kept simple on purpose: a name, a reference, a value, and
 * somewhere to put a photo or a document. They never reach Committed, Invoiced
 * or the forecast — the parent row still carries the one guessed figure that
 * feeds it, and these lines are read the way a bank statement is read, not
 * priced.
 */
export default function ExpectedCostSheet({
  visible, elements, showElements, existing, lines, householdId,
  onSave, onConfirm, onDelete, onAddLine, onUpdateLine, onDeleteLine, onClose,
}: Props) {
  const insets = useEdgeInsets();
  const keyboard = useKeyboardInset();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [likelySupplier, setLikelySupplier] = useState('');
  const [elementId, setElementId] = useState<string | null>(null);
  /**
   * Whether somebody has agreed this.
   *
   * Held locally as well as written, because a new row has no id to write
   * against yet — the answer rides into `create_expected_cost`. On a row that
   * exists the press writes immediately through `onConfirm`, the way every
   * other single decision on this feature's pages does, and puts the pill back
   * if the server refuses.
   */
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [lineEditing, setLineEditing] = useState<string | 'new' | null>(null);
  const [lineForm, setLineForm] = useState(emptyLine);
  const [lineBusy, setLineBusy] = useState(false);
  const [removingLine, setRemovingLine] = useState<ProjectExpectedCostLine | null>(null);
  /** Said under the payment's name box when Save cannot take what is in it. */
  const [lineMissing, setLineMissing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(existing?.name ?? '');
    setAmount(existing?.amount !== null && existing?.amount !== undefined ? String(existing.amount) : '');
    setIncl(existing?.amountInclGst ?? true);
    setLikelySupplier(existing?.likelySupplier ?? '');
    setElementId(existing?.elementId ?? null);
    setConfirmed(existing?.confirmed ?? false);
    setLineEditing(null);
    setLineForm(emptyLine);
    setLineMissing(false);
  }, [visible, existing?.id]);

  const canSave = name.trim().length > 0;

  /**
   * Saves the row — **and the payment still sitting in the box**.
   *
   * This shipped broken, in exactly the shape the project sheet's second step
   * already paid for once: the only thing that wrote a payment was the little
   * *Save* beside it, so somebody who filled in the value and an invoice
   * number and then pressed the sheet's own Save had it discarded, silently,
   * with nothing anywhere saying so. On the live job that is every payment
   * ever typed under *Also expecting* — the table has no rows at all.
   *
   * A half-typed answer in a box is still an answer, and the only honest
   * readings of Save are "take it" or "say why you can't". So the line is
   * committed first and a refusal **holds the sheet open** with the words
   * still there, rather than closing over a payment it did not take.
   */
  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      if (lineEditing !== null) {
        const committed = await commitLine();
        if (!committed) return;
      }
      const parsed = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
      await onSave({
        name: name.trim(),
        amount: Number.isFinite(parsed) ? parsed : null,
        amountInclGst: incl,
        likelySupplier: likelySupplier.trim() || null,
        elementId,
        // Only on the create path. On an existing row this has already been
        // written by the pill, through the one call that is allowed to move a
        // total — `onSave` must not be a second writer of it.
        confirmed: existing ? undefined : confirmed,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function editLine(line: ProjectExpectedCostLine) {
    setLineEditing(line.id);
    setLineForm({
      name: line.name,
      reference: line.reference ?? '',
      amount: line.amount !== null ? String(line.amount) : '',
      incl: line.amountInclGst,
      photoPaths: line.photoPaths,
      documentPaths: line.documentPaths,
    });
  }

  function startLine() {
    setLineEditing('new');
    setLineForm(emptyLine);
  }

  /**
   * Writes whatever is in the payment box, and says so when it cannot.
   *
   * Returns whether the write landed, because the sheet's own Save has to
   * decide from it whether to close. A box holding nothing at all is not a
   * refusal — there is nothing to lose — so it passes.
   */
  async function commitLine(): Promise<boolean> {
    const named = lineForm.name.trim();
    const typed = lineForm.amount.trim();
    if (named.length === 0 && typed.length === 0
        && lineForm.reference.trim().length === 0
        && lineForm.photoPaths.length === 0
        && lineForm.documentPaths.length === 0) {
      setLineEditing(null);
      setLineForm(emptyLine);
      setLineMissing(false);
      return true;
    }
    // The name is what a bank statement's line is *called*, and the row is
    // unreadable without it. Said under the box rather than as a toast,
    // because it is a fact about the box.
    if (named.length === 0) {
      setLineMissing(true);
      return false;
    }
    setLineMissing(false);
    const parsed = typed ? Number(typed.replace(/[^0-9.]/g, '')) : NaN;
    const input: ExpectedCostLineInput = {
      name: named,
      reference: lineForm.reference.trim() || null,
      amount: Number.isFinite(parsed) ? parsed : null,
      amountInclGst: lineForm.incl,
      photoPaths: lineForm.photoPaths,
      documentPaths: lineForm.documentPaths,
    };
    if (lineEditing && lineEditing !== 'new') {
      await onUpdateLine(lineEditing, input);
    } else {
      await onAddLine(input);
    }
    setLineEditing(null);
    setLineForm(emptyLine);
    return true;
  }

  async function saveLine() {
    if (lineBusy) return;
    setLineBusy(true);
    try {
      await commitLine();
    } finally {
      setLineBusy(false);
    }
  }

  /**
   * Answers before the network does, and puts it back when refused.
   *
   * The same rule the project page's other toggles follow: a toggle that waits
   * for a round trip reads as one that did not register, and gets pressed
   * again. `confirmed` is a plain boolean, so the client can predict it
   * exactly; everything it moves is derived in a view and left to the re-read.
   */
  async function setConfirmedTo(next: boolean) {
    if (next === confirmed) return;
    setConfirmed(next);
    if (!existing || !onConfirm) return;
    try {
      await onConfirm(next);
    } catch {
      setConfirmed(!next);
    }
  }

  const title = existing ? 'Edit what you’re expecting' : 'Something else you’re expecting';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            onPress={onClose}
            style={styles.headTap}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          <Text style={styles.blurb}>
            A cost somebody has warned you about but nobody has quoted — the engineer, the council.
            Until it&rsquo;s confirmed it counts towards the forecast and nothing else.
          </Text>

          <Text style={styles.label}>WHAT IS IT</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            accessibilityLabel="What the cost is for"
          />

          <MoneyField
            label="Roughly how much"
            value={amount}
            onChangeValue={setAmount}
            inclusive={incl}
            onChangeInclusive={setIncl}
          />
          <Text style={styles.hint}>
            Leave it empty if nobody has given you a figure. It&rsquo;ll show as a gap rather than
            disappearing.
          </Text>

          <Text style={styles.label}>PROBABLY FROM</Text>
          <TextInput
            style={styles.input}
            value={likelySupplier}
            onChangeText={setLikelySupplier}
            autoCapitalize="words"
            accessibilityLabel="Who it will probably come from"
          />
          <Text style={styles.hint}>
            {confirmed
              ? 'Confirmed, so this is who the money is owed to — the row shows under who we’re paying.'
              : 'A hint, not a supplier — you can’t owe money to a guess, so this doesn’t reach who’s owed what yet.'}
          </Text>

          {/* ── the one answer that moves a total ─────────────────────────
              Two named halves, in the app's one chip shape: a sunken well, a
              solid fern half for the answer that is true, ~34px inside a 48px
              target. One chip that toggled would leave the other answer as the
              unlabelled absence of a press, and here that unlabelled answer is
              the difference between a guess and a commitment — the same
              argument the GST pill and *Is it in?* both make.

              Unconfirmed is the default and is exactly what an expected cost
              has always been. Confirming is a deliberate act, which is why
              nothing on any page changes until somebody presses it. */}
          <Text style={styles.question}>Has anybody agreed this?</Text>
          <View style={styles.pill}>
            <Pressable
              onPress={() => setConfirmedTo(true)}
              style={[styles.half, confirmed && styles.halfOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: confirmed }}
              accessibilityLabel="Confirmed"
            >
              <Text style={[styles.halfLabel, confirmed && styles.halfLabelOn]}>Confirmed</Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmedTo(false)}
              style={[styles.half, !confirmed && styles.halfOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: !confirmed }}
              accessibilityLabel="Unconfirmed"
            >
              <Text style={[styles.halfLabel, !confirmed && styles.halfLabelOn]}>Not yet</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            {confirmed
              ? 'It counts as committed, and it’s still not invoiced or paid — so it sits in what’s left to be billed.'
              : 'It counts towards the forecast alone, and every figure that holds it says it’s a guess.'}
          </Text>

          {showElements && elements.length > 0 ? (
            <>
              <Text style={styles.question}>Which part of the job?</Text>
              <View style={styles.chips}>
                <Pressable
                  onPress={() => setElementId(null)}
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: elementId === null }}
                  accessibilityLabel="The whole job"
                >
                  <View style={[styles.chip, elementId === null && styles.chipOn]}>
                    <Text style={[styles.chipLabel, elementId === null && styles.chipLabelOn]}>
                      The whole job
                    </Text>
                  </View>
                </Pressable>
                {elements.map((element) => {
                  const on = elementId === element.id;
                  return (
                    <Pressable
                      key={element.id}
                      onPress={() => setElementId(element.id)}
                      style={styles.chipTap}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={element.name}
                    >
                      <View style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                          {element.name}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {/* Payments against it — only once the row itself is real. A guess
              cannot have a payment recorded against it before it exists. */}
          {existing ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.section}>Payments so far</Text>
                <View style={styles.rule} />
                {lineEditing === null ? (
                  <Pressable
                    onPress={startLine}
                    style={styles.addLineBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Add a payment"
                  >
                    <Icon name="add" size="sm" color={Colors.primary} />
                  </Pressable>
                ) : null}
              </View>

              {lines.length === 0 && lineEditing === null ? (
                <Text style={styles.hint}>Nothing recorded yet.</Text>
              ) : null}

              {lines.map((line) =>
                lineEditing === line.id ? null : (
                  <Pressable
                    key={line.id}
                    onPress={() => editLine(line)}
                    style={styles.line}
                    accessibilityRole="button"
                    accessibilityLabel={`${line.name}, edit it`}
                  >
                    <View style={styles.lineTitles}>
                      <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                      {line.reference ? (
                        <Text style={styles.lineRef} numberOfLines={1}>{line.reference}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.lineAmount} numberOfLines={1}>
                      {formatMoney(inclGst(line.amount, line.amountInclGst)) ?? 'no figure'}
                    </Text>
                    <Pressable
                      onPress={() => setRemovingLine(line)}
                      style={styles.lineRemove}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${line.name}`}
                    >
                      <Icon name="close" size="sm" color={Colors.textMuted} />
                    </Pressable>
                  </Pressable>
                )
              )}

              {lineEditing !== null ? (
                <View style={styles.lineForm}>
                  <Text style={styles.label}>NAME</Text>
                  <TextInput
                    style={styles.input}
                    value={lineForm.name}
                    onChangeText={(text) => {
                      setLineForm((f) => ({ ...f, name: text }));
                      if (text.trim()) setLineMissing(false);
                    }}
                    accessibilityLabel="Who it was paid to, or what for"
                    autoFocus
                  />
                  {lineMissing ? (
                    <Text style={styles.lineMissing}>
                      Give it a name — &ldquo;Deposit&rdquo;, or who it went to.
                    </Text>
                  ) : null}

                  <Text style={styles.label}>REFERENCE NUMBER</Text>
                  <TextInput
                    style={styles.input}
                    value={lineForm.reference}
                    onChangeText={(text) => setLineForm((f) => ({ ...f, reference: text }))}
                    accessibilityLabel="Reference number"
                  />

                  <MoneyField
                    label="Amount"
                    value={lineForm.amount}
                    onChangeValue={(text) => setLineForm((f) => ({ ...f, amount: text }))}
                    inclusive={lineForm.incl}
                    onChangeInclusive={(next) => setLineForm((f) => ({ ...f, incl: next }))}
                  />

                  <Attachments
                    householdId={householdId}
                    photoPaths={lineForm.photoPaths}
                    documentPaths={lineForm.documentPaths}
                    onChange={async (next) => {
                      setLineForm((f) => ({
                        ...f,
                        photoPaths: next.photoPaths ?? f.photoPaths,
                        documentPaths: next.documentPaths ?? f.documentPaths,
                      }));
                    }}
                  />

                  <View style={styles.lineFormRow}>
                    <Pressable
                      onPress={() => { setLineEditing(null); setLineForm(emptyLine); setLineMissing(false); }}
                      disabled={lineBusy}
                      style={styles.lineCancel}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                    >
                      <Text style={styles.lineCancelLabel}>Cancel</Text>
                    </Pressable>
                    {/* Live even with the name empty, deliberately. A dead
                        button is indistinguishable from a button that did
                        nothing, and on this sheet that difference is a payment
                        somebody typed and lost — so it presses, and says what
                        it wants. */}
                    <Pressable
                      onPress={saveLine}
                      disabled={lineBusy}
                      style={[styles.lineSave, lineBusy && styles.ctaOff]}
                      accessibilityRole="button"
                      accessibilityLabel="Save the payment"
                    >
                      <Text style={[styles.lineSaveLabel, lineBusy && styles.ctaLabelOff]}>
                        {lineBusy ? 'Saving…' : 'Save'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>

        <Pressable
          onPress={save}
          disabled={!canSave || busy}
          style={[styles.cta, (!canSave || busy) && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityLabel={existing ? 'Save' : 'Add it'}
        >
          <Text style={[styles.ctaLabel, (!canSave || busy) && styles.ctaLabelOff]}>
            {busy ? 'Saving…' : existing ? 'Save' : 'Add it'}
          </Text>
        </Pressable>

        {existing && onDelete ? (
          <Pressable
            onPress={() => setConfirmDelete(true)}
            disabled={busy}
            style={styles.remove}
            accessibilityRole="button"
            accessibilityLabel="Remove this expected cost"
          >
            <Text style={styles.removeLabel}>Remove</Text>
          </Pressable>
        ) : null}
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title="Remove this?"
        message={`"${existing?.name ?? ''}" and its payments will be removed.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          setConfirmDelete(false);
          if (onDelete) await onDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        visible={removingLine !== null}
        title="Remove this payment?"
        message={removingLine ? `"${removingLine.name}" will be removed.` : ''}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (removingLine) await onDeleteLine(removingLine.id);
          setRemovingLine(null);
        }}
        onCancel={() => setRemovingLine(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '90%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
  },
  grab: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm },
  title: {
    flex: 1, minWidth: 0,
    fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary,
  },
  headTap: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
  scroll: { marginTop: Spacing.sm },
  blurb: { fontSize: Typography.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  label: {
    fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: Spacing.lg, marginBottom: Spacing.xs,
  },
  input: {
    fontSize: Typography.base, color: Colors.textPrimary,
    backgroundColor: Colors.sunken, borderRadius: Radius.input,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET, minWidth: 0,
  },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.xs },
  lineMissing: { fontSize: Typography.sm, color: Colors.danger, marginTop: Spacing.xs },
  question: {
    fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary,
    marginTop: Spacing.lg, marginBottom: Spacing.sm,
  },
  // The app's one chip shape, as `MoneyField` and the item sheet's *Is it in?*
  // draw it: a sunken well when off, solid fern when on, no border either way.
  pill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: Colors.sunken,
    borderRadius: Radius.chip,
    overflow: 'hidden',
  },
  half: {
    paddingHorizontal: Spacing.md,
    // The visible pill is ~34px; the tap area is the full target.
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  halfOn: { backgroundColor: Colors.primary },
  halfLabel: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  halfLabelOn: { color: Colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: {
    backgroundColor: Colors.sunken, borderRadius: Radius.chip,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: {
    fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium,
  },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  section: {
    fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  rule: { flex: 1, height: 1, backgroundColor: Colors.border },
  addLineBtn: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm,
  },
  line: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    minHeight: MIN_TOUCH_TARGET,
  },
  lineTitles: { flex: 1, minWidth: 0 },
  lineName: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  lineRef: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1, fontFamily: Fonts.mono },
  lineAmount: {
    flexShrink: 0, fontFamily: Fonts.mono, fontSize: Typography.sm,
    fontWeight: Typography.semibold, color: Colors.textPrimary,
  },
  lineRemove: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm,
  },
  lineForm: {
    backgroundColor: Colors.sunken, borderRadius: Radius.card,
    padding: Spacing.md, marginTop: Spacing.sm,
  },
  lineFormRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  lineCancel: {
    flex: 1, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.button,
  },
  lineCancelLabel: { fontSize: Typography.base, color: Colors.textSecondary },
  lineSave: {
    flex: 1, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.button, backgroundColor: Colors.primary,
  },
  lineSaveLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  cta: {
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
  remove: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  removeLabel: { fontSize: Typography.sm, color: Colors.danger },
});

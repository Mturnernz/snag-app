import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import DateField from './DateField';
import Attachments from './Attachments';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  describeClaimed, formatMoney, inclGst, matchSuppliers, milestoneAmount,
  parseLooseDate, stillToClaim, supplierSuggestions,
} from '@snag/supabase-queries';
import type {
  ExpectedCostInput, QuoteInput, QuoteLineInput, SupplierSuggestion,
} from '@snag/supabase-queries';
import {
  ProjectElement, ProjectExpectedCost, ProjectItem, ProjectMilestone, ProjectQuote,
} from '../types';

/**
 * What the walkthrough hands back. One object, applied by the screen.
 *
 * **Nothing is written until the last step**, so the sheet collects a plan and
 * the screen performs it in one go. That is the thing walkthrough's rule and
 * the argument is stronger here: a half-created invoice is a wrong number in a
 * total, not merely a thin record. It is also why the lines ride along rather
 * than being added as they are typed — a contract with three of its five lines
 * saved is a build-up that does not add up.
 */
export interface RecordPlan {
  /** What the person said they had. `claim` is a bill against a named contract. */
  kind: 'quote' | 'bill' | 'claim' | 'expected';
  quote: QuoteInput | null;
  lines: QuoteLineInput[];
  expected: ExpectedCostInput | null;
  /**
   * A category the job did not have yet — *Consent and council*, *Scaffolding*.
   *
   * Named here and created by the screen, because nothing is written until the
   * last step. Only ever set from a quote: a bill records money against a job
   * somebody has already described, and a bill that can invent a bucket is how
   * "Whole job" came back twice.
   */
  newPart: string | null;
  /** A price this replaces, turned down rather than deleted. */
  declineQuoteId: string | null;
  /** An expectation this makes real — `settled_by`, so the guess stops counting. */
  settleExpectedId: string | null;
}

interface Props {
  visible: boolean;
  projectId: string;
  householdId: string;
  elements: ProjectElement[];
  items: ProjectItem[];
  /** Every price on this job — who has been used, and which contracts are live. */
  quotes: ProjectQuote[];
  /** Guesses not yet made real, offered on the *replaces* step. */
  expected: ProjectExpectedCost[];
  milestones: ProjectMilestone[];
  /** Names from elsewhere in the household, so a second job starts warm. */
  knownSuppliers: string[];
  /** Whether the part layer is drawn. An implicit part is never offered by name. */
  showElements: boolean;
  onFinish: (plan: RecordPlan) => Promise<void>;
  onClose: () => void;
}

type Step = 'who' | 'what' | 'replaces' | 'details' | 'against' | 'breakdown' | 'files';
type Kind = RecordPlan['kind'];
type Level = 'project' | 'element' | 'item';

const emptyLine = { name: '', amount: '', incl: true, allowance: false };

/**
 * Recording money, one question at a time.
 *
 * **The fields were never the problem.** `RecordBillSheet` asked the same four
 * things on one page — what kind of paper, who from, how much, what it is
 * against — and the live job still came out wrong in three different ways: a
 * $176,755 contract recorded as an invoice, its progress claims recorded as
 * *payments* against that invoice, and both hung off items named after the
 * paperwork inside a part called "Builders Quote". Four independent questions
 * on one page teach nothing, so somebody who does not already hold the model
 * in their head answers them plausibly and wrongly.
 *
 * So the questions are asked in an order where **each answer narrows the next
 * one**, and the vocabulary is what somebody holding a piece of paper would
 * use rather than the schema's.
 *
 * **Who first, which is the change that pays for the rest.** Naming the
 * supplier is the one thing you always know without reading the document, and
 * it is the most powerful key: once it is ReliaBuilder, the app knows there is
 * a signed contract and can offer *a claim against it* — the sentence the old
 * sheet had no way to say and whose absence produced every wrong number on the
 * page.
 *
 * **A step only appears when it has a real answer to offer.** A claim inherits
 * its contract's scope, so it never sees the *against* step; a bill is not
 * broken into lines, so it never sees *what's it made of*; *replaces* appears
 * only when there is something it could replace. The frequent thing — a claim
 * from a supplier already on the job — is three screens and five taps. The rare
 * thing, a first contract from a new supplier with a full build-up, is all
 * seven, and that is the once-per-job moment somebody is at a desk with the
 * contract in front of them. It is the answers that decide, never a mode
 * switch.
 *
 * **It never invents scope for a bill.** The rule that stopped "Whole job"
 * appearing, kept. A quote may name a new part — *Consent and council*,
 * *Scaffolding*, *Engineering* — because a quote is a planning moment where
 * you are describing what the job is; a bill is a recording moment where the
 * job is already described, and a bill that can make a bucket is how the
 * paperwork-shaped part came back twice.
 */
export default function RecordMoneySheet({
  visible, projectId, householdId, elements, items, quotes, expected, milestones,
  knownSuppliers, showElements, onFinish, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [step, setStep] = useState<Step>('who');
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>('bill');
  const [contract, setContract] = useState<ProjectQuote | null>(null);

  const [replaces, setReplaces] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [reference, setReference] = useState('');
  const [detail, setDetail] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [basis, setBasis] = useState<'fixed' | 'estimate'>('fixed');
  const [signed, setSigned] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  const [level, setLevel] = useState<Level>('project');
  const [elementId, setElementId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [newPart, setNewPart] = useState('');

  const [lines, setLines] = useState<typeof emptyLine[]>([]);
  const [lineForm, setLineForm] = useState(emptyLine);

  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [documentPaths, setDocumentPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setStep('who');
    setSearch('');
    setSupplier(null);
    setKind('bill');
    setContract(null);
    setReplaces(null);
    setAmount('');
    setIncl(true);
    setReference('');
    setDetail('');
    setDueOn('');
    setMilestoneId(null);
    setBasis('fixed');
    setSigned(true);
    setConfirmed(false);
    setLevel('project');
    setElementId(null);
    setItemId(null);
    setNewPart('');
    setLines([]);
    setLineForm(emptyLine);
    setPhotoPaths([]);
    setDocumentPaths([]);
    setBusy(false);
  }, [visible]);

  const suggestions = useMemo(
    () => supplierSuggestions(quotes, knownSuppliers),
    [quotes, knownSuppliers]
  );
  const matches = useMemo(() => matchSuppliers(suggestions, search), [suggestions, search]);
  const chosen = useMemo(
    () => suggestions.find((s) => s.name.toLowerCase() === (supplier ?? '').toLowerCase()) ?? null,
    [suggestions, supplier]
  );

  /** What this supplier has sent before that a new price could replace. */
  const replaceable = useMemo(() => {
    if (!supplier) return { quotes: [] as ProjectQuote[], expected: [] as ProjectExpectedCost[] };
    const key = supplier.trim().toLowerCase();
    const same = (name: string | null) => (name ?? '').trim().toLowerCase() === key;
    return {
      quotes: quotes.filter(
        (q) => same(q.supplier) && q.kind === 'quote' && q.status === 'tbc'
      ),
      expected: expected.filter((x) => same(x.likelySupplier) && x.settledBy === null),
    };
  }, [quotes, expected, supplier]);

  const canReplace = replaceable.quotes.length + replaceable.expected.length > 0;

  /**
   * The steps this answer set actually needs.
   *
   * Built rather than branched through, so the progress line can be honest
   * about how far in somebody is — "2 of 4" on a claim and "2 of 7" on a
   * contract is the sheet telling the truth about what it is going to ask.
   */
  const steps = useMemo<Step[]>(() => [
    'who',
    'what',
    ...(canReplace && kind !== 'claim' ? (['replaces'] as Step[]) : []),
    'details',
    ...(kind === 'claim' ? [] : (['against'] as Step[])),
    ...(kind === 'quote' ? (['breakdown'] as Step[]) : []),
    ...(kind === 'expected' ? [] : (['files'] as Step[])),
  ], [canReplace, kind]);

  const at = Math.max(0, steps.indexOf(step));
  const last = at === steps.length - 1;

  const parsedAmount = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
  const hasAmount = Number.isFinite(parsedAmount);
  const namedPart = newPart.trim();

  const canNext = (() => {
    switch (step) {
      case 'who': return !!supplier;
      case 'what': return true;
      case 'replaces': return true;
      // An expected cost may carry no figure at all — "there will be council
      // costs" is a named gap and worth recording. Everything else needs one.
      case 'details': return kind === 'expected' ? detail.trim().length > 0 : hasAmount;
      case 'against':
        if (level === 'element') return elementId !== null || namedPart.length > 0;
        if (level === 'item') return itemId !== null;
        return true;
      case 'breakdown': return true;
      case 'files': return true;
      default: return false;
    }
  })();

  function go(delta: 1 | -1) {
    const next = steps[at + delta];
    if (next) setStep(next);
    else if (delta === -1) onClose();
  }

  /** The scope a claim inherits, so it lands exactly where its contract sits. */
  function claimScope(): Pick<QuoteInput, 'itemId' | 'elementId' | 'projectId'> {
    return {
      itemId: contract?.itemId ?? null,
      elementId: contract?.elementId ?? null,
      projectId: contract?.projectId ?? null,
    };
  }

  function chosenScope(): Pick<QuoteInput, 'itemId' | 'elementId' | 'projectId'> {
    if (kind === 'claim') return claimScope();
    if (level === 'item') return { itemId, elementId: null, projectId: null };
    if (level === 'element' && elementId) return { itemId: null, elementId, projectId: null };
    return { itemId: null, elementId: null, projectId };
  }

  async function finish() {
    if (busy || !canNext) return;
    setBusy(true);
    try {
      const money = hasAmount ? parsedAmount : null;
      // Their own convention, kept: "INV-0208 — claim 2, 25%".
      const described = [reference.trim(), detail.trim()].filter(Boolean).join(' — ') || null;
      const settleExpectedId = replaces?.startsWith('x:') ? replaces.slice(2) : null;
      const declineQuoteId = replaces?.startsWith('q:') ? replaces.slice(2) : null;

      if (kind === 'expected') {
        await onFinish({
          kind,
          quote: null,
          lines: [],
          expected: {
            name: detail.trim(),
            amount: money,
            amountInclGst: incl,
            likelySupplier: supplier,
            elementId: level === 'element' ? elementId : null,
            confirmed,
          },
          newPart: null,
          declineQuoteId,
          settleExpectedId,
        });
      } else {
        const isBill = kind === 'bill' || kind === 'claim';
        await onFinish({
          kind,
          quote: {
            ...chosenScope(),
            supplier,
            detail: described,
            amount: money,
            amountInclGst: incl,
            kind: isBill ? 'invoice' : 'quote',
            // A bill is a fact, so it lands accepted. A quote is a decision,
            // and step three asked it outright rather than assuming.
            status: isBill ? 'accepted' : signed ? 'accepted' : 'tbc',
            basis: kind === 'quote' ? basis : 'fixed',
            dueOn: isBill ? parseLooseDate(dueOn) ?? null : null,
            againstQuoteId: kind === 'claim' ? contract?.id ?? null : null,
            settlesMilestoneId: kind === 'claim' ? milestoneId : null,
            photoPaths,
            documentPaths,
          },
          lines: lines
            .filter((l) => l.name.trim().length > 0)
            .map((l) => {
              const parsed = Number(l.amount.replace(/[^0-9.]/g, ''));
              return {
                name: l.name.trim(),
                amount: Number.isFinite(parsed) ? parsed : null,
                amountInclGst: l.incl,
                isAllowance: l.allowance,
                allowanceKind: l.allowance ? 'pc_sum' : null,
              };
            }),
          expected: null,
          newPart: kind === 'quote' && level === 'element' && namedPart ? namedPart : null,
          declineQuoteId,
          settleExpectedId,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  const left = contract ? stillToClaim(contract) : null;
  const unclaimed = contract
    ? milestones.filter(
      (m) => m.quoteId === contract.id && !quotes.some((q) => q.settlesMilestoneId === m.id)
    )
    : [];

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
          <View style={styles.headTitles}>
            <Text style={styles.title}>Record a bill or a quote</Text>
            <Text style={styles.progress}>
              {`Step ${at + 1} of ${steps.length}`}
              {supplier ? ` · ${supplier}` : ''}
            </Text>
          </View>
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
          {/* ── 1 · who ──────────────────────────────────────────────────
              The one thing you know without reading the document, and the key
              that lets every later step narrow itself. Rows with a search
              rather than a wall of chips — `RoomPicker`'s argument, and the
              same substring match, so "relia" finds ReliaBuilder. */}
          {step === 'who' ? (
            <>
              <Text style={styles.question}>Who&rsquo;s it from?</Text>
              <TextInput
                style={styles.input}
                value={search}
                onChangeText={setSearch}
                autoFocus
                autoCapitalize="words"
                accessibilityLabel="Search who it's from"
              />
              {matches.map((one) => (
                <SupplierRow
                  key={one.name}
                  supplier={one}
                  on={supplier?.toLowerCase() === one.name.toLowerCase()}
                  onPress={() => {
                    setSupplier(one.name);
                    setContract(one.contract);
                    setKind(one.contract ? 'claim' : 'bill');
                    setStep('what');
                  }}
                />
              ))}
              {/* No match is never a dead end, and adding is the only live
                  control — so there is no dead Next underneath it. */}
              {search.trim().length > 0
                && !matches.some((m) => m.name.toLowerCase() === search.trim().toLowerCase()) ? (
                  <Pressable
                    onPress={() => {
                      setSupplier(search.trim());
                      setContract(null);
                      setKind('bill');
                      setStep('what');
                    }}
                    style={styles.addRow}
                    accessibilityRole="button"
                    accessibilityLabel={`Add "${search.trim()}"`}
                  >
                    <Icon name="add" size="sm" color={Colors.primary} />
                    <Text style={styles.addLabel}>Add &ldquo;{search.trim()}&rdquo;</Text>
                  </Pressable>
                ) : null}
              {matches.length === 0 && search.trim().length === 0 ? (
                <Text style={styles.hint}>
                  Nobody yet. Type who sent it and add them — there&rsquo;s no list to set up first.
                </Text>
              ) : null}
            </>
          ) : null}

          {/* ── 2 · what ─────────────────────────────────────────────────
              Where the narrowing pays for itself. A supplier with a signed
              contract gets *a claim against it* offered first, with what is
              left to claim underneath — which is the sentence the old sheet
              could not say and whose absence made a $176,755 contract read as
              fully billed. */}
          {step === 'what' ? (
            <>
              <Text style={styles.question}>What have they sent you?</Text>
              {contract ? (
                <Text style={styles.context}>
                  {contract.detail ?? 'Their contract'} — {describeClaimed(contract)}
                </Text>
              ) : null}
              {([
                ...(contract
                  ? [['claim', 'A claim against the contract', 'a progress invoice drawing it down'] as const]
                  : []),
                ['bill', contract ? 'A separate bill' : 'A bill', contract ? 'work outside the contract' : 'an invoice for work done'] as const,
                ['quote', contract ? 'Another quote' : 'A quote', contract ? 'a variation, or new work' : 'a price for work not yet agreed'] as const,
                ['expected', 'A cost to expect', 'somebody warned you; nobody has quoted it'] as const,
              ]).map(([option, label, sub]) => (
                <Pressable
                  key={option}
                  onPress={() => { setKind(option as Kind); go(1); }}
                  style={[styles.option, kind === option && styles.optionOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: kind === option }}
                  accessibilityLabel={label}
                >
                  <View style={styles.optionTitles}>
                    <Text style={styles.optionName}>{label}</Text>
                    <Text style={styles.optionSub}>{sub}</Text>
                  </View>
                  <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
                </Pressable>
              ))}
            </>
          ) : null}

          {/* ── 3 · replaces ────────────────────────────────────────────
              Only ever drawn when there is something to replace. Picking an
              expectation sets `settled_by`, so the guess stops counting the
              moment the real number lands — and the pair is what lets the app
              say "we thought $4,000 and it was $5,600" later. */}
          {step === 'replaces' ? (
            <>
              <Text style={styles.question}>Does this replace something?</Text>
              <Text style={styles.context}>You already have from {supplier}:</Text>
              {replaceable.expected.map((x) => (
                <ReplaceRow
                  key={x.id}
                  label={x.name}
                  sub={`a cost you expected · ${formatMoney(inclGst(x.amount, x.amountInclGst)) ?? 'no figure'}`}
                  on={replaces === `x:${x.id}`}
                  onPress={() => setReplaces(replaces === `x:${x.id}` ? null : `x:${x.id}`)}
                />
              ))}
              {replaceable.quotes.map((q) => (
                <ReplaceRow
                  key={q.id}
                  label={q.detail ?? 'A price'}
                  sub={`quote, not decided · ${formatMoney(q.amountIncl) ?? '—'}`}
                  on={replaces === `q:${q.id}`}
                  onPress={() => setReplaces(replaces === `q:${q.id}` ? null : `q:${q.id}`)}
                />
              ))}
              <ReplaceRow
                label="Nothing — this is new"
                sub={null}
                on={replaces === null}
                onPress={() => setReplaces(null)}
              />
            </>
          ) : null}

          {/* ── 4 · details ─────────────────────────────────────────────── */}
          {step === 'details' ? (
            <>
              <Text style={styles.question}>
                {kind === 'expected' ? 'What&rsquo;s the cost for?' : 'How much?'}
              </Text>

              {kind === 'claim' && unclaimed.length > 0 ? (
                <>
                  <Text style={styles.context}>Against the contract&rsquo;s schedule:</Text>
                  {unclaimed.map((m) => {
                    const due = milestoneAmount(m, contract?.effectiveAmount ?? null);
                    const on = milestoneId === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => {
                          if (on) { setMilestoneId(null); return; }
                          setMilestoneId(m.id);
                          // Filling the amount is the point of offering it.
                          if (due !== null) { setAmount(String(due)); setIncl(true); }
                          if (!detail.trim()) setDetail(m.name);
                        }}
                        style={[styles.option, on && styles.optionOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${m.name}, ${formatMoney(due) ?? 'no figure'}`}
                      >
                        <View style={styles.optionTitles}>
                          <Text style={styles.optionName}>{m.name}</Text>
                          <Text style={styles.optionSub}>
                            {m.percent !== null ? `${m.percent}% · ` : ''}
                            {formatMoney(due) ?? 'no figure'}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </>
              ) : null}

              {kind !== 'expected' ? (
                <MoneyField
                  label="Amount"
                  value={amount}
                  onChangeValue={setAmount}
                  inclusive={incl}
                  onChangeInclusive={setIncl}
                />
              ) : null}

              {kind === 'bill' || kind === 'claim' ? (
                <>
                  <Text style={styles.label}>INVOICE NUMBER</Text>
                  <TextInput
                    style={styles.input}
                    value={reference}
                    onChangeText={setReference}
                    accessibilityLabel="Invoice number"
                  />
                </>
              ) : null}

              <Text style={styles.label}>
                {kind === 'expected' ? 'WHAT IS IT' : "WHAT'S IT FOR"}
              </Text>
              <TextInput
                style={styles.input}
                value={detail}
                onChangeText={setDetail}
                accessibilityLabel={kind === 'expected' ? 'What the cost is for' : "What it's for"}
              />

              {kind === 'expected' ? (
                <>
                  <MoneyField
                    label="Roughly how much"
                    value={amount}
                    onChangeValue={setAmount}
                    inclusive={incl}
                    onChangeInclusive={setIncl}
                  />
                  <Text style={styles.hint}>
                    Leave it empty if nobody has given you a figure — it shows as a gap rather
                    than disappearing.
                  </Text>
                  <Text style={styles.label}>HAS ANYBODY AGREED IT?</Text>
                  <Halves
                    on={confirmed}
                    yes="Confirmed"
                    no="Not yet"
                    onChange={setConfirmed}
                  />
                  <Text style={styles.hint}>
                    {confirmed
                      ? 'It counts as committed, and it’s still not invoiced or paid.'
                      : 'It counts towards the forecast alone, and every figure says it’s a guess.'}
                  </Text>
                </>
              ) : null}

              {kind === 'bill' || kind === 'claim' ? (
                <DateField
                  label="When's it due?"
                  value={dueOn}
                  onChangeValue={setDueOn}
                />
              ) : null}

              {/* The one field whose absence left a $176,755 contract out of
                  Committed for five months, asked at the moment the person
                  definitely knows the answer. */}
              {kind === 'quote' ? (
                <>
                  <Text style={styles.label}>CAN THIS NUMBER MOVE?</Text>
                  <Halves
                    on={basis === 'estimate'}
                    yes="It's an estimate"
                    no="Fixed price"
                    onChange={(v) => setBasis(v ? 'estimate' : 'fixed')}
                  />
                  <Text style={styles.label}>HAVE YOU SIGNED IT?</Text>
                  <Halves on={signed} yes="Signed" no="Not yet" onChange={setSigned} />
                </>
              ) : null}
            </>
          ) : null}

          {/* ── 5 · against ─────────────────────────────────────────────
              Never shown for a claim: it inherits its contract's scope, which
              is what keeps a contract and its claims out of Committed twice —
              and `create_quote` refuses anything else, so the rule holds even
              if this screen is ever wrong. */}
          {step === 'against' ? (
            <>
              <Text style={styles.question}>What&rsquo;s it against?</Text>
              {([
                ['project', 'The whole job'] as const,
                ...(showElements && elements.length > 0 ? [['element', 'A part of it'] as const] : []),
                ...(kind !== 'expected' && items.length > 0 ? [['item', 'One item'] as const] : []),
              ]).map(([option, label]) => (
                <Pressable
                  key={option}
                  onPress={() => setLevel(option as Level)}
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: level === option }}
                  accessibilityLabel={label}
                >
                  <View style={[styles.chip, level === option && styles.chipOn]}>
                    <Text style={[styles.chipLabel, level === option && styles.chipLabelOn]}>
                      {label}
                    </Text>
                  </View>
                </Pressable>
              ))}

              {level === 'element' ? (
                <>
                  {elements.map((e) => (
                    <ReplaceRow
                      key={e.id}
                      label={e.name}
                      sub={e.room}
                      on={elementId === e.id}
                      onPress={() => { setElementId(e.id); setNewPart(''); }}
                    />
                  ))}
                  {/* A quote may name a part the job did not have — *Consent and
                      council*, *Scaffolding*. A bill may not, which is the rule
                      that stopped "Whole job" and has to keep stopping it. */}
                  {kind === 'quote' ? (
                    <>
                      <Text style={styles.label}>OR A NEW CATEGORY</Text>
                      <TextInput
                        style={styles.input}
                        value={newPart}
                        onChangeText={(t) => { setNewPart(t); if (t.trim()) setElementId(null); }}
                        accessibilityLabel="Name a new category"
                      />
                      <Text style={styles.hint}>
                        For the parts that aren&rsquo;t rooms — engineering, consent, scaffolding.
                      </Text>
                    </>
                  ) : null}
                </>
              ) : null}

              {level === 'item' ? (
                items
                  .filter((i) => !elementId || i.elementId === elementId)
                  .map((i) => (
                    <ReplaceRow
                      key={i.id}
                      label={i.name}
                      sub={null}
                      on={itemId === i.id}
                      onPress={() => setItemId(i.id)}
                    />
                  ))
              ) : null}
            </>
          ) : null}

          {/* ── 6 · breakdown ───────────────────────────────────────────
              Optional, and the reason the money model exists. A line flagged
              as an allowance is what turns a later price into an early
              warning — "tiles were allowed $12,400, Tile Depot has quoted
              $15,900" — months before the invoice and off real numbers. The
              live contract has been one opaque figure the whole time, so none
              of that has ever fired. */}
          {step === 'breakdown' ? (
            <>
              <Text style={styles.question}>What&rsquo;s it made of?</Text>
              <Text style={styles.context}>
                Optional — you can break it up later, as the claims come in.
              </Text>
              {lines.map((l, i) => (
                <View key={`${l.name}-${i}`} style={styles.lineRow}>
                  <Text style={styles.lineName} numberOfLines={1}>
                    {l.name}{l.allowance ? '  ⚑' : ''}
                  </Text>
                  <Text style={styles.lineAmount} numberOfLines={1}>
                    {formatMoney(inclGst(Number(l.amount.replace(/[^0-9.]/g, '')) || null, l.incl)) ?? '—'}
                  </Text>
                  <Pressable
                    onPress={() => setLines(lines.filter((_, n) => n !== i))}
                    style={styles.lineRemove}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${l.name}`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))}

              <Text style={styles.label}>LINE</Text>
              <TextInput
                style={styles.input}
                value={lineForm.name}
                onChangeText={(t) => setLineForm({ ...lineForm, name: t })}
                accessibilityLabel="What the line is"
              />
              <MoneyField
                label="Line amount"
                value={lineForm.amount}
                onChangeValue={(t) => setLineForm({ ...lineForm, amount: t })}
                inclusive={lineForm.incl}
                onChangeInclusive={(v) => setLineForm({ ...lineForm, incl: v })}
              />
              <Text style={styles.label}>IS IT AN ALLOWANCE?</Text>
              <Halves
                on={lineForm.allowance}
                yes="An allowance"
                no="A firm price"
                onChange={(v) => setLineForm({ ...lineForm, allowance: v })}
              />
              <Text style={styles.hint}>
                An allowance is a figure they wrote down for something not yet priced. Flagging it
                is what lets a later quote say how far over it came in.
              </Text>
              <Pressable
                onPress={() => {
                  if (!lineForm.name.trim()) return;
                  setLines([...lines, lineForm]);
                  setLineForm(emptyLine);
                }}
                style={styles.addRow}
                accessibilityRole="button"
                accessibilityLabel="Add this line"
              >
                <Icon name="add" size="sm" color={Colors.primary} />
                <Text style={styles.addLabel}>Add this line</Text>
              </Pressable>
            </>
          ) : null}

          {/* ── 7 · files ───────────────────────────────────────────────
              The document is in your hand now. Asking later means asking you to
              go and find it, which is the thing walkthrough's argument for the
              rating plate, one noun over. */}
          {step === 'files' ? (
            <>
              <Text style={styles.question}>Anything to attach?</Text>
              <Attachments
                householdId={householdId}
                photoPaths={photoPaths}
                documentPaths={documentPaths}
                onChange={async (next) => {
                  setPhotoPaths(next.photoPaths ?? photoPaths);
                  setDocumentPaths(next.documentPaths ?? documentPaths);
                }}
                emptyLabel="A photo of the invoice, or the PDF."
              />
            </>
          ) : null}
        </ScrollView>

        <View style={styles.foot}>
          <Pressable
            onPress={() => go(-1)}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel={at === 0 ? 'Close' : 'Back'}
          >
            <Text style={styles.backLabel}>{at === 0 ? 'Close' : 'Back'}</Text>
          </Pressable>
          {/* Hidden on the one step whose only live control is choosing — a dead
              button under it is a choice that isn't one. */}
          {step === 'who' || step === 'what' ? null : (
            <Pressable
              onPress={() => (last ? finish() : go(1))}
              disabled={busy || !canNext}
              style={[styles.cta, (busy || !canNext) && styles.ctaOff]}
              accessibilityRole="button"
              accessibilityLabel={last ? 'Record it' : 'Next'}
            >
              {busy ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={[styles.ctaLabel, !canNext && styles.ctaLabelOff]}>
                  {last ? 'Record it' : step === 'breakdown' && lines.length === 0 ? 'Skip for now' : 'Next'}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Two named halves, the app's one chip shape. */
function Halves({
  on, yes, no, onChange,
}: { on: boolean; yes: string; no: string; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.pill}>
      <Pressable
        onPress={() => onChange(true)}
        style={[styles.half, on && styles.halfOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={yes}
      >
        <Text style={[styles.halfLabel, on && styles.halfLabelOn]}>{yes}</Text>
      </Pressable>
      <Pressable
        onPress={() => onChange(false)}
        style={[styles.half, !on && styles.halfOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: !on }}
        accessibilityLabel={no}
      >
        <Text style={[styles.halfLabel, !on && styles.halfLabelOn]}>{no}</Text>
      </Pressable>
    </View>
  );
}

function SupplierRow({
  supplier, on, onPress,
}: { supplier: SupplierSuggestion; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, on && styles.optionOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={supplier.name}
    >
      <View style={styles.optionTitles}>
        <Text style={styles.optionName}>{supplier.name}</Text>
        {supplier.note ? <Text style={styles.optionSub}>{supplier.note}</Text> : null}
      </View>
      <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
    </Pressable>
  );
}

function ReplaceRow({
  label, sub, on, onPress,
}: { label: string; sub: string | null; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.option, on && styles.optionOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Icon
        name={on ? 'checkmark-circle' : 'ellipse-outline'}
        size="sm"
        color={on ? Colors.primary : Colors.textMuted}
      />
      <View style={styles.optionTitles}>
        <Text style={styles.optionName}>{label}</Text>
        {sub ? <Text style={styles.optionSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43,39,36,0.35)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
  },
  grab: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  headTitles: { flex: 1, minWidth: 0 },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  progress: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  headTap: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
  scroll: { marginTop: Spacing.sm },

  question: {
    fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary,
    marginTop: Spacing.md, marginBottom: Spacing.sm,
  },
  context: { fontSize: Typography.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  label: {
    fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
    color: Colors.textMuted, marginTop: Spacing.md, marginBottom: Spacing.xs,
  },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.xs },
  input: {
    backgroundColor: Colors.sunken, borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: Typography.base, color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET, minWidth: 0,
  },

  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.sunken, borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET, marginBottom: Spacing.xs,
  },
  optionOn: { backgroundColor: Colors.primaryLight },
  optionTitles: { flex: 1, minWidth: 0 },
  optionName: { fontSize: Typography.base, color: Colors.textPrimary, fontWeight: Typography.medium },
  optionSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },

  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET, marginTop: Spacing.xs,
  },
  addLabel: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.semibold },

  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginBottom: Spacing.xs },
  chip: {
    backgroundColor: Colors.sunken, borderRadius: Radius.chip,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignSelf: 'flex-start',
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },

  pill: {
    flexDirection: 'row', alignSelf: 'flex-start',
    backgroundColor: Colors.sunken, borderRadius: Radius.chip, overflow: 'hidden',
  },
  half: { paddingHorizontal: Spacing.md, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  halfOn: { backgroundColor: Colors.primary },
  halfLabel: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  halfLabelOn: { color: Colors.white },

  lineRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  lineName: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textPrimary },
  lineAmount: { fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textPrimary },
  lineRemove: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },

  foot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  back: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.md,
  },
  backLabel: { fontSize: Typography.base, color: Colors.textSecondary },
  cta: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: Radius.button,
    alignItems: 'center', justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET, paddingVertical: Spacing.md,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { color: Colors.white, fontSize: Typography.base, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
});

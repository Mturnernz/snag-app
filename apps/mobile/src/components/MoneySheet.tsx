import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, Switch, StyleSheet } from 'react-native';

import Icon from './Icon';
import Sheet from './Sheet';
import MoneyField from './MoneyField';
import DateField from './DateField';
import Attachments from './Attachments';
import {
  AddRow, Group, PrimaryButton, RadioRow, Row, Segmented, TextButton, groupedStyles,
} from './Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  addPayment, addQuoteLine, createElement, createExpectedCost, createItem, createQuote,
  formatMoney, setItemSetAside,
} from '../lib/supabase';
import {
  billsOnJob, dayKey, describeDuplicate, findDuplicateBill, inclGst, parseLooseDate,
} from '@snag/supabase-queries';
import type { Location, ProjectElement, ProjectItem, ProjectQuote } from '../types';

export type MoneyKind = 'quote' | 'bill' | 'receipt' | 'expected';

interface Props {
  visible: boolean;
  projectId: string;
  householdId: string;
  elements: ProjectElement[];
  items: ProjectItem[];
  quotes: ProjectQuote[];
  locations: Location[];
  knownSuppliers: string[];
  /** Where the sheet was opened from: a thing's "Add an option" starts on a quote for it. */
  start?: { kind?: MoneyKind; elementId?: string | null; itemId?: string | null } | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  /** The paper is in an inbox rather than a hand: this job's address for forwarding it. */
  onEmailIn?: () => void;
  /** Opens a bill already on the job — the one this bill looks like a copy of. */
  onOpenBill?: (quote: ProjectQuote) => void;
}

type Step = 'kind' | 'supplier' | 'form' | 'setAside';

/** A room choice: an existing part of the job, a room the job does not have yet, or the whole job. */
type Place = { kind: 'job' } | { kind: 'element'; id: string } | { kind: 'room'; room: string };

interface SetAsideRow { name: string; amount: string; incl: boolean; place: Place | null }

const KINDS: { kind: MoneyKind; title: string; subtitle: string; icon: 'document-text-outline' | 'receipt-outline' | 'checkmark-circle-outline' | 'time-outline'; tint: string; ink: string }[] = [
  { kind: 'quote', title: 'A quote or price', subtitle: 'Something you’re considering', icon: 'document-text-outline', tint: Colors.status.openBg, ink: Colors.status.open },
  { kind: 'bill', title: 'A bill', subtitle: 'Something to pay', icon: 'receipt-outline', tint: Colors.status.doingBg, ink: Colors.status.doing },
  { kind: 'receipt', title: 'A receipt', subtitle: 'Already paid', icon: 'checkmark-circle-outline', tint: Colors.primaryLight, ink: Colors.primary },
  { kind: 'expected', title: 'A cost we’re expecting', subtitle: 'No price yet', icon: 'time-outline', tint: Colors.sunken, ink: Colors.textMuted },
];

const parseAmount = (text: string): number | null => {
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return text.trim().length > 0 && Number.isFinite(n) ? n : null;
};

const sameName = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * One way in for every piece of money on a project: **what have you got?**
 *
 * The first question is the one nobody has to think about — the paper in their
 * hand is a quote, a bill, a receipt, or a warning that a cost is coming. Every
 * later question follows from it and from who sent it:
 *
 *   - **A quote for a thing** (a toilet, a vanity) is an *option* on that thing,
 *     decided later on the thing's own page. It is never asked whether it has
 *     been agreed — comparing is the point.
 *   - **A quote for the job or a room** is a price somebody may sign, so it asks
 *     *Have you agreed to go ahead?* with **no answer chosen**: a pre-filled
 *     "yes" was how a quote nobody had signed reached Committed.
 *   - **An agreed quote** then asks whether it sets money aside for things the
 *     household will choose. Each yes becomes a thing in its room, linked to the
 *     line, so choosing an option later settles the allowance.
 *   - **A bill from somebody with an agreed price** asks *Is this part of it?*,
 *     however many prices they have — the old walkthrough stopped offering the
 *     claim once a supplier had two, and the next progress bill went in as extra.
 *
 * Nothing is written until Save, and a refusal holds the sheet open with the
 * words still in it.
 *
 * **A bill that looks like one already on the job says so, and still saves.**
 * The same invoice number from the same supplier — or, where a number is
 * missing, the same supplier and amount — puts a line under the invoice number
 * naming the bill it matches, and Save reads *Save anyway*. Never a refusal:
 * two progress claims for the same figure are two bills, and the person holding
 * the paper is the one who can tell. See `findDuplicateBill`.
 */
export default function MoneySheet({
  visible, projectId, householdId, elements, items, quotes, locations, knownSuppliers,
  start, onClose, onSaved, onEmailIn, onOpenBill,
}: Props) {
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<MoneyKind>('bill');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [detail, setDetail] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [due, setDue] = useState('');
  const [paid, setPaid] = useState(false);
  const [agreed, setAgreed] = useState<'yes' | 'no' | null>(null);
  const [partOf, setPartOf] = useState<string | null>(null);
  const [place, setPlace] = useState<Place>({ kind: 'job' });
  const [placeOpen, setPlaceOpen] = useState(false);
  const [thingId, setThingId] = useState<string | null>(null);
  const [newThing, setNewThing] = useState('');
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [documentPaths, setDocumentPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProjectQuote | null>(null);
  const [setAsides, setSetAsides] = useState<SetAsideRow[]>([]);

  useEffect(() => {
    if (!visible) return;
    const startKind = start?.kind ?? null;
    setStep(startKind ? (startKind === 'expected' ? 'form' : 'supplier') : 'kind');
    setKind(startKind ?? 'bill');
    setSupplier(null); setSearch(''); setAmount(''); setIncl(true); setDetail('');
    setInvoiceNo(''); setDue(''); setPaid(false); setAgreed(null); setPartOf(null);
    setPlace(start?.elementId ? { kind: 'element', id: start.elementId } : { kind: 'job' });
    setPlaceOpen(false);
    setThingId(start?.itemId ?? null); setNewThing('');
    setPhotoPaths([]); setDocumentPaths([]);
    setBusy(false); setError(null); setSaved(null); setSetAsides([]);
  }, [visible, start]);

  // ------------------------------------------------------------ supplier
  const onProject = useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of quotes) {
      const name = q.supplier?.trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
    return [...seen.values()];
  }, [quotes]);
  const term = search.trim().toLowerCase();
  const matches = (name: string) => term.length === 0 || name.toLowerCase().includes(term);
  const projectMatches = onProject.filter(matches);
  const elsewhere = knownSuppliers
    .filter((name) => !onProject.some((p) => sameName(p, name)))
    .filter(matches);
  const exact = [...onProject, ...knownSuppliers].some((name) => sameName(name, search));

  function pickSupplier(name: string) {
    setSupplier(name.trim());
    setPartOf(null);
    setStep('form');
  }

  // --------------------------------------------------------------- scope
  const signed = useMemo(
    () => quotes.filter((q) =>
      q.kind === 'quote' && q.status === 'accepted' && supplier !== null && sameName(q.supplier, supplier)),
    [quotes, supplier]
  );
  const contract = signed.find((q) => q.id === partOf) ?? null;
  const elementName = (e: ProjectElement) => e.room ?? e.name;
  const freeRooms = locations
    .map((l) => l.name)
    .filter((room) => !elements.some((e) => sameName(e.room, room) || sameName(e.name, room)));
  const placeLabel = (p: Place | null): string => {
    if (!p || p.kind === 'job') return 'Whole job';
    if (p.kind === 'room') return p.room;
    const e = elements.find((x) => x.id === p.id);
    return e ? elementName(e) : 'Whole job';
  };
  const placeElementId = place.kind === 'element' ? place.id : null;
  const thingsHere = items.filter((i) => i.elementId === placeElementId && !i.excluded);
  const thing = items.find((i) => i.id === thingId) ?? null;
  const namingThing = newThing.trim().length > 0;
  const forAThing = kind === 'quote' && (thing !== null || namingThing);

  const money = parseAmount(amount);
  const isBill = kind === 'bill' || kind === 'receipt';
  const left = contract && money !== null
    ? (contract.amountIncl ?? 0) - (contract.claimedTotal ?? 0) - (incl ? money : money * 1.15)
    : null;

  const duplicate = useMemo(() => {
    if (!isBill || step !== 'form') return null;
    return findDuplicateBill(billsOnJob(quotes), {
      supplier,
      invoiceNumber: invoiceNo,
      amountIncl: money === null ? null : inclGst(money, incl),
      dated: null,
    });
  }, [isBill, step, quotes, supplier, invoiceNo, money, incl]);

  const missing: string | null = (() => {
    if (kind === 'expected') return detail.trim() ? null : 'Say what the cost is for';
    if (!supplier) return 'Say who it’s from';
    if (money === null) return 'Enter the amount';
    if (isBill && signed.length > 0 && partOf === null) return 'Say whether it’s part of an agreed price';
    if (kind === 'quote' && !forAThing && agreed === null) return 'Say whether you’ve agreed to go ahead';
    return null;
  })();

  async function resolveElement(p: Place): Promise<string | null> {
    if (p.kind === 'job') return null;
    if (p.kind === 'element') return p.id;
    const created = await createElement(projectId, p.room, p.room);
    return created.id;
  }

  async function save() {
    if (busy) return;
    if (missing) { setError(missing); return; }
    setBusy(true);
    setError(null);
    try {
      if (kind === 'expected') {
        const elementId = await resolveElement(place);
        await createExpectedCost(projectId, {
          name: detail.trim(),
          amount: money,
          amountInclGst: incl,
          elementId,
          likelySupplier: supplier,
        });
        await onSaved('Added as undecided');
        onClose();
        return;
      }

      let scope: { itemId: string | null; elementId: string | null; projectId: string | null };
      if (contract) {
        // A progress bill sits exactly where its contract sits — `create_quote`
        // refuses anything else, and it is what keeps the two from both counting.
        scope = { itemId: contract.itemId, elementId: contract.elementId, projectId: contract.projectId };
      } else {
        const elementId = await resolveElement(place);
        let itemId = thing?.id ?? null;
        if (!itemId && namingThing && elementId) {
          itemId = (await createItem(elementId, newThing.trim())).id;
        }
        scope = itemId
          ? { itemId, elementId: null, projectId: null }
          : elementId
            ? { itemId: null, elementId, projectId: null }
            : { itemId: null, elementId: null, projectId };
      }

      const created = await createQuote({
        ...scope,
        supplier,
        detail: detail.trim() || null,
        invoiceNumber: isBill ? invoiceNo.trim() || null : null,
        amount: money,
        amountInclGst: incl,
        kind: isBill ? 'invoice' : 'quote',
        // A bill is a fact, so it lands agreed. A quote for a thing is an
        // option; a quote for the job is agreed only when somebody said so.
        status: isBill ? 'accepted' : !scope.itemId && agreed === 'yes' ? 'accepted' : 'tbc',
        basis: 'fixed',
        dueOn: kind === 'bill' ? parseLooseDate(due) ?? null : null,
        againstQuoteId: contract?.id ?? null,
        photoPaths,
        documentPaths,
      });

      if (isBill && (kind === 'receipt' || paid) && money !== null) {
        await addPayment(created.id, { amount: money, amountInclGst: incl, paidOn: dayKey(new Date()) });
      }

      if (kind === 'quote' && !scope.itemId && agreed === 'yes') {
        // The next question only makes sense for a price that was agreed.
        setSaved(created);
        setSetAsides([{ name: '', amount: '', incl: true, place: null }]);
        setStep('setAside');
        await onSaved('Saved');
        return;
      }

      await onSaved(
        kind === 'receipt' || paid ? 'Recorded as paid'
          : forAThing ? 'Added as an option'
            : contract ? 'Progress bill recorded' : 'Recorded'
      );
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  async function saveSetAsides() {
    if (!saved || busy) return;
    setBusy(true);
    setError(null);
    try {
      for (const row of setAsides) {
        const name = row.name.trim();
        const value = parseAmount(row.amount);
        if (!name || value === null) continue;
        // eslint-disable-next-line no-await-in-loop
        const line = await addQuoteLine(saved.id, {
          name, amount: value, amountInclGst: row.incl, isAllowance: true, allowanceKind: 'pc_sum',
        });
        // eslint-disable-next-line no-await-in-loop
        const elementId = row.place && row.place.kind !== 'job' ? await resolveElement(row.place) : null;
        if (elementId) {
          // The set-aside becomes a thing in its room, so the options chosen
          // for it later know which allowance they settle.
          // eslint-disable-next-line no-await-in-loop
          const item = await createItem(elementId, name);
          // eslint-disable-next-line no-await-in-loop
          await setItemSetAside(item.id, line.id);
        }
      }
      await onSaved('Saved');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------- render
  const title = step === 'kind' ? 'What have you got?'
    : step === 'supplier' ? 'Who’s it from?'
      : step === 'setAside' ? 'Does it set money aside for things you’ll choose?'
        : kind === 'quote' ? 'New quote'
          : kind === 'receipt' ? 'New receipt'
            : kind === 'expected' ? 'A cost we’re expecting' : 'New bill';

  const subtitle = step === 'setAside' && saved
    ? `${saved.supplier ?? ''} · ${formatMoney(saved.amountIncl) ?? ''}`
    : null;

  const footer = step === 'form'
    ? <PrimaryButton label={duplicate ? 'Save anyway' : 'Save'} onPress={save} busy={busy} />
    : step === 'setAside'
      ? (
        <>
          <PrimaryButton label="Save" onPress={saveSetAsides} busy={busy} />
          <TextButton label="No, it doesn’t" onPress={onClose} />
        </>
      )
      : null;

  return (
    <Sheet
      visible={visible}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      closeLabel={step === 'setAside' ? 'Done' : 'Cancel'}
      footer={footer}
    >
      {step === 'kind' ? (
        <Group>
          {KINDS.map((k) => (
            <Row
              key={k.kind}
              title={k.title}
              subtitle={k.subtitle}
              leading={(
                <View style={[styles.kindIcon, { backgroundColor: k.tint }]}>
                  <Icon name={k.icon} size={18} color={k.ink} />
                </View>
              )}
              onPress={() => {
                setKind(k.kind);
                setStep(k.kind === 'expected' ? 'form' : 'supplier');
              }}
            />
          ))}
        </Group>
      ) : null}
      {step === 'kind' && onEmailIn ? <TextButton label="Email it in instead" onPress={onEmailIn} /> : null}

      {step === 'supplier' ? (
        <>
          <View style={styles.search}>
            <Icon name="search" size={16} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              autoFocus
              autoCapitalize="words"
              placeholder="Search or add a supplier"
              placeholderTextColor={Colors.textMuted}
              accessibilityLabel="Search suppliers"
            />
          </View>
          {search.trim().length > 0 && !exact ? (
            <AddRow label={`Add “${search.trim()}”`} onPress={() => pickSupplier(search)} />
          ) : null}
          {projectMatches.length > 0 ? (
            <View style={groupedStyles.block}>
              <Text style={styles.groupLabel}>On this project</Text>
              <Group>
                {projectMatches.map((name) => (
                  <Row key={name} title={name} onPress={() => pickSupplier(name)} />
                ))}
              </Group>
            </View>
          ) : null}
          {elsewhere.length > 0 ? (
            <View style={groupedStyles.block}>
              <Text style={styles.groupLabel}>{term ? 'Similar' : 'Used before'}</Text>
              <Group>
                {elsewhere.slice(0, 8).map((name) => (
                  <Row key={name} title={name} onPress={() => pickSupplier(name)} />
                ))}
              </Group>
            </View>
          ) : null}
        </>
      ) : null}

      {step === 'form' ? (
        <>
          <Group>
            {kind !== 'expected' || supplier ? (
              <Row
                title="From"
                value={supplier ?? 'Choose'}
                tone={supplier ? 'muted' : 'default'}
                onPress={() => setStep('supplier')}
                accessibilityLabel="Who it’s from"
              />
            ) : null}
            {kind === 'expected' ? (
              <View style={styles.field}>
                <TextInput
                  style={styles.input}
                  value={detail}
                  onChangeText={setDetail}
                  placeholder="What it’s for"
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel="What the cost is for"
                />
              </View>
            ) : null}
            <View style={styles.field}>
              <MoneyField
                label={kind === 'expected' ? 'Roughly how much' : 'Amount'}
                value={amount}
                onChangeValue={setAmount}
                inclusive={incl}
                onChangeInclusive={setIncl}
              />
            </View>
          </Group>

          {isBill && signed.length > 0 ? (
            <View style={groupedStyles.block}>
              <Text style={groupedStyles.question}>Is this part of an agreed price?</Text>
              <Group>
                {signed.map((q) => (
                  <RadioRow
                    key={q.id}
                    title={q.detail ?? 'Agreed price'}
                    subtitle={`${formatMoney(q.amountIncl) ?? '—'} · ${
                      q.claimedTotal ? `${formatMoney(q.claimedTotal)} billed so far` : 'Nothing billed yet'
                    }`}
                    selected={partOf === q.id}
                    onPress={() => setPartOf(q.id)}
                  />
                ))}
                <RadioRow title="No, it’s extra" selected={partOf === 'extra'} onPress={() => setPartOf('extra')} />
              </Group>
              {left !== null ? (
                <Text style={groupedStyles.hint}>
                  {left >= 0
                    ? `${formatMoney(left)} left to bill after this one`
                    : `${formatMoney(-left)} more than the agreed price`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {!contract ? (
            <View style={groupedStyles.block}>
              <Text style={groupedStyles.question}>What’s it for?</Text>
              <Group>
                <Row
                  title="Room"
                  value={placeLabel(place)}
                  tone="muted"
                  onPress={() => setPlaceOpen((open) => !open)}
                  accessibilityLabel="Which room"
                />
                {placeOpen ? (
                  <PlaceList
                    elements={elements}
                    freeRooms={freeRooms}
                    value={place}
                    onChange={(next) => { setPlace(next); setThingId(null); setNewThing(''); setPlaceOpen(false); }}
                  />
                ) : null}
                {kind !== 'expected' && place.kind !== 'job' ? (
                  <ThingPicker
                    things={thingsHere}
                    value={thingId}
                    naming={newThing}
                    onChange={(id) => { setThingId(id); setNewThing(''); }}
                    onName={(name) => { setNewThing(name); setThingId(null); }}
                    label={kind === 'quote' ? 'An option for' : 'Thing'}
                  />
                ) : null}
              </Group>
            </View>
          ) : null}

          {kind === 'quote' && !forAThing ? (
            <View style={groupedStyles.block}>
              <Text style={groupedStyles.question}>Have you agreed to go ahead?</Text>
              <Segmented
                accessibilityLabel="Have you agreed to go ahead?"
                options={[{ value: 'yes', label: 'Yes, agreed' }, { value: 'no', label: 'Not yet' }]}
                value={agreed}
                onChange={setAgreed}
              />
            </View>
          ) : null}

          {kind !== 'expected' ? (
            <Group>
              <View style={styles.field}>
                <TextInput
                  style={styles.input}
                  value={detail}
                  onChangeText={setDetail}
                  placeholder={kind === 'quote' ? 'What exactly' : 'What it’s for'}
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel={kind === 'quote' ? 'What exactly' : 'What it’s for'}
                />
              </View>
              {isBill ? (
                <View style={styles.field}>
                  <TextInput
                    style={styles.input}
                    value={invoiceNo}
                    onChangeText={setInvoiceNo}
                    placeholder="Invoice number"
                    placeholderTextColor={Colors.textMuted}
                    accessibilityLabel="Invoice number"
                    autoCapitalize="characters"
                  />
                </View>
              ) : null}
              {kind === 'bill' ? (
                <View style={styles.field}>
                  <DateField label="Due" value={due} onChangeValue={setDue} pickerTitle="When it’s due" />
                </View>
              ) : null}
              {kind === 'bill' ? (
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Already paid</Text>
                  <Switch
                    value={paid}
                    onValueChange={setPaid}
                    trackColor={{ true: Colors.primary, false: Colors.segment }}
                    accessibilityLabel="Already paid"
                  />
                </View>
              ) : null}
            </Group>
          ) : null}

          {duplicate ? (
            <View style={styles.duplicate} accessibilityLiveRegion="polite">
              <Icon name="copy-outline" size={18} color={Colors.status.doingFg} />
              <View style={styles.duplicateBody}>
                <Text style={styles.duplicateText}>
                  {describeDuplicate(duplicate.match, 'on the job')}
                </Text>
                {onOpenBill ? (
                  <Pressable
                    onPress={() => onOpenBill(duplicate.match.quote)}
                    style={styles.duplicateOpen}
                    accessibilityRole="button"
                    accessibilityLabel="Open the bill already on the job"
                  >
                    <Text style={styles.duplicateOpenLabel}>Open that one</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {kind !== 'expected' ? (
            <Group>
              <View style={styles.field}>
                <Attachments
                  householdId={householdId}
                  photoPaths={photoPaths}
                  documentPaths={documentPaths}
                  onChange={async (next) => {
                    if (next.photoPaths) setPhotoPaths(next.photoPaths);
                    if (next.documentPaths) setDocumentPaths(next.documentPaths);
                  }}
                />
              </View>
            </Group>
          ) : null}

          {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        </>
      ) : null}

      {step === 'setAside' ? (
        <>
          {setAsides.map((row, index) => (
            <Group key={index}>
              <View style={styles.field}>
                <TextInput
                  style={styles.input}
                  value={row.name}
                  onChangeText={(name) => setSetAsides((rows) => rows.map((r, i) => (i === index ? { ...r, name } : r)))}
                  placeholder="What it’s for"
                  placeholderTextColor={Colors.textMuted}
                  accessibilityLabel={`Set-aside ${index + 1}: what it’s for`}
                />
              </View>
              <View style={styles.field}>
                <MoneyField
                  label="Amount set aside"
                  value={row.amount}
                  onChangeValue={(amt) => setSetAsides((rows) => rows.map((r, i) => (i === index ? { ...r, amount: amt } : r)))}
                  inclusive={row.incl}
                  onChangeInclusive={(v) => setSetAsides((rows) => rows.map((r, i) => (i === index ? { ...r, incl: v } : r)))}
                />
              </View>
              <PlaceList
                elements={elements}
                freeRooms={freeRooms}
                value={row.place}
                compact
                onChange={(p) => setSetAsides((rows) => rows.map((r, i) => (i === index ? { ...r, place: p } : r)))}
              />
            </Group>
          ))}
          <AddRow
            label="Add a set-aside amount"
            onPress={() => setSetAsides((rows) => [...rows, { name: '', amount: '', incl: true, place: null }])}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      ) : null}
    </Sheet>
  );
}

/** Whole job, each part of this job, then rooms the job does not touch yet. */
function PlaceList({
  elements, freeRooms, value, onChange, compact,
}: {
  elements: ProjectElement[];
  freeRooms: string[];
  value: Place | null;
  onChange: (next: Place) => void;
  compact?: boolean;
}) {
  const on = (p: Place) =>
    value !== null && value.kind === p.kind
    && (p.kind === 'job'
      || (p.kind === 'element' && value.kind === 'element' && value.id === p.id)
      || (p.kind === 'room' && value.kind === 'room' && value.room === p.room));
  const options: { place: Place; label: string }[] = [
    ...(compact ? [] : [{ place: { kind: 'job' } as Place, label: 'Whole job' }]),
    ...elements.map((e) => ({ place: { kind: 'element', id: e.id } as Place, label: e.room ?? e.name })),
    ...freeRooms.map((room) => ({ place: { kind: 'room', room } as Place, label: room })),
  ];
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Which room">
      {options.map((o) => {
        const selected = on(o.place);
        return (
          <Pressable
            key={o.label}
            onPress={() => onChange(o.place)}
            style={styles.chipTap}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={o.label}
          >
            <View style={[styles.chip, selected && styles.chipOn]}>
              <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{o.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Which thing in the room, or a new one named here. */
function ThingPicker({
  things, value, naming, onChange, onName, label,
}: {
  things: ProjectItem[];
  value: string | null;
  naming: string;
  onChange: (id: string | null) => void;
  onName: (name: string) => void;
  label: string;
}) {
  return (
    <View style={styles.thingBlock}>
      <Text style={styles.thingLabel}>{label}</Text>
      <View style={styles.chipsInline}>
        {things.map((t) => {
          const selected = value === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => onChange(selected ? null : t.id)}
              style={styles.chipTap}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={t.name}
            >
              <View style={[styles.chip, selected && styles.chipOn]}>
                <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{t.name}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={styles.inlineInput}
        value={naming}
        onChangeText={onName}
        placeholder={things.length ? 'Or name a new thing' : 'Name the thing (optional)'}
        placeholderTextColor={Colors.textMuted}
        accessibilityLabel="Name a new thing"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  kindIcon: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    height: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: Colors.segment,
  },
  searchInput: { flex: 1, fontSize: Typography.body, color: Colors.textPrimary },
  groupLabel: {
    fontSize: Typography.title3, fontWeight: Typography.semibold, color: Colors.textPrimary,
    paddingHorizontal: 4, letterSpacing: -0.3,
  },
  field: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2 },
  input: { fontSize: Typography.body, color: Colors.textPrimary, minHeight: 32 },
  inlineInput: {
    fontSize: Typography.body, color: Colors.textPrimary, minHeight: 40,
    backgroundColor: Colors.sunken, borderRadius: Radius.input, paddingHorizontal: Spacing.md,
  },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 52, paddingHorizontal: Spacing.lg,
  },
  switchLabel: { fontSize: Typography.body, color: Colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, padding: Spacing.lg, paddingTop: Spacing.sm },
  chipsInline: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  // The pill is 34pt and the tap area 48, the split every chip row here makes.
  // It was hitSlop, which react-native-web ignores.
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    height: 34, paddingHorizontal: Spacing.md, borderRadius: 17, justifyContent: 'center',
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.subhead, color: Colors.textPrimary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  thingBlock: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  thingLabel: { fontSize: Typography.subhead, color: Colors.textMuted },
  error: { fontSize: Typography.subhead, color: Colors.danger, paddingHorizontal: 4 },
  duplicate: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    padding: Spacing.md, borderRadius: Radius.card, backgroundColor: Colors.status.doingBg,
  },
  duplicateBody: { flex: 1, minWidth: 0 },
  duplicateText: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textPrimary },
  duplicateOpen: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  duplicateOpenLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.primary },
});

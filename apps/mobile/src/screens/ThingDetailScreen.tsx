import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Image, TextInput, Pressable, Modal, ActivityIndicator, StyleSheet,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import DateField from '../components/DateField';
import PhotoViewer from '../components/PhotoViewer';
import Button from '../components/Button';
import { openUrl } from '../lib/openUrl';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import {
  consumableOnList, describeCycle, documentFileName, documentName, formatLooseDate,
  parseLooseDate, serviceJobFor, swatchColour, thingHeadline, dayKey, formatDayFirst,
} from '@snag/supabase-queries';
import {
  createSnag, deleteStoredFiles, deleteThing, getFileUrl, getFileUrls, getSnags, getThing,
  setSnagStatus, updateSnag, updateThing, uploadFile,
} from '../lib/supabase';
import { addPhotos, PhotoSource } from '../lib/addPhotos';
import ComposeBar from '../components/ComposeBar';
import { failureReason } from '../lib/deadline';
import { showAlert } from '../lib/alert';
import { copyToClipboard } from '../lib/clipboard';
import {
  FINISH_SPEC_FIELDS, RootStackParamList, SERVICE_CYCLES, Snag, Thing, ThingKind,
  THING_KIND_FIELD_LABELS,
} from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ThingDetail'>;

/**
 * A thing's spec sheet.
 *
 * **A form, and deliberately so — this is a reversal.** It used to write every
 * row on blur and render only the fields somebody had already filled in, on the
 * argument that a page of blanks is homework and a Save button is a commitment
 * nobody makes. Lived with, it failed at both ends: nothing on screen ever said
 * a change had been kept (the rows called `patch` without its toast, so every
 * edit saved in total silence), and a page that shows only what it already has
 * never tells you what it could hold. So: every field the kind can answer is on
 * screen, empty or not, and one Save button commits the typed ones together and
 * says so.
 *
 * **Taps are not in the form.** The kind chips, the room, the parts list,
 * photos and documents each still write on press. Those are single decisions
 * that are their own confirmation, and putting a dozen of them behind one
 * button is how sorting out a room becomes forty taps.
 *
 * Three things follow:
 *
 * - **A field is stacked — name above, box below, full width.** The old
 *   two-column row had nowhere to put a long answer: `MSZ-AP50VGK` and "Award
 *   Appliances" are exactly what somebody came here to read, and a right-aligned
 *   value in a flexed `<input>` both truncated them and overflowed the card.
 *   (On web an `<input>` keeps an intrinsic ~20-character width unless told
 *   `minWidth: 0`, so the row grew past its own container and spilled off the
 *   screen edge.)
 * - **Every value is tappable to copy**, and set in the mono face. These are
 *   strings people read aloud character by character or paste into a search
 *   box — `MSZ-AP50VGK`, `7BB 83/018` — and I/l/1 collapsing is a real cost
 *   when somebody is waiting on the other end of a phone.
 * - **A service interval does not schedule anything.** It writes `repeat_days`
 *   onto a snag, using the recurring mechanism the list already has. The moment
 *   there are two ways to schedule something in this app, neither is
 *   trustworthy — and this product has no notifications and never will.
 */

/** The rows every kind has, in the order somebody is asked for them. */
const DATE_FIELDS: { key: 'installedAt' | 'warrantyUntil'; label: string }[] = [
  { key: 'installedAt', label: 'Installed' },
  { key: 'warrantyUntil', label: 'Warranty until' },
];

/** What the regime sheet is holding while it is open. */
type ServiceDraft = { days: number; by: string; first: string };

const addDays = (from: Date, days: number) =>
  new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);

/** A local date as `YYYY-MM-DD`, which is what `parseLooseDate` answers in. */
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Which kinds are asked what they take, and whether they need servicing.
 *
 * Paint takes nothing and is never serviced — showing it "the filter, the bulb,
 * the cartridge" and a rail of intervals is two whole sections of the sheet
 * asking questions about a tin of paint. The equivalent answer for paint is
 * already on the record: what's left, and where the tin is.
 */
/**
 * The typed half of a thing, as strings, while somebody is editing it.
 *
 * Dates live here in the words they were typed in ("Nov 2019") rather than as
 * ISO, so that what is on screen is what was entered; `parseLooseDate` runs at
 * Save, once, where a misreading can be reported next to the field that caused
 * it instead of arriving as a Postgres 22008.
 */
type Draft = {
  name: string;
  make: string;
  model: string;
  serial: string;
  notes: string;
  installedAt: string;
  warrantyUntil: string;
  spec: Record<string, string>;
};

function draftFrom(thing: Thing): Draft {
  return {
    name: thing.name ?? '',
    make: thing.make ?? '',
    model: thing.model ?? '',
    serial: thing.serial ?? '',
    notes: thing.notes ?? '',
    installedAt: formatLooseDate(thing.installedAt),
    warrantyUntil: formatLooseDate(thing.warrantyUntil),
    spec: { ...thing.spec },
  };
}

/** Which fields differ from what is stored. Empty means the Save button is off. */
function changedFields(thing: Thing, draft: Draft): string[] {
  const saved = draftFrom(thing);
  const keys: (keyof Draft)[] = [
    'name', 'make', 'model', 'serial', 'notes', 'installedAt', 'warrantyUntil',
  ];
  const changed: string[] = keys.filter(
    (k) => (draft[k] as string).trim() !== (saved[k] as string).trim()
  );
  const specKeys = new Set([...Object.keys(saved.spec), ...Object.keys(draft.spec)]);
  for (const key of specKeys) {
    if ((draft.spec[key] ?? '').trim() !== (saved.spec[key] ?? '').trim()) changed.push(`spec.${key}`);
  }
  return changed;
}

const KINDS_WITH_CONSUMABLES: ThingKind[] = ['appliance', 'fitting'];
const KINDS_WITH_SERVICING: ThingKind[] = ['appliance', 'fabric'];
/** A tin of paint has no serial number, and offering the row invents one. */
const KINDS_WITH_SERIAL: ThingKind[] = ['appliance', 'fitting', 'fabric'];

export default function ThingDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { thingId } = useRoute<Route>().params;
  const { household, locations } = useHousehold();
  const { showToast } = useToast();
  const keyboard = useKeyboardInset();
  const edge = useEdgeInsets();

  const [thing, setThingState] = useState<Thing | null>(null);
  const thingRef = useRef<Thing | null>(null);
  const setThing = useCallback((next: Thing | null) => {
    thingRef.current = next;
    setThingState(next);
  }, []);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // Which photo is open full screen, or null. A rating plate is the whole
  // reason this tab exists and is unreadable in a 220px tile.
  const [viewing, setViewing] = useState<number | null>(null);
  /** Twelve chips stand down to one pill until somebody says otherwise. */
  const [roomOpen, setRoomOpen] = useState(false);
  const [service, setService] = useState<ServiceDraft | null>(null);
  /**
   * The repeating job on the list that services this thing, if any. The one
   * source for the cycle this page shows — see `serviceJobFor`.
   */
  const [serviceJob, setServiceJob] = useState<Snag | null>(null);
  const [consumableDraft, setConsumableDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // The typed fields, as typed. Each is written when its box is left — and
  // anything still in a box when the page is left is written then — so there
  // is no Save to find and nothing to discard. Taps write on press, as ever.
  //
  // A ref beside the state, because the calendar fills a box and commits in
  // one gesture, before React has re-rendered with the new value.
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const setDraft = useCallback((next: Draft | null | ((d: Draft | null) => Draft | null)) => {
    const value = typeof next === 'function' ? next(draftRef.current) : next;
    draftRef.current = value;
    setDraftState(value);
  }, []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await getThing(thingId);
      setThing(found);
      setDraft(draftFrom(found));
      setPhotoUrls(await getFileUrls(found.photoPaths));
      // Never fatal: a page that cannot see the list still shows the record.
      if (KINDS_WITH_SERVICING.includes(found.kind)) {
        let open: Snag[] = [];
        try {
          open = (await getSnags({ propertyId: found.propertyId, status: ['open', 'doing'] })) ?? [];
        } catch {
          open = [];
        }
        setServiceJob(serviceJobFor(open, found.id));
      }
    } catch (err: any) {
      showAlert("Couldn't load that", err?.message ?? 'Please try again.');
    }
  }, [thingId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * **Leaving saves.** The page used to be a form with one Save button, and a
   * back gesture over typed words asked *Leave without saving?* — a question
   * with a wrong answer that loses work. Every box now writes when it is left,
   * and one still being typed in when the page goes is written on the way out.
   * A date no calendar has holds the page, with the words still in the box.
   */
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  useEffect(() => {
    const stop = navigation.addListener('beforeRemove', (e) => {
      const current = thingRef.current;
      if (!current || !draftRef.current || changedFields(current, draftRef.current).length === 0) return;
      e.preventDefault();
      saveRef.current().then((ok) => {
        if (ok) navigation.dispatch(e.data.action);
      });
    });
    return stop;
  }, [navigation]);

  async function patch(update: Parameters<typeof updateThing>[1], toast?: string) {
    if (!thing || busy) return;
    setBusy(true);
    try {
      const next = await updateThing(thing.id, update);
      setThing(next);
      // A photo just added has no signed URL yet, and an <Image> pointed at
      // undefined is a silent blank rather than an error.
      if (next.photoPaths.some((path) => !photoUrls[path])) {
        setPhotoUrls(await getFileUrls(next.photoPaths));
      }
      if (toast) showToast(toast);
    } catch (err: any) {
      showAlert("That didn't save", err?.message ?? 'Please try again.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  function edit(key: keyof Draft, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function editSpec(key: string, value: string) {
    setDraft((d) => (d ? { ...d, spec: { ...d.spec, [key]: value } } : d));
  }

  /**
   * Everything typed, in one write.
   *
   * Only the changed keys are sent. `update_thing` treats a null argument as
   * "leave it alone" and reads the clear list for "make it null", so sending an
   * untouched field as an empty string would be the difference between not
   * saying anything and saying nothing is there.
   */
  async function save(): Promise<boolean> {
    const thing = thingRef.current;
    const draft = draftRef.current;
    if (!thing || !draft) return true;
    if (savingRef.current) return false;
    const changed = changedFields(thing, draft);
    if (changed.length === 0) return true;

    const update: Parameters<typeof updateThing>[1] = {};
    const text = (v: string) => (v.trim() === '' ? null : v.trim());

    if (changed.includes('name')) update.name = text(draft.name);
    if (changed.includes('make')) update.make = text(draft.make);
    if (changed.includes('model')) update.model = text(draft.model);
    if (changed.includes('serial')) update.serial = text(draft.serial);
    if (changed.includes('notes')) update.notes = text(draft.notes);

    for (const field of DATE_FIELDS) {
      if (!changed.includes(field.key)) continue;
      const typed = draft[field.key].trim();
      if (typed === '') {
        update[field.key] = null;
        continue;
      }
      const parsed = parseLooseDate(typed);
      if (parsed === undefined) {
        // The column is a real date, so an unparsed answer would come back as a
        // Postgres 22008 to somebody who answered correctly. Nothing is written.
        showAlert(
          `Couldn't read the ${field.label.toLowerCase()} date`,
          'Try a year, a month and a year, or a full date — "2019", "Nov 2019", "8 Nov 2019".'
        );
        return false;
      }
      update[field.key] = parsed;
    }

    const specChanges = changed.filter((k) => k.startsWith('spec.')).map((k) => k.slice(5));
    const spec: Record<string, string> = {};
    const clearSpec: string[] = [];
    for (const key of specChanges) {
      const value = (draft.spec[key] ?? '').trim();
      if (value === '') clearSpec.push(key);
      else spec[key] = value;
    }
    if (Object.keys(spec).length > 0) update.spec = spec;
    if (clearSpec.length > 0) update.clearSpec = clearSpec;

    savingRef.current = true;
    setSaving(true);
    try {
      const next = await updateThing(thing.id, update);
      setThing(next);
      // Only the boxes that were written come back from the row: another box
      // may have been typed into while this one was on its way.
      setDraft((d) => {
        if (!d) return draftFrom(next);
        const fresh = draftFrom(next);
        const merged: Draft = { ...d, spec: { ...d.spec } };
        for (const key of changed) {
          if (key.startsWith('spec.')) merged.spec[key.slice(5)] = fresh.spec[key.slice(5)] ?? '';
          else (merged as any)[key] = (fresh as any)[key];
        }
        return merged;
      });
      showToast('Saved');
      return true;
    } catch (err: any) {
      // The draft is left exactly as typed — the words are the only copy.
      showAlert("That didn't save", err?.message ?? 'Please try again.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  saveRef.current = save;
  const commit = () => { void save(); };

  /**
   * Photos and documents write the moment they land, never via Save.
   *
   * The bytes are already in storage by then — deferring the row that points at
   * them is how you get an orphaned file nobody can reach, and a back-swipe
   * between the upload and the Save would do exactly that.
   */
  /**
   * Several photographs, one control, one write.
   *
   * **One write at the end, never one per photograph.** `patch` is a round trip
   * and a toast each time, so eight photographs would be eight writes, eight
   * re-reads and eight toasts stacking up over a page somebody is watching.
   *
   * **Uploaded one after another, not all at once.** Each one is decoded,
   * resized and re-encoded before it is sent, and doing that to eight images
   * in parallel on a phone browser is the most memory-hungry thing this app
   * could be asked to do — eight simultaneous uploads on a household
   * connection is also how the request deadlines start firing.
   *
   * **What arrived is kept.** Six uploaded and two refused means six added and
   * a sentence about the two, not nothing added and an error — the same rule
   * the PDF export follows for a photograph that will not come, and the paste
   * screen follows for a write that fails part way.
   */
  async function attachPhotos(source: PhotoSource) {
    if (!thing || !household || busy) return;
    setBusy(true);
    try {
      await addPhotos(household.id, (added) => patch(
        { photoPaths: [...thing.photoPaths, ...added] },
        added.length === 1 ? 'Photo added' : `${added.length} photos added`,
      ), source);
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(path: string) {
    if (!thing) return;
    await patch({ photoPaths: thing.photoPaths.filter((p) => p !== path) }, 'Photo removed');
  }

  async function attachDocument() {
    if (!thing || !household || busy) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      const name = documentFileName(household.id, asset.name ?? 'document.pdf');
      // The mime type goes in twice on purpose — see uploadFile. The bucket's
      // allow-list refuses anything it does not recognise, and a multipart body
      // carries the Blob's own type rather than the option.
      const { path, error } = await uploadFile(asset.uri, name, 'application/pdf');
      if (error || !path) throw error ?? new Error('The document did not upload');
      await patch({ documentPaths: [...thing.documentPaths, path] }, 'Document added');
    } catch (err: unknown) {
      showAlert("That document didn't save", failureReason(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(path: string) {
    if (!thing) return;
    await patch({ documentPaths: thing.documentPaths.filter((p) => p !== path) }, 'Document removed');
  }

  /**
   * Opened, not embedded. The deployed CSP sets `object-src 'none'` and names no
   * `frame-src`, so an inline viewer would be blocked with nothing said — see
   * apps/mobile/netlify.toml.
   */
  async function openDocument(path: string) {
    const url = await getFileUrl(path);
    if (!url) {
      showAlert("Couldn't open that", 'The link to this document could not be made.');
      return;
    }
    openUrl(url);
  }

  async function copy(label: string, value: string) {
    const ok = await copyToClipboard(value);
    showToast(ok ? `${label} copied` : value);
  }

  async function addConsumable() {
    const item = consumableDraft.trim();
    if (!item || !thing) return;
    setConsumableDraft('');
    await patch({ consumables: [...thing.consumables, item] }, 'Added');
  }

  /**
   * The cart beside a consumable: this, on the shopping list, in one tap.
   *
   * The shopping list is not a list of its own — it is every open job's parts
   * (`snags.parts`), and that is deliberate: a thing to buy without a job to
   * use it on is how a list fills with cartridges nobody fits. So the tap files
   * a small job about this thing — *Heat pump — RFC-24* — carrying the item,
   * and the trip sheet picks it up like any other.
   *
   * **It starts that job, and that is right.** Filling a parts list is one of
   * the four things that move a snag to *Doing*, and deciding to buy the filter
   * is deciding to change it — the rule the triage page already states about
   * its own `+`. What must *not* happen is the thing page quietly copying its
   * consumables onto jobs nobody asked it to; this only ever acts on a press.
   *
   * **It asks before it files.** A second tap, or the other phone having done
   * it an hour ago, answers "already on the list" rather than putting two rows
   * on the trip sheet for one cartridge (`consumableOnList`). One read of the
   * open jobs, never fatal: if it cannot be answered, filing is still the
   * honest thing to do, since a duplicate costs a tap to remove and a missing
   * filter costs a trip.
   *
   * Two writes, in this order: `create_snag` carries the link (and
   * `20260923100000` puts it in `snag_things` on the way in, so the job reads as
   * being about this thing everywhere), then `update_snag` gives it its part. A
   * job that lands without the part is still a correct job, and says so.
   */
  async function addToShoppingList(item: string) {
    if (!thing || busy) return;
    setBusy(true);
    try {
      let waiting = null;
      try {
        const open = await getSnags({ propertyId: thing.propertyId, status: ['open', 'doing'] });
        waiting = consumableOnList(open, thing.id, item);
      } catch {
        waiting = null;
      }
      if (waiting) {
        showToast(`${item} is already on the shopping list`);
        return;
      }
      const snag = await createSnag({
        propertyId: thing.propertyId,
        room: thing.room,
        description: `${thingHeadline(thing)} — ${item}`,
        thingId: thing.id,
      });
      try {
        await updateSnag(snag.id, { parts: [item] });
        showToast(`${item} is on the shopping list`);
      } catch (err: any) {
        showAlert(
          'The job is on the list, the part is not',
          `${err?.message ?? 'That didn’t save.'} Open the job and add ${item} to what it needs.`
        );
      }
    } catch (err: any) {
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * A snag about this thing, from here.
   *
   * The parts list is deliberately *not* filled in from the consumables:
   * filling it is what moves a snag to 'doing', and a job that starts itself
   * because somebody said which appliance it was about would empty the status
   * of meaning from the same end the Start button did. The detail sheet offers
   * them as taps instead.
   */
  /**
   * Something wrong with this thing, filed through the capture bar.
   *
   * It used to create the job the moment it was pressed, described as
   * *"Heat pump — "*, and open it — so somebody who pressed it and backed out
   * left a half-written job on everybody's list. Now it opens the same bar the
   * List tab files with (a photo, a line, or both) and nothing exists until it
   * is sent. The job arrives already about this thing and in its room.
   */
  const [reporting, setReporting] = useState(false);
  async function fileReport(input: { photoPaths: string[]; description: string | null }) {
    if (!thing) return;
    const snag = await createSnag({
      propertyId: thing.propertyId,
      room: thing.room,
      description: input.description,
      photoPaths: input.photoPaths,
      thingId: thing.id,
    });
    setReporting(false);
    navigation.navigate('SnagDetail', { snagId: snag.id });
  }

  /**
   * Opening the regime sheet, filled in with whatever is already arranged.
   *
   * A default cycle rather than nothing selected: somebody who pressed
   * *Schedule service* has already said they want one, and making them pick
   * from four before anything is on screen is the rail this replaced.
   */
  function openService() {
    if (!thing) return;
    const days = serviceJob?.repeatDays ?? thing.serviceDays ?? 180;
    setService({
      days,
      by: thing.spec.servicedBy ?? '',
      first: serviceJob?.dueAt
        ? formatDayFirst(dayKey(serviceJob.dueAt))
        : formatLooseDate(isoDate(addDays(new Date(), days))),
    });
  }

  /**
   * The whole arrangement, in one press.
   *
   * Two writes, and both matter. The cycle and who does it go on the *thing*,
   * because that is a fact about the appliance that outlives any one job. The
   * job itself goes on the *list*, because the list is the only place this app
   * ever tells anybody anything — there are no notifications and there never
   * will be, so a service regime that lived only on the thing's page would be a
   * note to somebody who is not looking at it.
   *
   * The date and the repeat are passed to `create_snag` rather than set
   * afterwards: setting a due date through `update_snag` is one of the four
   * things that start a job, and a service due in six months would go on the
   * list marked *Doing* today.
   */
  async function scheduleService() {
    if (!thing || !service || busy) return;
    const first = parseLooseDate(service.first.trim());
    if (service.first.trim() !== '' && first === undefined) {
      showAlert(
        "Couldn't read that date",
        'Try a month and a year, or a full date — "Mar 2027", "14 Mar 2027".'
      );
      return;
    }
    const due = first ?? isoDate(addDays(new Date(), service.days));
    const by = service.by.trim();

    setBusy(true);
    try {
      const next = await updateThing(thing.id, {
        serviceDays: service.days,
        ...(by ? { spec: { servicedBy: by } } : { clearSpec: ['servicedBy'] }),
      });
      setThing(next);
      if (serviceJob) {
        // **Edit the job that exists, never file a second.** Pressing this
        // used to create a new repeating job every time, so changing the cycle
        // left the old one running beside the new.
        const dueAt = new Date(`${due}T00:00:00`).toISOString();
        const change: Parameters<typeof updateSnag>[1] = {};
        if (serviceJob.repeatDays !== service.days) change.repeatDays = service.days;
        if (!serviceJob.dueAt || dayKey(serviceJob.dueAt) !== due) change.dueAt = dueAt;
        let updated = serviceJob;
        if (Object.keys(change).length > 0) {
          updated = await updateSnag(serviceJob.id, change);
          // A date or a repeat is one of the things that start a job, and
          // rearranging a service is not starting it: put it back as it was.
          if (serviceJob.status === 'open' && updated.status === 'doing') {
            updated = await setSnagStatus(serviceJob.id, 'open');
          }
        }
        setServiceJob(updated);
        setService(null);
        showToast(`Service job updated · every ${describeCycle(service.days)}`);
        return;
      }
      const created = await createSnag({
        propertyId: next.propertyId,
        room: next.room,
        description: `Service the ${thingHeadline(next).toLowerCase()}${by ? ` · ${by}` : ''}`,
        thingId: next.id,
        dueAt: due,
        repeatDays: service.days,
      });
      setServiceJob(created);
      setService(null);
      showToast(`On the list · every ${describeCycle(service.days)}`);
    } catch (err: any) {
      showAlert("Couldn't set that up", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Stops the regime — on the thing **and on the list**.
   *
   * It used to stop only the thing's own column, so the repeating job went on
   * coming round for ever after somebody had said it was no longer serviced.
   * The job is finished rather than deleted: its notes are the appliance's
   * history, and a finished job keeps them where *Also said about…* can find
   * them. The repeat is cleared first, or finishing would roll it forward.
   */
  async function stopService() {
    if (!thing) return;
    setService(null);
    if (serviceJob) {
      try {
        await updateSnag(serviceJob.id, { repeatDays: null });
        await setSnagStatus(serviceJob.id, 'done');
        setServiceJob(null);
      } catch (err: any) {
        showAlert("Couldn't take it off the list", err?.message ?? 'Please try again.');
        return;
      }
    }
    await patch(
      { serviceDays: null, clearSpec: ['servicedBy'] },
      serviceJob ? 'No longer serviced — taken off the list' : 'No longer serviced',
    );
  }

  async function handleDelete() {
    if (!thing) return;
    setConfirmDelete(false);
    try {
      const files = [...thing.photoPaths, ...thing.documentPaths];
      await deleteThing(thing.id);
      // Photos and paperwork both: a manual left in the bucket is the same
      // orphan as a photo, and harder to spot because nothing lists it.
      await deleteStoredFiles(files);
      showToast('Removed from the record');
      navigation.goBack();
    } catch (err: any) {
      showAlert("Couldn't remove that", err?.message ?? 'Please try again.');
    }
  }

  if (!thing) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const words = THING_KIND_FIELD_LABELS[thing.kind];
  const specFields = thing.kind === 'finish' ? FINISH_SPEC_FIELDS : [];
  // Every field the kind can answer is on screen, empty or not. It used to show
  // only what was filled in, with the rest behind an "Add a detail" row — which
  // reads as tidy and is why nobody could tell what the record could hold.

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={thingHeadline(thing)}
        subtitle={[thing.room, thing.propertyName].filter(Boolean).join(' · ')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={[styles.content, keyboard > 0 && { paddingBottom: keyboard + Spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Where it came from ──
            The payoff for recording a renovation at all, and the reason the
            record is worth keeping: three years on, nobody asks what the
            laundry cost — they ask what the model number of the machine is and
            whether it is still under warranty. This row is the door back to the
            job that installed it, where the invoice is attached to the quote
            that bought it.

            `on delete set null`, never cascade: deleting the record of the
            renovation must not delete the washing machine. The × is a sibling
            of the door rather than its child, as everywhere else. */}
        {thing.projectId && thing.projectName ? (
          <View style={styles.fromRow}>
            <Pressable
              onPress={() => navigation.navigate('ProjectDetail', { projectId: thing.projectId! })}
              style={styles.from}
              accessibilityRole="button"
              accessibilityLabel={`Installed during ${thing.projectName}`}
            >
              <View style={styles.fromTitles}>
                <Text style={styles.fromKey}>Installed during</Text>
                <Text style={styles.fromName} numberOfLines={1}>
                  {thing.projectName}
                  {thing.projectFinishedOn ? ` · ${formatLooseDate(thing.projectFinishedOn)}` : ''}
                </Text>
              </View>
              <Icon name="chevron-forward" size="sm" color={Colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => patch({ projectId: null }, 'Unlinked')}
              style={styles.fromClear}
              accessibilityRole="button"
              accessibilityLabel="Not from that job"
            >
              <Icon name="close" size="sm" color={Colors.textMuted} />
            </Pressable>
          </View>
        ) : null}

        {thing.photoPaths.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
            {thing.photoPaths.map((path, i) => (
              <View key={path} style={styles.photoWrap}>
                {/* Opening and removing are siblings, never nested: a
                    Pressable inside a Pressable is a coin toss about which
                    one gets the tap. The × is drawn after, so it wins its
                    own 28px and nothing else. */}
                <Pressable
                  onPress={() => setViewing(i)}
                  disabled={!photoUrls[path]}
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Open this photo"
                >
                  <Image source={{ uri: photoUrls[path] }} style={styles.photo} resizeMode="cover" />
                </Pressable>
                <Pressable
                  onPress={() => removePhoto(path)}
                  style={styles.photoRemove}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this photo"
                >
                  <Icon name="close" size="sm" color={Colors.white} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {/* There was an Appliance/Paint rail here, and it has gone. It existed
            because capture filed everything as `appliance` without asking, so
            the page had to be able to correct it — but the walkthrough asks the
            kind now, at the step where somebody is choosing what the thing is.
            A control that changes what kind of thing this is, sitting above a
            record somebody has already filled in, is an offer to turn a
            dishwasher into a tin of paint. Mis-filed, it is removed and added
            again; that is rarer than the mis-tap it prevents. */}
        <View style={styles.rows}>
          {/* No example values in any of these boxes.
              A grey "7A204871" in the Serial box and "Nov 2019" in Installed do
              not read as prompts — they read as a serial number and a date
              somebody already entered, on a page whose entire job is to be
              believed in a shop eight months later. The uppercase label above
              each box already says what it wants, and an empty box that looks
              empty is the whole point of the reversal that put them all on
              screen. */}
          <Field label="Name" value={draft?.name ?? ''} onChange={(v) => edit('name', v)} onBlur={commit} />
          <Field label={words.make} value={draft?.make ?? ''} onChange={(v) => edit('make', v)} onBlur={commit} />
          <Field
            label={words.model}
            value={draft?.model ?? ''}
            mono
            onCopy={copy}
            savedValue={thing.model}
            onChange={(v) => edit('model', v)}
            onBlur={commit}
          />
          {KINDS_WITH_SERIAL.includes(thing.kind) ? (
            <Field
              label="Serial"
              value={draft?.serial ?? ''}
              mono
              onCopy={copy}
              savedValue={thing.serial}
              onChange={(v) => edit('serial', v)}
              onBlur={commit}
            />
          ) : null}

          {specFields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              value={draft?.spec[field.key] ?? ''}
              mono={field.key === 'tint' || field.key === 'hex'}
              onCopy={field.key === 'tint' ? copy : undefined}
              savedValue={thing.spec[field.key] ?? null}
              onChange={(v) => editSpec(field.key, v)}
              onBlur={commit}
              // Read off the draft, so it answers while somebody types. A box
              // holding something that is not a colour says so rather than
              // drawing nothing and leaving them to wonder.
              swatch={
                field.key !== 'hex' || !(draft?.spec.hex ?? '').trim()
                  ? undefined
                  : swatchColour(draft!.spec) ?? false
              }
            />
          ))}

          {/* A calendar beside the box rather than instead of it. "Nov 2019"
              and "1998" are honest answers for a villa's wiring that no picker
              can express, and `formatLooseDate` declines to show back a day it
              would have had to invent — so the typed half is not a fallback.
              Still inside the one-Save form: the calendar fills the box, it
              does not write. */}
          {DATE_FIELDS.map((field) => (
            <DateField
              key={field.key}
              label={field.label}
              value={draft?.[field.key] ?? ''}
              onChangeValue={(v) => edit(field.key, v)}
              onBlur={commit}
              pickerTitle={field.label}
            />
          ))}

          <Field
            label={words.notes}
            value={draft?.notes ?? ''}
            multiline={thing.kind !== 'finish'}
            onChange={(v) => edit('notes', v)}
            onBlur={commit}
          />
        </View>
        {/* ── photos and paperwork ───────────────────────────────────────
            **One place to attach something to this record**, rather than a
            camera under the photo strip and a PDF button five hundred pixels
            below it. Somebody wanting to add a second photograph of the
            dishwasher goes looking in the section that attaches things, and
            finding only *Attach a PDF* there reads as the record not taking
            photographs at all.

            The strip itself stays at the top, because a rating plate is what
            this page is opened *to read* — the answer goes above the form, and
            the controls that grow it live with the rest of the attaching. The
            plate photo at creation is the walkthrough's step three and has not
            moved; these offers are for the extras that come later, which is
            exactly what they now sit beside. */}
        <Text style={styles.sectionLabel}>Photos and paperwork</Text>

        {thing.documentPaths.length > 0 ? (
          <View style={styles.docs}>
            {thing.documentPaths.map((path) => (
              <View key={path} style={styles.doc}>
                <Pressable
                  onPress={() => openDocument(path)}
                  style={styles.docOpen}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${documentName(path)}`}
                >
                  <Icon name="document-text-outline" size="sm" color={Colors.textSecondary} />
                  <Text style={styles.docName} numberOfLines={2}>{documentName(path)}</Text>
                </Pressable>
                <Pressable
                  onPress={() => removeDocument(path)}
                  style={styles.docRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${documentName(path)}`}
                >
                  <Icon name="close" size="sm" color={Colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* Siblings in one wrapping row, never nested — a Pressable inside a
            Pressable is a coin toss about which one gets the tap — and it
            wraps rather than squeezing three labels onto one phone-width
            line. */}
        <View style={styles.attachRow}>
          {/* A camera and the library, side by side. It was one *Add photos*
              on the belief that the phone's own file sheet offers *Take Photo*
              — Android Chrome does not once several files are allowed, so the
              camera meant leaving the app. See lib/addPhotos.ts. */}
          <Pressable
            onPress={() => attachPhotos('camera')}
            disabled={busy}
            style={styles.addDetail}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
          >
            <Icon name="camera-outline" size="sm" color={Colors.primary} />
            <Text style={styles.addDetailLabel}>Take photo</Text>
          </Pressable>
          <Pressable
            onPress={() => attachPhotos('library')}
            disabled={busy}
            style={styles.addDetail}
            accessibilityRole="button"
            accessibilityLabel="Choose photos"
          >
            <Icon name="images-outline" size="sm" color={Colors.primary} />
            <Text style={styles.addDetailLabel}>Choose photos</Text>
          </Pressable>
          <Pressable
            onPress={attachDocument}
            disabled={busy}
            style={styles.addDetail}
            accessibilityRole="button"
            accessibilityLabel="Attach a PDF"
          >
            <Icon name="add" size="sm" color={Colors.primary} />
            <Text style={styles.addDetailLabel}>Attach a PDF</Text>
          </Pressable>
        </View>

        {/* ── where it is ────────────────────────────────────────────────
            The answer, not the question. Twelve room chips is a paragraph of
            controls standing in for one word, on a page that is read far more
            often than it is edited — and eleven of them are wrong. So: the room
            it is in, and a Change beside it for the once in its life somebody
            moves the dryer. */}
        <Text style={styles.sectionLabel}>Where is it?</Text>
        {roomOpen ? (
          <View style={styles.chips}>
            {locations.map((location) => {
              const on = thing.room === location.name;
              return (
                <Pressable
                  key={location.id}
                  onPress={() => {
                    patch({ room: on ? null : location.name }, on ? 'Tag removed' : location.name);
                    setRoomOpen(false);
                  }}
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <View style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{location.name}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.roomRow}>
            <View style={styles.chip}>
              <Text style={styles.chipLabel}>{thing.room ?? 'Whole house'}</Text>
            </View>
            <Pressable
              onPress={() => setRoomOpen(true)}
              style={styles.change}
              accessibilityRole="button"
              accessibilityLabel="Change the room"
            >
              <Text style={styles.changeLabel}>Change</Text>
            </Pressable>
          </View>
        )}

        {/* ── what it takes ──────────────────────────────────────────── */}
        {KINDS_WITH_CONSUMABLES.includes(thing.kind) ? (
          <>
        <Text style={styles.sectionLabel}>What does it take?</Text>
        {thing.consumables.length > 0 ? (
          <View style={styles.partsList}>
            {thing.consumables.map((item, index) => (
              <View key={`${item}-${index}`} style={styles.partRow}>
                <Pressable
                  onPress={() => copy('Part', item)}
                  style={styles.partTap}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy ${item}`}
                >
                  <Text style={styles.partText}>{item}</Text>
                </Pressable>
                {/* The cart and the × are siblings of the copy tap, never
                    children of it — three intentions, three targets. */}
                <Pressable
                  onPress={() => addToShoppingList(item)}
                  disabled={busy}
                  style={styles.partRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item} to the shopping list`}
                >
                  <Icon name="cart-outline" size="sm" color={Colors.primary} />
                </Pressable>
                <Pressable
                  onPress={() =>
                    patch({ consumables: thing.consumables.filter((_, i) => i !== index) })
                  }
                  disabled={busy}
                  style={styles.partRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item}`}
                >
                  <Icon name="close" size="sm" color={Colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.partAddRow}>
          <TextInput
            style={styles.partInput}
            value={consumableDraft}
            onChangeText={setConsumableDraft}
            placeholder="A part number or a fitting…"
            placeholderTextColor={Colors.textMuted}
            maxLength={60}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={addConsumable}
            blurOnSubmit={false}
            accessibilityLabel="Something it takes"
          />
          <Pressable
            onPress={addConsumable}
            disabled={busy || !consumableDraft.trim()}
            style={[styles.partAdd, (busy || !consumableDraft.trim()) && styles.partAddOff]}
            accessibilityRole="button"
            accessibilityLabel="Add what it takes"
          >
            <Icon
              name="add"
              size="md"
              color={busy || !consumableDraft.trim() ? Colors.textMuted : Colors.white}
            />
          </Pressable>
        </View>
          </>
        ) : null}

        {/* ── servicing ──────────────────────────────────────────────────
            A rail of intervals answered a question nobody asked and then did
            nothing with the answer: `service_days` sat on the row and no job
            ever appeared. One button, and behind it the whole arrangement —
            how often, who does it, and the job itself on the list. */}
        {KINDS_WITH_SERVICING.includes(thing.kind) ? (
          <>
            <Text style={styles.sectionLabel}>Servicing</Text>
            {/* Read off the job on the list when there is one, so this line
                and the list cannot say two different things. */}
            {serviceJob?.repeatDays || thing.serviceDays ? (
              <Text style={styles.serviceNow}>
                Every {describeCycle((serviceJob?.repeatDays ?? thing.serviceDays)!)}
                {thing.spec.servicedBy ? ` · ${thing.spec.servicedBy}` : ''}
                {serviceJob
                  ? serviceJob.dueAt
                    ? ` · next due ${formatDayFirst(dayKey(serviceJob.dueAt))}`
                    : ' · on the list'
                  : ' · not on the list'}
              </Text>
            ) : null}
            <Pressable
              onPress={() => openService()}
              style={styles.addDetail}
              accessibilityRole="button"
              accessibilityLabel="Schedule service"
            >
              <Icon name="calendar-outline" size="sm" color={Colors.primary} />
              <Text style={styles.addDetailLabel}>
                {serviceJob || thing.serviceDays ? 'Change the service regime' : 'Schedule service'}
              </Text>
            </Pressable>
          </>
        ) : null}

        <Pressable
          onPress={() => setReporting(true)}
          style={styles.addDetail}
          accessibilityRole="button"
          accessibilityLabel="Report a problem"
        >
          <Icon name="add" size="sm" color={Colors.primary} />
          <Text style={styles.addDetailLabel}>Report a problem</Text>
        </Pressable>

        <Pressable
          onPress={() => setConfirmDelete(true)}
          style={styles.remove}
          accessibilityRole="button"
        >
          <Text style={styles.removeLabel}>Remove this item</Text>
        </Pressable>
      </ScrollView>


      <PhotoViewer
        visible={viewing !== null}
        photos={thing.photoPaths.map((path) => photoUrls[path]).filter(Boolean)}
        startIndex={viewing ?? 0}
        onClose={() => setViewing(null)}
      />

      {/* ── the servicing regime ──────────────────────────────────────
          A modal rather than a section, because it is four decisions that only
          make sense together: a cycle with nobody to call is half an answer,
          and a cycle with no first date never surfaces at all. */}
      <Modal
        visible={!!service}
        transparent
        animationType="slide"
        onRequestClose={() => setService(null)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setService(null)}
          accessibilityLabel="Close"
        />
        <View style={[styles.sheet, { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : edge.bottom) + Spacing.lg }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>How often is it serviced?</Text>
          <View style={styles.chips}>
            {SERVICE_CYCLES.map((days) => {
              const on = service?.days === days;
              return (
                <Pressable
                  key={days}
                  onPress={() =>
                    setService((d) =>
                      d ? { ...d, days, first: formatLooseDate(isoDate(addDays(new Date(), days))) } : d
                    )
                  }
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityLabel={`Every ${describeCycle(days)}`}
                  accessibilityState={{ selected: on }}
                >
                  <View style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                      Every {describeCycle(days)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.sheetField}>
            <DateField
              label={serviceJob ? 'Next one due' : 'First one due'}
              value={service?.first ?? ''}
              onChangeValue={(v) => setService((d) => (d ? { ...d, first: v } : d))}
              pickerTitle={serviceJob ? "When's the next one due?" : "When's the first one due?"}
            />
          </View>

          <View style={styles.sheetField}>
            <Text style={styles.fieldLabel}>Who services it</Text>
            <TextInput
              style={styles.input}
              value={service?.by ?? ''}
              onChangeText={(v) => setService((d) => (d ? { ...d, by: v } : d))}
              placeholderTextColor={Colors.textMuted}
              maxLength={120}
              accessibilityLabel="Who services it"
            />
          </View>

          {/* Said once, here, where somebody is setting up something that
              sounds like it might remind them. It will not. */}
          <Text style={styles.sectionHint}>
            {serviceJob
              ? 'This changes the service job already on the list. It comes up under Due soon — nothing is sent to anybody.'
              : 'It goes on the list as a job that comes round, and comes up under Due soon when it is near. Nothing is sent to anybody.'}
          </Text>

          <Pressable
            onPress={scheduleService}
            disabled={busy}
            style={[styles.cta, busy && styles.ctaOff]}
            accessibilityRole="button"
            accessibilityLabel={serviceJob ? 'Update the service job' : 'Put it on the list'}
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.ctaLabel}>
                {serviceJob ? 'Update the service job' : 'Put it on the list'}
              </Text>
            )}
          </Pressable>

          {thing.serviceDays || serviceJob ? (
            <Pressable
              onPress={stopService}
              style={styles.stop}
              accessibilityRole="button"
              accessibilityLabel="Stop servicing it"
            >
              <Text style={styles.stopLabel}>Stop servicing it</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>

      {/* ── report a problem ──
          The List tab's own capture bar, in a sheet: one gesture for filing a
          job wherever it is filed from. */}
      <Modal
        visible={reporting}
        transparent
        animationType="slide"
        onRequestClose={() => setReporting(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setReporting(false)}
          accessibilityLabel="Close"
        />
        <View style={[styles.sheet, { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : edge.bottom) + Spacing.lg }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>
            {`What's wrong with the ${thingHeadline(thing).toLowerCase()}?`}
          </Text>
          <ComposeBar
            pathPrefix={household?.id ?? null}
            onAdd={fileReport}
            words={{ placeholder: 'Describe it, or take a photo', sendLabel: 'Add to the list' }}
            embedded
          />
        </View>
      </Modal>

      <ConfirmDialog
        visible={confirmDelete}
        title="Remove this?"
        message="Anything on the list about it stays there — it just stops pointing at this."
        confirmLabel="Remove"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}

/**
 * One field: its name above, a box below, the full width of the card.
 *
 * It used to be a label on the left and a right-aligned value on the right,
 * which had two problems. The small one is that it overflowed: `flex: 1` on a
 * react-native-web `TextInput` is an `<input>` with an intrinsic width of about
 * twenty characters, and `min-width: auto` refuses to shrink below it, so the
 * row grew past the card and a right-aligned value spilled off the screen edge.
 * `minWidth: 0` stops that.
 *
 * The large one is that a two-column row has nowhere to put a long answer.
 * "Award Appliances" and `MSZ-AP50VGK` are exactly what somebody came to this
 * screen to read, and truncating them to fit a 200px box defeats the screen.
 * Stacked, nothing truncates and a blank box reads as a blank box — which is
 * what this page needed anyway once every field started showing.
 */
function Field({
  label, value, mono, multiline, onChange, onBlur, onCopy, savedValue, swatch,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
  /** Leaving the box is what writes it. */
  onBlur?: () => void;
  /** The stored value, for the copy button — never the half-typed draft. */
  savedValue?: string | null;
  onCopy?: (label: string, value: string) => void;
  /** A colour to draw beside the label; `false` when the box holds something that is not one. */
  swatch?: string | false;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {swatch ? (
          <View
            style={[styles.swatch, { backgroundColor: swatch }]}
            accessibilityLabel={`Swatch ${swatch}`}
          />
        ) : swatch === false ? (
          <Text style={styles.swatchMiss}>Six hex digits draw a swatch</Text>
        ) : null}
        {onCopy && savedValue ? (
          <Pressable
            onPress={() => onCopy(label, savedValue)}
            style={styles.copy}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${label}`}
          >
            <Icon name="copy-outline" size="sm" color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {/* No placeholder. Grey example text in a box on this page reads as a
          value somebody already entered — which on the one screen people open
          in a shop to read a serial number back is the worst thing it could
          read as. The label above says what the box wants. */}
      <TextInput
        style={[styles.input, mono && styles.inputMono, multiline && styles.inputMulti]}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        autoCorrect={!mono}
        autoCapitalize={mono ? 'characters' : 'sentences'}
        multiline={multiline}
        maxLength={multiline ? 1000 : 80}
        returnKeyType="done"
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  // A paint's own colour — data, like a photograph of the tin, not a hue the
  // app is spending. The hairline is because most paint is a white.
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  swatchMiss: { fontSize: Typography.xs, color: Colors.textMuted },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
    paddingLeft: Spacing.md,
    marginBottom: Spacing.md,
  },
  from: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  fromTitles: { flex: 1, minWidth: 0 },
  fromKey: {
    fontSize: Typography.xs,
    color: Colors.primary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fromName: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  fromClear: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  photoStrip: { marginBottom: Spacing.sm },
  photoWrap: { marginRight: Spacing.sm },
  photo: {
    width: 220,
    height: 165,
    borderRadius: Radius.card,
    backgroundColor: Colors.border,
  },
  photoRemove: {
    position: 'absolute',
    top: Spacing.xs,
    right: Spacing.xs,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(43, 39, 36, 0.62)',
  },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.lg,
  },
  docs: { gap: Spacing.xs },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
  },
  docOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.sm,
  },
  // The filename is the label — it is why the key keeps it — so it wraps rather
  // than truncating to a name every manual shares.
  docName: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textPrimary },
  docRemove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: { flexDirection: 'row', gap: Spacing.sm },
  rows: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  field: { gap: Spacing.xs, minWidth: 0 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  input: {
    // Without minWidth an <input> keeps its intrinsic twenty-character width on
    // web and pushes the row past the card. This is the whole overflow fix.
    minWidth: 0,
    width: '100%',
    fontSize: Typography.base,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.button,
  },
  inputMono: { fontFamily: Fonts.mono, fontSize: Typography.sm },
  inputMulti: { minHeight: 88, textAlignVertical: 'top', paddingTop: Spacing.sm },
  copy: { padding: Spacing.xs },
  addDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  addDetailLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  sectionLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginTop: Spacing.lg,
  },
  sectionHint: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  partsList: { gap: Spacing.xs },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingLeft: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  partTap: { flex: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  // No `flex: 1`: the tap target around it is a column, so a flexing Text
  // grows to fill it and the row comes out three times its height.
  partText: { fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textPrimary },
  // Prose, so the system font. `Fonts.mono` is for data only — see theme.ts.
  snagText: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  partRemove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partAddRow: { flexDirection: 'row', gap: Spacing.sm },
  partInput: {
    flex: 1,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  partAdd: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A disabled filled button goes neutral, never faded: fern at half strength
  // reads as broken rather than as not-ready, and white on pale sage fails
  // contrast on the way past.
  partAddOff: { backgroundColor: Colors.sunken },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  change: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  changeLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
  serviceNow: { fontSize: Typography.base, color: Colors.textPrimary },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  sheetTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  sheetField: { gap: Spacing.xs, minWidth: 0 },
  cta: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.white },
  stop: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  stopLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.danger },
  remove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginTop: Spacing.xl },
  removeLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.danger },
});

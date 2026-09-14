import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Image, TextInput, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import Button from '../components/Button';
import StickyActionBar from '../components/StickyActionBar';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  describeCycle, documentFileName, documentName, formatLooseDate, parseLooseDate,
  snagHeadline, thingHeadline,
} from '@snag/supabase-queries';
import {
  createSnag, deleteThing, getFileUrl, getFileUrls, getSnags, getThing,
  updateThing, uploadFile,
} from '../lib/supabase';
import { compressAndUpload, photoFileName, takePhoto } from '../lib/photoUpload';
import { failureReason } from '../lib/deadline';
import { showAlert } from '../lib/alert';
import { copyToClipboard } from '../lib/clipboard';
import {
  FINISH_SPEC_FIELDS, RootStackParamList, Snag, Thing, ThingKind, THING_KINDS,
  THING_KIND_FIELD_LABELS, THING_KIND_LABELS,
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

/** Service intervals a household actually uses. Nobody types "180 days". */
const SERVICE_CYCLES = [90, 180, 365, 730];

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

/** "3 unsaved changes" — a count, because which ones is on screen already. */
function unsavedHint(count: number): string {
  return count === 1 ? '1 unsaved change' : `${count} unsaved changes`;
}

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

  const [thing, setThing] = useState<Thing | null>(null);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [consumableDraft, setConsumableDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // The typed fields, held locally until Save. Taps are not in here — the kind
  // chips, the room, the parts list, photos and documents each write on press,
  // because a single decision is its own confirmation and putting twelve of
  // them behind one button is how sorting a room becomes forty taps.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await getThing(thingId);
      setThing(found);
      setDraft(draftFrom(found));
      setPhotoUrls(await getFileUrls(found.photoPaths));
      // Small by construction: the snags about one appliance, over its life.
      const all = await getSnags({ propertyId: found.propertyId }, 'newest');
      setSnags(all.filter((s) => s.thingId === found.id));
    } catch (err: any) {
      showAlert("Couldn't load that", err?.message ?? 'Please try again.');
    }
  }, [thingId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * A Save button can lose work in a way writing on blur never could, so the
   * back gesture has to ask. `showAlert` takes two buttons at most — on the web
   * build it is a `window.confirm`, which has exactly two.
   */
  useEffect(() => {
    const stop = navigation.addListener('beforeRemove', (e) => {
      if (!thing || !draft || changedFields(thing, draft).length === 0) return;
      e.preventDefault();
      showAlert(
        'Leave without saving?',
        'The changes you typed here have not been saved.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return stop;
  }, [navigation, thing, draft]);

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
  async function save() {
    if (!thing || !draft || saving) return;
    const changed = changedFields(thing, draft);
    if (changed.length === 0) return;

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
        return;
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

    setSaving(true);
    try {
      const next = await updateThing(thing.id, update);
      setThing(next);
      setDraft(draftFrom(next));
      showToast('Saved');
    } catch (err: any) {
      // The draft is left exactly as typed — the words are the only copy.
      showAlert("That didn't save", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Photos and documents write the moment they land, never via Save.
   *
   * The bytes are already in storage by then — deferring the row that points at
   * them is how you get an orphaned file nobody can reach, and a back-swipe
   * between the upload and the Save would do exactly that.
   */
  async function attachPhoto(from: 'camera' | 'library') {
    if (!thing || !household || busy) return;
    const uri = from === 'camera'
      ? await takePhoto()
      : await pickFromLibrary();
    if (!uri) return;
    setBusy(true);
    try {
      const { path, error } = await compressAndUpload(uri, photoFileName(household.id));
      if (error || !path) throw error ?? new Error('The photo did not upload');
      await patch({ photoPaths: [...thing.photoPaths, path] }, 'Photo added');
    } catch (err: unknown) {
      showAlert("That photo didn't save", failureReason(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickFromLibrary(): Promise<string | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      exif: false,
    });
    return result.canceled ? null : result.assets[0].uri;
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
    Linking.openURL(url).catch(() => {
      showAlert("Couldn't open that", 'Nothing on this device offered to open the file.');
    });
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
   * A snag about this thing, from here.
   *
   * The parts list is deliberately *not* filled in from the consumables:
   * filling it is what moves a snag to 'doing', and a job that starts itself
   * because somebody said which appliance it was about would empty the status
   * of meaning from the same end the Start button did. The detail sheet offers
   * them as taps instead.
   */
  async function addSnag() {
    if (!thing || busy) return;
    setBusy(true);
    try {
      const snag = await createSnag({
        propertyId: thing.propertyId,
        room: thing.room,
        description: `${thingHeadline(thing)} — `,
        thingId: thing.id,
      });
      navigation.navigate('SnagDetail', { snagId: snag.id });
    } catch (err: any) {
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!thing) return;
    setConfirmDelete(false);
    try {
      await deleteThing(thing.id);
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
  const changed = draft ? changedFields(thing, draft) : [];
  const dirty = changed.length > 0;

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={thingHeadline(thing)}
        subtitle={[thing.room, thing.propertyName].filter(Boolean).join(' · ')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {thing.photoPaths.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
            {thing.photoPaths.map((path) => (
              <View key={path} style={styles.photoWrap}>
                <Image source={{ uri: photoUrls[path] }} style={styles.photo} resizeMode="cover" />
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

        {/* A slim row, not a 165px tile. An empty tile is the biggest thing on
            a page nobody has filled in yet, which is how a record starts
            reading as homework — and the two offers are siblings rather than
            one nested inside the other, because a Pressable inside a Pressable
            is a coin toss about which one gets the tap. */}
        <View style={styles.attachRow}>
          <Pressable
            onPress={() => attachPhoto('camera')}
            disabled={busy}
            style={styles.addDetail}
            accessibilityRole="button"
            accessibilityLabel="Photograph the label"
          >
            <Icon name="camera-outline" size="sm" color={Colors.primary} />
            <Text style={styles.addDetailLabel}>
              {thing.photoPaths.length > 0 ? 'Another photo' : 'Photograph the label'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => attachPhoto('library')}
            disabled={busy}
            style={styles.addDetail}
            accessibilityRole="button"
            accessibilityLabel="Choose a photo"
          >
            <Text style={styles.addDetailAlt}>Choose one</Text>
          </Pressable>
        </View>

        {/* ── what it is ─────────────────────────────────────────────── */}
        <View style={styles.rail}>
          {THING_KINDS.map((kind) => (
            <Pressable
              key={kind}
              onPress={() => patch({ kind }, THING_KIND_LABELS[kind])}
              style={styles.chipTap}
              accessibilityRole="button"
              accessibilityState={{ selected: thing.kind === kind }}
            >
              <View style={[styles.chip, thing.kind === kind && styles.chipOn]}>
                <Text style={[styles.chipLabel, thing.kind === kind && styles.chipLabelOn]}>
                  {THING_KIND_LABELS[kind]}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.rows}>
          <Field
            label="Name"
            value={draft?.name ?? ''}
            placeholder="Heat pump · indoor"
            onChange={(v) => edit('name', v)}
          />
          <Field
            label={words.make}
            value={draft?.make ?? ''}
            placeholder={thing.kind === 'finish' ? 'Resene' : 'Mitsubishi Electric'}
            onChange={(v) => edit('make', v)}
          />
          <Field
            label={words.model}
            value={draft?.model ?? ''}
            placeholder={thing.kind === 'finish' ? '7BB 83/018' : 'MSZ-AP50VGK'}
            mono
            onCopy={copy}
            savedValue={thing.model}
            onChange={(v) => edit('model', v)}
          />
          {KINDS_WITH_SERIAL.includes(thing.kind) ? (
            <Field
              label="Serial"
              value={draft?.serial ?? ''}
              placeholder="7A204871"
              mono
              onCopy={copy}
              savedValue={thing.serial}
              onChange={(v) => edit('serial', v)}
            />
          ) : null}

          {specFields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              value={draft?.spec[field.key] ?? ''}
              placeholder={field.placeholder}
              mono={field.key === 'tint'}
              onCopy={field.key === 'tint' ? copy : undefined}
              savedValue={thing.spec[field.key] ?? null}
              onChange={(v) => editSpec(field.key, v)}
            />
          ))}

          {DATE_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              value={draft?.[field.key] ?? ''}
              placeholder="Nov 2019"
              onChange={(v) => edit(field.key, v)}
            />
          ))}

          <Field
            label={words.notes}
            value={draft?.notes ?? ''}
            placeholder={
              thing.kind === 'finish'
                ? 'Main wall · windows · ceiling'
                : 'Anything the next person should know'
            }
            multiline={thing.kind !== 'finish'}
            onChange={(v) => edit('notes', v)}
          />
        </View>
        {/* ── paperwork ──────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Paperwork</Text>
        <Text style={styles.sectionHint}>
          The manual, the receipt, the warranty. What you go looking for eight months later and
          cannot find in a drawer.
        </Text>

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

        {/* ── where it is ────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Where is it?</Text>
        <View style={styles.chips}>
          {locations.map((location) => {
            const on = thing.room === location.name;
            return (
              <Pressable
                key={location.id}
                onPress={() => patch({ room: on ? null : location.name }, on ? 'Tag removed' : location.name)}
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

        {/* ── what it takes ──────────────────────────────────────────── */}
        {KINDS_WITH_CONSUMABLES.includes(thing.kind) ? (
          <>
        <Text style={styles.sectionLabel}>What does it take?</Text>
        <Text style={styles.sectionHint}>
          The filter, the bulb, the cartridge — what you would buy again. This is what a job about
          it offers you in the shop.
        </Text>
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

        {/* ── does it need doing regularly ───────────────────────────── */}
        {KINDS_WITH_SERVICING.includes(thing.kind) ? (
          <>
        <Text style={styles.sectionLabel}>Does it need servicing?</Text>
        <View style={styles.chips}>
          <Pressable
            onPress={() => thing.serviceDays && patch({ serviceDays: null }, 'No cycle')}
            style={styles.chipTap}
            accessibilityRole="button"
            accessibilityState={{ selected: !thing.serviceDays }}
          >
            <View style={[styles.chip, !thing.serviceDays && styles.chipOn]}>
              <Text style={[styles.chipLabel, !thing.serviceDays && styles.chipLabelOn]}>No</Text>
            </View>
          </Pressable>
          {SERVICE_CYCLES.map((days) => {
            const on = thing.serviceDays === days;
            return (
              <Pressable
                key={days}
                onPress={() => patch({ serviceDays: days }, `Every ${describeCycle(days)}`)}
                style={styles.chipTap}
                accessibilityRole="button"
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
        {thing.serviceDays ? (
          <Text style={styles.sectionHint}>
            Noted, not scheduled — this app sends nothing. Add it to the list as a job that comes
            round, and the list will roll it forward each time it is done.
          </Text>
        ) : null}
          </>
        ) : null}

        {/* ── what has been wrong with it ────────────────────────────── */}
        <Text style={styles.sectionLabel}>
          On the list{snags.length > 0 ? ` · ${snags.length}` : ''}
        </Text>
        {snags.length > 0 ? (
          <View style={styles.partsList}>
            {snags.map((snag) => (
              <Pressable
                key={snag.id}
                onPress={() => navigation.navigate('SnagDetail', { snagId: snag.id })}
                style={styles.snagRow}
                accessibilityRole="button"
              >
                <Icon
                  name={snag.status === 'done' ? 'checkmark-circle' : 'ellipse-outline'}
                  size="sm"
                  color={snag.status === 'done' ? Colors.textMuted : Colors.status.open}
                />
                <Text
                  style={[styles.snagText, snag.status === 'done' && styles.snagDone]}
                  numberOfLines={1}
                >
                  {snagHeadline(snag)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.sectionHint}>Nothing has needed doing to it yet.</Text>
        )}
        <Pressable onPress={addSnag} style={styles.addDetail} accessibilityRole="button">
          <Icon name="add" size="sm" color={Colors.primary} />
          <Text style={styles.addDetailLabel}>Add something about this</Text>
        </Pressable>

        <Pressable
          onPress={() => setConfirmDelete(true)}
          style={styles.remove}
          accessibilityRole="button"
        >
          <Text style={styles.removeLabel}>Remove from the record</Text>
        </Pressable>
      </ScrollView>

      {/* The bar is the last flex child rather than absolutely positioned, so
          it can never overlap the content it belongs to. `stacked` is false:
          nothing sits below it here, so it owns the home indicator. The
          keyboard inset is applied by the screen because StickyActionBar's own
          handling is `Keyboard`-based and iOS-only, and `Keyboard` is an empty
          stub in react-native-web — which is the build people install. */}
      <View style={{ marginBottom: keyboard }}>
        <StickyActionBar hint={dirty ? unsavedHint(changed.length) : 'All changes saved'}>
          <Button
            label={dirty ? 'Save' : 'Saved'}
            onPress={save}
            loading={saving}
            disabled={!dirty}
            fullWidth
          />
        </StickyActionBar>
      </View>

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
  label, value, placeholder, mono, multiline, onChange, onCopy, savedValue,
}: {
  label: string;
  value: string;
  placeholder: string;
  mono?: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
  /** The stored value, for the copy button — never the half-typed draft. */
  savedValue?: string | null;
  onCopy?: (label: string, value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text style={styles.fieldLabel}>{label}</Text>
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
      <TextInput
        style={[styles.input, mono && styles.inputMono, multiline && styles.inputMulti]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
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
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  addDetailAlt: { fontSize: Typography.sm, color: Colors.textMuted },
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
  snagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  snagDone: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  remove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginTop: Spacing.xl },
  removeLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.danger },
});

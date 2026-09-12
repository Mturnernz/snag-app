import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Image, TextInput, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  describeCycle, formatLooseDate, parseLooseDate, snagHeadline, thingHeadline,
} from '@snag/supabase-queries';
import {
  createSnag, deleteThing, getSnagPhotoUrls, getSnags, getThing, updateThing,
} from '../lib/supabase';
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
 * **A sheet, not a form.** Every row writes the moment it loses focus, because
 * the read moment this whole tab exists for is eight months away and the write
 * moment is thirty seconds long — somebody with a rating plate in front of them
 * and a repairer waiting. A Save button turns filling in a heat pump into a
 * commitment, and a commitment is what does not get made.
 *
 * Three things follow:
 *
 * - **Empty fields do not render as blank rows.** A sheet of waiting blanks is
 *   a form wearing a different hat, and it is exactly what makes an inventory
 *   read as 8% complete rather than as "here is what we know". What is known is
 *   shown; the rest is behind one *Add a detail* row.
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
const KINDS_WITH_CONSUMABLES: ThingKind[] = ['appliance', 'fitting'];
const KINDS_WITH_SERVICING: ThingKind[] = ['appliance', 'fabric'];
/** A tin of paint has no serial number, and offering the row invents one. */
const KINDS_WITH_SERIAL: ThingKind[] = ['appliance', 'fitting', 'fabric'];

export default function ThingDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { thingId } = useRoute<Route>().params;
  const { locations } = useHousehold();
  const { showToast } = useToast();
  const keyboard = useKeyboardInset();

  const [thing, setThing] = useState<Thing | null>(null);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [consumableDraft, setConsumableDraft] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await getThing(thingId);
      setThing(found);
      setPhotoUrls(await getSnagPhotoUrls(found.photoPaths));
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

  async function patch(update: Parameters<typeof updateThing>[1], toast?: string) {
    if (!thing || busy) return;
    setBusy(true);
    try {
      setThing(await updateThing(thing.id, update));
      if (toast) showToast(toast);
    } catch (err: any) {
      showAlert("That didn't save", err?.message ?? 'Please try again.');
      await load();
    } finally {
      setBusy(false);
    }
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
  // What is known is shown. Everything else is one row away rather than a
  // column of blanks implying the record is unfinished.
  const known = (value: unknown) => value !== null && value !== undefined && value !== '';
  const reveal = showAll;

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={thingHeadline(thing)}
        subtitle={[thing.room, thing.propertyName].filter(Boolean).join(' · ')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        style={{ marginBottom: keyboard }}
        keyboardShouldPersistTaps="handled"
      >
        {thing.photoPaths.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
            {thing.photoPaths.map((path) => (
              <Image
                key={path}
                source={{ uri: photoUrls[path] }}
                style={styles.photo}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
        ) : null}

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
            value={thing.name}
            placeholder="Heat pump · indoor"
            show={known(thing.name) || reveal}
            onSave={(v) => patch({ name: v })}
          />
          <Field
            label={words.make}
            value={thing.make}
            placeholder={thing.kind === 'finish' ? 'Resene' : 'Mitsubishi Electric'}
            show={known(thing.make) || reveal}
            onSave={(v) => patch({ make: v })}
          />
          <Field
            label={words.model}
            value={thing.model}
            placeholder={thing.kind === 'finish' ? '7BB 83/018' : 'MSZ-AP50VGK'}
            mono
            onCopy={copy}
            show={known(thing.model) || reveal}
            onSave={(v) => patch({ model: v })}
          />
          <Field
            label="Serial"
            value={thing.serial}
            placeholder="7A204871"
            mono
            onCopy={copy}
            // Shown anyway if one is somehow already recorded — hiding a value
            // is how it becomes unreachable.
            show={known(thing.serial) || (reveal && KINDS_WITH_SERIAL.includes(thing.kind))}
            onSave={(v) => patch({ serial: v })}
          />

          {specFields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              value={thing.spec[field.key] ?? null}
              placeholder={field.placeholder}
              mono={field.key === 'tint'}
              onCopy={field.key === 'tint' ? copy : undefined}
              show={known(thing.spec[field.key]) || reveal}
              onSave={(v) =>
                v === null
                  ? patch({ clearSpec: [field.key] })
                  : patch({ spec: { [field.key]: v } })
              }
            />
          ))}

          {DATE_FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              value={thing[field.key]}
              display={formatLooseDate}
              placeholder="Nov 2019"
              show={known(thing[field.key]) || reveal}
              onSave={(v) => {
                if (v === null) {
                  patch({ [field.key]: null } as Parameters<typeof updateThing>[1]);
                  return false;
                }
                const parsed = parseLooseDate(v);
                if (parsed === undefined) {
                  // The column is a real date, so an unparsed answer would come
                  // back as a Postgres 22008 to somebody who answered correctly.
                  showAlert(
                    "Couldn't read that date",
                    'Try a year, a month and a year, or a full date — "2019", "Nov 2019", "8 Nov 2019".'
                  );
                  return false;
                }
                patch({ [field.key]: parsed } as Parameters<typeof updateThing>[1]);
                return true;
              }}
            />
          ))}

          <Field
            label="Notes"
            value={thing.notes}
            placeholder="Anything the next person should know"
            multiline
            show={known(thing.notes) || reveal}
            onSave={(v) => patch({ notes: v })}
          />
        </View>

        {!reveal ? (
          <Pressable
            onPress={() => setShowAll(true)}
            style={styles.addDetail}
            accessibilityRole="button"
          >
            <Icon name="add" size="sm" color={Colors.primary} />
            <Text style={styles.addDetailLabel}>Add a detail</Text>
          </Pressable>
        ) : null}

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
 * One label/value row, written on blur.
 *
 * `show` is what keeps this a sheet rather than a form: a row nobody has filled
 * in is not rendered at all until someone asks for it. An empty string saves as
 * null, so clearing a field is the same gesture as never having filled it.
 */
function Field({
  label, value, placeholder, show, mono, multiline, display, onSave, onCopy,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  show: boolean;
  mono?: boolean;
  multiline?: boolean;
  /** How the stored value reads when nobody is editing it. */
  display?: (value: string | null) => string;
  /**
   * Return false to keep what was typed — a value the field could not accept.
   * Anything else (including the promise `patch` returns) is taken as accepted.
   */
  onSave: (value: string | null) => unknown;
  onCopy?: (label: string, value: string) => void;
}) {
  const shown = display ? display(value) : value ?? '';
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);

  // The row is the source of truth while it has focus; the server is, the rest
  // of the time. Without this a save that trims or reformats never shows — and
  // a date typed as "nov 2019" would keep reading that way rather than "Nov
  // 2019", which is the app agreeing with itself about what it stored.
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);

  if (!show) return null;

  function commit() {
    const next = draft.trim();
    if (next === shown) {
      setEditing(false);
      return;
    }
    const accepted = onSave(next === '' ? null : next);
    // Staying in "editing" keeps the rejected words in front of the person who
    // typed them, next to the message saying why.
    if (accepted === false) return;
    setEditing(false);
  }

  return (
    <View style={[styles.row, multiline && styles.rowTall]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>
        <TextInput
          style={[styles.input, mono && styles.inputMono, multiline && styles.inputMulti]}
          value={draft}
          onChangeText={setDraft}
          onFocus={() => setEditing(true)}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          autoCorrect={!mono}
          autoCapitalize={mono ? 'characters' : 'sentences'}
          multiline={multiline}
          maxLength={multiline ? 1000 : 80}
          returnKeyType="done"
          accessibilityLabel={label}
        />
        {onCopy && value ? (
          <Pressable
            onPress={() => onCopy(label, value)}
            style={styles.copy}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${label}`}
          >
            <Icon name="copy-outline" size="sm" color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
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
  photo: {
    width: 220,
    height: 165,
    borderRadius: Radius.card,
    marginRight: Spacing.sm,
    backgroundColor: Colors.border,
  },
  rail: { flexDirection: 'row', gap: Spacing.sm },
  rows: { backgroundColor: Colors.surface, borderRadius: Radius.card, borderWidth: 1, borderColor: Colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    width: 104,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  // A Notes value runs to several lines, and its label belongs beside the
  // first of them rather than floating in the middle of the block.
  rowTall: { alignItems: 'flex-start', paddingVertical: Spacing.sm },
  rowValue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  input: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    paddingVertical: Spacing.sm,
    textAlign: 'right',
  },
  inputMono: { fontFamily: Fonts.mono, fontSize: Typography.sm },
  inputMulti: { textAlign: 'left', minHeight: 72, textAlignVertical: 'top' },
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

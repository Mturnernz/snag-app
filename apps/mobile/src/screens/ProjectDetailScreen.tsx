import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import ScreenHeader from '../components/ScreenHeader';
import Attachments from '../components/Attachments';
import ItemSheet from '../components/ItemSheet';
import ConfirmDialog from '../components/ConfirmDialog';
import AddThingSheet from '../components/AddThingSheet';
import ExportFooter from '../components/ExportFooter';
import ProjectRoomsSheet from '../components/ProjectRoomsSheet';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import StatusBadge from '../components/StatusBadge';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { showAlert } from '../lib/alert';
import {
  addPayment, createElement, createItem, createLocation, createQuote, createThing, deleteElement,
  deleteItem, deletePayment, deleteProject, deleteQuote,
  deleteStoredFiles, describeBudget, describePartsBudget, describeTotals, formatMoney, getProject,
  getProjectContents, getProjectFiles, getProjectThings, getSupplierTotals,
  getSnags, outstanding, setQuoteStatus, showsElements, updateElement, updateItem, updateProject,
  updateQuote,
} from '../lib/supabase';
import {
  documentName, exportDateStamp, formatLooseDate, inclGst, itemPriceLabel, projectDossierTable,
  projectExportPhotos, type ThingInput,
} from '@snag/supabase-queries';
import { getFileUrls } from '../lib/supabase';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import {
  Project, ProjectElement, ProjectFile, ProjectItem, ProjectPayment, ProjectQuote,
  ProjectQuoteLine, ProjectQuoteStatus, ProjectStatus, ProjectSupplierTotals,
  PROJECT_FILE_LEVEL_LABELS, PROJECT_QUOTE_STATUS_LABELS, PROJECT_STATUS_LABELS,
  RootStackParamList, Snag, Thing,
} from '../types';

/**
 * How much of the handover list is shown before it asks.
 *
 * Five is the same sitting's-worth the You tab's loose ends are capped at. A
 * renovation with forty items would otherwise put a forty-row checklist between
 * the money and the paperwork on every visit.
 */
const HANDOVER_PREVIEW = 5;

type Props = NativeStackScreenProps<RootStackParamList, 'ProjectDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * One project: the money, the parts of it, the jobs hanging off it, the folder.
 *
 * **A push, not a sheet.** `SnagDetail` and `ThingDetail` are modals because
 * triage is a dozen small decisions taken against a list still visible
 * underneath. A project is a page you *read* — three figures, a set of parts
 * that open, and a folder — and it is deep enough that a sheet would spend its
 * height covering the tab it came from.
 *
 * **The money is the top of the page, and it is three figures rather than one.**
 * *Quoted* is what suppliers have said including options not taken; *Chosen* is
 * the sum of what has been picked, which answers "what is this going to cost";
 * *Spent* is invoices and receipts, which answers "how far in are we". A single
 * "total" answers none of them.
 *
 * **And the denominator is not optional.** `describeTotals` writes the line
 * under the figures, and there is no path through this screen that renders a
 * total without it. A renovation total assembled from half the items is the one
 * genuinely dangerous number in this app.
 *
 * **The middle layer only appears when it has earned its place.** A project
 * whose single element is `implicit` shows its items directly under *What it
 * takes* and never says the word "part". Adding a second part is what makes the
 * layer real — and the server does the un-hiding, so two clients cannot disagree
 * about whether it is visible.
 *
 * **Files belong to one level and roll up, never down.** Every level has its own
 * Attachments, and the folder at the foot gathers all of them with a line saying
 * where each lives — so the council consent is on the project, the tiling quote
 * is on the quote, and opening the bathroom does not show the consent.
 */
export default function ProjectDetailScreen({ route }: Props) {
  const { projectId } = route.params;
  const navigation = useNavigation<Nav>();
  const { household, locations, reloadLocations } = useHousehold();
  const { showToast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [elements, setElements] = useState<ProjectElement[]>([]);
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [quotes, setQuotes] = useState<ProjectQuote[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [loading, setLoading] = useState(true);

  const [openElement, setOpenElement] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<Record<string, string>>({});
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [removingElement, setRemovingElement] = useState<ProjectElement | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [thingFor, setThingFor] = useState<ProjectItem | null>(null);
  const [lines, setLines] = useState<ProjectQuoteLine[]>([]);
  const [payments, setPayments] = useState<ProjectPayment[]>([]);
  const [suppliers, setSuppliers] = useState<ProjectSupplierTotals[]>([]);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [recorded, setRecorded] = useState<Thing[]>([]);
  const [busy, setBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [loaded, contents, loadedFiles] = await Promise.all([
        getProject(projectId),
        getProjectContents(projectId),
        getProjectFiles(projectId),
      ]);
      setProject(loaded);
      setElements(contents.elements);
      setItems(contents.items);
      setQuotes(contents.quotes);
      setLines(contents.lines);
      setPayments(contents.payments);
      setFiles(loadedFiles);
      // Who is owed what. **Not fatal**: the money strip above it is the answer
      // to this page's main question, and a rollup that will not load must not
      // take the page down — the same rule the thing page's history card
      // follows.
      try {
        setSuppliers(await getSupplierTotals(projectId));
      } catch {
        setSuppliers([]);
      }
      // Same rule: the handover list is an offer, not the page.
      try {
        setRecorded(await getProjectThings(projectId));
      } catch {
        setRecorded([]);
      }
      // The punch list is an ordinary read of the ordinary list. A failure here
      // must not take the page down — the same rule the thing-history card
      // follows on the snag page.
      try {
        setSnags(await getSnags({ projectId }));
      } catch {
        setSnags([]);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't load that project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const drawElements = useMemo(() => showsElements(elements), [elements]);
  /**
   * Memoised, and that is not a style preference.
   *
   * `AddThingSheet` resets itself from this prop in an effect that depends on
   * the object, so a fresh literal per render is an infinite loop — the effect
   * sets state, the render makes a new object, the effect fires again. It
   * **hangs** the screen rather than failing, which is the only way this shape
   * of bug ever announces itself. `SnagDetailScreen` caught it as a test
   * timeout. It also has to live above the early return below: a hook after a
   * conditional return is a hook that sometimes doesn't run.
   */
  const thingStart = useMemo(
    () => (thingFor ? { name: thingFor.name, room: elementRoom(elements, thingFor) } : null),
    [thingFor?.id, elements]
  );
  const itemsByElement = useMemo(() => {
    const map: Record<string, ProjectItem[]> = {};
    for (const item of items) (map[item.elementId] ??= []).push(item);
    return map;
  }, [items]);
  const quotesByItem = useMemo(() => {
    const map: Record<string, ProjectQuote[]> = {};
    for (const quote of quotes) {
      if (quote.itemId) (map[quote.itemId] ??= []).push(quote);
    }
    return map;
  }, [quotes]);
  /** Prices that cover a whole part, or the whole job — the contracts. */
  const contracts = useMemo(
    () => quotes.filter((quote) => quote.elementId !== null || quote.projectId !== null),
    [quotes]
  );
  const linesByQuote = useMemo(() => {
    const map: Record<string, ProjectQuoteLine[]> = {};
    for (const line of lines) (map[line.quoteId] ??= []).push(line);
    return map;
  }, [lines]);
  const paymentsByQuote = useMemo(() => {
    const map: Record<string, ProjectPayment[]> = {};
    for (const payment of payments) (map[payment.quoteId] ??= []).push(payment);
    return map;
  }, [payments]);
  /**
   * What this renovation has not handed over yet.
   *
   * Keyed on `projectItemId` rather than on a count, so a record made from an
   * item stops being offered — which is the whole reason that column exists.
   */
  const handedOver = useMemo(
    () => new Set(recorded.map((thing) => thing.projectItemId).filter(Boolean) as string[]),
    [recorded]
  );
  /**
   * What is installed, so it can be recorded — not every item on the job.
   *
   * Two reasons it is the installed ones. A renovation's items are already
   * listed above under *What it takes*, and offering all eighteen again would
   * put the same list on the page twice. And an item nobody has fitted yet has
   * nothing to record: the model number is on the box, not in the house.
   *
   * It is also the subtraction the You tab's loose ends already make —
   * `installed_count - thing_count` — so the two screens cannot disagree about
   * what is outstanding.
   */
  const installed = useMemo(
    () => items.filter((item) => item.status === 'installed'),
    [items]
  );
  const handedOverCount = useMemo(
    () => installed.filter((item) => handedOver.has(item.id)).length,
    [installed, handedOver]
  );

  async function patchProject(update: Parameters<typeof updateProject>[1], toast: string) {
    if (!project) return;
    try {
      setProject(await updateProject(project.id, update));
      showToast(toast);
      // The file list is a roll-up, so a project-level attachment changes it.
      setFiles(await getProjectFiles(projectId));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "That didn’t save");
    }
  }

  async function addItem(elementId: string) {
    const name = (itemDraft[elementId] ?? '').trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await createItem(elementId, name);
      setItemDraft((draft) => ({ ...draft, [elementId]: '' }));
      await load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't add that");
    } finally {
      setBusy(false);
    }
  }

  async function addElement(name: string, room: string | null) {
    if (busy) return;
    setBusy(true);
    try {
      await createElement(projectId, name, room);
      await load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't add that");
    } finally {
      setBusy(false);
    }
  }

  /**
   * A room added here is a room everywhere, through the same pair every other
   * screen uses. Rooms are a property's vocabulary, not one sheet's.
   */
  async function addRoomTag(name: string): Promise<boolean> {
    if (!project) return false;
    try {
      await createLocation(project.propertyId, name);
      await reloadLocations();
      return true;
    } catch (err: unknown) {
      showAlert("Couldn't add that room", err instanceof Error ? err.message : 'Please try again.');
      return false;
    }
  }

  async function removeElement(element: ProjectElement) {
    setRemovingElement(null);
    try {
      // The keys come back for the client to clear, because
      // storage.protect_delete() refuses a direct delete of a storage row.
      const paths = await deleteElement(element.id);
      await deleteStoredFiles(paths);
      showToast('Removed');
      await load();
    } catch (err: unknown) {
      // The server refuses the last one in words — a project with no parts is a
      // project nothing can be added to.
      showAlert("Couldn't remove that", err instanceof Error ? err.message : 'Please try again.');
    }
  }

  async function removeProject() {
    if (!project) return;
    setConfirmDelete(false);
    try {
      // The keys come back from the RPC and are cleared here, because
      // `storage.protect_delete()` refuses a direct delete of a storage row.
      // Safe in this order: membership of the property survives the delete, so
      // `can_use_photo_folder` still says yes.
      const paths = await deleteProject(project.id);
      await deleteStoredFiles(paths);
      showToast('Deleted');
      navigation.goBack();
    } catch (err: unknown) {
      showAlert("Couldn't delete that", err instanceof Error ? err.message : 'Try again in a moment.');
    }
  }

  /**
   * The dossier — a row per item, the paperwork named, the totals with their
   * denominator.
   *
   * This is the artefact the whole feature is for: the file you hand a valuer,
   * an insurer or a buyer. Photographs ride in the PDF only, because a
   * spreadsheet cell cannot hold one and a before-and-after is most of what the
   * reader wants.
   */
  async function handleExport(_scope: ExportScope, format: ExportFormat) {
    if (!project) return;
    setExporting(true);
    try {
      const table = projectDossierTable(project, elements, items, quotes, {
        household: household.name,
        stamp: exportDateStamp(),
      });
      const images = format === 'pdf'
        ? await loadExportImages(projectExportPhotos(project, items, elements), getFileUrls)
        : [];
      const { fileName, path } = await writeExport(table, format, images);
      setShowExport(false);
      showToast(path ? `Saved to ${fileName}` : `${fileName} downloaded`);
    } catch (err: unknown) {
      showAlert("Couldn't make that file", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function recordAsThing(input: Omit<ThingInput, 'propertyId'>) {
    if (!project) return;
    try {
      await createThing({
        ...input,
        propertyId: project.propertyId,
        projectId: project.id,
        // Which item it came out of, carried at creation rather than written
        // afterwards — and the reason the handover list can stop offering it.
        projectItemId: thingFor?.id ?? null,
      });
      setThingFor(null);
      showToast('Added to the house record');
      await load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't save that");
    }
  }

  if (loading || !project) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const committed = formatMoney(project.committedTotal);
  const invoiced = formatMoney(project.invoicedTotal);
  const paid = formatMoney(project.paidTotal);
  const owing = formatMoney(outstanding(project));
  const denominator = describeTotals(project);
  const budget = formatMoney(inclGst(project.budget, project.budgetInclGst));
  const budgetLine = describeBudget(project);
  const partsLine = describePartsBudget(project);
  // Clay is the one hue on a household list that has earned red, and it is a
  // fact about a number rather than a judgement: this is over what you said you
  // would spend.
  const overBudget =
    project.budget !== null &&
    project.committedTotal !== null &&
    project.committedTotal > (inclGst(project.budget, project.budgetInclGst) ?? 0) + 0.005;
  const activeItem = items.find((item) => item.id === openItem) ?? null;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={project.name}
        subtitle={[
          project.startedOn ? `started ${formatLooseDate(project.startedOn)}` : null,
          project.status === 'done' && project.finishedOn
            ? `finished ${formatLooseDate(project.finishedOn)}`
            : project.targetOn
              ? `aiming for ${formatLooseDate(project.targetOn)}`
              : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* ── where it's up to ───────────────────────────────────────────
            Writes on press, like every other single decision in this app:
            three chips, and the one that is lit is the answer. */}
        <View style={styles.chips}>
          {(['planned', 'underway', 'done'] as ProjectStatus[]).map((option) => {
            const on = project.status === option;
            return (
              <Pressable
                key={option}
                onPress={() => patchProject({ status: option }, PROJECT_STATUS_LABELS[option])}
                style={styles.chipTap}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={PROJECT_STATUS_LABELS[option]}
              >
                <View style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                    {PROJECT_STATUS_LABELS[option]}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ── the money ──────────────────────────────────────────────────
            Three figures, never one, and never without the line beneath.

            Stacked rather than three columns across, and that is a fix rather
            than a preference: a third of 390pt cannot hold
            "$188,352.22–191,583.72", so the range wrapped mid-number and the
            strip went ragged the moment a job got past five figures. It is the
            same argument the thing page's spec sheet already made when it
            un-columned itself — a two-column row has nowhere to put a long
            answer, and a renovation's totals are the longest answers here.

            The label holds a fixed column so the three figures line up on their
            right edge, which is how a column of money is read. */}
        <View style={styles.strip}>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Committed</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{committed ?? '—'}</Text>
          </View>
          {/* Charged and paid are different figures, and seven invoices with no
              payment recorded against them is the ordinary middle of a job. */}
          <View style={styles.row}>
            <Text style={styles.rowKey}>Invoiced</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{invoiced ?? '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowKey}>Paid</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{paid ?? '—'}</Text>
          </View>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.rowKey}>Outstanding</Text>
            <Text
              style={[styles.rowValue, owing ? styles.rowValueOwing : null]}
              numberOfLines={1}
            >
              {owing ?? '—'}
            </Text>
          </View>
          {budget ? (
            <>
              <View style={styles.stripRule} />
              <View style={styles.row}>
                <Text style={styles.rowKey}>Budget</Text>
                <Text style={styles.rowValue} numberOfLines={1}>{budget}</Text>
              </View>
              {budgetLine ? (
                <Text style={[styles.budgetLine, overBudget && styles.budgetLineOver]}>
                  {budgetLine}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
        {denominator ? (
          <Text style={styles.denominator}>{denominator}</Text>
        ) : (
          <Text style={styles.denominator}>Nothing priced yet</Text>
        )}
        {partsLine ? <Text style={styles.denominator}>{partsLine}</Text> : null}
        <Text style={styles.gstNote}>Every figure here is GST-inclusive.</Text>

        {/* ── who's owed what ────────────────────────────────────────────
            Absent entirely when nobody is owed anything, the same rule as the
            shopping pill at zero and *Fit* in the photo viewer: a section that
            can only say "nothing" is a control dressed as a choice.

            The check worth keeping, pinned in `projects.test.ts`: these rows
            sum to Committed above. They are two views over one rule. */}
        {suppliers.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>Who&rsquo;s owed what</Text>
              <View style={styles.rule} />
            </View>
            {suppliers
              .slice()
              .sort((a, b) => (b.committed ?? 0) - (a.committed ?? 0))
              .map((supplier) => {
                const still = outstanding({
                  committedTotal: supplier.committed,
                  paidTotal: supplier.paid,
                });
                const settled = supplier.committed !== null && (still ?? 0) < 0.005;
                return (
                  <View key={supplier.supplierKey} style={styles.supplier}>
                    <View style={styles.supplierTitles}>
                      <Text style={styles.supplierName}>
                        {supplier.supplier ?? 'Nobody named'}
                      </Text>
                      <Text style={styles.supplierUnder}>
                        {[
                          supplier.committed !== null
                            ? `committed ${formatMoney(supplier.committed)}`
                            : null,
                          supplier.invoiced !== null
                            ? `invoiced ${formatMoney(supplier.invoiced)}`
                            : null,
                          supplier.paid !== null ? `paid ${formatMoney(supplier.paid)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    {settled ? (
                      <View style={styles.settledPill}>
                        <Text style={styles.settledLabel}>Settled</Text>
                      </View>
                    ) : (
                      <View style={styles.supplierMoney}>
                        <Text style={styles.supplierKey}>OUTSTANDING</Text>
                        <Text style={styles.supplierOwing} numberOfLines={1}>
                          {formatMoney(still) ?? '—'}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
          </>
        ) : null}

        {/* ── what it takes ──────────────────────────────────────────────
            One element and it is implicit: the items hang straight off the
            project and the word "part" is never said. Two and the layer is
            real, because somebody made it real. */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>{drawElements ? 'Parts of the job' : 'What it takes'}</Text>
          <View style={styles.rule} />
          {/* Opens the room picker rather than a naming box. Adding the
              bathroom used to mean typing "Bathroom" and hoping it matched the
              tag the rest of the app files things under — a picker is the only
              control that cannot misspell the vocabulary. */}
          <Pressable
            onPress={() => setRoomsOpen(true)}
            style={styles.plusTap}
            accessibilityRole="button"
            accessibilityLabel="Add a room to this job"
          >
            <Icon name="add" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        {elements.map((element) => {
          const elementItems = itemsByElement[element.id] ?? [];
          const open = !drawElements || openElement === element.id;

          return (
            <View key={element.id} style={[styles.element, drawElements && styles.elementCard]}>
              <View style={styles.elementTop}>
              {drawElements ? (
                <Pressable
                  onPress={() => setOpenElement(open ? null : element.id)}
                  style={styles.elementHead}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={element.name}
                >
                  <View style={styles.elementTitles}>
                    <Text style={styles.elementName}>{element.name}</Text>
                    <Text style={styles.elementSub}>
                      {[
                        element.room,
                        element.itemCount === 1 ? '1 item' : `${element.itemCount} items`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Icon name={open ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
                </Pressable>
              ) : null}
              {/* A sibling of the heading, never inside it — a Pressable in a
                  Pressable is a coin toss about which one gets the tap. Muted,
                  because removing a part of the job is the rarest thing on this
                  page and it takes what the part holds with it. */}
              {drawElements ? (
                <Pressable
                  onPress={() => setRemovingElement(element)}
                  style={styles.elementRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${element.name} from this job`}
                >
                  <Icon name="close" size="sm" color={Colors.textMuted} />
                </Pressable>
              ) : null}
              </View>

              {open ? (
                <View style={styles.items}>
                  {elementItems.map((item) => {
                    const price = itemPriceLabel(item);
                    const itemQuotes = quotesByItem[item.id] ?? [];
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setOpenItem(item.id)}
                        style={styles.item}
                        accessibilityRole="button"
                        accessibilityLabel={item.name}
                      >
                        {/* The tick is *decided*, not *done* — the same
                            distinction the shopping list draws between buying
                            a part and doing the job. */}
                        <View style={[styles.tick, item.committed !== null && styles.tickOn]}>
                          {item.committed !== null ? (
                            <Icon name="checkmark" size="sm" color={Colors.white} />
                          ) : null}
                        </View>
                        <View style={styles.itemTitles}>
                          <Text style={styles.itemName}>{item.name}</Text>
                          <Text style={styles.itemSub} numberOfLines={1}>
                            {itemQuotes.length === 0
                              ? 'Nobody asked yet'
                              : item.committed !== null
                                ? [
                                    itemQuotes.find(
                                      (q) => q.kind === 'quote' && q.status === 'accepted'
                                    )?.supplier ??
                                      itemQuotes.find((q) => q.kind === 'invoice')?.supplier,
                                    // Paid, billed, or merely agreed — three
                                    // different answers to "where is this up to".
                                    item.paid !== null
                                      ? 'paid'
                                      : item.invoiced !== null
                                        ? 'invoiced'
                                        : 'accepted',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')
                                : `${itemQuotes.length} ${itemQuotes.length === 1 ? 'price' : 'prices'} · nothing decided`}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.itemPrice,
                            price.state === 'undecided' && styles.itemPriceRange,
                            price.state === 'none' && styles.itemPriceNone,
                          ]}
                          numberOfLines={1}
                        >
                          {price.text}
                        </Text>
                      </Pressable>
                    );
                  })}

                  <View style={styles.addRow}>
                    <TextInput
                      style={styles.addInput}
                      value={itemDraft[element.id] ?? ''}
                      onChangeText={(text) =>
                        setItemDraft((draft) => ({ ...draft, [element.id]: text }))
                      }
                      placeholder="Add an item"
                      placeholderTextColor={Colors.textMuted}
                      onSubmitEditing={() => addItem(element.id)}
                      returnKeyType="done"
                      accessibilityLabel={`Add an item to ${element.name}`}
                    />
                    <Pressable
                      onPress={() => addItem(element.id)}
                      disabled={!(itemDraft[element.id] ?? '').trim()}
                      style={styles.addGo}
                      accessibilityRole="button"
                      accessibilityLabel="Add it"
                    >
                      <Icon
                        name="add"
                        size="md"
                        color={(itemDraft[element.id] ?? '').trim() ? Colors.primary : Colors.textMuted}
                      />
                    </Pressable>
                  </View>

                  {drawElements && element.itemCount > 0 ? (
                    <View style={styles.elementFoot}>
                      <Text style={styles.elementTotal}>
                        {formatMoney(element.committedTotal) ?? '—'} committed
                      </Text>
                      <Text style={styles.elementDenominator}>{describeTotals(element)}</Text>
                    </View>
                  ) : null}

                  {drawElements ? (
                    <View style={styles.elementFiles}>
                      <Attachments
                        householdId={household.id}
                        photoPaths={element.photoPaths}
                        documentPaths={element.documentPaths}
                        onChange={async (next, toast) => {
                          await updateElement(element.id, next);
                          showToast(toast);
                          await load();
                        }}
                        emptyLabel={`Nothing attached to the ${element.name.toLowerCase()} yet.`}
                      />
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.elementFoot}>
                  <Text style={styles.elementTotal}>
                    {formatMoney(element.committedTotal) ?? '—'} committed
                  </Text>
                  <Text style={styles.elementDenominator}>{describeTotals(element)}</Text>
                </View>
              )}
            </View>
          );
        })}

        {/* ── the punch list ─────────────────────────────────────────────
            Ordinary snags, filed against this project. They live on the List
            tab in their rooms like everything else — a project does not get a
            to-do list of its own. */}
        {snags.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>To sort out</Text>
              <View style={styles.rule} />
            </View>
            {snags.map((snag) => (
              <Pressable
                key={snag.id}
                onPress={() => navigation.navigate('SnagDetail', { snagId: snag.id })}
                style={styles.snag}
                accessibilityRole="button"
                accessibilityLabel={snag.description ?? snag.reference}
              >
                <Text style={styles.snagText} numberOfLines={1}>
                  {snag.description ?? snag.reference}
                </Text>
                <StatusBadge status={snag.status} />
              </Pressable>
            ))}
            <Text style={styles.hint}>
              These are ordinary jobs on the list — filing one here doesn’t start it.
            </Text>
          </>
        ) : null}

        {/* ── hand it over ───────────────────────────────────────────────
            The payoff, and the reason to keep the record at all: three years
            on, the question is the model number and the warranty, not the cost.

            **A standing section, not a prompt at the end.** The model number
            gets recorded the week the thing goes in and the invoice is in
            somebody's hand — not eight months later, and not only if the
            project ever gets marked done.

            **Each row opens the walkthrough filled in, and you confirm.** Not a
            bulk write: the rule the snag page already states about creating a
            thing from a job holds here with more force, because there are
            twelve of them — a record created from here has to be as strong as
            one created on the House tab, or this is the back door that fills
            the house record with rows nobody can read in a shop. */}
        {installed.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>Hand it over</Text>
              <View style={styles.rule} />
            </View>
            <Text style={styles.hint}>
              {handedOverCount === 0
                ? `None of the ${installed.length} installed are in the house record yet.`
                : `${handedOverCount} of ${installed.length} installed are in the house record.`}
            </Text>
            {(handoverOpen ? installed : installed.slice(0, HANDOVER_PREVIEW)).map((item) => {
              const done = handedOver.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={done ? undefined : () => setThingFor(item)}
                  disabled={done}
                  style={[styles.handoverRow, done && styles.handoverDone]}
                  accessibilityRole="button"
                  accessibilityState={{ checked: done, disabled: done }}
                  accessibilityLabel={
                    done
                      ? `${item.name} is in the house record`
                      : `Record ${item.name} in the house record`
                  }
                >
                  <Icon
                    name={done ? 'checkbox-outline' : 'square-outline'}
                    size="md"
                    color={done ? Colors.primary : Colors.textMuted}
                  />
                  <View style={styles.handoverTitles}>
                    <Text style={styles.handoverName}>{item.name}</Text>
                    <Text style={styles.handoverSub} numberOfLines={1}>
                      {[
                        elementRoom(elements, item),
                        done ? 'in the house record' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {installed.length > HANDOVER_PREVIEW ? (
              <Pressable
                onPress={() => setHandoverOpen((open) => !open)}
                style={styles.moreTap}
                accessibilityRole="button"
              >
                <Text style={styles.link}>
                  {handoverOpen ? 'Show fewer' : `Show all ${installed.length}`}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {/* ── the project's own paperwork ────────────────────────────────── */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>Paperwork for the project</Text>
          <View style={styles.rule} />
        </View>
        <Attachments
          householdId={household.id}
          photoPaths={project.photoPaths}
          documentPaths={project.documentPaths}
          onChange={patchProject}
          emptyLabel="Consents, plans, the builder’s contract — anything about the whole job."
        />

        {/* ── everything under it ────────────────────────────────────────
            Files roll *up*. This is the whole folder, each row saying which
            level owns it — so the consent above is not confused with the
            tiling quote three levels down. */}
        {files.length > project.photoPaths.length + project.documentPaths.length ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>Everything filed under this job</Text>
              <View style={styles.rule} />
            </View>
            {files
              .filter((file) => file.level !== 'project')
              .map((file) => (
                <View key={`${file.level}-${file.path}`} style={styles.file}>
                  <Icon
                    name={file.kind === 'photo' ? 'image-outline' : 'document-text-outline'}
                    size="sm"
                    color={Colors.textMuted}
                  />
                  <View style={styles.fileTitles}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {file.kind === 'photo' ? 'Photo' : documentName(file.path)}
                    </Text>
                    <Text style={styles.fileWhere}>
                      {PROJECT_FILE_LEVEL_LABELS[file.level]} · {file.ownerName}
                    </Text>
                  </View>
                </View>
              ))}
            <Text style={styles.hint}>
              Attached lower down, and shown here because everything under a job is part of its
              record. Opening a part of the job doesn’t show the project’s own paperwork.
            </Text>
          </>
        ) : null}

        <ExportFooter label="Export this job" onPress={() => setShowExport(true)} />

        <Pressable
          onPress={() => setConfirmDelete(true)}
          style={styles.remove}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${project.name}`}
        >
          <Text style={styles.removeLabel}>Delete this project</Text>
        </Pressable>
      </ScrollView>

      <ProjectRoomsSheet
        visible={roomsOpen}
        locations={locations}
        elements={elements}
        onAddRoom={addRoomTag}
        onAdd={async (name, room) => {
          await addElement(name, room);
        }}
        onClose={() => setRoomsOpen(false)}
      />

      {/* An empty part is a heading and nothing else, so taking it off is a
          two-button decision like every other. A part that *holds* something is
          the one case here where pressing Remove destroys work that cannot be
          got back — its items, their quotes and their files all go — so it asks
          for the word to be typed, the same gate deleting a place already uses
          and for the same reason. The room itself always survives either way. */}
      <ConfirmDialog
        visible={removingElement !== null}
        title={`Remove ${removingElement?.name ?? ''}?`}
        message={
          removingElement && elementHoldsSomething(removingElement)
            ? `${describeWhatGoes(removingElement)} The room itself stays.`
            : 'Nothing is on it yet. The room itself stays.'
        }
        confirmLabel="Remove"
        confirmText={
          removingElement && elementHoldsSomething(removingElement) ? 'Delete' : undefined
        }
        destructive
        onCancel={() => setRemovingElement(null)}
        onConfirm={() => removingElement && removeElement(removingElement)}
      />

      <ExportSheet
        visible={showExport}
        what="this job"
        counts={{ view: project.itemCount, all: project.itemCount }}
        busy={exporting}
        onExport={handleExport}
        onCancel={() => setShowExport(false)}
      />

      <ItemSheet
        visible={openItem !== null}
        householdId={household.id}
        item={activeItem}
        quotes={activeItem ? quotesByItem[activeItem.id] ?? [] : []}
        onClose={() => setOpenItem(null)}
        onUpdateItem={async (update, toast) => {
          if (!activeItem) return;
          await updateItem(activeItem.id, update);
          showToast(toast);
          await load();
        }}
        onDeleteItem={async () => {
          if (!activeItem) return;
          const paths = await deleteItem(activeItem.id);
          await deleteStoredFiles(paths);
          setOpenItem(null);
          showToast('Removed');
          await load();
        }}
        onAddQuote={async (input) => {
          if (!activeItem) return;
          await createQuote({ itemId: activeItem.id, ...input });
          showToast('Saved');
          await load();
        }}
        onUpdateQuote={async (quoteId, update) => {
          await updateQuote(quoteId, update);
          showToast('Saved');
          // Re-read, because a corrected amount moves Quoted, Chosen and Spent
          // at three levels at once and every one of them is derived in a view.
          await load();
        }}
        onSetQuoteStatus={async (quoteId: string, status: ProjectQuoteStatus) => {
          await setQuoteStatus(quoteId, status);
          showToast(PROJECT_QUOTE_STATUS_LABELS[status]);
          // Re-read: accepting moves Committed and Outstanding at three levels
          // at once, and every one of them is derived in a view.
          await load();
        }}
        onDeleteQuote={async (quoteId) => {
          const paths = await deleteQuote(quoteId);
          await deleteStoredFiles(paths);
          showToast('Removed');
          await load();
        }}
        onUpdateQuoteFiles={async (quoteId, next, toast) => {
          await updateQuote(quoteId, next);
          showToast(toast);
          await load();
        }}
        onRecordAsThing={() => {
          setThingFor(activeItem);
          setOpenItem(null);
        }}
      />

      <AddThingSheet
        visible={thingFor !== null}
        locations={locations}
        pathPrefix={household.id}
        start={thingStart}
        onAddRoom={async () => false}
        onCancel={() => setThingFor(null)}
        onAdd={recordAsThing}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title={`Delete ${project.name}?`}
        message={`${project.itemCount === 1 ? '1 item' : `${project.itemCount} items`}, ${
          project.fileCount === 1 ? '1 file' : `${project.fileCount} files`
        } and every quote go with it. Jobs on the list and anything in the house record stay — they just stop saying which project they came from.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeProject}
      />
    </View>
  );
}

/** Which room an item sits in, through the part of the job that holds it. */
function elementRoom(elements: ProjectElement[], item: ProjectItem): string | null {
  return elements.find((element) => element.id === item.elementId)?.room ?? null;
}

/**
 * Whether removing this part would destroy anything.
 *
 * Files count, not just items: a part with no items but a council letter
 * attached is not empty, and "Nothing is on it yet" would be the screen telling
 * somebody a lie right before it acted on it.
 */
export function elementHoldsSomething(element: ProjectElement): boolean {
  return (
    element.itemCount > 0 ||
    element.photoPaths.length > 0 ||
    element.documentPaths.length > 0
  );
}

/**
 * What goes with it, in counts rather than a general warning — the same rule
 * deleting a place follows. A reader can weigh "3 items and 2 files"; they
 * cannot weigh "this cannot be undone".
 */
export function describeWhatGoes(element: ProjectElement): string {
  const files = element.photoPaths.length + element.documentPaths.length;
  const parts: string[] = [];
  if (element.itemCount > 0) {
    parts.push(
      element.itemCount === 1
        ? 'its item, and every quote on it'
        : `its ${element.itemCount} items, and every quote on them`
    );
  }
  if (files > 0) parts.push(files === 1 ? '1 file' : `${files} files`);
  if (parts.length === 0) return 'Nothing is on it yet.';
  const listed = parts.length === 1 ? parts[0] : `${parts[0]} and ${parts[1]}`;
  return `That takes ${listed} with it, and none of it comes back.`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl * 2 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: Spacing.sm },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: { backgroundColor: Colors.sunken, borderRadius: Radius.chip, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },

  strip: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowKey: {
    width: 58,
    flexShrink: 0,
    fontSize: Typography.xs,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Right-aligned so the three figures share an edge; `minWidth: 0` because a
  // flexed Text around a long unbroken string will otherwise refuse to shrink.
  rowValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
    fontFamily: Fonts.mono,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  rowValueSpent: { color: Colors.primary },
  // Brass: a fact about a date has earned brass elsewhere, and money still to go
  // out is the same kind of fact. Never clay — being owed money on a renovation
  // under way is the normal state, not an alarm.
  rowValueOwing: { color: Colors.status.doing },
  stripRule: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: -Spacing.lg,
    marginVertical: 2,
  },
  budgetLine: {
    fontSize: Typography.xs,
    color: Colors.textSecondary,
    textAlign: 'right',
    paddingBottom: Spacing.md,
  },
  // Clay is the one hue on a household list that has earned red. Over budget is
  // a fact about a number, not a judgement about the renovation.
  budgetLineOver: { color: Colors.priority.high, fontWeight: Typography.semibold },
  supplier: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  supplierTitles: { flex: 1, minWidth: 0 },
  supplierName: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  supplierUnder: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 3 },
  supplierMoney: { alignItems: 'flex-end', paddingLeft: Spacing.md },
  supplierKey: { fontSize: 10, letterSpacing: 0.4, color: Colors.textMuted },
  supplierOwing: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.status.doing,
  },
  settledPill: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    marginLeft: Spacing.md,
  },
  settledLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  handoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  handoverDone: { opacity: 0.62 },
  handoverTitles: { flex: 1, minWidth: 0 },
  handoverName: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  handoverSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  moreTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  link: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.semibold },
  // Not optional, anywhere. The figures above mean nothing without it.
  denominator: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  gstNote: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xl, marginBottom: Spacing.sm },
  section: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  rule: { flex: 1, height: 1, backgroundColor: Colors.border },
  plusTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md },

  element: { marginBottom: Spacing.sm },
  elementCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  elementHead: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  elementTop: { flexDirection: 'row', alignItems: 'flex-start' },
  elementRemove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginRight: -Spacing.sm,
  },
  elementTitles: { flex: 1, minWidth: 0 },
  elementName: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  elementSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  items: { marginTop: Spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight: MIN_TOUCH_TARGET,
  },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  itemTitles: { flex: 1, minWidth: 0 },
  itemName: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  itemSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  // `flexShrink: 0` so the name gives way before the price does: the figure is
  // what the row is read for, and half a number is worse than a clipped noun.
  itemPrice: { flexShrink: 0, fontFamily: Fonts.mono, fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  itemPriceRange: { color: Colors.status.doing, fontWeight: Typography.regular, fontSize: Typography.xs },
  itemPriceNone: { color: Colors.textMuted, fontWeight: Typography.regular, fontSize: Typography.xs },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  addInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.sm,
    color: Colors.textPrimary,
  },
  addGo: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },

  elementFoot: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  elementTotal: { fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.semibold },
  elementDenominator: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  elementFiles: { marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },

  snag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  snagText: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textPrimary },

  file: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  fileTitles: { flex: 1, minWidth: 0 },
  fileName: { fontSize: Typography.sm, color: Colors.textPrimary },
  fileWhere: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },

  hint: { fontSize: Typography.xs, color: Colors.textMuted, lineHeight: 17, marginTop: Spacing.xs },
  remove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginTop: Spacing.xxl },
  removeLabel: { fontSize: Typography.sm, color: Colors.danger },
});

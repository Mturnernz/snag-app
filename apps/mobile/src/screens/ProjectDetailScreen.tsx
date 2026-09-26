import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

import Icon from '../components/Icon';
import Attachments from '../components/Attachments';
import ConfirmDialog from '../components/ConfirmDialog';
import AddThingSheet from '../components/AddThingSheet';
import ExportFooter from '../components/ExportFooter';
import ProjectRoomsSheet from '../components/ProjectRoomsSheet';
import BuildUpSheet from '../components/BuildUpSheet';
import ExpectedCostSheet from '../components/ExpectedCostSheet';
import EditBudgetSheet from '../components/EditBudgetSheet';
import ScheduleSheet from '../components/ScheduleSheet';
import InvoiceReviewCard from '../components/InvoiceReviewCard';
import InvoiceReviewSheet from '../components/InvoiceReviewSheet';
import ReviewEditSheet from '../components/ReviewEditSheet';
import FilePaperworkSheet from '../components/FilePaperworkSheet';
import TaggedFiles from '../components/TaggedFiles';
import FilesBySupplier from '../components/FilesBySupplier';
import SupplierList from '../components/SupplierList';
import SupplierSheet from '../components/SupplierSheet';
import ProjectStatusSheet from '../components/ProjectStatusSheet';
import ProjectTitle from '../components/ProjectTitle';
import EmailBillsSheet from '../components/EmailBillsSheet';
import ReviewBell from '../components/ReviewBell';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import StatusBadge from '../components/StatusBadge';
import MoneySheet, { type MoneyKind } from '../components/MoneySheet';
import ThingSheet from '../components/ThingSheet';
import PriceSheet from '../components/PriceSheet';
import RoomSheet from '../components/RoomSheet';
import SettleExpectedSheet from '../components/SettleExpectedSheet';
import { AddRow, Group, Pill, Row, SectionTitle, TextButton, groupedStyles } from '../components/Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { showAlert } from '../lib/alert';
import { fileServiceJob } from '../lib/serviceJob';
import {
  addExpectedCostLine, addMilestone, addQuoteLine, approveInvoiceReview, clearFigure,
  createElement, createExpectedCost, createLocation, createThing, deleteElement,
  declineInvoiceReview, deleteExpectedCost, deleteExpectedCostLine, deleteInvoiceReview,
  deleteMilestone, deleteProject, deleteQuoteLine, deleteStoredFiles, describeRoom,
  formatMoney, getProjectPage, getSupplierNames, liveSetAsides, payBill, projectSummary,
  renameSupplier, restoreInvoiceReview, setExpectedCostConfirmed, updateExpectedCost, updateExpectedCostLine,
  updateProject, type ProjectPage, type RoomRow,
} from '../lib/supabase';
import {
  billFactsOfReview, dayKey, describeDuplicate, describeEmailGroup, describeRenameReach, duplicateReviews,
  expectedAmountIncl, expectedPayee, expectedToPay, exportDateStamp, filesBySupplier, formatExactDate,
  formatLooseDate, groupBySupplier, matchExpectedEach, pendingReviews, projectDossierTable, projectExportPhotos,
  remainingTone, reviewAlert, reviewGroups, supplierDirectory,
  type RemainingTone, type SupplierEntry, type ThingInput,
} from '@snag/supabase-queries';
import {
  filePaperwork, setFileTags, getFileUrl, getFileUrls, rereadInvoiceReview, setInvoiceReviewRooms, updateInvoiceReview,
} from '../lib/supabase';
import { describeRooms } from '../components/RoomSplit';
import { openUrl } from '../lib/openUrl';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import {
  PROJECT_STATUS_LABELS,
  type InvoiceReview, type ProjectBill, type ProjectElement, type ProjectExpectedCost, type ProjectFile,
  type ProjectItem, type ProjectQuote, type ProjectStatus, type RootStackParamList,
} from '../types';

/** How much of the handover list is shown before it asks — a sitting's worth. */
const HANDOVER_PREVIEW = 5;

type Props = NativeStackScreenProps<RootStackParamList, 'ProjectDetail'>;
/** Where the money sheet opens: a kind, a place, a thing, or an expected payment's bill. */
type MoneyStart = {
  kind?: MoneyKind; elementId?: string | null; itemId?: string | null; settle?: ProjectExpectedCost;
};
type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * One project, V2: **are we on budget, what's left to decide, what do we have
 * to pay, and where is the money going** — in that order, because that is the
 * order somebody running their own renovation asks them.
 *
 * **Three numbers, not six.** Expected total in large type, with Agreed and
 * Undecided as the rows beneath it (they add up to it, on screen), then what is
 * left in the budget. Paid and To pay are two tiles under that. Committed,
 * Invoiced, Quoted and Forecast are not words on this page any more: they are
 * the accounting, and the reader asked a different question. The arithmetic is
 * `projectSummary` in the query package, pure and pinned by its own test.
 *
 * **Every line of small text is a fact the reader can add up** — a count, a
 * date, a supplier, a figure compared with another figure on the screen. The
 * paragraphs of explanation that used to sit under sections are gone: a claim
 * the app cannot check is one the reader learns to skip.
 *
 * **One way in for money.** The + in the header asks *what have you got?* — a
 * quote, a bill, a receipt, or a cost you're expecting — and `MoneySheet` asks
 * the rest in the reader's words, never the schema's.
 *
 * **Every row opens.** A thing opens its options; a bill opens the sheet that
 * pays it, corrects it or deletes it; a room opens what is in it. Nothing on
 * the page is a dead label.
 *
 * **Still one request, still single-flight.** The pool is ten connections; see
 * *What a press costs* in CLAUDE.md. `refresh` never has two reads on the wire.
 */
export default function ProjectDetailScreen({ route }: Props) {
  const { projectId } = route.params;
  const navigation = useNavigation<Nav>();
  const insets = useEdgeInsets();
  const { household, locations, reloadLocations } = useHousehold();
  const { showToast } = useToast();

  const [page, setPage] = useState<ProjectPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [knownSuppliers, setKnownSuppliers] = useState<string[]>([]);

  const [money, setMoney] = useState<MoneyStart | null>(null);
  const [openThing, setOpenThing] = useState<string | null>(null);
  const [openPrice, setOpenPrice] = useState<string | null>(null);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [removingElement, setRemovingElement] = useState<ProjectElement | null>(null);
  const [buildUpFor, setBuildUpFor] = useState<ProjectQuote | null>(null);
  const [scheduleFor, setScheduleFor] = useState<ProjectQuote | null>(null);
  const [expectedOpen, setExpectedOpen] = useState(false);
  const [editingExpected, setEditingExpected] = useState<ProjectExpectedCost | null>(null);
  const [thingFor, setThingFor] = useState<ProjectItem | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [checking, setChecking] = useState<InvoiceReview | null>(null);
  const [filing, setFiling] = useState<InvoiceReview | null>(null);
  const [rereadingId, setRereadingId] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [foldedPayees, setFoldedPayees] = useState<Set<string>>(() => new Set());
  const [foldedExpected, setFoldedExpected] = useState<Set<string>>(() => new Set());
  const [settling, setSettling] = useState<ProjectExpectedCost | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState<string | null>(null);
  const [merging, setMerging] = useState<{ from: SupplierEntry; to: SupplierEntry } | null>(null);
  // True while a supplier row is lifted: the page stops scrolling under it.
  const [dragging, setDragging] = useState(false);

  const refreshing = useRef(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    if (refreshing.current) {
      pending.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        pending.current = false;
        const next = await getProjectPage(projectId);
        if (!alive.current) return;
        setPage(next);
      } while (pending.current);
    } catch (err: unknown) {
      if (alive.current) showToast(err instanceof Error ? err.message : "Couldn't load that project");
    } finally {
      refreshing.current = false;
      if (alive.current) setLoading(false);
    }
  }, [projectId]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  /** Toast, then re-read: every write on this page moves figures derived in views. */
  const changed = useCallback(async (message: string) => {
    showToast(message);
    await refresh();
  }, [refresh, showToast]);

  const summary = useMemo(() => (page ? projectSummary(page) : null), [page]);
  const setAsides = useMemo(() => (page ? liveSetAsides(page) : []), [page]);
  // Waiting cards that look like a bill already on the job, or like an earlier
  // card — the same email forwarded twice. A warning on the card, never a lock.
  const duplicates = useMemo(
    () => (page ? duplicateReviews(page.quotes, pendingReviews(page.invoiceReviews)) : new Map()),
    [page],
  );
  // Which earmarked payment each waiting bill looks like — oldest card first, so
  // two claims waiting side by side offer 3/4 and 4/4 rather than 3/4 twice.
  const cardPaysOff = useMemo(() => {
    if (!page) return new Map();
    const bills = pendingReviews(page.invoiceReviews)
      .filter((r) => r.kind === 'invoice')
      .map((r) => ({ ...billFactsOfReview(r), at: r.sourceAt ?? r.createdAt }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return matchExpectedEach(bills, page.expected);
  }, [page]);
  const thingStart = useMemo(() => {
    if (!thingFor || !page) return null;
    const element = page.elements.find((e) => e.id === thingFor.elementId);
    return { name: thingFor.name, room: element?.room ?? null };
  }, [thingFor?.id, page?.elements]);

  const openMoney = useCallback(async (start: MoneyStart) => {
    setMoney(start);
    // Read when the sheet opens rather than with the page: the pool is ten
    // connections, and a name list that will not load leaves you typing.
    try {
      setKnownSuppliers(await getSupplierNames());
    } catch {
      // Never fatal.
    }
  }, []);

  // ------------------------------------------------------ invoice reviews
  /** Rules on a card: `decide` writes, and may word the toast itself from what happened. */
  const rule = useCallback(
    async (review: InvoiceReview, decide: () => Promise<unknown>, said?: string) => {
      if (!page) return;
      const before = page;
      setDecidingId(review.id);
      setPage({ ...page, invoiceReviews: page.invoiceReviews.filter((r) => r.id !== review.id) });
      try {
        const worded = await decide();
        await changed(typeof worded === 'string' ? worded : said ?? 'Saved');
      } catch (err: unknown) {
        setPage(before);
        showToast(err instanceof Error ? err.message : 'That didn’t save');
      } finally {
        setDecidingId(null);
      }
    },
    [page, changed, showToast]
  );

  // *Read again*: a card that came in blank, read as if it had just arrived.
  // It can come back as several — one per paper the email carried.
  const reread = useCallback(async (review: InvoiceReview) => {
    if (rereadingId) return;
    setRereadingId(review.id);
    try {
      const { cards } = await rereadInvoiceReview(review.id);
      await changed(cards > 1 ? `Read — that email held ${cards} papers` : 'Read — check it before you allocate it');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Couldn’t read that one just now');
    } finally {
      if (alive.current) setRereadingId(null);
    }
  }, [rereadingId, changed, showToast]);

  const openFile = useCallback(async (path: string) => {
    const url = await getFileUrl(path);
    if (url) openUrl(url);
    else showToast('That file won’t open just now');
  }, [showToast]);

  if (loading || !page || !summary) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const { project, elements, items, quotes } = page;
  const reviews = pendingReviews(page.invoiceReviews);
  const thing = items.find((i) => i.id === openThing) ?? null;
  const price = quotes.find((q) => q.id === openPrice) ?? null;
  const room = summary.rooms.find((r) => r.key === openRoom) ?? null;
  const installed = items.filter((i) => i.status === 'installed');
  const handedOver = new Set(page.things.map((t) => t.projectItemId).filter(Boolean) as string[]);
  const today = dayKey(new Date());
  const suppliers = supplierDirectory(page);
  const supplierNames = new Map(suppliers.map((s) => [s.key, s.name]));
  const fileGroups = filesBySupplier(page.files, supplierNames);
  const openSupplier = suppliers.find((s) => s.key === supplierOpen) ?? null;
  // What has been earmarked and not billed yet. Grouped under the business its
  // name spells, so "Reliabuilder payment 3/4" sits under the builder.
  const toExpect = expectedToPay(page.expected);
  const expectedRows = page.expected
    .filter((x) => x.settledBy === null)
    .map((x) => ({ id: x.id, supplier: expectedPayee(x, quotes), dated: x.createdAt, x }));
  const expectedPlace = (x: ProjectExpectedCost): string => {
    const element = elements.find((e) => e.id === x.elementId);
    return element && !element.implicit ? element.room ?? element.name : 'Whole job';
  };

  /**
   * Figures somebody typed over the prices, from before V2 took the editor away.
   *
   * They still count — an override is what the view shows — so leaving them in
   * place with nothing on the page able to say so would put a number nobody can
   * see the source of inside Agreed. The page names it, says what the prices
   * come to, and offers the way back. Nothing new can be typed over.
   */
  const FIGURES = ['committed', 'invoiced', 'paid', 'forecast'] as const;
  const overridden = [
    ...FIGURES
      .filter((f) => project[`${f}Override`] !== null)
      .map((f) => ({ field: f, elementId: null as string | null })),
    ...elements.flatMap((e) => (['committed', 'invoiced', 'paid'] as const)
      .filter((f) => e[`${f}Override`] !== null)
      .map((f) => ({ field: f, elementId: e.id as string | null }))),
  ];
  const typedOver = overridden.length > 0;

  const budget = summary.budget;
  const barAgreed = budget ? Math.min(summary.agreed / Math.max(budget, summary.expected), 1) : 0;
  const barUndecided = budget ? Math.min(summary.undecided / Math.max(budget, summary.expected), 1 - barAgreed) : 0;
  const over = summary.left !== null && summary.left < 0;
  // The list card's figure too, so it takes the card's colours: fern, brass
  // within 15%, clay within 5% and over.
  const leftTone = summary.left === null || !budget ? 'good' : remainingTone(summary.left / budget);

  async function usePrices() {
    try {
      for (const o of overridden) {
        // eslint-disable-next-line no-await-in-loop
        await clearFigure(project.id, o.field, o.elementId);
      }
      await changed('Back to the prices');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'That didn’t save');
    }
  }

  async function pay(bill: { id: string; unpaid: number | null }) {
    if (payingId) return;
    setPayingId(bill.id);
    try {
      await payBill(bill.id, bill.unpaid ?? 0, today);
      await changed('Paid');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setPayingId(null);
    }
  }

  /**
   * The one write behind renaming and merging: every row on the job naming
   * `from` now names `to`. A merge is a rename to the other supplier's
   * spelling, so the rollups group them as one.
   */
  async function renameAcross(from: SupplierEntry, to: string, message: string) {
    await renameSupplier(project.id, from.name, to);
    await changed(message);
  }

  /** Takes a file off the job itself. Files elsewhere are removed where they hang. */
  async function removeJobFile(file: ProjectFile) {
    try {
      if (file.kind === 'photo') {
        await updateProject(project.id, { photoPaths: project.photoPaths.filter((p) => p !== file.path) });
        await changed('Photo removed');
      } else {
        await updateProject(project.id, { documentPaths: project.documentPaths.filter((p) => p !== file.path) });
        await changed('Document removed');
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'That didn’t save');
    }
  }

  async function addRoomTag(name: string): Promise<boolean> {
    try {
      await createLocation(project.propertyId, name);
      await reloadLocations();
      return true;
    } catch (err: unknown) {
      showAlert("Couldn't add that room", err instanceof Error ? err.message : 'Please try again.');
      return false;
    }
  }

  /**
   * A room added from a bill: a room of the house if it is not one yet, then a
   * part of this job, through the writers the rooms sheet uses — so it is on
   * the List and House tabs too. Answers with the part's id so it can be ticked.
   */
  async function addRoomToJob(name: string): Promise<string | null> {
    const wanted = name.trim();
    try {
      const known = locations.find((l) => l.name.trim().toLowerCase() === wanted.toLowerCase());
      if (!known) {
        await createLocation(project.propertyId, wanted);
        await reloadLocations();
      }
      const roomName = known?.name ?? wanted;
      const element = await createElement(project.id, roomName, roomName);
      await refresh();
      return element.id;
    } catch (err: unknown) {
      showAlert("Couldn't add that room", err instanceof Error ? err.message : 'Please try again.');
      return null;
    }
  }

  async function removeElement(element: ProjectElement) {
    setRemovingElement(null);
    setOpenRoom(null);
    try {
      const paths = await deleteElement(element.id);
      await deleteStoredFiles(paths);
      await changed('Removed');
    } catch (err: unknown) {
      showAlert("Couldn't remove that", err instanceof Error ? err.message : 'Please try again.');
    }
  }

  async function removeProject() {
    setConfirmDelete(false);
    try {
      const paths = await deleteProject(project.id);
      await deleteStoredFiles(paths);
      showToast('Deleted');
      navigation.goBack();
    } catch (err: unknown) {
      showAlert("Couldn't delete that", err instanceof Error ? err.message : 'Try again in a moment.');
    }
  }

  async function handleExport(_scope: ExportScope, format: ExportFormat) {
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

  async function recordAsThing(input: Omit<ThingInput, 'propertyId'>): Promise<boolean> {
    try {
      const created = await createThing({
        ...input,
        propertyId: project.propertyId,
        projectId: project.id,
        projectItemId: thingFor?.id ?? null,
      });
      setThingFor(null);
      // The walkthrough's service cycle goes on the list, wherever it is asked.
      await changed((await fileServiceJob(created)) ?? 'Added to the house record');
      return true;
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't save that");
      return false;
    }
  }

  const money$ = (n: number) => formatMoney(n) ?? '—';
  const dueText = (bill: ProjectBill): string | null => (
    bill.overdue && bill.dueOn ? `Overdue since ${formatExactDate(bill.dueOn)}`
      : bill.dueOn ? `Due ${formatExactDate(bill.dueOn)}` : null
  );
  const started = project.startedOn ? `Started ${formatLooseDate(project.startedOn)}` : null;
  const finished = project.status === 'done' && project.finishedOn ? `Finished ${formatLooseDate(project.finishedOn)}` : null;

  return (
    <View style={groupedStyles.screen}>
      <View style={[styles.nav, { paddingTop: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back to projects"
        >
          <Icon name="chevron-back" size={24} color={Colors.primary} />
          <Text style={styles.backLabel}>Projects</Text>
        </Pressable>
        <View style={styles.navRight}>
          <ReviewBell count={reviews.length} onPress={() => setReviewSheetOpen(true)} />
          <Pressable
            onPress={() => openMoney({})}
            style={styles.addTap}
            accessibilityRole="button"
            accessibilityLabel="Add a quote, invoice or receipt"
          >
            <View style={styles.addDisc}>
              <Icon name="add" size={22} color={Colors.white} />
            </View>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!dragging}>
        <View style={styles.titleBlock}>
          <ProjectTitle
            name={project.name}
            onRename={async (next) => {
              await updateProject(project.id, { name: next });
              await changed('Renamed');
            }}
          />
          <View style={styles.statusLine}>
            {/*
              Where the project is up to, and the one way to change it. A pill
              beside the date rather than a row of chips, which were taken off
              this page for the height they cost.
            */}
            <Pressable
              onPress={() => setStatusOpen(true)}
              style={styles.statusTap}
              accessibilityRole="button"
              accessibilityLabel={`${PROJECT_STATUS_LABELS[project.status]}. Change where it’s up to`}
            >
              <View style={[styles.statusPill, STATUS_TINT[project.status]]}>
                <Text style={[styles.statusLabel, { color: STATUS_INK[project.status] }]}>
                  {PROJECT_STATUS_LABELS[project.status]}
                </Text>
                <Icon name="chevron-down" size={14} color={STATUS_INK[project.status]} />
              </View>
            </Pressable>
            {started || finished ? <Text style={groupedStyles.caption}>{finished ?? started}</Text> : null}
          </View>
        </View>

        {reviews.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title={reviewAlert(page.invoiceReviews) ?? 'Bills waiting'} />
            {reviewGroups(reviews).map((group) => (
              <View key={group.key} style={styles.emailGroup}>
                {/*
                  One email, several papers. The line above them says so and
                  counts them, so what was forwarded can be checked against what
                  arrived: five papers sent, five cards here.
                */}
                {group.reviews.length > 1 ? (
                  <Text style={groupedStyles.caption} numberOfLines={2}>
                    {[group.subject ?? 'One email', describeEmailGroup(group.reviews)].join(' — ')}
                  </Text>
                ) : null}
                {group.reviews.map((review) => {
                  const twin = duplicates.get(review.id);
                  const paperwork = review.kind === 'paperwork';
                  return (
                  <InvoiceReviewCard
                    key={review.id}
                    review={review}
                    busy={decidingId === review.id}
                    rereading={rereadingId === review.id}
                    onReread={() => reread(review)}
                    duplicate={
                      twin?.quote ? describeDuplicate(twin.quote, 'on the job')
                        : twin?.review ? describeDuplicate(billFactsOfReview(twin.review), 'waiting')
                          : null
                    }
                    onOpenDuplicate={twin?.quote ? () => setOpenPrice(twin.quote!.id) : undefined}
                    onEdit={() => setChecking(review)}
                    onChangeKind={async (next) => {
                      await updateInvoiceReview(review.id, { kind: next });
                      await changed(next === 'paperwork' ? 'Now paperwork' : next === 'quote' ? 'Now a quote' : 'Now an invoice');
                    }}
                    onOpenFile={openFile}
                    landsOn={
                      paperwork ? null
                        : review.roomIds.length > 0
                          ? describeRooms(review.roomIds, review.roomAmounts, review.amount, elements)
                          : elements.find((e) => e.id === review.elementId && !e.implicit)?.name ?? 'Whole job'
                    }
                    paysOff={cardPaysOff.get(review.id)}
                    onApprove={(paysOff) => (paperwork
                      ? setFiling(review)
                      : rule(
                        review,
                        async () => {
                          const said = review.kind === 'quote'
                            ? 'Added as a quote — nothing’s agreed yet'
                            : review.paid && review.amount !== null ? 'Added, and recorded as paid' : 'Added to the job';
                          const bill = await approveInvoiceReview(review.id);
                          if (!paysOff) return said;
                          // The bill is on the job now; a refused link must not
                          // put the card back, or allocating again would record
                          // it twice. So it is said, and left to *Billed*.
                          try {
                            await updateExpectedCost(paysOff.id, { settledBy: bill.id });
                            return `${said} · pays off ${paysOff.name}`;
                          } catch {
                            return `${said}, but not linked to ${paysOff.name} — use Billed on Expected to pay`;
                          }
                        },
                      ))}
                    onDecline={() => rule(review, () => declineInvoiceReview(review.id), 'Removed — it’s under the bell')}
                  />
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}

        {/* ── are we on budget ─────────────────────────────────────────── */}
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Expected total</Text>
          <Text style={styles.summaryFigure} accessibilityLabel={`Expected total ${money$(summary.expected)}`}>
            {money$(summary.expected)}
          </Text>
          {budget !== null ? (
            <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.barAgreed, { flex: barAgreed }]} />
              <View style={[styles.barUndecided, { flex: barUndecided }]} />
              <View style={{ flex: Math.max(1 - barAgreed - barUndecided, 0) }} />
            </View>
          ) : null}
          <SummaryLine dot={Colors.primary} label="Agreed" value={money$(summary.agreed)} />
          <View style={styles.hairlineInset} />
          <SummaryLine dot={Colors.undecided} label="Undecided" value={money$(summary.undecided)} />
          <View style={styles.hairline} />
          {budget !== null ? (
            <>
              <SummaryLine
                dot={Colors.track}
                label={over ? 'Over budget' : 'Budget remaining'}
                value={money$(Math.abs(summary.left ?? 0))}
                tone={leftTone}
              />
              <View style={styles.hairlineInset} />
            </>
          ) : null}
          <Pressable
            onPress={() => setBudgetOpen(true)}
            style={styles.budgetRow}
            accessibilityRole="button"
            accessibilityLabel={budget === null ? 'Set a budget' : `Budget ${money$(budget)}, change it`}
          >
            <Text style={styles.budgetLabel}>Budget</Text>
            <Text style={[styles.budgetValue, budget === null && styles.link]}>
              {budget === null ? 'Set a budget' : money$(budget)}
            </Text>
          </Pressable>
        </View>

        {typedOver ? (
          <Group>
            <Row
              title="Some figures were typed in by hand"
              subtitle={project.committedOverride !== null
                ? `The prices come to ${money$((project.committedDerived ?? 0) - project.allowanceOpen)} agreed`
                : null}
              tone="danger"
              accessory={<Pill label="Use the prices" onPress={usePrices} />}
            />
          </Group>
        ) : null}

        <View style={styles.tileStack}>
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>Paid</Text>
              <Text style={styles.tileFigure}>{money$(summary.paid)}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>To pay</Text>
              <Text style={styles.tileFigure}>{money$(summary.toPay)}</Text>
            </View>
          </View>
          {/*
            Its own row: three six-figure amounts at this size do not fit across a
            phone, and half a number is worse than a tile a row lower. Absent when
            nothing is earmarked, like the section it heads.
          */}
          {toExpect.count > 0 ? (
            <View style={styles.tileWide}>
              <Text style={styles.tileLabel}>Expected to pay</Text>
              <Text style={styles.tileFigure} numberOfLines={1}>{money$(toExpect.total)}</Text>
              {toExpect.unpriced > 0 ? (
                <Text style={styles.tileFacts}>+ {toExpect.unpriced} not priced</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* ── what's left to decide ────────────────────────────────────── */}
        {summary.toDecide.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="To decide" count={summary.toDecide.length} />
            <Group>
              {summary.toDecide.map((d) => (
                <Row
                  key={d.item.id}
                  title={d.item.name}
                  subtitle={[
                    d.room,
                    d.options.length === 0 ? 'No prices yet'
                      : d.options.length === 1 ? '1 option' : `${d.options.length} options`,
                  ].filter(Boolean).join(' · ')}
                  value={
                    d.low === null ? null
                      : d.low === d.high ? money$(d.low) : `${money$(d.low)}–${money$(d.high!)}`
                  }
                  tone="muted"
                  onPress={() => setOpenThing(d.item.id)}
                />
              ))}
            </Group>
          </View>
        ) : null}

        {/* ── what do we have to pay ───────────────────────────────────── */}
        {summary.bills.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="To pay" count={summary.bills.length} />
            <Group>
              {groupBySupplier(summary.bills).flatMap((group) => {
                const billRow = (bill: ProjectBill, sub: boolean) => (
                  <Row
                    key={bill.id}
                    indent={sub}
                    title={sub ? bill.detail ?? (bill.dated ? formatExactDate(bill.dated) : 'An invoice') : bill.supplier ?? 'An invoice'}
                    subtitle={[
                      sub ? null : bill.detail,
                      dueText(bill),
                    ].filter(Boolean).join(' · ') || null}
                    value={money$(bill.unpaid ?? 0)}
                    tone={bill.overdue ? 'danger' : 'default'}
                    bold={!sub}
                    onPress={() => setOpenPrice(bill.id)}
                    accessibilityLabel={sub ? `${bill.supplier}, ${bill.detail ?? 'invoice'}` : undefined}
                    accessory={(
                      <Pill
                        label="Paid"
                        disabled={payingId !== null}
                        accessibilityLabel={`Mark ${bill.supplier ?? 'this invoice'}${sub && bill.detail ? ` ${bill.detail}` : ''} ${money$(bill.unpaid ?? 0)} as paid`}
                        onPress={() => pay(bill)}
                      />
                    )}
                  />
                );
                if (group.rows.length === 1) return [billRow(group.rows[0], false)];
                const open = !foldedPayees.has(group.key);
                const owed = group.rows.reduce((total, b) => total + (b.unpaid ?? 0), 0);
                const overdue = group.rows.filter((b) => b.overdue).length;
                const subtitle = [`${group.rows.length} invoices`, overdue > 0 ? `${overdue} overdue` : null]
                  .filter(Boolean).join(' · ');
                return [
                  <Row
                    key={group.key}
                    title={group.supplier ?? 'An invoice'}
                    subtitle={subtitle}
                    value={money$(owed)}
                    tone={overdue > 0 ? 'danger' : 'default'}
                    bold
                    expanded={open}
                    onPress={() => setFoldedPayees((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })}
                    accessibilityLabel={`${group.supplier}, ${subtitle}, ${money$(owed)} to pay`}
                  />,
                  ...(open ? group.rows.map((bill) => billRow(bill, true)) : []),
                ];
              })}
            </Group>
          </View>
        ) : null}

        {/*
          ── what we expect to pay ──────────────────────────────────────────
          Money earmarked before anybody billed for it. *Billed* says which bill
          paid it, and it leaves: the bill counts, and the earmark stops.
        */}
        {toExpect.count > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="Expected to pay" count={toExpect.count} />
            <Group>
              {groupBySupplier(expectedRows).flatMap((group) => {
                const expectedRow = (row: (typeof expectedRows)[number], sub: boolean) => {
                  const { x } = row;
                  const amount = expectedAmountIncl(x);
                  return (
                    <Row
                      key={x.id}
                      indent={sub}
                      title={sub || !row.supplier ? x.name : row.supplier}
                      subtitle={[
                        sub || !row.supplier ? null : x.name,
                        expectedPlace(x),
                        // The page's own words: an unconfirmed earmark is in Undecided.
                        x.confirmed ? 'agreed' : 'undecided',
                      ].filter(Boolean).join(' · ')}
                      value={amount !== null ? money$(amount) : 'Not priced'}
                      tone={x.confirmed ? 'default' : 'muted'}
                      bold={!sub}
                      onPress={() => { setEditingExpected(x); setExpectedOpen(true); }}
                      accessibilityLabel={sub ? `${row.supplier}, ${x.name}` : undefined}
                      accessory={(
                        <Pill
                          label="Billed"
                          accessibilityLabel={`Say which bill paid ${x.name}`}
                          onPress={() => setSettling(x)}
                        />
                      )}
                    />
                  );
                };
                if (group.rows.length === 1) return [expectedRow(group.rows[0], false)];
                const open = !foldedExpected.has(group.key);
                const total = group.rows.reduce((sum, r) => sum + (expectedAmountIncl(r.x) ?? 0), 0);
                const unpriced = group.rows.filter((r) => r.x.amount === null).length;
                const subtitle = [`${group.rows.length} payments`, unpriced > 0 ? `${unpriced} not priced` : null]
                  .filter(Boolean).join(' · ');
                return [
                  <Row
                    key={group.key}
                    title={group.supplier ?? 'Expected'}
                    subtitle={subtitle}
                    value={money$(total)}
                    bold
                    expanded={open}
                    onPress={() => setFoldedExpected((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })}
                    accessibilityLabel={`${group.supplier}, ${subtitle}, ${money$(total)} expected`}
                  />,
                  ...(open ? group.rows.map((row) => expectedRow(row, true)) : []),
                ];
              })}
            </Group>
          </View>
        ) : null}

        {/* ── where is the money going ─────────────────────────────────── */}
        <View style={groupedStyles.block}>
          <SectionTitle title="Where it’s going" />
          {summary.rooms.length > 0 ? (
            <Group>
              {summary.rooms.map((r) => (
                <Row
                  key={r.key}
                  title={r.name}
                  subtitle={describeRoom(r, money$) || null}
                  value={r.total === 0 && r.toDecide === 0 ? null : money$(r.total)}
                  tone={r.agreed === 0 && r.undecided > 0 ? 'muted' : 'default'}
                  onPress={() => setOpenRoom(r.key)}
                />
              ))}
            </Group>
          ) : null}
          <AddRow label="Add a room to this job" onPress={() => setRoomsOpen(true)} />
        </View>

        {/* ── the punch list ───────────────────────────────────────────── */}
        {page.snags.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="To sort out" count={page.snags.filter((s) => s.status !== 'done').length} />
            <Group>
              {page.snags.map((snag) => (
                <Row
                  key={snag.id}
                  title={snag.description ?? snag.reference}
                  onPress={() => navigation.navigate('SnagDetail', { snagId: snag.id })}
                  accessory={<View style={styles.badgeSlot}><StatusBadge status={snag.status} /></View>}
                />
              ))}
            </Group>
          </View>
        ) : null}

        {/* ── hand it over ─────────────────────────────────────────────── */}
        {installed.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle
              title="Add to the house record"
              count={installed.filter((i) => !handedOver.has(i.id)).length}
            />
            <Group>
              {(handoverOpen ? installed : installed.slice(0, HANDOVER_PREVIEW)).map((item) => {
                const done = handedOver.has(item.id);
                return (
                  <Row
                    key={item.id}
                    title={item.name}
                    subtitle={done ? 'In the house record' : elements.find((e) => e.id === item.elementId)?.room ?? null}
                    dim={done}
                    onPress={done ? undefined : () => setThingFor(item)}
                    accessibilityLabel={done ? `${item.name} is in the house record` : `Record ${item.name} in the house record`}
                  />
                );
              })}
            </Group>
            {installed.length > HANDOVER_PREVIEW ? (
              <TextButton
                label={handoverOpen ? 'Show fewer' : `Show all ${installed.length}`}
                onPress={() => setHandoverOpen((open) => !open)}
              />
            ) : null}
          </View>
        ) : null}

        {/* ── suppliers ────────────────────────────────────────────────── */}
        {suppliers.length > 0 ? (
          <View style={groupedStyles.block}>
            <SectionTitle title="Suppliers" count={suppliers.length} />
            <SupplierList
              suppliers={suppliers}
              money={money$}
              onOpen={(s) => setSupplierOpen(s.key)}
              onMerge={(from, to) => { setSupplierOpen(null); setMerging({ from, to }); }}
              onDragChange={setDragging}
            />
          </View>
        ) : null}

        {/* ── documents ────────────────────────────────────────────────── */}
        <View style={groupedStyles.block}>
          <TaggedFiles files={page.files} tags={page.fileTags} />
          <SectionTitle title="Documents" count={page.files.length || undefined} />
          <FilesBySupplier
            groups={fileGroups}
            tags={page.fileTags}
            onTag={async (path, tag) => {
              try {
                await setFileTags([path], tag);
                await changed(tag ? 'Tagged' : 'Tag removed');
              } catch (err: unknown) {
                showToast(err instanceof Error ? err.message : 'That tag didn’t save');
              }
            }}
            onRemove={removeJobFile}
          />
          {/* Added here, a file is the job's own, and lands under Not from a supplier. */}
          <View style={styles.docAdds}>
            <Attachments
              controlsOnly
              householdId={household.id}
              photoPaths={project.photoPaths}
              documentPaths={project.documentPaths}
              onChange={async (next, toast) => {
                try {
                  await updateProject(project.id, next);
                  await changed(toast);
                } catch (err: unknown) {
                  showToast(err instanceof Error ? err.message : 'That didn’t save');
                }
              }}
            />
          </View>
        </View>

        <ExportFooter label="Export this job" onPress={() => setShowExport(true)} />
        <TextButton label="Delete this project" tone="danger" onPress={() => setConfirmDelete(true)} accessibilityLabel={`Delete ${project.name}`} />
      </ScrollView>

      <MoneySheet
        visible={money !== null}
        projectId={project.id}
        householdId={household.id}
        elements={elements}
        items={items}
        quotes={quotes}
        locations={locations}
        knownSuppliers={knownSuppliers}
        expected={page.expected}
        start={money}
        onClose={() => setMoney(null)}
        onSaved={changed}
        onEmailIn={() => { setMoney(null); setEmailOpen(true); }}
        onOpenBill={(q) => { setMoney(null); setOpenPrice(q.id); }}
      />

      <SettleExpectedSheet
        expected={money === null ? settling : null}
        quotes={quotes}
        all={page.expected}
        onClose={() => setSettling(null)}
        onChoose={async (bill) => {
          if (!settling) return;
          await updateExpectedCost(settling.id, { settledBy: bill.id });
          await changed(`Paid off by ${bill.invoiceNumber ?? bill.supplier ?? 'that bill'}`);
        }}
        onRecord={() => {
          const x = settling;
          setSettling(null);
          if (x) openMoney({ kind: 'bill', settle: x });
        }}
      />

      <EmailBillsSheet visible={emailOpen} projectId={project.id} onClose={() => setEmailOpen(false)} />

      <ReviewEditSheet
        review={checking}
        elements={elements}
        locations={locations}
        onAddRoom={addRoomToJob}
        onClose={() => setChecking(null)}
        onSave={async (update, rooms) => {
          if (!checking) return;
          // The figure first: the split is checked against the bill as it now reads.
          await updateInvoiceReview(checking.id, update);
          await setInvoiceReviewRooms(checking.id, rooms.ids, rooms.amounts);
          await changed('Saved — it still needs allocating');
        }}
      />

      <FilePaperworkSheet
        review={filing}
        quotes={quotes}
        elements={elements}
        onClose={() => setFiling(null)}
        onFile={async (where, tag) => {
          if (!filing) return;
          await filePaperwork(filing.id, where);
          // Filed first: a tag on a file nothing yet holds would name a file
          // nobody can see. Its PDFs only — a photo of the deck is not a
          // certificate, whatever the paper beside it was.
          if (tag) await setFileTags(filing.documentPaths, tag);
          await changed('Filed with the job’s paperwork');
        }}
      />

      <ThingSheet
        visible={thing !== null && money === null}
        item={thing}
        room={thing ? elements.find((e) => e.id === thing.elementId)?.room ?? null : null}
        quotes={quotes}
        setAsides={setAsides}
        onClose={() => setOpenThing(null)}
        onChanged={changed}
        onAddOption={(item) => openMoney({ kind: 'quote', elementId: item.elementId, itemId: item.id })}
        onOpenBill={(q) => { setOpenThing(null); setOpenPrice(q.id); }}
        onRecordInHouse={(item) => { setOpenThing(null); setThingFor(item); }}
      />

      <PriceSheet
        visible={price !== null && buildUpFor === null && scheduleFor === null}
        quote={price}
        householdId={household.id}
        quotes={quotes}
        payments={page.payments}
        lines={page.lines}
        onClose={() => setOpenPrice(null)}
        onChanged={changed}
        onOpenBuildUp={setBuildUpFor}
        onOpenSchedule={setScheduleFor}
        onOpen={(q) => setOpenPrice(q.id)}
        elements={elements}
        locations={locations}
        quoteRooms={page.quoteRooms}
        onAddRoom={addRoomToJob}
        fileTags={page.fileTags}
        expected={page.expected}
      />

      <RoomSheet
        visible={room !== null && thing === null && price === null && money === null && !expectedOpen}
        room={room}
        items={items}
        quotes={quotes}
        quoteRooms={page.quoteRooms}
        expected={page.expected}
        onClose={() => setOpenRoom(null)}
        onOpenThing={(item) => setOpenThing(item.id)}
        onOpenPrice={(q) => setOpenPrice(q.id)}
        onOpenExpected={(x) => { setEditingExpected(x); setExpectedOpen(true); }}
        onAdd={(r: RoomRow) => openMoney({ elementId: r.elementId })}
        onRemove={(r: RoomRow) => {
          const element = elements.find((e) => e.id === r.elementId) ?? null;
          setRemovingElement(element);
        }}
      />

      <ProjectRoomsSheet
        visible={roomsOpen}
        locations={locations}
        elements={elements}
        onAddRoom={addRoomTag}
        onAdd={async (name, roomName) => {
          try {
            await createElement(project.id, name, roomName);
            await changed('Added');
          } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : "Couldn't add that");
          }
        }}
        onClose={() => setRoomsOpen(false)}
      />

      <ConfirmDialog
        visible={removingElement !== null}
        title={`Take ${removingElement?.room ?? removingElement?.name ?? ''} off this job?`}
        message={
          removingElement && elementHoldsSomething(removingElement)
            ? `${describeWhatGoes(removingElement)} The room itself stays.`
            : 'Nothing is on it yet. The room itself stays.'
        }
        confirmLabel="Remove"
        confirmText={removingElement && elementHoldsSomething(removingElement) ? 'Delete' : undefined}
        destructive
        onCancel={() => setRemovingElement(null)}
        onConfirm={() => removingElement && removeElement(removingElement)}
      />

      <BuildUpSheet
        visible={buildUpFor !== null}
        quote={buildUpFor}
        lines={buildUpFor ? page.lines.filter((l) => l.quoteId === buildUpFor.id) : []}
        quotes={quotes}
        onClose={() => setBuildUpFor(null)}
        onAddLine={async (input) => {
          if (!buildUpFor) return;
          await addQuoteLine(buildUpFor.id, input);
          await changed('Added');
        }}
        onDeleteLine={async (lineId) => {
          await deleteQuoteLine(lineId);
          await changed('Removed');
        }}
      />

      <ScheduleSheet
        visible={scheduleFor !== null}
        quote={scheduleFor}
        milestones={scheduleFor ? page.milestones.filter((m) => m.quoteId === scheduleFor.id) : []}
        claimedIds={quotes.map((q) => q.settlesMilestoneId).filter((id): id is string => id !== null)}
        onClose={() => setScheduleFor(null)}
        onAdd={async (input) => {
          if (!scheduleFor) return;
          await addMilestone(scheduleFor.id, input);
          await changed('Added');
        }}
        onDelete={async (milestoneId) => {
          await deleteMilestone(milestoneId);
          await changed('Removed');
        }}
      />

      <ExpectedCostSheet
        visible={expectedOpen}
        elements={elements}
        showElements
        existing={editingExpected}
        lines={editingExpected ? page.expectedCostLines.filter((l) => l.expectedCostId === editingExpected.id) : []}
        householdId={household.id}
        onClose={() => { setExpectedOpen(false); setEditingExpected(null); }}
        onSave={async (input) => {
          if (editingExpected) await updateExpectedCost(editingExpected.id, input);
          else await createExpectedCost(project.id, input);
          await changed('Saved');
        }}
        onConfirm={async (confirmed) => {
          if (!editingExpected) return;
          await setExpectedCostConfirmed(editingExpected.id, confirmed);
          await changed(confirmed ? 'Agreed' : 'Back to undecided');
        }}
        onDelete={async () => {
          if (!editingExpected) return;
          await deleteExpectedCost(editingExpected.id);
          setExpectedOpen(false);
          setEditingExpected(null);
          await changed('Removed');
        }}
        onAddLine={async (input) => {
          if (!editingExpected) return;
          await addExpectedCostLine(editingExpected.id, input);
          await changed('Added');
        }}
        onUpdateLine={async (lineId, input) => {
          await updateExpectedCostLine(lineId, input);
          await changed('Saved');
        }}
        onDeleteLine={async (lineId) => {
          await deleteExpectedCostLine(lineId);
          await changed('Removed');
        }}
      />

      <ProjectStatusSheet
        visible={statusOpen}
        status={project.status}
        startedOn={project.startedOn}
        finishedOn={project.finishedOn}
        onClose={() => setStatusOpen(false)}
        onSave={async (update) => {
          await updateProject(project.id, update);
          await changed(
            update.status === project.status ? 'Saved'
              : update.status === 'done' ? 'Marked complete'
                : update.status === 'underway' ? 'Underway' : 'Back to planned',
          );
        }}
      />

      <SupplierSheet
        supplier={openSupplier}
        all={suppliers}
        money={money$}
        onClose={() => setSupplierOpen(null)}
        onRename={(from, to) => renameAcross(from, to, `Renamed on ${describeRenameReach(from)}`)}
        onMerge={(from, to) => { setSupplierOpen(null); setMerging({ from, to }); }}
      />

      <ConfirmDialog
        visible={merging !== null}
        title={merging ? `Merge “${merging.from.name}” into “${merging.to.name}”?` : ''}
        message={merging
          ? `${describeRenameReach(merging.from)} will be renamed “${merging.to.name}” on this job, so their bills, payments and files sit under one supplier. Agreed and To pay may change once they count as one.`
          : undefined}
        confirmLabel="Merge"
        onCancel={() => setMerging(null)}
        onConfirm={async () => {
          if (!merging) return;
          const { from, to } = merging;
          setMerging(null);
          try {
            await renameAcross(from, to.name, `Merged into ${to.name}`);
          } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'That didn’t merge');
          }
        }}
      />

      <EditBudgetSheet
        visible={budgetOpen}
        budget={project.budget}
        budgetInclGst={project.budgetInclGst}
        onClose={() => setBudgetOpen(false)}
        onSave={async (amount, amountInclGst) => {
          try {
            await updateProject(project.id, { budget: amount, budgetInclGst: amountInclGst });
            await changed(amount === null ? 'Budget cleared' : 'Saved');
          } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'That didn’t save');
          }
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

      <ExportSheet
        visible={showExport}
        what="this job"
        counts={{ view: project.itemCount, all: project.itemCount }}
        busy={exporting}
        onExport={handleExport}
        onCancel={() => setShowExport(false)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title={`Delete ${project.name}?`}
        message={`${project.itemCount === 1 ? '1 thing' : `${project.itemCount} things`}, ${
          project.fileCount === 1 ? '1 file' : `${project.fileCount} files`
        } and every quote and bill go with it. Jobs on the list and anything in the house record stay.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeProject}
      />

      <InvoiceReviewSheet
        visible={reviewSheetOpen}
        reviews={page.invoiceReviews}
        busyId={decidingId}
        onClose={() => setReviewSheetOpen(false)}
        onRestore={(review) => rule(review, () => restoreInvoiceReview(review.id), 'Back in the deck')}
        onDelete={(review) => rule(
          review,
          async () => {
            await deleteInvoiceReview(review.id);
            // An emailed bill brought its files with it, and nothing else points
            // at them until it is allocated — which a deleted card never will be.
            await deleteStoredFiles([...review.photoPaths, ...review.documentPaths]);
          },
          'Deleted',
        )}
      />
    </View>
  );
}

function SummaryLine({
  dot, label, value, tone,
}: {
  dot: string;
  label: string;
  value: string;
  tone?: RemainingTone;
}) {
  return (
    <View style={styles.summaryLine}>
      <View style={styles.summaryKey}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.summaryLineLabel}>{label}</Text>
      </View>
      <Text
        style={[
          styles.summaryLineValue,
          tone === 'good' && styles.good,
          tone === 'warn' && styles.warn,
          tone === 'danger' && styles.danger,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Whether taking this part off the job would destroy anything. Files count as
 * well as things — a part with a council letter on it is not empty.
 */
export function elementHoldsSomething(element: ProjectElement): boolean {
  return element.itemCount > 0 || element.photoPaths.length > 0 || element.documentPaths.length > 0;
}

/** What goes with a part of the job, in counts. */
export function describeWhatGoes(element: ProjectElement): string {
  const parts: string[] = [];
  if (element.itemCount > 0) parts.push(element.itemCount === 1 ? '1 thing and its prices' : `${element.itemCount} things and their prices`);
  const files = element.photoPaths.length + element.documentPaths.length;
  if (files > 0) parts.push(files === 1 ? '1 file' : `${files} files`);
  return parts.length ? `${parts.join(' and ')} go with it.` : '';
}

/**
 * A project's status in the palette's status hues, the same vocabulary a job's
 * `StatusBadge` speaks: planned is open (slate), underway is doing (brass),
 * complete is done (neutral — fern is not "done").
 */
const STATUS_TINT: Record<ProjectStatus, { backgroundColor: string }> = {
  planned: { backgroundColor: Colors.status.openBg },
  underway: { backgroundColor: Colors.status.doingBg },
  done: { backgroundColor: Colors.status.doneBg },
};
const STATUS_INK: Record<ProjectStatus, string> = {
  planned: Colors.status.openFg,
  underway: Colors.status.doingFg,
  done: Colors.status.doneFg,
};

const styles = StyleSheet.create({
  emailGroup: { gap: Spacing.sm + 2 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm, backgroundColor: Colors.background,
  },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH_TARGET, paddingRight: Spacing.md, paddingLeft: Spacing.xs },
  backLabel: { fontSize: Typography.body, color: Colors.primary },
  navRight: { flexDirection: 'row', alignItems: 'center' },
  addTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  addDisc: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl * 2, gap: Spacing.xxl + 4 },
  titleBlock: { gap: 4, paddingHorizontal: 4 },
  statusLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Spacing.md },
  // The pill is 30pt; the tap is the 48pt minimum, pulled back so the line
  // stays the caption's height rather than growing for the target.
  statusTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginVertical: -8 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 30,
    paddingLeft: Spacing.md, paddingRight: Spacing.sm + 2, borderRadius: Radius.pill,
  },
  statusLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold },
  summary: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingTop: Spacing.xl, paddingHorizontal: Spacing.lg + 2, paddingBottom: 4,
  },
  summaryLabel: { fontSize: Typography.subhead, color: Colors.textMuted },
  summaryFigure: {
    fontSize: 40, lineHeight: 48, fontWeight: Typography.bold, color: Colors.textPrimary,
    letterSpacing: -0.8, marginTop: 2, fontVariant: ['tabular-nums'],
  },
  bar: {
    flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden',
    backgroundColor: Colors.track, marginTop: Spacing.md + 2, marginBottom: Spacing.sm,
  },
  barAgreed: { backgroundColor: Colors.primary },
  barUndecided: { backgroundColor: Colors.undecided },
  summaryLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  summaryKey: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  summaryLineLabel: { fontSize: Typography.body, color: Colors.textPrimary },
  summaryLineValue: { fontSize: Typography.body, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  good: { color: Colors.primary, fontWeight: Typography.semibold },
  warn: { color: Colors.status.doing, fontWeight: Typography.semibold },
  danger: { color: Colors.danger, fontWeight: Typography.semibold },
  hairline: { height: 1, backgroundColor: Colors.separator },
  hairlineInset: { height: 1, backgroundColor: Colors.separator, marginLeft: 20 },
  budgetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  budgetLabel: { fontSize: Typography.body, color: Colors.textMuted, paddingLeft: 20 },
  budgetValue: { fontSize: Typography.body, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  link: { color: Colors.primary },
  tileStack: { gap: Spacing.md },
  tiles: { flexDirection: 'row', gap: Spacing.md },
  tile: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingVertical: Spacing.md + 2, paddingHorizontal: Spacing.lg, gap: 4,
  },
  // Not `flex: 0` — react-native-web writes that as a zero basis, and the
  // tile collapses round its label with the figure clipped to nothing.
  tileWide: {
    backgroundColor: Colors.surface, borderRadius: Radius.card,
    paddingVertical: Spacing.md + 2, paddingHorizontal: Spacing.lg, gap: 4,
  },
  tileLabel: { fontSize: Typography.subhead, color: Colors.textMuted },
  tileFacts: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted },
  tileFigure: {
    fontSize: Typography.title2, lineHeight: 28, fontWeight: Typography.semibold,
    color: Colors.textPrimary, letterSpacing: -0.3, fontVariant: ['tabular-nums'],
  },
  badgeSlot: { paddingLeft: Spacing.sm },
  docAdds: { paddingHorizontal: 4 },
});

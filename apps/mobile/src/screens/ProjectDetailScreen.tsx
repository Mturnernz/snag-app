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
import RecordBillSheet from '../components/RecordBillSheet';
import BuildUpSheet from '../components/BuildUpSheet';
import ExpectedCostSheet from '../components/ExpectedCostSheet';
import EditBudgetSheet from '../components/EditBudgetSheet';
import ScheduleSheet from '../components/ScheduleSheet';
import CommitmentCard from '../components/CommitmentCard';
import EditFigureSheet from '../components/EditFigureSheet';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import StatusBadge from '../components/StatusBadge';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { showAlert } from '../lib/alert';
import {
  addExpectedCostLine, addMilestone, addPayment, addQuoteLine, createElement, createExpectedCost,
  createItem,
  createLocation, createQuote, createThing, deleteElement,
  deleteExpectedCost, deleteExpectedCostLine, deleteItem, deleteMilestone, deletePayment,
  deleteProject, deleteQuote,
  deleteQuoteLine,
  clearFigure, setFigure, setItemExcluded,
  deleteStoredFiles, describeBudget, describeForecast, describeForecastVariance, describeOverrides,
  describePartsBudget, describeStillToBill, describeToPay, describeTotals, formatMoney, getProject,
  getProjectContents, getProjectFiles, getProjectThings, getSupplierTotals,
  getSnags, outstanding, setQuoteStatus, showsElements, updateElement, updateExpectedCost,
  updateExpectedCostLine, updateItem, updateProject, updateQuote,
} from '../lib/supabase';
import {
  documentName, exportDateStamp, formatLooseDate, inclGst, itemPriceLabel, projectDossierTable,
  projectExportPhotos, type ThingInput,
} from '@snag/supabase-queries';
import { getFileUrls } from '../lib/supabase';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import {
  Project, ProjectBill, ProjectElement, ProjectExpectedCost, ProjectExpectedCostLine, ProjectFigure,
  ProjectFile, ProjectItem,
  ProjectMilestone, ProjectPayment, ProjectQuote,
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
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const [expected, setExpected] = useState<ProjectExpectedCost[]>([]);
  const [expectedCostLines, setExpectedCostLines] = useState<ProjectExpectedCostLine[]>([]);
  const [bills, setBills] = useState<ProjectBill[]>([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [expectedOpen, setExpectedOpen] = useState(false);
  const [editingExpected, setEditingExpected] = useState<ProjectExpectedCost | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [buildUpFor, setBuildUpFor] = useState<ProjectQuote | null>(null);
  const [editingFigure, setEditingFigure] = useState<ProjectFigure | null>(null);
  const [scheduleFor, setScheduleFor] = useState<ProjectQuote | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [recorded, setRecorded] = useState<Thing[]>([]);
  const [busy, setBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  /**
   * The money and the scope — everything a price can change.
   *
   * Deliberately not the whole page: the punch list, the handover offer and
   * the file roll-up cannot move because somebody accepted a quote, and
   * re-reading them on every chip press is work nobody asked for. `load` is
   * still what a focus or a file change calls.
   */
  const reloadMoney = useCallback(async () => {
    try {
      const [loaded, contents, loadedSuppliers] = await Promise.all([
        getProject(projectId),
        getProjectContents(projectId),
        // Not fatal, the same rule as below.
        getSupplierTotals(projectId).catch(() => null),
      ]);
      setProject(loaded);
      setElements(contents.elements);
      setItems(contents.items);
      setQuotes(contents.quotes);
      setLines(contents.lines);
      setPayments(contents.payments);
      setMilestones(contents.milestones);
      setExpected(contents.expected);
      setExpectedCostLines(contents.expectedCostLines);
      setBills(contents.bills);
      if (loadedSuppliers) setSuppliers(loadedSuppliers);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't load that project");
    }
  }, [projectId]);

  /**
   * **One wave, not nine.** Every read here is independent of every other —
   * `getProjectContents` needs nothing from the suppliers rollup, the punch
   * list needs nothing from the files — so they are asked for together. They
   * used to be awaited one at a time, which cost nine sequential round trips
   * to Sydney before anything appeared.
   *
   * The three that are **not fatal** keep that property through
   * `allSettled` rather than through three `try` blocks in a row: the money
   * strip is the answer to this page's main question, and a rollup that will
   * not load must not take the page down — the same rule the thing page's
   * history card follows.
   */
  const load = useCallback(async () => {
    try {
      const [loaded, contents, loadedFiles, extras] = await Promise.all([
        getProject(projectId),
        getProjectContents(projectId),
        getProjectFiles(projectId),
        Promise.allSettled([
          getSupplierTotals(projectId),
          getProjectThings(projectId),
          getSnags({ projectId }),
        ]),
      ]);
      setProject(loaded);
      setElements(contents.elements);
      setItems(contents.items);
      setQuotes(contents.quotes);
      setLines(contents.lines);
      setPayments(contents.payments);
      setMilestones(contents.milestones);
      setExpected(contents.expected);
      setExpectedCostLines(contents.expectedCostLines);
      setBills(contents.bills);
      setFiles(loadedFiles);

      const [suppliersResult, thingsResult, snagsResult] = extras;
      setSuppliers(suppliersResult.status === 'fulfilled' ? suppliersResult.value : []);
      setRecorded(thingsResult.status === 'fulfilled' ? thingsResult.value : []);
      setSnags(snagsResult.status === 'fulfilled' ? snagsResult.value : []);
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
  const linesByExpectedCost = useMemo(() => {
    const map: Record<string, ProjectExpectedCostLine[]> = {};
    for (const line of expectedCostLines) (map[line.expectedCostId] ??= []).push(line);
    return map;
  }, [expectedCostLines]);
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
  const forecast = formatMoney(project.forecastTotal);
  const forecastLine = describeForecast(project);
  const varianceLine = describeForecastVariance(project);
  const toPayLine = describeToPay(project);
  const stillToBillLine = describeStillToBill(project);
  // Every figure somebody has typed over, and what the prices say instead. Both
  // numbers survive in the view, so this can go on naming the gap for as long as
  // the edit lasts rather than the screen quietly forgetting.
  const edits = describeOverrides(project);
  /** What the sheet needs to show for whichever figure is being edited. */
  const editing = editingFigure
    ? {
        derived: {
          forecast: project.forecastDerived,
          committed: project.committedDerived,
          invoiced: project.invoicedDerived,
          paid: project.paidDerived,
        }[editingFigure],
        override: {
          forecast: project.forecastOverride,
          committed: project.committedOverride,
          invoiced: project.invoicedOverride,
          paid: project.paidOverride,
        }[editingFigure],
        note: {
          forecast: project.forecastNote,
          committed: project.committedNote,
          invoiced: project.invoicedNote,
          paid: project.paidNote,
        }[editingFigure],
      }
    : null;
  const budget = formatMoney(inclGst(project.budget, project.budgetInclGst));
  const budgetLine = describeBudget(project);
  const partsLine = describePartsBudget(project);
  // Clay is the one hue on a household list that has earned red, and it is a
  // fact about a number rather than a judgement: this is over what you said you
  // would spend.
  //
  // Measured against **forecast** rather than committed, which is the change
  // that matters. Committed lags reality by everything nobody has priced yet,
  // so a page that only reddened on committed would stay calm right up until
  // the last quote landed — which is exactly what the live job did.
  const overBudget =
    project.budget !== null &&
    project.forecastTotal !== null &&
    project.forecastTotal > (inclGst(project.budget, project.budgetInclGst) ?? 0) + 0.005;
  const activeItem = items.find((item) => item.id === openItem) ?? null;
  /**
   * Prices that could be passed through — a sub's bill goes to whoever holds one.
   *
   * Signed quotes only: an unsigned one is not a contract anybody can bill
   * through, and offering it would invite somebody to route money through a
   * price that was never agreed.
   */
  const passThroughs = quotes.filter(
    (quote) => quote.kind === 'quote' && quote.status === 'accepted'
  );

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
        {/* ── the one thing people came to do ─────────────────────────
            A bill arrived; where does it go. The most frequent action on a
            live job, and until this rebuild the deepest buried — six levels
            down, and only if a scope item already existed to hang it on. It is
            the only filled button on the page. */}
        <Pressable
          onPress={() => setRecordOpen(true)}
          style={styles.record}
          accessibilityRole="button"
          accessibilityLabel="Record a bill or a quote"
        >
          <Icon name="add" size="md" color={Colors.white} />
          <Text style={styles.recordLabel}>Record a bill or a quote</Text>
        </Pressable>

        {/* ── the money ──────────────────────────────────────────────────
            Five figures now, and the new one is the answer to the question
            people actually open this page with.

            Committed answers *what have we agreed to*. Three months in with
            five items unpriced it is not the answer to *are we over*, and it
            fails in the direction that costs money: everything nobody has
            priced counts as nought, so the budget looks comfortable until the
            week it does not. Forecast adds the guesses — and says how much of
            itself is one.

            Stacked rather than columned, because a third of 390pt cannot hold
            "$192,354.22". The label holds a fixed column so the figures line
            up on their right edge, which is how money is read. */}
        <View style={styles.strip}>
          <Pressable
            onPress={() => setBudgetOpen(true)}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`Budget, ${budget ?? 'not set'}. Edit it.`}
          >
            <Text style={styles.rowKey} numberOfLines={1}>Budget</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{budget ?? 'Not set'}</Text>
          </Pressable>
          {/* Every one of the four is tappable, and an edited one renders in
              clay. That is the third thing in this app to earn red, after
              overdue and priority-high, and it earns it on the same terms: it
              is a fact about a number rather than a judgement — this figure is
              not what the paperwork says. */}
          <FigureRow
            label="Forecast"
            value={forecast}
            edited={project.forecastOverride !== null}
            lead
            over={overBudget}
            onPress={() => setEditingFigure('forecast')}
          />
          <View style={styles.stripRule} />
          <FigureRow
            label="Committed"
            value={committed}
            edited={project.committedOverride !== null}
            onPress={() => setEditingFigure('committed')}
          />
          {/* Charged and paid are different figures, and seven invoices with no
              payment recorded against them is the ordinary middle of a job. */}
          <FigureRow
            label="Invoiced"
            value={invoiced}
            edited={project.invoicedOverride !== null}
            onPress={() => setEditingFigure('invoiced')}
          />
          <FigureRow
            label="Paid"
            value={paid}
            edited={project.paidOverride !== null}
            last
            onPress={() => setEditingFigure('paid')}
          />
        </View>

        {/* The denominator, which no screen may render a forecast without. */}
        {forecastLine ? (
          <Text style={styles.denominator}>{forecastLine}</Text>
        ) : (
          <Text style={styles.denominator}>Nothing priced yet</Text>
        )}
        {/* Over budget, in words and with its cause. A percentage with no cause
            is a number people learn to ignore. Silent when under: this is a
            warning, not a running commentary. */}
        {varianceLine ? <Text style={styles.variance}>{varianceLine}</Text> : null}

        {/* ── what has been typed over ───────────────────────────────────
            Absent entirely when nothing has been edited, the same rule as the
            shopping pill at zero. Every line names **both** numbers, because
            the whole reason an override is honest rather than a lie is that
            the derived figure survives — a note saying only "this was edited"
            would throw away the half that makes it recoverable. */}
        {edits.length > 0 ? (
          <View style={styles.edits}>
            <View style={styles.editsHead}>
              <Icon name="create-outline" size="sm" color={Colors.danger} />
              <Text style={styles.editsTitle}>
                {edits.length === 1 ? 'A figure has been edited' : 'Figures have been edited'}
              </Text>
            </View>
            {edits.map((line) => (
              <Text key={line} style={styles.editsLine}>{line}</Text>
            ))}
          </View>
        ) : null}

        {budgetLine ? <Text style={styles.denominator}>{budgetLine}</Text> : null}
        {partsLine ? <Text style={styles.denominator}>{partsLine}</Text> : null}

        {/* ── the two gaps ───────────────────────────────────────────────
            They sound alike and they are different subtractions. Still to be
            billed is committed less invoiced — how much of what was agreed is
            still coming. To pay is invoiced less paid, and it is the only
            figure on this page that is about *today*, which is why it is the
            one with a date on it. */}
        {toPayLine || stillToBillLine ? (
          <View style={styles.gaps}>
            {toPayLine ? (
              <View style={styles.gapRow}>
                <Icon
                  name="wallet-outline"
                  size="sm"
                  color={project.overdueTotal > 0.005 ? Colors.danger : Colors.textMuted}
                />
                <Text
                  style={[styles.gapText, project.overdueTotal > 0.005 && styles.gapOverdue]}
                >
                  {toPayLine}
                </Text>
              </View>
            ) : null}
            {stillToBillLine ? (
              <View style={styles.gapRow}>
                <Icon name="document-text-outline" size="sm" color={Colors.textMuted} />
                <Text style={styles.gapText}>{stillToBillLine}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.gstNote}>Every figure here is GST-inclusive.</Text>

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

        {/* ── who we're paying ───────────────────────────────────────────
            The section that did not exist, and whose absence bent the live job
            out of shape: money arrives by vendor and contract, scope is by
            room, and with nowhere to put a contract somebody invented a part
            called "Whole job" to hold five supplier accounts.

            Second on the page rather than sixth, because this is where a
            contract gets *Signed* — the control whose depth and wording left a
            $176,755 contract sitting unsigned for five months while the page
            reported $89,000 of headroom that did not exist.

            Absent entirely when nobody is owed anything, the same rule as the
            shopping pill at zero. The check worth keeping: these rows sum to
            Committed above. */}
        {suppliers.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>Who we&rsquo;re paying</Text>
              <View style={styles.rule} />
            </View>
            {suppliers
              .slice()
              .sort((a, b) => (b.committed ?? 0) - (a.committed ?? 0))
              .map((supplier) => (
                <CommitmentCard
                  key={supplier.supplierKey}
                  supplier={supplier}
                  prices={quotes.filter(
                    (quote) =>
                      (quote.supplier ?? '').trim().toLowerCase() === supplier.supplierKey &&
                      quote.billedThroughId === null
                  )}
                  milestones={milestones}
                  bills={bills}
                  onSign={async (quoteId, status) => {
                    await setQuoteStatus(quoteId, status);
                    showToast(PROJECT_QUOTE_STATUS_LABELS[status]);
                    // Signing moves Committed, Forecast and both gaps at three
                    // levels at once, and every one of them is derived.
                    await load();
                  }}
                  onOpenBuildUp={setBuildUpFor}
                  onOpenSchedule={setScheduleFor}
                  onOpenPrice={(quote) => {
                    if (quote.itemId) setOpenItem(quote.itemId);
                  }}
                />
              ))}
          </>
        ) : null}

        {/* ── what else is coming ────────────────────────────────────────
            Costs somebody has been warned about that nobody has quoted. The
            beat the money model could not hold, and the reason Forecast can be
            honest before the quotes land.

            They are never committed and never invoiced — every figure they
            touch names them as a guess. */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>Also expecting</Text>
          <View style={styles.rule} />
          <Pressable
            onPress={() => {
              setEditingExpected(null);
              setExpectedOpen(true);
            }}
            style={styles.plusTap}
            accessibilityRole="button"
            accessibilityLabel="Add something you're expecting"
          >
            <Icon name="add" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>
        {expected.filter((cost) => cost.settledBy === null).length === 0 ? (
          <Text style={styles.hint}>
            Nothing yet. The engineer the architect mentioned, the council&rsquo;s share — a
            figure nobody has quoted still belongs in the forecast.
          </Text>
        ) : (
          expected
            .filter((cost) => cost.settledBy === null)
            .map((cost) => (
              <View key={cost.id} style={styles.expected}>
                {/* Opens it for editing. Sibling of the × below, never
                    nested in it — the same rule every other row in this app
                    follows for two controls that do different things. */}
                <Pressable
                  onPress={() => {
                    setEditingExpected(cost);
                    setExpectedOpen(true);
                  }}
                  style={styles.expectedTap}
                  accessibilityRole="button"
                  accessibilityLabel={`${cost.name}, edit it`}
                >
                  <View style={styles.expectedTitles}>
                    <Text style={styles.expectedName}>{cost.name}</Text>
                    <Text style={styles.expectedSub} numberOfLines={1}>
                      {[
                        cost.likelySupplier,
                        elements.find((e) => e.id === cost.elementId)?.name,
                        'nobody has quoted this',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.expectedAmount} numberOfLines={1}>
                    {formatMoney(inclGst(cost.amount, cost.amountInclGst)) ?? 'no figure'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await deleteExpectedCost(cost.id);
                    showToast('Removed');
                    await load();
                  }}
                  style={styles.expectedRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${cost.name}`}
                >
                  <Icon name="close" size="sm" color={Colors.textMuted} />
                </Pressable>
              </View>
            ))
        )}

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
                      <View key={item.id} style={styles.itemRow}>
                        <Pressable
                          onPress={() => setOpenItem(item.id)}
                          style={styles.item}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.name}${item.excluded ? ', excluded from the price build' : ''}`}
                        >
                          <View style={styles.itemTitles}>
                            <Text
                              style={[styles.itemName, item.excluded && styles.itemExcludedText]}
                              numberOfLines={1}
                            >
                              {item.name}
                            </Text>
                            <Text
                              style={[styles.itemSub, item.excluded && styles.itemExcludedText]}
                              numberOfLines={1}
                            >
                              {item.excluded
                                ? 'Excluded from the price build'
                                : itemQuotes.length === 0
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
                              item.excluded && styles.itemExcludedText,
                            ]}
                            numberOfLines={1}
                          >
                            {price.text}
                          </Text>
                        </Pressable>
                        {/* Sibling of the row's own Pressable, never nested in
                            it — the same rule that keeps opening and removing
                            a photo apart, because one Pressable inside another
                            is a coin toss about which one gets the tap. */}
                        <Pressable
                          onPress={async () => {
                            // Shown now, written after, put back if the write
                            // fails. The round trip and the refresh that
                            // follows it are around half a second; a toggle
                            // that waits for them reads as a toggle that did
                            // not register, and gets pressed again.
                            const next = !item.excluded;
                            const before = items;
                            setItems((rows) => rows.map(
                              (row) => (row.id === item.id ? { ...row, excluded: next } : row)
                            ));
                            try {
                              await setItemExcluded(item.id, next);
                              await reloadMoney();
                            } catch (err: unknown) {
                              setItems(before);
                              showToast(err instanceof Error ? err.message : "That didn’t save");
                            }
                          }}
                          style={[styles.includeToggle, item.excluded && styles.includeToggleOff]}
                          accessibilityRole="button"
                          accessibilityLabel={
                            item.excluded
                              ? `Include ${item.name} in the price build`
                              : `Exclude ${item.name} from the price build`
                          }
                        >
                          <Text
                            style={[
                              styles.includeToggleLabel,
                              item.excluded && styles.includeToggleLabelOff,
                            ]}
                          >
                            {item.excluded ? 'Excluded' : 'Included'}
                          </Text>
                        </Pressable>
                      </View>
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
        payments={
          activeItem
            ? (quotesByItem[activeItem.id] ?? []).flatMap((quote) => paymentsByQuote[quote.id] ?? [])
            : []
        }
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
          // The header's Quote/Invoiced toggle comes through here, so the
          // change shows before the round trip. `kind` is a plain column, so
          // patching it locally cannot disagree with what comes back.
          const before = quotes;
          setQuotes((rows) => rows.map(
            (row) => (row.id === quoteId ? { ...row, ...update } : row)
          ));
          try {
            await updateQuote(quoteId, update);
            showToast('Saved');
            // Re-read, because a corrected amount moves Committed, Invoiced
            // and Paid at three levels at once, all of them derived in a view.
            await reloadMoney();
          } catch (err: unknown) {
            setQuotes(before);
            showToast(err instanceof Error ? err.message : "That didn’t save");
          }
        }}
        onSetQuoteStatus={async (quoteId: string, status: ProjectQuoteStatus) => {
          const before = quotes;
          setQuotes((rows) => rows.map(
            (row) => (row.id === quoteId ? { ...row, status } : row)
          ));
          try {
            await setQuoteStatus(quoteId, status);
            showToast(PROJECT_QUOTE_STATUS_LABELS[status]);
            // Re-read: accepting moves Committed and the two gaps at three
            // levels at once, and every one of them is derived in a view.
            await reloadMoney();
          } catch (err: unknown) {
            setQuotes(before);
            showToast(err instanceof Error ? err.message : "That didn’t save");
          }
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
        onAddPayment={async (quoteId, amount) => {
          // `unpaid` is derived in the view, so it is patched here to what the
          // view will say rather than left stale: paying what is outstanding
          // leaves nothing outstanding. The re-read that follows is what makes
          // it true rather than merely claimed.
          const before = quotes;
          setQuotes((rows) => rows.map(
            (row) => (row.id === quoteId ? { ...row, unpaid: 0 } : row)
          ));
          try {
            await addPayment(quoteId, { amount, amountInclGst: true });
            showToast('Paid');
            await reloadMoney();
          } catch (err: unknown) {
            setQuotes(before);
            showToast(err instanceof Error ? err.message : "That didn’t save");
          }
        }}
        onDeletePayment={async (paymentId) => {
          const before = quotes;
          const beforePayments = payments;
          const quoteId = payments.find((payment) => payment.id === paymentId)?.quoteId;
          setPayments((rows) => rows.filter((row) => row.id !== paymentId));
          if (quoteId) {
            setQuotes((rows) => rows.map((row) => (
              row.id === quoteId
                ? { ...row, unpaid: inclGst(row.amount, row.amountInclGst) ?? 0 }
                : row
            )));
          }
          try {
            await deletePayment(paymentId);
            showToast('Not paid');
            await reloadMoney();
          } catch (err: unknown) {
            setQuotes(before);
            setPayments(beforePayments);
            showToast(err instanceof Error ? err.message : "That didn’t save");
          }
        }}
        onRecordAsThing={() => {
          setThingFor(activeItem);
          setOpenItem(null);
        }}
      />

      {/* The one primary action. It never creates scope: a bill maps to
          something that exists, or it is a cost against the job as a whole. */}
      <RecordBillSheet
        visible={recordOpen}
        elements={elements}
        items={items}
        contracts={passThroughs}
        projectId={project.id}
        showElements={drawElements}
        onClose={() => setRecordOpen(false)}
        onSave={async (input) => {
          await createQuote(input);
          showToast('Saved');
          await load();
        }}
      />

      <ExpectedCostSheet
        visible={expectedOpen}
        elements={elements}
        showElements={drawElements}
        existing={editingExpected}
        lines={editingExpected ? linesByExpectedCost[editingExpected.id] ?? [] : []}
        householdId={household.id}
        onClose={() => {
          setExpectedOpen(false);
          setEditingExpected(null);
        }}
        onSave={async (input) => {
          if (editingExpected) {
            await updateExpectedCost(editingExpected.id, input);
            showToast('Saved');
          } else {
            await createExpectedCost(project.id, input);
            showToast('Added to the forecast');
          }
          await reloadMoney();
        }}
        onDelete={async () => {
          if (!editingExpected) return;
          await deleteExpectedCost(editingExpected.id);
          showToast('Removed');
          setExpectedOpen(false);
          setEditingExpected(null);
          await reloadMoney();
        }}
        onAddLine={async (input) => {
          if (!editingExpected) return;
          await addExpectedCostLine(editingExpected.id, input);
          showToast('Added');
          await reloadMoney();
        }}
        onUpdateLine={async (lineId, input) => {
          await updateExpectedCostLine(lineId, input);
          showToast('Saved');
          await reloadMoney();
        }}
        onDeleteLine={async (lineId) => {
          await deleteExpectedCostLine(lineId);
          showToast('Removed');
          await reloadMoney();
        }}
      />

      {/* What a builder's number is actually made of — and the screen without
          which the provisional-sum rule was correct but unreachable. */}
      <BuildUpSheet
        visible={buildUpFor !== null}
        quote={buildUpFor}
        lines={buildUpFor ? linesByQuote[buildUpFor.id] ?? [] : []}
        quotes={quotes}
        onClose={() => setBuildUpFor(null)}
        onAddLine={async (input) => {
          if (!buildUpFor) return;
          await addQuoteLine(buildUpFor.id, input);
          showToast('Added');
          await reloadMoney();
        }}
        onDeleteLine={async (lineId) => {
          await deleteQuoteLine(lineId);
          showToast('Removed');
          await reloadMoney();
        }}
      />

      <ScheduleSheet
        visible={scheduleFor !== null}
        quote={scheduleFor}
        milestones={scheduleFor ? milestones.filter((m) => m.quoteId === scheduleFor.id) : []}
        claimedIds={quotes
          .map((quote) => quote.settlesMilestoneId)
          .filter((id): id is string => id !== null)}
        onClose={() => setScheduleFor(null)}
        onAdd={async (input) => {
          if (!scheduleFor) return;
          await addMilestone(scheduleFor.id, input);
          showToast('Added');
          await reloadMoney();
        }}
        onDelete={async (milestoneId) => {
          await deleteMilestone(milestoneId);
          showToast('Removed');
          await reloadMoney();
        }}
      />

      <EditFigureSheet
        visible={editingFigure !== null}
        field={editingFigure}
        derived={editing?.derived ?? null}
        override={editing?.override ?? null}
        note={editing?.note ?? null}
        onClose={() => setEditingFigure(null)}
        onSave={async (amount, amountInclGst, note) => {
          if (!editingFigure) return;
          await setFigure(project.id, editingFigure, { amount, amountInclGst, note });
          showToast('Edited');
          await reloadMoney();
        }}
        onClear={async () => {
          if (!editingFigure) return;
          await clearFigure(project.id, editingFigure);
          showToast('Back to the prices');
          await reloadMoney();
        }}
      />

      <EditBudgetSheet
        visible={budgetOpen}
        budget={project.budget}
        budgetInclGst={project.budgetInclGst}
        onClose={() => setBudgetOpen(false)}
        onSave={async (amount, amountInclGst) => {
          await patchProject(
            { budget: amount, budgetInclGst: amountInclGst },
            amount === null ? 'Budget cleared' : 'Saved'
          );
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
 * One line of the money strip: a label, a figure, and a way to type over it.
 *
 * **The whole row is the tap target**, not a pencil beside it. There are four of
 * them stacked at 48px each and a separate affordance per row would be four more
 * controls on the densest part of the page — where the label already says which
 * figure is which, the row *is* the label.
 *
 * `edited` is what spends the clay. It is deliberately independent of `over`:
 * a figure can be both typed over and above budget, and the edit is the more
 * surprising of the two, so it wins the colour.
 */
function FigureRow({
  label, value, edited, onPress, lead, last, over,
}: {
  label: string;
  value: string | null;
  edited: boolean;
  onPress: () => void;
  lead?: boolean;
  last?: boolean;
  over?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, last && styles.rowLast]}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value ?? 'nothing yet'}${edited ? ', edited' : ''}. Edit it.`}
    >
      <Text style={[styles.rowKey, lead && styles.rowKeyLead]} numberOfLines={1}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          lead && styles.rowValueLead,
          over && !edited && styles.rowValueOver,
          edited && styles.rowValueEdited,
        ]}
        numberOfLines={1}
      >
        {value ?? '—'}
      </Text>
      {edited ? (
        <Icon name="create-outline" size="sm" color={Colors.danger} />
      ) : null}
    </Pressable>
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
  // Wide enough for "COMMITTED" and "FORECAST" — the two longest labels here —
  // to sit on one line at this size and letter-spacing. 58px wrapped both of
  // them; measured rather than guessed, with a few px of headroom.
  rowKey: {
    width: 84,
    flexShrink: 0,
    fontSize: Typography.xs,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // Right-aligned so the three figures share an edge; `minWidth: 0` because a
  // flexed Text around a long unbroken string will otherwise refuse to shrink.
  //
  // `minWidth` on the figure itself is sized for the schema's own ceiling
  // instead of guessed: `project_overrides.amount` is `numeric(12,2)` capped
  // at 99,999,999, which is the most `formatMoney` can ever produce — 8 whole
  // digits and 2 decimal digits, 10 in total. Reserving that width up front
  // means the column never has to make room *after* somebody types a bigger
  // figure, which is the one moment a jumping label would be most confusing.
  rowValue: {
    flex: 1,
    minWidth: 108,
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
  // Forecast leads: it is the figure the page is opened to read, and the one
  // that answers "are we over". Committed sits underneath as its evidence.
  rowKeyLead: { color: Colors.textSecondary, fontWeight: Typography.semibold },
  // Forecast's font is a size up from the other three, so the same 10-digit
  // reservation needs a bit more room at this size or it would be the one row
  // still tight enough to nudge the label.
  rowValueLead: { fontSize: Typography.lg, color: Colors.textPrimary, minWidth: 128 },
  rowValueOver: { color: Colors.danger },
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  item: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  itemTitles: { flex: 1, minWidth: 0 },
  itemName: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  itemSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  // `flexShrink: 0` so the name gives way before the price does: the figure is
  // what the row is read for, and half a number is worse than a clipped noun.
  itemPrice: { flexShrink: 0, fontFamily: Fonts.mono, fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  itemPriceRange: { color: Colors.status.doing, fontWeight: Typography.regular, fontSize: Typography.xs },
  itemPriceNone: { color: Colors.textMuted, fontWeight: Typography.regular, fontSize: Typography.xs },
  // Decided against, without deleting it. Greyed rather than struck through —
  // this is not done, it is simply not counted, and strike-through is the
  // finished-job mark elsewhere in this app.
  itemExcludedText: { color: Colors.textMuted, fontWeight: Typography.regular },
  // The sunken-well-off / solid-fern-on shape every chip row in this app uses,
  // reversed: excluded is the state that reads as "off" here, so it stays the
  // sunken well and Included takes the fern.
  includeToggle: {
    flexShrink: 0,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  includeToggleOff: { backgroundColor: Colors.sunken },
  includeToggleLabel: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.white },
  includeToggleLabelOff: { color: Colors.textMuted },

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

  // The one filled button on the page, because it is the one thing people came
  // to do. Everything else here writes on press or opens a sheet.
  record: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, marginBottom: Spacing.lg,
  },
  recordLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },

  variance: { fontSize: Typography.sm, color: Colors.danger, marginTop: Spacing.sm },

  // An edited figure is the third thing in this app to earn clay, after overdue
  // and priority-high, and on the same terms: a fact about a number, not a
  // judgement. This figure is not what the paperwork says.
  rowValueEdited: { color: Colors.danger },
  edits: {
    backgroundColor: Colors.due.overdueBg, borderRadius: Radius.card,
    padding: Spacing.md, marginTop: Spacing.md, gap: Spacing.xs,
  },
  editsHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  editsTitle: {
    fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.danger,
  },
  editsLine: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  gaps: { marginTop: Spacing.md, gap: Spacing.xs },
  gapRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gapText: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textSecondary },
  gapOverdue: { color: Colors.danger, fontWeight: Typography.medium },

  expected: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  expectedTap: {
    flex: 1, minWidth: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm, minHeight: MIN_TOUCH_TARGET,
  },
  expectedTitles: { flex: 1, minWidth: 0 },
  expectedName: { fontSize: Typography.base, color: Colors.textPrimary },
  expectedSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  expectedAmount: {
    fontSize: Typography.sm, fontFamily: Fonts.mono, color: Colors.textMuted,
    marginLeft: Spacing.sm,
  },
  expectedRemove: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
  remove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginTop: Spacing.xxl },
  removeLabel: { fontSize: Typography.sm, color: Colors.danger },
});

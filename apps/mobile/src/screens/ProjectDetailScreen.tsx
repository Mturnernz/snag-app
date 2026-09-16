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
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import StatusBadge from '../components/StatusBadge';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { showAlert } from '../lib/alert';
import {
  createElement, createItem, createQuote, createThing, deleteItem, deleteProject, deleteQuote,
  deleteStoredFiles, describeTotals, formatMoney, getProject, getProjectContents, getProjectFiles,
  getSnags, rangeLabel, setQuoteChosen, showsElements, updateElement, updateItem, updateProject,
  updateQuote,
} from '../lib/supabase';
import {
  documentName, exportDateStamp, formatLooseDate, itemPriceLabel, projectDossierTable,
  projectExportPhotos, type ThingInput,
} from '@snag/supabase-queries';
import { getFileUrls } from '../lib/supabase';
import { loadExportImages, writeExport, type ExportFormat } from '../lib/exportFile';
import {
  Project, ProjectElement, ProjectFile, ProjectItem, ProjectQuote, ProjectStatus,
  PROJECT_FILE_LEVEL_LABELS, PROJECT_STATUS_LABELS, RootStackParamList, Snag,
} from '../types';

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
  const { household, locations } = useHousehold();
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
  const [elementDraft, setElementDraft] = useState('');
  const [addingElement, setAddingElement] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [thingFor, setThingFor] = useState<ProjectItem | null>(null);
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
      setFiles(loadedFiles);
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
    for (const quote of quotes) (map[quote.itemId] ??= []).push(quote);
    return map;
  }, [quotes]);

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

  async function addElement() {
    const name = elementDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await createElement(projectId, name, locations.some((l) => l.name === name) ? name : null);
      setElementDraft('');
      setAddingElement(false);
      await load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Couldn't add that");
    } finally {
      setBusy(false);
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
      await createThing({ ...input, propertyId: project.propertyId, projectId: project.id });
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

  const spent = formatMoney(project.spentTotal);
  const chosen = formatMoney(project.chosenTotal);
  const range = rangeLabel(project);
  const denominator = describeTotals(project);
  const budget = formatMoney(project.budget);
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
            Three figures, never one, and never without the line beneath. */}
        <View style={styles.strip}>
          <View style={styles.cell}>
            <Text style={styles.cellKey}>Quoted</Text>
            <Text style={styles.cellValue}>{range ?? '—'}</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellKey}>Chosen</Text>
            <Text style={styles.cellValue}>{chosen ?? '—'}</Text>
          </View>
          <View style={[styles.cell, styles.cellLast]}>
            <Text style={styles.cellKey}>Spent</Text>
            <Text style={[styles.cellValue, spent ? styles.cellValueSpent : null]}>
              {spent ?? '—'}
            </Text>
          </View>
        </View>
        {denominator ? (
          <Text style={styles.denominator}>
            {denominator}
            {budget ? ` · budget ${budget}${project.budgetInclGst ? '' : ' excl GST'}` : ''}
          </Text>
        ) : (
          <Text style={styles.denominator}>
            Nothing priced yet{budget ? ` · budget ${budget}` : ''}
          </Text>
        )}
        <Text style={styles.gstNote}>Every figure here is GST-inclusive.</Text>

        {/* ── what it takes ──────────────────────────────────────────────
            One element and it is implicit: the items hang straight off the
            project and the word "part" is never said. Two and the layer is
            real, because somebody made it real. */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>{drawElements ? 'Parts of the job' : 'What it takes'}</Text>
          <View style={styles.rule} />
          <Pressable
            onPress={() => setAddingElement((open) => !open)}
            style={styles.plusTap}
            accessibilityRole="button"
            accessibilityLabel="Add a part of the job"
          >
            <Icon name={addingElement ? 'close' : 'add'} size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        {addingElement ? (
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={elementDraft}
              onChangeText={setElementDraft}
              placeholder="Bathroom renovation"
              placeholderTextColor={Colors.textMuted}
              onSubmitEditing={addElement}
              returnKeyType="done"
              autoFocus
              accessibilityLabel="Name this part of the job"
            />
            <Pressable
              onPress={addElement}
              disabled={!elementDraft.trim()}
              style={styles.addGo}
              accessibilityRole="button"
              accessibilityLabel="Add it"
            >
              <Icon
                name="checkmark"
                size="md"
                color={elementDraft.trim() ? Colors.primary : Colors.textMuted}
              />
            </Pressable>
          </View>
        ) : null}

        {elements.map((element) => {
          const elementItems = itemsByElement[element.id] ?? [];
          const open = !drawElements || openElement === element.id;

          return (
            <View key={element.id} style={[styles.element, drawElements && styles.elementCard]}>
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
                        <View style={[styles.tick, item.chosenAmount !== null && styles.tickOn]}>
                          {item.chosenAmount !== null ? (
                            <Icon name="checkmark" size="sm" color={Colors.white} />
                          ) : null}
                        </View>
                        <View style={styles.itemTitles}>
                          <Text style={styles.itemName}>{item.name}</Text>
                          <Text style={styles.itemSub} numberOfLines={1}>
                            {itemQuotes.length === 0
                              ? 'Nobody asked yet'
                              : item.chosenAmount !== null
                                ? [
                                    itemQuotes.find((q) => q.chosen)?.supplier,
                                    item.spent !== null ? 'paid' : 'chosen',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')
                                : `${itemQuotes.length} ${itemQuotes.length === 1 ? 'quote' : 'quotes'} · none chosen`}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.itemPrice,
                            price.state === 'range' && styles.itemPriceRange,
                            price.state === 'none' && styles.itemPriceNone,
                          ]}
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
                        {formatMoney(element.chosenTotal) ?? rangeLabel(element) ?? '—'} chosen
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
                    {formatMoney(element.chosenTotal) ?? rangeLabel(element) ?? '—'} chosen
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

        {/* ── what it left behind ────────────────────────────────────────
            The payoff, and the reason to keep the record at all: three years
            on, the question is the model number and the warranty, not the
            cost. */}
        {project.thingCount > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>What it left behind</Text>
              <View style={styles.rule} />
            </View>
            <Text style={styles.hint}>
              {project.thingCount === 1
                ? '1 thing in the house record came from this project.'
                : `${project.thingCount} things in the house record came from this project.`}
            </Text>
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
        onChooseQuote={async (quoteId, chosen) => {
          await setQuoteChosen(quoteId, chosen);
          showToast(chosen ? 'Chosen' : 'Unchosen');
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
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  cell: { flex: 1, minWidth: 0, padding: Spacing.md, borderRightWidth: 1, borderRightColor: Colors.border },
  cellLast: { borderRightWidth: 0 },
  cellKey: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  cellValue: {
    fontFamily: Fonts.mono,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  cellValueSpent: { color: Colors.primary },
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
  elementHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, minHeight: MIN_TOUCH_TARGET },
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
  itemPrice: { fontFamily: Fonts.mono, fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
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

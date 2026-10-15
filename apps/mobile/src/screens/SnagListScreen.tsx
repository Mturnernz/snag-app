import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  SectionList,
  ScrollView,
  RefreshControl,
  Pressable,
  StyleSheet,
  BackHandler,
  Linking,
  Platform,
} from 'react-native';
import { Text, TextInput } from '../components/Text';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import SnagCard from '../components/SnagCard';
import PhotoCard from '../components/PhotoCard';
import { useDockClearance } from '../navigation/Dock';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { fileCapturedPhoto } from '../components/ComposeBar';
import CaptureSheet from '../components/CaptureSheet';
import Fab from '../components/Fab';
import ExportFooter from '../components/ExportFooter';
import ExportSheet, { type ExportScope } from '../components/ExportSheet';
import ShareJobsSheet, { type ShareNotes } from '../components/ShareJobsSheet';
import StickyActionBar from '../components/StickyActionBar';
import Button from '../components/Button';
import AmendSnagSheet from '../components/AmendSnagSheet';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useCreateRoom } from '../hooks/useCreateRoom';
import { useFirstCapture } from '../hooks/useFirstCapture';
import { useOnReturn } from '../hooks/useOnReturn';
import {
  createSnag, getComments, getFileUrls, getNotesSince, getSnags, getThings, markListSeen, setPartBought,
  setSnagStatus, updateSnag,
} from '../lib/supabase';
import { canShareFiles, shareFile } from '../lib/share';
import { saveFile } from '../lib/download';
import { showAlert } from '../lib/alert';
import { failureReason } from '../lib/deadline';
import { takePhoto } from '../lib/photoUpload';
import { readCollapsed, writeCollapsed } from '../lib/collapsed';
import { isForeground, NEW_VISIT_MS, RETURN_RELOAD_MS } from '../lib/foreground';
import FoldAllPill from '../components/FoldAllPill';
import InstallCard from '../components/InstallCard';
import HomePickerSheet from '../components/HomePickerSheet';
import {
  dueState, exportDateStamp, exportFileName, isDoneForNow, placeTitle, quoteBrief, searchSnags,
  shoppingCount, shoppingList, snagExportPhotos, snagExportTable, snagHeadline, snagQuoteTable,
  snagsWithNewNotes, type NoteStamp,
} from '@snag/supabase-queries';
import { loadExportImages, renderPdf, writeExport, type ExportFormat } from '../lib/exportFile';
import { RootStackParamList, Snag, Thing } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The list, and the app's home.
 *
 * There is no Add tab any more. Capture is the bar at the foot of this screen,
 * because capture was never a destination — it was a form that needed one — and
 * the cost of that arrangement was that the app opened on a form instead of on
 * what the other person had added.
 *
 * Which is the other half of the change. This product has no notifications and
 * deliberately never will (two people in one house do not need an email per
 * snag). So **this screen is the only channel by which one person finds out
 * what the other did**, and the first thing it says is what has arrived since
 * you last looked.
 *
 * Three consequences worth keeping:
 *
 * - **New is what someone *else* added since your last visit.** Your own
 *   entries are never news to you, and `mark_list_seen` returns the previous
 *   stamp rather than reading it separately, so the section can't empty itself
 *   out while you are reading it.
 * - **The rest groups by room**, which is how the work gets batched — you do
 *   the garage once — and which retires the twelve-chip room rail: you can see
 *   there are three things in the Garage without asking a filter.
 * - **Done leaves.** One muted line at the foot rather than a lens to select.
 *   Finishing something should make the list shorter; that is the whole reward
 *   the product has to offer.
 */

/**
 * Everything, or the jobs waiting on a trip to the shop — and the cart in the
 * header is the only way between them.
 *
 * There used to be a *Show me* button beside it opening a sheet with two lenses
 * and three sorts. The *Needs parts* lens was the cart again by another door;
 * *Due* is answered by the **Due soon** section now, without asking; *Newest*
 * by **New** and **Just added**. What was left was a button that opened a sheet
 * to confirm the default, so it went.
 */
type Lens = 'all' | 'parts';

const NO_ROOM = 'Everywhere else';
const DONE_WINDOW_DAYS = 7;
/** How long the last capture's room is offered to the next one. */
const ROOM_MEMORY_MS = 10 * 60_000;
/**
 * How often the list reads itself again while it is on screen.
 *
 * Pull-to-refresh does nothing on the web build — react-native-web's
 * `RefreshControl` is a plain `View` — so somebody looking at the list had no
 * way to see a job the other person added a minute ago short of switching tabs.
 * Every two minutes, only while this tab is showing and the app is in front,
 * costs two small reads; the photos' links are reused rather than re-signed
 * (`lib/signedUrls.ts`), so nothing is downloaded again.
 */
const LIST_REFRESH_MS = 2 * 60_000;

/** "since Tuesday" for this week, a date once it stops being this week. */
function describeSince(iso: string | null): string | null {
  if (!iso) return null;
  const seen = new Date(iso);
  const days = Math.floor((Date.now() - seen.getTime()) / 86_400_000);
  if (days < 1) return 'since earlier today';
  if (days < 7) return `since ${seen.toLocaleDateString(undefined, { weekday: 'long' })}`;
  return `since ${seen.toLocaleDateString()}`;
}

/** "2 added and 1 new note since Tuesday" — what the news is, in words. */
function describeNews(jobs: number, notes: number, since: string | null): string | null {
  if (!since || (jobs === 0 && notes === 0)) return null;
  const parts = [
    jobs > 0 ? `${jobs} added` : null,
    notes > 0 ? `${notes} new ${notes === 1 ? 'note' : 'notes'}` : null,
  ].filter(Boolean);
  return `${parts.join(' and ')} ${since}`;
}

export default function SnagListScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useEdgeInsets();
  const {
    household, profile, properties, activeProperty, locations,
  } = useHousehold();
  const { showToast } = useToast();
  const createRoom = useCreateRoom();

  /**
   * Which sections are folded away, by key.
   *
   * Read once on mount and written on every change. Opens expanded whatever
   * happens — a storage read that fails, or a first run — because the first
   * thing this screen has to say is what the other person added, and a list
   * that opens folded says nothing at all until somebody unfolds it.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [lens, setLens] = useState<Lens>('all');
  const [placesOpen, setPlacesOpen] = useState(false);

  const [snags, setSnags] = useState<Snag[]>([]);
  const [done, setDone] = useState<Snag[]>([]);
  const [exporting, setExporting] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * What the search box holds. Run on the lists already in hand — open and
   * finished — never the server, for the House tab's reason: the moment
   * somebody is looking for a job is not the moment to wait on a round trip.
   */
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  /** Notes written since the last visit, for *New*. See `getNotesSince`. */
  const [notes, setNotes] = useState<NoteStamp[]>([]);
  const clearance = useDockClearance();

  /** Where the "New" rule sits. Captured once per visit, not per render. */
  const [seenBefore, setSeenBefore] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Snag | null>(null);
  /** The +'s sheet: Take photo, or Continue without picture. */
  const [capturing, setCapturing] = useState(false);
  /**
   * Jobs chosen to share, by id — null while nobody is choosing. A long press
   * on a card starts it; a reload or Cancel ends it, because a choice made of
   * jobs that are no longer on screen is not a choice anybody can see.
   */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selecting = selected !== null;
  const [sharing, setSharing] = useState(false);
  const [shareNotes, setShareNotes] = useState<ShareNotes>('out');
  const [shareState, setShareState] = useState<'preparing' | 'ready' | 'failed'>('preparing');
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharePdf, setSharePdf] = useState<{ bytes: Uint8Array; fileName: string; photoCount: number } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  /** Bumped per build, so a slower build for the other notes answer cannot land last. */
  const shareSeq = useRef(0);
  const [amending, setAmending] = useState(false);
  /**
   * The house record, for the amend sheet's "is it about one of these?" step.
   *
   * **Fetched when a snag is filed, not when the list loads.** The list is the
   * screen people open constantly and this serves a sheet that only appears
   * after capture, so putting it in `load()` would spend a request on every
   * pull-to-refresh to answer a question nobody asked. Keyed by property, so
   * moving between the house and the bach re-reads rather than offering the
   * wrong place's appliances.
   */
  const [things, setThings] = useState<Thing[]>([]);
  const thingsFor = useRef<string | null>(null);
  const seenThisVisit = useRef(false);

  const propertyId = properties.length > 1 ? activeProperty?.id ?? null : null;
  /**
   * Projects off means the punch list goes too.
   *
   * A job filed against a renovation is reachable from that renovation's page,
   * and with the tab gone there is no page — so what is left on the list is a
   * row that names a job nothing can open. Asked of Postgres rather than
   * filtered here, so the header count, the shopping pill and both extracts get
   * the same answer rather than four subtractions that have to agree.
   */
  const excludeProjectSnags = !profile.projectsEnabled;

  /**
   * Only the newest read is drawn. The list now reads itself from several
   * places — a tab switch, coming back to the app, the two-minute refresh, and
   * after every write — and two reads in flight can land in either order. The
   * older one landing last would put back a job that was just finished.
   */
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [open, finished] = await Promise.all([
        getSnags({ propertyId, excludeProjectSnags, status: ['open', 'doing'] }, 'newest'),
        // Small by construction — a household finishes a handful a week, and
        // only the last week of them is ever rendered.
        getSnags({ propertyId, excludeProjectSnags, status: ['done'] }, 'newest'),
      ]);
      // One request for every visible cover photo rather than one per card.
      const covers = [...open, ...finished].map((s) => s.photoPaths[0]).filter(Boolean) as string[];
      const urls = await getFileUrls(covers);
      if (seq !== loadSeq.current) return;
      setSnags(open);
      setDone(finished);
      setPhotoUrls(urls);
    } catch (err) {
      console.error('Failed to load snags:', err);
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [propertyId, excludeProjectSnags]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Coming back from a snag, where something may have been closed.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  /**
   * Coming back to the app after a while.
   *
   * An installed web app is not closed when somebody leaves it; it comes back
   * hours later exactly as it was, so without this the list opened after lunch
   * was the list from breakfast — the other person's jobs missing, and its
   * photos' links expired. Only while this tab is the one showing: the others
   * read themselves when they are switched to.
   *
   * Away long enough to be a new visit, "New" is worked out again, the way it
   * is when the app is opened — otherwise an app left running for days goes on
   * flagging what was new on Monday.
   */
  useOnReturn((awayMs) => {
    if (navigation.isFocused?.() ?? true) load();
    if (awayMs >= NEW_VISIT_MS) markListSeen().then(setSeenBefore).catch(() => {});
  }, RETURN_RELOAD_MS);

  // The list reads itself again every two minutes while it is what somebody is
  // looking at — see LIST_REFRESH_MS. Not while a sheet is up over it: the
  // sheet is what they are doing, and a list shifting underneath is noise.
  const sheetUp = justAdded !== null || showExport || placesOpen || capturing || sharing;
  useEffect(() => {
    if (sheetUp) return undefined;
    const timer = setInterval(() => {
      if (isForeground() && (navigation.isFocused?.() ?? true)) load();
    }, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [sheetUp, navigation, load]);

  // Stamp "seen" once, on the first visit of this mount. Doing it on every
  // focus would clear the New rule the moment somebody opened a snag and came
  // back — which is the one journey that starts from reading it.
  useEffect(() => {
    if (seenThisVisit.current) return;
    seenThisVisit.current = true;
    markListSeen().then(setSeenBefore);
  }, []);

  /**
   * The notes written since the last visit, read whenever the list is.
   *
   * Never fatal, and never in the way of the list: a list that will not draw
   * because it could not check for news is far worse than one that does not
   * mention a note. Keyed by the stamp, so working out "New" again after half
   * an hour away reads them again too.
   */
  const notesSeq = useRef(0);
  const loadNotes = useCallback(async (since: string | null) => {
    const seq = ++notesSeq.current;
    if (!since) {
      setNotes([]);
      return;
    }
    try {
      const found = await getNotesSince(since);
      if (seq === notesSeq.current) setNotes(found);
    } catch {
      // Said nowhere: the list is still the list.
    }
  }, []);
  useEffect(() => { void loadNotes(seenBefore); }, [seenBefore, snags, loadNotes]);

  useEffect(() => {
    readCollapsed().then((keys) => setCollapsed(new Set(keys)));
  }, []);

  /** One place the fold is changed, so the device's copy can never fall behind. */
  const fold = useCallback((next: Set<string>) => {
    setCollapsed(next);
    void writeCollapsed([...next]);
  }, []);

  const visible = useMemo(() => {
    switch (lens) {
      case 'parts': return snags.filter((s) => s.needsParts);
      default: return snags;
    }
  }, [snags, lens]);

  const chosen = useMemo(
    () => (selected ? [...snags, ...done].filter((snag) => selected.has(snag.id)) : []),
    [selected, snags, done],
  );

  function startChoosing(id: string) {
    setSelected(new Set([id]));
  }

  function toggleChosen(id: string) {
    setSelected((now) => {
      if (!now) return now;
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopChoosing() {
    setSelected(null);
  }

  // Android's back ends choosing rather than leaving the list.
  useEffect(() => {
    if (!selecting) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      stopChoosing();
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  /**
   * The PDF for the chosen jobs, made as the sheet opens — see ShareJobsSheet
   * for why it is not made on the press. Notes are read one job at a time,
   * never in parallel: the pool is ten connections.
   */
  async function prepareShare(notes: ShareNotes) {
    const mine = ++shareSeq.current;
    setShareState('preparing');
    setShareError(null);
    setSharePdf(null);
    try {
      const rows = chosen;
      const stamp = exportDateStamp();
      const where = [activeProperty?.suburb, activeProperty?.town].filter(Boolean).join(', ') || null;
      let noteMap: Record<string, string[]> | undefined;
      if (notes === 'in') {
        noteMap = {};
        for (const row of rows) {
          try {
            noteMap[row.id] = (await getComments(row.id)).map((c) => c.body);
          } catch {
            noteMap[row.id] = [];
          }
        }
      }
      const table = snagQuoteTable(rows, { where, stamp, notes: noteMap });
      const images = await loadExportImages(snagExportPhotos(rows), getFileUrls);
      const brief = quoteBrief({ where, stamp, rowCount: rows.length, photoCount: images.length });
      const bytes = renderPdf(table, images, brief);
      if (mine !== shareSeq.current) return;
      setSharePdf({ bytes, fileName: exportFileName(table.name, stamp, 'pdf'), photoCount: images.length });
      setShareState('ready');
    } catch (err: any) {
      if (mine !== shareSeq.current) return;
      setShareError(err?.message ? `Couldn't make the PDF: ${err.message}` : "Couldn't make the PDF.");
      setShareState('failed');
    }
  }

  function openShare() {
    if (chosen.length === 0) return;
    setShareNotes('out');
    setSharing(true);
    prepareShare('out');
  }

  function closeShare() {
    shareSeq.current += 1;
    setSharing(false);
  }

  /** Shared or saved, the choosing is over: the jobs have gone where they were going. */
  function shareDone(words: string) {
    closeShare();
    stopChoosing();
    showToast(words);
  }

  async function doShare() {
    if (!sharePdf) return;
    setShareBusy(true);
    try {
      const jobs = `${chosen.length} ${chosen.length === 1 ? 'job' : 'jobs'}`;
      const outcome = await shareFile(sharePdf.bytes, sharePdf.fileName, 'application/pdf', `${jobs} to quote`);
      if (outcome === 'shared') shareDone('Shared');
      else if (outcome === 'saved') shareDone(`${sharePdf.fileName} downloaded`);
      else if (outcome === 'failed') showAlert("Couldn't share that", 'Try Download PDF instead.');
    } finally {
      setShareBusy(false);
    }
  }

  async function doDownload() {
    if (!sharePdf) return;
    setShareBusy(true);
    try {
      const { path } = await saveFile(sharePdf.fileName, sharePdf.bytes, 'application/pdf');
      shareDone(path ? `Saved to ${sharePdf.fileName}` : `${sharePdf.fileName} downloaded`);
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? 'Please try again.');
    } finally {
      setShareBusy(false);
    }
  }

  /**
   * A browser cannot attach a file to a `mailto:` link, so this downloads the
   * PDF and opens a new message, and the toast says to attach it — rather than
   * an email that arrives with nothing in it.
   */
  async function doEmail() {
    if (!sharePdf) return;
    setShareBusy(true);
    try {
      await saveFile(sharePdf.fileName, sharePdf.bytes, 'application/pdf');
      const subject = encodeURIComponent(chosen.length === 1 ? 'A job to quote' : 'Jobs to quote');
      const body = encodeURIComponent(
        'Hi — could you quote for the jobs in the attached PDF? Each one has a reference to quote against.',
      );
      const mailto = `mailto:?subject=${subject}&body=${body}`;
      // A mail link hands over to the mail app rather than navigating away.
      if (Platform.OS === 'web') window.location.href = mailto;
      else await Linking.openURL(mailto);
      shareDone(`${sharePdf.fileName} downloaded — attach it to the email`);
    } catch (err: any) {
      showAlert("Couldn't open an email", err?.message ?? 'Download the PDF and attach it yourself.');
    } finally {
      setShareBusy(false);
    }
  }

  /**
   * An extract of the list.
   *
   * "What's on screen" is the lens applied and the done section as it stands;
   * "Everything" is every open snag plus every done one, whatever the lens —
   * because an extract is an archive, and one that silently honoured a filter
   * set twenty minutes ago is one nobody could read correctly later.
   */
  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const rows = scope === 'all'
        ? [...snags, ...done]
        : [...visible, ...(showDone ? recentlyDone : [])];
      const scopeLabel = scope === 'all' ? 'Everything' : "What's on screen";
      const stamp = exportDateStamp();
      const place = activeProperty?.name ?? household.name;
      const table = snagExportTable(rows, {
        household: household.name,
        place,
        scope: scopeLabel,
        stamp,
      });
      // Photographs go in the PDF only — a spreadsheet cell cannot hold one,
      // and the PDF is the copy that gets sent to somebody who was not there.
      const images = format === 'pdf'
        ? await loadExportImages(snagExportPhotos(rows), getFileUrls)
        : [];
      const { fileName, path } = await writeExport(table, format, images);
      setShowExport(false);
      showToast(path ? `Saved to ${fileName}` : `${fileName} downloaded`);
    } catch (err: any) {
      showAlert("Couldn't make that file", err?.message ?? 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  /**
   * Which jobs somebody else has written on since you last looked, and how
   * many notes. A reply on an existing job — the part is ordered, arriving
   * Tuesday — is news as much as a new job is, and this product sends nothing
   * to say so; the list is the only place it can be told.
   */
  const noteNews = useMemo(
    () => snagsWithNewNotes(notes, profile.id, seenBefore),
    [notes, profile.id, seenBefore],
  );

  // What somebody else has put on the list since you last looked — a new job,
  // or a new note on one.
  const isNewJob = useCallback((s: Snag) => !!seenBefore
    && s.reporterId !== profile.id && s.createdAt > seenBefore && !isDoneForNow(s), [seenBefore, profile.id]);
  const fresh = useMemo(() => {
    if (!seenBefore) return [];
    return visible.filter((s) => isNewJob(s) || noteNews.has(s.id));
  }, [visible, seenBefore, isNewJob, noteNews]);
  const freshJobs = useMemo(() => fresh.filter(isNewJob).length, [fresh, isNewJob]);
  const freshNotes = useMemo(
    () => fresh.reduce((n, s) => n + (noteNews.get(s.id) ?? 0), 0),
    [fresh, noteNews],
  );
  /** Who each job is news from, by name, for the photo cards. */
  const newsFrom = useCallback((s: Snag) => (isNewJob(s) ? s.reporterName : null), [isNewJob]);
  /**
   * *New* is a carousel of photo cards above the rooms, not a section of rows —
   * except while choosing jobs, when every job has to be a row with a box.
   */
  const carousel = fresh.length > 0 && !selecting && !searching;

  /**
   * The one trip that clears several jobs.
   *
   * This was the Weekend tab's best idea and the only thing lost when it went:
   * the reason a small job sits for a fortnight is usually a trip to the shop
   * nobody has made. It survives as the header of the "Needs parts" lens —
   * everything the visible jobs are waiting on, collected, with what it is for.
   */
  const shopping = useMemo(
    () => (lens === 'parts' ? shoppingList(visible) : []),
    [lens, visible],
  );

  /**
   * The trip sheet, arranged the way the list itself is: by room.
   *
   * A flat run of fifteen items with the room repeated down the right-hand edge
   * says the room fifteen times and groups nothing — "Outside" nine times over
   * is a column of noise where one heading would do. Batching is the whole
   * argument for the list grouping by room in the first place (you do the
   * garage once), and a shopping trip is the same shape: the tomatoes and the
   * basil are one stop.
   *
   * Seeded `locations` order, like everywhere else, so the trip sheet and the
   * rooms below it cannot disagree about how the house is arranged.
   */
  const shoppingRooms = useMemo(() => {
    const order = locations.map((one) => one.name);
    const byRoom = new Map<string, typeof shopping>();
    for (const row of shopping) {
      const room = row.snag.room ?? NO_ROOM;
      if (!byRoom.has(room)) byRoom.set(room, []);
      byRoom.get(room)!.push(row);
    }
    const seen = [...byRoom.keys()];
    const ranked = [...seen].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      // A room the vocabulary no longer holds still has items filed under it,
      // because `snags.room` is TEXT precisely so history survives a tag being
      // removed. It sorts after the seeded ones rather than jumping to the top.
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
    });
    return ranked.map((room) => ({ room, rows: byRoom.get(room)! }));
  }, [shopping, locations]);

  /** Folded rooms on the trip sheet, kept apart from the list's own folds. */
  const [shopShut, setShopShut] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    readCollapsed('shopping').then((keys) => setShopShut(new Set(keys)));
  }, []);
  const foldShop = useCallback((next: Set<string>) => {
    setShopShut(next);
    void writeCollapsed([...next], 'shopping');
  }, []);

  /**
   * How many things are still to get, across the whole list rather than the
   * lens — the pill is how somebody finds out there is shopping to do, so
   * counting only what a filter already reveals would answer a question nobody
   * could have asked yet.
   */
  const toGet = useMemo(() => shoppingCount(snags), [snags]);

  /**
   * Ticked at the shop.
   *
   * A local re-read rather than a full `load()`: the trip is a run of taps and
   * re-fetching two lists and every cover photo between each one would make the
   * card lag exactly where it is being used hardest.
   */
  async function tick(snagId: string, item: string, bought: boolean) {
    setSnags((current) => current.map((s) => (
      s.id === snagId
        ? { ...s, bought: bought ? [...s.bought, item] : s.bought.filter((i) => i !== item) }
        : s
    )));
    try {
      await setPartBought(snagId, item, bought);
    } catch (err: any) {
      showAlert("Couldn't tick that off", err?.message ?? 'Please try again.');
      load();
    }
  }

  const recentlyDone = useMemo(() => {
    const cutoff = Date.now() - DONE_WINDOW_DAYS * 86_400_000;
    return done.filter((s) => new Date(s.doneAt ?? s.updatedAt).getTime() >= cutoff);
  }, [done]);

  /**
   * What the header counts.
   *
   * A repeating job that has been done this cycle is not something to do, and
   * saying "3 to do" over a list where one of them is dimmed and parked at the
   * bottom is the screen contradicting itself.
   */
  const toDo = useMemo(() => visible.filter((s) => !isDoneForNow(s)).length, [visible]);

  /** Everything but whatever the amend sheet is asking about. */
  const rest0 = (rows: Snag[]) => (justAdded ? rows.filter((s) => s.id !== justAdded.id) : rows);

  const sections = useMemo(() => {
    const freshIds = new Set(fresh.map((s) => s.id));
    // Whatever is being prompted about stays at the top while the prompt is up.
    // Without this it sorts into its room — or, with no room yet, all the way
    // down to "Everywhere else" — so the thing you are being asked about is
    // off-screen behind the row asking about it.
    const pinned = justAdded ? visible.filter((s) => s.id === justAdded.id) : [];
    const pinnedId = pinned[0]?.id;
    // A repeating job that has been done sinks past every room to the foot of
    // the list. It cannot *leave* the way a finished snag does — the RPC rolls
    // it forward and leaves it open — so this is the only version of that
    // reward available to it, and leaving it sitting in its room means the one
    // thing on the list nobody has to think about is competing with the ones
    // they do. It comes back up on its own when the date arrives.
    const settled = rest0(visible).filter((s) => isDoneForNow(s));
    const settledIds = new Set(settled.map((s) => s.id));
    /**
     * **Due soon** — overdue, or due in the next seven days — sits under New
     * and above every room.
     *
     * This product sends nobody anything, so this screen is the only reminder
     * there is. Grouped by room, a job due on Saturday sat in Outside with
     * everything else and the overdue filter change sat in the Laundry, and
     * the only ways to see what was coming were a sort behind a button and a
     * whole other tab. Soonest first. A parked repeat is left out: it comes
     * back up on its own the day its date arrives, and then it is overdue.
     */
    const soon = rest0(visible)
      .filter((s) => !freshIds.has(s.id) && !settledIds.has(s.id))
      .filter((s) => {
        const state = dueState(s);
        return state === 'overdue' || state === 'due-soon';
      })
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
    const soonIds = new Set(soon.map((s) => s.id));
    const rest = visible.filter((s) =>
      !freshIds.has(s.id) && s.id !== pinnedId && !settledIds.has(s.id) && !soonIds.has(s.id));
    // A key that survives the count in the title changing, and the section
    // moving up or down the list as work is filed and finished. Folding by
    // index would fold whatever slid into that position.
    const out: { key: string; title: string; isNew?: boolean; data: Snag[] }[] = [];

    if (searching) {
      // One flat answer, open jobs first and then the finished ones, the way the
      // House tab's search answers flat across every room.
      const found = searchSnags([...visible, ...done], query);
      return found.length > 0 ? [{ key: 'found', title: `Found · ${found.length}`, data: found }] : [];
    }
    if (pinned.length > 0) out.push({ key: 'just-added', title: 'Just added', isNew: true, data: pinned });
    if (fresh.length > 0 && selecting) {
      const others = fresh.filter((s) => s.id !== pinnedId);
      if (others.length > 0) out.push({ key: 'new', title: 'New', isNew: true, data: others });
    }
    if (soon.length > 0) {
      out.push({ key: 'due-soon', title: `Due soon · ${soon.length}`, data: soon });
    }

    // Seeded order first, so the rooms read the way the chips did, then
    // anything filed under a tag that has since been removed.
    const order = locations.map((l) => l.name);
    const byRoom = new Map<string, Snag[]>();
    for (const snag of rest) {
      const room = snag.room ?? NO_ROOM;
      if (!byRoom.has(room)) byRoom.set(room, []);
      byRoom.get(room)!.push(snag);
    }
    const known = order.filter((name) => byRoom.has(name));
    const extra = [...byRoom.keys()].filter((n) => !order.includes(n) && n !== NO_ROOM).sort();
    for (const name of [...known, ...extra, ...(byRoom.has(NO_ROOM) ? [NO_ROOM] : [])]) {
      out.push({
        key: `room:${name}`,
        title: `${name} · ${byRoom.get(name)!.length}`,
        data: byRoom.get(name)!,
      });
    }

    if (settled.length > 0) {
      // The Schedule tab's words for the same fact, so the two screens do not
      // invent two names for one mechanism.
      out.push({ key: 'settled', title: `Comes round again · ${settled.length}`, data: settled });
    }

    if (showDone && recentlyDone.length > 0) {
      out.push({ key: 'done', title: 'Done this week', data: recentlyDone });
    }
    return out;
  }, [fresh, visible, locations, showDone, recentlyDone, justAdded, searching, query, done, selecting]);

  /**
   * The same sections, with the folded ones emptied rather than removed.
   *
   * The heading stays — that is the whole point of folding: "there are three
   * things in the Garage" is what the grouping exists to say, and a fold that
   * took the heading with it would be a filter rather than a fold. Emptying
   * `data` is also what keeps the fold free: `SectionList` renders no rows, so
   * a long list costs nothing to scroll past.
   */
  const shownSections = useMemo(
    () => sections.map((section) => (
      collapsed.has(section.key) ? { ...section, data: [] } : section
    )),
    [sections, collapsed]
  );

  /**
   * Whether the control at the top offers to open everything or shut it.
   *
   * It says the thing it will *do*, and it decides from whether anything is
   * still open — so the one press that is never a no-op is the one on offer.
   * With every section already folded it reads *Expand all*; with any section
   * open it reads *Collapse all*, which is what somebody scanning a long list
   * reaches for.
   */
  const anyOpen = useMemo(
    () => sections.some((section) => !collapsed.has(section.key))
      || shoppingRooms.some((one) => !shopShut.has(one.room)),
    [sections, collapsed, shoppingRooms, shopShut]
  );

  /**
   * The one control reaches **everything on screen**, the trip sheet included.
   *
   * It did not, and the failure was the one a control like this must never
   * have: with the parts lens up, the card is most of what is visible, so
   * pressing *Collapse all* folded the rooms underneath it and left the rooms
   * in front of you exactly as they were — a button that looks like it did
   * nothing. "Collapse all" has to mean all.
   *
   * Expanding clears the shopping folds outright rather than clearing only the
   * rooms currently listed: a room whose items have all been bought drops out
   * of the card, and leaving it folded would have it come back shut the next
   * time something is added to it. Collapsing can only name what is on screen,
   * which is all collapsing ever means.
   */
  const foldEverything = useCallback(() => {
    const shutting = anyOpen;
    fold(shutting ? new Set(sections.map((one) => one.key)) : new Set());
    // Only when the card is up: with the jobs lens on there is no trip sheet,
    // and writing an empty set would quietly unfold rooms nobody touched.
    if (shoppingRooms.length > 0) {
      foldShop(shutting ? new Set(shoppingRooms.map((one) => one.room)) : new Set());
    }
  }, [anyOpen, sections, shoppingRooms, fold, foldShop]);

  async function handleAdd(input: { photoPaths: string[]; description: string | null }) {
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding something to the list.');
      return;
    }
    const snag = await createSnag({
      propertyId: activeProperty.id,
      description: input.description,
      photoPaths: input.photoPaths,
    });
    setJustAdded(snag);
    await load();
  }

  /**
   * *Take photo* on the +'s sheet. The camera opens from inside the press —
   * a browser opens it only from a tap — and the photo is filed the way the
   * shutter always filed one: saved first, then the capture sheet asks what
   * is wrong and where.
   */
  async function captureFromCamera() {
    if (!activeProperty) return;
    const pending = takePhoto();
    setCapturing(false);
    const uri = await pending;
    if (!uri) return;
    try {
      await fileCapturedPhoto(uri, household.id, null, handleAdd);
    } catch (err: unknown) {
      showAlert("Couldn't add that photo", failureReason(err) ?? 'Please try again.');
    }
  }

  /**
   * *Continue without picture*, then *Add job*. Created only now, from the
   * words — nothing exists while the box is open — and then the job's own
   * page opens, where the room and everything else are decided. A refusal
   * says why and rethrows, so the sheet keeps the words.
   */
  async function captureWords(text: string) {
    // Typing never waits on the places loading; only filing needs one. The
    // words stay in the box when there is nowhere to put them yet.
    if (!activeProperty) {
      showAlert('No place yet', 'Add a place before adding something to the list.');
      throw new Error('No place yet');
    }
    try {
      const snag = await createSnag({ propertyId: activeProperty.id, description: text, photoPaths: [] });
      setCapturing(false);
      await load();
      navigation.navigate('SnagDetail', { snagId: snag.id });
    } catch (err: any) {
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
      throw err;
    }
  }

  // The photograph from first-run setup's *Snap your first job*, filed the way
  // the shutter files one — so it arrives with the capture sheet asking what is
  // wrong and where, like every photo after it. Waits for a place to file it
  // against; `take` empties the hand-off so it can only be filed once.
  const firstCapture = useFirstCapture();
  useEffect(() => {
    if (!activeProperty) return;
    const uri = firstCapture.take();
    if (!uri) return;
    fileCapturedPhoto(uri, household.id, null, handleAdd).catch((err: unknown) => {
      showAlert("Couldn't add that photo", failureReason(err) ?? 'Please try again.');
    });
    // handleAdd is re-made every render; the hand-off is taken exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProperty, firstCapture, household.id]);

  // The tour's *Try it*. Logging a job is this screen's + and its sheet; the
  // rooms and the walkthrough are the House tab's, which takes them there.
  useEffect(() => {
    if (!activeProperty) return;
    if (firstCapture.takeAction(['logJob'])) {
      setCapturing(true);
      return;
    }
    const waiting = firstCapture.peekAction();
    if (waiting === 'addRoom' || waiting === 'addThing') navigation.navigate('House' as never);
  }, [activeProperty, firstCapture, navigation]);

  /**
   * The prompt after a photo.
   *
   * A photo on its own is the weakest thing this app can hold: with no words
   * and no room, `snagHeadline` has nothing to work with and the list shows
   * "Something to sort out" — which is unreadable a fortnight later, to the
   * person who filed it as much as to anyone else. So the moment after a photo
   * is the moment to ask, while the thing is still in front of you.
   *
   * It asks *after* the save, never before it. The snag is already on the list;
   * every one of these controls edits something that exists, so none of them
   * can block anybody and walking away leaves a perfectly good entry.
   */
  const loadThings = useCallback(async (placeId: string) => {
    if (thingsFor.current === placeId) return;
    try {
      const found = await getThings(placeId);
      thingsFor.current = placeId;
      setThings(found);
    } catch (err) {
      // The step simply does not appear. A capture sheet is not the place to
      // report that the house record could not be read.
      console.error('Failed to load the house record:', err);
    }
  }, []);

  /**
   * No toast. The sheet itself shows the answer landing — the words stay in
   * the box, the room lights up — and a toast reading "Kitchen" over a sheet
   * that has just been told "Kitchen" is the app repeating somebody back to
   * themselves. A failure still says so, because that one is news.
   */
  async function amend(update: Parameters<typeof updateSnag>[1]) {
    if (!justAdded) return;
    setAmending(true);
    try {
      setJustAdded(await updateSnag(justAdded.id, update));
      if (update.room) lastRoom.current = { room: update.room, at: Date.now() };
      await load();
    } catch (err: any) {
      showAlert("Couldn't change that", err?.message ?? 'Please try again.');
    } finally {
      setAmending(false);
    }
  }

  /**
   * The room the last capture went to, if it was recent enough to be the same
   * walk round. Ten minutes is a room's worth of photographs, not a morning.
   */
  const lastRoom = useRef<{ room: string; at: number } | null>(null);
  const recentRoom = lastRoom.current && Date.now() - lastRoom.current.at < ROOM_MEMORY_MS
    ? lastRoom.current.room
    : null;

  /**
   * Finishing a job from its card.
   *
   * The same RPC the job's own *Mark done* calls, and the same two outcomes
   * read off the row that comes back rather than off what was asked for: a
   * one-off leaves the list, a repeat rolls forward and stays. No dialog here
   * — the reward is the card leaving, which is on screen — but an **Undo**,
   * because a one-tap state change on a list of lookalike rows will
   * occasionally land on the wrong one.
   */
  const [finishing, setFinishing] = useState<Set<string>>(() => new Set());
  async function finish(snag: Snag) {
    if (finishing.has(snag.id)) return;
    setFinishing((was) => new Set(was).add(snag.id));
    try {
      const updated = await setSnagStatus(snag.id, 'done');
      await load();
      const headline = snagHeadline(snag);
      if (updated.status === 'open') {
        showToast(`Done — back on the list ${updated.dueAt ? 'when it’s next due' : 'again'}`);
      } else {
        showToast(`Done: ${headline}`, {
          label: 'Undo',
          onPress: () => {
            setSnagStatus(snag.id, 'open')
              .then(() => load())
              .catch((err: any) =>
                showAlert("Couldn't reopen that", err?.message ?? 'Please try again.'));
          },
        });
      }
    } catch (err: any) {
      showAlert("Couldn't update that", err?.message ?? 'Please try again.');
    } finally {
      setFinishing((was) => {
        const next = new Set(was);
        next.delete(snag.id);
        return next;
      });
    }
  }

  const since = describeSince(seenBefore);
  const news = describeNews(freshJobs, freshNotes, since);
  const placeName = placeTitle(activeProperty, properties);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => properties.length > 1 && setPlacesOpen(true)}
          disabled={properties.length < 2}
          style={styles.place}
          accessibilityRole={properties.length > 1 ? 'button' : undefined}
        >
          <Text style={styles.title} numberOfLines={1}>{placeName}</Text>
          {properties.length > 1 ? (
            <Icon name="chevron-down" size="sm" color={Colors.textSecondary} />
          ) : null}
        </Pressable>

        {/* Only when there is something to get: at nought it is a control
            dressed as a choice, and the two filter rails were evicted from
            this screen for charging rent on every visit. Tapping it is the
            lens, not a second place parts live. */}
        {/* The two header controls, in a group of their own so they share a
            **top edge**. The outer row centres its children, and the cart is
            taller than the filter because of the caption under it — so
            centring dropped the filter half an inch below the cart and the
            pair read as misaligned. Nesting them means the whole cluster is
            centred against the title while the two squares line up with each
            other, which is the relationship that actually matters. */}
        <View style={styles.headerBtns}>
          {/* Still there with nothing left to get while the trip sheet is up:
              it is the only way back to the jobs, and the last tick of a trip
              must not strand somebody on an empty lens. */}
          {toGet > 0 || lens === 'parts' ? (
            <Pressable
              onPress={() => setLens(lens === 'parts' ? 'all' : 'parts')}
              style={styles.shopTap}
              accessibilityRole="button"
              accessibilityLabel={
                lens === 'parts'
                  ? 'View jobs list'
                  : `View shopping list, ${toGet} ${toGet === 1 ? 'thing' : 'things'} to get`
              }
            >
              {/* One shape for both buttons, from one style, so they cannot
                  drift: a 48px square holding a 20px glyph. The count used to
                  sit inside the cart beside the icon, which made that button
                  half as wide again as the filter — the count is a *number
                  about* the button rather than part of it, so it rides the
                  corner as a badge and leaves the two identical. */}
              <View style={[styles.iconBtn, lens === 'parts' && styles.iconBtnOn]}>
                <Icon
                  name="cart-outline"
                  size="md"
                  color={lens === 'parts' ? Colors.onSelected : Colors.textPrimary}
                />
                {toGet > 0 ? (
                  <View style={[styles.shopBadge, lens === 'parts' && styles.shopBadgeOn]}>
                    <Text
                      style={[styles.shopBadgeText, lens === 'parts' && styles.shopBadgeTextOn]}
                    >
                      {toGet > 99 ? '99+' : toGet}
                    </Text>
                  </View>
                ) : null}
              </View>
              {/* A cart with a number on it says there is shopping; it does not
                  say that pressing it swaps what the screen is showing, and a
                  control whose whole job is to change the view has to name the
                  view it changes to. It reads *View jobs list* while the trip
                  sheet is up, because by then the question has turned round. */}
              <Text style={styles.shopCaption} numberOfLines={1}>
                {lens === 'parts' ? 'View jobs list' : 'View shopping list'}
              </Text>
            </Pressable>
          ) : null}

        </View>
      </View>

      <SectionList
        sections={shownSections}
        ListHeaderComponent={
          <>
          {/* The count, the line about the list, the rule and the search
              scroll away with the list: they are its top, not chrome. The
              home picker and the cart stay above, where they always are. */}
          <View style={styles.countBlock}>
          {/* The count — Bone & Glass's one big number — then one line about the
              list, then the 2px rule. A count of concrete things, never a
              percentage: what is left to do. */}
          {selecting ? null : (
            <View style={styles.countRow} accessibilityRole="header">
              <Text style={styles.countLine}>
                <Text style={styles.count}>{toDo}</Text>
                <Text style={styles.unit}> to do</Text>
              </Text>
            </View>
          )}

          {/* The one line about the list, and the controls that reach all of it.
              On the same line because both are *about* the list rather than in
              it, and because this screen has already evicted two filter rails for
              charging vertical rent on every visit.

              The fold control says what pressing it does and decides that from
              whether anything is still open, so the press on offer is never a
              no-op. */}
          {selecting ? (
            // Choosing: the line says how many, and the way out. The rows' own
            // boxes are what choose.
            <View style={styles.sinceRow}>
              <Text style={styles.selectedCount} accessibilityLiveRegion="polite">
                {selected!.size} selected
              </Text>
              <Pressable
                onPress={stopChoosing}
                style={styles.selectTap}
                accessibilityRole="button"
                accessibilityLabel="Stop choosing jobs"
              >
                <Text style={styles.selectLabel}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.sinceRow}>
              <Text style={[styles.since, news && styles.sinceNews]} numberOfLines={2}>
                {news ?? (since ? `Nothing new ${since}` : 'Everything on the list')}
              </Text>
              <View style={styles.sinceControls}>
                {/* A long press chooses on a phone; a desktop has no long press,
                    so the same thing is a word here. */}
                {snags.length > 0 && !searching ? (
                  <Pressable
                    onPress={() => setSelected(new Set())}
                    style={styles.selectTap}
                    accessibilityRole="button"
                    accessibilityLabel="Choose jobs to share"
                  >
                    <Text style={styles.selectLabel}>Select</Text>
                  </Pressable>
                ) : null}
                {!searching && sections.length + shoppingRooms.length > 1 ? (
                  <FoldAllPill anyOpen={anyOpen} onPress={foldEverything} />
                ) : null}
              </View>
            </View>
          )}
          <View style={styles.rule} />

          {/* Search: words, rooms, parts, references and linked items, across the
              jobs still to do and the finished ones. The House tab has had one
              since it shipped; a household with thirty-four jobs needed this. */}
          <View style={styles.searchWrap}>
            <View style={styles.search}>
              <Icon name="search" size="md" color={Colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search jobs, rooms and parts"
                placeholderTextColor={Colors.textMuted}
                style={styles.searchInput}
                returnKeyType="search"
                autoCorrect={false}
                accessibilityLabel="Search the list"
              />
              {searching ? (
                <Pressable
                  onPress={() => setQuery('')}
                  style={styles.clearTap}
                  accessibilityRole="button"
                  accessibilityLabel="Clear the search"
                >
                  <Icon name="close-circle-outline" size="md" color={Colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>
          </View>
          {/* Asked once, in a browser tab only. The web build is installed
              from the browser, and a tab is the thing that gets closed and
              lost. */}
          <InstallCard />
          {/* **News gets the glass.** What the other person added, or wrote,
              since you last looked, as photographs big enough to recognise at
              a glance — and everything else as quiet rows below. */}
          {carousel ? (
            <View style={styles.newsBlock}>
              <View style={styles.groupRow}>
                <Text style={[styles.group, styles.groupNew]}>New</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carousel}
                style={styles.carouselBleed}
              >
                {fresh.map((item) => (
                  <PhotoCard
                    key={item.id}
                    snag={item}
                    photoUrl={item.photoPaths[0] ? photoUrls[item.photoPaths[0]] : null}
                    from={newsFrom(item)}
                    newNotes={noteNews.get(item.id) ?? 0}
                    isNewJob={isNewJob(item)}
                    onPress={() => navigation.navigate('SnagDetail', { snagId: item.id })}
                    onLongPress={() => startChoosing(item.id)}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}
          {shopping.length > 0 && !searching ? (
            <View style={styles.shopping}>
              <View style={styles.shoppingHead}>
                <Icon name="cart-outline" size="md" color={Colors.primary} />
                <Text style={styles.shoppingTitle}>Pick up on the way</Text>
              </View>
              {/* Grouped by room, and the room is the heading rather than a
                  label repeated down the right-hand edge — "Outside" nine times
                  over is a column of noise where one word would do, and a trip
                  to the shop batches the same way the list does.

                  A ticked row stays, struck through, rather than vanishing
                  under the finger that tapped it: otherwise undoing a mis-tap
                  means remembering which job the item belonged to. It leaves on
                  its own terms — a job with nothing left to get stops being
                  `needs_parts`, drops out of this lens, and takes its rows with
                  it, so the card empties as the trip ends. */}
              {shoppingRooms.map(({ room, rows }) => {
                const shut = shopShut.has(room);
                const left = rows.filter((one) => !one.bought).length;
                return (
                  <View key={room}>
                    {/* The heading stays when the room is folded, carrying its
                        count — which is the whole point of the grouping, the
                        same rule the list's own sections keep. A fold that took
                        the heading with it would be a filter. */}
                    <Pressable
                      onPress={() => {
                        const next = new Set(shopShut);
                        if (shut) next.delete(room); else next.add(room);
                        foldShop(next);
                      }}
                      style={styles.shopRoomRow}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: !shut }}
                      accessibilityLabel={`${room}, ${left} to get`}
                    >
                      <Icon
                        name={shut ? 'chevron-forward' : 'chevron-down'}
                        size="sm"
                        color={Colors.textMuted}
                      />
                      <Text style={styles.shopRoom}>{room}</Text>
                      <Text style={styles.shopRoomCount}>{left}</Text>
                    </Pressable>

                    {shut ? null : rows.map(({ item, snag, bought }) => (
                      <Pressable
                        key={`${snag.id}-${item}`}
                        onPress={() => tick(snag.id, item, !bought)}
                        style={styles.shoppingRow}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: bought }}
                        accessibilityLabel={bought ? `${item}, got it` : `${item}, tick off`}
                      >
                        <Icon
                          name={bought ? 'checkmark-circle' : 'ellipse-outline'}
                          size="sm"
                          color={bought ? Colors.primary : Colors.textMuted}
                        />
                        <Text style={[styles.shoppingItem, bought && styles.shoppingItemGot]}>
                          {item}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
            </View>
          ) : null}
          </>
        }
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(clearance, Spacing.xxxl * 3) + Spacing.lg },
          sections.length === 0 && !carousel && styles.listEmpty,
        ]}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => {
          const shut = collapsed.has(section.key);
          return (
            <Pressable
              onPress={() => {
                const next = new Set(collapsed);
                if (shut) next.delete(section.key); else next.add(section.key);
                fold(next);
              }}
              style={styles.groupRow}
              accessibilityRole="button"
              accessibilityState={{ expanded: !shut }}
              accessibilityLabel={`${section.title}, ${shut ? 'show' : 'hide'}`}
            >
              <Text style={[styles.group, section.isNew && styles.groupNew]}>{section.title}</Text>
              <View style={styles.groupRule} />
              <Icon
                name={shut ? 'chevron-forward' : 'chevron-down'}
                size="sm"
                color={section.isNew ? Colors.primary : Colors.textMuted}
              />
            </Pressable>
          );
        }}
        renderItem={({ item, section }) => (
          <SnagCard
            snag={item}
            showRoom={!section.key.startsWith('room:')}
            newNotes={noteNews.get(item.id) ?? 0}
            photoUrl={item.photoPaths[0] ? photoUrls[item.photoPaths[0]] : null}
            onPress={() => navigation.navigate('SnagDetail', { snagId: item.id })}
            onDone={() => finish(item)}
            finishing={finishing.has(item.id)}
            onLongPress={() => startChoosing(item.id)}
            selecting={selecting}
            selected={!!selected?.has(item.id)}
            onSelect={() => toggleChosen(item.id)}
          />
        )}
        ListFooterComponent={
          <>
            {recentlyDone.length > 0 ? (
              <Pressable
                onPress={() => setShowDone((v) => !v)}
                style={styles.doneLine}
                accessibilityRole="button"
                accessibilityState={{ expanded: showDone }}
              >
                <Text style={styles.doneText}>
                  {showDone ? 'Hide' : 'Show'} {recentlyDone.length} done this week
                </Text>
              </Pressable>
            ) : null}
            {/* Everything finished, past the week this list keeps: a job leaves
                after seven days, and "when did we last do the gutters?" had no
                answer short of a dot on the calendar. */}
            {done.length > 0 || snags.some((s) => s.lastDoneAt) ? (
              <ExportFooter
                label="All finished jobs"
                icon="time-outline"
                onPress={() => navigation.navigate('History')}
              />
            ) : null}
            {/* At the foot of the scrolled content, never pinned to the bottom
                of the screen. */}
            <ExportFooter label="Export this list" onPress={() => setShowExport(true)} />
          </>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          loading || carousel ? null : searching ? (
            <EmptyState
              icon="search"
              title={`Nothing matches “${query.trim()}”`}
              message="Search looks at what each job says, its room, its parts and what it is linked to — finished jobs too."
            />
          ) : (
            <EmptyState
              icon="home-outline"
              title={lens === 'all' ? 'Nothing needs doing' : 'Nothing here'}
              message={
                lens === 'all'
                  ? 'Next time you notice something, photograph it from here.'
                  : 'Nothing matches what you asked for.'
              }
            />
          )
        }
      />

      {justAdded ? (
        <AmendSnagSheet
          snag={justAdded}
          locations={locations}
          busy={amending}
          onSaveNote={(text) => amend({ description: text })}
          onSetRoom={(room) => amend({ room })}
          onCreateRoom={createRoom}
          suggestedRoom={recentRoom}
          onOpenDetail={() => {
            const id = justAdded.id;
            setJustAdded(null);
            navigation.navigate('SnagDetail', { snagId: id });
          }}
          onClose={() => setJustAdded(null)}
        />
      ) : null}

      {/* The + replaced the compose bar (October 2026): one way in, and the
          list's foot back. It opens CaptureSheet — Take photo, or Continue
          without picture. ComposeBar lives on for a thing's Report a problem. */}
      {selecting ? (
        <StickyActionBar stacked hint={selected!.size === 0 ? 'Tap the jobs to share' : undefined}>
          <Button
            label={selected!.size === 1 ? 'Share 1 job' : `Share ${selected!.size} jobs`}
            icon="share-outline"
            onPress={openShare}
            disabled={selected!.size === 0}
            fullWidth
          />
        </StickyActionBar>
      ) : (
        <Fab onPress={() => setCapturing(true)} accessibilityLabel="Capture a new job" />
      )}
      <ShareJobsSheet
        visible={sharing}
        jobCount={chosen.length}
        photoCount={sharePdf ? sharePdf.photoCount : null}
        notes={shareNotes}
        onNotes={(next) => {
          setShareNotes(next);
          prepareShare(next);
        }}
        state={shareState}
        error={shareError}
        canShare={canShareFiles()}
        busy={shareBusy}
        onShare={doShare}
        onDownload={doDownload}
        onEmail={doEmail}
        onClose={closeShare}
      />
      <CaptureSheet
        visible={capturing}
        disabled={!activeProperty}
        onTakePhoto={captureFromCamera}
        onAddWords={captureWords}
        onClose={() => setCapturing(false)}
      />

      <ExportSheet
        visible={showExport}
        what="the list"
        counts={{
          view: visible.length + (showDone ? recentlyDone.length : 0),
          all: snags.length + done.length,
        }}
        busy={exporting}
        onExport={handleExport}
        onCancel={() => setShowExport(false)}
      />

      <HomePickerSheet visible={placesOpen} onClose={() => setPlacesOpen(false)} />
    </View>
  );
}

const LABEL = {
  fontFamily: Fonts.mono,
  fontSize: Typography.label,
  letterSpacing: 1.4,
  textTransform: 'uppercase' as const,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sinceControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  selectTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.sm },
  selectLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  place: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 1, minHeight: MIN_TOUCH_TARGET,
  },
  // The home picker: one line above the count. It keeps its height while
  // empty, before the places load, so the header does not jump when they do.
  title: {
    fontSize: Typography.body, lineHeight: 22, minHeight: 22, fontWeight: Typography.bold,
    color: Colors.textPrimary, flexShrink: 1,
  },
  // The one big number, used once on the screen.
  // The list's content is already inset by the gutter; the count's pieces
  // carry their own, so the block steps back out to the screen's edge.
  countBlock: { marginHorizontal: -Spacing.lg, paddingBottom: Spacing.xs },
  countRow: { paddingHorizontal: Spacing.lg, marginTop: -Spacing.xs },
  countLine: { color: Colors.textPrimary },
  count: {
    fontSize: Typography.count,
    lineHeight: 84,
    fontWeight: Typography.heavy,
    letterSpacing: -5,
    color: Colors.textPrimary,
  },
  unit: {
    fontSize: Typography.title3,
    fontWeight: Typography.bold,
    letterSpacing: -0.4,
    color: Colors.textPrimary,
  },
  // Both header buttons share a top edge, so the cart and its caption sit
  // level with the home picker.
  headerBtns: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  iconBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.pill,
    backgroundColor: Colors.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The trip sheet is up: a selection, so ink rather than the action colour.
  iconBtnOn: { backgroundColor: Colors.selected },
  shopTap: { alignItems: 'center', gap: Spacing.xs },
  shopCaption: { fontSize: Typography.xs, color: Colors.textMuted },
  // The count rides the corner rather than sitting inside the button.
  shopBadge: {
    position: 'absolute',
    top: -Spacing.xs,
    right: -Spacing.xs,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: Radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  shopBadgeOn: { backgroundColor: Colors.white },
  shopBadgeText: {
    fontFamily: Fonts.mono,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.onPrimary,
  },
  shopBadgeTextOn: { color: Colors.textPrimary },
  since: { ...LABEL, flex: 1, color: Colors.textMuted, paddingLeft: Spacing.lg },
  sinceNews: { color: Colors.primary },
  selectedCount: {
    flex: 1, fontSize: Typography.title3, fontWeight: Typography.bold, color: Colors.textPrimary,
    paddingLeft: Spacing.lg, paddingTop: Spacing.lg,
  },
  // The 2px rule under a count. Ink, because it is the edge of the count.
  rule: { height: 2, backgroundColor: Colors.textPrimary, marginHorizontal: Spacing.lg },
  searchWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.md,
    borderRadius: Radius.input,
    backgroundColor: Colors.well,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    paddingVertical: Spacing.sm,
  },
  clearTap: { width: MIN_TOUCH_TARGET, height: 44, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  sinceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingRight: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  // A section label, smaller than the jobs under it: mono, in capitals, in
  // pencil. The whole label is the fold's tap target.
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
  },
  group: { ...LABEL, color: Colors.textMuted },
  groupNew: { color: Colors.primary },
  groupRule: { flex: 1 },
  newsBlock: { marginBottom: Spacing.sm },
  // The carousel runs to the screen's edges, past the list's gutter.
  carouselBleed: { marginHorizontal: -Spacing.lg },
  carousel: { paddingHorizontal: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.lg },
  // The trip sheet: the one paper surface on the screen, and only under one
  // lens. It should feel like the thing you opened the app for on the way out.
  shopping: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
    ...Shadow.md,
  },
  shoppingHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  shoppingTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  shoppingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
  },
  shopRoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.hairline,
  },
  shopRoom: { ...LABEL, flex: 1, color: Colors.textMuted },
  shopRoomCount: { fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textMuted },
  shoppingItem: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  shoppingItemGot: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  shoppingFor: { fontSize: Typography.sm, color: Colors.textMuted },
  doneLine: { paddingVertical: Spacing.lg, alignItems: 'center', minHeight: MIN_TOUCH_TARGET },
  doneText: { fontSize: Typography.sm, color: Colors.textSecondary },
});

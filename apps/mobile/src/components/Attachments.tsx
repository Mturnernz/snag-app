import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Image, ScrollView, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { openUrl } from '../lib/openUrl';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { documentFileName, documentName } from '@snag/supabase-queries';
import { FILE_TAG_LABELS, type FileTag, type FileTags } from '@snag/shared-types';
import { getFileUrl, getFileUrls, uploadFile } from '../lib/supabase';
import { addPhotos, PhotoSource } from '../lib/addPhotos';
import { showAlert } from '../lib/alert';
import Icon from './Icon';
import PhotoViewer from './PhotoViewer';
import FileTagChips from './FileTagChips';

interface Props {
  householdId: string;
  photoPaths: string[];
  documentPaths: string[];
  /**
   * Writes the new arrays and says what happened. The caller owns the write,
   * because each level has its own RPC — and because a component that could
   * write would be a second place a project's files are set.
   */
  onChange: (
    next: { photoPaths?: string[]; documentPaths?: string[] },
    toast: string
  ) => Promise<void>;
  /** What this level calls itself, for the empty line: "Nothing on the bathroom yet". */
  emptyLabel?: string;
  disabled?: boolean;
  /**
   * What each document has been tagged as. With `onTag`, every document row
   * carries a tag pill; without, documents are listed as they always were.
   */
  tags?: FileTags;
  /** Tags one document, or untags it with `null`. The caller owns the write. */
  onTag?: (path: string, tag: FileTag | null) => Promise<void>;
}

function failureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message || 'Try again in a moment.';
}

/**
 * Photos and paperwork for one level of a project.
 *
 * **One component for all four levels, because a file belongs to exactly one of
 * them and behaves identically at each.** A project holds the consent, an
 * element holds the room's drawings, an item holds the spec sheet, a quote holds
 * the quote. They roll *up* — `home.project_files` gathers everything under a
 * project — but they are attached, removed and opened in one place, so there is
 * one implementation of the upload rules rather than four that drift.
 *
 * Every rule here is inherited rather than invented, and each was paid for once
 * already on the thing page:
 *
 * - **One photo control**, not a camera and a *Choose one* beside it. On the
 *   build people install, `<input type="file" accept="image/*">` is answered by
 *   the phone's own sheet, which offers *Take Photo* above the library — asking
 *   first only added a tap.
 * - **Several at once, capped at `PHOTO_PICK_LIMIT`**, and the cap is said out
 *   loud: a cap nobody is told about is indistinguishable from photographs that
 *   failed.
 * - **One write at the end**, not one per file: eight photographs must not be
 *   eight round trips and eight stacked toasts.
 * - **One after another rather than in parallel**, because repeated compression
 *   is the most memory-hungry thing this app does.
 * - **What arrived is kept.** Six uploaded with two refused is six added and a
 *   sentence about the two.
 * - **Opening and removing are siblings, never nested** — a `Pressable` inside a
 *   `Pressable` is a coin toss about which one gets the tap.
 * - **A PDF is opened with a signed URL in a new tab, never embedded**: the
 *   deployed CSP sets `object-src 'none'` and names no `frame-src`, so an inline
 *   viewer would be blocked with nothing said.
 */
export default function Attachments({
  householdId,
  photoPaths,
  documentPaths,
  onChange,
  emptyLabel,
  disabled = false,
  tags,
  onTag,
}: Props) {
  const [tagging, setTagging] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  /**
   * Whether the signing round trip has been made yet, so a strip that is still
   * waiting is not mistaken for one that came back empty.
   *
   * Without this the two are the same state — an empty map — and the line
   * below would flash "couldn't be loaded" on every mount before the URLs
   * arrive, which is the opposite failure and a worse one.
   */
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAsked(false);
    if (photoPaths.length === 0) {
      setUrls({});
      return;
    }
    getFileUrls(photoPaths).then((map) => {
      if (cancelled) return;
      setUrls(map);
      setAsked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [photoPaths.join('|')]);

  /**
   * Photographs this record holds that nothing can currently show.
   *
   * `getFileUrls` keeps whatever signed — the same *what arrived is kept* rule
   * the upload path follows — and logs the rest to a console nobody on a phone
   * is reading. So a signing failure rendered as grey tiles: indistinguishable,
   * from the outside, from photographs that were never there, on the one screen
   * whose whole job is to be believed later. It costs one line to say which it
   * is, and saying it is the difference between "this record is thin" and "this
   * record is fine and the network is not".
   */
  const unsigned = asked ? photoPaths.filter((path) => !urls[path]).length : 0;

  async function attachPhotos(source: PhotoSource) {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await addPhotos(householdId, (added) => onChange(
        { photoPaths: [...photoPaths, ...added] },
        added.length === 1 ? 'Photo added' : `${added.length} photos added`
      ), source);
    } finally {
      setBusy(false);
    }
  }

  async function attachDocument() {
    if (busy || disabled) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      const name = documentFileName(householdId, asset.name ?? 'document.pdf');
      // The mime type goes in twice on purpose — see uploadFile. A multipart
      // body carries the Blob's own type rather than the option, and the
      // bucket's allow-list refuses what it does not recognise.
      const { path, error } = await uploadFile(asset.uri, name, 'application/pdf');
      if (error || !path) throw error ?? new Error('The document did not upload');
      await onChange({ documentPaths: [...documentPaths, path] }, 'Document added');
    } catch (err: unknown) {
      showAlert("That document didn't save", failureReason(err));
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(path: string) {
    const url = await getFileUrl(path);
    if (!url) {
      showAlert("Couldn't open that", 'The link to this document could not be made.');
      return;
    }
    openUrl(url);
  }

  const shown = photoPaths.map((path) => urls[path]).filter(Boolean);

  return (
    <View>
      {photoPaths.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
          {photoPaths.map((path, index) => (
            <View key={path} style={styles.tileWrap}>
              <Pressable
                onPress={() => setViewerAt(index)}
                accessibilityRole="button"
                accessibilityLabel={`Open photo ${index + 1}`}
              >
                {urls[path] ? (
                  <Image source={{ uri: urls[path] }} style={styles.tile} />
                ) : (
                  <View style={[styles.tile, styles.tileEmpty]} />
                )}
              </Pressable>
              {/* Sibling, never nested. */}
              <Pressable
                onPress={() =>
                  onChange(
                    { photoPaths: photoPaths.filter((p) => p !== path) },
                    'Photo removed'
                  )
                }
                style={styles.tileRemove}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
              >
                <Icon name="close" size="sm" color={Colors.white} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {documentPaths.map((path) => {
        const tag = tags?.[path] ?? null;
        return (
          <View key={path}>
            <View style={styles.doc}>
              <Pressable
                onPress={() => openDocument(path)}
                style={styles.docOpen}
                accessibilityRole="button"
                accessibilityLabel={`Open ${documentName(path)}`}
              >
                <Icon name="document-text-outline" size="sm" color={Colors.textSecondary} />
                <Text style={styles.docName} numberOfLines={2}>
                  {documentName(path)}
                </Text>
              </Pressable>
              {/* The tag, the door and the × are siblings, never nested. */}
              {onTag ? (
                <Pressable
                  onPress={() => setTagging(tagging === path ? null : path)}
                  disabled={disabled}
                  style={styles.tagTap}
                  accessibilityRole="button"
                  accessibilityLabel={tag ? `${FILE_TAG_LABELS[tag]} — change what ${documentName(path)} is` : `Say what ${documentName(path)} is`}
                  accessibilityState={{ expanded: tagging === path }}
                >
                  <View style={[styles.tagPill, tag ? null : styles.tagPillEmpty]}>
                    <Text style={[styles.tagLabel, tag ? null : styles.tagLabelEmpty]} numberOfLines={1}>
                      {tag ? FILE_TAG_LABELS[tag] : 'Tag'}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() =>
                  onChange(
                    { documentPaths: documentPaths.filter((p) => p !== path) },
                    'Document removed'
                  )
                }
                style={styles.docRemove}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${documentName(path)}`}
              >
                <Icon name="close" size="sm" color={Colors.textMuted} />
              </Pressable>
            </View>
            {onTag && tagging === path ? (
              <View style={styles.tagChoices}>
                <FileTagChips
                  value={tag}
                  accessibilityLabel={`What ${documentName(path)} is`}
                  onChange={(next) => {
                    setTagging(null);
                    onTag(path, next);
                  }}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      {unsigned > 0 ? (
        <Text style={styles.unsigned}>
          {unsigned === 1
            ? "1 photo couldn't be loaded just now — it's still on the record."
            : `${unsigned} photos couldn't be loaded just now — they're still on the record.`}
        </Text>
      ) : null}

      {photoPaths.length === 0 && documentPaths.length === 0 && emptyLabel ? (
        <Text style={styles.empty}>{emptyLabel}</Text>
      ) : null}

      <View style={styles.row}>
        <Pressable
          onPress={() => attachPhotos('camera')}
          disabled={busy || disabled}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="Take a photo"
        >
          <Icon name="camera-outline" size="sm" color={Colors.primary} />
          <Text style={styles.addLabel}>Take photo</Text>
        </Pressable>
        <Pressable
          onPress={() => attachPhotos('library')}
          disabled={busy || disabled}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="Choose photos"
        >
          <Icon name="images-outline" size="sm" color={Colors.primary} />
          <Text style={styles.addLabel}>Choose photos</Text>
        </Pressable>
        <Pressable
          onPress={attachDocument}
          disabled={busy || disabled}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="Attach a PDF"
        >
          <Icon name="add" size="sm" color={Colors.primary} />
          <Text style={styles.addLabel}>Attach a PDF</Text>
        </Pressable>
      </View>

      <PhotoViewer
        visible={viewerAt !== null}
        photos={shown}
        startIndex={viewerAt ?? 0}
        onClose={() => setViewerAt(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { marginBottom: Spacing.sm },
  tileWrap: { marginRight: Spacing.sm },
  tile: {
    width: 96,
    height: 72,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  tileEmpty: { borderWidth: 1, borderColor: Colors.border },
  tileRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.photoOverlay,
  },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  docOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  docName: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textPrimary },
  docRemove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagTap: {
    minHeight: MIN_TOUCH_TARGET,
    maxWidth: 170,
    justifyContent: 'center',
    paddingLeft: Spacing.xs,
  },
  // The app's one chip shape: a sunken well, no border. A tag is a fact about
  // the file, so it stays neutral — no hue is spent on what a file is.
  tagPill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: Colors.sunken,
  },
  tagPillEmpty: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border },
  tagLabel: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  tagLabelEmpty: { color: Colors.textMuted },
  tagChoices: { paddingBottom: Spacing.sm },
  empty: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    paddingVertical: Spacing.sm,
  },
  // Muted, not clay. Clay is spent on an overdue date and an edited figure —
  // facts about the record. This is a fact about the network, and it says the
  // photographs are still there, so it must not read as an alarm about them.
  unsigned: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    paddingTop: Spacing.xs,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.lg, marginTop: Spacing.xs },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  addLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
});

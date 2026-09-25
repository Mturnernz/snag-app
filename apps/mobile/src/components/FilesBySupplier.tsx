import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Image, ScrollView, StyleSheet } from 'react-native';

import Icon from './Icon';
import PhotoViewer from './PhotoViewer';
import FileTagChips from './FileTagChips';
import { Group, Row } from './Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { describeFileHome, documentName, type FileGroup } from '@snag/supabase-queries';
import { FILE_TAG_LABELS, type FileTag, type FileTags, type ProjectFile } from '@snag/shared-types';
import { getFileUrl, getFileUrls } from '../lib/supabase';
import { openUrl } from '../lib/openUrl';
import { showAlert } from '../lib/alert';

interface Props {
  groups: FileGroup[];
  tags: FileTags;
  /** Tags one document, or untags it with `null`. The caller owns the write. */
  onTag: (path: string, tag: FileTag | null) => Promise<void>;
  /** Takes a file off the job itself. Only offered for those. */
  onRemove: (file: ProjectFile) => void;
}

const NO_SUPPLIER = '__none';

/**
 * Every file on the job, grouped by who it came from.
 *
 * The job's paperwork was spread across the page: the job's own files under
 * *Documents*, a quote's PDF under *On prices and parts*, and a payment's bank
 * confirmation nowhere at all. This reads `project_files` — every level, now
 * including payments — and groups it the way the money is grouped, on the
 * trimmed, lower-cased supplier name, so a supplier here and a supplier under
 * *To pay* are always the same supplier. What came from nobody (the floor plan,
 * the site photos) is last, under *Not from a supplier*.
 *
 * **A read, never a second place a file lives.** Each row says what it hangs
 * off, and a file is still added, removed and tagged exactly where it is
 * attached. The one exception is a file on the job itself, whose × is here
 * because this is the only place the job's own files are listed.
 *
 * Each heading folds, open by default, and keeps its count when folded — the
 * list tab's rule that a fold which takes the heading with it is a filter.
 */
export default function FilesBySupplier({ groups, tags, onTag, onRemove }: Props) {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [tagging, setTagging] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<{ photos: string[]; at: number } | null>(null);

  const photoPaths = useMemo(() => groups.flatMap((g) => g.photos.map((p) => p.path)), [groups]);
  useEffect(() => {
    let cancelled = false;
    if (photoPaths.length === 0) {
      setUrls({});
      return;
    }
    getFileUrls(photoPaths).then((map) => {
      if (!cancelled) setUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [photoPaths.join('|')]);

  async function open(path: string) {
    const url = await getFileUrl(path);
    if (!url) {
      showAlert("Couldn't open that", 'The link to this document could not be made.');
      return;
    }
    openUrl(url);
  }

  function toggle(key: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <View style={styles.list}>
      {groups.map((group) => {
        const key = group.key ?? NO_SUPPLIER;
        const isOpen = !folded.has(key);
        const counts = [
          group.documents.length ? `${group.documents.length} ${group.documents.length === 1 ? 'document' : 'documents'}` : null,
          group.photos.length ? `${group.photos.length} ${group.photos.length === 1 ? 'photo' : 'photos'}` : null,
        ].filter(Boolean).join(' · ');

        const rows: React.ReactNode[] = [
          <Row
            key="heading"
            title={group.name}
            subtitle={counts}
            bold
            expanded={isOpen}
            onPress={() => toggle(key)}
            accessibilityLabel={`${group.name}, ${counts}`}
          />,
        ];
        if (isOpen) {
          for (const file of group.documents) {
            const tag = tags[file.path] ?? null;
            const name = documentName(file.path);
            rows.push(
              <View key={file.path} style={styles.doc}>
                <Pressable
                  onPress={() => open(file.path)}
                  style={styles.docOpen}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}`}
                >
                  <View style={styles.lead}>
                    <Icon name="document-text-outline" size="md" color={Colors.textSecondary} />
                  </View>
                  <View style={styles.titles}>
                    <Text style={styles.docName} numberOfLines={2}>{name}</Text>
                    <Text style={styles.docHome} numberOfLines={1}>{describeFileHome(file)}</Text>
                  </View>
                </Pressable>
                {/* The door, the tag and the × are siblings, never nested. */}
                <Pressable
                  onPress={() => setTagging(tagging === file.path ? null : file.path)}
                  style={styles.tagTap}
                  accessibilityRole="button"
                  accessibilityLabel={tag ? `${FILE_TAG_LABELS[tag]} — change what ${name} is` : `Say what ${name} is`}
                  accessibilityState={{ expanded: tagging === file.path }}
                >
                  <View style={[styles.tagPill, tag ? null : styles.tagPillEmpty]}>
                    <Text style={[styles.tagLabel, tag ? null : styles.tagLabelEmpty]} numberOfLines={1}>
                      {tag ? FILE_TAG_LABELS[tag] : 'Tag'}
                    </Text>
                  </View>
                </Pressable>
                {file.level === 'project' ? (
                  <Pressable
                    onPress={() => onRemove(file)}
                    style={styles.remove}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name}`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>,
            );
            if (tagging === file.path) {
              rows.push(
                <View key={`${file.path}:tag`} style={styles.tagChoices}>
                  <FileTagChips
                    value={tag}
                    accessibilityLabel={`What ${name} is`}
                    onChange={(next) => {
                      setTagging(null);
                      onTag(file.path, next);
                    }}
                  />
                </View>,
              );
            }
          }
          if (group.photos.length > 0) {
            const shown = group.photos.map((p) => urls[p.path]).filter(Boolean);
            rows.push(
              <ScrollView key="photos" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {group.photos.map((photo, index) => (
                  <View key={photo.path} style={styles.tileWrap}>
                    <Pressable
                      onPress={() => urls[photo.path] && setViewer({ photos: shown, at: shown.indexOf(urls[photo.path]) })}
                      accessibilityRole="button"
                      accessibilityLabel={`Open photo ${index + 1} from ${group.name}, ${describeFileHome(photo)}`}
                    >
                      {urls[photo.path] ? (
                        <Image source={{ uri: urls[photo.path] }} style={styles.tile} />
                      ) : (
                        <View style={[styles.tile, styles.tileEmpty]} />
                      )}
                    </Pressable>
                    {photo.level === 'project' ? (
                      <Pressable
                        onPress={() => onRemove(photo)}
                        style={styles.tileRemove}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove photo ${index + 1}`}
                      >
                        <Icon name="close" size="sm" color={Colors.white} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </ScrollView>,
            );
          }
        }
        return <Group key={key}>{rows}</Group>;
      })}

      <PhotoViewer
        visible={viewer !== null}
        photos={viewer?.photos ?? []}
        startIndex={Math.max(viewer?.at ?? 0, 0)}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.sm + 2 },
  doc: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.xs },
  docOpen: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: 52, paddingVertical: Spacing.sm + 2, paddingLeft: Spacing.lg,
  },
  lead: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.sunken,
    alignItems: 'center', justifyContent: 'center',
  },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  docName: { fontSize: Typography.body, lineHeight: 22, color: Colors.textPrimary },
  docHome: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted },
  tagTap: { minHeight: MIN_TOUCH_TARGET, maxWidth: 170, justifyContent: 'center', paddingLeft: Spacing.xs },
  // The app's one chip shape, neutral: what a file is spends no hue.
  tagPill: {
    height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: 'center',
    backgroundColor: Colors.sunken,
  },
  tagPillEmpty: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border },
  tagLabel: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  tagLabelEmpty: { color: Colors.textMuted },
  remove: { width: MIN_TOUCH_TARGET - 8, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  tagChoices: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  strip: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  tileWrap: {},
  tile: { width: 96, height: 72, borderRadius: Radius.button, backgroundColor: Colors.sunken },
  tileEmpty: { borderWidth: 1, borderColor: Colors.border },
  tileRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.photoOverlay,
  },
});

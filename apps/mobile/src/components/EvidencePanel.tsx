import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import { EvidenceItem } from '../types';
import {
  InvestigationState, addEvidenceItem, deleteEvidenceItem, updateEvidenceCaption,
  getEvidencePhotoUrl, isImageEvidence,
} from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { showAlert } from '../lib/alert';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Icon from './Icon';
import DocumentAttach from './DocumentAttach';
import PhotoPicker, { PhotoPickerHandle } from './PhotoPicker';
import Sheet from './Sheet';

interface Props {
  issueId: string;
  /** The evidence bucket is org-folder scoped. */
  orgId: string;
  state: InvestigationState;
  onChanged: () => void;
}

// Evidence, with capture moved into a bottom sheet.
//
// The picker and a caption field used to sit inline between the witness form
// above and the root-cause form below, which is how you end up with three
// look-alike inputs and no idea which one Save applies to.
export default function EvidencePanel({ issueId, orgId, state, onChanged }: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<PhotoPickerHandle>(null);
  const [caption, setCaption] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  // A document attached alongside (or instead of) photos — a report, a
  // certificate, a datasheet. Its own evidence item, not a photo caption.
  const [document, setDocument] = useState<{ path: string; label: string } | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);

  // Editing one item's caption. Its own sheet rather than an inline field on
  // the row: the row is 48px tall and already carries a thumbnail.
  const [editing, setEditing] = useState<EvidenceItem | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setCaption('');
    setDocument(null);
    pickerRef.current?.reset();
  }

  function startEdit(item: EvidenceItem) {
    setEditing(item);
    setEditCaption(item.caption ?? '');
  }

  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    const { error } = await updateEvidenceCaption(editing.id, editCaption.trim() || null);
    setSavingEdit(false);
    if (error) {
      showToast(error.message ?? 'Could not update the caption');
      return;
    }
    setEditing(null);
    onChanged();
  }

  function confirmDelete(item: EvidenceItem) {
    // Two buttons, which is all showAlert can express — and all this needs.
    showAlert(
      'Remove this evidence?',
      item.caption
        ? `"${item.caption}" and the file behind it will be deleted.`
        : 'The file and its record will be deleted.',
      [
        { text: 'Remove', style: 'destructive', onPress: () => { void doDelete(item); } },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function doDelete(item: EvidenceItem) {
    setBusyId(item.id);
    const { error } = await deleteEvidenceItem(item.id);
    setBusyId(null);
    if (error) {
      showToast(error.message ?? 'Could not remove this evidence');
      return;
    }
    onChanged();
  }

  async function handleAdd() {
    if (blocked) {
      showToast('A photo is still uploading or failed to upload — retry or remove it first');
      return;
    }
    const photoPaths = (await pickerRef.current?.getPhotoUrls()) ?? [];
    // A document is evidence in its own right, so it takes its own row rather
    // than riding along on a photo's caption.
    const paths = document ? [...photoPaths, document.path] : photoPaths;
    if (paths.length === 0 && !caption.trim()) {
      showToast('Add a photo, a document, or a caption for the evidence');
      return;
    }
    setSaving(true);
    try {
      // One evidence item per photo.
      //
      // The picker takes several and uploads every one of them, but only
      // paths[0] used to be recorded — so somebody who added four photos of a
      // scene got one evidence item, and the other three sat in the bucket with
      // no row pointing at them. Silent, because the upload genuinely
      // succeeded; the record just never mentioned it.
      //
      // Sequential rather than Promise.all: add_evidence_item derives
      // sort_index from max(sort_index) + 1, so parallel inserts race for the
      // same number and lose the order the photos were chosen in.
      //
      // An empty media_path is the caption-only note.
      const mediaPaths = paths.length > 0 ? paths : [''];
      let saved = 0;
      let firstError: string | null = null;
      for (const mediaPath of mediaPaths) {
        // Every photo in the batch carries the caption. Photos 2..n captioned
        // with nothing would sit in a compliance record with no account of what
        // they show — repetition is the lesser problem.
        const { error } = await addEvidenceItem(issueId, mediaPath, caption.trim() || null);
        if (error) firstError = firstError ?? (error.message ?? 'Could not add evidence');
        else saved += 1;
      }
      // Anything that saved is worth keeping, so the sheet closes on a partial
      // success rather than making someone re-pick the ones that worked.
      if (saved > 0) { close(); onChanged(); }
      if (firstError) {
        showToast(saved > 0 ? `Added ${saved} of ${mediaPaths.length} — ${firstError}` : firstError);
      } else if (saved > 1) {
        showToast(`Added ${saved} evidence items`);
      }
    } catch (err: any) {
      showToast(err?.message ?? 'Could not add evidence');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {state.evidence.length === 0 ? (
        <Text style={styles.empty}>
          Nothing captured yet. Photos of the scene, the equipment, and anything that explains how
          this happened.
        </Text>
      ) : (
        state.evidence.map((e) => (
          <EvidenceRow
            key={e.id}
            item={e}
            busy={busyId === e.id}
            onEdit={() => startEdit(e)}
            onDelete={() => confirmDelete(e)}
          />
        ))
      )}

      <Button label="Add evidence" variant="outline" onPress={() => setOpen(true)} fullWidth />

      <Sheet
        visible={open}
        title="Add evidence"
        subtitle="Photos carry more than a description can. A caption on its own is fine too."
        submitLabel="Save evidence"
        onSubmit={handleAdd}
        submitting={saving}
        submitDisabled={blocked || documentBusy}
        onClose={close}
      >
        <Text style={styles.label}>Photos</Text>
        <PhotoPicker
          ref={pickerRef}
          pathPrefix={orgId}
          bucket="snag-evidence"
          onBlockingChange={setBlocked}
        />

        <Text style={styles.label}>Document</Text>
        <DocumentAttach
          orgId={orgId}
          value={document}
          onChange={setDocument}
          onBusyChange={setDocumentBusy}
        />

        <Text style={styles.label}>What does this show?</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Walkway markings worn away at the dock corner"
          placeholderTextColor={Colors.textMuted}
          value={caption}
          onChangeText={setCaption}
        />
      </Sheet>

      <Sheet
        visible={editing !== null}
        title="Edit caption"
        subtitle="What this photo shows. Correcting it is recorded, not hidden."
        submitLabel="Save caption"
        onSubmit={saveEdit}
        submitting={savingEdit}
        onClose={() => setEditing(null)}
      >
        <Text style={styles.label}>What does this show?</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Walkway markings worn away at the dock corner"
          placeholderTextColor={Colors.textMuted}
          value={editCaption}
          onChangeText={setEditCaption}
          autoFocus
        />
      </Sheet>
    </View>
  );
}

interface RowProps {
  item: EvidenceItem;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function EvidenceRow({ item, busy, onEdit, onDelete }: RowProps) {
  const [url, setUrl] = useState<string | null>(null);
  // Evidence uploaded from the portal can be any file, not just a photo.
  // Rendering a PDF through <Image> produced an empty box.
  const isPicture = isImageEvidence(item.media_path);

  useEffect(() => {
    if (item.media_path) getEvidencePhotoUrl(item.media_path).then(setUrl);
  }, [item.media_path]);

  const body = (
    <>
      {url && isPicture ? (
        <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Icon name="document-text-outline" size="md" color={url ? Colors.primary : Colors.textMuted} />
        </View>
      )}
      <Text style={styles.caption} numberOfLines={2}>
        {item.caption || (item.media_path ? item.media_path.split('/').pop() : 'Evidence')}
      </Text>
    </>
  );

  return (
    <View style={[styles.row, busy && styles.rowBusy]}>
      {/* A document is worth opening; a photo is already visible in the row.
          The actions sit outside whichever of the two the main area is, so a
          tap meant for the bin can't open a PDF instead. */}
      {url && !isPicture ? (
        <TouchableOpacity style={styles.rowMain} onPress={() => Linking.openURL(url)} activeOpacity={0.7}>
          {body}
          <Icon name="open-outline" size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      ) : (
        <View style={styles.rowMain}>{body}</View>
      )}

      <TouchableOpacity
        style={styles.action}
        onPress={onEdit}
        disabled={busy}
        accessibilityLabel="Edit caption"
        hitSlop={4}
      >
        <Icon name="create-outline" size="sm" color={Colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.action}
        onPress={onDelete}
        disabled={busy}
        accessibilityLabel="Remove evidence"
        hitSlop={4}
      >
        <Icon name="trash-outline" size="sm" color={Colors.danger} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  empty: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.xs,
  },
  rowBusy: { opacity: 0.5 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  action: {
    width: MIN_TOUCH_TARGET - Spacing.sm,
    height: MIN_TOUCH_TARGET - Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 48, height: 48, borderRadius: Radius.button },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  caption: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary },

  label: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
});

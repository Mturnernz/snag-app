import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import { EvidenceItem } from '../types';
import { InvestigationState, addEvidenceItem, getEvidencePhotoUrl, isImageEvidence } from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Icon from './Icon';
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

  function close() {
    setOpen(false);
    setCaption('');
    pickerRef.current?.reset();
  }

  async function handleAdd() {
    if (blocked) {
      showToast('A photo is still uploading or failed to upload — retry or remove it first');
      return;
    }
    const paths = (await pickerRef.current?.getPhotoUrls()) ?? [];
    if (paths.length === 0 && !caption.trim()) {
      showToast('Add a photo or a caption for the evidence');
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
        state.evidence.map((e) => <EvidenceRow key={e.id} item={e} />)
      )}

      <Button label="Add evidence" variant="outline" onPress={() => setOpen(true)} fullWidth />

      <Sheet
        visible={open}
        title="Add evidence"
        subtitle="Photos carry more than a description can. A caption on its own is fine too."
        submitLabel="Save evidence"
        onSubmit={handleAdd}
        submitting={saving}
        submitDisabled={blocked}
        onClose={close}
      >
        <Text style={styles.label}>Photos</Text>
        <PhotoPicker
          ref={pickerRef}
          pathPrefix={orgId}
          bucket="snag-evidence"
          onBlockingChange={setBlocked}
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
    </View>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
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

  // A document is worth opening; a photo is already visible in the row.
  if (url && !isPicture) {
    return (
      <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(url)} activeOpacity={0.7}>
        {body}
        <Icon name="open-outline" size="sm" color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }
  return <View style={styles.row}>{body}</View>;
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  empty: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.xs,
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

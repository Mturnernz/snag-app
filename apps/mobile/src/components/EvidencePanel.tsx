import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import { EvidenceItem } from '../types';
import { InvestigationState, addEvidenceItem, getEvidencePhotoUrl } from '../lib/supabase';
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
    // add_evidence_item takes a single media_path; use the first photo (an
    // empty string when this is a caption-only note).
    const { error } = await addEvidenceItem(issueId, paths[0] ?? '', caption.trim() || null);
    setSaving(false);
    if (error) showToast(error.message ?? 'Could not add evidence');
    else { close(); onChanged(); }
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
  useEffect(() => {
    if (item.media_path) getEvidencePhotoUrl(item.media_path).then(setUrl);
  }, [item.media_path]);

  return (
    <View style={styles.row}>
      {url ? (
        <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Icon name="document-text-outline" size="md" color={Colors.textMuted} />
        </View>
      )}
      <Text style={styles.caption} numberOfLines={2}>{item.caption || 'Evidence'}</Text>
    </View>
  );
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

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import {
  OrgDocument, getOrgDocuments, uploadSnagDocumentFromUri, copyOrgDocumentToSnagEvidence,
} from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Icon from './Icon';
import Sheet from './Sheet';

interface Props {
  /** snag-evidence is org-folder scoped; uploads and copies both land there. */
  orgId: string;
  /** Current attachment: a path in snag-evidence, plus what to call it. */
  value: { path: string; label: string } | null;
  onChange: (value: { path: string; label: string } | null) => void;
  /** Reports whether an upload/copy is in flight, so the caller can hold its
   *  submit button — the same contract PhotoPicker has. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Attach a document to a snag, from the phone's files or from the org library.
 *
 * The library route **copies** the file into snag-evidence rather than pointing
 * at the library's own object. Referencing would be cheaper and it is what
 * `investigations.document_id` does — but a snag's evidence is the record of
 * what happened, and someone clearing out the library two years from now must
 * not be able to empty it. A copy is a record that stands on its own.
 */
export default function DocumentAttach({ orgId, value, onChange, onBusyChange }: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [documents, setDocuments] = useState<OrgDocument[] | null>(null);

  function setBusyState(next: boolean) {
    setBusy(next);
    onBusyChange?.(next);
  }

  async function pickFromFiles() {
    // expo-document-picker has a real web implementation (an <input type=file>),
    // unlike expo-camera and expo-file-system — see the platform note in
    // CLAUDE.md before adding any other native module here.
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setBusyState(true);
    const { path, error } = await uploadSnagDocumentFromUri(
      orgId, asset.uri, asset.name ?? 'document', asset.mimeType,
    );
    setBusyState(false);
    if (error || !path) {
      showToast(error?.message ?? "Couldn't upload that file");
      return;
    }
    onChange({ path, label: asset.name ?? 'Document' });
  }

  async function openLibrary() {
    setLibraryOpen(true);
    if (documents === null) setDocuments(await getOrgDocuments(orgId));
  }

  async function chooseFromLibrary(doc: OrgDocument) {
    setLibraryOpen(false);
    setBusyState(true);
    const { path, error } = await copyOrgDocumentToSnagEvidence(orgId, doc.file_path);
    setBusyState(false);
    if (error || !path) {
      showToast(error?.message ?? "Couldn't copy that document");
      return;
    }
    onChange({ path, label: doc.title });
  }

  if (value) {
    return (
      <View style={styles.attached}>
        <Icon name="document-text-outline" size="md" color={Colors.primary} />
        <Text style={styles.attachedLabel} numberOfLines={2}>{value.label}</Text>
        <TouchableOpacity
          style={styles.remove}
          onPress={() => onChange(null)}
          accessibilityLabel="Remove this document"
          hitSlop={6}
        >
          <Icon name="close" size="sm" color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <View style={styles.row}>
        <TouchableOpacity style={styles.button} onPress={pickFromFiles} disabled={busy} activeOpacity={0.7}>
          {busy ? <ActivityIndicator size="small" color={Colors.textSecondary} /> : (
            <>
              <Icon name="folder-open-outline" size="sm" color={Colors.textSecondary} />
              <Text style={styles.buttonText}>From my files</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={openLibrary} disabled={busy} activeOpacity={0.7}>
          <Icon name="library-outline" size="sm" color={Colors.textSecondary} />
          <Text style={styles.buttonText}>From the library</Text>
        </TouchableOpacity>
      </View>

      <Sheet
        visible={libraryOpen}
        title="Document library"
        subtitle="A copy is taken, so the snag keeps it even if the library changes."
        onClose={() => setLibraryOpen(false)}
      >
        {documents === null ? (
          <ActivityIndicator color={Colors.primary} />
        ) : documents.length === 0 ? (
          <Text style={styles.empty}>
            Nothing in the library yet. Documents added under Profile → Documents show up here.
          </Text>
        ) : (
          documents.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={styles.docRow}
              onPress={() => chooseFromLibrary(doc)}
              activeOpacity={0.7}
            >
              <Icon name="document-text-outline" size="md" color={Colors.textSecondary} />
              <View style={styles.docText}>
                <Text style={styles.docTitle} numberOfLines={1}>{doc.title}</Text>
                {doc.category ? <Text style={styles.docMeta}>{doc.category}</Text> : null}
              </View>
            </TouchableOpacity>
          ))
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    paddingHorizontal: Spacing.sm,
  },
  buttonText: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },

  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.sm,
  },
  attachedLabel: { flex: 1, fontSize: Typography.sm, color: Colors.textPrimary },
  remove: {
    width: MIN_TOUCH_TARGET - Spacing.sm,
    height: MIN_TOUCH_TARGET - Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.sm,
  },
  docText: { flex: 1, gap: 2 },
  docTitle: { fontSize: Typography.base, color: Colors.textPrimary, fontWeight: Typography.medium },
  docMeta: { fontSize: Typography.xs, color: Colors.textMuted },
});

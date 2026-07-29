import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { Profile } from '../types';
import {
  InvestigationState, OrgDocument,
  getOrgDocuments, createOrgDocument, uploadOrgDocumentFromUri, getOrgDocumentUrl,
  attachInvestigationDocument, acceptInvestigationDocument,
} from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Icon from './Icon';
import Sheet from './Sheet';

interface Props {
  issueId: string;
  orgId: string;
  state: InvestigationState;
  /** Supervisor/admin on this site. Accepting is a supervisor's act. */
  canEdit: boolean;
  /** For naming who attached and who accepted — see the note on the meta line. */
  orgMembers: Profile[];
  onChanged: () => void;
}

/**
 * The organisation's own investigation, as a document.
 *
 * This card stands where root cause and corrective actions stand on the guided
 * path — a substitution, not a shortcut. Everything before it (the notifiable
 * decision, the checklist, a witness statement, evidence) is still required,
 * and two conditions replace the two it displaces: a document is attached, and
 * a supervisor accepts it.
 *
 * The acceptance need not be a *different* supervisor: a site lead allocates the
 * investigation to a crew, so the crew that completes it and the supervisor who
 * signs it off are already different people without a rule forcing it — and
 * forcing it deadlocked the case where the supervisor did the work themselves.
 * So the card names who attached and who accepted instead of preventing them
 * from being the same person.
 */
export default function InvestigationDocumentPanel({
  issueId, orgId, state, canEdit, orgMembers, onChanged,
}: Props) {
  const { showToast } = useToast();

  const [library, setLibrary] = useState<OrgDocument[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const loadLibrary = useCallback(async () => {
    setLibrary(await getOrgDocuments(orgId));
  }, [orgId]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const attached = Boolean(state.documentId);
  const nameOf = (id: string | null) =>
    (id ? orgMembers.find((m) => m.id === id)?.name : null) ?? null;

  function closeSheet() {
    setPickerOpen(false);
    setPicked(null);
    setTitle('');
  }

  async function handlePick() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPicked(asset);
    if (!title.trim()) setTitle(asset.name.replace(/\.[^.]+$/, ''));
  }

  // Uploads go into the org library on the way past rather than into a per-snag
  // hiding place — an investigation report is an organisational record, and the
  // person who needs it in two years wasn't on this snag.
  async function handleUploadAndAttach() {
    if (!picked) { showToast('Choose a file first'); return; }
    if (!title.trim()) { showToast('Give the document a title'); return; }

    setBusy(true);
    const { path, error: uploadError } = await uploadOrgDocumentFromUri(
      orgId, picked.uri, picked.name, picked.mimeType,
    );
    if (uploadError || !path) {
      setBusy(false);
      showToast(uploadError?.message ?? 'Upload failed');
      return;
    }
    const { id, error: createError } = await createOrgDocument(path, title.trim(), 'investigation');
    if (createError || !id) {
      setBusy(false);
      showToast(createError?.message ?? 'Could not file the document');
      return;
    }
    const { error } = await attachInvestigationDocument(issueId, id);
    setBusy(false);
    if (error) { showToast(error.message ?? 'Could not attach the document'); return; }

    showToast('Document attached');
    closeSheet();
    loadLibrary();
    onChanged();
  }

  async function handleAttachExisting(doc: OrgDocument) {
    setBusy(true);
    const { error } = await attachInvestigationDocument(issueId, doc.id);
    setBusy(false);
    if (error) { showToast(error.message ?? 'Could not attach the document'); return; }
    showToast('Document attached');
    closeSheet();
    onChanged();
  }

  async function handleAccept() {
    setBusy(true);
    const { error } = await acceptInvestigationDocument(issueId);
    setBusy(false);
    if (error) { showToast(error.message ?? 'Could not accept the document'); return; }
    showToast('Investigation accepted');
    onChanged();
  }

  async function handleOpen() {
    if (!state.documentPath) return;
    const url = await getOrgDocumentUrl(state.documentPath);
    if (!url) { showToast('Could not open that document'); return; }
    Linking.openURL(url);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        This snag is being investigated under your organisation&apos;s own process. The completed
        document takes the place of the root cause and corrective actions — everything before this
        point still applies.
      </Text>

      {attached ? (
        <TouchableOpacity style={styles.doc} onPress={handleOpen} accessibilityRole="button">
          <Icon name="document-text-outline" size="md" color={Colors.textSecondary} />
          <View style={styles.docText}>
            <Text style={styles.docTitle}>{state.documentTitle ?? 'Investigation document'}</Text>
            {/* Names both, because the record is what carries this now. When
                the same person appears twice, that is visible rather than
                prevented. */}
            <Text style={styles.docMeta}>
              Attached by {nameOf(state.documentAttachedBy) ?? 'someone in your organisation'}
              {state.documentAccepted
                ? ` · accepted by ${nameOf(state.documentAcceptedBy) ?? 'a supervisor'}`
                : ' · not yet accepted'}
            </Text>
          </View>
          <Icon name="open-outline" size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      ) : (
        <Text style={styles.empty}>
          No investigation document attached yet.
        </Text>
      )}

      {/* Attaching is still not accepting — the gate wants a supervisor to have
          read it and said so. But it need not be a *different* supervisor: a
          site lead allocates the investigation to a crew, so the two are
          usually different people anyway, and forcing it deadlocked the case
          where the supervisor did the work themselves. The record names both,
          which is the half worth keeping. */}
      {attached && !state.documentAccepted && (
        canEdit ? (
          <Button
            label="Accept this document"
            variant="primary"
            loading={busy}
            onPress={handleAccept}
            fullWidth
          />
        ) : (
          <View style={styles.blocked}>
            <Icon name="lock-closed-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.blockedText}>
              A supervisor has to read it and sign it off before this snag can be resolved.
            </Text>
          </View>
        )
      )}

      <Button
        label={attached ? 'Replace the document' : 'Attach a document'}
        variant="outline"
        icon="attach-outline"
        onPress={() => setPickerOpen(true)}
        fullWidth
      />

      {state.documentAccepted && (
        <Text style={styles.footnote}>
          Replacing the document clears this acceptance — a different document is a different
          investigation.
        </Text>
      )}

      <Sheet visible={pickerOpen} onClose={closeSheet} title="Investigation document">
        <Text style={styles.hint}>
          Upload the completed investigation, or pick one already in your organisation&apos;s
          document library. Either way it&apos;s filed in the library, so it can be found later by
          someone who wasn&apos;t involved.
        </Text>

        <Button
          label={picked ? picked.name : 'Choose a file'}
          variant="outline"
          icon={picked ? 'document-text-outline' : 'add-outline'}
          onPress={handlePick}
          fullWidth
        />
        {picked && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Title"
              placeholderTextColor={Colors.textMuted}
              value={title}
              onChangeText={setTitle}
            />
            <Button
              label="Upload and attach"
              variant="primary"
              loading={busy}
              onPress={handleUploadAndAttach}
              fullWidth
            />
          </>
        )}

        {library.length > 0 && (
          <>
            <Text style={styles.sheetHeading}>Already in the library</Text>
            {library.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.libraryRow}
                onPress={() => handleAttachExisting(doc)}
                accessibilityRole="button"
                accessibilityLabel={`Attach ${doc.title}`}
              >
                <Icon name="document-text-outline" size="sm" color={Colors.textSecondary} />
                <Text style={styles.libraryTitle} numberOfLines={1}>{doc.title}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  hint: {
    fontSize: Typography.xs,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  empty: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  footnote: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },

  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
  },
  docText: { flex: 1 },
  docTitle: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
    fontWeight: Typography.medium,
  },
  docMeta: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },

  blocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
  },
  blockedText: {
    flex: 1,
    fontSize: Typography.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },

  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },

  sheetHeading: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.button,
  },
  libraryTitle: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
});

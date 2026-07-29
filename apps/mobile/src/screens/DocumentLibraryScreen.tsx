import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';

import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  supabase, getOrgDocuments, createOrgDocument, uploadOrgDocumentFromUri,
  getOrgDocumentUrl, type OrgDocument,
} from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';

// The organisation's document register, on the phone.
//
// It existed only in the portal, which workers can't reach — so the policies,
// procedures and investigation templates an organisation keeps here were
// invisible to exactly the people expected to follow them. Read *and* upload:
// someone running an investigation under their org's own process has to be able
// to file the completed document, and a library nobody can contribute to is a
// filing cabinet with one key. Deleting stays a supervisor's call and lives in
// the portal.
export default function DocumentLibraryScreen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<OrgDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: profile } = await supabase
      .from('profiles').select('org_id').eq('id', user.id).single();
    const org = (profile as any)?.org_id ?? null;
    setOrgId(org);
    setDocuments(org ? await getOrgDocuments(org) : []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handlePick() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPicked(asset);
    // Pre-fill from the file name, minus the extension — a title is required,
    // and making people retype what they just picked is the fastest way to get
    // a library full of "doc1".
    if (!title.trim()) setTitle(asset.name.replace(/\.[^.]+$/, ''));
  }

  async function handleUpload() {
    if (!orgId || !picked) { showToast('Choose a file first'); return; }
    if (!title.trim()) { showToast('Give the document a title'); return; }

    setUploading(true);
    const { path, error: uploadError } = await uploadOrgDocumentFromUri(
      orgId, picked.uri, picked.name, picked.mimeType,
    );
    if (uploadError || !path) {
      setUploading(false);
      showToast(uploadError?.message ?? 'Upload failed');
      return;
    }
    const { error } = await createOrgDocument(path, title.trim());
    setUploading(false);
    if (error) { showToast(error.message ?? 'Could not file the document'); return; }

    showToast('Document added');
    setPicked(null);
    setTitle('');
    load();
  }

  async function handleOpen(doc: OrgDocument) {
    const url = await getOrgDocumentUrl(doc.file_path);
    if (!url) { showToast('Could not open that document'); return; }
    Linking.openURL(url);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Documents" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={Colors.primary}
          />
        }
      >
        <Card style={styles.uploadCard}>
          <Text style={styles.uploadTitle}>Add a document</Text>
          <Text style={styles.hint}>
            Policies, procedures, or a completed investigation. Everyone in your organisation
            can see what&apos;s here.
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
                label="Upload"
                variant="primary"
                loading={uploading}
                onPress={handleUpload}
                fullWidth
              />
            </>
          )}
        </Card>

        {loading ? (
          <ActivityIndicator style={styles.loading} color={Colors.primary} />
        ) : documents.length === 0 ? (
          <EmptyState
            icon="folder-open-outline"
            title="No documents yet"
            message="Your organisation's policies and procedures will show up here once someone adds them."
          />
        ) : (
          documents.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={styles.row}
              onPress={() => handleOpen(doc)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${doc.title}`}
            >
              <Icon name="document-text-outline" size="md" color={Colors.textSecondary} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{doc.title}</Text>
                <Text style={styles.rowMeta}>
                  {doc.category ? `${doc.category} · ` : ''}
                  {doc.uploader_name ?? 'Unknown'}
                </Text>
              </View>
              <Icon name="chevron-forward-outline" size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
  loading: { marginTop: Spacing.xl },

  uploadCard: { gap: Spacing.sm },
  uploadTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  hint: {
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

  row: {
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
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
    fontWeight: Typography.medium,
  },
  rowMeta: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
});

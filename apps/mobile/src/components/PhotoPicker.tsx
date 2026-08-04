import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { uploadSnagPhoto } from '../lib/supabase';
import { withDeadline, failureReason } from '../lib/deadline';
import { showAlert } from '../lib/alert';
import Icon from './Icon';

const MAX_PHOTOS = 5;
const THUMB_SIZE = 92;

/**
 * The two stages are bounded separately, and say which one gave up, because
 * "the photo didn't upload" has two completely different causes and a
 * screenshot of the failure is usually all the evidence there is.
 *
 * Preparing is local: decode, resize, re-encode, all inside a native/browser
 * module that can simply never call back. Nothing has been sent, so 30s is
 * already generous.
 *
 * Sending has its own 60s deadline on the request itself (`fetchWithTimeout` in
 * lib/supabase.ts) — a photo on a bad site connection is slow rather than
 * broken. This backstop sits just past it, so the normal outcome is the
 * request's own "no reply from the server" and this only fires if something
 * before the request stalls.
 */
const PREPARE_DEADLINE_MS = 30_000;
const SEND_DEADLINE_MS = 65_000;

type PhotoStatus = 'uploading' | 'success' | 'failed';

interface PhotoItem {
  id: string;
  uri: string;
  fileName: string;
  path: string | null;
  status: PhotoStatus;
  /** Why this photo failed, shown to the user. A photo that failed for a
   *  reason nobody can see costs a screenshot and a round trip to diagnose. */
  error: string | null;
}

export interface PhotoPickerHandle {
  /** The uploaded photo paths. Only ever called once nothing is uploading or
   *  failed (the caller's Submit is disabled until then via
   *  onBlockingChange), so every remaining photo here has already
   *  succeeded. */
  getPhotoUrls: () => Promise<string[]>;
  /** Raw local URIs of the current picks, independent of upload state — used
   *  to carry photos over to another PhotoPicker instance (e.g. switching
   *  from the niggle form into the serious-incident flow). */
  getLocalUris: () => string[];
  reset: () => void;
}

interface Props {
  /** Storage folder prefix required by the bucket's RLS policies: the org id
   *  for members, or the user's own id for public submissions. Uploads wait
   *  until this is known. */
  pathPrefix: string | null;
  /** Storage bucket to upload into. Defaults to snag-photos; the investigation
   *  evidence picker passes 'snag-evidence'. */
  bucket?: string;
  /** True while offline — skip the eager upload and just stage the local
   *  URI (status 'success', no path yet) so a picked photo doesn't sit
   *  permanently 'failed' with no connectivity to retry against. The
   *  offline queue re-reads these via getLocalUris() and uploads them
   *  itself once connectivity returns. */
  deferUpload?: boolean;
  /** Local URIs to pre-load on mount (once pathPrefix is known), e.g. photos
   *  carried over from another report flow. Only seeded once. */
  initialUris?: string[];
  /** True while any photo is uploading OR sits in a failed state needing the
   *  user's attention (retry or remove) — callers should disable Submit
   *  while this is true, so a failed upload can never be silently excluded
   *  from what gets submitted. */
  onBlockingChange?: (blocking: boolean) => void;
  onPhotosChange?: (count: number) => void;
  /** Tightens the empty state's padding for a form that has to fit one
   *  screen (the niggle report). Nothing else about it changes. */
  compact?: boolean;
}

const PhotoPicker = forwardRef<PhotoPickerHandle, Props>(({ pathPrefix, bucket, deferUpload, initialUris, onBlockingChange, onPhotosChange, compact }, ref) => {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const seededRef = useRef(false);

  useEffect(() => {
    onPhotosChange?.(photos.length);
  }, [photos.length, onPhotosChange]);

  useEffect(() => {
    onBlockingChange?.(photos.some((p) => p.status === 'uploading' || p.status === 'failed'));
  }, [photos, onBlockingChange]);

  async function compressAndUpload(uri: string, fileName: string) {
    const compressed = await withDeadline(
      ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      ),
      PREPARE_DEADLINE_MS,
      'Preparing',
    );
    try {
      return await withDeadline(uploadSnagPhoto(compressed.uri, fileName, bucket), SEND_DEADLINE_MS, 'Sending');
    } finally {
      // On web the compressed copy is an object URL held by the document until
      // it's revoked, and a phone browser doing this five times over is the
      // most memory-hungry thing this screen does. The thumbnail renders from
      // the original `uri`, not this one, so nothing on screen needs it after
      // the upload.
      if (compressed.uri.startsWith('blob:')) URL.revokeObjectURL(compressed.uri);
    }
  }

  async function runUpload(id: string, uri: string, fileName: string) {
    setPhotos((prev) => prev.map((p) => (
      p.id === id ? { ...p, status: 'uploading', path: null, error: null } : p
    )));
    // Nothing may escape and nothing may hang: this is called without being
    // awaited, so a throw anywhere in here (compression, not just the upload),
    // or a stage that never calls back, would leave the photo 'uploading' for
    // good — a spinner that never resolves and a Submit button disabled behind
    // it, with no way back but reloading the screen.
    try {
      const { path, error } = await compressAndUpload(uri, fileName);
      if (error || !path) console.error('Photo upload error:', error);
      setPhotos((prev) => prev.map((p) => (
        p.id === id
          ? {
            ...p,
            status: error || !path ? 'failed' : 'success',
            path,
            error: error || !path ? failureReason(error) : null,
          }
          : p
      )));
    } catch (err) {
      console.error('Photo upload error:', err);
      setPhotos((prev) => prev.map((p) => (
        p.id === id ? { ...p, status: 'failed', path: null, error: failureReason(err) } : p
      )));
    }
  }

  function addPhoto(uri: string) {
    if (!pathPrefix) return;
    const id = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const fileName = `${pathPrefix}/${id}.jpg`;
    if (deferUpload) {
      // Offline — stage it as already "done" from this component's point of
      // view (no spinner, doesn't block submit). The real upload happens
      // later, out of band, when the offline queue drains.
      setPhotos((prev) => [...prev, { id, uri, fileName, path: null, status: 'success', error: null }]);
      return;
    }
    setPhotos((prev) => [...prev, { id, uri, fileName, path: null, status: 'uploading', error: null }]);
    runUpload(id, uri, fileName);
  }

  function retryPhoto(id: string) {
    const photo = photos.find((p) => p.id === id);
    if (photo) runUpload(photo.id, photo.uri, photo.fileName);
  }

  // Seed with photos carried over from another PhotoPicker instance, once
  // pathPrefix is known (uploads can't start before then). Runs once.
  useEffect(() => {
    if (seededRef.current || !pathPrefix || !initialUris || initialUris.length === 0) return;
    seededRef.current = true;
    initialUris.slice(0, MAX_PHOTOS).forEach((uri) => addPhoto(uri));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathPrefix, initialUris]);

  function offerSource() {
    // Three choices is more than a browser dialog can offer, and on web it
    // doesn't need to: the file picker a library pick opens already includes
    // the camera as a source. Asking first would be a dialog whose options the
    // next dialog repeats.
    if (Platform.OS === 'web') {
      pickFromLibrary();
      return;
    }
    showAlert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickFromLibrary() {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
      exif: false,
    });
    if (!result.canceled) {
      // selectionLimit is a request to the OS picker, not a guarantee. iOS and
      // Android 13+ honour it; the web build ignores it outright —
      // expo-image-picker's web path is an <input type="file" multiple> that
      // never reads the option — so picking twelve on app.snaghq.co.nz used to
      // add twelve, and "Add up to 5 photos" was the only thing enforcing the
      // cap there. Enforce it on what comes back, so every platform agrees
      // with the label.
      const accepted = result.assets.slice(0, remaining);
      accepted.forEach((asset) => addPhoto(asset.uri));
      const dropped = result.assets.slice(remaining);
      if (dropped.length > 0) {
        // Web assets are object URLs held by the document until revoked, and
        // nothing downstream will ever see these ones.
        dropped.forEach((asset) => {
          if (asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
        });
        // Say so. Silently keeping some of a selection is the same class of
        // bug as silently keeping the first of five.
        showAlert(
          `Up to ${MAX_PHOTOS} photos`,
          `You chose ${result.assets.length}. The first ${accepted.length} ${accepted.length === 1 ? 'was' : 'were'} added.`,
        );
      }
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission required', 'Camera access is needed to take photos.');
      return;
    }
    // No allowsEditing — the camera's own retake/use-photo confirmation is
    // enough; a forced crop step after every shot was extra friction.
    const result = await ImagePicker.launchCameraAsync({
      quality: 1,
      exif: false,
    });
    if (!result.canceled) {
      addPhoto(result.assets[0].uri);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  const failedReason = photos.find((p) => p.status === 'failed')?.error ?? null;
  const hasFailed = photos.some((p) => p.status === 'failed');

  useImperativeHandle(ref, () => ({
    getPhotoUrls: async () =>
      photos.filter((p): p is PhotoItem & { path: string } => p.status === 'success' && Boolean(p.path)).map((p) => p.path),
    getLocalUris: () => photos.map((p) => p.uri),
    reset: () => setPhotos([]),
  }));

  if (photos.length === 0) {
    return (
      <View style={[styles.area, compact && styles.areaCompact]}>
        <Icon name="camera-outline" size={compact ? 'lg' : 'xl'} color={Colors.textSecondary} />
        <Text style={styles.label}>Add up to {MAX_PHOTOS} photos</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={takePhoto} activeOpacity={0.7} disabled={!pathPrefix}>
            <Text style={styles.buttonText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={pickFromLibrary} activeOpacity={0.7} disabled={!pathPrefix}>
            <Text style={styles.buttonText}>Choose from Library</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
        {photos.map((photo) => (
          <View key={photo.id} style={[styles.thumbWrap, photo.status === 'failed' && styles.thumbWrapFailed]}>
            <Image source={{ uri: photo.uri }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
            {photo.status === 'uploading' && (
              <View style={styles.uploadingOverlay}>
                <ActivityIndicator color={Colors.white} size="small" />
              </View>
            )}
            {photo.status === 'failed' && (
              <TouchableOpacity style={styles.failedOverlay} onPress={() => retryPhoto(photo.id)} activeOpacity={0.8}>
                <Icon name="refresh" size="md" color={Colors.white} />
                <Text style={styles.failedText}>Retry</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.removeButton} onPress={() => removePhoto(photo.id)} hitSlop={8}>
              <Icon name="close" size="sm" color={Colors.white} />
            </TouchableOpacity>
          </View>
        ))}
        {photos.length < MAX_PHOTOS && (
          <TouchableOpacity style={styles.addTile} onPress={offerSource} activeOpacity={0.7}>
            <Icon name="add" size="lg" color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </ScrollView>
      {hasFailed && (
        <Text style={styles.failedHint}>
          {failedReason
            ? `Couldn't upload a photo (${failedReason}) — tap it to retry, or remove it.`
            : "Couldn't upload a photo — tap it to retry, or remove it."}
        </Text>
      )}
    </View>
  );
});

export default PhotoPicker;

const styles = StyleSheet.create({
  area: {
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: Spacing.md,
  },
  areaCompact: {
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  label: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    width: '100%',
  },
  button: {
    flex: 1,
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  buttonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  wrap: {
    gap: Spacing.xs,
  },
  thumbRow: {
    gap: Spacing.sm,
  },
  thumbWrap: {
    position: 'relative',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  thumbWrapFailed: {
    borderWidth: 2,
    borderColor: Colors.danger,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(220, 38, 38, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  failedText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  failedHint: {
    fontSize: Typography.xs,
    color: Colors.danger,
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

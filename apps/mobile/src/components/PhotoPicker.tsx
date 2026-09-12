import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
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
  /** Raw local URIs of the current picks, independent of upload state. */
  getLocalUris: () => string[];
  reset: () => void;
}

interface Props {
  /** Storage folder prefix required by the bucket's RLS policies: the
   *  household id. `home-photos` is laid out as `<household_id>/<file>` and
   *  the policy reads that first segment, so this is not cosmetic. Uploads
   *  wait until it is known. */
  pathPrefix: string | null;
  /** Storage bucket to upload into. Defaults to home-photos. */
  bucket?: string;
  /** True while offline — skip the eager upload and just stage the local URI
   *  (status 'success', no path yet) so a picked photo doesn't sit permanently
   *  'failed' with no connectivity to retry against. */
  deferUpload?: boolean;
  /** Local URIs to pre-load on mount, once pathPrefix is known. Seeded once. */
  initialUris?: string[];
  /** True while any photo is uploading OR sits in a failed state needing the
   *  user's attention (retry or remove) — callers should disable Submit
   *  while this is true, so a failed upload can never be silently excluded
   *  from what gets submitted. */
  onBlockingChange?: (blocking: boolean) => void;
  onPhotosChange?: (count: number) => void;
}

const PhotoPicker = forwardRef<PhotoPickerHandle, Props>(({ pathPrefix, bucket, deferUpload, initialUris, onBlockingChange, onPhotosChange }, ref) => {
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
    if (MAX_PHOTOS - photos.length <= 0) return;

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Camera access needed', 'Allow camera access to take a photo, or choose one from your library instead.');
      return;
    }
    // No allowsEditing — the camera's own retake/use-photo confirmation is
    // enough; a forced crop step after every shot was extra friction.
    //
    // `cameraType` is what makes this work in the browser, which is where the
    // app is actually installed. expo-image-picker's web path renders a file
    // input, and only `launchCameraAsync` sets `capture` on it — `back` maps to
    // capture="environment", so a phone browser opens the rear camera instead
    // of a file browser. Without it you get the gallery, which is the bug this
    // replaced.
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.back,
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

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
        {photos.length < MAX_PHOTOS && (
          <>
            {/*
              Two tiles, not one behind a dialog. The camera is the common case
              — you are standing in front of the thing — so it should not be a
              second tap behind a question, and `showAlert` cannot offer a
              three-way choice anyway (see lib/alert.ts).
            */}
            <TouchableOpacity
              style={styles.addTile}
              onPress={takePhoto}
              activeOpacity={0.7}
              disabled={!pathPrefix}
              accessibilityRole="button"
              accessibilityLabel={`Take a photo${photos.length > 0 ? `, ${photos.length} of ${MAX_PHOTOS} added` : ''}`}
            >
              <Icon name="camera-outline" size="lg" color={Colors.primary} />
              <Text style={styles.addTileLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addTile}
              onPress={pickFromLibrary}
              activeOpacity={0.7}
              disabled={!pathPrefix}
              accessibilityRole="button"
              accessibilityLabel={`Choose from your library${photos.length > 0 ? `, ${photos.length} of ${MAX_PHOTOS} added` : ''}`}
            >
              <Icon name="images-outline" size="lg" color={Colors.primary} />
              <Text style={styles.addTileLabel}>Library</Text>
            </TouchableOpacity>
          </>
        )}
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
      </ScrollView>
      <Text style={styles.countHint}>
        {photos.length === 0 ? `Add up to ${MAX_PHOTOS} photos` : `${photos.length} of ${MAX_PHOTOS} photos`}
      </Text>
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
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  addTileLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  countHint: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },
});

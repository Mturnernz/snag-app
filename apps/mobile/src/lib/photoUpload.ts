import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { uploadSnagPhoto } from './supabase';
import { withDeadline } from './deadline';
import { showAlert } from './alert';

/**
 * Taking one photo and getting it into storage.
 *
 * Extracted from PhotoPicker so the compose bar can use the same path rather
 * than growing a second one. The tray still owns the multi-photo tray state —
 * the cap, the retries, the per-photo status — this is only the part both need.
 */

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
 * lib/supabase.ts) — a photo on a bad connection is slow rather than broken.
 * This backstop sits just past it, so the normal outcome is the request's own
 * "no reply from the server" and this only fires if something before the
 * request stalls.
 */
const PREPARE_DEADLINE_MS = 30_000;
const SEND_DEADLINE_MS = 65_000;

export const PHOTO_BUCKET = 'home-photos';

/** Resizes, compresses and uploads. Resolves to the storage path, or an error. */
export async function compressAndUpload(
  uri: string,
  fileName: string,
  bucket?: string
): Promise<{ path: string | null; error: unknown }> {
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
    return await withDeadline(
      uploadSnagPhoto(compressed.uri, fileName, bucket),
      SEND_DEADLINE_MS,
      'Sending',
    );
  } finally {
    // On web the compressed copy is an object URL held by the document until
    // it's revoked, and a phone browser doing this repeatedly is the most
    // memory-hungry thing the app does. Nothing on screen renders from it.
    if (compressed.uri.startsWith('blob:')) URL.revokeObjectURL(compressed.uri);
  }
}

/**
 * Opens the camera and returns the local URI, or null if it was declined or
 * cancelled.
 *
 * `cameraType` is what makes this work in the browser, which is where the app
 * is actually installed: expo-image-picker's web path renders a file input, and
 * only `launchCameraAsync` sets `capture` on it — `back` maps to
 * `capture="environment"`, so a phone browser opens the rear camera rather than
 * a file browser. Without it you get the gallery, which is not the same
 * feature.
 */
export async function takePhoto(): Promise<string | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    showAlert(
      'Camera access needed',
      'Allow camera access to take a photo, or choose one from your library instead.',
    );
    return null;
  }

  // No allowsEditing — the camera's own retake/use confirmation is enough, and
  // a forced crop after every shot is friction at the worst moment.
  const result = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.back,
    quality: 1,
    exif: false,
  });

  return result.canceled ? null : result.assets[0].uri;
}

/** A storage path nobody else will claim, under this household's folder. */
export function photoFileName(pathPrefix: string): string {
  return `${pathPrefix}/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
}

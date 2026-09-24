import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { uploadPhoto } from './supabase';
import { withDeadline } from './deadline';
import { showAlert } from './alert';

/**
 * Taking one photo and getting it into storage.
 *
 * One path, shared by everything that takes a picture: the compose bar, the
 * walkthrough's step three, and a thing's spec sheet. Each owns its own state
 * around it — the cap, the retry, what the photo is for — and none of them owns
 * a second way of getting the bytes into the bucket.
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

// The bucket's name lives in one place. It was declared here as well as in
// lib/supabase.ts, which is two strings that have to agree about a storage
// policy's idea of where a household's files live.
export { HOUSEHOLD_FILES_BUCKET } from './supabase';

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
      uploadPhoto(compressed.uri, fileName, bucket),
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

/**
 * How many a single go will take.
 *
 * Not a product rule, a protection: each photograph is decoded, resized and
 * re-encoded before it is sent, one after another, and somebody who taps
 * *select all* on a camera roll would otherwise sit in front of a spinner for
 * several minutes with no way back. Five is a plausible number of angles on one
 * appliance, and anything past it is said out loud rather than dropped in
 * silence.
 */
export const PHOTO_PICK_LIMIT = 5;

/**
 * Opens the picker for **several** photographs at once.
 *
 * **This is the library, and only the library.** It was once relied on as the
 * way to the camera too, on the grounds that a phone browser answers
 * `<input type="file" accept="image/*">` with its own *Take Photo* sheet. iOS
 * does; Android Chrome omits the camera from that sheet whenever `multiple` is
 * set, and the native build is the library only. So every place that adds
 * photographs offers `takePhoto` beside this — see `PhotoSourceButtons`.
 *
 * Returns what was chosen and how many were left behind, because a cap that
 * says nothing is a cap that looks like a bug.
 */
export async function pickPhotos(
  limit = PHOTO_PICK_LIMIT
): Promise<{ uris: string[]; dropped: number }> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
    exif: false,
  });
  if (result.canceled) return { uris: [], dropped: 0 };

  // `selectionLimit` is advisory on some platforms and ignored by the web file
  // input entirely, so the cap is enforced here as well as asked for there.
  const chosen = result.assets.map((asset) => asset.uri);
  return { uris: chosen.slice(0, limit), dropped: Math.max(0, chosen.length - limit) };
}

/** A storage path nobody else will claim, under this household's folder. */
export function photoFileName(pathPrefix: string): string {
  return `${pathPrefix}/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
}

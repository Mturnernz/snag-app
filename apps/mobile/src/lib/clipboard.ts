import * as Clipboard from 'expo-clipboard';

/**
 * Copy a model number, serial or colour code.
 *
 * The house record exists to be read back somewhere else — into a search box,
 * a parts order, a text message to a plumber — so copying is the tab's most
 * likely action after finding something, and typing `MSZ-AP50VGK` by hand off
 * a phone screen is exactly the error-prone job the record was meant to end.
 *
 * Returns whether it worked rather than throwing, because there is a decent
 * fallback and it is not an error worth a dialog: the browser clipboard API
 * needs a secure context and a live user gesture, and Safari in particular
 * refuses after any `await` that isn't part of the same tick. When it refuses,
 * the caller shows the value itself so it can at least be read and retyped —
 * which is what someone was about to do anyway.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(value);
    return true;
  } catch (err) {
    console.warn('Clipboard refused:', err);
    return false;
  }
}

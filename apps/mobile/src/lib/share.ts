import { Platform, Share } from 'react-native';
import { copyToClipboard } from './clipboard';
import { saveFile } from './download';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Hand a link to the phone's own share sheet — Messages, WhatsApp, email —
 * and fall back to the clipboard where there is none.
 *
 * On web this is `navigator.share`, which the phones people install this on
 * have and most desktop browsers do not; react-native-web's `Share` wraps the
 * same call but rejects rather than saying why, so the branch is taken here.
 * A person closing the sheet is `cancelled`, not a failure: nothing needs
 * saying about it.
 */
export async function shareLink(url: string, message: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.share) {
      try {
        await nav.share({ title: 'Snag', text: message, url });
        return 'shared';
      } catch (err: any) {
        if (err?.name === 'AbortError') return 'cancelled';
        // Anything else — no user gesture left after an await, a permission
        // policy — falls through to the clipboard rather than to nothing.
      }
    }
    return (await copyToClipboard(url)) ? 'copied' : 'failed';
  }
  try {
    const result = await Share.share({ message: `${message} ${url}`, url });
    return result.action === Share.dismissedAction ? 'cancelled' : 'shared';
  } catch {
    return (await copyToClipboard(url)) ? 'copied' : 'failed';
  }
}

/** What happened to a file handed over: shared, saved instead, or nothing. */
export type FileShareOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

/**
 * Whether this browser can hand a *file* to the phone's share sheet — which is
 * what puts a PDF straight into WhatsApp, Messenger or a new email. Phones
 * can; most desktop browsers cannot, and get a download instead. Always true
 * on native, where `expo-sharing` does it.
 */
export function canShareFiles(): boolean {
  if (Platform.OS !== 'web') return true;
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav?.share || !nav?.canShare || typeof File === 'undefined') return false;
  try {
    return nav.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/**
 * Hand a file to the share sheet, or save it where there is none.
 *
 * On web it is `navigator.share({ files })`, checked first with `canShare`,
 * and a person closing the sheet is `cancelled`. Anything else — no file
 * sharing here, the user gesture used up by the PDF taking a moment to build —
 * falls back to downloading it, said as `saved`, rather than to nothing. On
 * native the file is written and `expo-sharing` opens the system sheet; it is
 * required there only, because it has no business in the web bundle.
 */
export async function shareFile(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  text: string,
): Promise<FileShareOutcome> {
  if (Platform.OS === 'web') {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (canShareFiles()) {
      const file = new File([bytes as BlobPart], fileName, { type: mimeType });
      try {
        await nav.share({ files: [file], title: fileName, text });
        return 'shared';
      } catch (err: any) {
        if (err?.name === 'AbortError') return 'cancelled';
        // Falls through to a download: the file is made, so hand it over.
      }
    }
    try {
      await saveFile(fileName, bytes, mimeType);
      return 'saved';
    } catch {
      return 'failed';
    }
  }

  try {
    const { path } = await saveFile(fileName, bytes, mimeType);
    if (!path) return 'failed';
    const Sharing = require('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return 'saved';
    await Sharing.shareAsync(path, { mimeType, dialogTitle: text, UTI: 'com.adobe.pdf' });
    return 'shared';
  } catch {
    return 'failed';
  }
}

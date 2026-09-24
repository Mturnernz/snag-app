import { Platform, Share } from 'react-native';
import { copyToClipboard } from './clipboard';

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

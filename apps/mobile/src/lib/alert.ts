import { Alert, Platform } from 'react-native';

/**
 * `Alert.alert` that also works in the browser.
 *
 * react-native-web's Alert is `static alert() {}` — a no-op stub. So on the web
 * build every dialog in this app silently did nothing, and any button whose
 * action lived behind a confirmation was simply dead: Sign Out, deactivate an
 * organisation, delete a work group, escalate a snag to a hazard. So was every
 * error message, which is worse than dead — the action failed and the user was
 * told nothing.
 *
 * The app is shipped to the browser as well as to phones (`expo export
 * --platform web`, deployed to Netlify), so this is not a fallback path.
 *
 * `window.confirm`/`window.alert` are plain, and a themed in-app dialog would
 * look better — but they are synchronous, always available, and cannot fail to
 * appear, which is the property that was missing.
 *
 * **Two buttons at most** (an optional cancel plus one action), because that is
 * all a `confirm` can express. A choice between three things is a UI, not an
 * alert — see PhotoPicker, which picks its own behaviour per platform instead.
 */
export interface AlertButton {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;
  const cancel = buttons?.find((b) => b.style === 'cancel');
  const actions = (buttons ?? []).filter((b) => b !== cancel);

  if (actions.length > 1) {
    console.warn(`showAlert: ${actions.length} actions can't be offered in a confirm — using the first.`);
  }

  // Nothing to decide: tell them, and run whatever the single button did.
  if (actions.length === 0) {
    window.alert(text);
    cancel?.onPress?.();
    return;
  }
  const action = actions[0];
  if (!cancel && actions.length === 1 && !action.onPress) {
    window.alert(text);
    return;
  }
  if (window.confirm(text)) action.onPress?.();
  else cancel?.onPress?.();
}

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Chrome's own "Install app" prompt, kept for when somebody asks for it.
 *
 * Chrome on Android fires `beforeinstallprompt` once, early, and only to a
 * listener already registered. A card that mounts after the list has loaded
 * would miss it. So it is caught at module load, the first time this file is
 * imported, and held until the card offers **Install**. Without it the card
 * still works: it shows the menu steps instead of the button.
 *
 * iOS has no such event. Add to Home Screen is only ever in Safari's share
 * sheet, so an iPhone always gets the steps.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let captured: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep Chrome's own mini-infobar from racing the card.
    event.preventDefault();
    captured = event as InstallPromptEvent;
    listeners.forEach((notify) => notify());
  });
  window.addEventListener('appinstalled', () => {
    captured = null;
    listeners.forEach((notify) => notify());
  });
}

export function useInstallPrompt(): {
  canPrompt: boolean;
  /** Shows Chrome's prompt. Resolves true if the person installed. */
  prompt: () => Promise<boolean>;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const notify = () => force((n) => n + 1);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  return {
    canPrompt: captured !== null,
    prompt: async () => {
      const event = captured;
      if (!event) return false;
      // A prompt can be shown once; after this Chrome needs a fresh event.
      captured = null;
      await event.prompt();
      const choice = await event.userChoice;
      return choice.outcome === 'accepted';
    },
  };
}

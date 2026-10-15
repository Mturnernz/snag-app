import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import * as Font from 'expo-font';
import { activeSchemeId, loadStoredScheme, setBootScheme } from './lib/colourScheme';
import { SCHEMES } from './constants/schemes';

/**
 * What runs before the app: the colour scheme, then the fonts, then `App`.
 *
 * **`App` is required here, after the scheme is known, and never imported.**
 * Every stylesheet in the app reads `Colors` once, when its module loads, and
 * `Colors` is built from the scheme (`constants/theme.ts`). So nothing that
 * reaches `theme.ts` may load before the scheme is settled — which is why this
 * file imports only the scheme's own modules, and why `index.js` registers it
 * rather than `App`.
 *
 *   - **The web build** knows the scheme synchronously (`localStorage`), so
 *     `App` loads on the first render. The fonts load alongside and swap in
 *     when they arrive; until then the words are in the system face named as
 *     the fallback, which is what a web page does.
 *   - **A phone** waits for the stored scheme and for the fonts — a custom
 *     family that is not loaded yet draws nothing on iOS — but never longer
 *     than three seconds, after which it opens in whatever it has.
 */
const FONTS = {
  SchibstedGrotesk_400Regular: require('@expo-google-fonts/schibsted-grotesk/400Regular/SchibstedGrotesk_400Regular.ttf'),
  SchibstedGrotesk_500Medium: require('@expo-google-fonts/schibsted-grotesk/500Medium/SchibstedGrotesk_500Medium.ttf'),
  SchibstedGrotesk_600SemiBold: require('@expo-google-fonts/schibsted-grotesk/600SemiBold/SchibstedGrotesk_600SemiBold.ttf'),
  SchibstedGrotesk_700Bold: require('@expo-google-fonts/schibsted-grotesk/700Bold/SchibstedGrotesk_700Bold.ttf'),
  SchibstedGrotesk_800ExtraBold: require('@expo-google-fonts/schibsted-grotesk/800ExtraBold/SchibstedGrotesk_800ExtraBold.ttf'),
  DMMono_400Regular: require('@expo-google-fonts/dm-mono/400Regular/DMMono_400Regular.ttf'),
  DMMono_500Medium: require('@expo-google-fonts/dm-mono/500Medium/DMMono_500Medium.ttf'),
};

const FONT_WAIT_MS = 3000;

function loadFonts(): Promise<void> {
  return Font.loadAsync(FONTS).catch(() => undefined);
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

type AppComponent = React.ComponentType;

function loadApp(): AppComponent {
  // Required, not imported: see above.
  return require('../App').default as AppComponent;
}

export default function Boot() {
  const [App, setApp] = useState<AppComponent | null>(() => (Platform.OS === 'web' ? loadApp() : null));

  useEffect(() => {
    if (Platform.OS === 'web') {
      // The page's own ground, so the moment before the first paint and the
      // overscroll past either end are the scheme's bone, not white.
      try {
        const bone = SCHEMES[activeSchemeId()].bone;
        globalThis.document?.documentElement?.style.setProperty('background-color', bone);
        if (globalThis.document?.body) globalThis.document.body.style.backgroundColor = bone;
      } catch {
        // Nothing to paint: a test, or no document.
      }
      void loadFonts();
      return undefined;
    }
    let live = true;
    Promise.all([loadStoredScheme(), within(loadFonts(), FONT_WAIT_MS)]).then(([id]) => {
      setBootScheme(id);
      if (live) setApp(() => loadApp());
    });
    return () => { live = false; };
  }, []);

  if (!App) return <View style={{ flex: 1, backgroundColor: SCHEMES[activeSchemeId()].bone }} />;
  return <App />;
}

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Colors } from '../constants/theme';

/** The widest the app is drawn. Past it, bone either side. */
export const APP_COLUMN = 640;

/**
 * The app as a centred column on a wide screen (October 2026).
 *
 * It stretched to the window, so on a desktop browser a job's photo strip was
 * a metre wide and the dock's five tabs sat at opposite ends of the screen. The
 * whole app is drawn in a 640pt column, centred on bone, with the dock inside
 * it — the column a phone already is. Every gate goes through it: the welcome,
 * setup and the tabs.
 *
 * A sheet is a React Native `Modal`, which a browser draws over the whole
 * page, so `Sheet` keeps itself to the same width (`APP_COLUMN`).
 *
 * On a phone it is a plain full-size view.
 */
export default function AppColumn({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={styles.page}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.background, alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: APP_COLUMN, overflow: 'hidden' },
});

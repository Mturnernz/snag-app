import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

import Button from './Button';
import { Colors, Spacing, Typography } from '../constants/theme';
import { reportError } from '../lib/monitoring';

interface Props {
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * The last line under the whole app: a render that throws lands here rather
 * than on a blank white page.
 *
 * Until this existed, an uncaught render error took the entire tree down, and
 * what somebody saw was plaster-coloured nothing. They had no way to tell it
 * from a slow connection and no way back but to know to reload. It says so in
 * words, offers the reload, and reports the error (`reportError`, which does
 * nothing until monitoring is switched on).
 *
 * It catches render errors only, which is all a boundary can. An error in an
 * event handler or a promise is the handler's to word, and Sentry's global
 * handlers see it on the web build regardless.
 */
export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    reportError(error, { boundary: 'app', component: firstComponent(info.componentStack) });
  }

  private reload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.root} accessibilityRole="alert">
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          Snag hit a problem it couldn&apos;t recover from on this screen. Nothing you saved has been
          lost. Reloading usually sorts it.
        </Text>
        <Button label="Reload" onPress={this.reload} />
      </View>
    );
  }
}

/** The innermost component named in React's stack, for a report's tag. */
function firstComponent(stack: string | null | undefined): string {
  const match = stack?.match(/\bat ([A-Z][\w$]*)/) ?? stack?.match(/^\s*([A-Z][\w$]*)/m);
  return match?.[1] ?? 'unknown';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.lg,
    backgroundColor: Colors.background,
  },
  title: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary },
  body: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 22 },
});

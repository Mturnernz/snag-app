import { useWindowDimensions } from 'react-native';

// No responsive-layout system exists elsewhere in the app yet — every
// screen is a fixed single column. This is the first: a minimal breakpoint
// so the supervisor dashboard can lay out as a wider grid on
// `expo start --web` / a tablet-sized viewport, without touching anything
// else. 768px matches the common tablet/desktop-web breakpoint.
const WIDE_BREAKPOINT = 768;

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return { isWide: width >= WIDE_BREAKPOINT, width };
}

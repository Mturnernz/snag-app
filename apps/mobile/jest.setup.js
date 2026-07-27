// Native modules have no JS implementation under Jest, so stub the ones the
// units under test reach for. Anything not listed here should be mocked in the
// individual spec, so this file stays a list of genuinely global concerns.

// AsyncStorage: offlineQueue is built on it, so give it a real in-memory store
// rather than a jest.fn() — the queue's behaviour only means anything if reads
// see what writes put there.
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k) => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k, v) => {
        store[k] = String(v);
      }),
      removeItem: jest.fn(async (k) => {
        delete store[k];
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
      // Test-only escape hatch for arranging state and asserting on it.
      __reset: () => {
        store = {};
      },
      __dump: () => ({ ...store }),
    },
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Reanimated's Jest mock needs a global that only exists in the native runtime.
global.__reanimatedWorkletInit = () => {};

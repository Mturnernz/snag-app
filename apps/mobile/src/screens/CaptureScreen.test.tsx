import React from 'react';
import { render, flattenStyle } from '../test/render';
import CaptureScreen from './CaptureScreen';
import { Colors } from '../constants/theme';

// What this pins is the *order and weight* of the capture form, which is the
// one thing about this screen that keeps drifting. The tags are a suggestion:
// they sit below the description, they carry no border or fill until one is
// picked, and nothing about them says a snag needs one. A refactor that lifts
// them back above the fold, or restyles them into twelve solid buttons, should
// fail here rather than in someone's bathroom.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../lib/supabase', () => ({ createSnag: jest.fn() }));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));

// PhotoPicker has its own spec and reaches for expo-image-picker; the form's
// shape doesn't depend on any of that.
jest.mock('../components/PhotoPicker', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: React.forwardRef(() => React.createElement(Text, null, 'photo tray')),
  };
});

const LOCATIONS = ['Kitchen', 'Bathroom', 'Garage'].map((name, i) => ({
  id: `loc-${i}`,
  propertyId: 'prop-1',
  name,
  sortOrder: i + 1,
}));

const household = {
  id: 'house-1',
  name: 'Home',
  createdAt: '2026-09-01T00:00:00Z',
};

jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

function arrange(overrides: Record<string, unknown> = {}) {
  (global as any).__household = {
    household,
    profile: { id: 'me', displayName: 'Sam' },
    members: [],
    properties: [{ id: 'prop-1', householdId: 'house-1', name: 'Home' }],
    activeProperty: { id: 'prop-1', householdId: 'house-1', name: 'Home' },
    setActiveProperty: jest.fn(),
    locations: LOCATIONS,
    reloadLocations: jest.fn(),
    refresh: jest.fn(),
    reloadAccount: jest.fn(),
    ...overrides,
  };
}

/** The nearest ancestor of a label that actually handles a press. */
const pressableAround = (result: ReturnType<typeof render>, text: string) => {
  let node: any = result.getByText(text);
  while (node) {
    if (typeof node.type === 'string' && node.props?.accessibilityState?.selected !== undefined) return node;
    node = node.parent;
  }
  throw new Error(`Nothing selectable around "${text}"`);
};

/** Every host <Text> in render order, so "below" can actually be asserted. */
const textsInOrder = (result: ReturnType<typeof render>) =>
  result.getAllByType('Text').map((n) => {
    const walk = (node: any): string =>
      (node.children ?? [])
        .map((c: any) => (typeof c === 'string' ? c : walk(c)))
        .join('');
    return walk(n);
  });

/**
 * The tag chip wrapping a given label.
 *
 * Found by walking up from its <Text> rather than by searching for the chip:
 * a chip's children include fiber back-references, so anything that stringifies
 * them recurses forever.
 */
const tagChip = (result: ReturnType<typeof render>, name: string) => {
  let node: any = result.getByText(name);
  while (node) {
    if (typeof node.type === 'string' && typeof node.props?.accessibilityState?.selected === 'boolean') {
      return node;
    }
    node = node.parent;
  }
  throw new Error(`No pressable chip around "${name}"`);
};

describe('CaptureScreen', () => {
  beforeEach(() => arrange());

  it('puts the location tags below the description, not above it', () => {
    const result = render(<CaptureScreen />);
    const texts = textsInOrder(result);

    const description = texts.findIndex((t) => t.startsWith('Anything to add?'));
    const tags = texts.findIndex((t) => t.startsWith('Where is it?'));
    const kitchen = texts.indexOf('Kitchen');

    expect(description).toBeGreaterThan(-1);
    expect(tags).toBeGreaterThan(description);
    expect(kitchen).toBeGreaterThan(tags);
  });

  it('words the tags as optional, the same as the description', () => {
    const result = render(<CaptureScreen />);
    expect(textsInOrder(result)).toContain('Where is it? Optional');
  });

  it('leaves an unpicked tag unfilled and unbordered', () => {
    const result = render(<CaptureScreen />);
    const chip = tagChip(result, 'Kitchen');
    expect(chip.props.accessibilityState.selected).toBe(false);

    const style = flattenStyle(chip.props.style);
    // No fill, and a border that is there only so picking one can't shift the
    // row. A solid ground here is the regression this exists to catch.
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderColor).toBe('transparent');
    // Still a full-height target, however quiet it looks.
    expect(style.minHeight).toBe(48);
  });

  it('reserves the alert colour for High — Low is selected, not shouting', () => {
    const result = render(<CaptureScreen />);
    // Low is the default, so this is what the screen looks like at rest. It used
    // to be a filled dark block, which made the quieter of two choices the
    // heavier-looking one and put a second saturated hue on a screen whose only
    // alert colour is meant to be High.
    const low = flattenStyle(pressableAround(result, 'Low').props.style);
    expect(low.backgroundColor).toBe(Colors.sunken);
    expect(low.backgroundColor).not.toBe(Colors.textSecondary);
    expect(flattenStyle(result.getByText('Low').props.style).color).toBe(Colors.textPrimary);
  });

  it('still refuses to save with neither a photo nor a description', () => {
    const result = render(<CaptureScreen />);
    expect(textsInOrder(result)).toContain('A photo or a few words is enough');
  });
});

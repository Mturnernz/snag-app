import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import LocationTagsScreen from './LocationTagsScreen';

// The tag list is the one bit of setup a household outgrows, and two things
// about editing it are easy to get wrong and invisible when you do:
//
// 1. Tags belong to a PROPERTY. Editing the house's list must read and write
//    the house's property id, not the household's, or a bach quietly inherits
//    a boatshed it doesn't have.
// 2. Removing a tag must not read as destroying history. `snags.room` is TEXT
//    rather than a foreign key precisely so it isn't, and the confirmation has
//    to say so — a two-button confirmation, because `showAlert` on the web
//    build is a `window.confirm` and cannot express a third.

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => insets }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));

const mock_getLocations = jest.fn();
const mock_createLocation = jest.fn();
const mock_deleteLocation = jest.fn();
jest.mock('../lib/supabase', () => ({
  getLocations: (...args: unknown[]) => mock_getLocations(...args),
  createLocation: (...args: unknown[]) => mock_createLocation(...args),
  deleteLocation: (...args: unknown[]) => mock_deleteLocation(...args),
}));

const mock_showToast = jest.fn();
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: mock_showToast }) }));

const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...args: unknown[]) => mock_showAlert(...args) }));

jest.mock('../hooks/useHousehold', () => ({ useHousehold: () => (global as any).__household }));

const HOUSE = { id: 'prop-house', householdId: 'house-1', name: 'Home' };
const BACH = { id: 'prop-bach', householdId: 'house-1', name: 'The bach' };

const tag = (id: string, name: string, sortOrder: number, propertyId = HOUSE.id) => ({
  id, propertyId, name, sortOrder,
});

const reloadLocations = jest.fn();

function arrange(properties = [HOUSE]) {
  (global as any).__household = {
    household: { id: 'house-1', name: 'Home', createdAt: '2026-09-01T00:00:00Z' },
    profile: { id: 'me', displayName: 'Sam' },
    members: [],
    properties,
    activeProperty: properties[0],
    setActiveProperty: jest.fn(),
    locations: [tag('l1', 'Kitchen', 1)],
    reloadLocations,
    refresh: jest.fn(),
    reloadAccount: jest.fn(),
  };
}

/** Lets the screen's initial load land before anything is asserted. */
const settle = () => TestRenderer.act(async () => {});

const pressableLabelled = (result: ReturnType<typeof render>, label: string) => {
  const found = result.root.findAll(
    (n) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && !!n.props?.onPress,
    { deep: true }
  );
  if (found.length === 0) throw new Error(`Nothing pressable labelled "${label}"`);
  return found[0];
};

/** The nearest ancestor of a label that actually handles a press. */
const pressableAround = (result: ReturnType<typeof render>, text: string) => {
  let node: any = result.getByText(text);
  while (node) {
    if (typeof node.props?.onPress === 'function') return node;
    node = node.parent;
  }
  throw new Error(`Nothing pressable around "${text}"`);
};

beforeEach(() => {
  jest.clearAllMocks();
  arrange();
  mock_getLocations.mockResolvedValue([tag('l1', 'Kitchen', 1), tag('l2', 'Garage', 2)]);
});

describe('LocationTagsScreen', () => {
  it("reads the active property's tags, not the household's", async () => {
    const result = render(<LocationTagsScreen />);
    await settle();

    expect(mock_getLocations).toHaveBeenCalledWith(HOUSE.id);
    expect(result.getByText('Kitchen')).toBeTruthy();
    expect(result.getByText('Garage')).toBeTruthy();
  });

  it('offers a place picker only once there is a second place', async () => {
    const oneProperty = render(<LocationTagsScreen />);
    await settle();
    expect(oneProperty.queryByText('The bach')).toBeNull();
    oneProperty.unmount();

    arrange([HOUSE, BACH]);
    const twoProperties = render(<LocationTagsScreen />);
    await settle();
    expect(twoProperties.getByText('The bach')).toBeTruthy();
    expect(twoProperties.getByText('Home')).toBeTruthy();
  });

  it('asks before removing, in two buttons, and says history is kept', async () => {
    const result = render(<LocationTagsScreen />);
    await settle();

    await TestRenderer.act(async () => {
      pressableLabelled(result, 'Remove Garage').props.onPress();
    });

    expect(mock_deleteLocation).not.toHaveBeenCalled();
    const [title, message, buttons] = mock_showAlert.mock.calls[0];
    expect(title).toBe('Remove Garage?');
    expect(message).toMatch(/keep the tag/i);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].style).toBe('cancel');

    await TestRenderer.act(async () => {
      buttons[1].onPress();
    });
    expect(mock_deleteLocation).toHaveBeenCalledWith('l2');
  });

  it('pushes a change back into the capture chips when it is that place', async () => {
    mock_createLocation.mockResolvedValue(undefined);
    const result = render(<LocationTagsScreen />);
    await settle();

    const input = result.getAllByType('TextInput')[0];
    await TestRenderer.act(async () => {
      input.props.onChangeText('Boatshed');
    });
    await TestRenderer.act(async () => {
      pressableAround(result, 'Add').props.onPress();
    });

    expect(mock_createLocation).toHaveBeenCalledWith(HOUSE.id, 'Boatshed');
    expect(reloadLocations).toHaveBeenCalled();
  });
});

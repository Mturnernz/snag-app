import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AddRoomSheet from './AddRoomSheet';
import { COMMON_ROOMS } from '../types';

// The sheet both *Add a room* doors open: the House tab's and setup's dashed
// card. These pin what it offers and in what order, that a tap writes and the
// sheet stays for the next one, and that leaving takes a name still in the
// box — or stays open over one that was refused.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const settle = () => TestRenderer.act(async () => {});

/** The room cards, in the order drawn, by name. */
const cards = (r: ReturnType<typeof render>) => {
  const labels = r.root.findAll(
    (n: any) => typeof n.type !== 'string' && !!n.props?.onPress
      && /^Add (?!the room$).+$/.test(n.props?.accessibilityLabel ?? ''),
    { deep: true },
  ).map((n: any) => (n.props.accessibilityLabel as string).slice('Add '.length));
  return labels.filter((label, i) => labels.indexOf(label) === i);
};

const pressable = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label && !!n.props?.onPress,
    { deep: true },
  )[0];

const box = (r: ReturnType<typeof render>) =>
  r.root.findAll(
    (n: any) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Name the room',
    { deep: true },
  )[0];

const press = async (r: ReturnType<typeof render>, label: string) => {
  await TestRenderer.act(async () => { await pressable(r, label).props.onPress(); });
  await settle();
};

const onAdd = jest.fn();
const onClose = jest.fn();

function open(existing: string[]) {
  return render(<AddRoomSheet visible existing={existing} onAdd={onAdd} onClose={onClose} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  onAdd.mockResolvedValue(true);
});

describe('AddRoomSheet', () => {
  it("offers the rooms this house hasn't got, most common first", async () => {
    const r = open(['Kitchen', 'Laundry', 'Master bedroom']);
    await settle();

    const offered = cards(r);
    expect(offered.slice(0, 3)).toEqual(['Bathroom', 'Living room', 'Bedroom 2']);
    for (const have of ['Kitchen', 'Laundry', 'Master bedroom']) expect(offered).not.toContain(have);
    expect(offered.indexOf('Ensuite')).toBeLessThan(offered.indexOf('Conservatory'));
    expect(offered.indexOf('Ensuite')).toBeLessThan(offered.indexOf('Movie room'));
  });

  it('adds a room on the tap, takes its card away and stays open for the next', async () => {
    const r = open(['Kitchen']);
    await settle();

    await press(r, 'Add Ensuite');
    expect(onAdd).toHaveBeenCalledWith('Ensuite');
    expect(cards(r)).not.toContain('Ensuite');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the card when the write was refused', async () => {
    onAdd.mockResolvedValue(false);
    const r = open([]);
    await settle();

    await press(r, 'Add Study');
    expect(cards(r)).toContain('Study');
  });

  it('adds a room the list has not got from the box', async () => {
    const r = open([]);
    await settle();

    await TestRenderer.act(async () => box(r).props.onChangeText('  Boatshed '));
    await press(r, 'Add the room');
    expect(onAdd).toHaveBeenCalledWith('Boatshed');
    expect(box(r).props.value).toBe('');
  });

  it('closes without writing when nothing is typed', async () => {
    const r = open([]);
    await settle();

    await press(r, 'Done');
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a name still in the box on the way out', async () => {
    const r = open([]);
    await settle();

    await TestRenderer.act(async () => box(r).props.onChangeText('Sleepout'));
    await press(r, 'Done');
    expect(onAdd).toHaveBeenCalledWith('Sleepout');
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open, words and all, over a name that was refused', async () => {
    onAdd.mockResolvedValue(false);
    const r = open(['Garage']);
    await settle();

    await TestRenderer.act(async () => box(r).props.onChangeText('garage'));
    await press(r, 'Done');
    expect(onClose).not.toHaveBeenCalled();
    expect(box(r).props.value).toBe('garage');
  });

  it('says so when every room on the list is already here', async () => {
    const r = open(COMMON_ROOMS.map((room) => room.name));
    await settle();

    expect(cards(r)).toEqual([]);
    expect(r.queryByText('Every room on the list is already here.')).not.toBeNull();
    // The box is still there for a room the list never guessed at.
    expect(box(r)).toBeDefined();
  });
});

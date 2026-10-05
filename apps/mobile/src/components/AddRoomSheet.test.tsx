import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AddRoomSheet from './AddRoomSheet';
import { COMMON_ROOMS } from '../types';

// The sheet both *Add a room* doors open: the House tab's and setup's dashed
// card. These pin what it offers and in what order, that a tap writes and the
// sheet stays for the next one, that leaving takes a name still in the box —
// or stays open over one that was refused — and that a room the place already
// has is a way into it rather than a refusal.

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
const onOpen = jest.fn();

function open(existing: string[], opens = false) {
  return render(
    <AddRoomSheet
      visible
      existing={existing}
      onAdd={onAdd}
      onOpen={opens ? onOpen : undefined}
      onClose={onClose}
    />,
  );
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

    await TestRenderer.act(async () => box(r).props.onChangeText('Boatshed'));
    await press(r, 'Done');
    expect(onClose).not.toHaveBeenCalled();
    expect(box(r).props.value).toBe('Boatshed');
  });

  describe('a room the place already has', () => {
    // The Garage typed here had been on the House tab all along, below the
    // fold, and the server's refusal came up as a browser alert calling it a
    // tag. Now nothing is written and the sheet says where it is.

    it('writes nothing and says the room is here, in its own spelling', async () => {
      const r = open(['Kitchen', 'Garage'], true);
      await settle();

      await TestRenderer.act(async () => box(r).props.onChangeText('garage'));
      expect(r.queryByText('Garage is already a room here')).not.toBeNull();
      expect(pressable(r, 'Add the room')).toBeUndefined();

      await TestRenderer.act(async () => { box(r).props.onSubmitEditing(); });
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('opens it from the House tab', async () => {
      const r = open(['Kitchen', 'Garage'], true);
      await settle();

      await TestRenderer.act(async () => box(r).props.onChangeText('Garage room'));
      await press(r, 'Open Garage');
      expect(onOpen).toHaveBeenCalledWith('Garage');
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('opens it on Return too', async () => {
      const r = open(['Garage'], true);
      await settle();

      await TestRenderer.act(async () => box(r).props.onChangeText('garage'));
      await TestRenderer.act(async () => { box(r).props.onSubmitEditing(); });
      expect(onOpen).toHaveBeenCalledWith('Garage');
    });

    it('closes on Done without writing, since there is nothing to add', async () => {
      const r = open(['Garage'], true);
      await settle();

      await TestRenderer.act(async () => box(r).props.onChangeText('garage'));
      await press(r, 'Done');
      expect(onAdd).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('offers no button where there is no room page to open', async () => {
      // Setup's door: the line still says so, and a dead button under it
      // would be a choice that isn't one.
      const r = open(['Garage']);
      await settle();

      await TestRenderer.act(async () => box(r).props.onChangeText('garage'));
      expect(r.queryByText('Garage is already a room here')).not.toBeNull();
      expect(pressable(r, 'Open Garage')).toBeUndefined();
      expect(pressable(r, 'Add the room')).toBeUndefined();
    });

    it('counts a room added from a card a moment ago', async () => {
      const r = open([], true);
      await settle();

      await press(r, 'Add Ensuite');
      await TestRenderer.act(async () => box(r).props.onChangeText('en-suite'));
      expect(r.queryByText('Ensuite is already a room here')).not.toBeNull();
    });

    it('says nothing about a room that only contains the name', async () => {
      const r = open(['Bedroom'], true);
      await settle();

      await TestRenderer.act(async () => box(r).props.onChangeText('Bedroom 2'));
      const said = r.getAllByType('Text').map((n: any) => n.children.join(''));
      expect(said.some((t: string) => t.includes('already a room here'))).toBe(false);
      await press(r, 'Add the room');
      expect(onAdd).toHaveBeenCalledWith('Bedroom 2');
    });
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

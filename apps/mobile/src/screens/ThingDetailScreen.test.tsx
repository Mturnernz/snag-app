import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import ThingDetailScreen from './ThingDetailScreen';

// This page reversed two of its own rules, so these pin the new ones.
//
// It used to render only the fields somebody had already filled in — the rest
// behind an "Add a detail" row — and write each row on blur. Lived with, that
// failed twice over: a page showing only what it has cannot tell you what it
// could hold, and every edit saved in total silence because the rows called
// `patch` without the toast it takes. Now every field the kind can answer is on
// screen, empty or not, and one Save button commits the typed ones together.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => {} }),
  useRoute: () => ({ params: { thingId: 't1' } }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../components/StickyActionBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
  };
});

const mock_getThing = jest.fn();
const mock_updateThing = jest.fn();
const mock_createSnag = jest.fn();
jest.mock('../lib/supabase', () => ({
  getThing: (...a: unknown[]) => mock_getThing(...a),
  updateThing: (...a: unknown[]) => mock_updateThing(...a),
  createSnag: (...a: unknown[]) => mock_createSnag(...a),
  getFileUrls: jest.fn().mockResolvedValue({}),
  getFileUrl: jest.fn().mockResolvedValue(null),
  deleteThing: jest.fn(),
  uploadFile: jest.fn(),
}));
jest.mock('../lib/photoUpload', () => ({
  takePhoto: jest.fn(),
  compressAndUpload: jest.fn(),
  photoFileName: jest.fn(),
}));
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('../hooks/useHousehold', () => ({
  useHousehold: () => ({
    household: { id: 'h1', name: 'Home', createdAt: '' },
    locations: [{ id: 'l1', propertyId: 'p', name: 'Kitchen', sortOrder: 0 }],
  }),
}));

const thing = (over: Partial<any> = {}): any => ({
  id: 't1', householdId: 'h1', propertyId: 'p', kind: 'appliance',
  name: null, room: 'Kitchen', photoPaths: [], documentPaths: [],
  make: null, model: null, serial: null, consumables: [],
  installedAt: null, warrantyUntil: null, serviceDays: null, spec: {}, notes: null,
  createdBy: 'me', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  propertyName: 'Home', snagCount: 0, openSnagCount: 0,
  ...over,
});

/** Every text box on the page, by its accessible name. */
const boxes = (result: RenderResult): Record<string, any> => {
  const found: Record<string, any> = {};
  result.root
    .findAll((n) => typeof n.type === 'string' && !!n.props.accessibilityLabel && 'onChangeText' in n.props,
      { deep: true })
    .forEach((n) => { found[n.props.accessibilityLabel] = n; });
  return found;
};

const pressable = (result: RenderResult, label: string) => {
  const found = result.root.findAll(
    (n) => n.props.accessibilityLabel === label || (n.props.children === label && n.props.onPress),
    { deep: true }
  );
  return found[0];
};

/** The Save button, found by the label it carries in each state. */
const saveButton = (result: RenderResult, label: 'Save' | 'Saved') =>
  result.root.findAll(
    (n) => n.props.accessibilityLabel === label || n.props.label === label,
    { deep: true }
  )[0];

async function open(over: Partial<any> = {}) {
  mock_getThing.mockResolvedValue(thing(over));
  let result!: RenderResult;
  await TestRenderer.act(async () => { result = render(<ThingDetailScreen />); });
  await TestRenderer.act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
});

/** Every text rendered on the page, flattened. */
const textOf = (node: any): string =>
  (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');
const texts = (r: RenderResult) => r.getAllByType('Text').map(textOf);

describe('ThingDetailScreen', () => {
  it('shows every field as a box, even on a thing with nothing filled in', async () => {
    // The whole reversal. An empty record used to render as almost nothing,
    // which is why nobody could tell what it was for.
    const result = await open();
    const found = boxes(result);

    for (const label of ['Name', 'Make', 'Model', 'Serial', 'Notes']) {
      expect(found[label]).toBeTruthy();
      expect(found[label].props.value).toBe('');
    }
  });

  it('does not ask a tin of paint for a serial number', async () => {
    // "Every field" means every field the kind can answer. A paint has no
    // rating plate, and a box for one is a question with no answer.
    const result = await open({ kind: 'finish' });
    const found = boxes(result);

    expect(found['Serial']).toBeUndefined();
    // It does get the paint-specific ones, under the paint words.
    expect(found['Brand']).toBeTruthy();
    expect(found['Colour code']).toBeTruthy();
  });

  it('starts with Save off, because nothing has been typed', async () => {
    const result = await open({ name: 'Rangehood' });
    expect(saveButton(result, 'Saved')).toBeTruthy();
    expect(saveButton(result, 'Saved').props.disabled).toBe(true);
    expect(mock_updateThing).not.toHaveBeenCalled();
  });

  it('writes nothing until Save, then writes only what changed', async () => {
    // Both halves matter. Typing must not write — that is the point of the
    // button — and Save must not send fields nobody touched: `update_thing`
    // reads a null argument as "leave it alone", so an untouched field sent as
    // an empty string is the difference between saying nothing and saying
    // there is nothing there.
    const result = await open({ name: 'Rangehood', make: 'Award Appliances' });

    await TestRenderer.act(async () => {
      boxes(result)['Model'].props.onChangeText('CS2 600/1');
    });
    expect(mock_updateThing).not.toHaveBeenCalled();

    mock_updateThing.mockResolvedValue(thing({ name: 'Rangehood', make: 'Award Appliances', model: 'CS2 600/1' }));
    await TestRenderer.act(async () => { saveButton(result, 'Save').props.onPress(); });

    expect(mock_updateThing).toHaveBeenCalledTimes(1);
    expect(mock_updateThing).toHaveBeenCalledWith('t1', { model: 'CS2 600/1' });
  });

  it('clears a field that is emptied, rather than leaving it alone', async () => {
    // An empty box has to mean "there is none", or a wrong serial could never
    // be removed — only overwritten.
    const result = await open({ serial: '7A204871' });

    await TestRenderer.act(async () => { boxes(result)['Serial'].props.onChangeText(''); });
    mock_updateThing.mockResolvedValue(thing());
    await TestRenderer.act(async () => { saveButton(result, 'Save').props.onPress(); });

    expect(mock_updateThing).toHaveBeenCalledWith('t1', { serial: null });
  });

  it('offers to photograph the label from here, not only from the walkthrough', async () => {
    const result = await open();
    expect(pressable(result, 'Photograph the label')).toBeTruthy();
  });

  it('offers to attach a PDF, and lists one by its own filename', async () => {
    const result = await open({ documentPaths: ['h1/docs/1757800000000-123456-Rangehood manual.pdf'] });
    expect(pressable(result, 'Attach a PDF')).toBeTruthy();
    expect(pressable(result, 'Open Rangehood manual.pdf')).toBeTruthy();
  });

  it('shows no example values in any box', async () => {
    // A grey "7A204871" in the Serial box does not read as a prompt. It reads
    // as a serial number somebody already entered — on the one page in this app
    // that exists to be believed in a shop eight months later.
    //
    // Only the record's own fields. The "what it takes" box is an add control
    // with no label of its own, so its prompt is the only thing saying what it
    // is for — a different job from a box sitting under the word SERIAL.
    const result = await open();
    const found = boxes(result);
    for (const label of ['Name', 'Make', 'Model', 'Serial', 'Installed', 'Warranty until', 'Notes']) {
      expect(found[label]?.props.placeholder).toBeUndefined();
    }
    expect(found['Serial']).toBeTruthy();
  });

  it('will not turn a saved dishwasher into a tin of paint', async () => {
    // The Appliance/Paint rail is gone. It existed because capture filed
    // everything as `appliance` without asking; the walkthrough asks now, and a
    // kind switch sitting over a filled-in record is an offer to wreck it on a
    // mis-tap.
    const result = await open({ name: 'Dishwasher' });
    const all = texts(result);
    expect(all).not.toContain('Appliance');
    expect(all).not.toContain('Paint');
  });

  it('answers where it is with one pill, and hides the other eleven', async () => {
    // Twelve chips is a paragraph of controls standing in for one word, on a
    // page read far more often than it is edited — and eleven are wrong.
    const result = await open({ room: 'Kitchen' });
    expect(texts(result)).toContain('Kitchen');
    expect(pressable(result, 'Change the room')).toBeTruthy();
    expect(mock_updateThing).not.toHaveBeenCalled();
  });

  it('drops the section prose, including the one about filters and bulbs', async () => {
    const result = await open();
    const prose = texts(result);
    expect(prose.some((t) => t.includes('The filter, the bulb, the cartridge'))).toBe(false);
    expect(prose.some((t) => t.includes('cannot find in a drawer'))).toBe(false);
    expect(prose.some((t) => t.includes('Nothing has needed doing to it yet'))).toBe(false);
  });

  it('no longer lists what has been wrong with it', async () => {
    const result = await open();
    expect(texts(result).some((t) => t.startsWith('On the list'))).toBe(false);
  });

  it('schedules a service as one already-dated job, never a started one', async () => {
    // Both halves are the point. Setting a due date through `update_snag` is
    // one of the four things that start a job, so a service due in six months
    // would go on the list marked Doing today — which empties the status from
    // the same end the retired Start button did. `create_snag` takes the date
    // and the repeat so `v_started` never runs.
    const saved = thing({ name: 'Heat pump', room: 'Living room', serviceDays: 180 });
    mock_updateThing.mockResolvedValue(saved);
    mock_createSnag.mockResolvedValue({ id: 'new-snag' });

    const result = await open({ name: 'Heat pump', room: 'Living room' });
    await TestRenderer.act(async () => { pressable(result, 'Schedule service').props.onPress(); });
    await TestRenderer.act(async () => {
      boxes(result)['Who services it'].props.onChangeText('Plumbing Co');
    });
    await TestRenderer.act(async () => { pressable(result, 'Put it on the list').props.onPress(); });

    // The cycle and who does it are facts about the appliance.
    expect(mock_updateThing).toHaveBeenCalledWith('t1', {
      serviceDays: 180,
      spec: { servicedBy: 'Plumbing Co' },
    });

    // The job is one call, carrying its own date and repeat.
    expect(mock_createSnag).toHaveBeenCalledTimes(1);
    const input = mock_createSnag.mock.calls[0][0];
    expect(input.repeatDays).toBe(180);
    expect(input.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.thingId).toBe('t1');
    expect(input.room).toBe('Living room');
  });

  it('offers a default cycle rather than four unanswered chips', async () => {
    // Pressing "Schedule service" has already said yes. Making somebody pick
    // from four before anything is on screen is the rail this replaced.
    const result = await open({ name: 'Heat pump' });
    await TestRenderer.act(async () => { pressable(result, 'Schedule service').props.onPress(); });

    const six = result.root.findAll(
      (n) => typeof n.type !== 'string' && n.props?.accessibilityLabel === 'Every 6 months',
      { deep: true }
    )[0];
    expect(six.props.accessibilityState.selected).toBe(true);
  });
});

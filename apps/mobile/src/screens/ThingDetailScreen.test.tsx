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
// `beforeRemove` is where leaving the page writes a box still being typed in,
// so the listener is kept where a test can fire it.
const mock_listeners: Record<string, (e: any) => void> = {};
const mock_dispatch = jest.fn();
const mock_navigate = jest.fn();
const mock_nav = {
  navigate: mock_navigate,
  goBack: jest.fn(),
  dispatch: mock_dispatch,
  addListener: (event: string, fn: (e: any) => void) => {
    mock_listeners[event] = fn;
    return () => {};
  },
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mock_nav,
  useRoute: () => ({ params: { thingId: 't1' } }),
}));
jest.mock('../components/ComposeBar', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    // The bar itself is pinned in ComposeBar.test.tsx; here it only has to
    // hand over what was captured.
    default: ({ onAdd }: any) => React.createElement(
      Pressable,
      { accessibilityLabel: 'Send report', onPress: () => onAdd({ photoPaths: ['h1/p.jpg'], description: 'Leaking' }) },
      React.createElement(Text, null, 'compose bar'),
    ),
  };
});
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
const mock_getSnags = jest.fn();
const mock_updateSnag = jest.fn();
const mock_setSnagStatus = jest.fn();
const mock_getLabelReadingsToCheck = jest.fn();
const mock_resolveLabelReading = jest.fn();
const mock_readLabel = jest.fn();
jest.mock('../lib/supabase', () => ({
  getLabelReadingsToCheck: (...a: unknown[]) => mock_getLabelReadingsToCheck(...a),
  resolveLabelReading: (...a: unknown[]) => mock_resolveLabelReading(...a),
  readLabel: (...a: unknown[]) => mock_readLabel(...a),
  setSnagStatus: (...a: unknown[]) => mock_setSnagStatus(...a),
  getThing: (...a: unknown[]) => mock_getThing(...a),
  updateThing: (...a: unknown[]) => mock_updateThing(...a),
  createSnag: (...a: unknown[]) => mock_createSnag(...a),
  getSnags: (...a: unknown[]) => mock_getSnags(...a),
  updateSnag: (...a: unknown[]) => mock_updateSnag(...a),
  getFileUrls: jest.fn().mockResolvedValue({}),
  getFileUrl: jest.fn().mockResolvedValue(null),
  deleteThing: jest.fn(),
  uploadFile: jest.fn(),
}));
const mock_pickPhotos = jest.fn();
const mock_takePhoto = jest.fn();
const mock_compressAndUpload = jest.fn();
jest.mock('../lib/photoUpload', () => ({
  PHOTO_PICK_LIMIT: 5,
  pickPhotos: (...a: unknown[]) => mock_pickPhotos(...a),
  takePhoto: (...a: unknown[]) => mock_takePhoto(...a),
  // The storage key is whatever the upload says it wrote, so the name only has
  // to be a string here.
  compressAndUpload: (...a: unknown[]) => mock_compressAndUpload(...a),
  photoFileName: () => 'h1/whatever.jpg',
}));
const mock_showToast = jest.fn();
jest.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast: (...a: unknown[]) => mock_showToast(...a) }) }));
const mock_showAlert = jest.fn();
jest.mock('../lib/alert', () => ({ showAlert: (...a: unknown[]) => mock_showAlert(...a) }));
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


async function open(over: Partial<any> = {}) {
  mock_getThing.mockResolvedValue(thing(over));
  let result!: RenderResult;
  await TestRenderer.act(async () => { result = render(<ThingDetailScreen />); });
  await TestRenderer.act(async () => {});
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_getSnags.mockResolvedValue([]);
  mock_getLabelReadingsToCheck.mockResolvedValue([]);
  mock_resolveLabelReading.mockResolvedValue(undefined);
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

  it('has no Save button — leaving a box writes it', async () => {
    const result = await open({ name: 'Rangehood' });
    const saves = result.root.findAll((n) => n.props?.label === 'Save' || n.props?.label === 'Saved', { deep: true });
    expect(saves).toHaveLength(0);
    expect(mock_updateThing).not.toHaveBeenCalled();
  });

  it('writes nothing while typing, then only what changed when the box is left', async () => {
    // Both halves matter. Typing must not write, and leaving must not send
    // fields nobody touched: `update_thing` reads a null argument as "leave it
    // alone", so an untouched field sent as an empty string is the difference
    // between saying nothing and saying there is nothing there.
    const result = await open({ name: 'Rangehood', make: 'Award Appliances' });

    await TestRenderer.act(async () => {
      boxes(result)['Model'].props.onChangeText('CS2 600/1');
    });
    expect(mock_updateThing).not.toHaveBeenCalled();

    mock_updateThing.mockResolvedValue(thing({ name: 'Rangehood', make: 'Award Appliances', model: 'CS2 600/1' }));
    await TestRenderer.act(async () => { await boxes(result)['Model'].props.onBlur(); });

    expect(mock_updateThing).toHaveBeenCalledTimes(1);
    expect(mock_updateThing).toHaveBeenCalledWith('t1', { model: 'CS2 600/1' });
    expect(mock_showToast).toHaveBeenCalledWith('Saved');
  });

  it('clears a field that is emptied, rather than leaving it alone', async () => {
    // An empty box has to mean "there is none", or a wrong serial could never
    // be removed — only overwritten.
    const result = await open({ serial: '7A204871' });

    await TestRenderer.act(async () => { boxes(result)['Serial'].props.onChangeText(''); });
    mock_updateThing.mockResolvedValue(thing());
    await TestRenderer.act(async () => { await boxes(result)['Serial'].props.onBlur(); });

    expect(mock_updateThing).toHaveBeenCalledWith('t1', { serial: null });
  });

  // It used to ask *Leave without saving?* — a question with a wrong answer
  // that loses the words. Now the page writes them on the way out.
  it('writes a box still being typed in when the page is left', async () => {
    const result = await open({ name: 'Rangehood' });
    await TestRenderer.act(async () => { boxes(result)['Make'].props.onChangeText('Award'); });

    mock_updateThing.mockResolvedValue(thing({ name: 'Rangehood', make: 'Award' }));
    const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    await TestRenderer.act(async () => { mock_listeners.beforeRemove(e); });
    await TestRenderer.act(async () => {});

    expect(e.preventDefault).toHaveBeenCalled();
    expect(mock_updateThing).toHaveBeenCalledWith('t1', { make: 'Award' });
    expect(mock_dispatch).toHaveBeenCalledWith(e.data.action);
    expect(mock_showAlert).not.toHaveBeenCalled();
  });

  it('takes photographs from here, with the camera and from the library', async () => {
    const result = await open();
    expect(pressable(result, 'Take a photo')).toBeTruthy();
    expect(pressable(result, 'Choose photos')).toBeTruthy();
  });

  // Android Chrome drops the camera from a picker that takes several files, so
  // one *Add photos* meant leaving the app to photograph the thing in front of
  // you. Both sit beside the PDF button, in the section that attaches things.
  it('offers the camera and the library beside the PDF button', async () => {
    const result = await open({ photoPaths: ['h1/plate.jpg'] });

    expect(pressable(result, 'Take a photo')).toBeTruthy();
    expect(pressable(result, 'Choose photos')).toBeTruthy();
    expect(pressable(result, 'Attach a PDF')).toBeTruthy();
  });

  it('adds one taken with the camera, after the ones already there', async () => {
    mock_takePhoto.mockResolvedValue('file:///shot.jpg');
    mock_compressAndUpload.mockResolvedValueOnce({ path: 'h1/shot.jpg' });
    const result = await open({ photoPaths: ['h1/plate.jpg'] });

    await TestRenderer.act(async () => {
      await pressable(result, 'Take a photo').props.onPress();
    });

    expect(mock_pickPhotos).not.toHaveBeenCalled();
    expect(mock_updateThing).toHaveBeenCalledWith('t1', { photoPaths: ['h1/plate.jpg', 'h1/shot.jpg'] });
  });

  it('adds several in one write, after the ones already there', async () => {
    // Eight photographs must not be eight writes, eight re-reads and eight
    // toasts stacking up over a page somebody is watching.
    mock_pickPhotos.mockResolvedValue({ uris: ['file:///a.jpg', 'file:///b.jpg'], dropped: 0 });
    mock_compressAndUpload
      .mockResolvedValueOnce({ path: 'h1/a.jpg' })
      .mockResolvedValueOnce({ path: 'h1/b.jpg' });
    const result = await open({ photoPaths: ['h1/plate.jpg'] });

    await TestRenderer.act(async () => {
      await pressable(result, 'Choose photos').props.onPress();
    });

    expect(mock_updateThing).toHaveBeenCalledTimes(1);
    expect(mock_updateThing).toHaveBeenCalledWith('t1', {
      photoPaths: ['h1/plate.jpg', 'h1/a.jpg', 'h1/b.jpg'],
    });
  });

  it('keeps the ones that arrived when another refuses', async () => {
    // Six uploaded and two refused is six added and a sentence about the two,
    // not nothing added and an error.
    mock_pickPhotos.mockResolvedValue({ uris: ['file:///a.jpg', 'file:///b.jpg'], dropped: 0 });
    mock_compressAndUpload
      .mockResolvedValueOnce({ path: 'h1/a.jpg' })
      .mockRejectedValueOnce(new Error('Network'));
    const result = await open({ photoPaths: [] });

    await TestRenderer.act(async () => {
      await pressable(result, 'Choose photos').props.onPress();
    });

    expect(mock_updateThing).toHaveBeenCalledWith('t1', { photoPaths: ['h1/a.jpg'] });
    expect(mock_showAlert).toHaveBeenCalledWith("1 of 2 didn't save", expect.any(String));
  });

  it('writes nothing when the picker is closed without choosing', async () => {
    mock_pickPhotos.mockResolvedValue({ uris: [], dropped: 0 });
    const result = await open({ photoPaths: ['h1/plate.jpg'] });

    await TestRenderer.act(async () => {
      await pressable(result, 'Choose photos').props.onPress();
    });

    expect(mock_updateThing).not.toHaveBeenCalled();
  });

  it('says so when more were chosen than one go will take', async () => {
    // A cap nobody is told about is indistinguishable from photographs that
    // failed to upload.
    mock_pickPhotos.mockResolvedValue({ uris: ['file:///a.jpg'], dropped: 3 });
    mock_compressAndUpload.mockResolvedValueOnce({ path: 'h1/a.jpg' });
    const result = await open({ photoPaths: [] });

    await TestRenderer.act(async () => {
      await pressable(result, 'Choose photos').props.onPress();
    });

    expect(mock_updateThing).toHaveBeenCalledWith('t1', { photoPaths: ['h1/a.jpg'] });
    expect(mock_showAlert).toHaveBeenCalledWith('5 at a time', expect.stringContaining('other 3'));
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

  const serviceJob = (over: Partial<any> = {}): any => ({
    id: 'svc', status: 'open', thingId: 't1', linkedThings: [{ id: 't1' }],
    repeatDays: 180, dueAt: '2027-03-01T00:00:00.000', parts: [], bought: [], ...over,
  });

  // Pressing it again used to file a second repeating job, so changing the
  // cycle left the old one running beside the new.
  it('edits the service job already on the list rather than filing another', async () => {
    mock_getSnags.mockResolvedValue([serviceJob()]);
    mock_updateThing.mockResolvedValue(thing({ name: 'Heat pump', serviceDays: 365 }));
    mock_updateSnag.mockResolvedValue(serviceJob({ repeatDays: 365, status: 'doing' }));
    mock_setSnagStatus.mockResolvedValue(serviceJob({ repeatDays: 365 }));

    const result = await open({ name: 'Heat pump', serviceDays: 180 });
    expect(texts(result).some((t) => t.includes('next due'))).toBe(true);

    await TestRenderer.act(async () => { pressable(result, 'Schedule service').props.onPress(); });
    await TestRenderer.act(async () => { pressable(result, 'Every year').props.onPress(); });
    await TestRenderer.act(async () => { pressable(result, 'Update the service job').props.onPress(); });

    expect(mock_createSnag).not.toHaveBeenCalled();
    expect(mock_updateSnag).toHaveBeenCalledWith('svc', expect.objectContaining({ repeatDays: 365 }));
    // Rearranging a service is not starting it.
    expect(mock_setSnagStatus).toHaveBeenCalledWith('svc', 'open');
  });

  it('opens on the cycle the job carries, and asks for the next one, not the first', async () => {
    mock_getSnags.mockResolvedValue([serviceJob({ repeatDays: 730 })]);
    const result = await open({ name: 'Heat pump', serviceDays: 180 });
    await TestRenderer.act(async () => { pressable(result, 'Schedule service').props.onPress(); });

    const two = result.root.findAll(
      (n) => typeof n.type !== 'string' && n.props?.accessibilityLabel === 'Every 2 years',
      { deep: true }
    )[0];
    expect(two.props.accessibilityState.selected).toBe(true);
    expect(texts(result)).toContain('Next one due');
  });

  // It used to stop only the thing's column, and the job went on coming round.
  it('takes the job off the list when servicing stops, keeping its notes', async () => {
    mock_getSnags.mockResolvedValue([serviceJob()]);
    mock_updateSnag.mockResolvedValue(serviceJob({ repeatDays: null }));
    mock_setSnagStatus.mockResolvedValue(serviceJob({ repeatDays: null, status: 'done' }));
    mock_updateThing.mockResolvedValue(thing({ name: 'Heat pump' }));

    const result = await open({ name: 'Heat pump', serviceDays: 180 });
    await TestRenderer.act(async () => { pressable(result, 'Schedule service').props.onPress(); });
    await TestRenderer.act(async () => { await pressable(result, 'Stop servicing it').props.onPress(); });

    expect(mock_updateSnag).toHaveBeenCalledWith('svc', { repeatDays: null });
    expect(mock_setSnagStatus).toHaveBeenCalledWith('svc', 'done');
    expect(mock_updateThing).toHaveBeenCalledWith('t1', { serviceDays: null, clearSpec: ['servicedBy'] });
  });

  // It used to create "Heat pump — " the moment it was pressed, and a press
  // walked away from left that on everybody's list.
  it('files a problem through the capture bar, and nothing before it is sent', async () => {
    mock_createSnag.mockResolvedValue({ id: 'new' });
    const result = await open({ name: 'Heat pump', room: 'Kitchen' });

    await TestRenderer.act(async () => { pressable(result, 'Report a problem').props.onPress(); });
    expect(mock_createSnag).not.toHaveBeenCalled();

    await TestRenderer.act(async () => { await pressable(result, 'Send report').props.onPress(); });
    expect(mock_createSnag).toHaveBeenCalledWith({
      propertyId: 'p', room: 'Kitchen', description: 'Leaking', photoPaths: ['h1/p.jpg'], thingId: 't1',
    });
    expect(mock_navigate).toHaveBeenCalledWith('SnagDetail', { snagId: 'new' });
  });
});

describe('the cart beside what it takes', () => {
  // The shopping list is every open job's parts, so the cart files a small job
  // about this thing carrying the item — and asks first, so a second press or
  // the other phone never puts one cartridge on the trip sheet twice.
  const onList = (over: Partial<any> = {}): any => ({
    id: 's9', status: 'doing', thingId: null, linkedThings: [{ id: 't1' }],
    parts: ['RFC-24'], bought: [], ...over,
  });

  it('files a job about this thing, then gives it the part', async () => {
    mock_getSnags.mockResolvedValue([]);
    mock_createSnag.mockResolvedValue({ id: 's1' });
    mock_updateSnag.mockResolvedValue({ id: 's1' });
    const r = await open({ name: 'Water filter', consumables: ['RFC-24'] });

    await TestRenderer.act(async () => {
      pressable(r, 'Add RFC-24 to the shopping list').props.onPress();
    });

    expect(mock_createSnag).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'p', room: 'Kitchen', thingId: 't1', description: 'Water filter — RFC-24' })
    );
    // The part goes on through update_snag, which is what starts the job:
    // deciding to buy the cartridge is deciding to change it.
    expect(mock_updateSnag).toHaveBeenCalledWith('s1', { parts: ['RFC-24'] });
    expect(mock_showToast).toHaveBeenCalledWith('RFC-24 is on the shopping list');
  });

  it('says it is already there rather than filing it twice', async () => {
    mock_getSnags.mockResolvedValue([onList()]);
    const r = await open({ consumables: ['RFC-24'] });

    await TestRenderer.act(async () => {
      pressable(r, 'Add RFC-24 to the shopping list').props.onPress();
    });

    expect(mock_createSnag).not.toHaveBeenCalled();
    expect(mock_updateSnag).not.toHaveBeenCalled();
    expect(mock_showToast).toHaveBeenCalledWith('RFC-24 is already on the shopping list');
  });

  it('files again once the last one has been bought', async () => {
    mock_getSnags.mockResolvedValue([onList({ bought: ['RFC-24'] })]);
    mock_createSnag.mockResolvedValue({ id: 's2' });
    mock_updateSnag.mockResolvedValue({ id: 's2' });
    const r = await open({ consumables: ['RFC-24'] });

    await TestRenderer.act(async () => {
      pressable(r, 'Add RFC-24 to the shopping list').props.onPress();
    });

    expect(mock_createSnag).toHaveBeenCalled();
  });

  it('still files when the open jobs cannot be read', async () => {
    // A duplicate costs a tap to remove; a missing filter costs a trip.
    mock_getSnags.mockRejectedValue(new Error('offline'));
    mock_createSnag.mockResolvedValue({ id: 's3' });
    mock_updateSnag.mockResolvedValue({ id: 's3' });
    const r = await open({ consumables: ['RFC-24'] });

    await TestRenderer.act(async () => {
      pressable(r, 'Add RFC-24 to the shopping list').props.onPress();
    });

    expect(mock_updateSnag).toHaveBeenCalledWith('s3', { parts: ['RFC-24'] });
  });

  it('says the job landed without its part when only the second write fails', async () => {
    mock_getSnags.mockResolvedValue([]);
    mock_createSnag.mockResolvedValue({ id: 's4' });
    mock_updateSnag.mockRejectedValue(new Error('That didn’t save'));
    const r = await open({ consumables: ['RFC-24'] });

    await TestRenderer.act(async () => {
      pressable(r, 'Add RFC-24 to the shopping list').props.onPress();
    });

    expect(mock_showAlert).toHaveBeenCalledWith(
      'The job is on the list, the part is not',
      expect.stringContaining('add RFC-24')
    );
    expect(mock_showToast).not.toHaveBeenCalledWith('RFC-24 is on the shopping list');
  });
});

describe('a paint swatch', () => {
  const swatches = (r: RenderResult) =>
    r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Swatch #'), { deep: true });

  it('draws the colour a saved hex describes', async () => {
    const r = await open({ kind: 'finish', name: 'Wan White', spec: { hex: '#eae8df' } });
    expect(swatches(r).map((n) => n.props.accessibilityLabel)).toContain('Swatch #EAE8DF');
  });

  it('draws nothing, and says why, for something that is not a colour', async () => {
    const r = await open({ kind: 'finish', name: 'Wan White', spec: { hex: 'white-ish' } });
    expect(swatches(r)).toHaveLength(0);
    expect(texts(r)).toContain('Six hex digits draw a swatch');
  });

  it('has no swatch box at all on an appliance', async () => {
    const r = await open({ kind: 'appliance' });
    expect(boxes(r)['Swatch (hex)']).toBeUndefined();
  });
});

// A label read after the walkthrough's *Add it* waits here, and is never
// written onto the record unseen. These pin the card's writes: the empty boxes
// in one update, a disagreement only on its own tap, *Not right* ending it, and
// a reading with nothing left to say ending itself.
describe('a label reading waiting to be checked', () => {
  const plate = {
    legible: true, make: 'Mitsubishi Electric', model: 'MSZ-AP50VGK', serial: '7A204871',
    colourName: null, colourCode: null, product: null, sheen: null, tint: null, hex: null,
    consumables: [], suggestedConsumables: [], suggestedServiceDays: null,
  };
  const check = (over: Partial<any> = {}) => ({
    id: 'r1', thingId: 't1', thingName: 'Heat pump', photoPath: 'h1/plate.jpg',
    status: 'read', reading: plate, reason: null, createdAt: '2026-09-24T00:00:00Z', ...over,
  });

  it('fills the empty boxes in one write, and the boxes show it', async () => {
    mock_getLabelReadingsToCheck.mockResolvedValue([check()]);
    mock_updateThing.mockResolvedValue(
      thing({ name: 'Heat pump', make: 'Mitsubishi Electric', model: 'MSZ-AP50VGK', serial: '7A204871' })
    );
    const result = await open({ name: 'Heat pump', photoPaths: ['h1/plate.jpg'] });
    expect(texts(result)).toContain('Read from the label');

    await TestRenderer.act(async () => { await pressable(result, 'Use what the label says').props.onPress(); });
    expect(mock_updateThing).toHaveBeenCalledTimes(1);
    expect(mock_updateThing).toHaveBeenCalledWith('t1', {
      make: 'Mitsubishi Electric', model: 'MSZ-AP50VGK', serial: '7A204871',
    });
    expect(boxes(result).Model.props.value).toBe('MSZ-AP50VGK');
    // Nothing left to offer, so the reading ends itself.
    await TestRenderer.act(async () => {});
    expect(mock_resolveLabelReading).toHaveBeenCalledWith('r1', 'used');
    expect(texts(result)).not.toContain('Read from the label');
  });

  it('never writes over a typed box without its own tap', async () => {
    mock_getLabelReadingsToCheck.mockResolvedValue([check()]);
    const result = await open({
      name: 'Heat pump', make: 'Mitsubishi Electric', model: 'MSZ-AP50', serial: '7A204871',
    });
    expect(texts(result)).toContain('The record says MSZ-AP50');
    expect(pressable(result, 'Use what the label says')).toBeUndefined();

    mock_updateThing.mockResolvedValue(thing({ model: 'MSZ-AP50VGK' }));
    await TestRenderer.act(async () => {
      await pressable(result, 'Use MSZ-AP50VGK for Model').props.onPress();
    });
    expect(mock_updateThing).toHaveBeenCalledWith('t1', { model: 'MSZ-AP50VGK' });
  });

  it('ends on Not right, and writes nothing to the record', async () => {
    mock_getLabelReadingsToCheck.mockResolvedValue([check()]);
    const result = await open({ name: 'Heat pump' });
    await TestRenderer.act(async () => { await pressable(result, 'Dismiss the label reading').props.onPress(); });
    expect(mock_resolveLabelReading).toHaveBeenCalledWith('r1', 'dismissed');
    expect(mock_updateThing).not.toHaveBeenCalled();
    expect(texts(result)).not.toContain('Read from the label');
  });

  it('shows nothing for a reading the record already agrees with, and closes it', async () => {
    mock_getLabelReadingsToCheck.mockResolvedValue([check()]);
    const result = await open({
      name: 'Heat pump', make: 'Mitsubishi Electric', model: 'MSZ-AP50VGK', serial: '7A204871',
    });
    expect(texts(result)).not.toContain('Read from the label');
    expect(mock_resolveLabelReading).toHaveBeenCalledWith('r1', 'used');
  });

  it('says why a reading came to nothing, and a busy one can be read again', async () => {
    mock_getLabelReadingsToCheck.mockResolvedValue([check({ status: 'failed', reading: null, reason: 'busy' })]);
    mock_readLabel.mockResolvedValue({ reading: plate, guess: null, readingId: 'r1' });
    const result = await open({ name: 'Heat pump' });
    expect(texts(result)).toContain('The label reader was busy when this was added.');

    mock_getLabelReadingsToCheck.mockResolvedValue([check()]);
    await TestRenderer.act(async () => { await pressable(result, 'Read the label again').props.onPress(); });
    expect(mock_readLabel).toHaveBeenCalledWith('h1/plate.jpg', 'appliance');
    expect(texts(result)).toContain('Read from the label');
  });

  it('draws the record when the readings cannot be fetched', async () => {
    mock_getLabelReadingsToCheck.mockRejectedValue(new Error('offline'));
    const result = await open({ name: 'Heat pump' });
    expect(boxes(result).Name.props.value).toBe('Heat pump');
  });
});

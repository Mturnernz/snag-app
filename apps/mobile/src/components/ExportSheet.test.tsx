import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ExportSheet from './ExportSheet';

// Scope is asked every time and is deliberately not remembered: the two answers
// are different documents, and a sticky default would quietly make one of them
// the only one anybody ever gets. It defaults to what's on screen because that
// is what the person is looking at — but the count sits on both chips, so the
// difference is visible before the tap rather than discovered in a spreadsheet.

jest.mock('../lib/exportFile', () => ({}));

const onExport = jest.fn();
const onCancel = jest.fn();

const pressableAround = (r: ReturnType<typeof render>, text: string) => {
  let node: any = r.getByText(text);
  while (node) {
    if (typeof node.props?.onPress === 'function') return node;
    node = node.parent;
  }
  throw new Error(`Nothing pressable around "${text}"`);
};

const press = async (node: any) => {
  await TestRenderer.act(async () => { await node.props.onPress(); });
};

const byLabel = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll(
    (n: any) => typeof n.type !== 'string' && n.props?.accessibilityLabel === label
      && !!n.props?.onPress,
    { deep: true },
  )[0];

const sheet = (counts = { view: 3, all: 12 }) =>
  render(
    <ExportSheet
      visible
      what="the list"
      counts={counts}
      onExport={onExport}
      onCancel={onCancel}
    />,
  );

beforeEach(() => jest.clearAllMocks());

describe('choosing what goes in', () => {
  it('shows both scopes with their counts, so the choice is a fact', () => {
    const r = sheet();
    expect(byLabel(r, "What's on screen, 3 rows")).toBeDefined();
    expect(byLabel(r, 'Everything, 12 rows')).toBeDefined();
  });

  it('starts on what you are looking at', async () => {
    const r = sheet();
    await press(pressableAround(r, 'PDF'));
    expect(onExport).toHaveBeenCalledWith('view', 'pdf');
  });

  it('exports everything once that is chosen', async () => {
    const r = sheet();
    await press(byLabel(r, 'Everything, 12 rows'));
    await press(pressableAround(r, 'Spreadsheet'));
    expect(onExport).toHaveBeenCalledWith('all', 'csv');
  });

  // One row is one row. "1 rows" is the kind of thing nobody notices until it
  // is in front of somebody about to trust the file.
  it('counts one row in the singular', () => {
    const r = sheet({ view: 1, all: 1 });
    expect(byLabel(r, "What's on screen, 1 row")).toBeDefined();
  });
});

describe('nothing to extract', () => {
  it('says so and offers neither format', () => {
    const r = sheet({ view: 0, all: 0 });

    expect(r.queryByText("There's nothing to put in it yet.")).not.toBeNull();
    const button = (label: string) =>
      r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];
    expect(button('Spreadsheet').props.disabled).toBe(true);
    expect(button('PDF').props.disabled).toBe(true);
  });

  // An empty view with a full house is the common case — you searched for
  // something that isn't there. Everything must still be reachable.
  it('still allows everything when only the view is empty', async () => {
    const r = sheet({ view: 0, all: 9 });
    await press(byLabel(r, 'Everything, 9 rows'));

    const button = (label: string) =>
      r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];
    expect(button('PDF').props.disabled).toBe(false);
  });
});

describe('while a file is being made', () => {
  it('refuses a second tap rather than making two', () => {
    const r = render(
      <ExportSheet visible what="the list" counts={{ view: 3, all: 12 }} busy
        onExport={onExport} onCancel={onCancel} />,
    );
    const button = (label: string) =>
      r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];

    expect(button('Spreadsheet').props.disabled).toBe(true);
    expect(button('PDF').props.disabled).toBe(true);
    expect(button('Cancel').props.disabled).toBe(true);
  });
});

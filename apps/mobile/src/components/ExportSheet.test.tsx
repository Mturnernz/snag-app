import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import ExportSheet from './ExportSheet';

// Two questions and one button. Spreadsheet and PDF used to *be* the action —
// two buttons that each chose a format and fired at the same moment — which put
// the only irreversible control one tap from opening the sheet, and left three
// of five controls drawn as the primary action with none of them labelled as
// one. Everything above the fold is a choice now; Export is the only filled
// button in the dialog.
//
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

const sheet = (counts = { view: 3, all: 12 }, canBrief = false) =>
  render(
    <ExportSheet
      visible
      what="the list"
      counts={counts}
      canBrief={canBrief}
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

  // The whole point of the change: picking a format decides nothing on its own.
  it('does not export until Export is pressed', async () => {
    const r = sheet();
    await press(byLabel(r, 'PDF'));
    await press(byLabel(r, 'Everything, 12 rows'));
    expect(onExport).not.toHaveBeenCalled();

    await press(pressableAround(r, 'Export'));
    expect(onExport).toHaveBeenCalledWith('all', 'pdf', false);
  });

  it('starts on what you are looking at, as a spreadsheet', async () => {
    const r = sheet();
    await press(pressableAround(r, 'Export'));
    expect(onExport).toHaveBeenCalledWith('view', 'csv', false);
  });

  // One row is one row. "1 rows" is the kind of thing nobody notices until it
  // is in front of somebody about to trust the file.
  it('counts one row in the singular', () => {
    const r = sheet({ view: 1, all: 1 });
    expect(byLabel(r, "What's on screen, 1 row")).toBeDefined();
  });
});

describe('the brief', () => {
  // Two named chips rather than one that toggles: a single "include the brief"
  // chip would leave the other answer as the unlabelled absence of a press,
  // which is the mistake the capture sheet's Urgent chip made.
  it('is offered on a PDF of the list, defaulted on', async () => {
    const r = sheet({ view: 3, all: 12 }, true);
    await press(byLabel(r, 'PDF'));
    await press(pressableAround(r, 'Export'));
    expect(onExport).toHaveBeenCalledWith('view', 'pdf', true);
  });

  it('is one tap to drop, for the copy somebody sends on', async () => {
    const r = sheet({ view: 3, all: 12 }, true);
    await press(byLabel(r, 'PDF'));
    await press(byLabel(r, 'To send to somebody'));
    await press(pressableAround(r, 'Export'));
    expect(onExport).toHaveBeenCalledWith('view', 'pdf', false);
  });

  // A brief is prose addressed to a reader; a spreadsheet's job is to be
  // sorted. The question goes away rather than greying out.
  it('is not asked about at all for a spreadsheet', async () => {
    const r = sheet({ view: 3, all: 12 }, true);
    expect(r.queryByText('To get it assessed')).toBeNull();
    await press(pressableAround(r, 'Export'));
    expect(onExport).toHaveBeenCalledWith('view', 'csv', false);
  });

  // Nothing is wrong with a dishwasher that is merely recorded, so the house
  // record never offers it — a question whose answer changes nothing is worse
  // than no question.
  it('is never offered on an extract that cannot carry it', async () => {
    const r = sheet();
    await press(byLabel(r, 'PDF'));
    expect(r.queryByText('To get it assessed')).toBeNull();
    await press(pressableAround(r, 'Export'));
    expect(onExport).toHaveBeenCalledWith('view', 'pdf', false);
  });
});

const button = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => typeof n.type !== 'string' && n.props?.label === label)[0];

describe('what the two files actually differ by', () => {
  // The one real difference between them, and the reason somebody picks the
  // PDF. Saying it on the sheet stops the CSV being opened in search of
  // pictures a spreadsheet cell was never going to hold.
  it('says the photos ride in the PDF, and only there', () => {
    const r = sheet();
    expect(r.queryByText('No photos in a spreadsheet — just how many each row has.'))
      .not.toBeNull();
  });

  it('names the cap once the PDF is chosen', async () => {
    const r = sheet();
    await press(byLabel(r, 'PDF'));
    expect(r.queryByText('The photos go in too, up to 20 of them.')).not.toBeNull();
  });
});

describe('nothing to extract', () => {
  it('says so and will not export', () => {
    const r = sheet({ view: 0, all: 0 });

    expect(r.queryByText("There's nothing to put in it yet.")).not.toBeNull();
    expect(button(r, 'Export').props.disabled).toBe(true);
  });

  // An empty view with a full house is the common case — you searched for
  // something that isn't there. Everything must still be reachable.
  it('still allows everything when only the view is empty', async () => {
    const r = sheet({ view: 0, all: 9 });
    await press(byLabel(r, 'Everything, 9 rows'));
    expect(button(r, 'Export').props.disabled).toBe(false);
  });
});

describe('while a file is being made', () => {
  it('refuses a second tap rather than making two', () => {
    const r = render(
      <ExportSheet visible what="the list" counts={{ view: 3, all: 12 }} busy
        onExport={onExport} onCancel={onCancel} />,
    );

    expect(button(r, 'Export').props.disabled).toBe(true);
    expect(button(r, 'Cancel').props.disabled).toBe(true);
  });
});

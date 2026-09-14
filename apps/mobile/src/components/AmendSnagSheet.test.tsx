import React from 'react';
import TestRenderer from 'react-test-renderer';
import AmendSnagSheet, { firstStep } from './AmendSnagSheet';
import { render, flattenStyle, type RenderResult } from '../test/render';
import { Colors } from '../constants/theme';
import type { Snag } from '../types';

jest.mock('../hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

// Which question gets asked first, and why.
//
// A photo with no words and no room is the weakest thing this app can hold —
// `snagHeadline` has nothing to work with and the list reads "Something to sort
// out", which is unreadable a fortnight later to the person who filed it. So a
// wordless snag is asked what it is. A snag that arrived as typed words is
// already its own description; asking again would be asking twice.

const snag = (over: Partial<Snag> = {}): Snag => ({
  id: 's1', reference: 'S-100', householdId: 'h', propertyId: 'p',
  room: null, photoPaths: [], description: null, priority: null,
  status: 'open', parts: [], needsParts: false,
  dueAt: null, repeatDays: null, assigneeId: null, thingId: null,
  reporterId: 'me', createdAt: '', updatedAt: '', lastDoneAt: null, doneAt: null,
  propertyName: 'Home', reporterName: 'Matt', assigneeName: null, commentCount: 0,
  thingName: null, thingMake: null, thingModel: null,
  ...over,
});

describe('where the sheet opens', () => {
  it('asks a photo-only snag what is wrong', () => {
    expect(firstStep(snag({ photoPaths: ['h/a.jpg'] }))).toBe('note');
  });

  it('skips straight to the room when the snag arrived as words', () => {
    expect(firstStep(snag({ description: 'Gutters need clearing' }))).toBe('room');
  });

  it('treats a photo taken after typing as already having its words', () => {
    // The compose bar carries whatever is in the field onto the photo, so this
    // snag has both and needs neither asked.
    expect(firstStep(snag({ photoPaths: ['h/a.jpg'], description: 'Hinge sheared' }))).toBe('room');
  });
});

// ---------------------------------------------------------------- how urgent
//
// The last question the sheet asks, and the one that changed shape. It used to
// be a single "Urgent" chip: pressing it marked the snag, and not pressing it
// meant not urgent — a state nothing on the sheet ever said out loud. Two named
// pills say both answers, and the one already true is the one already lit.

const textOf = (node: any): string =>
  (node.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');

/** The pressable whose only content is `label` — one of the two pills. */
const chip = (result: RenderResult, label: string) =>
  result.root.findAll(
    (n) => typeof n.type !== 'string' && !!n.props?.onPress && textOf(n) === label,
    { deep: true }
  )[0];

const byLabel = (result: RenderResult, label: string) =>
  result.root.findAll(
    (n) => typeof n.type !== 'string' && !!n.props?.onPress && n.props?.accessibilityLabel === label,
    { deep: true }
  )[0];

/** Opens the sheet on its last step. The snag has words, so room comes first. */
async function openOnUrgency(over: Partial<Snag> = {}) {
  const onSetUrgent = jest.fn().mockResolvedValue(undefined);
  const result = render(
    <AmendSnagSheet
      snag={snag({ description: 'Gutters', ...over })}
      locations={[]}
      onSaveNote={jest.fn()}
      onSetRoom={jest.fn()}
      onSetUrgent={onSetUrgent}
      onOpenDetail={jest.fn()}
      onClose={jest.fn()}
    />
  );
  await TestRenderer.act(async () => { byLabel(result, 'Next').props.onPress(); });
  return { result, onSetUrgent };
}

describe('how urgent', () => {
  it('opens on Not urgent, with nothing having been written to say so', async () => {
    // The default is the premise of the list rather than a decision anybody
    // makes: nearly everything here can wait. `null` and `low` both already
    // mean not urgent, so the sheet can say it without touching the row.
    const { result, onSetUrgent } = await openOnUrgency({ priority: null });

    expect(chip(result, 'Not urgent').props.accessibilityState.selected).toBe(true);
    expect(chip(result, 'Urgent').props.accessibilityState.selected).toBe(false);
    expect(onSetUrgent).not.toHaveBeenCalled();
  });

  it('writes nothing when the answer already on screen is pressed again', async () => {
    const { result, onSetUrgent } = await openOnUrgency({ priority: null });
    await TestRenderer.act(async () => { chip(result, 'Not urgent').props.onPress(); });
    expect(onSetUrgent).not.toHaveBeenCalled();
  });

  it('marks it urgent, and clay is the only hue in the row', async () => {
    const { result, onSetUrgent } = await openOnUrgency({ priority: null });
    await TestRenderer.act(async () => { chip(result, 'Urgent').props.onPress(); });
    expect(onSetUrgent).toHaveBeenCalledWith(true);

    const marked = await openOnUrgency({ priority: 'high' });
    const urgent = chip(marked.result, 'Urgent');
    expect(urgent.props.accessibilityState.selected).toBe(true);
    const fill = flattenStyle(
      urgent.findAll((n) => typeof n.type === 'string')[0].props.style
    );
    expect(fill.backgroundColor).toBe(Colors.danger);
  });

  it('asks its questions and explains none of them', async () => {
    // Every step used to carry a paragraph under its question — three of them,
    // on a sheet whose whole argument is that it costs nothing to walk away
    // from.
    const { result } = await openOnUrgency({ priority: null });
    const prose = result.getAllByType('Text').map(textOf);

    expect(prose).toContain('Does it need doing now?');
    expect(prose.some((t) => t.includes('which is the point of the list'))).toBe(false);
    expect(prose.some((t) => t.includes('A few words is plenty'))).toBe(false);
    expect(prose.some((t) => t.includes('The list groups by room'))).toBe(false);
  });
});

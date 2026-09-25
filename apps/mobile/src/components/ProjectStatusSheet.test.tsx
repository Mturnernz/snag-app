import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render, type RenderResult } from '../test/render';
import ProjectStatusSheet from './ProjectStatusSheet';
import { dayKey } from '@snag/supabase-queries';

/**
 * Where a project is up to. Every move is one write, carrying the date that
 * goes with it, and a date the calendar has not got holds the sheet open.
 */

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const today = dayKey(new Date());

const tap = (r: RenderResult, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && n.props.onPress, { deep: true })[0];
const boxes = (r: RenderResult) =>
  r.root.findAll((n) => typeof n.type === 'string' && 'onChangeText' in n.props, { deep: true });

function open(over: { status?: any; startedOn?: string | null; finishedOn?: string | null } = {}) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  const r = render(
    <ProjectStatusSheet
      visible
      status={over.status ?? 'planned'}
      startedOn={over.startedOn ?? null}
      finishedOn={over.finishedOn ?? null}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { r, onSave, onClose };
}

const done = async (r: RenderResult) => {
  await TestRenderer.act(async () => { tap(r, 'Done').props.onPress(); });
};

it('offers Planned, Underway and Complete', () => {
  const { r } = open();
  r.getByText('Planned');
  r.getByText('Underway');
  r.getByText('Complete');
});

it('starts a planned project today in one write', async () => {
  const { r, onSave, onClose } = open();
  TestRenderer.act(() => tap(r, 'Underway').props.onPress());
  await done(r);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({ status: 'underway', startedOn: today });
  expect(onClose).toHaveBeenCalled();
});

it('completes a project today, keeping the day it started', async () => {
  const { r, onSave } = open({ status: 'underway', startedOn: '2026-03-03' });
  TestRenderer.act(() => tap(r, 'Complete').props.onPress());
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: '2026-03-03', finishedOn: today });
});

it('takes a typed finish date, day first', async () => {
  const { r, onSave } = open({ status: 'underway', startedOn: '2026-03-03' });
  TestRenderer.act(() => tap(r, 'Complete').props.onPress());
  const finished = boxes(r)[1];
  TestRenderer.act(() => finished.props.onChangeText('8/09/2026'));
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-08' });
});

it('clears the finish date when a complete project is reopened', async () => {
  const { r, onSave } = open({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-01' });
  TestRenderer.act(() => tap(r, 'Underway').props.onPress());
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'underway', startedOn: '2026-03-03', finishedOn: null });
});

it('leaves the start date alone when a project goes back to planned', async () => {
  const { r, onSave } = open({ status: 'underway', startedOn: '2026-03-03' });
  TestRenderer.act(() => tap(r, 'Planned').props.onPress());
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'planned' });
});

it('holds the sheet open on a date the calendar has not got', async () => {
  const { r, onSave, onClose } = open({ status: 'underway', startedOn: '2026-03-03' });
  TestRenderer.act(() => boxes(r)[0].props.onChangeText('31/02/2026'));
  await done(r);
  r.getByText('The start date isn’t a day the calendar has.');
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

/*
 * A project cannot finish before it started. The box somebody just changed is
 * the one they meant, and the other moves to meet it — with a line saying so.
 */

it('fills an empty start with the finish when the project already finished, never with today', async () => {
  // The Roof: finished in June 2024, recorded in September 2026 with no start.
  const { r, onSave } = open({ status: 'planned', finishedOn: '2024-06-25' });
  TestRenderer.act(() => tap(r, 'Complete').props.onPress());
  expect(boxes(r)[0].props.value).toBe('25/06/2024');
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: '2024-06-25', finishedOn: '2024-06-25' });
});

it('moves the start back to a finish set before it, and says so', async () => {
  const { r, onSave } = open({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-01' });
  const finished = boxes(r)[1];
  TestRenderer.act(() => finished.props.onChangeText('25/06/2024'));
  TestRenderer.act(() => boxes(r)[1].props.onBlur());
  expect(boxes(r)[0].props.value).toBe('25/06/2024');
  r.getByText('Started moved to 25/06/2024 — a job can’t finish before it starts.');
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: '2024-06-25', finishedOn: '2024-06-25' });
});

it('moves the finish forward to a start set after it', async () => {
  const { r, onSave } = open({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-01' });
  TestRenderer.act(() => boxes(r)[0].props.onChangeText('10/09/2026'));
  TestRenderer.act(() => boxes(r)[0].props.onBlur());
  expect(boxes(r)[1].props.value).toBe('10/09/2026');
  r.getByText('Finished moved to 10/09/2026 — a job can’t finish before it starts.');
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: '2026-09-10', finishedOn: '2026-09-10' });
});

it('orders a day the calendar filled and blurred in one gesture', () => {
  // The calendar writes the box and leaves it before React re-renders, so the
  // blur has to read what was just written rather than the state before it.
  const { r } = open({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-01' });
  const finished = boxes(r)[1];
  TestRenderer.act(() => {
    finished.props.onChangeText('25/06/2024');
    finished.props.onBlur();
  });
  expect(boxes(r)[0].props.value).toBe('25/06/2024');
});

it('orders the dates on Done when the box was never left, the edited one winning', async () => {
  const { r, onSave } = open({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-01' });
  TestRenderer.act(() => boxes(r)[1].props.onChangeText('01/01/2026'));
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: '2026-01-01', finishedOn: '2026-01-01' });
});

it('leaves dates in order alone and says nothing', async () => {
  const { r, onSave } = open({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-01' });
  TestRenderer.act(() => boxes(r)[1].props.onChangeText('02/09/2026'));
  TestRenderer.act(() => boxes(r)[1].props.onBlur());
  expect(r.root.findAll((n) => typeof n.props.children === 'string' && n.props.children.includes('moved to'))).toHaveLength(0);
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: '2026-03-03', finishedOn: '2026-09-02' });
});

it('does nothing when the status already chosen is pressed again', async () => {
  // It used to re-run the fill, which is how an empty start became today on a
  // project that finished two years ago.
  const { r, onSave } = open({ status: 'done', finishedOn: '2024-06-25' });
  TestRenderer.act(() => tap(r, 'Complete').props.onPress());
  expect(boxes(r)[0].props.value).toBe('');
  await done(r);
  expect(onSave).toHaveBeenCalledWith({ status: 'done', startedOn: null, finishedOn: '2024-06-25' });
});

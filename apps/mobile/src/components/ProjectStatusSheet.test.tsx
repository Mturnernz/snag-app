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

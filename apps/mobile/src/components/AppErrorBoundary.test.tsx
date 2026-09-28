import React from 'react';
import { Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import AppErrorBoundary from './AppErrorBoundary';

// A render that throws used to take the whole tree down to a blank page, which
// nobody can tell from a slow connection. The boundary says so in words, offers
// the way back, and hands the error to monitoring.

const mock_reportError = jest.fn();
jest.mock('../lib/monitoring', () => ({ reportError: (...a: unknown[]) => mock_reportError(...a) }));

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('render failed');
  return <Text>Everything is fine</Text>;
}

beforeEach(() => {
  mock_reportError.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

it('renders what it holds when nothing throws', () => {
  const r = render(
    <AppErrorBoundary>
      <Boom fail={false} />
    </AppErrorBoundary>,
  );
  expect(r.getByText('Everything is fine')).toBeTruthy();
  expect(mock_reportError).not.toHaveBeenCalled();
});

it('says something went wrong in words, rather than rendering nothing', () => {
  const r = render(
    <AppErrorBoundary>
      <Boom fail />
    </AppErrorBoundary>,
  );
  expect(r.getByText('Something went wrong')).toBeTruthy();
  expect(r.getByText('Reload')).toBeTruthy();
});

it('reports the error once, tagged with where it was caught', () => {
  render(
    <AppErrorBoundary>
      <Boom fail />
    </AppErrorBoundary>,
  );
  expect(mock_reportError).toHaveBeenCalledTimes(1);
  const [error, context] = mock_reportError.mock.calls[0];
  expect((error as Error).message).toBe('render failed');
  expect(context).toMatchObject({ boundary: 'app' });
});

it('tries again when Reload is pressed', async () => {
  let fail = true;
  function Flaky() {
    if (fail) throw new Error('once');
    return <Text>Back</Text>;
  }
  const r = render(
    <AppErrorBoundary>
      <Flaky />
    </AppErrorBoundary>,
  );
  fail = false;
  let node: any = r.getByText('Reload');
  while (node && typeof node.props?.onPress !== 'function') node = node.parent;
  await TestRenderer.act(async () => node.props.onPress());
  expect(r.getByText('Back')).toBeTruthy();
});

import React from 'react';
import { render } from '../test/render';
import TaggedFiles from './TaggedFiles';

/**
 * The job's paperwork gathered in one place. A planned job's quote PDF lived on
 * the quote and on no screen but the quote's own, so a job with one piece of
 * paper looked like a job with none.
 */

jest.mock('../lib/supabase', () => ({ getFileUrl: jest.fn() }));
jest.mock('../lib/openUrl', () => ({ openUrl: jest.fn() }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));

const file = (over: any) => ({
  projectId: 'p1', level: 'quote', ownerId: 'q1', ownerName: 'Shore Tree Services Limited', kind: 'document',
  path: 'h/docs/1790290589511-065591-Quote QU4068.pdf', ...over,
});

it('lists a quote\'s PDF and says which price it is on', () => {
  const r = render(<TaggedFiles files={[file({})]} tags={{}} />);
  r.getByText('On prices and parts');
  r.getByText('Quote QU4068.pdf');
  r.getByText('On Shore Tree Services Limited');
});

it('does not repeat a file on the job itself, which is listed directly beneath', () => {
  const r = render(<TaggedFiles files={[file({ level: 'project', ownerName: 'Tree trimming' })]} tags={{}} />);
  expect(r.queryByText('On prices and parts')).toBeNull();
});

it('puts a tagged file under its tag rather than twice', () => {
  const f = file({});
  const r = render(<TaggedFiles files={[f]} tags={{ [f.path]: 'compliance' }} />);
  r.getByText('Compliance certificates');
  expect(r.queryByText('On prices and parts')).toBeNull();
});

it('draws nothing when there is nothing to gather', () => {
  const r = render(<TaggedFiles files={[]} tags={{}} />);
  expect(r.toJSON()).toBeNull();
});

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
  path: 'h/docs/1790290589511-065591-Quote QU4068.pdf', supplier: 'Shore Tree Services Limited', ownerDetail: null,
  ...over,
});

it('leaves untagged paperwork to the Documents list, which groups it by supplier', () => {
  const r = render(<TaggedFiles files={[file({})]} tags={{}} />);
  expect(r.queryByText('On prices and parts')).toBeNull();
  expect(r.toJSON()).toBeNull();
});

it('gathers a tagged file under its tag, naming who it came from', () => {
  const f = file({});
  const r = render(<TaggedFiles files={[f]} tags={{ [f.path]: 'compliance' }} />);
  r.getByText('Compliance certificates');
  r.getByText('Quote QU4068.pdf');
  r.getByText('Compliance certificate · from Shore Tree Services Limited');
});

it('says where a tagged file is when nobody sent it', () => {
  const f = file({ level: 'element', ownerName: 'Bathroom', supplier: null });
  const r = render(<TaggedFiles files={[f]} tags={{ [f.path]: 'warranty' }} />);
  r.getByText('Warranty · on Bathroom');
});

it('draws nothing when there is nothing to gather', () => {
  const r = render(<TaggedFiles files={[]} tags={{}} />);
  expect(r.toJSON()).toBeNull();
});

import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import Attachments from './Attachments';

/**
 * What a strip says when the photographs are there and the signing is not.
 *
 * `getFileUrls` keeps whatever signed and logs the rest to a console nobody on
 * a phone is reading, so a failure rendered as grey tiles — indistinguishable
 * from photographs that were never taken, on the one screen whose job is to be
 * believed in a shop eight months later.
 */

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../lib/openUrl', () => ({ openUrl: jest.fn() }));
jest.mock('../lib/addPhotos', () => ({ addPhotos: jest.fn() }));
jest.mock('../lib/alert', () => ({ showAlert: jest.fn() }));
jest.mock('./PhotoViewer', () => ({ __esModule: true, default: () => null }));

const mock_getFileUrls = jest.fn();
jest.mock('../lib/supabase', () => ({
  getFileUrl: jest.fn(),
  getFileUrls: (...a: unknown[]) => mock_getFileUrls(...a),
  uploadFile: jest.fn(),
}));

const props = {
  householdId: 'h',
  documentPaths: [],
  onChange: jest.fn(),
};

async function arrange(photoPaths: string[], signed: Record<string, string>) {
  mock_getFileUrls.mockResolvedValue(signed);
  const r = render(<Attachments {...props} photoPaths={photoPaths} />);
  await TestRenderer.act(async () => {});
  return r;
}

beforeEach(() => jest.clearAllMocks());

it('says how many photos could not be loaded, and that they are still there', async () => {
  const r = await arrange(['h/1.jpg', 'h/2.jpg', 'h/3.jpg'], { 'h/1.jpg': 'https://x/1' });
  r.getByText("2 photos couldn't be loaded just now — they're still on the record.");
});

it('says it in the singular for one', async () => {
  const r = await arrange(['h/1.jpg', 'h/2.jpg'], { 'h/1.jpg': 'https://x/1' });
  r.getByText("1 photo couldn't be loaded just now — it's still on the record.");
});

it('says nothing when every photo signed', async () => {
  const r = await arrange(['h/1.jpg'], { 'h/1.jpg': 'https://x/1' });
  expect(r.queryByText("1 photo couldn't be loaded just now — it's still on the record.")).toBeNull();
});

it('says nothing while the answer is still coming', async () => {
  // Waiting and came-back-empty are the same state — an empty map — so without
  // the guard this would flash on every mount before the URLs arrive, which is
  // the opposite failure and a worse one.
  mock_getFileUrls.mockReturnValue(new Promise(() => {}));
  const r = render(<Attachments {...props} photoPaths={['h/1.jpg']} />);
  await TestRenderer.act(async () => {});
  expect(r.queryByText("1 photo couldn't be loaded just now — it's still on the record.")).toBeNull();
});

it('says nothing about a record that holds no photographs', async () => {
  const r = await arrange([], {});
  expect(mock_getFileUrls).not.toHaveBeenCalled();
  expect(r.queryByText("1 photo couldn't be loaded just now — it's still on the record.")).toBeNull();
});

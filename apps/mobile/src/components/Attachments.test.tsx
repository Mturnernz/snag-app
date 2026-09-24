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

// What a document is, said on the document itself.
describe('tagging a document', () => {
  const doc = 'h/docs/1790280171137-227018-Electrical - Certificate of Compliance.pdf';
  const labelled = (r: ReturnType<typeof render>, label: string) =>
    r.root.findAll((n: any) => n.props?.accessibilityLabel === label && n.props?.onPress, { deep: true })[0];

  async function withTags(tags: Record<string, any>, onTag = jest.fn().mockResolvedValue(undefined)) {
    mock_getFileUrls.mockResolvedValue({});
    const r = render(<Attachments {...props} photoPaths={[]} documentPaths={[doc]} tags={tags} onTag={onTag} />);
    await TestRenderer.act(async () => {});
    return { r, onTag };
  }

  it('offers no tag at all where the caller has not asked for tags', async () => {
    mock_getFileUrls.mockResolvedValue({});
    const r = render(<Attachments {...props} photoPaths={[]} documentPaths={[doc]} />);
    await TestRenderer.act(async () => {});
    expect(r.queryByText('Tag')).toBeNull();
  });

  it('shows what a document has been tagged as', async () => {
    const { r } = await withTags({ [doc]: 'compliance' });
    r.getByText('Compliance certificate');
  });

  it('opens the choices from the pill and writes the one pressed', async () => {
    const { r, onTag } = await withTags({});
    r.getByText('Tag');
    await TestRenderer.act(async () => { labelled(r, 'Say what Electrical - Certificate of Compliance.pdf is').props.onPress(); });
    await TestRenderer.act(async () => { labelled(r, 'Warranty').props.onPress(); });
    expect(onTag).toHaveBeenCalledWith(doc, 'warranty');
  });

  it('untags when the lit choice is pressed again', async () => {
    const { r, onTag } = await withTags({ [doc]: 'product_sheet' });
    await TestRenderer.act(async () => {
      labelled(r, 'Product sheet — change what Electrical - Certificate of Compliance.pdf is').props.onPress();
    });
    await TestRenderer.act(async () => { labelled(r, 'Product sheet').props.onPress(); });
    expect(onTag).toHaveBeenCalledWith(doc, null);
  });
});

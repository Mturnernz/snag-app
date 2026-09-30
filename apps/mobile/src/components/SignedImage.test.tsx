import React from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import SignedImage from './SignedImage';

/**
 * A photo whose link has gone stale asks for a new one, once.
 *
 * The launch check found six photos drawn blank on a phone because their links
 * had expired while the app sat in the background. The cache in
 * `lib/signedUrls.ts` keeps that from happening on a reload; this is the
 * backstop for a link that fails anyway.
 */

const mock_refreshFileUrl = jest.fn();
jest.mock('../lib/supabase', () => ({
  HOUSEHOLD_FILES_BUCKET: 'home-photos',
  refreshFileUrl: (...a: unknown[]) => mock_refreshFileUrl(...a),
}));

const PATH = 'h/1789427392115-238437.jpg';
const EXPIRED = `https://x.supabase.co/storage/v1/object/sign/home-photos/${PATH}?token=old`;
const FRESH = `https://x.supabase.co/storage/v1/object/sign/home-photos/${PATH}?token=new`;

const STYLE = { width: 84, height: 84 };

function render(uri: string | undefined): ReactTestRenderer {
  let r!: ReactTestRenderer;
  TestRenderer.act(() => { r = TestRenderer.create(<SignedImage uri={uri} style={STYLE} />); });
  return r;
}

const images = (r: ReactTestRenderer) =>
  r.root.findAll((n) => (n.type as unknown) === 'Image', { deep: true });

function drawnUri(r: ReactTestRenderer): string | null {
  const found = images(r);
  return found.length === 0 ? null : (found[0].props.source as { uri: string }).uri;
}

const labelled = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === label);

async function fail(r: ReactTestRenderer) {
  await TestRenderer.act(async () => {
    images(r)[0].props.onError();
  });
}

beforeEach(() => jest.clearAllMocks());

it('draws the link it was given', () => {
  const r = render(EXPIRED);
  expect(drawnUri(r)).toBe(EXPIRED);
});

it('signs the path again when the link fails, and draws the new one', async () => {
  mock_refreshFileUrl.mockResolvedValue(FRESH);
  const r = render(EXPIRED);
  await fail(r);
  expect(mock_refreshFileUrl).toHaveBeenCalledWith(PATH);
  expect(drawnUri(r)).toBe(FRESH);
});

it('tries once, and then draws a placeholder rather than an empty frame', async () => {
  mock_refreshFileUrl.mockResolvedValue(FRESH);
  const r = render(EXPIRED);
  await fail(r);
  await fail(r);
  expect(mock_refreshFileUrl).toHaveBeenCalledTimes(1);
  expect(drawnUri(r)).toBeNull();
  expect(labelled(r, "Photo couldn't load")).toHaveLength(1);
});

it('gives up at once when no new link can be had', async () => {
  mock_refreshFileUrl.mockResolvedValue(null);
  const r = render(EXPIRED);
  await fail(r);
  expect(drawnUri(r)).toBeNull();
});

it('starts over when the screen hands it a new link', async () => {
  mock_refreshFileUrl.mockResolvedValue(null);
  const r = render(EXPIRED);
  await fail(r);
  expect(drawnUri(r)).toBeNull();
  TestRenderer.act(() => { r.update(<SignedImage uri={FRESH} style={STYLE} />); });
  expect(drawnUri(r)).toBe(FRESH);
});

it('draws an empty frame, not a failure, while the link is still being signed', () => {
  const r = render(undefined);
  expect(drawnUri(r)).toBeNull();
  expect(labelled(r, "Photo couldn't load")).toHaveLength(0);
});

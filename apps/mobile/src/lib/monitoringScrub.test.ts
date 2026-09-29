import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from './monitoringScrub';

// The privacy statement says an error report has its links, email addresses
// and anything typed removed before it is sent. These hold the code to that
// sentence, one secret at a time.

describe('scrubUrl', () => {
  it('masks the token in a join link, which is a way into somebody’s household', () => {
    expect(scrubUrl('https://app.snaghq.co.nz/join/8f1c2a90-aaaa-4bbb-8ccc-1234567890ab'))
      .toBe('https://app.snaghq.co.nz/join/[token]');
  });

  it('drops the query, where a signed storage URL keeps its signature', () => {
    expect(scrubUrl('https://x.supabase.co/storage/v1/object/sign/home-photos/h/p.jpg?token=eyJabc'))
      .toBe('https://x.supabase.co/storage/v1/object/sign/home-photos/h/p.jpg');
  });

  it('drops the fragment, where a recovery link keeps its session', () => {
    expect(scrubUrl('https://www.snaghq.co.nz/reset-password#access_token=abc&type=recovery'))
      .toBe('https://www.snaghq.co.nz/reset-password');
  });

  it('keeps a job’s id, which names a row rather than a person', () => {
    expect(scrubUrl('https://app.snaghq.co.nz/snags/5d7e1f2a-0000-4000-8000-000000000001'))
      .toBe('https://app.snaghq.co.nz/snags/5d7e1f2a-0000-4000-8000-000000000001');
  });
});

describe('scrubText', () => {
  it('masks email addresses anywhere in a message', () => {
    expect(scrubText('Invite failed for sam@example.co.nz, try again'))
      .toBe('Invite failed for [email], try again');
  });

  it('cuts back every URL a message mentions', () => {
    expect(scrubText('Failed to fetch https://x.supabase.co/rest/v1/snags?select=*&id=eq.1 (network)'))
      .toBe('Failed to fetch https://x.supabase.co/rest/v1/snags (network)');
  });

  it('masks a join path even without its origin', () => {
    expect(scrubText('route /join/abc123 did not match')).toBe('route /join/[token] did not match');
  });
});

describe('scrubEvent', () => {
  const event = {
    message: 'Error for mike@example.com',
    transaction: '/join/secret-token',
    user: { email: 'mike@example.com', ip_address: '1.2.3.4' },
    request: {
      url: 'https://app.snaghq.co.nz/join/secret-token?x=1',
      data: { note: 'what somebody typed' },
      query_string: 'x=1',
      cookies: { sb: 'session' },
      headers: { Authorization: 'Bearer abc' },
    },
    exception: { values: [{ type: 'Error', value: 'Upload to https://x.supabase.co/a?token=t failed' }] },
    breadcrumbs: [
      { category: 'console', message: 'debug', data: { arguments: ['everything'] } },
      { category: 'navigation', data: { from: '/join/secret-token', to: '/snags/1?tab=a' } },
      { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/rpc/x?y=1', body: '{"p":"typed"}' } },
    ],
  };

  const scrubbed = scrubEvent(event);

  it('removes who it was', () => {
    expect(scrubbed.user).toBeUndefined();
  });

  it('keeps only the request’s address, cut back', () => {
    expect(scrubbed.request).toEqual({ url: 'https://app.snaghq.co.nz/join/[token]' });
  });

  it('masks the message, the route and the exception', () => {
    expect(scrubbed.message).toBe('Error for [email]');
    expect(scrubbed.transaction).toBe('/join/[token]');
    expect(scrubbed.exception?.values?.[0].value).toBe('Upload to https://x.supabase.co/a failed');
    expect(scrubbed.exception?.values?.[0]).toMatchObject({ type: 'Error' });
  });

  it('drops console breadcrumbs, and bodies from the rest', () => {
    expect(scrubbed.breadcrumbs).toEqual([
      { category: 'navigation', data: { from: '/join/[token]', to: '/snags/1' } },
      { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/rpc/x' } },
    ]);
  });

  it('does not change the event it was given', () => {
    expect(event.user).toBeDefined();
    expect(event.request.data).toBeDefined();
  });

  it('never drops the event itself', () => {
    expect(scrubEvent({})).toEqual({});
  });
});

describe('scrubBreadcrumb', () => {
  it('drops a console breadcrumb whole', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
  });

  it('keeps a click’s selector', () => {
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'div > button' }))
      .toEqual({ category: 'ui.click', message: 'div > button' });
  });
});

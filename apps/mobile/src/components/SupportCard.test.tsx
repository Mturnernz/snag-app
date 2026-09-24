import React from 'react';
import TestRenderer from 'react-test-renderer';
import { render } from '../test/render';
import SupportCard from './SupportCard';
import type { SupportRequest } from '../types';

// The question asked of SnagHQ, on the job page. What matters here is that the
// household can always tell whether SnagHQ can still see the job, and that the
// one control that ends that access says so before it does.

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const request = (over: Partial<SupportRequest> = {}): SupportRequest => ({
  id: 'r1', snagId: 's1', status: 'waiting', question: 'Why does it drip?',
  createdAt: ago(2), waitingSince: ago(2), firstSeenAt: null, lastStaffReplyAt: null,
  closedAt: null, closedBy: null, messages: [],
  ...over,
});

const labelled = (r: ReturnType<typeof render>, label: string) =>
  r.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];

const setup = (req: SupportRequest) => {
  const handlers = {
    onReply: jest.fn().mockResolvedValue(true),
    onClose: jest.fn(),
    onAskAgain: jest.fn(),
  };
  const r = render(<SupportCard request={req} {...handlers} />);
  return { r, ...handlers };
};

describe('SupportCard', () => {
  it('says nobody has looked yet, in words', () => {
    const { r } = setup(request());
    expect(r.getAllByText('Asked SnagHQ')).toHaveLength(1);
    expect(r.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
      .some((n: any) => /^Waiting for SnagHQ · asked /.test(String(n.children.join(''))))).toBe(true);
  });

  it('names SnagHQ on its replies and points at the assessment', () => {
    const { r } = setup(request({
      status: 'replied', lastStaffReplyAt: ago(1),
      messages: [{
        id: 'm1', fromStaff: true, authorName: 'Sam', body: 'It is the washer.',
        internal: false, withAdvice: true, emailedAt: ago(1), createdAt: ago(1),
      }],
    }));
    expect(r.queryByText('It is the washer.')).not.toBeNull();
    expect(r.queryByText("Sent an assessment — it's on this job, below.")).not.toBeNull();
  });

  it('asks before closing, and says what closing does', async () => {
    const { r, onClose } = setup(request());
    await TestRenderer.act(async () => { labelled(r, 'Close this question').props.onPress(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(r.queryByText("SnagHQ won't be able to see this job any more. What they said stays here.")).not.toBeNull();
  });

  it('sends a reply and empties the box', async () => {
    const { r, onReply } = setup(request());
    const box = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Reply to SnagHQ'
      && typeof n.props?.onChangeText === 'function')[0];
    await TestRenderer.act(async () => { box.props.onChangeText(' Thanks '); });
    await TestRenderer.act(async () => { await labelled(r, 'Send reply').props.onPress(); });
    expect(onReply).toHaveBeenCalledWith('Thanks');
    const after = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Reply to SnagHQ'
      && typeof n.props?.onChangeText === 'function')[0];
    expect(after.props.value).toBe('');
  });

  it('offers no reply box once access has lapsed, only asking again', () => {
    const { r } = setup(request({ status: 'replied', lastStaffReplyAt: ago(20) }));
    expect(labelled(r, 'Send reply')).toBeUndefined();
    expect(labelled(r, 'Ask SnagHQ again')).toBeDefined();
    expect(r.queryByText('Closed — SnagHQ can no longer see this job')).not.toBeNull();
  });
});

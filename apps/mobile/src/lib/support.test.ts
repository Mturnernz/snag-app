import {
  adviceDraftFrom,
  adviceDraftProblems,
  cleanAdviceDraft,
  describeSupportStatus,
  describeWait,
  supportAccessEndsAt,
  supportIsOpen,
  supportReplyEmail,
} from '@snag/supabase-queries';
import { SUPPORT_ACCESS_DAYS, type AdviceDraft, type SupportRequest } from '@snag/shared-types';

// Asking SnagHQ about a job. These pin the rules the app and the staff portal
// share, and the one most worth pinning is the first: whether SnagHQ can still
// see the job. The card on the job page says so in words, and if this and
// `home.support_is_open` ever disagree, a household is told its job is private
// when it is not.

const NOW = new Date('2026-10-20T09:00:00+13:00');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

function request(over: Partial<SupportRequest> = {}): SupportRequest {
  return {
    id: 'r1',
    snagId: 's1',
    status: 'waiting',
    question: 'Why does it drip?',
    createdAt: daysAgo(3),
    waitingSince: daysAgo(3),
    firstSeenAt: null,
    lastStaffReplyAt: null,
    closedAt: null,
    closedBy: null,
    messages: [],
    ...over,
  };
}

describe('supportIsOpen', () => {
  it('is open while it waits on SnagHQ, however long that takes', () => {
    expect(supportIsOpen(request({ waitingSince: daysAgo(90) }), NOW)).toBe(true);
  });

  it(`stays open for ${SUPPORT_ACCESS_DAYS} days after SnagHQ replies, and not a day more`, () => {
    expect(supportIsOpen(request({ status: 'replied', lastStaffReplyAt: daysAgo(13) }), NOW)).toBe(true);
    expect(supportIsOpen(request({ status: 'replied', lastStaffReplyAt: daysAgo(15) }), NOW)).toBe(false);
  });

  it('is shut the moment it is closed', () => {
    expect(supportIsOpen(request({ status: 'closed', closedAt: daysAgo(0), closedBy: 'customer' }), NOW)).toBe(false);
  });

  it('knows when access ends only once it is the household’s turn', () => {
    expect(supportAccessEndsAt(request())).toBeNull();
    const ends = supportAccessEndsAt(request({ status: 'replied', lastStaffReplyAt: daysAgo(1) }));
    expect(ends?.getTime()).toBe(new Date(daysAgo(1)).getTime() + SUPPORT_ACCESS_DAYS * 86400000);
  });
});

describe('describeSupportStatus', () => {
  it('says nobody has looked yet, rather than nothing', () => {
    expect(describeSupportStatus(request(), NOW)).toMatch(/^Waiting for SnagHQ · asked /);
  });

  it('says when it was seen', () => {
    expect(describeSupportStatus(request({ firstSeenAt: daysAgo(1) }), NOW)).toMatch(/^Seen by SnagHQ /);
  });

  it('says how long the job stays shared after a reply', () => {
    expect(
      describeSupportStatus(request({ status: 'replied', lastStaffReplyAt: daysAgo(1) }), NOW)
    ).toMatch(/^SnagHQ replied .* · shared until /);
  });

  it('says a lapsed question can no longer see the job', () => {
    expect(
      describeSupportStatus(request({ status: 'replied', lastStaffReplyAt: daysAgo(20) }), NOW)
    ).toBe('Closed — SnagHQ can no longer see this job');
  });

  it('says who closed it when SnagHQ did', () => {
    expect(
      describeSupportStatus(request({ status: 'closed', closedAt: daysAgo(0), closedBy: 'staff' }), NOW)
    ).toBe('Closed by SnagHQ');
  });
});

describe('describeWait', () => {
  it('rounds down, and says one of each in the singular', () => {
    expect(describeWait(new Date(NOW.getTime() - 20_000).toISOString(), NOW)).toBe('just now');
    expect(describeWait(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('5 min');
    expect(describeWait(new Date(NOW.getTime() - 61 * 60_000).toISOString(), NOW)).toBe('1 hour');
    expect(describeWait(daysAgo(1.9), NOW)).toBe('1 day');
    expect(describeWait(daysAgo(3), NOW)).toBe('3 days');
  });
});

describe('an assessment from SnagHQ', () => {
  const draft = (over: Partial<AdviceDraft> = {}): AdviceDraft => ({
    ...adviceDraftFrom(null),
    diagnosis: 'Worn washer',
    verdict: 'diy',
    ...over,
  });

  it('is ready with a diagnosis and a verdict and nothing else', () => {
    expect(adviceDraftProblems(draft())).toEqual([]);
  });

  it('asks for what is wrong and who can do it', () => {
    expect(adviceDraftProblems(draft({ diagnosis: '  ', verdict: null }))).toEqual([
      'Say what you think is wrong',
      'Say whether they can do it themselves',
    ]);
  });

  it('refuses a tradesman with no source, naming them', () => {
    const problems = adviceDraftProblems(
      draft({
        tradies: [
          { name: 'Drip Co', phone: '021 000 000', url: null, source: ' ', calloutNzd: null, totalNzd: null },
        ],
      })
    );
    expect(problems).toEqual(['Say where you found Drip Co']);
  });

  it('drops a row the form added and nobody filled in, rather than refusing it', () => {
    const d = draft({
      parts: [{ item: '', where: '', approxNzd: '' }],
      tradies: [{ name: '', phone: '', url: '', source: '', calloutNzd: '', totalNzd: '' }],
      steps: ['Turn off the water', '  '],
    });
    expect(adviceDraftProblems(d)).toEqual([]);
    const clean = cleanAdviceDraft(d);
    expect(clean.parts).toEqual([]);
    expect(clean.tradies).toEqual([]);
    expect(clean.steps).toEqual(['Turn off the water']);
  });

  it('keeps a half-filled part so it can say what it is missing', () => {
    expect(adviceDraftProblems(draft({ parts: [{ item: '', where: 'Mitre 10', approxNzd: null }] }))).toEqual([
      'Every part needs to say what it is',
    ]);
  });

  it('writes empty boxes as null, in the shape snag_advice stores', () => {
    const clean = cleanAdviceDraft(
      draft({ reason: ' ', trade: ' plumber ', parts: [{ item: ' Washer ', where: '', approxNzd: '5' }] })
    );
    expect(clean.reason).toBeNull();
    expect(clean.trade).toBe('plumber');
    expect(clean.parts).toEqual([{ item: 'Washer', where: null, approxNzd: '5' }]);
  });

  it('opens on the assessment already on the job', () => {
    const d = adviceDraftFrom({
      snagId: 's1', diagnosis: 'Old answer', verdict: 'trade', reason: null, steps: [],
      parts: [], trade: 'plumber', tradies: [], needToSee: null, source: 'Pasted 1 Oct',
      createdAt: daysAgo(10),
    });
    expect(d.diagnosis).toBe('Old answer');
    expect(d.trade).toBe('plumber');
    expect(d.reason).toBe('');
  });
});

describe('supportReplyEmail', () => {
  const email = supportReplyEmail({
    headline: 'Tap drips',
    snagId: 's1',
    askedByName: 'Alice Smith',
    appUrl: 'https://app.snaghq.co.nz/',
  });

  it('links to the job, which is where the answer is', () => {
    expect(email.text).toContain('https://app.snaghq.co.nz/snags/s1');
    expect(email.subject).toBe('SnagHQ has replied about "Tap drips"');
  });

  it('greets by first name', () => {
    expect(email.text.startsWith('Hi Alice,')).toBe(true);
  });

  it('carries nothing of the answer itself', () => {
    expect(email.text).not.toMatch(/washer|\$|diagnos/i);
  });
});

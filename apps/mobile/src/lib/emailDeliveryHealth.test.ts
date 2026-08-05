import {
  hasDeliveryProblem,
  undeliveredInviteCount,
  type EmailDeliveryHealth,
} from '@snag/supabase-queries';

// Whether the portal says "notification email needs checking".
//
// The reason this is two signals rather than one is the whole point, and it is
// worth pinning: SNAG's email has failed twice, in two shapes that are blind to
// each other.
//
//   * July 2026 — every send was refused by Resend (sandbox sender, 403). A
//     failure count catches that.
//   * Invites — no send was ever *attempted*, for the life of the feature. A
//     failure count reads zero throughout, because nothing failed. Nothing
//     happened.
//
// A check that only counted failures would have shown a clean sheet through
// the second, which is exactly how it survived to production. So these specs
// exist to stop anyone simplifying this back down to one number.

function health(over: Partial<EmailDeliveryHealth> = {}): EmailDeliveryHealth {
  return {
    window_hours: 24,
    sends_attempted: 0,
    sends_failed: 0,
    invites_created: 0,
    invite_emails_attempted: 0,
    ...over,
  };
}

describe('undeliveredInviteCount', () => {
  it('counts invites created that no send was attempted for', () => {
    expect(undeliveredInviteCount(health({ invites_created: 5, invite_emails_attempted: 0 }))).toBe(5);
  });

  it('is zero when every invite got a send', () => {
    expect(undeliveredInviteCount(health({ invites_created: 3, invite_emails_attempted: 3 }))).toBe(0);
  });

  it('never goes negative when sends outnumber invites', () => {
    // Resends are real sends against invites created in an earlier window, so
    // this is the normal state of an org whose admin pressed Resend — not an
    // anomaly, and certainly not a negative shortfall to render.
    expect(undeliveredInviteCount(health({ invites_created: 1, invite_emails_attempted: 4 }))).toBe(0);
  });
});

describe('hasDeliveryProblem', () => {
  it('is quiet when nothing has happened', () => {
    expect(hasDeliveryProblem(health())).toBe(false);
  });

  it('is quiet when every send succeeded', () => {
    expect(
      hasDeliveryProblem(
        health({ sends_attempted: 12, invites_created: 2, invite_emails_attempted: 2 })
      )
    ).toBe(false);
  });

  it('fires on a refused send — the July 2026 shape', () => {
    expect(hasDeliveryProblem(health({ sends_attempted: 12, sends_failed: 12 }))).toBe(true);
  });

  it('fires on one refused send among many, not just a total outage', () => {
    // A single bad address is how a whole site quietly stops hearing about
    // incidents, so partial failure has to be as loud as total failure.
    expect(hasDeliveryProblem(health({ sends_attempted: 40, sends_failed: 1 }))).toBe(true);
  });

  it('fires on an invite that was never even attempted — the shape a failure count misses', () => {
    // Note sends_failed is 0 here, and deliberately so: this is the exact
    // state the invite bug produced for months.
    expect(
      hasDeliveryProblem(health({ invites_created: 5, invite_emails_attempted: 0, sends_failed: 0 }))
    ).toBe(true);
  });
});

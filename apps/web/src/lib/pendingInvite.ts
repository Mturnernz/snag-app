// Shared between join/[token]/actions.ts and login/actions.ts. Kept out of
// either "use server" file since those may only export async functions — same
// reason pendingOrg.ts exists.
//
// The case this carries: someone accepts an invite by creating their account
// from /join/<token>. If email confirmation is on, `auth.signUp` returns no
// session, so there is no authenticated moment in which to call `accept_invite`
// — and `accept_invite` checks `auth.email()`, so it cannot be called any other
// way. The token is stashed here and consumed at the first login instead.
export const PENDING_INVITE_COOKIE = 'snag_pending_invite';

export interface PendingInvite {
  token: string;
  name: string;
}

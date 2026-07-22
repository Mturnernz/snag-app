// Shared between sign-up/actions.ts and login/actions.ts. Kept out of either
// "use server" file since those may only export async functions.
export const PENDING_ORG_COOKIE = 'snag_pending_org';

export interface PendingOrg {
  orgName: string;
  ownerName: string;
}

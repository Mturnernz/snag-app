// Where this app lives on the web.
//
// `apps/mobile` ships as an Expo web export as well as to phones, on its own
// Netlify site — separate from `apps/web`, which is the marketing site and the
// supervisor portal. Two deployments, two hosts, and they are not
// interchangeable: `/go/snag/[id]` sends people here precisely *because* the
// portal has refused them, so pointing this at www.snaghq.co.nz would loop them
// straight back.
//
// Used for two things, and the second is why the value matters more than it
// looks:
//
//   1. Deep-link prefixes (navigation/linking.ts).
//   2. The URL encoded into site QR codes (SiteDetailScreen,
//      manage/OrganisationTab) — which get **printed and put up on walls**.
//
// So changing this only affects codes generated from here on. Anything already
// printed still carries the old host, which is why linking.ts keeps
// snagv1.netlify.app in its prefix list rather than replacing it, and why the
// old Netlify subdomain has to stay pointed at this site.
export const APP_URL = 'https://app.snaghq.co.nz';

// The other host — `apps/web`. Used for the one thing this app deliberately
// hands off to a web page: setting a new password.
//
// Note this does not contradict the warning above. That is about `/go`, which
// sends people *here* because the portal already refused them. A reset link is
// the opposite case: it has to open in whatever browser the mail client hands
// it to, so it needs a plain web page, and `/reset-password` sits outside the
// portal's auth gate precisely so a worker can finish a reset there.
export const PORTAL_URL = 'https://www.snaghq.co.nz';

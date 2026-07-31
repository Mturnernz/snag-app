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
//   2. The URL encoded into site QR codes (ManageSitesScreen,
//      ManageOrganisationScreen) — which get **printed and put up on walls**.
//
// So changing this only affects codes generated from here on. Anything already
// printed still carries the old host, which is why linking.ts keeps
// snagv1.netlify.app in its prefix list rather than replacing it, and why the
// old Netlify subdomain has to stay pointed at this site.
export const APP_URL = 'https://app.snaghq.co.nz';

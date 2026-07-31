import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from '../types';
import { APP_URL } from '../lib/appUrl';

// Deep links.
//
// The app had none: NavigationContainer took no `linking` prop, so every URL
// resolved to the default screen and the path was discarded. That was quietly
// load-bearing — supabase/functions/notify-snag has always mailed people
// `${SNAG_APP_URL}/snags/<id>` links, and the RCA mails pointed at
// `/snags/<id>/rca`, a path no client has ever had a route for. The links
// returned 200 (the web build is `output: "single"`, so every path serves the
// app shell) and then dropped you on the Report tab.
//
// The path shape here deliberately matches apps/web's portal — `/snags/:id`
// with `?step=` — so one link works whichever client SNAG_APP_URL points at,
// and a supervisor and a worker following the same mail each land somewhere
// that makes sense for them.
const PREFIXES = [
  // Native. Requires `scheme` in app.json, which is where `snag://` comes from.
  'snag://',
  // The web build's current home. See lib/appUrl.
  APP_URL,
  // Its previous one, kept deliberately rather than replaced. Site QR codes
  // encoding this host have been printed and put up on walls, and every
  // notification sent before the move carries it too. Netlify redirects the old
  // subdomain to the new domain, so those still arrive — but a redirect only
  // gets them to the app, and it is this list that decides whether the path
  // then resolves to the right screen instead of the default tab.
  'https://snagv1.netlify.app',
  'http://localhost:8081',
];

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: PREFIXES,
  config: {
    screens: {
      Main: {
        screens: {
          // Deliberately no path for `/` itself. An unmatched URL leaves the
          // navigator on its own initialRouteName, which is what carries
          // `initialTab` — the tab a worker lands on after onboarding. Mapping
          // the index here would override that.
          Report: 'report',
          Issues: 'snags',
          Profile: 'profile',
          Admin: 'admin',
        },
      },
      // `step` isn't in the path, so React Navigation passes it through as a
      // route param from the query string: /snags/<id>?step=rca.
      IssueDetail: 'snags/:issueId',
      Mentions: 'mentions',
      Reports: 'reports',
    },
  },
};

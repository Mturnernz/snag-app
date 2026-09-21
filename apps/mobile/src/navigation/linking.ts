import { LinkingOptions } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { APP_URL } from '../lib/appUrl';

/**
 * `/snags/:id` is the deep link that matters — it's what someone sends the
 * other person when they want them to look at something. `/projects/:id` is
 * the other one that resolves, for the reason given beside it.
 *
 * `snagv1.netlify.app` stays in the prefix list and is not merely tidiness:
 * QR codes encoding it were printed and put on walls, and every notification
 * sent before the move carries it. The Netlify redirect gets someone to the
 * app; this list is what decides whether the path then resolves to the right
 * screen rather than the default tab.
 *
 * `/` is deliberately unmapped. An unmatched URL leaves the tab navigator on
 * its `initialRouteName`, which is the list — the screen the app opens on now
 * that capture is a bar at the foot of it rather than a tab.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    'snag://',
    APP_URL,
    'https://snagv1.netlify.app',
  ],
  config: {
    screens: {
      Main: {
        screens: {
          Snags: 'snags',
          Profile: 'you',
        },
      },
      SnagDetail: 'snags/:snagId',
      // On the root stack rather than under `Main`, deliberately, and it is the
      // one path that has to resolve while its *tab* may not exist. Somebody
      // who has put Projects away still has `ProjectDetail` registered — the
      // setting is about what the app offers, not what it refuses when asked
      // directly — so a link sent before they turned it off opens the page
      // instead of falling through to the list with nothing said. Mapping
      // `Projects` itself would be the opposite: a tab that is not registered
      // reachable by typing a URL.
      ProjectDetail: 'projects/:projectId',
      Household: 'household',
    },
  },
};

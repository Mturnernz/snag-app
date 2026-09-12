import { LinkingOptions } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { APP_URL } from '../lib/appUrl';

/**
 * `/snags/:id` is the only deep link that matters — it's what someone sends
 * the other person when they want them to look at something.
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
          Weekend: 'weekend',
          Profile: 'you',
        },
      },
      SnagDetail: 'snags/:snagId',
      Household: 'household',
    },
  },
};

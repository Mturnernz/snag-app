import { registerRootComponent } from 'expo';

import Boot from './src/Boot';

// Boot, not App: the colour scheme has to be known before the first stylesheet
// is built, so Boot settles it and then requires App. See src/Boot.tsx.
//
// registerRootComponent calls AppRegistry.registerComponent('main', () => Boot),
// and sets up the environment correctly for either Expo Go or a native build.
registerRootComponent(Boot);

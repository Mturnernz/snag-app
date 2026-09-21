import { linking } from './linking';

/**
 * Which paths resolve, and which deliberately do not.
 *
 * Nothing else catches this. A path missing from the config is not an error —
 * React Navigation simply does not match it, the tab navigator stays on its
 * `initialRouteName`, and the person who followed the link lands on the list
 * with nothing said. That is exactly what `/projects/<id>` did: `ProjectDetail`
 * has been registered on the root stack since projects shipped, and
 * `CLAUDE.md` says in as many words that such a link "should open the page
 * rather than fall through to the list with no explanation" — but the path was
 * never in this file, so it always fell through.
 */

const screens = linking.config!.screens as Record<string, any>;

describe('the paths that resolve', () => {
  it('opens a snag somebody sent', () => {
    expect(screens.SnagDetail).toBe('snags/:snagId');
  });

  it('opens a project somebody sent', () => {
    expect(screens.ProjectDetail).toBe('projects/:projectId');
  });

  it('leaves / unmapped, so an unmatched URL falls through to the list', () => {
    // The fall-through is what carries `initialRouteName`. Mapping `/` would
    // take that away from every URL that is not one of the above.
    const paths = Object.values(screens).filter((v) => typeof v === 'string');
    expect(paths).not.toContain('');
    expect(paths).not.toContain('/');
  });
});

describe('the paths that deliberately do not', () => {
  it('does not map the Projects tab itself', () => {
    // A route that exists but cannot be reached is one deep link away from a
    // screen somebody has said they do not want: with Projects off the tab is
    // not registered at all, so a `/projects` path would be a way to type your
    // way back into it. `ProjectDetail` is the exception on purpose — the
    // setting is about what the app offers, not what it refuses when asked for
    // a specific page by id.
    expect(screens.Main.screens.Projects).toBeUndefined();
    expect(Object.values(screens.Main.screens)).not.toContain('projects');
  });

  it('does not route the join code, which is a gate rather than a screen', () => {
    // `JoinScreen` is a branch in App.tsx, because the normal case is somebody
    // with no household and therefore no navigator to route them through. A
    // matched path would send React Navigation somewhere while the gate is
    // still asking the question.
    expect(screens.Join).toBeUndefined();
    const paths = Object.values(screens).filter((v): v is string => typeof v === 'string');
    expect(paths.some((p) => p.startsWith('join'))).toBe(false);
  });
});

describe('the prefixes', () => {
  it('still answers the printed QR codes', () => {
    // These were printed and put on walls. The Netlify redirect gets somebody
    // to the app; this list is what decides whether the path then resolves to
    // the right screen rather than the default tab.
    expect(linking.prefixes).toContain('https://snagv1.netlify.app');
    expect(linking.prefixes).toContain('snag://');
  });
});

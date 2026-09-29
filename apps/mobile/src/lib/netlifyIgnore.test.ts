import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * scripts/netlify-ignore.sh decides whether a production build runs, and a
 * production deploy is 15 Netlify credits. It fails in two directions and
 * both are silent: skip too little and every merge rebuilds three sites, which
 * is what was happening; skip too much and a change reaches `production` and
 * never goes live, with nothing anywhere saying so.
 *
 * So this replays the script against a scratch repository laid out like this
 * one, rather than asserting its text, and pins the wiring in each site's
 * netlify.toml — a path that stopped resolving would build every time and
 * never be noticed.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'netlify-ignore.sh');
const SITES = ['apps/mobile', 'apps/web', 'apps/staff'] as const;
type Site = (typeof SITES)[number];

describe('each site’s netlify.toml', () => {
  it.each(SITES)('%s runs the shared script, from its own base directory', (site) => {
    const toml = fs.readFileSync(path.join(REPO_ROOT, site, 'netlify.toml'), 'utf8');
    const match = toml.match(/^\s*ignore\s*=\s*"bash ([^ "]+) ([^"]+)"/m);
    expect(match).not.toBeNull();
    const [, scriptPath, arg] = match!;
    // Netlify runs `ignore` from the base directory, so the path is relative to it.
    expect(path.resolve(REPO_ROOT, site, scriptPath)).toBe(SCRIPT);
    expect(arg).toBe(site);
  });
});

/** This process's environment without anything that would point git or the script elsewhere. */
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CONTEXT', 'CACHED_COMMIT_REF', 'COMMIT_REF']) {
    delete env[key];
  }
  return env;
};

describe('scripts/netlify-ignore.sh', () => {
  let repo: string;

  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: cleanEnv() });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };

  const write = (file: string, contents: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), contents);
  };

  /** Commits a change to `files` and returns the new commit. */
  const commit = (...files: string[]) => {
    files.forEach((file) => write(file, `${file} at ${Math.random()}\n`));
    git('add', '-A');
    git('commit', '-q', '-m', `change ${files.join(', ')}`);
    return git('rev-parse', 'HEAD');
  };

  /** True when Netlify would build: any exit but 0. */
  const builds = (site: string, env: Record<string, string>) => {
    const result = spawnSync('bash', [SCRIPT, site], {
      cwd: path.join(repo, site),
      encoding: 'utf8',
      env: { ...cleanEnv(), ...env },
    });
    return result.status !== 0;
  };

  const production = (from: string, to: string) => ({
    CONTEXT: 'production',
    CACHED_COMMIT_REF: from,
    COMMIT_REF: to,
  });

  const whichBuild = (from: string, to: string): Site[] =>
    SITES.filter((site) => builds(site, production(from, to)));

  let base: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'netlify-ignore-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    base = commit(
      'apps/mobile/App.tsx',
      'apps/web/page.tsx',
      'apps/staff/page.tsx',
      'packages/supabase-queries/src/index.ts',
      'package.json',
      'package-lock.json',
      'CLAUDE.md',
      'supabase/migrations/1.sql',
    );
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('skips every site when only docs and migrations changed', () => {
    const next = commit('CLAUDE.md', 'supabase/migrations/2.sql');
    expect(whichBuild(base, next)).toEqual([]);
  });

  it('builds only the site whose own directory changed', () => {
    expect(whichBuild(base, commit('apps/mobile/App.tsx'))).toEqual(['apps/mobile']);
  });

  it('counts packages/ for the app and the portal, but not for www', () => {
    const next = commit('packages/supabase-queries/src/index.ts');
    expect(whichBuild(base, next)).toEqual(['apps/mobile', 'apps/staff']);
  });

  it('builds every site when the shared lockfile changed', () => {
    expect(whichBuild(base, commit('package-lock.json'))).toEqual([...SITES]);
  });

  it('compares across several merges, not just the last one', () => {
    const middle = commit('apps/web/page.tsx');
    const next = commit('CLAUDE.md');
    expect(whichBuild(middle, next)).toEqual([]);
    expect(whichBuild(base, next)).toEqual(['apps/web']);
  });

  it('always builds a Deploy Preview or a branch deploy, which cost no credits', () => {
    const next = commit('CLAUDE.md');
    for (const context of ['deploy-preview', 'branch-deploy', '']) {
      expect(builds('apps/web', { ...production(base, next), CONTEXT: context })).toBe(true);
    }
  });

  it('builds a redeploy of the same commit, which is how an env var change goes out', () => {
    expect(builds('apps/web', production(base, base))).toBe(true);
  });

  it('builds when there is nothing to compare with', () => {
    const next = commit('CLAUDE.md');
    expect(builds('apps/web', production('', next))).toBe(true);
    expect(builds('apps/web', production(base, ''))).toBe(true);
    expect(builds('apps/web', production('0'.repeat(40), next))).toBe(true);
  });

  it('builds a site it does not know', () => {
    const next = commit('CLAUDE.md');
    fs.mkdirSync(path.join(repo, 'apps/other'), { recursive: true });
    expect(builds('apps/other', production(base, next))).toBe(true);
  });
});

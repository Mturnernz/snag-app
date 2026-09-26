#!/usr/bin/env bash
# Netlify's `ignore` step for the three sites in this repo. Each site's
# netlify.toml calls it with its own base directory:
#
#   ignore = "bash ../../scripts/netlify-ignore.sh apps/mobile"
#
# Exit 0 cancels the build, exit 1 lets it run. Netlify's default check only
# diffs the base directory, which misses packages/ — and on these sites it was
# not skipping anything: every merge to main built all three, at 15 credits a
# production deploy, when nearly every merge only touched the app.
#
# Two rules, and each is chosen so a wrong guess costs credits rather than a
# deploy that silently never happened:
#
#   * Only production builds are ever skipped. Deploy Previews and branch
#     deploys cost no credits, and a preview that is missing because this
#     script guessed wrong is a preview nobody can check.
#   * Anything uncertain builds: no previous commit (first build, "Clear cache
#     and deploy"), the same commit again (a deliberate redeploy, which is how
#     a changed environment variable reaches the bundle), a commit the clone
#     does not have, or git failing at all.
#
# .github/workflows/deploy.yml runs this same script to say which sites a
# promotion will rebuild, so the table it prints and what Netlify decides
# cannot disagree about which paths belong to which site.

set -u

site="${1:-}"

# What each site's build reads. apps/web imports nothing from packages/ (its
# transpilePackages entry is a leftover), so a change there is not its change.
# package-lock.json is shared by every workspace, so it counts for all three.
case "$site" in
  apps/mobile) paths=(apps/mobile packages package.json package-lock.json) ;;
  apps/staff) paths=(apps/staff packages package.json package-lock.json) ;;
  apps/web) paths=(apps/web package.json package-lock.json) ;;
  *)
    echo "netlify-ignore: unknown site '${site}' — building"
    exit 1
    ;;
esac

build() {
  echo "netlify-ignore: ${site}: $1 — building"
  exit 1
}

context="${CONTEXT:-}"
cached="${CACHED_COMMIT_REF:-}"
current="${COMMIT_REF:-}"

if [ "$context" != "production" ]; then
  build "${context:-unknown} context (only production deploys cost credits)"
fi
if [ -z "$cached" ] || [ -z "$current" ]; then
  build "no previous build to compare with"
fi
if [ "$cached" = "$current" ]; then
  build "same commit as the last build, so this is a deliberate redeploy"
fi

root="$(git rev-parse --show-toplevel 2>/dev/null)" || build "not in a git checkout"
cd "$root" || build "cannot reach the repo root"

if ! git cat-file -e "${cached}^{commit}" 2>/dev/null; then
  build "the last built commit ${cached:0:7} is not in this clone"
fi

git diff --quiet "$cached" "$current" -- "${paths[@]}"
status=$?
if [ "$status" -eq 0 ]; then
  echo "netlify-ignore: ${site}: nothing it builds from changed between ${cached:0:7} and ${current:0:7} — skipping"
  exit 0
fi
if [ "$status" -eq 1 ]; then
  build "$(git diff --name-only "$cached" "$current" -- "${paths[@]}" | wc -l | tr -d ' ') of its files changed"
fi
build "git diff failed (${status})"

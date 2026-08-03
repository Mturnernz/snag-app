#!/usr/bin/env bash
# Catch the errors that stop a Supabase edge function from booting.
#
# supabase/functions/* is Deno, so it sits outside both app tsconfigs and
# `npm run typecheck` has never looked at it. Nothing else does either: the
# deploy bundles the file without evaluating it, so a module that throws on
# load deploys clean and then 503s with BOOT_ERROR on every request. That is
# how export-governance-report shipped a `const body` / `function body`
# collision in one scope — a SyntaxError — and stayed broken, behind an
# admin-only button where a dead export just looks like a failed export.
#
# We cannot typecheck these properly: `jsr:` and `npm:` specifiers do not
# resolve under tsc, and without them `Deno`, the supabase client and pdf-lib
# are all unknown names. So this runs tsc with --noResolve and greps for the
# error classes that survive that and genuinely prevent the module evaluating:
#
#   TS1xxx  parse/syntax errors
#   TS2300  duplicate identifier
#   TS2451  cannot redeclare block-scoped variable
#
# Everything else — TS2304 "cannot find name 'Deno'", TS2307 "cannot find
# module", the implicit-anys that follow from untyped imports — is an artefact
# of not resolving, and is ignored on purpose. A denylist rather than an
# allowlist so that this stays quiet: a check that cries wolf gets deleted.
set -uo pipefail

cd "$(dirname "$0")/.."

out=$(npx --yes tsc \
  --noEmit --skipLibCheck --noResolve \
  --target es2022 --module esnext \
  supabase/functions/*/index.ts 2>&1)

fatal=$(printf '%s\n' "$out" | grep -E "error TS(1[0-9]{3}|2300|2451):" || true)

if [ -n "$fatal" ]; then
  echo "Edge function(s) will not boot:"
  echo
  printf '%s\n' "$fatal"
  echo
  echo "These prevent the module from evaluating, so the function deploys"
  echo "successfully and then returns 503 BOOT_ERROR on every request."
  exit 1
fi

echo "Edge functions OK — no syntax or redeclaration errors."

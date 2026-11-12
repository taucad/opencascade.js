#!/usr/bin/env bash
# Build the docs site's static export (docs-site/out) from an exact package
# candidate tarball, for scripts/deploy-docs-site.sh. Rewrites the checkout's
# docs-site/package.json in place, so run it on a disposable CI checkout.
#
# Usage: scripts/build-docs-site.sh <candidate.tgz>

set -euo pipefail

TARBALL="$(cd "$(dirname "${1:?usage: build-docs-site.sh <candidate.tgz>}")" && pwd)/$(basename "$1")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node - "$ROOT/docs-site/package.json" "$TARBALL" <<'NODE'
const fs = require('node:fs');
const [manifestPath, tarball] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.dependencies.libcascade = `file:${tarball}`;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cd "$ROOT/docs-site"
corepack enable
corepack pnpm@9.15.9 install --ignore-workspace --no-frozen-lockfile --ignore-scripts
OCJS_API_REFERENCE_SOURCE="$TARBALL" corepack pnpm@9.15.9 build

#!/usr/bin/env bash

set -euo pipefail

TARBALL="${OCJS_PACKAGE_TARBALL:?OCJS_PACKAGE_TARBALL is required}"
export OCJS_API_REFERENCE_SOURCE="$TARBALL"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/docs-site"
tar \
  --exclude='./.DS_Store' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.vercel' \
  --exclude='./.source' \
  --exclude='./next-env.d.ts' \
  --exclude='./tsconfig.tsbuildinfo' \
  --exclude='./data/api-search-index.json' \
  --exclude='./data/api-tree.json' \
  --exclude='./data/api-type-index.json' \
  --exclude='./public/opencascade_full.d.ts' \
  --exclude='./public/opencascade_full.js' \
  --exclude='./public/opencascade_full.wasm' \
  -C "$ROOT/docs-site" -cf - . | tar -C "$WORK/docs-site" -xf -
cp "$ROOT/Dockerfile" "$ROOT/project.json" "$WORK/"
mkdir -p "$WORK/scripts/lib"
cp "$ROOT/scripts/lib/source-date-epoch.mjs" "$WORK/scripts/lib/"

node - "$WORK/docs-site/package.json" "$TARBALL" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [manifestPath, tarball] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.dependencies['ocjs'] = `file:${path.resolve(tarball)}`;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cd "$WORK/docs-site"
corepack pnpm@9.15.9 install --ignore-workspace --no-frozen-lockfile --ignore-scripts
corepack pnpm@9.15.9 typecheck
corepack pnpm@9.15.9 lint
corepack pnpm@9.15.9 test:unit
corepack pnpm@9.15.9 build
corepack pnpm@9.15.9 test:postbuild

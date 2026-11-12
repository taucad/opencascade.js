#!/usr/bin/env bash
# Upload docs-site/out to Cloudflare Pages and record the deployment in the
# job summary. `production` deploys branch main (the custom domains); any
# other mode deploys $BRANCH as a preview.
#
# Usage: scripts/deploy-docs-site.sh production|preview
# Env:   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PROJECT, BRANCH,
#        FULL_SHA, TARBALL (the candidate the site was built from)

set -euo pipefail

MODE="${1:?usage: deploy-docs-site.sh production|preview}"
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${PROJECT:?}" "${BRANCH:?}" "${FULL_SHA:?}" "${TARBALL:?}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

npx --yes wrangler@4.155.0 pages deploy "$ROOT/docs-site/out" \
  --project-name="$PROJECT" --branch="$BRANCH" \
  --commit-hash="$FULL_SHA" --commit-dirty=true | tee "$LOG"
url="$(grep -Eo 'https://[^ ]+\.pages\.dev' "$LOG" | tail -1)"
feed_hash="$(
  tar -xOf "$TARBALL" package/dist/api-reference.json |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).inputs.bindings.sha256))"
)"
{
  echo "## Cloudflare Pages ${MODE}"
  echo
  echo "- URL: ${url}"
  echo "- Source: \`${FULL_SHA}\`"
  echo "- API bindings: \`${feed_hash}\`"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

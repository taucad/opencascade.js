#!/usr/bin/env bash
# docker-e2e-validate.sh — production-readiness gate for the opencascade.js
# Docker image (PR donalffons/opencascade.js#301).
#
# Implements Validation Blueprint Phases 0-7 from
# Docker E2E validation (image build, consumer link, wasm size, JS smoke):
#
#   Phase 0  Build the image (cold; cache mounts amortise rebuilds).
#   Phase 1  Provision named volumes for Nx + build caches.
#   Phase 2  Resolve the replicad YAML from a sibling worktree.
#   Phase 3  Cold full link against the replicad YAML.
#   Phase 4  Output presence assertions
#            (replicad_single.{wasm,js,d.ts,js.symbols,provenance.json,build-manifest.json}).
#   Phase 5  Byte-size delta vs a locally-built baseline (default ±2%).
#   Phase 6  NCollection filter ratio assertion (>= 80% drop) from provenance.
#   Phase 7  Warm-cache rerun + JS smoke test.
#
# Usage:
#   ./scripts/docker-e2e-validate.sh \
#     [--replicad-yaml <path>] \
#     [--baseline-wasm <path>] \
#     [--tolerance-pct N] \
#     [--output-dir <path>] \
#     [--image-tag <name>] \
#     [--skip-build]
#
# Environment variables (override defaults):
#   REPLICAD_YAML          Default: ../replicad/packages/replicad-opencascadejs/build-config/custom_build_single.yml
#   REPLICAD_BASELINE_WASM Default: ../replicad/packages/replicad-opencascadejs/src/replicad_single.wasm
#   TOLERANCE_PCT          Default: 2  (byte delta tolerance for Phase 5)
#   WARM_BUDGET_S          Default: 300  (Phase 7 warm rerun budget, seconds)
#   FILTER_RATIO_MAX       Default: 0.20 (Phase 6 — linked/total must be ≤ this)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_TAG="ocjs:e2e"
OUTPUT_DIR="$REPO_ROOT/docker-e2e-output"
REPLICAD_YAML_DEFAULT="$REPO_ROOT/../replicad/packages/replicad-opencascadejs/build-config/custom_build_single.yml"
REPLICAD_BASELINE_DEFAULT="$REPO_ROOT/../replicad/packages/replicad-opencascadejs/src/replicad_single.wasm"
REPLICAD_YAML="${REPLICAD_YAML:-$REPLICAD_YAML_DEFAULT}"
REPLICAD_BASELINE_WASM="${REPLICAD_BASELINE_WASM:-$REPLICAD_BASELINE_DEFAULT}"
TOLERANCE_PCT="${TOLERANCE_PCT:-2}"
WARM_BUDGET_S="${WARM_BUDGET_S:-300}"
FILTER_RATIO_MAX="${FILTER_RATIO_MAX:-0.20}"
SKIP_BUILD=0
PLATFORM_FLAGS=()

# Apple Silicon defaults: amd64 emulation for emscripten/emsdk parity.
if [ "$(uname -m)" = "arm64" ] && [ "$(uname -s)" = "Darwin" ]; then
  PLATFORM_FLAGS+=("--platform" "linux/amd64")
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --replicad-yaml)    REPLICAD_YAML="$2"; shift 2 ;;
    --baseline-wasm)    REPLICAD_BASELINE_WASM="$2"; shift 2 ;;
    --tolerance-pct)    TOLERANCE_PCT="$2"; shift 2 ;;
    --output-dir)       OUTPUT_DIR="$2"; shift 2 ;;
    --image-tag)        IMAGE_TAG="$2"; shift 2 ;;
    --skip-build)       SKIP_BUILD=1; shift ;;
    --warm-budget)      WARM_BUDGET_S="$2"; shift 2 ;;
    --filter-ratio-max) FILTER_RATIO_MAX="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

NX_VOLUME="ocjs-nx-cache-e2e"
BUILD_VOLUME="ocjs-build-cache-e2e"

mkdir -p "$OUTPUT_DIR"

_stat_size() {
  local f="$1"
  stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null
}

_section() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════════════"
}

_fail() {
  echo "FAIL: $1" >&2
  exit 1
}

_ok() {
  echo "  PASS: $1"
}

# ── Phase 0: Image build ────────────────────────────────────────────────────
_section "Phase 0/7  Building image ($IMAGE_TAG)"
if [ "$SKIP_BUILD" -eq 1 ]; then
  echo "  --skip-build set; reusing existing image."
  docker image inspect "$IMAGE_TAG" >/dev/null 2>&1 || _fail "Image $IMAGE_TAG not present and --skip-build set."
else
  DOCKER_BUILDKIT=1 docker build \
    "${PLATFORM_FLAGS[@]}" \
    --progress=plain \
    -t "$IMAGE_TAG" \
    "$REPO_ROOT"
  _ok "Image built"
fi

# ── Phase 1: Volume provisioning ────────────────────────────────────────────
_section "Phase 1/7  Provisioning named cache volumes"
docker volume create "$NX_VOLUME"    >/dev/null
docker volume create "$BUILD_VOLUME" >/dev/null
_ok "Volumes ready: $NX_VOLUME, $BUILD_VOLUME"

# ── Phase 2: Resolve replicad YAML ──────────────────────────────────────────
_section "Phase 2/7  Resolving replicad YAML"
if [ ! -f "$REPLICAD_YAML" ]; then
  _fail "REPLICAD_YAML not found at $REPLICAD_YAML
Override with --replicad-yaml <path> or REPLICAD_YAML=<path>."
fi
REPLICAD_YAML_ABS="$(cd "$(dirname "$REPLICAD_YAML")" && pwd)/$(basename "$REPLICAD_YAML")"
_ok "Using $REPLICAD_YAML_ABS"

# ── Phase 3: Cold end-to-end link ───────────────────────────────────────────
_section "Phase 3/7  Cold end-to-end link against replicad YAML"
COLD_START=$(date +%s)
docker run --rm \
  "${PLATFORM_FLAGS[@]}" \
  --memory 8g --cpus 8 \
  -v "$NX_VOLUME:/opencascade.js/.nx" \
  -v "$BUILD_VOLUME:/opencascade.js/build" \
  -v "$REPLICAD_YAML_ABS:/src/replicad.yml:ro" \
  -v "$OUTPUT_DIR:/output" \
  "$IMAGE_TAG" link replicad.yml
COLD_END=$(date +%s)
COLD_ELAPSED=$((COLD_END - COLD_START))
_ok "Cold build wall time: ${COLD_ELAPSED}s"

# ── Phase 4: Output presence ────────────────────────────────────────────────
_section "Phase 4/7  Asserting output artefacts"
EXPECTED_ARTIFACTS=(
  "replicad_single.wasm"
  "replicad_single.js"
  "replicad_single.d.ts"
  "replicad_single.js.symbols"
  "replicad_single.provenance.json"
  "replicad_single.build-manifest.json"
)
for f in "${EXPECTED_ARTIFACTS[@]}"; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    _fail "Missing artefact: $OUTPUT_DIR/$f"
  fi
  _ok "$f ($(_stat_size "$OUTPUT_DIR/$f") bytes)"
done

CANDIDATE_WASM="$OUTPUT_DIR/replicad_single.wasm"
CANDIDATE_JS="$OUTPUT_DIR/replicad_single.js"
PROV_FILE="$OUTPUT_DIR/replicad_single.provenance.json"

# ── Phase 5: Byte-size delta vs baseline ────────────────────────────────────
_section "Phase 5/7  Byte-size delta vs baseline"
if [ ! -f "$REPLICAD_BASELINE_WASM" ]; then
  echo "  WARNING: Baseline WASM not found at $REPLICAD_BASELINE_WASM (skipping delta check)."
  echo "  Override with --baseline-wasm <path> or REPLICAD_BASELINE_WASM=<path>."
else
  CANDIDATE_SIZE=$(_stat_size "$CANDIDATE_WASM")
  BASELINE_SIZE=$(_stat_size "$REPLICAD_BASELINE_WASM")
  DELTA_PCT=$(python3 -c "
candidate, baseline, tol = $CANDIDATE_SIZE, $BASELINE_SIZE, $TOLERANCE_PCT
delta = (candidate - baseline) / baseline * 100
print(f'{delta:+.2f}')
")
  echo "  Candidate: $CANDIDATE_SIZE bytes"
  echo "  Baseline:  $BASELINE_SIZE bytes"
  echo "  Delta:     ${DELTA_PCT}%"
  python3 -c "
import sys
candidate, baseline, tol = $CANDIDATE_SIZE, $BASELINE_SIZE, $TOLERANCE_PCT
delta = abs((candidate - baseline) / baseline * 100)
sys.exit(0 if delta <= tol else 1)
" || _fail "Byte-size delta exceeds ±${TOLERANCE_PCT}%"
  _ok "Within ±${TOLERANCE_PCT}% of baseline"
fi

# ── Phase 6: NCollection filter ratio ───────────────────────────────────────
_section "Phase 6/7  NCollection filter ratio (linked/total ≤ ${FILTER_RATIO_MAX})"
python3 - "$PROV_FILE" "$FILTER_RATIO_MAX" <<'PY' || _fail "NCollection filter ratio assertion failed"
import json, sys
prov_path, max_ratio = sys.argv[1], float(sys.argv[2])
data = json.load(open(prov_path))
mani = data.get('nCollectionManifest') or {}
linked = mani.get('linked')
total = mani.get('total')
if linked is None or total is None:
    print(f"  ERROR: provenance.json missing nCollectionManifest.linked/total (linked={linked}, total={total}).", file=sys.stderr)
    print(f"  Rebuild with `pnpm nx run ocjs:build` to produce wasm-build-provenance-v1.1.", file=sys.stderr)
    sys.exit(1)
if total == 0:
    print(f"  WARNING: nCollectionManifest.total is 0 (no auto-discovered NCollections); skipping ratio check.")
    sys.exit(0)
ratio = linked / total
print(f"  Linked: {linked} / Total: {total} = {ratio:.3f}")
if ratio > max_ratio:
    print(f"  ratio {ratio:.3f} exceeds budget {max_ratio:.3f}", file=sys.stderr)
    sys.exit(1)
print(f"  PASS: filter dropped {(1-ratio)*100:.1f}% of NCollection symbols (budget ≥ {(1-max_ratio)*100:.0f}%)")
PY

# ── Phase 7a: Warm-cache rerun ──────────────────────────────────────────────
_section "Phase 7a/7  Warm-cache rerun (budget ${WARM_BUDGET_S}s)"
WARM_START=$(date +%s)
docker run --rm \
  "${PLATFORM_FLAGS[@]}" \
  --memory 8g --cpus 8 \
  -v "$NX_VOLUME:/opencascade.js/.nx" \
  -v "$BUILD_VOLUME:/opencascade.js/build" \
  -v "$REPLICAD_YAML_ABS:/src/replicad.yml:ro" \
  -v "$OUTPUT_DIR:/output" \
  "$IMAGE_TAG" link replicad.yml
WARM_END=$(date +%s)
WARM_ELAPSED=$((WARM_END - WARM_START))
echo "  Warm wall time: ${WARM_ELAPSED}s (budget ${WARM_BUDGET_S}s)"
if [ "$WARM_ELAPSED" -gt "$WARM_BUDGET_S" ]; then
  _fail "Warm rerun (${WARM_ELAPSED}s) exceeded budget (${WARM_BUDGET_S}s) — Nx cache reuse is broken."
fi
_ok "Warm rerun within budget"

# ── Phase 7b: JS smoke test ─────────────────────────────────────────────────
_section "Phase 7b/7  JS smoke test against built replicad_single.js"
node - "$CANDIDATE_JS" <<'JS' || _fail "JS smoke test failed"
const path = require('path');
const init = require(path.resolve(process.argv[2]));
(async () => {
  const oc = await (typeof init === 'function' ? init() : init.default());
  if (!oc) throw new Error('module init returned falsy');
  const p = new oc.gp_Pnt_3(1, 2, 3);
  if (p.X() !== 1 || p.Y() !== 2 || p.Z() !== 3) {
    throw new Error(`gp_Pnt round-trip failed: (${p.X()}, ${p.Y()}, ${p.Z()})`);
  }
  const q = new oc.gp_Pnt_3(4, 5, 6);
  const edge = new oc.BRepBuilderAPI_MakeEdge_3(p, q);
  if (!edge.IsDone()) throw new Error('BRepBuilderAPI_MakeEdge.IsDone() returned false');
  edge.delete();
  p.delete();
  q.delete();
  console.log('  PASS: gp_Pnt + BRepBuilderAPI_MakeEdge round-trip succeeded.');
})().catch((err) => {
  console.error('  FAIL:', err && err.stack || err);
  process.exit(1);
});
JS

_section "RESULT: Docker E2E validation PASSED"
echo "  Image:       $IMAGE_TAG"
echo "  Cold wall:   ${COLD_ELAPSED}s"
echo "  Warm wall:   ${WARM_ELAPSED}s"
echo "  Output dir:  $OUTPUT_DIR"
echo "  Volumes:     $NX_VOLUME, $BUILD_VOLUME"

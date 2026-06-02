#!/usr/bin/env bash
# docker-e2e-validate.sh — production-readiness gate for the opencascade.js
# Docker image (PR donalffons/opencascade.js#301).
#
# Validates published images using build-configs/*.yml in this repo (not
# downstream replicad YAML). CI passes OCJS_E2E_IMAGE + OCJS_E2E_BUILD_CONFIG
# after docker/build-push-action --load; local runs build the image first.
#
# final-single / final-multi:
#   Phase 0  Build image (skipped when OCJS_E2E_IMAGE is set).
#   Phase 1  Resolve build-config YAML + artefact basename.
#   Phase 2  Cold link (uses image-baked warm cache; no empty /build volume mount).
#   Phase 3  Output presence assertions.
#   Phase 4  nCollectionManifest structural provenance (linked+dropped==total).
#   Phase 5  Warm-cache rerun (budget WARM_BUDGET_S).
#   Phase 6  JS smoke test.
#
# Trim-scope NCollection filter ratio (linked/total ≤ 0.20) is asserted in the
# docker-smoke job against link-filter-poc.yml — not here. Full builds are
# kitchen-sink configs; a high linked/total ratio is expected and correct.
#
# bindgen-base (OCJS_E2E_STAGE=bindgen-base):
#   validate build-configs/full.yml and full_multi.yml only (no link — image
#   is pre-compile; full link would shadow baked layers with empty volumes).
#
# Usage:
#   ./scripts/docker-e2e-validate.sh [--build-config <path>] [--image-tag <name>]
#
# Environment:
#   OCJS_E2E_IMAGE         Pre-built image (CI); skips Phase 0 build.
#   OCJS_E2E_BUILD_CONFIG  YAML under repo root (default: build-configs/full.yml).
#   OCJS_E2E_STAGE         final-single | final-multi | bindgen-base.
#   WARM_BUDGET_S          Default: 300
#   OCJS_E2E_CPUS          Default: host CPU count (nproc); GHA ubuntu-latest has 4

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_TAG="${OCJS_E2E_IMAGE:-ocjs:e2e}"
BUILD_CONFIG_DEFAULT="$REPO_ROOT/build-configs/full.yml"
BUILD_CONFIG="${OCJS_E2E_BUILD_CONFIG:-$BUILD_CONFIG_DEFAULT}"
OCJS_E2E_STAGE="${OCJS_E2E_STAGE:-final-single}"
OUTPUT_DIR="$REPO_ROOT/docker-e2e-output"
WARM_BUDGET_S="${WARM_BUDGET_S:-300}"
DOCKER_CPUS="${OCJS_E2E_CPUS:-$(nproc 2>/dev/null || echo 4)}"
SKIP_BUILD=0
PLATFORM_FLAGS=()

if [ -n "${OCJS_E2E_IMAGE:-}" ]; then
  SKIP_BUILD=1
fi

if [ "$(uname -m)" = "arm64" ] && [ "$(uname -s)" = "Darwin" ]; then
  PLATFORM_FLAGS+=("--platform" "linux/amd64")
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build-config)   BUILD_CONFIG="$2"; shift 2 ;;
    --image-tag)      IMAGE_TAG="$2"; shift 2 ;;
    --output-dir)     OUTPUT_DIR="$2"; shift 2 ;;
    --skip-build)     SKIP_BUILD=1; shift ;;
    --warm-budget)    WARM_BUDGET_S="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,35p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

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

_resolve_artifact_basename() {
  local yaml_path="$1"
  awk '/^mainBuild:/{f=1} f && /^  name:/{gsub(/\.js$/,"",$2); print $2; exit}' "$yaml_path"
}

_run_link() {
  local yaml_host_path="$1"
  local yaml_basename
  yaml_basename="$(basename "$yaml_host_path")"
  docker run --rm \
    "${PLATFORM_FLAGS[@]}" \
    --memory 8g --cpus "$DOCKER_CPUS" \
    -u "$(id -u):$(id -g)" \
    -v "$yaml_host_path:/src/${yaml_basename}:ro" \
    -v "$OUTPUT_DIR:/output" \
    -e OCJS_OUTPUT_DIR=/output \
    "$IMAGE_TAG" link "$yaml_basename"
}

_run_validate() {
  local yaml_in_image="$1"
  docker run --rm \
    "${PLATFORM_FLAGS[@]}" \
    "$IMAGE_TAG" validate "$yaml_in_image"
}

# ── bindgen-base: validate full configs only ────────────────────────────────
if [ "$OCJS_E2E_STAGE" = "bindgen-base" ]; then
  _section "Phase 0/2  Building image ($IMAGE_TAG)"
  if [ "$SKIP_BUILD" -eq 1 ]; then
    echo "  OCJS_E2E_IMAGE set; reusing existing image."
    docker image inspect "$IMAGE_TAG" >/dev/null 2>&1 || _fail "Image $IMAGE_TAG not present."
  else
    DOCKER_BUILDKIT=1 docker build \
      "${PLATFORM_FLAGS[@]}" \
      --progress=plain \
      -t "$IMAGE_TAG" \
      --target bindgen-base \
      "$REPO_ROOT"
    _ok "Image built"
  fi

  _section "Phase 1/2  Validating full build-configs (schema only)"
  for cfg in /opencascade.js/build-configs/full.yml /opencascade.js/build-configs/full_multi.yml; do
    _run_validate "$cfg"
    _ok "validate $cfg"
  done

  _section "RESULT: bindgen-base Docker E2E validation PASSED"
  echo "  Image: $IMAGE_TAG"
  exit 0
fi

# ── final-single / final-multi: full link gate ──────────────────────────────
_section "Phase 0/6  Building image ($IMAGE_TAG)"
if [ "$SKIP_BUILD" -eq 1 ]; then
  echo "  OCJS_E2E_IMAGE set; reusing existing image."
  docker image inspect "$IMAGE_TAG" >/dev/null 2>&1 || _fail "Image $IMAGE_TAG not present."
else
  target="final-single"
  if [ "$OCJS_E2E_STAGE" = "final-multi" ]; then
    target="final-multi"
  fi
  DOCKER_BUILDKIT=1 docker build \
    "${PLATFORM_FLAGS[@]}" \
    --progress=plain \
    -t "$IMAGE_TAG" \
    --target "$target" \
    "$REPO_ROOT"
  _ok "Image built"
fi

_section "Phase 1/6  Resolving build-config YAML"
if [ ! -f "$BUILD_CONFIG" ]; then
  _fail "BUILD_CONFIG not found at $BUILD_CONFIG
Override with --build-config <path> or OCJS_E2E_BUILD_CONFIG=<path>."
fi
BUILD_CONFIG_ABS="$(cd "$(dirname "$BUILD_CONFIG")" && pwd)/$(basename "$BUILD_CONFIG")"
ARTIFACT_BASENAME="$(_resolve_artifact_basename "$BUILD_CONFIG_ABS")"
if [ -z "$ARTIFACT_BASENAME" ]; then
  _fail "Could not read mainBuild.name from $BUILD_CONFIG_ABS"
fi
_ok "Using $BUILD_CONFIG_ABS (artefact prefix: ${ARTIFACT_BASENAME})"

mkdir -p "$OUTPUT_DIR"

_section "Phase 2/6  Cold link against ${ARTIFACT_BASENAME}"
COLD_START=$(date +%s)
_run_link "$BUILD_CONFIG_ABS"
COLD_END=$(date +%s)
COLD_ELAPSED=$((COLD_END - COLD_START))
_ok "Cold link wall time: ${COLD_ELAPSED}s"

_section "Phase 3/6  Asserting output artefacts"
EXPECTED_ARTIFACTS=(
  "${ARTIFACT_BASENAME}.wasm"
  "${ARTIFACT_BASENAME}.js"
  "${ARTIFACT_BASENAME}.d.ts"
  "${ARTIFACT_BASENAME}.js.symbols"
  "${ARTIFACT_BASENAME}.provenance.json"
  "${ARTIFACT_BASENAME}.build-manifest.json"
)
for f in "${EXPECTED_ARTIFACTS[@]}"; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    _fail "Missing artefact: $OUTPUT_DIR/$f"
  fi
  _ok "$f ($(_stat_size "$OUTPUT_DIR/$f") bytes)"
done

CANDIDATE_JS="$OUTPUT_DIR/${ARTIFACT_BASENAME}.js"
PROV_FILE="$OUTPUT_DIR/${ARTIFACT_BASENAME}.provenance.json"

_section "Phase 4/6  nCollectionManifest provenance (structural)"
python3 - "$PROV_FILE" <<'PY' || _fail "nCollectionManifest provenance assertion failed"
import json, sys
data = json.load(open(sys.argv[1]))
mani = data.get("nCollectionManifest") or {}
linked = mani.get("linked")
total = mani.get("total")
dropped = mani.get("dropped")
if linked is None or total is None or dropped is None:
    print(
        f"  ERROR: provenance.json missing nCollectionManifest fields "
        f"(linked={linked}, total={total}, dropped={dropped}).",
        file=sys.stderr,
    )
    sys.exit(1)
if total == 0:
    print("  WARNING: nCollectionManifest.total is 0; skipping structural check.")
    sys.exit(0)
if linked <= 0:
    print(f"  ERROR: nCollectionManifest.linked must be > 0 (got {linked}).", file=sys.stderr)
    sys.exit(1)
if linked + dropped != total:
    print(
        f"  ERROR: invariant violated: linked({linked}) + dropped({dropped}) != total({total}).",
        file=sys.stderr,
    )
    sys.exit(1)
ratio = linked / total
print(f"  Linked: {linked} / Total: {total} / Dropped: {dropped} (ratio {ratio:.3f}, informational)")
print("  PASS: nCollectionManifest structural invariants satisfied")
PY

_section "Phase 5/6  Warm-cache rerun (budget ${WARM_BUDGET_S}s)"
WARM_START=$(date +%s)
_run_link "$BUILD_CONFIG_ABS"
WARM_END=$(date +%s)
WARM_ELAPSED=$((WARM_END - WARM_START))
echo "  Warm wall time: ${WARM_ELAPSED}s (budget ${WARM_BUDGET_S}s)"
if [ "$WARM_ELAPSED" -gt "$WARM_BUDGET_S" ]; then
  _fail "Warm rerun (${WARM_ELAPSED}s) exceeded budget (${WARM_BUDGET_S}s)."
fi
_ok "Warm rerun within budget"

_section "Phase 6/6  JS smoke test against ${ARTIFACT_BASENAME}.js"
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
echo "  Config:      $BUILD_CONFIG_ABS"
echo "  Cold wall:   ${COLD_ELAPSED}s"
echo "  Warm wall:   ${WARM_ELAPSED}s"
echo "  Output dir:  $OUTPUT_DIR"

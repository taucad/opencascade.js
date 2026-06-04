#!/usr/bin/env bash
# docker-ci-preflight.sh — run docker.yml validation gates locally (no GHA).
#
# Mirrors docker-smoke + branch-publish e2e steps using a pre-built image so
# iteration does not require a multi-hour Dockerfile rebuild.
#
# Usage:
#   ./scripts/docker-ci-preflight.sh
#   ./scripts/docker-ci-preflight.sh --image ghcr.io/taucad/opencascade.js:branch-occt-v8-emscripten-5
#   ./scripts/docker-ci-preflight.sh --skip-full-link   # smoke + bindgen + JS smoke only
#
# Environment:
#   OCJS_PREFLIGHT_IMAGE   Default: ghcr.io/taucad/opencascade.js:single-threaded
#   OCJS_PREFLIGHT_MULTI   Image for final-multi e2e (default: same as single)
#   WARM_BUDGET_S          Default: 1200 (20 min; full.yml warm link ~8–9 min on GHA)
#   OCJS_DOCKER_PLATFORM   Optional docker --platform (e.g. linux/amd64)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

_resolve_docker_cpus() {
  local requested="${1:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
  local docker_max
  docker_max="$(docker info --format '{{.NCPU}}' 2>/dev/null || echo "$requested")"
  docker_max="${docker_max%%.*}"
  if [ "$requested" -gt "$docker_max" ]; then
    echo "$docker_max"
  else
    echo "$requested"
  fi
}

IMAGE="${OCJS_PREFLIGHT_IMAGE:-ghcr.io/taucad/opencascade.js:single-threaded}"
MULTI_IMAGE="${OCJS_PREFLIGHT_MULTI:-$IMAGE}"
WARM_BUDGET_S="${WARM_BUDGET_S:-1200}"
SKIP_FULL_LINK=0
DOCKER_CPUS="$(_resolve_docker_cpus "${OCJS_E2E_CPUS:-}")"
PLATFORM_FLAGS=()

if [ -n "${OCJS_DOCKER_PLATFORM:-}" ]; then
  PLATFORM_FLAGS+=(--platform "$OCJS_DOCKER_PLATFORM")
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; MULTI_IMAGE="${OCJS_PREFLIGHT_MULTI:-$2}"; shift 2 ;;
    --multi-image) MULTI_IMAGE="$2"; shift 2 ;;
    --skip-full-link) SKIP_FULL_LINK=1; shift ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

_section() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════════════"
}

_docker_run() {
  if [ "${#PLATFORM_FLAGS[@]}" -gt 0 ]; then
    docker run --rm "${PLATFORM_FLAGS[@]}" "$@"
  else
    docker run --rm "$@"
  fi
}

_image_supports_nonroot_link() {
  _docker_run --entrypoint sh "$1" -c \
    'test -w /emsdk/upstream/emscripten/src/lib/libembind.js' >/dev/null 2>&1
}

if ! _image_supports_nonroot_link "$IMAGE"; then
  echo "ERROR: $IMAGE lacks non-root libembind write perms (published before Dockerfile chmod fix)." >&2
  echo "  CI builds a fresh final-single image (ocjs:e2e) — this GHCR tag is stale for link smoke." >&2
  echo "  Build locally:  docker build --target final-single -t ocjs:preflight ." >&2
  echo "  Then rerun:     OCJS_PREFLIGHT_IMAGE=ocjs:preflight ./scripts/docker-ci-preflight.sh" >&2
  if docker image inspect ocjs:ci >/dev/null 2>&1 && _image_supports_nonroot_link ocjs:ci; then
    echo "  Hint: ocjs:ci on this machine supports non-root link — try OCJS_PREFLIGHT_IMAGE=ocjs:ci" >&2
  fi
  exit 1
fi

echo "Preflight image (single/bindgen): $IMAGE"
echo "Preflight image (multi):          $MULTI_IMAGE"
echo "Warm link budget:                 ${WARM_BUDGET_S}s"
echo "Docker CPUs:                      $DOCKER_CPUS"

_section "docker-smoke · validate full.yml + link-filter-poc.yml"
_docker_run "$IMAGE" validate /opencascade.js/build-configs/full.yml
_docker_run "$IMAGE" validate /opencascade.js/build-configs/link-filter-poc.yml
echo "  PASS: schema validation"

_section "docker-smoke · link-filter-poc.yml"
SMOKE_OUT="$REPO_ROOT/docker-preflight-smoke-output"
rm -rf "$SMOKE_OUT"
mkdir -p "$SMOKE_OUT"
_docker_run \
  --cpus "$DOCKER_CPUS" \
  -u "$(id -u):$(id -g)" \
  -e OCJS_CONFIG=debug \
  -v "$SMOKE_OUT:/src" \
  -v "$REPO_ROOT/build-configs/link-filter-poc.yml:/src/build-config.yml:ro" \
  "$IMAGE" link build-config.yml

for ext in wasm js d.ts js.symbols build-manifest.json provenance.json; do
  f="$SMOKE_OUT/opencascade_linkfilter_poc.${ext}"
  [ -f "$f" ] || { echo "Missing $f" >&2; exit 1; }
  echo "  PASS: $(basename "$f")"
done
python3 "$SCRIPT_DIR/docker-ncollection-check.py" trim "$SMOKE_OUT/opencascade_linkfilter_poc.provenance.json"

_section "branch-publish · bindgen-base e2e (validate only)"
OCJS_E2E_IMAGE="$IMAGE" \
OCJS_E2E_STAGE=bindgen-base \
WARM_BUDGET_S="$WARM_BUDGET_S" \
OCJS_E2E_CPUS="$DOCKER_CPUS" \
OCJS_DOCKER_PLATFORM="${OCJS_DOCKER_PLATFORM:-}" \
  "$SCRIPT_DIR/docker-e2e-validate.sh"

if [ "$SKIP_FULL_LINK" -eq 1 ]; then
  _section "Skipping full.yml / full_multi.yml link gates (--skip-full-link)"
  exit 0
fi

_section "branch-publish · final-single e2e (full.yml)"
OCJS_E2E_IMAGE="$IMAGE" \
OCJS_E2E_STAGE=final-single \
OCJS_E2E_BUILD_CONFIG=build-configs/full.yml \
WARM_BUDGET_S="$WARM_BUDGET_S" \
OCJS_E2E_CPUS="$DOCKER_CPUS" \
OCJS_DOCKER_PLATFORM="${OCJS_DOCKER_PLATFORM:-}" \
  "$SCRIPT_DIR/docker-e2e-validate.sh"

if [ "$MULTI_IMAGE" != "$IMAGE" ] || docker manifest inspect "$MULTI_IMAGE" >/dev/null 2>&1; then
  _section "branch-publish · final-multi e2e (full_multi.yml)"
  OCJS_E2E_IMAGE="$MULTI_IMAGE" \
  OCJS_E2E_STAGE=final-multi \
  OCJS_E2E_BUILD_CONFIG=build-configs/full_multi.yml \
  WARM_BUDGET_S="$WARM_BUDGET_S" \
  OCJS_E2E_CPUS="$DOCKER_CPUS" \
  OCJS_DOCKER_PLATFORM="${OCJS_DOCKER_PLATFORM:-}" \
    "$SCRIPT_DIR/docker-e2e-validate.sh"
else
  echo "  SKIP: multi image not available at $MULTI_IMAGE"
fi

_section "RESULT: docker CI preflight PASSED"

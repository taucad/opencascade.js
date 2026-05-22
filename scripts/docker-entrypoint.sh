#!/usr/bin/env bash
# docker-entrypoint.sh — dispatch container subcommands through Nx so consumers
# get content-addressed caching across `docker run` invocations.
#
# Recognised forms:
#   full <yaml>         -> nx run ocjs:link (Nx graph pulls every transitive dep)
#   link <yaml>         -> nx run ocjs:link
#   compile-bindings    -> nx run ocjs:compile-bindings
#   compile-sources     -> nx run ocjs:compile-sources
#   pch                 -> nx run ocjs:pch
#   generate            -> nx run ocjs:generate
#   apply-patches       -> nx run ocjs:apply-patches
#   validate <yaml>     -> build-wasm.sh validate <yaml>   (no Nx caching needed)
#   nx <args...>        -> npx nx <args...>                (escape hatch)
#   --help|-h           -> show this help
#
# Everything else falls through to build-wasm.sh for backwards compatibility.
#
# OCJS_YAML is set from the YAML positional argument so the Nx `link` target
# (whose cache key depends on OCJS_YAML + a sha of the file contents) can hash
# correctly. OCJS_OUTPUT_DIR defaults to /src so the canonical single-mount
# Quickstart pattern (`docker run -v "$(pwd):/src" …`) writes outputs next to
# the consumer's YAML automatically; power users override it with
# `-e OCJS_OUTPUT_DIR=<path>` + a matching `-v` mount.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OCJS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

show_help() {
  cat <<'EOF'
docker-entrypoint.sh — opencascade.js Docker dispatcher

Subcommands (Nx-cached):
  full <yaml>           Full pipeline (apply-patches + pch + generate + compile-bindings + compile-sources + link)
  link <yaml>           Link only (reuses compiled .o files; fastest)
  compile-bindings      Recompile Embind .cpp files
  compile-sources       Recompile OCCT static libraries via CMake
  pch                   Rebuild flat includes + precompiled header
  generate              Regenerate Embind .cpp + .d.ts.json fragments
  apply-patches         (Re)apply OCCT source patches

Subcommands (non-cached):
  validate <yaml>       Validate YAML config without building
  nx <args...>          Pass-through to `npx nx <args...>`

Anything else is forwarded to /opencascade.js/build-wasm.sh for backwards compat.

Canonical single-mount Quickstart:
  docker run --rm \
    -v "$(pwd):/src" \
    -u "$(id -u):$(id -g)" \
    ghcr.io/taucad/opencascade.js:single-threaded full /src/my.yml

Persistent caches across runs (iterative work):
  docker volume create ocjs-nx-cache ocjs-build-cache
  docker run --rm \
    -v ocjs-nx-cache:/opencascade.js/.nx \
    -v ocjs-build-cache:/opencascade.js/build \
    -v "$(pwd):/src" \
    -u "$(id -u):$(id -g)" \
    ghcr.io/taucad/opencascade.js:single-threaded full /src/my.yml
EOF
}

if [ "$#" -eq 0 ]; then
  show_help
  exit 1
fi

cmd="$1"
shift || true

case "$cmd" in
  --help|-h|help)
    show_help
    exit 0
    ;;
esac

cd "$OCJS_ROOT"

run_nx_with_yaml() {
  local target="$1"
  local yaml="${2:-}"
  if [ -z "$yaml" ]; then
    echo "ERROR: '$cmd' requires a YAML config path argument" >&2
    show_help
    exit 1
  fi
  if [ ! -f "$yaml" ]; then
    echo "ERROR: YAML config not found: $yaml" >&2
    exit 1
  fi
  local yaml_abs
  yaml_abs="$(cd "$(dirname "$yaml")" && pwd)/$(basename "$yaml")"
  export OCJS_YAML="$yaml_abs"
  exec npx nx run "ocjs:$target"
}

run_nx_simple() {
  local target="$1"
  exec npx nx run "ocjs:$target"
}

case "$cmd" in
  full|link)
    # `full` and `link` both resolve to ocjs:link — its Nx dependsOn graph
    # transitively pulls apply-patches, pch, generate, compile-bindings, and
    # compile-sources, with cache reuse wherever inputs are unchanged.
    run_nx_with_yaml "link" "${1:-}"
    ;;
  apply-patches|pch|generate|compile-bindings|compile-sources|dts|provenance|validate-build)
    run_nx_simple "$cmd"
    ;;
  validate)
    yaml="${1:-}"
    if [ -z "$yaml" ]; then
      echo "ERROR: validate requires a YAML config path argument" >&2
      exit 1
    fi
    exec ./build-wasm.sh validate "$yaml"
    ;;
  nx)
    exec npx nx "$@"
    ;;
  *)
    # Backwards compatibility: forward anything unrecognised to build-wasm.sh.
    exec ./build-wasm.sh "$cmd" "$@"
    ;;
esac

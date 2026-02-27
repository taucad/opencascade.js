#!/bin/bash
set -euo pipefail

# ── OpenCascade.js WASM Build Script ─────────────────────────────────
#
# Single entry point for all build operations: PCH rebuild, binding
# compilation, source compilation, and final WASM linking.
#
# Usage:
#   ./build-wasm.sh link <yaml>           # Link only (fastest, reuses .o)
#   ./build-wasm.sh pch                   # Rebuild flat includes + PCH
#   ./build-wasm.sh pch link <yaml>       # Rebuild PCH then link
#   ./build-wasm.sh bindings              # Compile bindings only
#   ./build-wasm.sh sources               # Compile OCCT sources only
#   ./build-wasm.sh full <yaml>           # Full pipeline: pch + bindings + sources + link
#
# Environment overrides (all optional, sensible defaults provided):
#   EMSDK              Path to emsdk (default: ../assimpjs/emsdk)
#   OCCT_ROOT          Path to OCCT source (default: ../OCCT)
#   RAPIDJSON_ROOT     Path to rapidjson (default: ./rapidjson)
#   FREETYPE_ROOT      Path to freetype (default: ./freetype)
#   OCJS_OPT           Compile optimization level (default: -O2)
#   OCJS_LTO           Enable LTO at compile time: 0|1 (default: 1)
#   THREADING          Threading mode: single-threaded|multi-threaded (default: single-threaded)
#
# Native WASM exceptions (-fwasm-exceptions) are always enabled.
#
# Examples:
#   # Production single build (-O2 compile, noLTO)
#   OCJS_LTO=0 ./build-wasm.sh full ../replicad/packages/replicad-opencascadejs/build-config/custom_build_single_v8.yml
#
#   # Quick rebuild after changing filterPackages.py
#   ./build-wasm.sh pch link ../replicad/packages/replicad-opencascadejs/build-config/custom_build_single_v8.yml
#
#   # Dev build (fast compile, no LTO)
#   OCJS_OPT=-O0 OCJS_LTO=0 ./build-wasm.sh link custom_build.yml
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Resolve paths ────────────────────────────────────────────────────

export EMSDK="${EMSDK:-$(cd ../assimpjs/emsdk 2>/dev/null && pwd || echo "")}"
if [ -z "$EMSDK" ] || [ ! -d "$EMSDK" ]; then
  echo "ERROR: EMSDK not found. Set EMSDK= or place emsdk at ../assimpjs/emsdk" >&2
  exit 1
fi
source "$EMSDK/emsdk_env.sh" 2>/dev/null

export OCJS_ROOT="$SCRIPT_DIR"
export OCCT_ROOT="${OCCT_ROOT:-$(cd "$SCRIPT_DIR/../OCCT" 2>/dev/null && pwd || echo "")}"
export RAPIDJSON_ROOT="${RAPIDJSON_ROOT:-$(cd "$SCRIPT_DIR/../rapidjson" 2>/dev/null && pwd || echo "$SCRIPT_DIR/rapidjson")}"
export FREETYPE_ROOT="${FREETYPE_ROOT:-$(cd "$SCRIPT_DIR/../freetype" 2>/dev/null && pwd || echo "$SCRIPT_DIR/freetype")}"

for dep_name in OCCT_ROOT RAPIDJSON_ROOT FREETYPE_ROOT; do
  dep_val="${!dep_name}"
  if [ -z "$dep_val" ] || [ ! -d "$dep_val" ]; then
    echo "ERROR: $dep_name not found at '$dep_val'" >&2
    exit 1
  fi
done

# ── Build flags ──────────────────────────────────────────────────────

export OCJS_OPT="${OCJS_OPT:--O2}"
export OCJS_LTO="${OCJS_LTO:-1}"
export threading="${THREADING:-single-threaded}"
export PYTHONPATH="$OCJS_ROOT/src:${PYTHONPATH:-}"

# ── Print config ─────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         OpenCascade.js WASM Build                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  %-14s %s\n" "EMSDK:" "$EMSDK ║"
printf "║  %-14s %s\n" "Emscripten:" "$(emcc --version 2>/dev/null | head -1) ║"
printf "║  %-14s %s\n" "OCCT_ROOT:" "$OCCT_ROOT ║"
printf "║  %-14s %s\n" "OCJS_OPT:" "$OCJS_OPT ║"
printf "║  %-14s %s\n" "OCJS_LTO:" "$OCJS_LTO ║"
printf "║  %-14s %s\n" "exceptions:" "wasm-exceptions (always) ║"
printf "║  %-14s %s\n" "threading:" "$threading ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

mkdir -p build/{bindings,sources,dist}

# ── Step functions ───────────────────────────────────────────────────

step_pch() {
  echo "═══ Rebuilding flat includes + PCH ═══"
  rm -f build/pch.h.pch build/pch.h
  rm -rf build/occt-includes
  python3 -c "
import sys; sys.path.insert(0, 'src')
from Common import buildFlatIncludes, buildPch
buildFlatIncludes()
buildPch(threading='$threading')
"
  echo ""
}

step_bindings() {
  echo "═══ Compiling bindings ═══"
  python3 src/compileBindings.py "$threading"
  echo ""
}

step_sources() {
  echo "═══ Compiling OCCT sources ═══"
  python3 src/compileSources.py "$threading"
  echo ""
}

step_link() {
  local yaml="$1"
  if [ ! -f "$yaml" ]; then
    echo "ERROR: YAML config not found: $yaml" >&2
    exit 1
  fi
  echo "═══ Linking WASM from $yaml ═══"
  cd "$(dirname "$yaml")"
  python3 "$OCJS_ROOT/src/buildFromYaml.py" "$(basename "$yaml")"
  cd "$SCRIPT_DIR"
  echo ""
}

# ── Parse commands ───────────────────────────────────────────────────

if [ $# -eq 0 ]; then
  echo "Usage: $0 <command> [<command>...] [<yaml-config>]"
  echo ""
  echo "Commands: pch, bindings, sources, link <yaml>, full <yaml>"
  exit 1
fi

YAML_CONFIG=""
COMMANDS=()

while [ $# -gt 0 ]; do
  case "$1" in
    pch|bindings|sources)
      COMMANDS+=("$1")
      shift
      ;;
    link|full)
      COMMANDS+=("$1")
      shift
      if [ $# -eq 0 ]; then
        echo "ERROR: '$1' requires a YAML config path argument" >&2
        exit 1
      fi
      YAML_CONFIG="$1"
      shift
      ;;
    *)
      if [ -f "$1" ] && [[ "$1" == *.yml ]]; then
        YAML_CONFIG="$1"
        shift
      else
        echo "ERROR: Unknown command or file: $1" >&2
        exit 1
      fi
      ;;
  esac
done

START_TIME=$(date +%s)

for cmd in "${COMMANDS[@]}"; do
  case "$cmd" in
    pch)       step_pch ;;
    bindings)  step_bindings ;;
    sources)   step_sources ;;
    link)      step_link "$YAML_CONFIG" ;;
    full)
      step_pch
      step_bindings
      step_sources
      step_link "$YAML_CONFIG"
      ;;
  esac
done

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo "═══ Done in ${ELAPSED}s ═══"

WASM_DIR="$(dirname "$YAML_CONFIG")"
for wasm in "$WASM_DIR"/*.wasm; do
  if [ -f "$wasm" ]; then
    SIZE=$(stat -f%z "$wasm" 2>/dev/null || stat -c%s "$wasm" 2>/dev/null || echo "?")
    SIZE_MB=$(echo "scale=2; $SIZE / 1048576" | bc 2>/dev/null || echo "?")
    echo "  $(basename "$wasm"): ${SIZE_MB} MB"
  fi
done

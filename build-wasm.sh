#!/bin/bash
set -euo pipefail

# ── OpenCascade.js WASM Build Script ─────────────────────────────────
#
# Single entry point for all build operations: PCH rebuild, binding
# compilation, source compilation, and final WASM linking.
# Includes config-keyed compilation caching and provenance tracking.
#
# Usage:
#   ./build-wasm.sh link <yaml>           # Link only (fastest, reuses .o)
#   ./build-wasm.sh pch                   # Rebuild flat includes + PCH
#   ./build-wasm.sh pch link <yaml>       # Rebuild PCH then link
#   ./build-wasm.sh generate              # Generate binding .cpp files from OCCT headers
#   ./build-wasm.sh bindings              # Compile bindings only
#   ./build-wasm.sh sources               # Compile OCCT sources only
#   ./build-wasm.sh full <yaml>           # Full pipeline: pch + generate + bindings + sources + link
#   ./build-wasm.sh --config O3-maxperf full <yaml>  # Full pipeline with named configuration
#
# Environment overrides (all optional, sensible defaults provided):
#   EMSDK              Path to emsdk (default: deps/emsdk/)
#   OCCT_ROOT          Path to OCCT source (default: deps/OCCT/)
#   RAPIDJSON_ROOT     Path to rapidjson (default: deps/rapidjson/)
#   FREETYPE_ROOT      Path to freetype (default: ./freetype)
#   OCJS_OPT           Compile optimization level (default: -O2)
#   OCJS_EXTRA_CFLAGS  Extra compile flags appended to C/CXX flags (e.g. "-mllvm -inline-threshold=128")
#   OCJS_LTO           Enable LTO at compile time: 0|1 (default: 1)
#   OCJS_EXCEPTIONS    Enable native WASM exceptions: 0|1 (default: 0)
#   THREADING          Threading mode: single-threaded|multi-threaded (default: single-threaded)
#
# Examples:
#   # Production single build (-O2 compile, noLTO)
#   OCJS_LTO=0 ./build-wasm.sh full build-configs/full.yml
#
#   # Quick rebuild after changing filterPackages.py
#   ./build-wasm.sh pch link build-configs/full.yml
#
#   # Dev build (fast compile, no LTO)
#   OCJS_OPT=-O0 OCJS_LTO=0 ./build-wasm.sh link custom_build.yml
#
#   # Use named configuration
#   ./build-wasm.sh --config O3-maxperf full consumer.yml
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Help ─────────────────────────────────────────────────────────────

show_help() {
  cat << 'HELPEOF'
Usage: ./build-wasm.sh <command> [options] [<yaml-config>]

Commands:
  full <yaml>           Full pipeline: apply-patches + pch + generate + bindings + sources + link
  apply-patches         Apply OCCT source patches (idempotent, based on OCJS_PATCH_DUMP)
  link <yaml>           Link only (reuses compiled .o files, fastest)
  pch                   Rebuild flat includes + precompiled header
  generate              Generate binding .cpp files from OCCT headers
  bindings              Compile bindings only
  sources               Compile OCCT sources only
  validate <yaml>       Validate YAML config without building
  clean-generated       Remove all generated .d.ts.json and .cpp files (handles symlinks)
  clean-objects         Remove all compiled .o files from compiled-bindings/ (handles symlinks)

Options:
  --help                Show this help message
  --config <name>       Apply a named configuration from build-configs/configurations.json

Environment Variables:
  EMSDK                 Path to Emscripten SDK (default: deps/emsdk/)
  OCCT_ROOT             Path to OCCT source (default: deps/OCCT/)
  RAPIDJSON_ROOT        Path to rapidjson (default: deps/rapidjson/)
  FREETYPE_ROOT         Path to freetype (default: deps/freetype/)
  OCJS_CONFIG           Named configuration (alternative to --config flag)
  OCJS_OPT              Optimization level: -O0, -O2, -O3, -Os, -Oz (default: -O2)
  OCJS_EXTRA_CFLAGS     Extra compile flags (e.g. "-mllvm -inline-threshold=128")
  OCJS_LTO              Enable LTO: 0|1 (default: 0)
  OCJS_EXCEPTIONS       Native WASM exceptions: 0|1 (default: 0)
  THREADING             Threading mode: single-threaded|multi-threaded (default: single-threaded)
  OCJS_STRICT_DEPS      Fail on dependency commit mismatch: 0|1 (default: 0)
  OCJS_FORCE_GENERATE   Force regeneration of all bindings: 0|1 (default: 0)

Examples:
  # Full build with a named configuration
  ./build-wasm.sh --config O3-maxperf full build-configs/full.yml

  # Link only with consumer YAML (reuses compile cache)
  ./build-wasm.sh --config O3-maxperf link path/to/consumer.yml

  # Override a flag from the config
  OCJS_WASM_OPT_LEVEL=-O4 ./build-wasm.sh --config O3-maxperf full consumer.yml

  # Raw env vars, no config (backward compat)
  OCJS_OPT=-O3 OCJS_LTO=0 ./build-wasm.sh full build-configs/full.yml

  # Validate config without building
  ./build-wasm.sh validate build-configs/full.yml
HELPEOF
  exit 0
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  show_help
fi

# (cache-list and cache-gc removed -- caching is managed by Nx)

_resolve_symlink_target() {
  local path="$1"
  if [ -L "$path" ]; then
    readlink -f "$path" 2>/dev/null || readlink "$path"
  else
    echo "$path"
  fi
}

_ensure_doxygen() {
  local version commit tag
  version=$("$OCJS_PYTHON" -c "import json; d=json.load(open('$SCRIPT_DIR/DEPS.json'))['dependencies']['doxygen']; print(d['version'])" 2>/dev/null || echo "")
  commit=$("$OCJS_PYTHON" -c "import json; d=json.load(open('$SCRIPT_DIR/DEPS.json'))['dependencies']['doxygen']; print(d['commit'])" 2>/dev/null || echo "")
  tag=$("$OCJS_PYTHON" -c "import json; d=json.load(open('$SCRIPT_DIR/DEPS.json'))['dependencies']['doxygen']; print(d['release_tag'])" 2>/dev/null || echo "")
  local doxygen_bin="$SCRIPT_DIR/tools/doxygen/bin/doxygen"
  local stamp_file="$SCRIPT_DIR/tools/doxygen/.commit"

  if [ -x "$doxygen_bin" ] && [ -f "$stamp_file" ]; then
    local installed_commit
    installed_commit=$(cat "$stamp_file" 2>/dev/null || echo "")
    if [ "$installed_commit" = "$commit" ]; then
      return 0
    fi
    echo "  Doxygen commit mismatch ($installed_commit != $commit), re-downloading..."
  fi

  echo "  Downloading Doxygen $version..."
  local os_name arch asset_name
  os_name="$(uname -s)"
  arch="$(uname -m)"
  case "$os_name" in
    Darwin)
      case "$arch" in
        arm64) asset_name="doxygen-${version}-mac-arm.zip" ;;
        *)     asset_name="doxygen-${version}-mac-intel.zip" ;;
      esac
      ;;
    Linux)
      asset_name="doxygen-${version}.linux.bin.tar.gz"
      ;;
    *)
      echo "  WARNING: Unsupported OS '$os_name' for Doxygen auto-download. Install doxygen manually." >&2
      return 1
      ;;
  esac

  local url="https://github.com/doxygen/doxygen/releases/download/${tag}/${asset_name}"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  mkdir -p "$SCRIPT_DIR/tools"
  rm -rf "$SCRIPT_DIR/tools/doxygen"

  if ! curl -fsSL "$url" -o "$tmp_dir/$asset_name"; then
    echo "  WARNING: Failed to download Doxygen from $url" >&2
    rm -rf "$tmp_dir"
    return 1
  fi

  case "$asset_name" in
    *.zip)
      unzip -q "$tmp_dir/$asset_name" -d "$tmp_dir/extracted"
      local inner_dir
      inner_dir="$(ls -d "$tmp_dir/extracted"/Doxygen.app/Contents/Resources 2>/dev/null || ls -d "$tmp_dir/extracted"/doxygen-* 2>/dev/null || echo "$tmp_dir/extracted")"
      mkdir -p "$SCRIPT_DIR/tools/doxygen/bin"
      cp "$inner_dir/doxygen" "$SCRIPT_DIR/tools/doxygen/bin/doxygen" 2>/dev/null || \
        find "$tmp_dir/extracted" -name "doxygen" -type f -exec cp {} "$SCRIPT_DIR/tools/doxygen/bin/doxygen" \;
      chmod +x "$SCRIPT_DIR/tools/doxygen/bin/doxygen"
      ;;
    *.tar.gz)
      tar xzf "$tmp_dir/$asset_name" -C "$tmp_dir"
      local extracted_dir
      extracted_dir="$(ls -d "$tmp_dir"/doxygen-* 2>/dev/null | head -1)"
      mv "$extracted_dir" "$SCRIPT_DIR/tools/doxygen"
      ;;
  esac

  rm -rf "$tmp_dir"

  if [ -x "$doxygen_bin" ]; then
    echo "$commit" > "$stamp_file"
    echo "  Doxygen $version ($commit) installed at $doxygen_bin"
  else
    echo "  WARNING: Doxygen binary not found after extraction" >&2
    return 1
  fi
}

if [ "${1:-}" = "clean-generated" ]; then
  echo "Cleaning generated .d.ts.json and .cpp files..."
  target="$(_resolve_symlink_target "$SCRIPT_DIR/build/bindings")"
  if [ -d "$target" ]; then
    count=$(find "$target" \( -name "*.d.ts.json" -o \( -name "*.cpp" ! -name "*.cpp.o" \) \) | wc -l | tr -d ' ')
    find "$target" -name "*.d.ts.json" -delete 2>/dev/null || true
    find "$target" -name "*.cpp" ! -name "*.cpp.o" -delete 2>/dev/null || true
    rm -f "$SCRIPT_DIR/build/bindings/.generator-hash" 2>/dev/null || true
    echo "  Removed $count generated files."
  else
    echo "  No build/bindings directory found."
  fi
  echo "Done. Run 'generate' to regenerate."
  exit 0
fi

if [ "${1:-}" = "clean-objects" ]; then
  echo "Cleaning compiled .o files..."
  target="$SCRIPT_DIR/build/compiled-bindings"
  if [ -d "$target" ]; then
    count=$(find "$target" -name "*.cpp.o" | wc -l | tr -d ' ')
    rm -rf "$target"
    echo "  Removed $count object files from compiled-bindings/."
  else
    echo "  No build/compiled-bindings directory found."
  fi
  # Also clean legacy .cpp.o from build/bindings/ if present
  legacy="$(_resolve_symlink_target "$SCRIPT_DIR/build/bindings")"
  if [ -d "$legacy" ]; then
    legacy_count=$(find "$legacy" -name "*.cpp.o" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$legacy_count" -gt 0 ]; then
      find "$legacy" -name "*.cpp.o" -delete 2>/dev/null || true
      echo "  Removed $legacy_count legacy object files from bindings/."
    fi
  fi
  echo "Done. Run 'bindings' to recompile."
  exit 0
fi

# ── Resolve paths ────────────────────────────────────────────────────

if [ -z "${EMSDK:-}" ] || [ ! -d "${EMSDK:-}" ]; then
  if [ -d "$SCRIPT_DIR/deps/emsdk" ]; then
    export EMSDK="$SCRIPT_DIR/deps/emsdk"
  elif [ -d "$SCRIPT_DIR/../assimpjs/emsdk" ]; then
    export EMSDK="$(cd "$SCRIPT_DIR/../assimpjs/emsdk" && pwd)"
  else
    echo "ERROR: EMSDK not found. Run scripts/setup-deps.sh or set EMSDK=" >&2
    exit 1
  fi
fi
source "$EMSDK/emsdk_env.sh" 2>/dev/null

# Project-local Python venv is the canonical interpreter for every build script.
# See docs/research/occt-v8-final-migration-stocktake.md (Python Toolchain Reshaping).
export OCJS_PYTHON="$SCRIPT_DIR/.venv/bin/python"
if [ ! -x "$OCJS_PYTHON" ]; then
  echo "ERROR: $OCJS_PYTHON not found. Run scripts/setup-deps.sh first." >&2
  exit 1
fi

export OCJS_ROOT="$SCRIPT_DIR"
export OCCT_ROOT="${OCCT_ROOT:-$(cd "$SCRIPT_DIR/deps/OCCT" 2>/dev/null && pwd || { cd "$SCRIPT_DIR/../OCCT" 2>/dev/null && pwd; } || echo "")}"
export RAPIDJSON_ROOT="${RAPIDJSON_ROOT:-$(cd "$SCRIPT_DIR/deps/rapidjson" 2>/dev/null && pwd || { cd "$SCRIPT_DIR/../rapidjson" 2>/dev/null && pwd; } || echo "$SCRIPT_DIR/rapidjson")}"
export FREETYPE_ROOT="${FREETYPE_ROOT:-$(cd "$SCRIPT_DIR/deps/freetype" 2>/dev/null && pwd || { cd "$SCRIPT_DIR/../freetype" 2>/dev/null && pwd; } || echo "$SCRIPT_DIR/freetype")}"

for dep_name in OCCT_ROOT RAPIDJSON_ROOT FREETYPE_ROOT; do
  dep_val="${!dep_name}"
  if [ -z "$dep_val" ] || [ ! -d "$dep_val" ]; then
    echo "ERROR: $dep_name not found at '$dep_val'" >&2
    exit 1
  fi
done

# ── Validate dependency commits against DEPS.json ────────────────────

DEPS_FILE="$SCRIPT_DIR/DEPS.json"
if [ -f "$DEPS_FILE" ]; then
  "$OCJS_PYTHON" -c "
import json, subprocess, os, sys
deps = json.load(open('$DEPS_FILE'))['dependencies']
checks = [
    ('occt',     os.environ.get('OCCT_ROOT', '')),
    ('rapidjson', os.environ.get('RAPIDJSON_ROOT', '')),
    ('freetype',  os.environ.get('FREETYPE_ROOT', '')),
]
warnings = []
for name, path in checks:
    if not path or not os.path.isdir(os.path.join(path, '.git')):
        continue
    expected = deps[name]['commit']
    actual = subprocess.check_output(['git', '-C', path, 'rev-parse', 'HEAD'], text=True).strip()
    if actual != expected:
        warnings.append(f'  {name}: expected {expected[:12]}, got {actual[:12]}')
if warnings:
    print('WARNING: Dependency commit mismatch (vs DEPS.json):', file=sys.stderr)
    for w in warnings:
        print(w, file=sys.stderr)
    if os.environ.get('OCJS_STRICT_DEPS', '') == '1':
        print('ERROR: --strict deps check failed. Set OCJS_STRICT_DEPS=0 to override.', file=sys.stderr)
        sys.exit(1)
" || true
fi

# ── Pre-scan for --config flag ────────────────────────────────────────

_prescan_args=("$@")
for (( _i=0; _i<${#_prescan_args[@]}; _i++ )); do
  if [ "${_prescan_args[$_i]}" = "--config" ] && [ $((_i+1)) -lt ${#_prescan_args[@]} ]; then
    export OCJS_CONFIG="${_prescan_args[$((_i+1))]}"
    break
  fi
done

if [ -n "${OCJS_CONFIG:-}" ]; then
  _CONFIG_FILE="$SCRIPT_DIR/build-configs/configurations.json"
  if [ ! -f "$_CONFIG_FILE" ]; then
    echo "ERROR: configurations.json not found at $_CONFIG_FILE" >&2
    exit 1
  fi
  echo "Loading configuration: $OCJS_CONFIG"
  eval "$("$OCJS_PYTHON" -c "
import json, sys
configs = json.load(open('$_CONFIG_FILE'))
name = '$OCJS_CONFIG'
if name not in configs:
    print(f'echo \"ERROR: Configuration \"{name}\" not found. Available: {\", \".join(configs.keys())}\" >&2; exit 1')
    sys.exit(0)
cfg = configs[name]
for key, val in cfg.items():
    print(f'export {key}=\"{val}\"')
")"
  echo ""
fi

# ── Build flags ──────────────────────────────────────────────────────

export OCJS_OPT="${OCJS_OPT:--O3}"
export OCJS_EXTRA_CFLAGS="${OCJS_EXTRA_CFLAGS:-}"
export OCJS_LTO="${OCJS_LTO:-0}"
export OCJS_EXCEPTIONS="${OCJS_EXCEPTIONS:-0}"
export OCJS_WASM_OPT_LEVEL="${OCJS_WASM_OPT_LEVEL:--O4}"
export OCJS_CLOSURE="${OCJS_CLOSURE:-false}"
export OCJS_EVAL_CTORS="${OCJS_EVAL_CTORS:-false}"
export OCJS_CONVERGE="${OCJS_CONVERGE:-false}"
export OCJS_DEFINES="${OCJS_DEFINES:-}"
export OCJS_UNDEFINES="${OCJS_UNDEFINES:-}"
export OCJS_PATCH_DUMP="${OCJS_PATCH_DUMP:-false}"
export OCJS_SIMD="${OCJS_SIMD:-0}"
export OCJS_RELAXED_SIMD="${OCJS_RELAXED_SIMD:-0}"
export OCJS_BIGINT="${OCJS_BIGINT:-0}"
export OCJS_MALLOC="${OCJS_MALLOC:-dlmalloc}"
export OCJS_FORCE_GENERATE="${OCJS_FORCE_GENERATE:-0}"
export THREADING="${THREADING:-single-threaded}"
export PYTHONPATH="$OCJS_ROOT/src:${PYTHONPATH:-}"
export BUILD_DIR="${BUILD_DIR:-$OCJS_ROOT/build}"
OCJS_OUTPUT_DIR="${OCJS_OUTPUT_DIR:-$OCJS_ROOT/dist}"
if [[ "$OCJS_OUTPUT_DIR" != /* ]]; then
  OCJS_OUTPUT_DIR="$OCJS_ROOT/$OCJS_OUTPUT_DIR"
fi
export OCJS_OUTPUT_DIR

# ── Print config ─────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         OpenCascade.js WASM Build                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  %-14s %s\n" "EMSDK:" "$EMSDK ║"
printf "║  %-14s %s\n" "Emscripten:" "$(emcc --version 2>/dev/null | head -1) ║"
printf "║  %-14s %s\n" "OCCT_ROOT:" "$OCCT_ROOT ║"
printf "║  %-14s %s\n" "OCJS_OPT:" "$OCJS_OPT ║"
if [ -n "$OCJS_EXTRA_CFLAGS" ]; then
printf "║  %-14s %s\n" "EXTRA_CFLAGS:" "$OCJS_EXTRA_CFLAGS ║"
fi
printf "║  %-14s %s\n" "OCJS_LTO:" "$OCJS_LTO ║"
printf "║  %-14s %s\n" "OCJS_EXCEPTIONS:" "$OCJS_EXCEPTIONS ║"
printf "║  %-14s %s\n" "OCJS_SIMD:" "$OCJS_SIMD ║"
printf "║  %-14s %s\n" "OCJS_RELAXED_SIMD:" "$OCJS_RELAXED_SIMD ║"
printf "║  %-14s %s\n" "THREADING:" "$THREADING ║"
printf "║  %-14s %s\n" "OCJS_MALLOC:" "$OCJS_MALLOC ║"
printf "║  %-14s %s\n" "wasm-opt:" "$OCJS_WASM_OPT_LEVEL ║"
printf "║  %-14s %s\n" "BUILD_DIR:" "$BUILD_DIR ║"
printf "║  %-14s %s\n" "OCJS_CONFIG:" "${OCJS_CONFIG:-<none>} ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

mkdir -p "$BUILD_DIR"/{bindings,sources}
mkdir -p "$OCJS_OUTPUT_DIR"

# ── Build flag validation ─────────────────────────────────────────────

validate_build_flags() {
  "$OCJS_PYTHON" -c "
import sys; sys.path.insert(0, 'src')
from Common import validate_build_flags, BuildFlagMismatch
try:
    validate_build_flags()
except BuildFlagMismatch as e:
    print(str(e), flush=True)
    sys.exit(1)
"
}

# ── Step functions ───────────────────────────────────────────────────

_ensure_standard_version_hxx() {
  local target="$OCCT_ROOT/src/FoundationClasses/TKernel/Standard/Standard_Version.hxx"
  local template="$OCCT_ROOT/adm/templates/Standard_Version.hxx.in"
  if [ -f "$target" ]; then
    return 0
  fi
  if [ ! -f "$template" ]; then
    echo "  WARNING: Standard_Version.hxx.in template not found" >&2
    return 0
  fi
  echo "  Generating Standard_Version.hxx from cmake template..."
  "$OCJS_PYTHON" -c "
import re
with open('$template') as f: c = f.read()
with open('$OCCT_ROOT/adm/cmake/version.cmake') as f: v = f.read()
major = re.search(r'OCC_VERSION_MAJOR\s+(\d+)', v).group(1)
minor = re.search(r'OCC_VERSION_MINOR\s+(\d+)', v).group(1)
maint = re.search(r'OCC_VERSION_MAINTENANCE\s+(\d+)', v).group(1)
c = c.replace('@OCC_VERSION_MAJOR@', major)
c = c.replace('@OCC_VERSION_MINOR@', minor)
c = c.replace('@OCC_VERSION_MAINTENANCE@', maint)
c = c.replace('@OCC_VERSION_DATE@', '2024-01-01')
c = c.replace('@SET_OCC_VERSION_DEVELOPMENT@', '#define OCC_VERSION_DEVELOPMENT \"dev\"')
with open('$target', 'w') as f: f.write(c)
print(f'  Generated Standard_Version.hxx (OCCT {major}.{minor}.{maint})')
"
}

step_pch() {
  echo "═══ Rebuilding flat includes + PCH ═══"
  _ensure_standard_version_hxx
  rm -f build/pch.h.pch build/pch.h
  rm -rf build/occt-includes
  "$OCJS_PYTHON" -c "
import sys; sys.path.insert(0, 'src')
from Common import buildFlatIncludes, buildPch
buildFlatIncludes()
buildPch(threading='$THREADING')
"
  echo ""
}

step_docs() {
  echo "═══ Generating OCCT documentation JSON ═══"
  _ensure_doxygen
  "$OCJS_PYTHON" src/extract-docs.py
  echo ""
}

step_generate() {
  echo "═══ Generating bindings from OCCT headers ═══"

  step_docs

  find "$OCJS_ROOT/src" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

  if [ "${OCJS_FORCE_GENERATE:-0}" = "1" ]; then
    echo "  Force regeneration: clearing existing .d.ts.json and .cpp files"
    local target="$OCJS_ROOT/build/bindings"
    [ -L "$target" ] && target="$(readlink -f "$target")"
    if [ -d "$target" ]; then
      find "$target" -name "*.d.ts.json" -delete 2>/dev/null || true
      find "$target" -name "*.cpp" ! -name "*.cpp.o" -delete 2>/dev/null || true
      rm -f "$OCJS_ROOT/build/bindings/.generator-hash" 2>/dev/null || true
    fi
  fi

  local config="${OCJS_BINDGEN_CONFIG:-$OCJS_ROOT/bindgen-filters.yaml}"
  if [ -f "$config" ]; then
    echo "  Using bindgen config: $config"
    export OCJS_BINDGEN_CONFIG="$config"
  fi
  "$OCJS_PYTHON" -m ocjs_bindgen --config "$config"
  echo ""
}

step_bindings() {
  echo "═══ Compiling bindings ═══"
  "$OCJS_PYTHON" src/compileBindings.py "$THREADING"
  echo ""
}

step_sources() {
  echo "═══ Compiling OCCT sources (CMake) ═══"
  step_sources_cmake
  echo ""
}

step_sources_legacy() {
  echo "═══ Compiling OCCT sources (legacy Python) ═══"
  "$OCJS_PYTHON" src/compileSources.py "$THREADING"
  echo ""
}

step_sources_cmake() {
  local cmake_build_dir="$OCJS_ROOT/build/occt-cmake"
  local lib_dir="$cmake_build_dir/lin32/clang/lib"

  if [ -d "$lib_dir" ] && [ "$(ls "$lib_dir"/*.a 2>/dev/null | wc -l)" -gt 0 ]; then
    echo "  CMake build directory exists with $(ls "$lib_dir"/*.a | wc -l | tr -d ' ') libraries, checking if rebuild needed..."
  fi

  local cmake_flags=(
    -DCMAKE_BUILD_TYPE=Release
    -DBUILD_LIBRARY_TYPE=Static
    -DBUILD_MODULE_FoundationClasses=ON
    -DBUILD_MODULE_ModelingData=ON
    -DBUILD_MODULE_ModelingAlgorithms=ON
    -DBUILD_MODULE_DataExchange=ON
    -DBUILD_MODULE_ApplicationFramework=ON
    -DBUILD_MODULE_Visualization=OFF
    -DBUILD_MODULE_Draw=OFF
    -DBUILD_DOC_Overview=OFF
    -DUSE_TCL=OFF
    -DUSE_TK=OFF
    -DUSE_RAPIDJSON=ON
    "-D3RDPARTY_RAPIDJSON_DIR=$RAPIDJSON_ROOT"
    "-D3RDPARTY_RAPIDJSON_INCLUDE_DIR=$RAPIDJSON_ROOT/include"
    "-D3RDPARTY_FREETYPE_DIR=$FREETYPE_ROOT"
    "-D3RDPARTY_FREETYPE_INCLUDE_DIR_freetype2=$FREETYPE_ROOT/include"
    "-D3RDPARTY_FREETYPE_INCLUDE_DIR_ft2build=$FREETYPE_ROOT/include"
  )

  local cflags="$OCJS_OPT -DIGNORE_NO_ATOMICS=1 -DOCCT_NO_PLUGINS -DHAVE_RAPIDJSON"
  local cxxflags="$cflags -frtti"

  if [ "$OCJS_LTO" = "1" ]; then
    cflags="$cflags -flto"
    cxxflags="$cxxflags -flto"
  fi

  if [ "$OCJS_EXCEPTIONS" = "1" ]; then
    if [ "${OCJS_EH_MODE:-wasm}" = "js" ]; then
      cxxflags="$cxxflags -fexceptions"
    else
      cxxflags="$cxxflags -fwasm-exceptions"
    fi
    cxxflags="$cxxflags -DOCJS_EXCEPTIONS_ENABLED=1"
  else
    cflags="$cflags -sSUPPORT_LONGJMP=0"
    cxxflags="$cxxflags -sSUPPORT_LONGJMP=0"
  fi

  if [ "$OCJS_SIMD" = "1" ]; then
    cflags="$cflags -msimd128"
    cxxflags="$cxxflags -msimd128"
    if [ "$OCJS_RELAXED_SIMD" = "1" ]; then
      cflags="$cflags -mrelaxed-simd"
      cxxflags="$cxxflags -mrelaxed-simd"
    fi
  fi

  if [ "$THREADING" = "multi-threaded" ]; then
    cflags="$cflags -pthread"
    cxxflags="$cxxflags -pthread"
  fi

  if [ -n "$OCJS_DEFINES" ]; then
    IFS=',' read -ra defines <<< "$OCJS_DEFINES"
    for d in "${defines[@]}"; do
      d="$(echo "$d" | xargs)"
      [ -n "$d" ] && cflags="$cflags -D$d" && cxxflags="$cxxflags -D$d"
    done
  fi
  if [ -n "$OCJS_UNDEFINES" ]; then
    IFS=',' read -ra undefines <<< "$OCJS_UNDEFINES"
    for u in "${undefines[@]}"; do
      u="$(echo "$u" | xargs)"
      [ -n "$u" ] && cflags="$cflags -U$u" && cxxflags="$cxxflags -U$u"
    done
  fi

  if [ -n "$OCJS_EXTRA_CFLAGS" ]; then
    cflags="$cflags $OCJS_EXTRA_CFLAGS"
    cxxflags="$cxxflags $OCJS_EXTRA_CFLAGS"
  fi

  cmake_flags+=(
    "-DCMAKE_C_FLAGS=$cflags"
    "-DCMAKE_CXX_FLAGS=$cxxflags"
  )

  if [ "$OCJS_EXCEPTIONS" != "1" ]; then
    cmake_flags+=(
      "-DCMAKE_C_FLAGS_RELEASE=-DNDEBUG -sDISABLE_EXCEPTION_CATCHING=1 -sSUPPORT_LONGJMP=0 -UOCC_CONVERT_SIGNALS"
      "-DCMAKE_CXX_FLAGS_RELEASE=-DNDEBUG -sDISABLE_EXCEPTION_CATCHING=1 -sSUPPORT_LONGJMP=0 -UOCC_CONVERT_SIGNALS"
    )
  fi

  echo "  Configuring OCCT via CMake..."
  emcmake cmake -B "$cmake_build_dir" \
    "${cmake_flags[@]}" \
    -Wno-dev \
    "$OCCT_ROOT" 2>&1 | tail -5

  local nproc
  nproc=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
  echo "  Building OCCT with $nproc parallel jobs..."
  cmake --build "$cmake_build_dir" -j"$nproc" 2>&1 | tail -5

  local lib_count
  lib_count=$(ls "$lib_dir"/*.a 2>/dev/null | wc -l | tr -d ' ')
  echo "  CMake produced $lib_count static libraries in $lib_dir"

  echo "$lib_dir" > "$OCJS_ROOT/build/.cmake-lib-dir"
}

step_dts() {
  local yaml="$1"
  if [ ! -f "$yaml" ]; then
    echo "ERROR: YAML config not found: $yaml" >&2
    exit 1
  fi
  local yaml_abs
  yaml_abs="$(cd "$(dirname "$yaml")" && pwd)/$(basename "$yaml")"
  echo "═══ Regenerating .d.ts from $yaml_abs (no compile/link) ═══"
  cd "$(dirname "$yaml_abs")"
  "$OCJS_PYTHON" "$OCJS_ROOT/src/buildFromYaml.py" --dts-only "$(basename "$yaml_abs")"
  cd "$SCRIPT_DIR"
  echo ""
}

step_link() {
  local yaml="$1"
  if [ ! -f "$yaml" ]; then
    echo "ERROR: YAML config not found: $yaml" >&2
    exit 1
  fi
  local yaml_abs
  yaml_abs="$(cd "$(dirname "$yaml")" && pwd)/$(basename "$yaml")"
  echo "═══ Linking WASM from $yaml_abs ═══"
  echo "  Output dir: $OCJS_OUTPUT_DIR"
  mkdir -p "$OCJS_OUTPUT_DIR"
  find "$OCJS_OUTPUT_DIR" -maxdepth 1 \( -name '*.wasm' -o -name '*.js' -o -name '*.d.ts' -o -name '*.js.symbols' -o -name '*.provenance.json' -o -name 'build-manifest.json' \) -delete 2>/dev/null || true
  cd "$OCJS_OUTPUT_DIR"
  "$OCJS_PYTHON" "$OCJS_ROOT/src/buildFromYaml.py" "$yaml_abs"
  cd "$SCRIPT_DIR"
  echo ""
}

step_apply_patches() {
  echo "═══ Applying OCCT source patches ═══"

  if [ -d "$OCCT_ROOT/.git" ]; then
    echo "  Reverting OCCT source tree to clean state..."
    git -C "$OCCT_ROOT" checkout -- . 2>/dev/null || true
  fi

  if [ "$OCJS_PATCH_DUMP" = "true" ]; then
    echo "  Applying Standard_Dump stub patch..."
    "$OCJS_PYTHON" src/patches/patch_standard_dump.py
    if [ "${OCJS_PATCH_STEPCAF:-true}" = "true" ]; then
      echo "  Applying noexcept destructors patch (7 classes)..."
      OCCT_ROOT="$OCJS_ROOT/deps/OCCT" "$OCJS_PYTHON" src/patches/patch_noexcept_destructors.py
      echo "  Applying STEPCAFControl_Controller DynamicType patch..."
      OCCT_ROOT="$OCJS_ROOT/deps/OCCT" "$OCJS_PYTHON" src/patches/patch_stepcaf_dyntype.py
    fi
    echo "  Applying BRepGraph_VersionStamp wasm32 size_t guard..."
    OCCT_ROOT="$OCJS_ROOT/deps/OCCT" "$OCJS_PYTHON" src/patches/patch_brepgraph_versionstamp.py
    echo "  All patches applied."
  else
    echo "  OCJS_PATCH_DUMP=false — no patches to apply (clean OCCT tree)."
  fi

  step_patch_embind

  echo "$(date +%s)" > "$BUILD_DIR/patches-applied"
  echo ""
}

step_patch_embind() {
  echo "═══ Patching emsdk libembind.js (type-based overload dispatch) ═══"

  local embind_dir="$EMSDK/upstream/emscripten"
  local embind_file="$embind_dir/src/lib/libembind.js"
  local patch_file="$OCJS_ROOT/src/patches/libembind-overloading.patch"

  if [ ! -f "$embind_file" ]; then
    echo "ERROR: libembind.js not found at $embind_file" >&2
    exit 1
  fi

  local emsdk_version
  emsdk_version="$(cat "$embind_dir/emscripten-version.txt" 2>/dev/null | tr -d '"' | tr -d '[:space:]')"
  if [ "$emsdk_version" != "5.0.1" ]; then
    echo "WARNING: libembind patch was created for emsdk 5.0.1 but found $emsdk_version" >&2
    echo "         The patch may fail or produce incorrect results." >&2
  fi

  local patch_hash_file="$BUILD_DIR/embind-patch-hash"
  local current_hash
  current_hash="$(md5sum "$patch_file" 2>/dev/null | cut -d' ' -f1 || md5 -q "$patch_file" 2>/dev/null)"

  if [ -f "$patch_hash_file" ] && [ "$(cat "$patch_hash_file")" = "$current_hash" ]; then
    echo "  libembind.js already patched (hash match) — skipping."
    return 0
  fi

  if [ -f "$patch_hash_file" ]; then
    echo "  Patch content changed — reverting and re-applying..."
    cd "$embind_dir" && patch -R -p0 --ignore-whitespace --no-backup-if-mismatch < "$patch_file" 2>/dev/null || true
  fi

  echo "  Applying libembind-overloading.patch..."
  cd "$embind_dir" || exit 1
  if patch -p0 -N --ignore-whitespace --no-backup-if-mismatch < "$patch_file"; then
    :
  else
    patch_status=$?
    # macOS patch exits 1 when all hunks are already applied (-N).
    if grep -q '$getSignature__deps' "$embind_file"; then
      echo "  libembind overload patch already present (skipping re-apply)."
    else
      echo "ERROR: libembind patch failed (exit $patch_status) and overload helpers missing" >&2
      exit 1
    fi
  fi
  echo "$current_hash" > "$patch_hash_file"
  echo "  libembind.js patched successfully."
  cd "$OCJS_ROOT" || exit 1
}

# (step_compile_all removed -- Nx manages task orchestration and caching)

# ── Parse commands ───────────────────────────────────────────────────

if [ $# -eq 0 ]; then
  echo "Usage: $0 <command> [<command>...] [<yaml-config>]"
  echo ""
  echo "Commands:"
  echo "  apply-patches    Apply OCCT source patches (idempotent)"
  echo "  pch              Rebuild flat includes + PCH"
  echo "  docs             Generate OCCT documentation JSON (for JSDoc)"
  echo "  generate         Generate binding .cpp files from OCCT headers"
  echo "  bindings         Compile bindings only"
  echo "  sources          Compile OCCT sources only"
  echo "  dts <yaml>       Regenerate .d.ts only from existing fragments (no compile/link)"
  echo "  link <yaml>      Link WASM binary from YAML config"
  echo "  full <yaml>      Full pipeline (apply-patches + pch + generate + bindings + sources + link)"
  echo "  clean-generated  Remove generated .d.ts.json and .cpp (handles symlinks)"
  echo "  clean-objects    Remove compiled .o files from compiled-bindings/ (handles symlinks)"
  exit 1
fi

YAML_CONFIG=""
COMMANDS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      show_help
      ;;
    --config)
      shift
      if [ $# -eq 0 ]; then
        echo "ERROR: --config requires a configuration name" >&2
        exit 1
      fi
      export OCJS_CONFIG="$1"
      shift
      ;;
    pch|docs|generate|bindings|sources|sources-legacy|apply-patches|patch-embind)
      COMMANDS+=("$1")
      shift
      ;;
    validate)
      COMMANDS+=("$1")
      shift
      if [ $# -eq 0 ]; then
        echo "ERROR: validate requires a YAML config path argument" >&2
        exit 1
      fi
      YAML_CONFIG="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
      shift
      ;;
    dts|link|full|provenance)
      COMMANDS+=("$1")
      shift
      if [ $# -eq 0 ]; then
        echo "ERROR: command requires a YAML config path argument" >&2
        exit 1
      fi
      YAML_CONFIG="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
      shift
      ;;
    *)
      if [ -f "$1" ] && [[ "$1" == *.yml ]]; then
        YAML_CONFIG="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
        shift
      else
        echo "ERROR: Unknown command or file: $1" >&2
        echo "Run './build-wasm.sh --help' for usage." >&2
        exit 1
      fi
      ;;
  esac
done

START_TIME=$(date +%s)

for cmd in "${COMMANDS[@]}"; do
  case "$cmd" in
    apply-patches) step_apply_patches ;;
    patch-embind) step_patch_embind ;;
    pch)       step_pch ;;
    docs)      step_docs ;;
    generate)  step_generate ;;
    bindings)  validate_build_flags && step_bindings ;;
    sources)   step_sources ;;
    sources-legacy) step_sources_legacy ;;
    dts)       step_dts "$YAML_CONFIG" ;;
    link)      validate_build_flags && step_link "$YAML_CONFIG" ;;
    validate)
      echo "═══ Validating YAML config: $YAML_CONFIG ═══"
      "$OCJS_PYTHON" -c "
import yaml, sys
sys.path.insert(0, '$OCJS_ROOT/src')
from cerberus import Validator
schema = eval(open('$OCJS_ROOT/src/customBuildSchema.py').read())
config = yaml.safe_load(open('$YAML_CONFIG'))
v = Validator(schema)
if v.validate(config, schema):
    normalized = v.normalized(config)
    bindings = normalized['mainBuild']['bindings']
    print(f'  Config valid: {len(bindings)} bindings')
    print(f'  Build name: {normalized["mainBuild"]["name"]}')
    print(f'  emccFlags: {len(normalized["mainBuild"].get("emccFlags", []))} flags')
    has_exc = any('-fexceptions' in f or '-fwasm-exceptions' in f for f in normalized['mainBuild'].get('emccFlags', []))
    print(f'  Exceptions: {"yes" if has_exc else "no"}')
else:
    print(f'  INVALID: {v.errors}', file=sys.stderr)
    sys.exit(1)
"
      echo ""
      ;;
    provenance)
      echo "═══ Generating build provenance ═══"
      "$OCJS_PYTHON" src/provenance.py init
      "$OCJS_PYTHON" src/provenance.py finalize --wasm-dir "$OCJS_OUTPUT_DIR" --yaml "${YAML_CONFIG:-}" --duration 0
      echo ""
      ;;
    full)
      step_apply_patches
      step_pch
      step_generate
      step_bindings
      step_sources_cmake
      step_link "$YAML_CONFIG"
      echo "═══ Post-build validation ═══"
      "$OCJS_PYTHON" "$OCJS_ROOT/scripts/validate-build.py" "$YAML_CONFIG" "$OCJS_OUTPUT_DIR" --build-dir "$BUILD_DIR" || true
      echo ""
      ;;
  esac
done

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

# ── Finalize provenance ──────────────────────────────────────────────

if [ -n "$YAML_CONFIG" ]; then
  "$OCJS_PYTHON" src/provenance.py finalize --wasm-dir "$OCJS_OUTPUT_DIR" --yaml "$YAML_CONFIG" --duration "$ELAPSED" 2>/dev/null || true
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                  Build Complete                         ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  %-14s %s\n" "Duration:" "${ELAPSED}s ║"
printf "║  %-14s %s\n" "Config:" "${OCJS_CONFIG:-<none>} ║"

if [ -n "$YAML_CONFIG" ]; then
  for wasm in "$OCJS_OUTPUT_DIR"/*.wasm; do
    if [ -f "$wasm" ]; then
      BASENAME="$(basename "$wasm")"
      SIZE=$(stat -f%z "$wasm" 2>/dev/null || stat -c%s "$wasm" 2>/dev/null || echo "0")
      SIZE_MB=$(echo "scale=2; $SIZE / 1048576" | bc 2>/dev/null || echo "?")
      GZIP_SIZE=$(gzip -c "$wasm" 2>/dev/null | wc -c | tr -d ' ')
      GZIP_MB=$(echo "scale=2; $GZIP_SIZE / 1048576" | bc 2>/dev/null || echo "?")
      printf "║  %-14s %s\n" "WASM:" "$BASENAME ($SIZE_MB MB, ${GZIP_MB} MB gzipped) ║"
    fi
  done
  for js in "$OCJS_OUTPUT_DIR"/*.js; do
    if [ -f "$js" ] && [[ "$js" != *.d.ts ]]; then
      SIZE=$(stat -f%z "$js" 2>/dev/null || stat -c%s "$js" 2>/dev/null || echo "0")
      SIZE_KB=$(echo "scale=1; $SIZE / 1024" | bc 2>/dev/null || echo "?")
      printf "║  %-14s %s\n" "JS:" "$(basename "$js") (${SIZE_KB} KB) ║"
    fi
  done
  for dts in "$OCJS_OUTPUT_DIR"/*.d.ts; do
    if [ -f "$dts" ]; then
      SIZE=$(stat -f%z "$dts" 2>/dev/null || stat -c%s "$dts" 2>/dev/null || echo "0")
      SIZE_KB=$(echo "scale=1; $SIZE / 1024" | bc 2>/dev/null || echo "?")
      printf "║  %-14s %s\n" "Types:" "$(basename "$dts") (${SIZE_KB} KB) ║"
    fi
  done
fi
echo "╚══════════════════════════════════════════════════════════╝"

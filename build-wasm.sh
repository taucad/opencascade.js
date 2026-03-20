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
#   ./build-wasm.sh cache-list            # List all cached compilations
#   ./build-wasm.sh cache-gc [max]        # Garbage collect old cache entries
#
# Environment overrides (all optional, sensible defaults provided):
#   EMSDK              Path to emsdk (default: ../assimpjs/emsdk)
#   OCCT_ROOT          Path to OCCT source (default: ../OCCT)
#   RAPIDJSON_ROOT     Path to rapidjson (default: ./rapidjson)
#   FREETYPE_ROOT      Path to freetype (default: ./freetype)
#   OCJS_OPT           Compile optimization level (default: -O2)
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
#   # List cached compilations
#   ./build-wasm.sh cache-list
# ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Help ─────────────────────────────────────────────────────────────

show_help() {
  cat << 'HELPEOF'
Usage: ./build-wasm.sh <command> [options] [<yaml-config>]

Commands:
  full <yaml>           Full pipeline: compile + link (uses cache)
  link <yaml>           Link only (reuses compiled .o files, fastest)
  pch                   Rebuild flat includes + precompiled header
  generate              Generate binding .cpp files from OCCT headers
  bindings              Compile bindings only
  sources               Compile OCCT sources only
  validate <yaml>       Validate YAML config without building
  clean-generated       Remove all generated .d.ts.json and .cpp files (handles symlinks)
  clean-objects         Remove all compiled .o files from bindings (handles symlinks)
  cache-list            List all cached compilations
  cache-gc [n]          Garbage collect old cache entries (keep n, default 5)

Options:
  --help                Show this help message
  --preset <name>       Apply a preset before building (e.g., O2-balanced, O3-maxperf, Os-minsize, O0-debug)

Environment Variables:
  EMSDK                 Path to Emscripten SDK (required for native builds)
  OCCT_ROOT             Path to OCCT source (default: ../OCCT)
  RAPIDJSON_ROOT        Path to rapidjson (default: ../rapidjson or ./rapidjson)
  FREETYPE_ROOT         Path to freetype (default: ../freetype or ./freetype)
  OCJS_OPT              Optimization level: -O0, -O2, -O3, -Os, -Oz (default: -O2)
  OCJS_LTO              Enable LTO: 0|1 (default: 1)
  OCJS_EXCEPTIONS       Native WASM exceptions: 0|1 (default: 0)
  THREADING             Threading mode: single-threaded|multi-threaded (default: single-threaded)
  OCJS_STRICT_DEPS      Fail on dependency commit mismatch: 0|1 (default: 0)
  OCJS_FORCE_GENERATE   Force regeneration of all bindings: 0|1 (default: 0)
  OCJS_FORCE_MISS       Force cache miss (bypass cache): 0|1 (default: 0)

Examples:
  # Default production build
  OCJS_LTO=0 ./build-wasm.sh full build-configs/full.yml

  # Quick rebuild after YAML changes
  ./build-wasm.sh link build-configs/full.yml

  # Use a preset
  ./build-wasm.sh --preset Os-minsize full build-configs/full.yml

  # Debug build (fastest compile)
  OCJS_OPT=-O0 OCJS_LTO=0 ./build-wasm.sh full build-configs/full.yml

  # Validate config without building
  ./build-wasm.sh validate build-configs/full.yml
HELPEOF
  exit 0
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  show_help
fi

# ── Handle cache commands before emsdk init ──────────────────────────

if [ "${1:-}" = "cache-list" ]; then
  export OCJS_ROOT="$SCRIPT_DIR"
  export OCCT_ROOT="${OCCT_ROOT:-$(cd "$SCRIPT_DIR/../OCCT" 2>/dev/null && pwd || echo "")}"
  export PYTHONPATH="$OCJS_ROOT/src:${PYTHONPATH:-}"
  python3 src/build-cache.py list
  exit 0
fi

if [ "${1:-}" = "cache-gc" ]; then
  export OCJS_ROOT="$SCRIPT_DIR"
  export OCCT_ROOT="${OCCT_ROOT:-$(cd "$SCRIPT_DIR/../OCCT" 2>/dev/null && pwd || echo "")}"
  export PYTHONPATH="$OCJS_ROOT/src:${PYTHONPATH:-}"
  python3 src/build-cache.py gc "${2:-5}"
  exit 0
fi

_resolve_symlink_target() {
  local path="$1"
  if [ -L "$path" ]; then
    readlink -f "$path" 2>/dev/null || readlink "$path"
  else
    echo "$path"
  fi
}

_ensure_doxygen() {
  local version
  version=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/DEPS.json'))['dependencies']['doxygen']['version'])" 2>/dev/null || echo "1.16.1")
  local tag
  tag=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/DEPS.json'))['dependencies']['doxygen']['release_tag'])" 2>/dev/null || echo "Release_1_16_1")
  local doxygen_bin="$SCRIPT_DIR/tools/doxygen/bin/doxygen"

  if [ -x "$doxygen_bin" ]; then
    local installed
    installed=$("$doxygen_bin" --version 2>/dev/null || echo "")
    if [ "$installed" = "$version" ]; then
      return 0
    fi
    echo "  Doxygen version mismatch ($installed != $version), re-downloading..."
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
    echo "  Doxygen $("$doxygen_bin" --version) installed at $doxygen_bin"
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
  echo "Cleaning compiled .o files from bindings..."
  target="$(_resolve_symlink_target "$SCRIPT_DIR/build/bindings")"
  if [ -d "$target" ]; then
    count=$(find "$target" -name "*.cpp.o" | wc -l | tr -d ' ')
    find "$target" -name "*.cpp.o" -delete 2>/dev/null || true
    echo "  Removed $count object files."
  else
    echo "  No build/bindings directory found."
  fi
  echo "Done. Run 'bindings' to recompile."
  exit 0
fi

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

# ── Validate dependency commits against DEPS.json ────────────────────

DEPS_FILE="$SCRIPT_DIR/DEPS.json"
if [ -f "$DEPS_FILE" ]; then
  python3 -c "
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

# ── Build flags ──────────────────────────────────────────────────────

export OCJS_OPT="${OCJS_OPT:--O2}"
export OCJS_LTO="${OCJS_LTO:-1}"
export OCJS_EXCEPTIONS="${OCJS_EXCEPTIONS:-0}"
export OCJS_WASM_OPT_LEVEL="${OCJS_WASM_OPT_LEVEL:--O3}"
export OCJS_CLOSURE="${OCJS_CLOSURE:-false}"
export OCJS_EVAL_CTORS="${OCJS_EVAL_CTORS:-false}"
export OCJS_CONVERGE="${OCJS_CONVERGE:-false}"
export OCJS_DEFINES="${OCJS_DEFINES:-}"
export OCJS_UNDEFINES="${OCJS_UNDEFINES:-}"
export OCJS_PATCH_DUMP="${OCJS_PATCH_DUMP:-false}"
export OCJS_SIMD="${OCJS_SIMD:-0}"
export OCJS_BIGINT="${OCJS_BIGINT:-0}"
export OCJS_FORCE_GENERATE="${OCJS_FORCE_GENERATE:-0}"
export OCJS_FORCE_MISS="${OCJS_FORCE_MISS:-0}"
export THREADING="${THREADING:-single-threaded}"
export PYTHONPATH="$OCJS_ROOT/src:${PYTHONPATH:-}"

# ── Print config ─────────────────────────────────────────────────────

CACHE_KEY=$(python3 src/build-cache.py compute-key)

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         OpenCascade.js WASM Build                       ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  %-14s %s\n" "EMSDK:" "$EMSDK ║"
printf "║  %-14s %s\n" "Emscripten:" "$(emcc --version 2>/dev/null | head -1) ║"
printf "║  %-14s %s\n" "OCCT_ROOT:" "$OCCT_ROOT ║"
printf "║  %-14s %s\n" "OCJS_OPT:" "$OCJS_OPT ║"
printf "║  %-14s %s\n" "OCJS_LTO:" "$OCJS_LTO ║"
printf "║  %-14s %s\n" "OCJS_EXCEPTIONS:" "$OCJS_EXCEPTIONS ║"
printf "║  %-14s %s\n" "THREADING:" "$THREADING ║"
printf "║  %-14s %s\n" "wasm-opt:" "$OCJS_WASM_OPT_LEVEL ║"
printf "║  %-14s %s\n" "cache-key:" "$CACHE_KEY ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Clean up dangling symlinks before mkdir (left over after cache GC)
for d in build/bindings build/sources build/occt-includes; do
  [ -L "$d" ] && [ ! -e "$d" ] && rm -f "$d"
done
mkdir -p build/{bindings,sources,dist}

# ── Provenance init (only for builds that produce output) ────────────

python3 src/provenance.py init 2>/dev/null || true

# ── Build flag validation ─────────────────────────────────────────────

validate_build_flags() {
  python3 -c "
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

step_pch() {
  echo "═══ Rebuilding flat includes + PCH ═══"
  rm -f build/pch.h.pch build/pch.h
  rm -rf build/occt-includes
  python3 -c "
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
  python3 src/extract-docs.py
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
  python3 -m ocjs_bindgen --config "$config"
  echo ""
}

step_bindings() {
  echo "═══ Compiling bindings ═══"
  python3 src/compileBindings.py "$THREADING"
  echo ""
}

step_sources() {
  echo "═══ Compiling OCCT sources (CMake) ═══"
  step_sources_cmake
  echo ""
}

step_sources_legacy() {
  echo "═══ Compiling OCCT sources (legacy Python) ═══"
  python3 src/compileSources.py "$THREADING"
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
    cflags="$cflags -msimd128 -mrelaxed-simd"
    cxxflags="$cxxflags -msimd128 -mrelaxed-simd"
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

  cmake_flags+=(
    "-DCMAKE_C_FLAGS=$cflags"
    "-DCMAKE_CXX_FLAGS=$cxxflags"
  )

  if [ "$OCJS_EXCEPTIONS" != "1" ]; then
    cmake_flags+=(
      "-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG -sDISABLE_EXCEPTION_CATCHING=1 -sSUPPORT_LONGJMP=0 -UOCC_CONVERT_SIGNALS"
      "-DCMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG -sDISABLE_EXCEPTION_CATCHING=1 -sSUPPORT_LONGJMP=0 -UOCC_CONVERT_SIGNALS"
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
  python3 "$OCJS_ROOT/src/buildFromYaml.py" --dts-only "$(basename "$yaml_abs")"
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
  cd "$(dirname "$yaml_abs")"
  python3 "$OCJS_ROOT/src/buildFromYaml.py" "$(basename "$yaml_abs")"
  cd "$SCRIPT_DIR"
  echo ""
}

step_compile_all() {
  local cache_key="$1"

  if [ "$OCJS_FORCE_MISS" = "1" ]; then
    echo "═══ Forced cache miss (OCJS_FORCE_MISS=1) ═══"
    local cache_entry="$OCJS_ROOT/cache/$cache_key"
    rm -f "$cache_entry/.complete" 2>/dev/null || true
    echo ""
  fi

  # setup symlinks build/ → cache/<key>/, returns 0 on hit, 1 on miss
  if python3 src/build-cache.py setup "$cache_key"; then
    echo "═══ Cache hit: $cache_key ═══"
    python3 src/provenance.py add-compilation --cache-hit
    echo ""
  else
    echo "═══ Cache miss: $cache_key — compiling from scratch ═══"
    echo ""

    local compile_start
    compile_start=$(date +%s)

    if [ "$OCJS_PATCH_DUMP" = "true" ]; then
      echo "=== Patching OCCT Standard_Dump.hxx ==="
      python3 src/patches/patch_standard_dump.py
    fi

    step_pch
    step_generate
    step_bindings
    step_sources_cmake

    local compile_end
    compile_end=$(date +%s)
    local compile_elapsed=$((compile_end - compile_start))

    python3 src/provenance.py add-compilation --duration "$compile_elapsed"
    python3 src/build-cache.py finalize "$cache_key"
  fi
}

# ── Parse commands ───────────────────────────────────────────────────

if [ $# -eq 0 ]; then
  echo "Usage: $0 <command> [<command>...] [<yaml-config>]"
  echo ""
  echo "Commands:"
  echo "  pch              Rebuild flat includes + PCH"
  echo "  docs             Generate OCCT documentation JSON (for JSDoc)"
  echo "  generate         Generate binding .cpp files from OCCT headers"
  echo "  bindings         Compile bindings only"
  echo "  sources          Compile OCCT sources only"
  echo "  dts <yaml>       Regenerate .d.ts only from existing fragments (no compile/link)"
  echo "  link <yaml>      Link WASM binary from YAML config"
  echo "  full <yaml>      Full pipeline with cache (pch + generate + bindings + sources + link)"
  echo "  clean-generated  Remove generated .d.ts.json and .cpp (handles symlinks)"
  echo "  clean-objects    Remove compiled .o files from bindings (handles symlinks)"
  echo "  cache-list       List all cached compilations"
  echo "  cache-gc [n]     Garbage collect old cache entries (keep n, default 5)"
  exit 1
fi

YAML_CONFIG=""
COMMANDS=()
PRESET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h)
      show_help
      ;;
    --preset)
      shift
      if [ $# -eq 0 ]; then
        echo "ERROR: --preset requires a name (e.g., O2-balanced)" >&2
        exit 1
      fi
      PRESET="$1"
      shift
      ;;
    pch|docs|generate|bindings|sources|sources-legacy)
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
    dts|link|full)
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

# ── Apply preset if specified ────────────────────────────────────────

if [ -n "$PRESET" ]; then
  PRESET_FILE="$SCRIPT_DIR/build-configs/presets/${PRESET}.yml"
  if [ ! -f "$PRESET_FILE" ]; then
    echo "ERROR: Preset '$PRESET' not found at $PRESET_FILE" >&2
    echo "" >&2
    echo "Available presets:" >&2
    for p in "$SCRIPT_DIR/build-configs/presets/"*.yml; do
      [ -f "$p" ] && echo "  $(basename "$p" .yml)" >&2
    done
    exit 1
  fi
  echo "Applying preset: $PRESET ($PRESET_FILE)"
  eval "$(python3 -c "
import yaml, sys
with open('$PRESET_FILE') as f:
    p = yaml.safe_load(f)
c = p.get('compilation', {})
if 'optimization' in c: print(f'export OCJS_OPT="{c["optimization"]}"')
if 'lto' in c: print(f'export OCJS_LTO={"1" if c["lto"] else "0"}')
if 'exceptions' in c: print(f'export OCJS_EXCEPTIONS={"1" if c["exceptions"] == "wasm-native" else "0"}')
if 'threading' in c: print(f'export THREADING="{c["threading"]}"')
defines = c.get('defines', [])
if defines: print(f'export OCJS_DEFINES="{",".join(defines)}"')
undefines = c.get('undefines', [])
if undefines: print(f'export OCJS_UNDEFINES="{",".join(undefines)}"')
l = p.get('linking', {})
if 'wasmOptLevel' in l: print(f'export OCJS_WASM_OPT_LEVEL="{l["wasmOptLevel"]}"')
o = p.get('optimizations', {})
if 'closure' in o: print(f'export OCJS_CLOSURE={"true" if o["closure"] else "false"}')
if 'evalCtors' in o: print(f'export OCJS_EVAL_CTORS={"true" if o["evalCtors"] else "false"}')
if 'converge' in o: print(f'export OCJS_CONVERGE={"true" if o["converge"] else "false"}')
if 'patchDump' in o: print(f'export OCJS_PATCH_DUMP={"true" if o["patchDump"] else "false"}')
")"
  echo ""
fi

START_TIME=$(date +%s)

for cmd in "${COMMANDS[@]}"; do
  case "$cmd" in
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
      python3 -c "
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
    full)
      step_compile_all "$CACHE_KEY"
      step_link "$YAML_CONFIG"
      echo "═══ Post-build validation ═══"
      python3 "$OCJS_ROOT/scripts/validate-build.py" "$YAML_CONFIG" "$(dirname "$YAML_CONFIG")" --build-dir "$OCJS_ROOT/build" || true
      echo ""
      ;;
  esac
done

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

# ── Finalize provenance ──────────────────────────────────────────────

if [ -n "$YAML_CONFIG" ]; then
  WASM_DIR="$(dirname "$YAML_CONFIG")"
  python3 src/provenance.py finalize --wasm-dir "$WASM_DIR" --duration "$ELAPSED"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                  Build Complete                         ║"
echo "╠══════════════════════════════════════════════════════════╣"
printf "║  %-14s %s\n" "Duration:" "${ELAPSED}s ║"

if [ -n "$YAML_CONFIG" ]; then
  WASM_DIR="$(dirname "$YAML_CONFIG")"
  for wasm in "$WASM_DIR"/*.wasm; do
    if [ -f "$wasm" ]; then
      BASENAME="$(basename "$wasm")"
      SIZE=$(stat -f%z "$wasm" 2>/dev/null || stat -c%s "$wasm" 2>/dev/null || echo "0")
      SIZE_MB=$(echo "scale=2; $SIZE / 1048576" | bc 2>/dev/null || echo "?")
      GZIP_SIZE=$(gzip -c "$wasm" 2>/dev/null | wc -c | tr -d ' ')
      GZIP_MB=$(echo "scale=2; $GZIP_SIZE / 1048576" | bc 2>/dev/null || echo "?")
      printf "║  %-14s %s\n" "WASM:" "$BASENAME ($SIZE_MB MB, ${GZIP_MB} MB gzipped) ║"
    fi
  done
  for js in "$WASM_DIR"/*.js; do
    if [ -f "$js" ] && [[ "$js" != *.d.ts ]]; then
      SIZE=$(stat -f%z "$js" 2>/dev/null || stat -c%s "$js" 2>/dev/null || echo "0")
      SIZE_KB=$(echo "scale=1; $SIZE / 1024" | bc 2>/dev/null || echo "?")
      printf "║  %-14s %s\n" "JS:" "$(basename "$js") (${SIZE_KB} KB) ║"
    fi
  done
  for dts in "$WASM_DIR"/*.d.ts; do
    if [ -f "$dts" ]; then
      SIZE=$(stat -f%z "$dts" 2>/dev/null || stat -c%s "$dts" 2>/dev/null || echo "0")
      SIZE_KB=$(echo "scale=1; $SIZE / 1024" | bc 2>/dev/null || echo "?")
      printf "║  %-14s %s\n" "Types:" "$(basename "$dts") (${SIZE_KB} KB) ║"
    fi
  done
  printf "║  %-14s %s\n" "Cache key:" "$CACHE_KEY ║"
fi
echo "╚══════════════════════════════════════════════════════════╝"

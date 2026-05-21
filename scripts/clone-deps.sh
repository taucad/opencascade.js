#!/usr/bin/env bash
# clone-deps.sh — single entry point for cloning + activating every host-side
# dependency the opencascade.js build needs:
#
#   - OCCT, rapidjson, freetype  → git clone + checkout at DEPS.json commits
#   - emsdk                       → git clone + install + activate
#   - Python virtualenv (.venv)   → created from requirements.txt
#
# Idempotent: re-running the script on an already-prepared tree fast-paths
# every step (no clones, no installs).
#
# Usage:
#   scripts/clone-deps.sh                      # default: clone into deps/
#   scripts/clone-deps.sh --dest deps          # explicit equivalent
#   scripts/clone-deps.sh --dest ..            # legacy sibling layout
#
# OCJS_STRICT_DEPS=1 fails fast if any cloned dep is not at its DEPS.json pin.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPS_FILE="$REPO_ROOT/DEPS.json"

DEST_REL="deps"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dest) DEST_REL="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$DEPS_FILE" ]; then
  echo "ERROR: DEPS.json not found at $DEPS_FILE" >&2
  exit 1
fi

# Resolve DEST to absolute path relative to repo root.
case "$DEST_REL" in
  /*) DEST_DIR="$DEST_REL" ;;
  *)  DEST_DIR="$REPO_ROOT/$DEST_REL" ;;
esac
mkdir -p "$DEST_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required to parse DEPS.json" >&2
  exit 1
fi

read_dep() {
  python3 -c "
import json
deps = json.load(open('$DEPS_FILE'))['dependencies']
print(deps['$1'].get('$2', ''))
"
}

clone_or_checkout() {
  local name="$1"
  local repo="$2"
  local commit="$3"
  local target="$DEST_DIR/$name"

  if [ ! -d "$target/.git" ]; then
    echo "Cloning $name from $repo..."
    git clone --quiet "$repo" "$target"
  fi

  local current
  current="$(git -C "$target" rev-parse HEAD)"
  if [ "$current" != "$commit" ]; then
    echo "Checking out $name at $commit..."
    git -C "$target" fetch --quiet origin
    git -C "$target" checkout --quiet "$commit"
  else
    echo "$name already at $commit"
  fi
}

# ── 1. Source dependencies ──────────────────────────────────────────────────
clone_or_checkout "OCCT"      "$(read_dep occt repository)"      "$(read_dep occt commit)"
clone_or_checkout "rapidjson" "$(read_dep rapidjson repository)" "$(read_dep rapidjson commit)"
clone_or_checkout "freetype"  "$(read_dep freetype repository)"  "$(read_dep freetype commit)"

# ── 2. Emscripten SDK ───────────────────────────────────────────────────────
EMSDK_REPO=$(read_dep emscripten repository)
EMSDK_VERSION=$(read_dep emscripten emsdk_version)
EMSDK_DIR="$DEST_DIR/emsdk"

# Skip clone when an emsdk script is already present. This covers both the
# host case (a previous clone-deps run populated deps/emsdk/.git) and the
# Docker case (the emscripten/emsdk base image ships /emsdk with the `emsdk`
# script but typically strips the .git directory for image-size reasons).
if [ ! -x "$EMSDK_DIR/emsdk" ]; then
  echo "Cloning emsdk from $EMSDK_REPO..."
  git clone --quiet "$EMSDK_REPO" "$EMSDK_DIR"
fi

if ! "$EMSDK_DIR/emsdk" list 2>/dev/null | grep -q "$EMSDK_VERSION.*INSTALLED"; then
  echo "Installing emsdk $EMSDK_VERSION..."
  "$EMSDK_DIR/emsdk" install "$EMSDK_VERSION"
fi

echo "Activating emsdk $EMSDK_VERSION..."
"$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION"

# ── 3. Python virtualenv ────────────────────────────────────────────────────
# Project-local venv pinned to 3.14 for OCCT V8 bindgen toolchain
# (Python Toolchain Reshaping).
VENV_DIR="$REPO_ROOT/.venv"
REQUIRED_PYTHON_MINOR="3.14"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  if command -v uv >/dev/null 2>&1; then
    echo "Creating project-local venv at $VENV_DIR (Python $REQUIRED_PYTHON_MINOR via uv)..."
    uv venv --python "${REQUIRED_PYTHON_MINOR}" "$VENV_DIR"
  else
    BOOTSTRAP_PY="$(command -v "python${REQUIRED_PYTHON_MINOR}" || true)"
    if [ -z "$BOOTSTRAP_PY" ]; then
      cat >&2 <<EOF
ERROR: python${REQUIRED_PYTHON_MINOR} not found on PATH and 'uv' is not installed.

The opencascade.js build pins its Python toolchain to ${REQUIRED_PYTHON_MINOR}.
Install one of:

  Any OS (uv — recommended):  https://docs.astral.sh/uv/getting-started/installation/
                              uv python install ${REQUIRED_PYTHON_MINOR}
  macOS (Homebrew):           brew install python@${REQUIRED_PYTHON_MINOR}
  Any OS (pyenv):             pyenv install ${REQUIRED_PYTHON_MINOR}

Then re-run scripts/clone-deps.sh.
EOF
      exit 1
    fi
    echo "Creating project-local venv at $VENV_DIR (Python $REQUIRED_PYTHON_MINOR)..."
    if ! "$BOOTSTRAP_PY" -m venv "$VENV_DIR"; then
      cat >&2 <<EOF
ERROR: python -m venv failed (common on macOS when ensurepip/pyexpat is broken).

Install uv and re-run clone-deps (uv downloads a portable CPython wheel):

  curl -LsSf https://astral.sh/uv/install.sh | sh
  uv python install ${REQUIRED_PYTHON_MINOR}

Or use pyenv-installed Python 3.14 instead of Homebrew python@3.14.
EOF
      exit 1
    fi
  fi
fi

echo "Installing Python build requirements (libclang, cerberus, pyyaml)..."
if command -v uv >/dev/null 2>&1; then
  uv pip install --python "$VENV_DIR/bin/python" --upgrade pip setuptools wheel
  uv pip install --python "$VENV_DIR/bin/python" -r "$REPO_ROOT/requirements.txt"
else
  "$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip setuptools wheel
  "$VENV_DIR/bin/python" -m pip install --quiet -r "$REPO_ROOT/requirements.txt"
fi

# ── 4. Vendored LLVM 17 toolchain ───────────────────────────────────────────
# Parse-side libc++/clang headers paired with pip libclang==18.1.1 (N-1 compat
# window per libc++ support policy). Routes the discover pass through a stdlib
# the bundled libclang can fully understand, sidestepping the libclang 18 ↔
# emsdk clang 23 version skew that causes class-body parse failures.
# Vendored LLVM 17 libc++ required for libclang 18.1.1 parse pass.

LLVM17_DIR="$DEST_DIR/llvm-17"

if [ ! -d "$LLVM17_DIR" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  LLVM17_PLATFORM="darwin-arm64" ;;
    Linux-x86_64)  LLVM17_PLATFORM="linux-x86_64" ;;
    Linux-aarch64) LLVM17_PLATFORM="linux-aarch64" ;;
    *)
      cat >&2 <<EOF
ERROR: Vendored LLVM 17 has no prebuilt tarball for $(uname -s)-$(uname -m).
Supported platforms: darwin-arm64, linux-x86_64, linux-aarch64.

Either add a sha256-pinned tarball for this platform to DEPS.json under
dependencies.llvm17.platforms, or run the build on one of the supported
host architectures.
EOF
      exit 1
      ;;
  esac

  LLVM17_VERSION=$(read_dep llvm17 version)
  LLVM17_BASE_URL=$(read_dep llvm17 base_url)
  LLVM17_FILENAME="$(python3 -c "
import json
deps = json.load(open('$DEPS_FILE'))['dependencies']
print(deps['llvm17']['platforms']['$LLVM17_PLATFORM']['filename'])
")"
  LLVM17_SHA256="$(python3 -c "
import json
deps = json.load(open('$DEPS_FILE'))['dependencies']
print(deps['llvm17']['platforms']['$LLVM17_PLATFORM']['sha256'])
")"

  LLVM17_URL="$LLVM17_BASE_URL/$LLVM17_FILENAME"
  LLVM17_TMP="$(mktemp -t llvm17.XXXXXX.tar.xz)"
  trap 'rm -f "$LLVM17_TMP"' EXIT

  echo "Downloading LLVM $LLVM17_VERSION ($LLVM17_PLATFORM, $LLVM17_FILENAME)..."
  if ! curl -fsSL --retry 3 -o "$LLVM17_TMP" "$LLVM17_URL"; then
    echo "ERROR: failed to download $LLVM17_URL" >&2
    exit 1
  fi

  if command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA="$(shasum -a 256 "$LLVM17_TMP" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA="$(sha256sum "$LLVM17_TMP" | awk '{print $1}')"
  else
    echo "ERROR: neither shasum nor sha256sum is available for verification" >&2
    exit 1
  fi

  if [ "$ACTUAL_SHA" != "$LLVM17_SHA256" ]; then
    cat >&2 <<EOF
ERROR: LLVM 17 tarball sha256 mismatch.
  url:      $LLVM17_URL
  expected: $LLVM17_SHA256
  actual:   $ACTUAL_SHA

Refusing to extract a tarball whose bytes do not match the pinned hash in
DEPS.json. If LLVM has legitimately republished the tarball, update the
sha256 in DEPS.json after verifying the new bytes against an independent
source (e.g. the LLVM release announcement).
EOF
    exit 1
  fi

  echo "Extracting LLVM $LLVM17_VERSION to $LLVM17_DIR..."
  rm -rf "$LLVM17_DIR.tmp"
  mkdir -p "$LLVM17_DIR.tmp"
  if ! tar -xJf "$LLVM17_TMP" --strip-components=1 -C "$LLVM17_DIR.tmp"; then
    echo "ERROR: failed to extract $LLVM17_TMP" >&2
    rm -rf "$LLVM17_DIR.tmp"
    exit 1
  fi
  mv "$LLVM17_DIR.tmp" "$LLVM17_DIR"

  if [ "$(uname -s)" = "Darwin" ]; then
    xattr -dr com.apple.quarantine "$LLVM17_DIR" 2>/dev/null || true
  fi
else
  echo "LLVM 17 already vendored at $LLVM17_DIR"
fi

# ── 5. Optional strict-commit gate ──────────────────────────────────────────
if [ "${OCJS_STRICT_DEPS:-0}" = "1" ]; then
  echo "Validating dependency commits..."
  "$VENV_DIR/bin/python" -c "
import json, subprocess, os, sys
deps = json.load(open('$DEPS_FILE'))['dependencies']
checks = [
    ('occt',     '$DEST_DIR/OCCT'),
    ('rapidjson', '$DEST_DIR/rapidjson'),
    ('freetype',  '$DEST_DIR/freetype'),
]
errors = []
for name, path in checks:
    if not os.path.isdir(os.path.join(path, '.git')):
        errors.append(f'  {name}: not a git repo at {path}')
        continue
    expected = deps[name]['commit']
    actual = subprocess.check_output(['git', '-C', path, 'rev-parse', 'HEAD'], text=True).strip()
    if actual != expected:
        errors.append(f'  {name}: expected {expected[:12]}, got {actual[:12]}')
if errors:
    print('ERROR: Dependency commit mismatch:', file=sys.stderr)
    for e in errors:
        print(e, file=sys.stderr)
    sys.exit(1)
"
fi

echo "All dependencies ready in $DEST_DIR"

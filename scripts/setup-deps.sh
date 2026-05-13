#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPS_FILE="$REPO_ROOT/DEPS.json"
DEPS_DIR="$REPO_ROOT/deps"

if [ ! -f "$DEPS_FILE" ]; then
  echo "ERROR: DEPS.json not found at $DEPS_FILE" >&2
  exit 1
fi

mkdir -p "$DEPS_DIR"

clone_or_checkout() {
  local name="$1"
  local repo="$2"
  local commit="$3"
  local target="$DEPS_DIR/$name"

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

read_dep() {
  python3 -c "
import json, sys
deps = json.load(open('$DEPS_FILE'))['dependencies']
dep = deps['$1']
print(dep.get('$2', ''))
"
}

OCCT_REPO=$(read_dep occt repository)
OCCT_COMMIT=$(read_dep occt commit)
clone_or_checkout "OCCT" "$OCCT_REPO" "$OCCT_COMMIT"

RAPIDJSON_REPO=$(read_dep rapidjson repository)
RAPIDJSON_COMMIT=$(read_dep rapidjson commit)
clone_or_checkout "rapidjson" "$RAPIDJSON_REPO" "$RAPIDJSON_COMMIT"

FREETYPE_REPO=$(read_dep freetype repository)
FREETYPE_COMMIT=$(read_dep freetype commit)
clone_or_checkout "freetype" "$FREETYPE_REPO" "$FREETYPE_COMMIT"

EMSDK_REPO=$(read_dep emscripten repository)
EMSDK_VERSION=$(read_dep emscripten emsdk_version)
EMSDK_DIR="$DEPS_DIR/emsdk"

if [ ! -d "$EMSDK_DIR/.git" ]; then
  echo "Cloning emsdk from $EMSDK_REPO..."
  git clone --quiet "$EMSDK_REPO" "$EMSDK_DIR"
fi

if ! "$EMSDK_DIR/emsdk" list 2>/dev/null | grep -q "$EMSDK_VERSION.*INSTALLED"; then
  echo "Installing emsdk $EMSDK_VERSION..."
  "$EMSDK_DIR/emsdk" install "$EMSDK_VERSION"
fi

echo "Activating emsdk $EMSDK_VERSION..."
"$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION"

# Project-local Python virtualenv: pinned to 3.14, populated from requirements.txt.
# Provides a reproducible interpreter across macOS / Linux / Docker / CI without
# coupling to the operator's system python3 or emsdk's bundled CPython.
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

Then re-run scripts/setup-deps.sh.
EOF
      exit 1
    fi
    echo "Creating project-local venv at $VENV_DIR (Python $REQUIRED_PYTHON_MINOR)..."
    if ! "$BOOTSTRAP_PY" -m venv "$VENV_DIR"; then
      cat >&2 <<EOF
ERROR: python -m venv failed (common on macOS when ensurepip/pyexpat is broken).

Install uv and re-run setup-deps (uv downloads a portable CPython wheel):

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

if [ "${OCJS_STRICT_DEPS:-0}" = "1" ]; then
  echo "Validating dependency commits..."
  "$VENV_DIR/bin/python" -c "
import json, subprocess, os, sys
deps = json.load(open('$DEPS_FILE'))['dependencies']
checks = [
    ('occt',     '$DEPS_DIR/OCCT'),
    ('rapidjson', '$DEPS_DIR/rapidjson'),
    ('freetype',  '$DEPS_DIR/freetype'),
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

echo "All dependencies ready in $DEPS_DIR"

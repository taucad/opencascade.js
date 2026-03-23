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

if [ "${OCJS_STRICT_DEPS:-0}" = "1" ]; then
  echo "Validating dependency commits..."
  python3 -c "
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

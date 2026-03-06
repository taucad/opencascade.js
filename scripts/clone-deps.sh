#!/bin/bash
set -euo pipefail

# Clone all dependencies at their pinned commits from DEPS.json.
# Repos are cloned as siblings of the opencascade.js directory.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OCJS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT_DIR="$(cd "$OCJS_DIR/.." && pwd)"
DEPS_FILE="$OCJS_DIR/DEPS.json"

if [ ! -f "$DEPS_FILE" ]; then
  echo "ERROR: DEPS.json not found at $DEPS_FILE" >&2
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required to parse DEPS.json" >&2
  exit 1
fi

clone_at_commit() {
  local name="$1"
  local repo="$2"
  local commit="$3"
  local target="$PARENT_DIR/$name"

  if [ -d "$target/.git" ]; then
    local current
    current=$(cd "$target" && git rev-parse HEAD)
    if [ "$current" = "$commit" ]; then
      echo "  $name: already at $commit"
      return 0
    fi
    echo "  $name: fetching $commit (currently at ${current:0:12})"
    cd "$target"
    git fetch origin "$commit" --depth 1 2>/dev/null || git fetch origin --depth 50
    git checkout "$commit"
    cd "$OCJS_DIR"
  else
    echo "  $name: cloning $repo"
    git clone "$repo" "$target"
    cd "$target"
    git checkout "$commit"
    cd "$OCJS_DIR"
  fi
}

echo "Cloning dependencies from DEPS.json into $PARENT_DIR/"
echo ""

OCCT_REPO=$(python3 -c "import json; d=json.load(open('$DEPS_FILE')); print(d['dependencies']['occt']['repository'])")
OCCT_COMMIT=$(python3 -c "import json; d=json.load(open('$DEPS_FILE')); print(d['dependencies']['occt']['commit'])")
clone_at_commit "OCCT" "$OCCT_REPO" "$OCCT_COMMIT"

RJ_REPO=$(python3 -c "import json; d=json.load(open('$DEPS_FILE')); print(d['dependencies']['rapidjson']['repository'])")
RJ_COMMIT=$(python3 -c "import json; d=json.load(open('$DEPS_FILE')); print(d['dependencies']['rapidjson']['commit'])")
clone_at_commit "rapidjson" "$RJ_REPO" "$RJ_COMMIT"

FT_REPO=$(python3 -c "import json; d=json.load(open('$DEPS_FILE')); print(d['dependencies']['freetype']['repository'])")
FT_COMMIT=$(python3 -c "import json; d=json.load(open('$DEPS_FILE')); print(d['dependencies']['freetype']['commit'])")
clone_at_commit "freetype" "$FT_REPO" "$FT_COMMIT"

echo ""
echo "All dependencies cloned at pinned commits."
echo ""
echo "Next: install Emscripten SDK:"
EMSDK_VER=$(python3 -c "import json; d=json.load(open('$DEPS_FILE')); print(d['dependencies']['emscripten']['emsdk_version'])")
echo "  git clone https://github.com/emscripten-core/emsdk.git ../emsdk"
echo "  cd ../emsdk && ./emsdk install $EMSDK_VER && ./emsdk activate $EMSDK_VER"
echo "  source ../emsdk/emsdk_env.sh"

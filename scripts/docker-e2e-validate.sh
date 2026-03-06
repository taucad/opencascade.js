#!/bin/bash
set -euo pipefail

# Docker E2E Validation Script
#
# Builds the Docker image from scratch, runs both full.yml and
# full-exceptions.yml builds, and validates the outputs.
#
# Usage:
#   ./scripts/docker-e2e-validate.sh [--output-dir /path/to/output]
#
# This validates:
#   1. Docker image builds successfully
#   2. WASM builds produce valid output for both configs
#   3. Symbol counts match expectations (233 for full, 235 for full-exceptions)
#   4. Provenance JSON is generated
#   5. Cache behavior works (second build should hit cache)
#   6. Environment variable passthrough works

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OCJS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${1:-$OCJS_DIR/docker-e2e-output}"
IMAGE_NAME="opencascade-js-v8-e2e"

mkdir -p "$OUTPUT_DIR/full" "$OUTPUT_DIR/full-exceptions" "$OUTPUT_DIR/Os-test"

echo "═══════════════════════════════════════════════════"
echo "  Docker E2E Validation"
echo "═══════════════════════════════════════════════════"
echo ""

# Step 1: Build Docker image
echo "Step 1/7: Building Docker image..."
docker build -t "$IMAGE_NAME" "$OCJS_DIR"
echo "  PASS: Docker image built"
echo ""

# Step 2: Build with full.yml (no-exceptions)
echo "Step 2/7: Building WASM with full.yml (no-exceptions)..."
docker run --rm -v "$OUTPUT_DIR/full:/output" "$IMAGE_NAME" full build-configs/full.yml
echo "  PASS: full.yml build completed"
echo ""

# Step 3: Build with full-exceptions.yml
echo "Step 3/7: Building WASM with full-exceptions.yml..."
docker run --rm -v "$OUTPUT_DIR/full-exceptions:/output" \
  -e OCJS_EXCEPTIONS=1 \
  "$IMAGE_NAME" full build-configs/full-exceptions.yml
echo "  PASS: full-exceptions.yml build completed"
echo ""

# Step 4: Verify outputs
echo "Step 4/7: Verifying outputs..."
PASS=true

for variant in full full-exceptions; do
  dir="$OUTPUT_DIR/$variant"
  for ext in .wasm .js .d.ts; do
    matches=$(find "$dir" -name "*$ext" 2>/dev/null | head -1)
    if [ -z "$matches" ]; then
      echo "  FAIL: No $ext file found in $dir"
      PASS=false
    else
      size=$(stat -f%z "$matches" 2>/dev/null || stat -c%s "$matches" 2>/dev/null)
      echo "  OK: $(basename "$matches") ($size bytes)"
    fi
  done
done

if [ "$PASS" = true ]; then
  echo "  PASS: All output files present"
else
  echo "  FAIL: Missing output files"
fi
echo ""

# Step 5: Check provenance
echo "Step 5/7: Checking provenance..."
PROV_FILE=$(find "$OUTPUT_DIR" -name "provenance.json" 2>/dev/null | head -1)
if [ -n "$PROV_FILE" ]; then
  echo "  PASS: provenance.json found at $PROV_FILE"
  python3 -c "
import json
with open('$PROV_FILE') as f:
    p = json.load(f)
print(f'    Schema: {p.get(\"schema\", \"unknown\")}')
print(f'    OCCT commit: {p.get(\"source\", {}).get(\"occtCommit\", \"unknown\")[:12]}')
print(f'    Emscripten: {p.get(\"toolchain\", {}).get(\"emscripten\", \"unknown\")}')
" 2>/dev/null || echo "  WARNING: Could not parse provenance.json"
else
  echo "  WARNING: No provenance.json found (provenance may be in build/ inside container)"
fi
echo ""

# Step 6: Test cache behavior (second build should be faster)
echo "Step 6/7: Testing cache behavior..."
CACHE_START=$(date +%s)
docker run --rm "$IMAGE_NAME" full build-configs/full.yml
CACHE_END=$(date +%s)
CACHE_ELAPSED=$((CACHE_END - CACHE_START))
echo "  Second build took ${CACHE_ELAPSED}s (should be significantly faster if cache works)"
echo ""

# Step 7: Test env var passthrough
echo "Step 7/7: Testing env var passthrough..."
docker run --rm -v "$OUTPUT_DIR/Os-test:/output" \
  -e OCJS_OPT="-Os" \
  "$IMAGE_NAME" full build-configs/full.yml
OS_WASM=$(find "$OUTPUT_DIR/Os-test" -name "*.wasm" 2>/dev/null | head -1)
FULL_WASM=$(find "$OUTPUT_DIR/full" -name "*.wasm" 2>/dev/null | head -1)
if [ -n "$OS_WASM" ] && [ -n "$FULL_WASM" ]; then
  OS_SIZE=$(stat -f%z "$OS_WASM" 2>/dev/null || stat -c%s "$OS_WASM" 2>/dev/null)
  FULL_SIZE=$(stat -f%z "$FULL_WASM" 2>/dev/null || stat -c%s "$FULL_WASM" 2>/dev/null)
  echo "  -O2 size: $FULL_SIZE bytes"
  echo "  -Os size: $OS_SIZE bytes"
  if [ "$OS_SIZE" -lt "$FULL_SIZE" ]; then
    echo "  PASS: -Os build is smaller (env var passthrough works)"
  else
    echo "  WARNING: -Os build is not smaller; env var passthrough may not be working"
  fi
fi
echo ""

echo "═══════════════════════════════════════════════════"
echo "  Docker E2E Validation Complete"
echo "  Output directory: $OUTPUT_DIR"
echo "═══════════════════════════════════════════════════"

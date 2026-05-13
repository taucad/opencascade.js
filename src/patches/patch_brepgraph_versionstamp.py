#!/usr/bin/env python3
"""Idempotently patch BRepGraph_VersionStamp::ToGUID for wasm32 builds (legacy OCCT).

OCCT v8.0.0-rc5 introduced BRepGraph_VersionStamp.cxx with a hard
`static_assert(sizeof(size_t) >= 8, "Expected 64-bit size_t")`. Under
wasm32 (Emscripten's default), size_t is 32-bit, so the assertion fails
at compile time.

**OCCT v8.0.0 final** rewrites ToGUID to quarter-buffer hashing and
packs four uint32_t values into Standard_UUID — no static_assert and
wasm32-safe. This script detects that shape and **skips** patching.

For rc5-style sources only, this patch swaps the assertion + memcpy for a
SIZE_MAX preprocessor branch. Reversible via `git checkout` in the OCCT tree.
"""

import os
import sys

SENTINEL = "OCJS_PATCH_BREPGRAPH_VERSIONSTAMP"

# Present in OCCT 8.0.0 final (d3056ef8); indicates upstream fixed wasm32.
UPSTREAM_V8_FINAL_MARKER = "Truncate each size_t hash to uint32_t"

OLD_BLOCK = """  Standard_UUID aResultUUID;
  static_assert(sizeof(size_t) >= 8, "Expected 64-bit size_t");
  std::memcpy(&aResultUUID, &aHash1, 8);
  std::memcpy(reinterpret_cast<uint8_t*>(&aResultUUID) + 8, &aHash2, 8);"""

REPLACEMENT = f"""  Standard_UUID aResultUUID;
#if SIZE_MAX >= 0xFFFFFFFFFFFFFFFFULL
  // {SENTINEL}: 64-bit path matches upstream OCCT v8.0.0-rc5 behavior.
  std::memcpy(&aResultUUID, &aHash1, 8);
  std::memcpy(reinterpret_cast<uint8_t*>(&aResultUUID) + 8, &aHash2, 8);
#else
  // {SENTINEL}: 32-bit fallback (wasm32). Zero-pad the size_t hashes into
  // the 64-bit GUID slots so memcpy is well-defined. BRepGraph is not
  // exposed via embind, so identity of the resulting GUID is irrelevant.
  std::memset(&aResultUUID, 0, sizeof(aResultUUID));
  std::memcpy(&aResultUUID, &aHash1, sizeof(aHash1));
  std::memcpy(reinterpret_cast<uint8_t*>(&aResultUUID) + 8, &aHash2, sizeof(aHash2));
#endif"""


def patch(filepath: str) -> bool:
    with open(filepath, encoding="utf-8") as file:
        content = file.read()

    if SENTINEL in content:
        print(f"Already patched: {filepath}")
        return True

    if UPSTREAM_V8_FINAL_MARKER in content:
        print(f"Skip (upstream wasm32-safe): {filepath}")
        print("  OCCT 8.0.0+ ToGUID uses uint32_t quarters; no VersionStamp patch needed.")
        return True

    if OLD_BLOCK not in content:
        print(f"ERROR: Expected block not found in {filepath}")
        print("  Looked for static_assert + memcpy block; OCCT may have changed upstream.")
        return False

    new_content = content.replace(OLD_BLOCK, REPLACEMENT, 1)

    with open(filepath, "w", encoding="utf-8") as file:
        file.write(new_content)

    print(f"Patched: {filepath}")
    print("  Guarded sizeof(size_t) >= 8 assertion with __EMSCRIPTEN__/wasm32 fallback.")
    return True


def main():
    occt_root = os.environ.get("OCCT_ROOT", "")
    if not occt_root:
        print("ERROR: OCCT_ROOT not set")
        sys.exit(1)

    target = os.path.join(
        occt_root,
        "src",
        "ModelingData",
        "TKBRep",
        "BRepGraph",
        "BRepGraph_VersionStamp.cxx",
    )
    if not os.path.isfile(target):
        print(f"ERROR: {target} not found")
        sys.exit(1)

    if not patch(target):
        sys.exit(1)


if __name__ == "__main__":
    main()

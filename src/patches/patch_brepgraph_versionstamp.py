#!/usr/bin/env python3
"""Idempotently patch BRepGraph_VersionStamp::ToGUID for wasm32 builds.

OCCT v8.0.0-rc5 introduced BRepGraph_VersionStamp.cxx with a hard
`static_assert(sizeof(size_t) >= 8, "Expected 64-bit size_t")`. Under
wasm32 (Emscripten's default), size_t is 32-bit, so the assertion fails
at compile time.

The `ToGUID` body relies on packing two `size_t` hashes into a 128-bit
GUID via `std::memcpy(..., 8)`. On wasm32 the hashes are 4 bytes, which
is silently truncating/over-reading. Replicad does not whitelist any
`BRepGraph_*` symbols, so the function body is never invoked from JS,
but the file still has to compile because `TKBRep` depends on it.

This patch swaps the assertion + memcpy for a `#ifdef __EMSCRIPTEN__`
fallback that zero-pads the 32-bit hashes into the 64-bit slots, keeping
the function compileable and well-defined under wasm32 without changing
behavior on native 64-bit targets.

Reversible via `git checkout` in the OCCT tree.
"""

import os
import sys

SENTINEL = "OCJS_PATCH_BREPGRAPH_VERSIONSTAMP"

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
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    if SENTINEL in content:
        print(f"Already patched: {filepath}")
        return True

    if OLD_BLOCK not in content:
        print(f"ERROR: Expected block not found in {filepath}")
        print(f"  Looked for static_assert + memcpy block; OCCT may have changed upstream.")
        return False

    new_content = content.replace(OLD_BLOCK, REPLACEMENT, 1)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)

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

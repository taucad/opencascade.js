#!/usr/bin/env python3
"""Idempotently add an explicit noexcept destructor to STEPCAFControl_ActorWrite.

The class has no explicit destructor, so the compiler generates it implicitly at
every destruction site. With -O3, LLVM inlines the destructor and generates
combinatorial EH cleanup code for all Handle<> members (~555 KB). By adding an
explicit out-of-line `noexcept` destructor, the compiler generates it once and
skips all landing pad code.

Reversible via `git checkout` in the OCCT tree.
"""

import os
import sys

SENTINEL = "OCJS_PATCH_NOEXCEPT_DTOR"


def patch_header(filepath: str) -> bool:
    with open(filepath, encoding="utf-8") as f:
        content = f.read()

    if SENTINEL in content:
        print(f"Already patched (declaration): {filepath}")
        return True

    marker = "Standard_EXPORT STEPCAFControl_ActorWrite();"
    if marker not in content:
        print(f"ERROR: Could not find constructor declaration in {filepath}")
        return False

    replacement = (
        f"{marker}\n"
        f"  Standard_EXPORT ~STEPCAFControl_ActorWrite() noexcept; // {SENTINEL}"
    )
    new_content = content.replace(marker, replacement, 1)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)

    print(f"Patched (declaration): {filepath}")
    return True


def patch_source(filepath: str) -> bool:
    with open(filepath, encoding="utf-8") as f:
        content = f.read()

    if SENTINEL in content:
        print(f"Already patched (definition): {filepath}")
        return True

    marker = "IMPLEMENT_STANDARD_RTTIEXT(STEPCAFControl_ActorWrite, STEPControl_ActorWrite)"
    if marker not in content:
        print(f"ERROR: Could not find RTTI macro in {filepath}")
        return False

    replacement = (
        f"{marker}\n\n"
        f"// {SENTINEL}: explicit noexcept destructor eliminates EH landing pads\n"
        f"STEPCAFControl_ActorWrite::~STEPCAFControl_ActorWrite() noexcept = default;\n"
    )
    new_content = content.replace(marker, replacement, 1)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)

    print(f"Patched (definition): {filepath}")
    return True


def main() -> None:
    occt_root = os.environ.get("OCCT_ROOT", "")
    if not occt_root:
        print("ERROR: OCCT_ROOT not set")
        sys.exit(1)

    rel = ("src", "DataExchange", "TKDESTEP", "STEPCAFControl")
    base = os.path.join(occt_root, *rel)
    hxx = os.path.join(base, "STEPCAFControl_ActorWrite.hxx")
    cxx = os.path.join(base, "STEPCAFControl_ActorWrite.cxx")

    for p in (hxx, cxx):
        if not os.path.isfile(p):
            print(f"ERROR: {p} not found")
            sys.exit(1)

    ok = patch_header(hxx)
    ok = patch_source(cxx) and ok

    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Refresh `tests/sentinel/baseline/` from the current `build/bindings/`.

This script exists so an audited OCCT or binding-contract change can regenerate
the parity baseline reproducibly.

Usage:
  python tests/sentinel/refresh_baseline.py

What it does:
  1. Re-snapshots every per-fragment `.cpp` and `.d.ts.json` for the 10
     sentinel headers into `tests/sentinel/baseline/per_header/`.
  2. SHA-256s every fragment under `build/bindings/` into
     `tests/sentinel/baseline/full_tree.sha256`.
Pre-conditions: a fresh `nx run ocjs:generate` has populated
`build/bindings/`.
"""

from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from sentinels import (  # noqa: E402  (sys.path mutation precedes import)
    BASELINE_DIR,
    BASELINE_PER_HEADER,
    BUILD_BINDINGS,
    REPO_ROOT,
    SENTINELS,
)


def _refresh_per_header() -> None:
    if BASELINE_PER_HEADER.exists():
        shutil.rmtree(BASELINE_PER_HEADER)
    BASELINE_PER_HEADER.mkdir(parents=True)
    for sentinel in SENTINELS:
        for src in (sentinel.cpp_path, sentinel.dts_path):
            if not src.is_file():
                raise SystemExit(f"Cannot snapshot — fresh fragment missing: {src}")
            dst = BASELINE_PER_HEADER / sentinel.header_dir / src.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            print(f"  per_header: {sentinel.header_dir}/{src.name}")


def _refresh_full_tree() -> None:
    out = BASELINE_DIR / "full_tree.sha256"
    lines: list[str] = []
    for path in sorted(BUILD_BINDINGS.rglob("*")):
        if not path.is_file():
            continue
        if not path.name.endswith((".cpp", ".d.ts.json")):
            continue
        rel = "./" + str(path.relative_to(BUILD_BINDINGS)).replace("\\", "/")
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        lines.append(f"{h.hexdigest()}  {rel}")
    out.write_text("\n".join(lines) + "\n")
    print(f"  full_tree: {len(lines)} fragments")


def main() -> int:
    print(f"Refreshing baseline at {BASELINE_DIR.relative_to(REPO_ROOT)}/")
    _refresh_per_header()
    _refresh_full_tree()
    print("Done. Review `git diff tests/sentinel/baseline/` and commit.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

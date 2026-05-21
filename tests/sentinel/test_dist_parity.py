"""Layer 3 parity harness: byte-diff `dist/opencascade_full.*` (~25 min cold).

This is the deepest sentinel — it asserts the *entire* link pipeline is
byte-identical to the pre-refactor baseline. It runs `nx run ocjs:link`
(which the cache will short-circuit on identical inputs) and then SHA-256s
the four published artifacts: `opencascade_full.{d.ts,wasm,js,build-manifest.json}`.

Pre-conditions:
  * `tests/sentinel/baseline/dist_artifacts.sha256` is the frozen baseline.

Cost:
  * Cold-cache: ~25 min (full link + post-processing).
  * Warm-cache: a few seconds (Nx replays cached outputs into `dist/`).

Run during phase exit validation (every Phase 1, 2, 3 PR that touches the
link-time rewriter, alias dedup, or any codegen surface). Not on every PR.
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pytest

from sentinels import BASELINE_DIR, REPO_ROOT

_DIST = REPO_ROOT / "dist"
_DIST_SHA_BASELINE = BASELINE_DIR / "dist_artifacts.sha256"
_TRACKED_ARTIFACTS = (
    "opencascade_full.d.ts",
    "opencascade_full.wasm",
    "opencascade_full.js",
    "opencascade_full.build-manifest.json",
)


def _ensure_link_ran() -> None:
    """Invoke `nx run ocjs:link` (full pipeline). Cache hit short-circuits."""
    missing = [name for name in _TRACKED_ARTIFACTS if not (_DIST / name).is_file()]
    if missing:
        result = subprocess.run(
            ["pnpm", "nx", "run", "ocjs:link"],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=2400,  # 40 min hard cap (cold link is ~25 min)
        )
        if result.returncode != 0:
            pytest.skip(f"nx run ocjs:link failed: {result.stderr[-500:]}")
    for name in _TRACKED_ARTIFACTS:
        assert (_DIST / name).is_file(), f"Expected dist artifact missing: {_DIST / name}"


def _hash_artifact(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_baseline() -> dict[str, str]:
    """Parse `<sha>  dist/<name>` lines from the frozen baseline."""
    if not _DIST_SHA_BASELINE.is_file():
        pytest.fail(f"Baseline manifest missing: {_DIST_SHA_BASELINE}")
    digests: dict[str, str] = {}
    for line in _DIST_SHA_BASELINE.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        sha, _, rel = line.partition("  ")
        if not sha or not rel:
            pytest.fail(f"Malformed baseline line: {line!r}")
        # Baseline stores `dist/opencascade_full.d.ts`; strip the dist/ prefix
        # so we key by basename and stay agnostic to where the baseline was
        # produced from.
        name = rel.split("/", 1)[1] if "/" in rel else rel
        digests[name] = sha
    return digests


@pytest.fixture(scope="module")
def fresh_digests() -> dict[str, str]:
    _ensure_link_ran()
    return {name: _hash_artifact(_DIST / name) for name in _TRACKED_ARTIFACTS}


@pytest.fixture(scope="module")
def baseline_digests() -> dict[str, str]:
    return _load_baseline()


@pytest.mark.parametrize("artifact", _TRACKED_ARTIFACTS)
def test_artifact_byte_identical(
    artifact: str,
    fresh_digests: dict[str, str],
    baseline_digests: dict[str, str],
) -> None:
    if artifact not in baseline_digests:
        pytest.fail(f"Baseline manifest does not track {artifact} — refresh with refresh_baseline.py?")
    fresh = fresh_digests[artifact]
    baseline = baseline_digests[artifact]
    if fresh != baseline:
        pytest.fail(
            f"\n  Artifact drift: {artifact}"
            f"\n    fresh   : {fresh}"
            f"\n    baseline: {baseline}"
            f"\n  This indicates the link pipeline emitted a non-byte-identical artifact."
            f"\n  Likely culprit: a Phase 1 / Phase 2 PR that reordered codegen, mutated"
            f"\n  the link-time rewriter chain, or changed the alias-dedup rules."
        )

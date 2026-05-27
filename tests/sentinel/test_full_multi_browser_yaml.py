"""Drift-prevention sentinel for ``build-configs/full_multi_browser.yml``.

The browser-only multi-threaded build (see Recommendation R12 in
``docs/research/ocjs-replicad-multi-link-warning-audit.md``) layers
``-sGROWABLE_ARRAYBUFFERS=1`` on top of the default ``full_multi.yml`` so
consumers can hoist ``HEAP*`` references out of hot loops. The flag works
by making Emscripten emit JS glue that calls
``WebAssembly.Memory.prototype.toResizableBuffer()`` at module init —
unavailable in Node.js / Bun / Deno as of May 2026.

This sentinel pins three drift hazards:

1. ``-sGROWABLE_ARRAYBUFFERS=1`` must be present in ``emccFlags`` (it is
   the entire point of the browser variant).
2. ``-sENVIRONMENT`` must NOT include ``node`` — shipping a browser
   artefact that Node tries to load throws ``TypeError:
   wasmMemory.toResizableBuffer is not a function`` and we want the
   incompatibility to fail loudly at build time, not at module init.
3. ``mainBuild.name`` must remain the canonical
   ``opencascade_full_multi_browser.js`` so CI / docs links keep
   resolving.

The sentinel additionally guards against the YAML's symbol list silently
diverging from ``full_multi.yml`` — the two builds are supposed to be a
flag delta, not a scope delta. If you intentionally trim the browser
variant's symbol list, update ``BROWSER_SCOPE_EXEMPT`` below with the
delta + a one-line rationale.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
FULL_MULTI_YAML = REPO_ROOT / "build-configs" / "full_multi.yml"
BROWSER_YAML = REPO_ROOT / "build-configs" / "full_multi_browser.yml"

# Allowed scope delta vs full_multi.yml. Empty by design — the browser
# variant is a *flag* delta, not a scope delta. Add entries here only
# with a written rationale in a follow-up PR description.
BROWSER_SCOPE_EXEMPT: frozenset[str] = frozenset()


@pytest.fixture(scope="module")
def browser_yaml_config() -> dict:
    if not BROWSER_YAML.exists():
        pytest.fail(
            f"full_multi_browser.yml missing at {BROWSER_YAML} — see R12 in "
            f"docs/research/ocjs-replicad-multi-link-warning-audit.md."
        )
    return yaml.safe_load(BROWSER_YAML.read_text())


@pytest.fixture(scope="module")
def full_multi_yaml_config() -> dict:
    if not FULL_MULTI_YAML.exists():
        pytest.fail(f"full_multi.yml missing at {FULL_MULTI_YAML}.")
    return yaml.safe_load(FULL_MULTI_YAML.read_text())


class TestBrowserBuildEmccFlags:
    """Pin the two flag deltas that make this a browser-only variant."""

    def test_should_enable_growable_arraybuffers(self, browser_yaml_config: dict) -> None:
        """``-sGROWABLE_ARRAYBUFFERS=1`` is what drives Emscripten to emit
        ``toResizableBuffer()`` glue at link time. Without it the browser
        variant is indistinguishable from the default ``full_multi``
        build and R12 is silently regressed."""
        flags = browser_yaml_config["mainBuild"]["emccFlags"]
        assert "-sGROWABLE_ARRAYBUFFERS=1" in flags, (
            "full_multi_browser.yml emccFlags must contain "
            "'-sGROWABLE_ARRAYBUFFERS=1' — the entire point of this YAML "
            "is to enable resizable-SAB glue so the link emits the "
            "toResizableBuffer() runtime call. See R12 in the audit doc."
        )

    def test_should_exclude_node_from_environment(self, browser_yaml_config: dict) -> None:
        """``-sENVIRONMENT=web,worker,node`` would happily build but fail
        at module init under Node (``toResizableBuffer is not a
        function``). Excluding ``node`` at the flag level fails loudly at
        link time instead."""
        flags = browser_yaml_config["mainBuild"]["emccFlags"]
        environment_flags = [f for f in flags if f.startswith("-sENVIRONMENT=")]
        assert environment_flags, (
            "full_multi_browser.yml must set -sENVIRONMENT explicitly to "
            "exclude 'node' (default would inherit web,worker,node)."
        )
        for flag in environment_flags:
            envs = flag.split("=", 1)[1].split(",")
            assert "node" not in envs, (
                f"full_multi_browser.yml -sENVIRONMENT must NOT include "
                f"'node' (got '{flag}'). Node lacks "
                f"WebAssembly.Memory.prototype.toResizableBuffer() as of "
                f"May 2026; including 'node' here ships a binary that "
                f"throws on module init under vitest/jest. See R12."
            )

    def test_should_keep_pthread_baseline(self, browser_yaml_config: dict) -> None:
        """The browser variant is a flag delta on top of the standard MT
        build — the pthread baseline must still be intact."""
        flags = browser_yaml_config["mainBuild"]["emccFlags"]
        for required in ("-pthread", "-sUSE_PTHREADS=1", "-sSHARED_MEMORY=1"):
            assert required in flags, (
                f"full_multi_browser.yml is missing pthread baseline flag "
                f"'{required}'. The browser variant must inherit the full "
                f"multi-threaded baseline; only ENVIRONMENT + "
                f"GROWABLE_ARRAYBUFFERS should diverge."
            )


class TestBrowserBuildIdentity:
    """Pin the artefact name + scope parity vs full_multi.yml."""

    def test_should_set_browser_specific_output_basename(
        self, browser_yaml_config: dict
    ) -> None:
        name = browser_yaml_config["mainBuild"]["name"]
        assert name == "opencascade_full_multi_browser.js", (
            f"mainBuild.name drifted from canonical "
            f"'opencascade_full_multi_browser.js' to '{name}' — docs and "
            f"published artefact naming both rely on this basename."
        )

    def test_should_match_full_multi_symbol_scope_modulo_exemptions(
        self,
        browser_yaml_config: dict,
        full_multi_yaml_config: dict,
    ) -> None:
        """The browser variant is supposed to be a flag delta on top of
        full_multi.yml, not a scope delta. Any divergence in
        ``mainBuild.bindings`` must be listed in ``BROWSER_SCOPE_EXEMPT``
        with a written rationale."""
        browser_symbols = frozenset(
            entry["symbol"] for entry in browser_yaml_config["mainBuild"]["bindings"]
        )
        full_multi_symbols = frozenset(
            entry["symbol"] for entry in full_multi_yaml_config["mainBuild"]["bindings"]
        )

        only_in_browser = browser_symbols - full_multi_symbols - BROWSER_SCOPE_EXEMPT
        only_in_full_multi = full_multi_symbols - browser_symbols - BROWSER_SCOPE_EXEMPT

        assert not only_in_browser and not only_in_full_multi, (
            "full_multi_browser.yml symbol scope drifted from full_multi.yml.\n"
            f"  Only in browser   : {sorted(only_in_browser)}\n"
            f"  Only in full_multi: {sorted(only_in_full_multi)}\n"
            "If intentional, add the delta to BROWSER_SCOPE_EXEMPT in this "
            "file with a one-line rationale."
        )

"""Producer-side libclang Embind extractor.

Dedicated NX-graph stage that runs **between** ``generate`` and ``link``
and writes ``build/additional-bind-symbols.json`` so the link-time
``verifyBindings`` consumer (and the post-link ``validate-build.py``
consumer) can both read the manifest without depending on the link stage
having opened libclang first.

Lifting this work into its own stage fixes the V3 bootstrap-ordering bug
that the original PR introduced — the in-process producer inside
``yaml_build.runBuild::getAdditionalBindCodeO()`` ran *after* the
``verifyBindings`` consumer that needed the manifest, so the loader fell
back to "manifest absent ⇒ empty frozenset" silently. The NX dep-graph
contract (``link.dependsOn = [..., "bind-symbols", ...]``) now hard-enforces
the order architecturally; missing manifest at link time means the dep
graph wasn't honoured and the loader raises with a regenerate-pointer.

Producer side of the contract documented in
``ocjs_bindgen.link.manifest_registry.builtin_binding_symbols``.

CLI surface lives in ``__main__.py`` so the module is runnable via
``python -m ocjs_bindgen.bind_symbols <yaml-path>`` from
``build-wasm.sh bind-symbols``.
"""

from __future__ import annotations

import json
import os
from typing import Iterable

import yaml

from ocjs_bindgen.ast.parse import parse_additional_bind_code
from ocjs_bindgen.ast.walker import extract_class_registrations
from ocjs_bindgen.config.paths import getAdditionalBindCodeParseIncludePaths
from ocjs_bindgen.embind_builtins import BUILTIN_ADDITIONAL_BIND_CODE
from ocjs_bindgen.link.manifest_registry import ADDITIONAL_BIND_SYMBOLS_SCHEMA


def _iter_additional_bind_code_blocks(build_config: dict) -> Iterable[str]:
    """Yield every consumer-supplied ``additionalBindCode`` block in the
    YAML, in deterministic order (mainBuild first, then extraBuilds in
    declared order). Empty blocks are skipped — they'd compile to a no-op
    TU but waste a libclang parse.
    """
    main = build_config.get("mainBuild") or {}
    main_code = main.get("additionalBindCode")
    if main_code:
        yield main_code
    for extra in build_config.get("extraBuilds") or []:
        extra_code = extra.get("additionalBindCode")
        if extra_code:
            yield extra_code


def extract_registrations_for_yaml(yaml_path: str) -> set[str]:
    """Parse ``BUILTIN_ADDITIONAL_BIND_CODE`` plus every per-block
    ``additionalBindCode`` in the YAML config and return the union of
    Embind registration names.

    Each block is concatenated onto the builtin source the same way
    ``runBuild::getAdditionalBindCodeO()`` does at link time, then parsed
    through ``ast/parse.py::parse_additional_bind_code`` (libclang) and
    walked with ``ast/walker.py::extract_class_registrations`` (AST
    visitor — no regex). The union keeps the manifest faithful to what
    the link compile would produce when every block lands in the same TU.
    """
    with open(yaml_path) as f:
        build_config = yaml.safe_load(f)
    registrations: set[str] = set()
    sources_to_parse: list[str] = [BUILTIN_ADDITIONAL_BIND_CODE]
    for extra in _iter_additional_bind_code_blocks(build_config):
        sources_to_parse.append(BUILTIN_ADDITIONAL_BIND_CODE + "\n" + extra)
    include_paths = getAdditionalBindCodeParseIncludePaths()
    seen_sources: set[str] = set()
    for source in sources_to_parse:
        # De-dupe identical TUs (a YAML with no consumer additionalBindCode
        # produces a single source = BUILTIN; multiple identical blocks
        # would parse the same TU repeatedly otherwise).
        if source in seen_sources:
            continue
        seen_sources.add(source)
        tu = parse_additional_bind_code(source, include_paths)
        registrations.update(extract_class_registrations(tu))
    return registrations


def write_manifest(registrations: set[str], build_dir: str) -> str:
    """Serialise the registrations to
    ``<build_dir>/additional-bind-symbols.json`` with the v1 schema
    discriminator the consumer asserts on.
    """
    os.makedirs(build_dir, exist_ok=True)
    manifest_path = os.path.join(build_dir, "additional-bind-symbols.json")
    payload = {
        "schema": ADDITIONAL_BIND_SYMBOLS_SCHEMA,
        "symbols": sorted(registrations),
    }
    with open(manifest_path, "w") as f:
        json.dump(payload, f, indent=2)
    return manifest_path


def main(yaml_path: str, build_dir: str) -> str:
    """End-to-end NX-stage entry point. Returns the manifest path."""
    registrations = extract_registrations_for_yaml(yaml_path)
    manifest_path = write_manifest(registrations, build_dir)
    print(
        f"bind-symbols: {len(registrations)} Embind registration(s) "
        f"-> {manifest_path}",
        flush=True,
    )
    return manifest_path

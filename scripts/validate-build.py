#!/usr/bin/python3
"""Post-build validation for opencascade.js WASM builds.

Validates that a completed build matches the requested YAML configuration:
- All requested symbols have compiled .o files (or resolve via NCollection
  typedef alias / BUILTIN_ADDITIONAL_BIND_CODE / consumer additionalBindCode
  via the shared `manifest_registry` consumer chain)
- The .wasm output exists and has a reasonable size
- Produces a machine-readable build manifest (JSON, schema `build-manifest-v2`)

Usage:
  python3 scripts/validate-build.py <yaml-config> <build-output-dir>
  python3 scripts/validate-build.py build-configs/full.yml build-configs/

Exit codes:
  0 - All validations passed
  1 - One or more validations failed
"""

import json
import os
import sys
import hashlib
import time
from argparse import ArgumentParser

OCJS_ROOT = os.environ.get("OCJS_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(OCJS_ROOT, "src"))

# V2 — single source of truth for symbol resolution. Both link-time
# (`yaml_build.verifyBindings`) and post-link (this script) read through
# the same loaders so the two views of "missing" can never disagree.
from ocjs_bindgen.link.manifest_registry import (  # noqa: E402
    builtin_binding_symbols,
    collect_compiled_symbols,
    load_ncollection_alias_index,
    resolve_requested_symbols,
)

MIN_WASM_SIZE_BYTES = 1024 * 100  # 100 KB — any real OCCT build should be much larger

BUILD_MANIFEST_SCHEMA = "build-manifest-v2"


def load_yaml_config(yaml_path):
    import yaml
    from cerberus import Validator

    with open(yaml_path) as f:
        config = yaml.safe_load(f)
    schema_path = os.path.join(OCJS_ROOT, "src", "customBuildSchema.py")
    schema = eval(open(schema_path).read())
    v = Validator(schema)
    if not v.validate(config, schema):
        print(f"ERROR: YAML config validation failed: {v.errors}", file=sys.stderr)
        sys.exit(1)
    return v.normalized(config)


def _all_requested_bindings(config):
    """Return every YAML-requested binding (mainBuild + every extraBuild)."""
    bindings = list(config["mainBuild"].get("bindings", []))
    for extra in config.get("extraBuilds", []):
        bindings.extend(extra.get("bindings", []))
    return bindings


def validate_symbols(config, build_dir):
    """Bucket every YAML-requested symbol via `manifest_registry`.

    V2 — replaces the original `requested - compiled` arithmetic that
    silently reported NCollection typedef aliases and Embind builtins
    as "missing". Each requested symbol now falls into exactly one of
    four buckets (`SymbolResolution`):

    * ``satisfied_by_compiled`` — direct ``build/compiled-bindings/<sym>.cpp.o``.
    * ``alias_resolved`` — typedef alias in ``build/ncollection-manifest.json``
      whose canonical IS compiled; linker substitutes at link time.
    * ``builtin`` — Embind registration name in
      ``build/additional-bind-symbols.json`` (canonical
      BUILTIN_ADDITIONAL_BIND_CODE + consumer YAML additionalBindCode
      unioned by the Phase 2 AST producer).
    * ``truly_missing`` — neither compiled, nor an alias to something
      compiled, nor a builtin registration. Triggers `pass=False`.

    Returns the manifest-shaped dict consumed by main() to populate
    `manifest["symbols"]`.
    """
    compiled = collect_compiled_symbols(build_dir)
    alias_index = load_ncollection_alias_index(build_dir)
    builtins = builtin_binding_symbols(build_dir)
    requested = {b["symbol"] for b in _all_requested_bindings(config)}
    resolution = resolve_requested_symbols(requested, compiled, alias_index, builtins)

    alias_canonicals = {canonical for canonical in resolution.alias_resolved.values()}
    extra_compiled = len(compiled - requested - alias_canonicals)

    return {
        "requested": sorted(requested),
        "compiled": len(compiled),
        "missing": sorted(resolution.truly_missing),
        "alias_resolved": [
            {"alias": a, "canonical": c}
            for a, c in sorted(resolution.alias_resolved.items())
        ],
        "builtin": sorted(resolution.builtin),
        "extra_compiled": extra_compiled,
        "pass": not resolution.truly_missing,
    }


def validate_wasm_outputs(config, output_dir):
    """Validate that .wasm files exist and have reasonable sizes."""
    results = []

    build_names = [config["mainBuild"]["name"]]
    for extra in config.get("extraBuilds", []):
        build_names.append(extra["name"])

    for name in build_names:
        wasm_name = os.path.splitext(name)[0] + ".wasm"
        wasm_path = os.path.join(output_dir, wasm_name)
        js_path = os.path.join(output_dir, name)

        entry = {
            "name": name,
            "wasm_file": wasm_name,
            "wasm_exists": os.path.exists(wasm_path),
            "wasm_size": os.path.getsize(wasm_path) if os.path.exists(wasm_path) else 0,
            "js_exists": os.path.exists(js_path),
            "js_size": os.path.getsize(js_path) if os.path.exists(js_path) else 0,
            "pass": False,
        }

        if not entry["wasm_exists"]:
            entry["error"] = f"WASM file not found: {wasm_path}"
        elif entry["wasm_size"] < MIN_WASM_SIZE_BYTES:
            entry["error"] = f"WASM file too small ({entry['wasm_size']} bytes < {MIN_WASM_SIZE_BYTES} minimum)"
        elif not entry["js_exists"]:
            entry["error"] = f"JS glue file not found: {js_path}"
        else:
            entry["pass"] = True

        results.append(entry)

    return results


def validate_binding_report(build_dir):
    """Load and summarize ``compiled-bindings/binding-report.json`` if present.

    V4 — fixes the previously-incorrect path that pointed at
    ``build/binding-report.json``. The report is written by
    `compileBindings.py` next to the per-symbol object files in
    ``build/compiled-bindings/`` (see `_cpp_to_object_path`); the old
    path always returned ``None`` so the manifest's ``binding_report``
    field was permanently null.
    """
    report_path = os.path.join(build_dir, "compiled-bindings", "binding-report.json")
    if not os.path.exists(report_path):
        return None
    with open(report_path) as f:
        return json.load(f)


def merge_any_reasons(build_dir):
    """V6 — slim summary of ``build/any-type-report.json`` (M5).

    The generator's any-type report enumerates every ``: any`` declaration
    by reason category (templated method, unsupported parameter type,
    unresolved typedef, etc.). Surfacing the per-reason count + a few
    examples in the build manifest gives downstream consumers (docs
    generator, dts validator, future CI dashboards) a single place to
    read the structural shape of remaining ``any`` decay without
    re-loading the full any-type-report.

    Returns ``None`` when the report is absent (clean build that never
    emitted an any-type-report yet — not a failure). Returns a dict
    keyed by reason → ``{count, examples}`` with at most 5 examples per
    reason to keep the manifest reasonable.
    """
    report_path = os.path.join(build_dir, "any-type-report.json")
    if not os.path.exists(report_path):
        return None
    try:
        with open(report_path) as f:
            report = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    summary = {}
    entries = report.get("entries") or report.get("any_decays") or []
    for entry in entries:
        reason = entry.get("reason") or entry.get("category") or "unknown"
        example = entry.get("location") or entry.get("symbol") or entry.get("name")
        bucket = summary.setdefault(reason, {"count": 0, "examples": []})
        bucket["count"] += 1
        if example and len(bucket["examples"]) < 5:
            bucket["examples"].append(example)
    return summary


def validate_runtime_helpers(config, output_dir):
    """If the YAML asks for -sEXPORT_EXCEPTION_HANDLING_HELPERS, assert the
    linked JS glue actually defines getExceptionMessage / refcount helpers.

    Catches the regression where -fwasm-exceptions is present but the helpers
    flag is missing, leaving the .d.ts over-promising relative to runtime.
    """
    main_flags = config["mainBuild"].get("emccFlags", [])
    if not any('-sEXPORT_EXCEPTION_HANDLING_HELPERS' in f for f in main_flags):
        return {"required": False, "pass": True, "checked": [], "missing": []}

    js_path = os.path.join(output_dir, config["mainBuild"]["name"])
    if not os.path.exists(js_path):
        return {
            "required": True,
            "pass": False,
            "checked": [],
            "missing": [],
            "error": f"JS glue missing: {js_path}",
        }

    with open(js_path, "r", encoding="utf-8") as f:
        glue = f.read()

    required = ["getExceptionMessage", "incrementExceptionRefcount", "decrementExceptionRefcount"]
    missing = [name for name in required if f".{name}=" not in glue and f'"{name}"' not in glue]
    return {
        "required": True,
        "pass": not missing,
        "checked": required,
        "missing": missing,
    }


def compute_config_hash(yaml_path):
    with open(yaml_path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def build_name_from_config(config):
    """Extract the variant name from the YAML config (e.g. 'replicad_single' from 'replicad_single.js')."""
    return os.path.splitext(config["mainBuild"]["name"])[0]


def main():
    parser = ArgumentParser(description="Validate an opencascade.js WASM build against its YAML config")
    parser.add_argument("yaml_config", help="Path to the YAML build configuration")
    parser.add_argument("output_dir", help="Directory containing the build output (.wasm, .js)")
    parser.add_argument("--build-dir", default=None, help="Build directory containing bindings/ and sources/ (default: $OCJS_ROOT/build)")
    parser.add_argument("--json-output", default=None, help="Path to write the build manifest JSON (default: <output_dir>/<variant>.build-manifest.json)")
    args = parser.parse_args()

    build_dir = args.build_dir or os.path.join(OCJS_ROOT, "build")
    config = load_yaml_config(args.yaml_config)
    variant = build_name_from_config(config)
    json_output = args.json_output or os.path.join(args.output_dir, f"{variant}.build-manifest.json")

    config_hash = compute_config_hash(args.yaml_config)

    print(f"Validating build: {args.yaml_config} (hash: {config_hash})")
    print(f"  Build dir:  {build_dir}")
    print(f"  Output dir: {args.output_dir}")
    print()

    all_pass = True

    # 1. Symbol validation
    sym_result = validate_symbols(config, build_dir)
    n_aliased = len(sym_result["alias_resolved"])
    n_builtin = len(sym_result["builtin"])
    if sym_result["pass"]:
        bucket_summary = (
            f"{len(sym_result['requested'])} requested, "
            f"{sym_result['compiled']} compiled, "
            f"{n_aliased} alias-resolved, "
            f"{n_builtin} builtin"
        )
        print(f"  [PASS] Symbols: {bucket_summary}")
    else:
        print(
            f"  [FAIL] Symbols: {len(sym_result['missing'])} truly missing out of "
            f"{len(sym_result['requested'])} requested "
            f"(alias-resolved: {n_aliased}, builtin: {n_builtin})"
        )
        for s in sym_result["missing"][:20]:
            print(f"         - {s}")
        if len(sym_result["missing"]) > 20:
            print(f"         ... and {len(sym_result['missing']) - 20} more")
        all_pass = False

    # 2. WASM output validation
    wasm_results = validate_wasm_outputs(config, args.output_dir)
    for wr in wasm_results:
        if wr["pass"]:
            size_mb = wr["wasm_size"] / (1024 * 1024)
            print(f"  [PASS] Output: {wr['wasm_file']} ({size_mb:.1f} MB)")
        else:
            print(f"  [FAIL] Output: {wr.get('error', 'unknown error')}")
            all_pass = False

    # 3. Runtime helper validation (Emscripten EH helpers when requested)
    helper_result = validate_runtime_helpers(config, args.output_dir)
    if not helper_result["required"]:
        print("  [INFO] Runtime helpers: not requested by YAML")
    elif helper_result["pass"]:
        print(f"  [PASS] Runtime helpers: {len(helper_result['checked'])} EH helpers present in linked JS glue")
    else:
        if "error" in helper_result:
            print(f"  [FAIL] Runtime helpers: {helper_result['error']}")
        else:
            print(f"  [FAIL] Runtime helpers: missing {len(helper_result['missing'])} helper(s) in linked JS glue")
            for name in helper_result["missing"]:
                print(f"         - {name}")
        all_pass = False

    # 4. Binding report (informational, path-corrected by V4)
    binding_report = validate_binding_report(build_dir)
    if binding_report:
        print(f"  [INFO] Binding report: {binding_report.get('succeeded', '?')} succeeded, "
              f"{binding_report.get('failed', '?')} failed, "
              f"{binding_report.get('cached', '?')} cached")

    # 5. Any-type reasons summary (V6 — sourced from build/any-type-report.json)
    any_reasons = merge_any_reasons(build_dir)
    if any_reasons:
        total_any = sum(b["count"] for b in any_reasons.values())
        print(f"  [INFO] Any-type decay: {total_any} entries across {len(any_reasons)} reason(s)")
        sym_result["any_reasons"] = any_reasons

    manifest = {
        "schema": BUILD_MANIFEST_SCHEMA,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "yaml_config": os.path.basename(args.yaml_config),
        "yaml_hash": config_hash,
        "validation_passed": all_pass,
        "symbols": sym_result,
        "outputs": wasm_results,
        "runtime_helpers": helper_result,
        "binding_report": binding_report,
    }

    os.makedirs(os.path.dirname(os.path.abspath(json_output)), exist_ok=True)
    with open(json_output, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n  Manifest written to {json_output}")

    if all_pass:
        print("\n  BUILD VALIDATION PASSED")
    else:
        print("\n  BUILD VALIDATION FAILED", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/python3
"""Post-build validation for opencascade.js WASM builds.

Validates that a completed build matches the requested YAML configuration:
- All requested symbols have compiled .o files
- The .wasm output exists and has a reasonable size
- Produces a machine-readable build manifest (JSON)

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

MIN_WASM_SIZE_BYTES = 1024 * 100  # 100 KB — any real OCCT build should be much larger


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


def find_compiled_bindings(build_dir):
    """Scan the bindings directory for compiled .o files, returning a set of symbol names."""
    bindings_dir = os.path.join(build_dir, "bindings")
    compiled = set()
    if not os.path.isdir(bindings_dir):
        return compiled
    for dirpath, _, filenames in os.walk(bindings_dir):
        for f in filenames:
            if f.endswith(".cpp.o"):
                compiled.add(f[:-6])  # strip ".cpp.o" → symbol name
    return compiled


def validate_symbols(config, build_dir):
    """Check that every symbol in the YAML config has a compiled .o file."""
    compiled = find_compiled_bindings(build_dir)
    all_bindings = list(config["mainBuild"].get("bindings", []))
    for extra in config.get("extraBuilds", []):
        all_bindings.extend(extra.get("bindings", []))

    requested = {b["symbol"] for b in all_bindings}
    missing = sorted(requested - compiled)
    extra = sorted(compiled - requested) if requested else []

    return {
        "requested": sorted(requested),
        "compiled": len(compiled),
        "missing": missing,
        "extra_compiled": len(extra),
        "pass": len(missing) == 0,
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
    """Load and summarize the binding-report.json if it exists."""
    report_path = os.path.join(build_dir, "binding-report.json")
    if not os.path.exists(report_path):
        return None
    with open(report_path) as f:
        return json.load(f)


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
    if sym_result["pass"]:
        print(f"  [PASS] Symbols: {len(sym_result['requested'])} requested, {sym_result['compiled']} compiled")
    else:
        print(f"  [FAIL] Symbols: {len(sym_result['missing'])} missing out of {len(sym_result['requested'])} requested")
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

    # 3. Binding report (informational)
    binding_report = validate_binding_report(build_dir)
    if binding_report:
        print(f"  [INFO] Binding report: {binding_report.get('succeeded', '?')} succeeded, "
              f"{binding_report.get('failed', '?')} failed, "
              f"{binding_report.get('cached', '?')} cached")

    # Build manifest
    manifest = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "yaml_config": os.path.basename(args.yaml_config),
        "yaml_hash": config_hash,
        "validation_passed": all_pass,
        "symbols": sym_result,
        "outputs": wasm_results,
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

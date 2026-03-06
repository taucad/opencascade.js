"""
Build provenance tracking for WASM artifacts.

Generates a JSON sidecar document that captures the complete recipe
for reproducing a WASM binary. Built incrementally across build stages:
  1. init       — toolchain info, env vars, source commits
  2. add-compilation — file counts, compilation duration, cache status
  3. add-linking — symbol list, link flags, pre/post-opt sizes (called by buildFromYaml.py)
  4. finalize   — output file hashes, section analysis

Usage (from build-wasm.sh):
  python3 src/provenance.py init
  python3 src/provenance.py add-compilation --duration 1234
  python3 src/provenance.py add-compilation --cache-hit
  python3 src/provenance.py add-linking --yaml <path> --symbols 233 --flags '...' --pre-size 19900000 --post-size 19885932
  python3 src/provenance.py finalize --wasm-dir <path> --duration 120
"""

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

OCJS_ROOT = os.environ.get("OCJS_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OCCT_ROOT = os.environ.get("OCCT_ROOT", "")
BUILD_DIR = os.path.join(OCJS_ROOT, "build")
PROVENANCE_FILE = os.path.join(BUILD_DIR, "provenance.json")


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except (FileNotFoundError, PermissionError):
        return "unknown"


def _git_commit(repo_path: str) -> str:
    if not repo_path or not os.path.isdir(repo_path):
        return "unknown"
    try:
        result = subprocess.run(
            ["git", "-C", repo_path, "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "unknown"


def _get_emscripten_version() -> str:
    try:
        result = subprocess.run(
            ["emcc", "--version"],
            capture_output=True, text=True, timeout=5,
        )
        first_line = result.stdout.strip().split("\n")[0]
        for part in first_line.split():
            if part[0].isdigit():
                return part
    except (FileNotFoundError, subprocess.TimeoutExpired, IndexError):
        pass
    return "unknown"


def _get_llvm_version() -> str:
    try:
        result = subprocess.run(
            ["clang", "--version"],
            capture_output=True, text=True, timeout=5,
        )
        for part in result.stdout.split():
            if part[0].isdigit() and "." in part:
                return part.split(".")[0]
    except (FileNotFoundError, subprocess.TimeoutExpired, IndexError):
        pass
    return "unknown"


def _get_wasm_opt_version() -> str:
    emsdk = os.environ.get("EMSDK", "")
    wasm_opt = os.path.join(emsdk, "upstream", "bin", "wasm-opt") if emsdk else "wasm-opt"
    try:
        result = subprocess.run(
            [wasm_opt, "--version"],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip().split()[-1] if result.stdout.strip() else "unknown"
    except (FileNotFoundError, subprocess.TimeoutExpired, IndexError):
        return "unknown"


def _get_python_version() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"


def _count_files(directory: str, ext: str) -> int:
    count = 0
    if not os.path.isdir(directory):
        return 0
    for _dp, _dn, fns in os.walk(directory):
        for fn in fns:
            if fn.endswith(ext):
                count += 1
    return count


def _filter_hash() -> str:
    filter_file = os.path.join(OCJS_ROOT, "src", "filter", "filterPackages.py")
    if os.path.exists(filter_file):
        return _file_hash(filter_file)[:12]
    return "nofilter"


def _get_filtered_packages() -> list:
    """Extract the list of filtered package names from filterPackages.py."""
    filter_file = os.path.join(OCJS_ROOT, "src", "filter", "filterPackages.py")
    if not os.path.exists(filter_file):
        return []
    packages = []
    with open(filter_file) as f:
        in_list = False
        for line in f:
            stripped = line.strip()
            if "packageName in [" in stripped:
                in_list = True
                continue
            if in_list:
                if stripped.startswith("]"):
                    break
                if stripped.startswith('"') and stripped.rstrip(",").endswith('"'):
                    pkg = stripped.strip('",').strip()
                    if pkg:
                        packages.append(pkg)
    return packages


def _stat_file(path: str) -> int:
    try:
        return os.path.getsize(path)
    except (FileNotFoundError, OSError):
        return 0


def _wasm_sections(wasm_path: str) -> dict:
    """Extract WASM section sizes using wasm-objdump if available."""
    emsdk = os.environ.get("EMSDK", "")
    objdump = os.path.join(emsdk, "upstream", "bin", "wasm-objdump") if emsdk else "wasm-objdump"
    try:
        result = subprocess.run(
            [objdump, "-h", wasm_path],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            return {}

        sections = {}
        for line in result.stdout.split("\n"):
            parts = line.strip().split()
            if len(parts) >= 3 and parts[0].startswith("\""):
                name = parts[0].strip('"')
                try:
                    size = int(parts[-2], 16) if parts[-2].startswith("0x") else int(parts[-2])
                    sections[name] = size
                except (ValueError, IndexError):
                    pass
        return sections
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {}


def _load() -> dict:
    if os.path.exists(PROVENANCE_FILE):
        with open(PROVENANCE_FILE) as f:
            return json.load(f)
    return {}


def _save(data: dict) -> None:
    os.makedirs(BUILD_DIR, exist_ok=True)
    with open(PROVENANCE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _build_compile_flags(opt: str, lto: bool, exceptions: str) -> list:
    """Reconstruct the emcc compile flags from build env vars."""
    flags = [opt]
    if lto:
        flags.append("-flto")
    if exceptions == "1":
        flags.append("-fwasm-exceptions")
    else:
        flags.append("-sDISABLE_EXCEPTION_CATCHING=1")
    defines = os.environ.get("OCJS_DEFINES", "")
    if defines:
        flags.extend(f"-D{d.strip()}" for d in defines.split(",") if d.strip())
    undefines = os.environ.get("OCJS_UNDEFINES", "")
    if undefines:
        flags.extend(f"-U{u.strip()}" for u in undefines.split(",") if u.strip())
    simd = os.environ.get("OCJS_SIMD", "")
    if simd == "1":
        flags.append("-msimd128")
    custom = os.environ.get("OCJS_EXTRA_CFLAGS", "")
    if custom:
        flags.extend(custom.split())
    return flags


def _load_deps_json() -> dict:
    """Load pinned commit hashes from DEPS.json for provenance tracking."""
    deps_file = os.path.join(OCJS_ROOT, "DEPS.json")
    if not os.path.exists(deps_file):
        return {}
    try:
        with open(deps_file) as f:
            data = json.load(f)
        deps = data.get("dependencies", {})
        return {
            name: {k: v for k, v in info.items() if k in ("commit", "docker_digest", "emsdk_version", "version")}
            for name, info in deps.items()
        }
    except (json.JSONDecodeError, KeyError):
        return {}


def init() -> None:
    opt = os.environ.get("OCJS_OPT", "-O2")
    lto = os.environ.get("OCJS_LTO", "1") == "1"
    exceptions = os.environ.get("OCJS_EXCEPTIONS", "0")
    threading = os.environ.get("THREADING", "single-threaded")

    exc_mode = "wasm-native" if exceptions == "1" else "none"

    lto_slug = "LTO" if lto else "noLTO"
    exc_slug = "wasmExc" if exceptions == "1" else "noExc"
    thread_slug = "multi" if "multi" in threading else "single"
    build_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{opt.lstrip('-')}-{lto_slug}-{thread_slug}"

    cache_key_parts = [
        opt.lstrip("-"),
        lto_slug,
        exc_slug,
        thread_slug,
        _filter_hash()[:8],
        _git_commit(OCCT_ROOT)[:6],
    ]

    provenance = {
        "schema": "wasm-build-provenance-v1",
        "buildId": build_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),

        "toolchain": {
            "emscripten": _get_emscripten_version(),
            "llvm": _get_llvm_version(),
            "wasmOpt": _get_wasm_opt_version(),
            "python": _get_python_version(),
        },

        "source": {
            "occtCommit": _git_commit(OCCT_ROOT),
            "opencascadejsCommit": _git_commit(OCJS_ROOT),
            "filterPackagesHash": _filter_hash(),
            "pinnedDeps": _load_deps_json(),
        },

        "compilation": {
            "cacheKey": "-".join(cache_key_parts),
            "cacheHit": False,
            "optimization": opt,
            "lto": lto,
            "exceptions": exc_mode,
            "threading": threading,
            "wasmOptLevel": os.environ.get("OCJS_WASM_OPT_LEVEL", "-O3"),
            "emccCompileFlags": _build_compile_flags(opt, lto, exceptions),
            "sourceFiles": 0,
            "bindingFiles": 0,
            "compileDuration_s": 0,
        },

        "linking": {},
        "postProcessing": {},
        "output": {},
        "sections": {},

        "filtering": {
            "excludedPackages": _get_filtered_packages(),
        },
    }

    _save(provenance)


def add_compilation(cache_hit: bool = False, duration: int = 0) -> None:
    prov = _load()
    if not prov:
        return

    comp = prov.get("compilation", {})
    comp["cacheHit"] = cache_hit
    comp["compileDuration_s"] = duration
    comp["sourceFiles"] = _count_files(os.path.join(BUILD_DIR, "sources"), ".o")
    comp["bindingFiles"] = _count_files(os.path.join(BUILD_DIR, "bindings"), ".o")
    prov["compilation"] = comp

    _save(prov)


def add_linking(
    yaml_config: str = "",
    yaml_hash: str = "",
    bound_symbols: int = 0,
    symbol_list: list = None,
    emcc_flags: list = None,
    link_duration: float = 0,
    wasm_opt_flags: list = None,
    pre_opt_size: int = 0,
    post_opt_size: int = 0,
    wasm_opt_duration: float = 0,
) -> None:
    prov = _load()
    if not prov:
        return

    prov["linking"] = {
        "yamlConfig": os.path.basename(yaml_config) if yaml_config else "",
        "yamlConfigHash": yaml_hash,
        "boundSymbols": bound_symbols,
        "symbolList": symbol_list or [],
        "emccFlags": emcc_flags or [],
        "linkDuration_s": round(link_duration, 1),
    }

    opt_reduction = "0.0%"
    if pre_opt_size > 0 and post_opt_size > 0:
        reduction_pct = (1 - post_opt_size / pre_opt_size) * 100
        opt_reduction = f"{reduction_pct:.1f}%"

    prov["postProcessing"] = {
        "wasmOptFlags": wasm_opt_flags or [],
        "preOptSize": pre_opt_size,
        "postOptSize": post_opt_size,
        "optReduction": opt_reduction,
        "wasmOptDuration_s": round(wasm_opt_duration, 1),
    }

    _save(prov)


def finalize(wasm_dir: str = "", total_duration: int = 0) -> None:
    prov = _load()
    if not prov:
        return

    prov["totalDuration_s"] = total_duration

    if wasm_dir and os.path.isdir(wasm_dir):
        wasm_files = [f for f in os.listdir(wasm_dir) if f.endswith(".wasm")]
        js_files = [f for f in os.listdir(wasm_dir) if f.endswith(".js") and not f.endswith(".d.ts")]
        dts_files = [f for f in os.listdir(wasm_dir) if f.endswith(".d.ts")]

        outputs = {}
        for wf in wasm_files:
            full = os.path.join(wasm_dir, wf)
            size = _stat_file(full)
            sha = _file_hash(full)
            outputs[wf] = {
                "size": size,
                "sha256": sha[:16],
            }

            sections = _wasm_sections(full)
            if sections:
                prov["sections"][wf] = sections

        for jf in js_files:
            outputs[jf] = {"size": _stat_file(os.path.join(wasm_dir, jf))}
        for df in dts_files:
            full = os.path.join(wasm_dir, df)
            line_count = 0
            try:
                with open(full) as f:
                    line_count = sum(1 for _ in f)
            except (FileNotFoundError, UnicodeDecodeError):
                pass
            outputs[df] = {"size": _stat_file(full), "lines": line_count}

        prov["output"] = outputs

    dest = os.path.join(wasm_dir, "provenance.json") if wasm_dir else PROVENANCE_FILE
    with open(PROVENANCE_FILE, "w") as f:
        json.dump(prov, f, indent=2)
    if dest != PROVENANCE_FILE:
        import shutil
        shutil.copy2(PROVENANCE_FILE, dest)
        print(f"Provenance written to {dest}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: provenance.py <init|add-compilation|add-linking|finalize> [args...]")
        sys.exit(1)

    command = sys.argv[1]

    if command == "init":
        init()
    elif command == "add-compilation":
        cache_hit = "--cache-hit" in sys.argv
        duration = 0
        if "--duration" in sys.argv:
            idx = sys.argv.index("--duration")
            if idx + 1 < len(sys.argv):
                duration = int(sys.argv[idx + 1])
        add_compilation(cache_hit=cache_hit, duration=duration)
    elif command == "add-linking":
        kwargs = {}
        args = sys.argv[2:]
        i = 0
        while i < len(args):
            if args[i] == "--yaml" and i + 1 < len(args):
                kwargs["yaml_config"] = args[i + 1]
                i += 2
            elif args[i] == "--symbols" and i + 1 < len(args):
                kwargs["bound_symbols"] = int(args[i + 1])
                i += 2
            elif args[i] == "--pre-size" and i + 1 < len(args):
                kwargs["pre_opt_size"] = int(args[i + 1])
                i += 2
            elif args[i] == "--post-size" and i + 1 < len(args):
                kwargs["post_opt_size"] = int(args[i + 1])
                i += 2
            else:
                i += 1
        add_linking(**kwargs)
    elif command == "finalize":
        wasm_dir = ""
        duration = 0
        args = sys.argv[2:]
        i = 0
        while i < len(args):
            if args[i] == "--wasm-dir" and i + 1 < len(args):
                wasm_dir = args[i + 1]
                i += 2
            elif args[i] == "--duration" and i + 1 < len(args):
                duration = int(args[i + 1])
                i += 2
            else:
                i += 1
        finalize(wasm_dir=wasm_dir, total_duration=duration)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()

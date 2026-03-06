"""
Build cache management for WASM compilation artifacts.

Provides config-keyed caching of compiled .o files, PCH, and flat includes.
The cache key is derived from all inputs that affect .o file output:
  OCJS_OPT, OCJS_LTO, OCJS_EXCEPTIONS, THREADING, filterPackages.py hash, OCCT commit.

Cache entries live under cache/<key>/ and are symlinked into build/ so that
compilation writes directly into the cache — no post-compile copy required.

Usage (from build-wasm.sh):
  python3 src/build-cache.py compute-key          # Print cache key
  python3 src/build-cache.py setup <key>           # Symlink cache/<key>/ → build/ (creates entry on miss)
  python3 src/build-cache.py finalize <key>        # Mark entry complete + write manifest
  python3 src/build-cache.py list                  # List all cached compilations
  python3 src/build-cache.py gc [max_entries]      # Garbage collect old entries
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

OCJS_ROOT = os.environ.get("OCJS_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OCCT_ROOT = os.environ.get("OCCT_ROOT", "")
CACHE_DIR = os.path.join(OCJS_ROOT, "cache")
BUILD_DIR = os.path.join(OCJS_ROOT, "build")
INDEX_FILE = os.path.join(CACHE_DIR, "index.json")

CACHED_SUBDIRS = ["bindings", "sources", "occt-includes"]
CACHED_FILES = ["pch.h", "pch.h.pch"]

COMPLETE_MARKER = ".complete"


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _occt_commit() -> str:
    if not OCCT_ROOT or not os.path.isdir(OCCT_ROOT):
        return "unknown"
    try:
        result = subprocess.run(
            ["git", "-C", OCCT_ROOT, "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout.strip()[:12] if result.returncode == 0 else "unknown"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "unknown"


def _filter_hash() -> str:
    filter_file = os.path.join(OCJS_ROOT, "src", "filter", "filterPackages.py")
    if os.path.exists(filter_file):
        return _file_hash(filter_file)[:8]
    return "nofilter"


def _opt_slug(opt: str) -> str:
    return opt.lstrip("-")


def compute_key() -> str:
    opt = os.environ.get("OCJS_OPT", "-O2")
    lto = "LTO" if os.environ.get("OCJS_LTO", "1") == "1" else "noLTO"
    exc = "wasmExc" if os.environ.get("OCJS_EXCEPTIONS", "0") == "1" else "noExc"
    threading = os.environ.get("THREADING", "single-threaded")
    thread_slug = "multi" if "multi" in threading else "single"
    filt = _filter_hash()
    occt = _occt_commit()[:6]
    emcc_ver = _get_emscripten_version()

    defines = os.environ.get("OCJS_DEFINES", "")
    undefines = os.environ.get("OCJS_UNDEFINES", "")
    extra = f"{defines}|{undefines}"
    extra_hash = hashlib.sha256(extra.encode()).hexdigest()[:6] if extra != "|" else ""

    key_parts = [
        _opt_slug(opt), lto, exc, thread_slug, filt, occt, f"em{emcc_ver}",
    ]
    if extra_hash:
        key_parts.append(extra_hash)
    return "-".join(key_parts)


def _load_index() -> dict:
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE) as f:
            return json.load(f)
    return {}


def _save_index(index: dict) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(INDEX_FILE, "w") as f:
        json.dump(index, f, indent=2)


def _dir_size(path: str) -> int:
    total = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for fname in filenames:
            fp = os.path.join(dirpath, fname)
            if not os.path.islink(fp):
                total += os.path.getsize(fp)
            else:
                total += 128
    return total


def _count_files(path: str, ext: str) -> int:
    count = 0
    for _dirpath, _dirnames, filenames in os.walk(path):
        for fname in filenames:
            if fname.endswith(ext):
                count += 1
    return count


def _is_complete(cache_entry: str) -> bool:
    return os.path.exists(os.path.join(cache_entry, COMPLETE_MARKER))


def setup(key: str) -> bool:
    """Symlink cache/<key>/ subdirs into build/. Returns True if cache hit."""
    cache_entry = os.path.join(CACHE_DIR, key)
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)

    hit = os.path.isdir(cache_entry) and _is_complete(cache_entry)

    if not hit:
        # Cache miss: create fresh cache entry dirs (remove incomplete leftovers)
        if os.path.exists(cache_entry):
            shutil.rmtree(cache_entry)
        os.makedirs(cache_entry)
        for subdir in CACHED_SUBDIRS:
            os.makedirs(os.path.join(cache_entry, subdir), exist_ok=True)

    # Point build/ subdirs at the cache entry via symlinks
    for subdir in CACHED_SUBDIRS:
        build_path = os.path.join(BUILD_DIR, subdir)
        cache_path = os.path.join(cache_entry, subdir)

        # Remove whatever is currently at build/<subdir>
        if os.path.islink(build_path):
            os.unlink(build_path)
        elif os.path.isdir(build_path):
            shutil.rmtree(build_path)

        os.symlink(cache_path, build_path)

    # For cached files (pch.h, pch.h.pch), copy from cache on hit
    if hit:
        for fname in CACHED_FILES:
            src = os.path.join(cache_entry, fname)
            dst = os.path.join(BUILD_DIR, fname)
            if os.path.isfile(src):
                shutil.copy2(src, dst)

    if hit:
        # Update hit count
        index = _load_index()
        if key in index:
            index[key]["hitCount"] = index[key].get("hitCount", 0) + 1
            index[key]["lastUsed"] = datetime.now(timezone.utc).isoformat()
            _save_index(index)
        print(f"Cache restored: {key} (symlinked)")

    return hit


def finalize(key: str) -> None:
    """Mark a cache entry as complete and write manifest + index."""
    cache_entry = os.path.join(CACHE_DIR, key)

    if not os.path.isdir(cache_entry):
        print(f"WARNING: cache entry {key} does not exist, skipping finalize")
        return

    # Copy PCH files into cache entry for future restores
    for fname in CACHED_FILES:
        src = os.path.join(BUILD_DIR, fname)
        dst = os.path.join(cache_entry, fname)
        if os.path.isfile(src) and not os.path.islink(src):
            shutil.copy2(src, dst)

    total_size = _dir_size(cache_entry)

    manifest = {
        "cacheKey": key,
        "created": datetime.now(timezone.utc).isoformat(),
        "config": {
            "OCJS_OPT": os.environ.get("OCJS_OPT", "-O2"),
            "OCJS_LTO": os.environ.get("OCJS_LTO", "1"),
            "OCJS_EXCEPTIONS": os.environ.get("OCJS_EXCEPTIONS", "0"),
            "THREADING": os.environ.get("THREADING", "single-threaded"),
        },
        "occtCommit": _occt_commit(),
        "filterHash": _filter_hash(),
        "emscriptenVersion": _get_emscripten_version(),
        "stats": {
            "bindingObjectFiles": _count_files(os.path.join(cache_entry, "bindings"), ".o"),
            "sourceObjectFiles": _count_files(os.path.join(cache_entry, "sources"), ".o"),
            "totalSizeBytes": total_size,
        },
    }
    with open(os.path.join(cache_entry, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    # Write completion marker (must be last)
    Path(os.path.join(cache_entry, COMPLETE_MARKER)).touch()

    index = _load_index()
    index[key] = {
        "created": manifest["created"],
        "totalSizeBytes": total_size,
        "hitCount": 0,
        "lastUsed": manifest["created"],
    }
    _save_index(index)

    size_gb = total_size / (1024 ** 3)
    print(f"Cache finalized: {key} ({size_gb:.1f} GB)")


def list_entries() -> None:
    index = _load_index()
    if not index:
        print("Cache is empty.")
        return

    print(f"{'Cache Key':<50} {'Size':>8} {'Hits':>5} {'Created':<25}")
    print("─" * 95)

    for key, info in sorted(index.items(), key=lambda x: x[1].get("lastUsed", ""), reverse=True):
        size_gb = info.get("totalSizeBytes", 0) / (1024 ** 3)
        hits = info.get("hitCount", 0)
        created = info.get("created", "?")[:19]
        cache_path = os.path.join(CACHE_DIR, key)
        if not os.path.isdir(cache_path):
            status = "!!"
        elif not _is_complete(cache_path):
            status = "? "
        else:
            status = "  "
        print(f"{status}{key:<48} {size_gb:>6.1f}GB {hits:>5} {created:<25}")


def gc(max_entries: int = 5) -> None:
    index = _load_index()

    orphan_count = 0
    if os.path.isdir(CACHE_DIR):
        skip = {"index.json"}
        for entry in os.listdir(CACHE_DIR):
            entry_path = os.path.join(CACHE_DIR, entry)
            if os.path.isdir(entry_path) and entry not in index:
                shutil.rmtree(entry_path)
                print(f"  Removed orphan: {entry}")
                orphan_count += 1
            elif os.path.isfile(entry_path) and entry not in skip:
                if entry.endswith(".storing") or entry.endswith(".restoring"):
                    os.remove(entry_path)
                    print(f"  Removed staging artifact: {entry}")

    # Remove incomplete entries from index
    incomplete = [k for k in index if not _is_complete(os.path.join(CACHE_DIR, k))]
    for k in incomplete:
        cache_path = os.path.join(CACHE_DIR, k)
        if os.path.isdir(cache_path):
            shutil.rmtree(cache_path)
        del index[k]
        print(f"  Removed incomplete: {k}")

    if len(index) <= max_entries:
        msg = f"Cache has {len(index)} entries (limit: {max_entries}), nothing to evict."
        if orphan_count or incomplete:
            msg += f" Cleaned {orphan_count} orphans, {len(incomplete)} incomplete."
        print(msg)
        _save_index(index)
        return

    sorted_entries = sorted(index.items(), key=lambda x: x[1].get("lastUsed", ""))
    to_remove = sorted_entries[:len(index) - max_entries]

    for key, _info in to_remove:
        cache_entry = os.path.join(CACHE_DIR, key)
        if os.path.isdir(cache_entry):
            shutil.rmtree(cache_entry)
        del index[key]
        print(f"  Removed: {key}")

    _save_index(index)
    print(f"GC complete: removed {len(to_remove)} entries + {orphan_count} orphans, {len(index)} remaining.")


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


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: build-cache.py <compute-key|setup|finalize|list|gc> [args...]")
        sys.exit(1)

    command = sys.argv[1]

    if command == "compute-key":
        print(compute_key())
    elif command == "setup":
        if len(sys.argv) < 3:
            print("Usage: build-cache.py setup <key>")
            sys.exit(1)
        hit = setup(sys.argv[2])
        sys.exit(0 if hit else 1)
    elif command == "finalize":
        if len(sys.argv) < 3:
            print("Usage: build-cache.py finalize <key>")
            sys.exit(1)
        finalize(sys.argv[2])
    # Legacy aliases for backward compatibility
    elif command == "store":
        if len(sys.argv) < 3:
            print("Usage: build-cache.py store <key>")
            sys.exit(1)
        finalize(sys.argv[2])
    elif command == "restore":
        if len(sys.argv) < 3:
            print("Usage: build-cache.py restore <key>")
            sys.exit(1)
        if not setup(sys.argv[2]):
            sys.exit(1)
    elif command == "list":
        list_entries()
    elif command == "gc":
        max_e = int(sys.argv[2]) if len(sys.argv) > 2 else 5
        gc(max_e)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()

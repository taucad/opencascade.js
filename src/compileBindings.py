#!/usr/bin/python3

import json
import os
import subprocess
import multiprocessing
from functools import partial

from Common import OCJS_ROOT, PCH_FILE, getFlatIncludePaths, FLAT_INCLUDE_DIR, WASM_EXCEPTION_FLAGS, EXTRA_COMPILE_FLAGS
from filter.filterPackages import filterPackages

from argparse import ArgumentParser

libraryBasePath = OCJS_ROOT + "/build/bindings"

OPT_LEVEL = os.environ.get("OCJS_OPT", "-O0")
USE_LTO = os.environ.get("OCJS_LTO", "0") == "1"

_flat_include_paths = getFlatIncludePaths()
_use_pch = os.path.exists(PCH_FILE)

def _classify_error(stderr_text):
  """Classify a compilation error into a category from the stderr output."""
  if not stderr_text:
    return "unknown"
  text = stderr_text.lower()
  if "undefined symbol" in text or "undeclared identifier" in text:
    return "undefined_symbol"
  if "no matching function" in text or "no viable overload" in text:
    return "overload_resolution"
  if "incomplete type" in text:
    return "incomplete_type"
  if "no member named" in text:
    return "missing_member"
  if "template" in text and ("argument" in text or "instantiation" in text):
    return "template_error"
  if "private" in text or "protected" in text:
    return "access_specifier"
  if "error:" in text:
    return "compile_error"
  return "unknown"


def buildOneFile(args, item):
  if not os.path.exists(item + ".o"):
    print("building " + item, flush=True)
    exception_flags = WASM_EXCEPTION_FLAGS
    command = [
      "emcc",
      "-std=c++17",
      *(["-flto"] if USE_LTO else []),
      *exception_flags,
      *EXTRA_COMPILE_FLAGS,
      "-DIGNORE_NO_ATOMICS=1",
      "-DOCCT_NO_PLUGINS",
      "-frtti",
      "-DHAVE_RAPIDJSON",
      OPT_LEVEL,
      "-Wno-unused-parameter",
      "-Wno-unused-variable",
      "-Werror=return-type",
      "-Werror=non-virtual-dtor",
      "-pthread" if args["threading"] == "multi-threaded" else "",
      *(["-include-pch", PCH_FILE] if _use_pch else []),
      *["-I" + p for p in _flat_include_paths],
      "-c", item,
    ]
    command = [c for c in command if c]
    result = subprocess.run([*command, "-o", item + ".o"], capture_output=True, text=True)
    if result.returncode != 0:
      print("FAILED: " + item, flush=True)
      stderr_text = result.stderr or ""
      if stderr_text:
        lines = stderr_text.strip().split('\n')
        for line in lines[-5:]:
          print("  " + line, flush=True)
      error_type = _classify_error(stderr_text)
      first_error = ""
      for line in stderr_text.split('\n'):
        if "error:" in line:
          first_error = line.strip()
          break
      return {"status": "failed", "file": item, "error_type": error_type, "message": first_error}
    return {"status": "succeeded", "file": item}
  else:
    return {"status": "cached", "file": item}

def compileCustomCodeBindings(args):
  filesToBuild = []
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/myMain.h"):
    filesToBuild.extend(map(lambda x: dirpath + "/" + x, filter(lambda x: x.endswith(".cpp"), filenames)))

  with multiprocessing.Pool(processes=int(multiprocessing.cpu_count() / 1)) as p:
    p.map(partial(buildOneFile, args), sorted(filesToBuild))

def _is_filtered_binding(filepath):
  """Check if a binding file belongs to a filtered package."""
  rel = filepath.replace(libraryBasePath + "/", "")
  parts = rel.split("/")
  for part in parts:
    if not filterPackages(part):
      return True
  return False

if __name__ == "__main__":
  parser = ArgumentParser()
  parser.add_argument(dest="threading", choices=["single-threaded", "multi-threaded"], help="Build in single vs. multi-threaded mode")
  args = parser.parse_args()

  filesToBuild = []
  for dirpath, dirnames, filenames in os.walk(libraryBasePath):
    for f in filenames:
      if f.endswith(".cpp"):
        fullpath = dirpath + "/" + f
        if not _is_filtered_binding(fullpath):
          filesToBuild.append(fullpath)

  if _use_pch:
    print(f"Using PCH: {PCH_FILE}")
  else:
    print("WARNING: No PCH found -- compilation will be ~25x slower. Run buildPch.py first.")
  print(f"Using flat includes: {FLAT_INCLUDE_DIR}")

  nproc = min(multiprocessing.cpu_count(), 16)
  print(f"Compiling {len(filesToBuild)} binding files with {nproc} workers...", flush=True)
  with multiprocessing.Pool(processes=nproc) as p:
    results = p.map(partial(buildOneFile, {
      "threading": args.threading,
    }), sorted(filesToBuild))

  succeeded = sum(1 for r in results if r["status"] == "succeeded")
  cached = sum(1 for r in results if r["status"] == "cached")
  failed = sum(1 for r in results if r["status"] == "failed")
  total = len(results)

  failure_details = [r for r in results if r["status"] == "failed"]
  error_categories = {}
  for f in failure_details:
    cat = f.get("error_type", "unknown")
    error_categories.setdefault(cat, []).append(f["file"])

  print(f"\nBinding compilation summary:")
  print(f"  Total:     {total}")
  print(f"  Succeeded: {succeeded}")
  print(f"  Cached:    {cached}")
  print(f"  Failed:    {failed}")
  if error_categories:
    print(f"  Failure breakdown:")
    for cat, files in sorted(error_categories.items(), key=lambda x: -len(x[1])):
      print(f"    {cat}: {len(files)}")
  if failed > 0:
    print(f"  ({failed} failures are expected \u2014 not all OCCT classes compile with embind)")
    print(f"  Required bindings will be verified during the link step.")

  report = {
    "total": total,
    "succeeded": succeeded,
    "cached": cached,
    "failed": failed,
    "error_categories": {cat: len(files) for cat, files in error_categories.items()},
    "failures": [
      {"file": os.path.basename(r["file"]), "error_type": r.get("error_type", "unknown"), "message": r.get("message", "")}
      for r in failure_details
    ],
  }
  report_path = os.path.join(OCJS_ROOT, "build", "binding-report.json")
  os.makedirs(os.path.dirname(report_path), exist_ok=True)
  with open(report_path, "w") as rf:
    json.dump(report, rf, indent=2)
  print(f"\nBinding report written to {report_path}")

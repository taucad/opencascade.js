#!/usr/bin/python3

import os
from Common import OCJS_ROOT, PCH_FILE, getFlatIncludePaths, FLAT_INCLUDE_DIR, WASM_EXCEPTION_FLAGS, EXTRA_COMPILE_FLAGS
from filter.filterPackages import filterPackages
import subprocess
import multiprocessing
from functools import partial

from argparse import ArgumentParser

libraryBasePath = OCJS_ROOT + "/build/bindings"

OPT_LEVEL = os.environ.get("OCJS_OPT", "-O0")
USE_LTO = os.environ.get("OCJS_LTO", "0") == "1"

_flat_include_paths = getFlatIncludePaths()
_use_pch = os.path.exists(PCH_FILE)

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
      "-w",
      "-pthread" if args["threading"] == "multi-threaded" else "",
      *(["-include-pch", PCH_FILE] if _use_pch else []),
      *["-I" + p for p in _flat_include_paths],
      "-c", item,
    ]
    command = [c for c in command if c]
    result = subprocess.run([*command, "-o", item + ".o"], capture_output=True, text=True)
    if result.returncode != 0:
      print("FAILED: " + item, flush=True)
      if result.stderr:
        lines = result.stderr.strip().split('\n')
        for line in lines[-5:]:
          print("  " + line, flush=True)
      return False
    return True
  else:
    return True

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

  nproc = min(multiprocessing.cpu_count(), 8)
  print(f"Compiling {len(filesToBuild)} binding files with {nproc} workers...", flush=True)
  with multiprocessing.Pool(processes=nproc) as p:
    results = p.map(partial(buildOneFile, {
      "threading": args.threading,
    }), sorted(filesToBuild))
  succeeded = sum(1 for r in results if r is True)
  failed = sum(1 for r in results if r is False)
  skipped = sum(1 for r in results if r is None)
  print(f"\nBinding compilation: {succeeded} succeeded, {failed} failed, {skipped} skipped out of {len(filesToBuild)}")
  if failed > 0:
    print(f"  ({failed} failures are expected — not all OCCT classes compile with embind)")
    print(f"  Required bindings will be verified during the link step.")

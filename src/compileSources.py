#!/usr/bin/python3

import os
import re
import subprocess
import multiprocessing
from functools import partial

from filter.filterSourceFiles import filterSourceFile
from filter.filterPackages import filterPackages

from argparse import ArgumentParser

from Common import OCJS_ROOT, OCCT_ROOT, FLAT_INCLUDE_DIR, getFlatIncludePaths, WASM_EXCEPTION_FLAGS, EXTRA_COMPILE_FLAGS

libraryBasePath = OCJS_ROOT + "/build/sources"
sourceBasePath = OCCT_ROOT + "/src/"

OPT_LEVEL = os.environ.get("OCJS_OPT", "-O0")
USE_LTO = os.environ.get("OCJS_LTO", "0") == "1"

_flat_include_paths = getFlatIncludePaths()

def _parse_packages_cmake(filepath):
  """Parse a PACKAGES.cmake file and extract package names."""
  packages = []
  with open(filepath, "r") as f:
    content = f.read()
  match = re.search(r'set\(OCCT_\w+_LIST_OF_PACKAGES\s+(.*?)\)', content, re.DOTALL)
  if match:
    for line in match.group(1).strip().split('\n'):
      name = line.strip()
      if name and not name.startswith('#'):
        packages.append(name)
  return packages

# Single walk to build: allModules, packageToModule reverse map, filesToBuild
allModules = {}
_packageToModule = {}
filesToBuild = []

for dirpath, dirnames, filenames in os.walk(sourceBasePath):
  dirName = os.path.basename(dirpath)
  if dirName and not filterPackages(dirName):
    dirnames.clear()
    continue

  if "PACKAGES.cmake" in filenames:
    toolkit_name = dirName
    packages = _parse_packages_cmake(os.path.join(dirpath, "PACKAGES.cmake"))
    allModules[toolkit_name] = packages
    for pkg in packages:
      _packageToModule[pkg.strip()] = toolkit_name

  packageOrModuleName = os.path.basename(dirpath.replace(sourceBasePath, ""))
  for item in filenames:
    if not filterPackages(packageOrModuleName):
      continue
    moduleName = _packageToModule.get(packageOrModuleName, "")
    if moduleName and not filterPackages(moduleName):
      continue
    if filterSourceFile(os.path.join(dirpath, item)):
      filesToBuild.append(os.path.join(dirpath, item))

def getModuleNameByPackageName(inputPackageName):
  return _packageToModule.get(inputPackageName, "")

def buildObjectFiles(args, file):
  relativeFile = file.replace(sourceBasePath, "")
  outFile = os.path.join(libraryBasePath, relativeFile + ".o")

  if os.path.exists(outFile):
    return True

  os.makedirs(os.path.join(libraryBasePath, os.path.dirname(relativeFile)), exist_ok=True)

  print("Building " + relativeFile, flush=True)
  is_c_file = file.endswith(".c")
  exception_flags = WASM_EXCEPTION_FLAGS
  command = [
    "emcc",
    *(["-std=c17"] if is_c_file else ["-std=c++17"]),
    *(["-flto"] if USE_LTO else []),
    *([] if is_c_file else exception_flags),
    *EXTRA_COMPILE_FLAGS,
    "-DIGNORE_NO_ATOMICS=1",
    "-DOCCT_NO_PLUGINS",
    *([] if is_c_file else ["-frtti"]),
    *(["-Wno-error=implicit-function-declaration"] if is_c_file else []),
    "-DHAVE_RAPIDJSON",
    OPT_LEVEL,
    "-Wno-unused-parameter",
    "-Wno-unused-variable",
    "-Wno-deprecated-declarations",
    "-Wno-non-virtual-dtor",
    "-Werror=return-type",
    "-pthread" if args["threading"] == "multi-threaded" else "",
    *["-I" + p for p in _flat_include_paths],
    "-c", file,
    "-o", outFile,
  ]
  command = [c for c in command if c]

  result = subprocess.run(command, capture_output=True, text=True)
  if result.returncode != 0:
    print("FAILED: " + relativeFile, flush=True)
    if result.stderr:
      lines = result.stderr.strip().split('\n')
      for line in lines[-5:]:
        print("  " + line, flush=True)
    return False
  return True

if __name__ == "__main__":
  parser = ArgumentParser()
  parser.add_argument(dest="threading", choices=["single-threaded", "multi-threaded"], help="Build in single vs. multi-threaded mode")
  args = parser.parse_args()

  os.makedirs(libraryBasePath, exist_ok=True)

  print(f"Using flat includes: {FLAT_INCLUDE_DIR}")

  nproc = min(multiprocessing.cpu_count(), 16)
  print(f"Compiling {len(filesToBuild)} source files with {nproc} workers...", flush=True)
  with multiprocessing.Pool(processes=nproc) as p:
    results = p.map(partial(buildObjectFiles, {"threading": args.threading}), filesToBuild)
  succeeded = sum(1 for r in results if r is True)
  failed = sum(1 for r in results if r is False)
  print(f"\nSource compilation: {succeeded} succeeded, {failed} failed out of {len(filesToBuild)}", flush=True)
  if failed > 0:
    import sys
    sys.exit(1)

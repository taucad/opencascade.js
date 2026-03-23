from filter.filterIncludeFiles import filterIncludeFile
from filter.filterPackages import filterPackages
from typing import Set, List, Tuple
import os
import platform
import subprocess

OCJS_ROOT = os.environ.get("OCJS_ROOT", "/opencascade.js")
OCCT_ROOT = os.environ.get("OCCT_ROOT", "/occt")
RAPIDJSON_ROOT = os.environ.get("RAPIDJSON_ROOT", "/rapidjson")
FREETYPE_ROOT = os.environ.get("FREETYPE_ROOT", "/freetype")
EMSDK_ROOT = os.environ.get("EMSDK", "/emsdk")
USE_WASM_EXCEPTIONS = os.environ.get("OCJS_EXCEPTIONS", "0") == "1"
_EH_MODE = os.environ.get("OCJS_EH_MODE", "wasm")
if USE_WASM_EXCEPTIONS:
  WASM_EXCEPTION_FLAGS = ["-fexceptions"] if _EH_MODE == "js" else ["-fwasm-exceptions"]
  WASM_EXCEPTION_FLAGS.append("-DOCJS_EXCEPTIONS_ENABLED=1")
else:
  WASM_EXCEPTION_FLAGS = ["-sSUPPORT_LONGJMP=0", "-sDISABLE_EXCEPTION_CATCHING=1"]

USE_SIMD = os.environ.get("OCJS_SIMD", "0") == "1"
SIMD_FLAGS = ["-msimd128", "-mrelaxed-simd"] if USE_SIMD else []

def _parse_extra_compile_flags():
  flags = []
  defines = os.environ.get("OCJS_DEFINES", "")
  if defines:
    flags.extend(f"-D{d.strip()}" for d in defines.split(",") if d.strip())
  undefines = os.environ.get("OCJS_UNDEFINES", "")
  if undefines:
    flags.extend(f"-U{u.strip()}" for u in undefines.split(",") if u.strip())
  return flags

EXTRA_COMPILE_FLAGS = _parse_extra_compile_flags()

occtBasePath = OCCT_ROOT + "/src/"

BUILD_DIR = os.environ.get("BUILD_DIR", OCJS_ROOT + "/build")

FLAT_INCLUDE_DIR = BUILD_DIR + "/occt-includes"
PCH_HEADER = BUILD_DIR + "/pch.h"
PCH_FILE = BUILD_DIR + "/pch.h.pch"
BUILD_FLAGS_PATH = BUILD_DIR + "/build-flags.json"

_BUILD_FLAG_KEYS = [
  "OCJS_OPT", "OCJS_LTO", "OCJS_EXCEPTIONS", "OCJS_EH_MODE",
  "OCJS_SIMD", "THREADING", "OCJS_DEFINES", "OCJS_UNDEFINES",
]

_BUILD_FLAG_DEFAULTS = {
  "OCJS_OPT": "-O2",
  "OCJS_LTO": "1",
  "OCJS_EXCEPTIONS": "0",
  "OCJS_EH_MODE": "wasm",
  "OCJS_SIMD": "0",
  "THREADING": "single-threaded",
  "OCJS_DEFINES": "",
  "OCJS_UNDEFINES": "",
}


class BuildFlagMismatch(Exception):
  pass


def _current_build_flags() -> dict:
  return {k: os.environ.get(k, _BUILD_FLAG_DEFAULTS[k]) for k in _BUILD_FLAG_KEYS}


def write_build_flags(path: str = "") -> None:
  import json
  from datetime import datetime, timezone
  if not path:
    path = BUILD_FLAGS_PATH
  flags = _current_build_flags()
  flags["timestamp"] = datetime.now(timezone.utc).isoformat()
  os.makedirs(os.path.dirname(path), exist_ok=True)
  with open(path, "w") as f:
    json.dump(flags, f, indent=2)
  print(f"Build flags written to {path}")


def validate_build_flags(path: str = "") -> None:
  import json
  if not path:
    path = BUILD_FLAGS_PATH
  if not os.path.isfile(path):
    return
  with open(path) as f:
    stored = json.load(f)
  current = _current_build_flags()
  mismatches = []
  for key in _BUILD_FLAG_KEYS:
    stored_val = stored.get(key, _BUILD_FLAG_DEFAULTS[key])
    current_val = current[key]
    if stored_val != current_val:
      mismatches.append((key, current_val, stored_val))
  if not mismatches:
    return
  lines = [
    "ERROR: Build flag mismatch — artifacts in build/ were compiled with different settings.",
    "",
    f"  {'Flag':<20s} {'Environment':<20s} {'build/build-flags.json':<25s}",
    f"  {'─' * 20} {'─' * 20} {'─' * 25}",
  ]
  for key, cur, stored_val in mismatches:
    lines.append(f"  {key:<20s} {cur:<20s} {stored_val:<25s}")
  lines.extend([
    "",
    "Artifacts cannot be mixed across different compile-flag configurations.",
    "",
    "To fix, choose one of:",
    "  1. Rebuild everything:  ./build-wasm.sh full <yaml>",
    "  2. Rebuild from PCH:    ./build-wasm.sh pch bindings link <yaml>",
  ])
  example_key, example_val, _ = mismatches[0]
  lines.append(f"  3. Match the artifacts: export {example_key}={stored.get(example_key, '')}")
  msg = "\n".join(lines)
  raise BuildFlagMismatch(msg)

_DEPRECATED_DIR = "Deprecated"

def _load_excluded_includes() -> Set[str]:
  """Load excluded include files from bindgen-filters.yaml."""
  config_path = os.environ.get("OCJS_BINDGEN_CONFIG", os.path.join(OCJS_ROOT, "bindgen-filters.yaml"))
  if not os.path.isfile(config_path):
    return set()
  try:
    import yaml
    with open(config_path) as f:
      cfg = yaml.safe_load(f)
    return set(cfg.get("exclude", {}).get("headers", []))
  except Exception:
    return set()

_EXCLUDED_INCLUDES = _load_excluded_includes()

def getGlobalIncludes() -> Tuple[List[str], List[str], List[str]]:
  """Discover OCCT headers from non-filtered packages for PCH generation.

  Uses filterPackages to avoid including platform-specific headers (OpenGL,
  D3D, etc.) that won't compile under emscripten. The flat include directory
  (built separately by buildFlatIncludes) contains ALL headers for resolving
  transitive #include dependencies.
  """
  includeFiles = list()
  deprecatedIncludeFiles = list()
  additionalIncludePaths = list()
  for dirpath, dirnames, filenames in os.walk(occtBasePath):
    dirName = os.path.basename(dirpath)
    if dirName and not filterPackages(dirName):
      dirnames.clear()
      continue
    additionalIncludePaths.append(str(dirpath))
    is_deprecated = ("/" + _DEPRECATED_DIR + "/") in dirpath or dirpath.endswith("/" + _DEPRECATED_DIR)
    for item in filenames:
      if filterIncludeFile(item) and item not in _EXCLUDED_INCLUDES:
        filepath = str(os.path.join(dirpath, item))
        if is_deprecated:
          deprecatedIncludeFiles.append(filepath)
        else:
          includeFiles.append(filepath)
  return [includeFiles, additionalIncludePaths, deprecatedIncludeFiles]

[ocIncludeFiles, ocIncludePaths, ocDeprecatedIncludeFiles] = getGlobalIncludes()

additionalIncludePaths = [
  RAPIDJSON_ROOT + "/include",
  FREETYPE_ROOT + "/include/freetype",
  FREETYPE_ROOT + "/include",
  OCJS_ROOT + "/src",
]

def _get_system_cxx_include_paths():
  """Get system C++ include paths for libclang parsing.

  The pip libclang (v18) cannot parse emsdk Clang 23's headers, causing
  template types like occ::handle<T> to silently degrade to int.
  Using the system libc++ + Clang built-in headers resolves this.
  """
  if platform.system() == "Darwin":
    paths = []
    try:
      sdk = subprocess.run(
        ["xcrun", "--show-sdk-path"],
        capture_output=True, text=True, timeout=5,
      ).stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
      sdk = ""

    if sdk:
      cxx_inc = os.path.join(sdk, "usr", "include", "c++", "v1")
      if os.path.isdir(cxx_inc):
        paths.append(cxx_inc)
      sys_inc = os.path.join(sdk, "usr", "include")
      if os.path.isdir(sys_inc):
        paths.append(sys_inc)

    try:
      res_dir = subprocess.run(
        ["clang", "-print-resource-dir"],
        capture_output=True, text=True, timeout=5,
      ).stdout.strip()
      clang_inc = os.path.join(res_dir, "include")
      if os.path.isdir(clang_inc):
        paths.append(clang_inc)
    except (FileNotFoundError, subprocess.TimeoutExpired):
      pass

    return paths
  return None

def _get_emsdk_include_paths():
  sys_paths = _get_system_cxx_include_paths()
  if sys_paths:
    return sys_paths

  paths = [
    EMSDK_ROOT + "/upstream/emscripten/system/include/",
    EMSDK_ROOT + "/upstream/emscripten/system/lib/libcxx/include/",
    EMSDK_ROOT + "/upstream/emscripten/system/lib/libcxx/include/__support/newlib/",
  ]
  clang_base = EMSDK_ROOT + "/upstream/lib/clang/"
  if os.path.isdir(clang_base):
    clang_versions = next(os.walk(clang_base))[1]
    if clang_versions:
      paths.append(clang_base + clang_versions[0] + "/include/")
  if platform.system() == "Linux":
    gcc_path = "/usr/lib/gcc/x86_64-linux-gnu/8/include-fixed/"
    if os.path.isdir(gcc_path):
      paths.append(gcc_path)
  return paths

includePathArgs = list(dict.fromkeys(
  ["-I" + p for p in ocIncludePaths] +
  ["-I" + FLAT_INCLUDE_DIR] +
  ["-I" + p for p in _get_emsdk_include_paths()] +
  ["-I" + p for p in additionalIncludePaths]
))

ocIncludeStatements = os.linesep.join(map(lambda x: "#include \"" + os.path.basename(x) + "\"", list(sorted(ocIncludeFiles))))
_SAFE_DEPRECATED_PREFIXES = [
  "TColgp_", "TColStd_Array", "TColStd_HArray",
  "TColStd_List", "TColStd_Sequence",
  "TopTools_", "Poly_Array", "Poly_HArray",
  "NCollection_BaseList",
]
_safeDeprecatedIncludes = [h for h in sorted(ocDeprecatedIncludeFiles) if any(os.path.basename(h).startswith(p) for p in _SAFE_DEPRECATED_PREFIXES)]
ocAllIncludeStatements = os.linesep.join(map(lambda x: "#include \"" + os.path.basename(x) + "\"", list(sorted(ocIncludeFiles + _safeDeprecatedIncludes))))

def buildFlatIncludes():
  """Create a flat directory with symlinks to ALL OCCT headers.

  Includes headers from all packages (even filtered ones) because headers
  are needed for type resolution during compilation but don't affect WASM
  binary size. Package filtering is applied at the .o compile/link level.
  """
  import shutil
  if os.path.isdir(FLAT_INCLUDE_DIR):
    shutil.rmtree(FLAT_INCLUDE_DIR)
  os.makedirs(FLAT_INCLUDE_DIR)

  header_exts = {'.hxx', '.h', '.lxx', '.gxx', '.pxx'}
  count = 0
  for dirpath, dirnames, filenames in os.walk(occtBasePath):
    for fname in filenames:
      if os.path.splitext(fname)[1].lower() in header_exts:
        target = os.path.join(FLAT_INCLUDE_DIR, fname)
        if not os.path.exists(target):
          os.symlink(os.path.abspath(os.path.join(dirpath, fname)), target)
          count += 1
  print(f"Flat includes: {count} files symlinked into {FLAT_INCLUDE_DIR}/")
  return FLAT_INCLUDE_DIR

def _get_cmake_include_dir():
  """Return the CMake-collected OCCT include directory if it exists."""
  cmake_inc = os.path.join(OCJS_ROOT, "build", "occt-cmake", "include", "opencascade")
  if os.path.isdir(cmake_inc):
    return cmake_inc
  return None

def getFlatIncludePaths():
  """Return the minimal set of -I paths using the flat include directory.

  Prefers CMake-collected headers when available (from emcmake cmake build),
  falling back to the symlink-based flat include directory.
  """
  cmake_inc = _get_cmake_include_dir()
  paths = [FLAT_INCLUDE_DIR] + additionalIncludePaths
  if cmake_inc:
    paths.insert(0, cmake_inc)
  return paths

def _get_safe_deprecated_headers():
  """Return deprecated headers that compile cleanly with the PCH.

  Not all deprecated headers can compile (some reference removed types).
  Only include ones that are simple NCollection typedefs used by consumers.
  """
  safe = []
  for h in sorted(ocDeprecatedIncludeFiles):
    base = os.path.basename(h)
    if any(base.startswith(p) for p in [
      "TColgp_", "TColStd_Array", "TColStd_HArray",
      "TColStd_List", "TColStd_Sequence",
      "TopTools_", "Poly_Array", "Poly_HArray",
      "NCollection_BaseList",
    ]):
      safe.append(h)
  return safe

def buildPch(threading="single-threaded"):
  """Generate and precompile the unified header (PCH).

  Precompiles all OCCT headers once, so each binding file
  loads the binary PCH instead of reparsing them.
  Combined with flat includes, this gives ~25x compilation speedup.
  """
  safe_deprecated = _get_safe_deprecated_headers()
  with open(PCH_HEADER, "w") as f:
    f.write("#ifndef OCJS_PCH_H\n#define OCJS_PCH_H\n")
    f.write(ocIncludeStatements)
    for h in safe_deprecated:
      f.write(f'\n#include "{os.path.basename(h)}"')
    _occt_leaked_macros = ["CONSTRUCTOR", "DESTRUCTOR", "OPTIONAL", "DEFINE"]
    f.write("\n")
    for m in _occt_leaked_macros:
      f.write(f"#ifdef {m}\n#undef {m}\n#endif\n")
    f.write("#include <emscripten/bind.h>\n")
    f.write("#include <functional>\n")
    f.write("#endif\n")

  OPT_LEVEL = os.environ.get("OCJS_OPT", "-O0")
  USE_LTO = os.environ.get("OCJS_LTO", "0") == "1"
  flat_paths = getFlatIncludePaths()

  exception_flags = WASM_EXCEPTION_FLAGS
  command = [
    "emcc",
    "-std=c++17",
    *(["-flto"] if USE_LTO else []),
    *exception_flags,
    *SIMD_FLAGS,
    *EXTRA_COMPILE_FLAGS,
    "-DIGNORE_NO_ATOMICS=1",
    "-DOCCT_NO_PLUGINS",
    "-frtti",
    "-DHAVE_RAPIDJSON",
    OPT_LEVEL,
    "-Wno-unused-parameter",
    "-Wno-unused-variable",
    "-Wno-non-virtual-dtor",
    "-Wno-deprecated-declarations",
    "-Werror=return-type",
    "-pthread" if threading == "multi-threaded" else "",
    *["-I" + p for p in flat_paths],
    "-x", "c++-header",
    PCH_HEADER,
    "-o", PCH_FILE,
  ]
  command = [c for c in command if c]

  print(f"Building PCH ({len(ocIncludeFiles)} headers)...")
  result = subprocess.run(command, capture_output=True, text=True)
  if result.returncode != 0:
    print("PCH compilation failed!")
    print(result.stderr)
    raise RuntimeError("PCH compilation failed")

  size_mb = os.path.getsize(PCH_FILE) / (1024 * 1024)
  print(f"PCH ready: {PCH_FILE} ({size_mb:.0f} MB)")
  write_build_flags()

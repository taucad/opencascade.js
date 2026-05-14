#!/usr/bin/python3

import hashlib
import os
import re
import subprocess
import json
import time
import multiprocessing
from itertools import chain
import yaml
import shutil
from cerberus import Validator
from argparse import ArgumentParser
from Common import OCJS_ROOT, BUILD_DIR, getFlatIncludePaths, PCH_FILE, WASM_EXCEPTION_FLAGS, USE_WASM_EXCEPTIONS, SIMD_FLAGS, EXTRA_COMPILE_FLAGS, validate_build_flags, BuildFlagMismatch
from filter.filterPackages import filterPackages
try:
    import provenance as prov
except ImportError:
    prov = None

_yaml_config_hash = ""

# Built-in TypeScript / DOM / WebAssembly identifiers that may legally appear
# in type position. References that are NOT in this set AND NOT in the declared
# exports are replaced with `unknown` by `_replace_undeclared_with_unknown`.
_TS_BUILTIN_TYPES = frozenset({
  # Primitives & special
  "string", "number", "boolean", "void", "any", "unknown", "never",
  "null", "undefined", "bigint", "symbol", "object", "this",
  # Standard library generics & wrapper types
  "Array", "ReadonlyArray", "Promise", "Record", "Partial", "Required",
  "Readonly", "Pick", "Omit", "Exclude", "Extract", "NonNullable",
  "ReturnType", "Parameters", "ConstructorParameters", "InstanceType",
  "ThisParameterType", "OmitThisParameter", "ThisType",
  "Map", "Set", "WeakMap", "WeakSet", "Iterable", "Iterator",
  "IterableIterator", "AsyncIterable", "AsyncIterator", "Generator",
  "AsyncGenerator", "Function", "Object", "Date", "Error", "RegExp",
  "JSON", "Math", "console", "Symbol",
  # Typed arrays / ArrayBuffer family
  "ArrayBuffer", "ArrayBufferLike", "ArrayBufferView", "SharedArrayBuffer",
  "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array",
  "BigUint64Array", "Int8Array", "Int16Array", "Int32Array",
  "BigInt64Array", "Float32Array", "Float64Array", "DataView",
  # WebAssembly namespace (declared ambient elsewhere)
  "WebAssembly",
  # Common DOM lib types referenced from emscripten-runtime / FS bindings
  "FS", "HEAP8", "HEAPU8", "HEAP16", "HEAPU16", "HEAP32", "HEAPU32",
  "HEAPF32", "HEAPF64", "HEAP64", "HEAPU64",
})

# Identifiers that look like type references in source positions.
# Each pattern's first capture group is the candidate identifier.
_TYPE_REF_PATTERNS = (
  re.compile(r":\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s*[<\[|&;,)}\n])"),
  re.compile(r"=>\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s*[<\[|&;,)}\n])"),
  re.compile(r"<\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s*[,>])"),
  re.compile(r",\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s*[,>])"),
  re.compile(r"\btypeof\s+([A-Za-z_][A-Za-z0-9_]*)"),
)

# `extends`/`implements` clauses must reference a real class declaration —
# replacing with `unknown` produces TS2863. We instead re-link to the nearest
# declared ancestor (using the per-fragment ancestor metadata emitted by
# `bindings.py:_computeAncestorChain`), or drop the clause entirely when no
# ancestor in the chain is declared in the merged build.
_HERITAGE_RE = re.compile(
  r"(\b(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*))\s+extends\s+([A-Za-z_][A-Za-z0-9_]*)"
)


def _replace_undeclared_with_unknown(source: str, declared_names: set, ancestor_chains: dict | None = None) -> str:
  """Replace undeclared identifier references in TS type positions with `unknown`.

  Fragments are pre-rendered against the FULL bindgen filter set, so a per-build
  YAML subset (e.g. replicad_single) inherits references like `Standard_Type` that
  are not actually declared in this build. The compiler reports those as TS2304/
  TS2552 (`Cannot find name 'X'`).

  This pass walks the merged source, finds identifiers that appear in type
  position (after `:`, `extends`, `=>`, inside `<...>`, after `typeof`), and
  rewrites the ones that are neither declared exports nor built-in TS/DOM types
  to `unknown`. JSDoc/comment lines are skipped.

  Conservative by design: only rewrites identifiers in patterns we are confident
  are type positions. Property/method names on the left side of `:` are not
  matched. False positives are bounded by the `_TS_BUILTIN_TYPES` whitelist.
  """
  declared = set(declared_names) | _TS_BUILTIN_TYPES

  def _strip_comments(text: str) -> str:
    """Replace block & line comments with whitespace, preserving line/column."""
    out = []
    i = 0
    n = len(text)
    while i < n:
      if text[i] == '/' and i + 1 < n and text[i + 1] == '*':
        end = text.find('*/', i + 2)
        if end == -1:
          out.append(' ' * (n - i))
          break
        block = text[i:end + 2]
        out.append(re.sub(r"[^\n]", " ", block))
        i = end + 2
      elif text[i] == '/' and i + 1 < n and text[i + 1] == '/':
        end = text.find('\n', i)
        if end == -1:
          out.append(' ' * (n - i))
          break
        out.append(' ' * (end - i))
        i = end
      else:
        out.append(text[i])
        i += 1
    return ''.join(out)

  scrubbed = _strip_comments(source)
  ancestor_chains = ancestor_chains or {}

  bad_spans = []
  # `extends Undeclared`: re-link to nearest declared ancestor when the
  # ancestor chain metadata covers the class. Otherwise drop the clause.
  drop_spans = []
  rewrite_spans = []
  for m in _HERITAGE_RE.finditer(scrubbed):
    childName = m.group(2)
    parent = m.group(3)
    if parent in declared:
      continue
    chain = ancestor_chains.get(childName, [])
    relink = next((a for a in chain if a in declared), None)
    if relink:
      rewrite_spans.append((m.start(3), m.end(3), relink))
    else:
      drop_spans.append((m.end(1), m.end(3)))
  for pat in _TYPE_REF_PATTERNS:
    for m in pat.finditer(scrubbed):
      name = m.group(1)
      if name in declared:
        continue
      bad_spans.append((m.start(1), m.end(1)))

  if not bad_spans and not drop_spans and not rewrite_spans:
    return source

  edits = (
    [(s, e, "unknown") for (s, e) in bad_spans]
    + [(s, e, "") for (s, e) in drop_spans]
    + [(s, e, repl) for (s, e, repl) in rewrite_spans]
  )
  edits.sort()

  merged = []
  last = -1
  for start, end, repl in edits:
    if start < last:
      continue
    merged.append((start, end, repl))
    last = end

  out_parts = []
  cursor = 0
  for start, end, repl in merged:
    out_parts.append(source[cursor:start])
    out_parts.append(repl)
    cursor = end
  out_parts.append(source[cursor:])
  return ''.join(out_parts)


# Forward-declaration + inline-namespace preamble injected into BOTH the
# additionalBindCode TU AND every generated binding TU (via embindPreamble in
# generateBindings.py). The EM_JS *definition* lives only in the
# additionalBindCode TU (a regular C function — one definition only) so the
# linker resolves the symbol once; the per-binding TUs see the namespace
# helpers and an extern "C" forward decl. Without this in the binding
# preamble, every binding that references `::ocjs::getRbvDispose()` fails to
# compile with "no member named 'ocjs' in the global namespace" and the
# linker dead-code-eliminates the EM_JS symbol from the final JS glue.
OCJS_RBV_PREAMBLE = r"""
#include <emscripten/val.h>

extern "C" void ocjs_register_rbv_dispose();

namespace ocjs {
  // Magic-static + cached val: registration runs exactly once per TU on first
  // call, after the emscripten runtime is up. Subsequent calls return the
  // cached val handle directly — no JS<->WASM crossings per RBV call.
  // `ocjs_register_rbv_dispose` is idempotent (assigns to Module), so multiple
  // TU-local registrations are safe.
  inline ::emscripten::val getRbvDispose() {
    static const auto _init = []() { ocjs_register_rbv_dispose(); return 0; }();
    (void)_init;
    static ::emscripten::val cached = ::emscripten::val::module_property("__ocjsRbvDispose__");
    return cached;
  }
  inline ::emscripten::val getSymbolDispose() {
    static ::emscripten::val cached = ::emscripten::val::global("Symbol")["dispose"];
    return cached;
  }
}
"""

BUILTIN_ADDITIONAL_BIND_CODE = r"""
#include <TopoDS.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_CompSolid.hxx>
#include <TopoDS_Compound.hxx>
#include <TColStd_IndexedDataMapOfStringString.hxx>
#include <Standard_Failure.hxx>
#include <emscripten/em_js.h>
""" + OCJS_RBV_PREAMBLE + r"""

// Shared disposer for val::object() RBV containers. Authored via EM_JS so the
// JS body is emitted at link time (CSP-strict / -sDYNAMIC_EXECUTION=0 compatible).
// The disposer is UNBOUND — `using` invokes it as a method call so `this` is
// naturally the container, sidestepping the V8 13.6 Function.prototype.bind
// `using` rejection. See docs/research/ocjs-unified-rbv-blueprint.md Appendix 5.
//
// Idempotency and alias-safety: Embind retains the `.delete` method on the
// prototype after the underlying instance is destroyed, so a naïve
// `typeof v.delete === 'function'` guard does NOT prevent a second call from
// throwing `BindingError: <T> instance already deleted`. Two cases hit this
// in practice: (a) a caller invokes `result[Symbol.dispose]()` manually and
// then `using` re-disposes at scope exit; (b) Input-Passthrough RBV legitimately
// produces aliased handles across sibling containers that disposed earlier.
// We make the disposer truly one-shot by (1) swallowing a redundant `.delete()`
// throw and (2) clearing the slot via `this[k] = undefined` so subsequent
// iterations find nothing to delete.
EM_JS(void, ocjs_register_rbv_dispose, (), {
  Module["__ocjsRbvDispose__"] = function () {
    for (const k in this) {
      if (Object.prototype.hasOwnProperty.call(this, k)) {
        const v = this[k];
        if (v && typeof v.delete === 'function') {
          try { v.delete(); } catch {}
          this[k] = undefined;
        }
      }
    }
  };
});

struct TopoDS_Bind_ {};
class OCJS {
public:
  static Standard_Failure* getStandard_FailureData(intptr_t exceptionPtr) {
    return reinterpret_cast<Standard_Failure*>(exceptionPtr);
  }
  static bool exceptionsEnabled() {
#ifdef OCJS_EXCEPTIONS_ENABLED
    return true;
#else
    return false;
#endif
  }
};
using namespace emscripten;
EMSCRIPTEN_BINDINGS(ocjs_builtins) {
  class_<OCJS>("OCJS")
    .class_function("getStandard_FailureData", &OCJS::getStandard_FailureData, allow_raw_pointers())
    .class_function("exceptionsEnabled", &OCJS::exceptionsEnabled)
    ;
  class_<NCollection_IndexedDataMap<TCollection_AsciiString, TCollection_AsciiString>>("TColStd_IndexedDataMapOfStringString")
    .constructor<>()
    ;
  class_<TopoDS_Bind_>("TopoDS")
    .class_function("Edge", optional_override([](const TopoDS_Shape& s) -> TopoDS_Edge { return TopoDS::Edge(s); }))
    .class_function("Wire", optional_override([](const TopoDS_Shape& s) -> TopoDS_Wire { return TopoDS::Wire(s); }))
    .class_function("Face", optional_override([](const TopoDS_Shape& s) -> TopoDS_Face { return TopoDS::Face(s); }))
    .class_function("Vertex", optional_override([](const TopoDS_Shape& s) -> TopoDS_Vertex { return TopoDS::Vertex(s); }))
    .class_function("Shell", optional_override([](const TopoDS_Shape& s) -> TopoDS_Shell { return TopoDS::Shell(s); }))
    .class_function("Solid", optional_override([](const TopoDS_Shape& s) -> TopoDS_Solid { return TopoDS::Solid(s); }))
    .class_function("Compound", optional_override([](const TopoDS_Shape& s) -> TopoDS_Compound { return TopoDS::Compound(s); }))
    ;
}
"""


def _collect_compiled_symbols(libraryBasePath) -> set:
  compiled = set()
  compiled_dir = libraryBasePath + "/compiled-bindings"
  if not os.path.isdir(compiled_dir):
    compiled_dir = libraryBasePath + "/bindings"
  for dirpath, dirnames, filenames in os.walk(compiled_dir):
    for item in filenames:
      if item.endswith(".cpp.o"):
        compiled.add(item[:-6])
  return compiled

def verifyBindings(bindings, libraryBasePath) -> bool:
  compiled = _collect_compiled_symbols(libraryBasePath)
  missing = [b for b in bindings if b["symbol"] not in compiled]
  if missing:
    missing_names = [b["symbol"] for b in missing]
    print(f"WARNING: {len(missing)} of {len(bindings)} requested bindings have no compiled .o file:", flush=True)
    for name in sorted(missing_names)[:20]:
      print(f"  - {name}", flush=True)
    if len(missing_names) > 20:
      print(f"  ... and {len(missing_names) - 20} more", flush=True)
    strict = os.environ.get("OCJS_STRICT_VERIFY", "0") == "1"
    if strict:
      raise Exception(f"{len(missing)} requested bindings missing. Set OCJS_STRICT_VERIFY=0 to proceed with available bindings.")

def _load_auto_discovered_symbols(build_dir):
  """Load auto-discovered NCollection symbols from the manifest written by the generate step."""
  manifest_path = os.path.join(build_dir, "ncollection-manifest.json")
  if os.path.isfile(manifest_path):
    with open(manifest_path) as f:
      return set(json.load(f).get("symbols", []))
  return set()

_auto_symbols = _load_auto_discovered_symbols(BUILD_DIR)

# Embind registers C++ classes by typeid. OCCT exposes several `using` aliases that
# name the same template specialization (e.g. BRepGraph_ReverseIterator::ParentsOf<
# BRepGraph_FaceId> is both BRepGraph_FacesOfEdge and BRepGraph_FacesOfWire). Linking
# more than one binding object for those aliases registers the same type twice and
# fails at module init with "Cannot register type ... twice". See
# BRepGraph_ReverseIterator.hxx — keep the YAML-canonical symbol per family and skip
# the rest even when they appear in ncollection-manifest.json.
_EMBIND_OCTYPE_ALIAS_TYPENAME_SKIPS = frozenset({
  "BRepGraph_FacesOfWire",
  "BRepGraph_WiresOfEdge",
  "BRepGraph_CompoundsOfFace",
  "BRepGraph_CompoundsOfShell",
  "BRepGraph_CompoundsOfSolid",
  "BRepGraph_CompoundsOfCompound",
})

def shouldProcessSymbol(symbol: str, bindings) -> bool:
  if symbol in _EMBIND_OCTYPE_ALIAS_TYPENAME_SKIPS:
    return False
  if len(bindings) == 0:
    return True
  if symbol in _auto_symbols:
    return True
  entry = next((b for b in bindings if b["symbol"] == symbol), None)
  if not entry is None:
    return True
  return False

def _warn_consistency(build):
  """Warn (non-fatal) if consumer emccFlags and compile config are mismatched."""
  import sys
  yaml_flags = build.get("emccFlags", [])
  yaml_has_wasm_exc = "-fwasm-exceptions" in yaml_flags
  yaml_has_js_exc = "-fexceptions" in yaml_flags
  yaml_disables_exc = any("-sDISABLE_EXCEPTION_CATCHING=1" in f for f in yaml_flags)
  yaml_has_simd = "-msimd128" in yaml_flags
  env_exc = os.environ.get("OCJS_EXCEPTIONS", "0") == "1"
  env_simd = os.environ.get("OCJS_SIMD", "0") == "1"

  if env_exc and yaml_disables_exc:
    print(
      f"WARNING: Compiled with OCJS_EXCEPTIONS=1 but emccFlags has -sDISABLE_EXCEPTION_CATCHING=1. "
      f"These are contradictory -- link may not handle exceptions correctly.",
      file=sys.stderr, flush=True,
    )
  if not env_exc and (yaml_has_wasm_exc or yaml_has_js_exc):
    print(
      f"WARNING: Compiled with OCJS_EXCEPTIONS=0 but emccFlags has exception flags. "
      f"Link-time exception support without compile-time support may cause issues.",
      file=sys.stderr, flush=True,
    )
  if env_simd and not yaml_has_simd:
    print(
      f"WARNING: Compiled with OCJS_SIMD=1 but emccFlags lacks -msimd128. "
      f"wasm-opt will enable SIMD, but link may miss relaxed-simd optimizations.",
      file=sys.stderr, flush=True,
    )


_KNOWN_HEAP_METHODS = frozenset({
  'HEAP8', 'HEAPU8', 'HEAP16', 'HEAPU16',
  'HEAP32', 'HEAPU32', 'HEAPF32', 'HEAPF64',
})

_HEAP_JSDOC = {
  'HEAP8':   'Signed 8-bit integer view of the WASM linear memory. Index by byte offset.',
  'HEAPU8':  'Unsigned 8-bit integer view of the WASM linear memory. Index by byte offset.',
  'HEAP16':  'Signed 16-bit integer view of the WASM linear memory. Index by byte offset / 2.',
  'HEAPU16': 'Unsigned 16-bit integer view of the WASM linear memory. Index by byte offset / 2.',
  'HEAP32':  'Signed 32-bit integer view of the WASM linear memory. Index by byte offset / 4.',
  'HEAPU32': 'Unsigned 32-bit integer view of the WASM linear memory. Index by byte offset / 4.',
  'HEAPF32': '32-bit floating-point view of the WASM linear memory. Index by byte offset / 4.',
  'HEAPF64': '64-bit floating-point view of the WASM linear memory. Index by byte offset / 8.',
}

def _parse_exported_runtime_methods(emcc_flags):
  """Extract runtime method names from -sEXPORTED_RUNTIME_METHODS in emccFlags."""
  for flag in emcc_flags:
    if 'EXPORTED_RUNTIME_METHODS' in flag:
      match = re.search(r'\[(.+)\]', flag)
      if match:
        return [m.strip().strip("'\"") for m in match.group(1).split(',')]
  return ['FS']


def runBuild(build, libraryBasePath):
  try:
    validate_build_flags()
  except BuildFlagMismatch as e:
    print(str(e), flush=True)
    raise SystemExit(1)
  _warn_consistency(build)

  def getAdditionalBindCodeO():
    combined = BUILTIN_ADDITIONAL_BIND_CODE
    if "additionalBindCode" in build:
      combined += "\n" + build["additionalBindCode"]
    try:
      os.mkdir(libraryBasePath + "/additionalBindCode")
    except Exception:
      pass
    additionalBindCodeFileName = libraryBasePath + "/additionalBindCode/" + build["name"] + ".cpp"
    f = open(additionalBindCodeFileName, "w")
    f.write(combined)
    f.close()
    print("building " + additionalBindCodeFileName)
    OPT_LEVEL = os.environ.get("OCJS_OPT", "-O0")
    USE_LTO = os.environ.get("OCJS_LTO", "0") == "1"
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
      *(["-pthread"] if os.environ["THREADING"] == "multi-threaded" else []),
      *(["-include-pch", PCH_FILE] if os.path.exists(PCH_FILE) else []),
      *["-I" + p for p in getFlatIncludePaths()],
      "-c", additionalBindCodeFileName,
    ]
    subprocess.check_call([
      *command,
      "-o", additionalBindCodeFileName + ".o",
    ])
    return additionalBindCodeFileName + ".o"
  additionalBindCodeO = getAdditionalBindCodeO()
  print("Running build: " + build["name"], flush=True)
  bindingsO = []
  _AUTO_BINDING_DIRS = {"myMain.h"}
  compiled_bindings = libraryBasePath + "/compiled-bindings"
  if not os.path.isdir(compiled_bindings):
    compiled_bindings = libraryBasePath + "/bindings"
  for dirpath, dirnames, filenames in os.walk(compiled_bindings):
    rel_parts = dirpath.replace(compiled_bindings + "/", "").split("/")
    skip = any(not filterPackages(p) and p not in _AUTO_BINDING_DIRS for p in rel_parts if p)
    if skip:
      dirnames.clear()
      continue
    for item in filenames:
      if item.endswith(".cpp.o") and shouldProcessSymbol(item[:-6], build["bindings"]):
        bindingsO.append(dirpath + "/" + item)
  # One object per basename: prevents duplicate embind static init if the same symbol
  # ever appears under multiple directory paths (stable order — first path wins).
  _bindings_by_base = {}
  for o_path in bindingsO:
    _bindings_by_base.setdefault(os.path.basename(o_path), o_path)
  bindingsO = list(_bindings_by_base.values())
  sourcesO = []
  cmake_lib_marker = libraryBasePath + "/.cmake-lib-dir"
  if os.path.exists(cmake_lib_marker):
    with open(cmake_lib_marker) as f:
      cmake_lib_dir = f.read().strip()
    if os.path.isdir(cmake_lib_dir):
      for item in sorted(os.listdir(cmake_lib_dir)):
        if item.endswith(".a"):
          toolkit_name = item.replace("lib", "").replace(".a", "")
          if filterPackages(toolkit_name):
            sourcesO.append(os.path.join(cmake_lib_dir, item))
      print(f"Using {len(sourcesO)} CMake static libraries from {cmake_lib_dir} (filtered by filterPackages)", flush=True)
    else:
      raise Exception(f"CMake lib dir from marker does not exist: {cmake_lib_dir}")
  else:
    for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/sources"):
      rel_parts = dirpath.replace(libraryBasePath + "/sources/", "").split("/")
      skip = any(not filterPackages(p) for p in rel_parts if p)
      if skip:
        dirnames.clear()
        continue
      for item in filenames:
        if item in [
          "XBRepMesh.o",
        ]:
          continue
        if item.endswith(".o"):
          sourcesO.append(dirpath + "/" + item)
  allowed_undef_flags = []
  for sym in build.get("allowedUndefinedSymbols", []):
    allowed_undef_flags.extend(["-Wl,--allow-undefined-symbol=" + sym])

  emcc_flags = build.get("emccFlags", [])
  has_opt = any(f.startswith("-O") for f in emcc_flags)
  has_lto = "-flto" in emcc_flags
  has_malloc = any(f.startswith("-sMALLOC=") for f in emcc_flags)

  fill_flags = []
  if not has_opt:
    fill_flags.append(os.environ.get("OCJS_LINK_OPT", os.environ.get("OCJS_OPT", "-O3")))
  if not has_lto and os.environ.get("OCJS_LTO", "0") == "1":
    fill_flags.append("-flto")
  if not has_malloc:
    malloc_choice = os.environ.get("OCJS_MALLOC", "dlmalloc")
    fill_flags.append(f"-sMALLOC={malloc_choice}")

  output_dir = os.environ.get("OCJS_OUTPUT_DIR", os.getcwd())
  linkCmd = [
    "emcc", "-lembind",
    *([additionalBindCodeO] if additionalBindCodeO else []),
    *bindingsO, *sourcesO,
    "-o", output_dir + "/" + build["name"],
    *(["-pthread"] if os.environ["THREADING"] == "multi-threaded" else []),
    *fill_flags,
    *emcc_flags,
    *allowed_undef_flags,
  ]
  if os.environ.get("OCJS_CLOSURE", "false") == "true":
    linkCmd.extend(["--closure", "1"])
  print(f"Linking {len(bindingsO)} bindings + {len(sourcesO)} sources ...", flush=True)
  link_start = time.time()
  subprocess.check_call(linkCmd)
  link_duration = time.time() - link_start

  wasmFile = output_dir + "/" + os.path.splitext(build["name"])[0] + ".wasm"
  emsdk = os.environ.get("EMSDK", "")
  wasmOptPath = shutil.which("wasm-opt") or (os.path.join(emsdk, "upstream", "bin", "wasm-opt") if emsdk else None)

  sizeBefore = os.path.getsize(wasmFile) if os.path.exists(wasmFile) else 0
  sizeAfter = sizeBefore
  wasm_opt_duration = 0
  wasm_opt_flag_list = []

  wasm_opt_level = os.environ.get("OCJS_WASM_OPT_LEVEL", "-O3")
  skip_wasm_opt = os.environ.get("OCJS_SKIP_WASM_OPT", "0") == "1"
  if os.path.exists(wasmFile) and wasmOptPath and os.path.exists(wasmOptPath) and wasm_opt_level and not skip_wasm_opt:
    print(f"Running wasm-opt on {wasmFile} ({sizeBefore / (1024*1024):.1f} MB)...", flush=True)
    wasm_opt_flag_list = [wasm_opt_level, "--strip-debug", "--strip-producers", "--enable-mutable-globals", "--enable-bulk-memory", "--enable-sign-ext", "--enable-nontrapping-float-to-int", "--traps-never-happen"]
    if os.environ.get("OCJS_CONVERGE", "false") == "true":
      wasm_opt_flag_list.append("--converge")
    # --closed-world disabled: interacts badly with exception handling code present in non-No_Exception builds
    # wasm_opt_flag_list.append("--closed-world")
    wasmOptCmd = [wasmOptPath] + wasm_opt_flag_list
    wasmOptCmd.append("--enable-exception-handling")
    wasm_opt_flag_list.append("--enable-exception-handling")
    if os.environ.get("OCJS_SIMD", "0") == "1":
      wasmOptCmd.append("--enable-simd")
      wasm_opt_flag_list.append("--enable-simd")
      if os.environ.get("OCJS_RELAXED_SIMD", "0") == "1":
        wasmOptCmd.append("--enable-relaxed-simd")
        wasm_opt_flag_list.append("--enable-relaxed-simd")
    if os.environ.get("THREADING") == "multi-threaded":
      wasmOptCmd.append("--enable-threads")
      wasm_opt_flag_list.append("--enable-threads")
    binaryen_extra_passes = os.environ.get("BINARYEN_EXTRA_PASSES", "").strip()
    if binaryen_extra_passes:
      for pass_name in (s.strip() for s in binaryen_extra_passes.split(",")):
        if pass_name:
          wasm_opt_flag_list.append(pass_name)
          wasmOptCmd.append(pass_name)
    wasmOptCmd.extend([wasmFile, "-o", wasmFile])
    opt_start = time.time()
    subprocess.check_call(wasmOptCmd)
    wasm_opt_duration = time.time() - opt_start
    sizeAfter = os.path.getsize(wasmFile)
    reduction = (1 - sizeAfter / sizeBefore) * 100 if sizeBefore > 0 else 0
    print(f"wasm-opt: {sizeBefore / (1024*1024):.1f} MB -> {sizeAfter / (1024*1024):.1f} MB ({reduction:.1f}% reduction)", flush=True)

  symbol_list = [b["symbol"] for b in build["bindings"]]
  if prov is not None:
    prov.add_linking(
      yaml_config=os.path.basename(build["name"]),
      yaml_hash=_yaml_config_hash,
      bound_symbols=len(symbol_list),
      symbol_list=symbol_list,
      emcc_flags=list(fill_flags) + list(emcc_flags),
      link_duration=link_duration,
      wasm_opt_flags=wasm_opt_flag_list,
      pre_opt_size=sizeBefore,
      post_opt_size=sizeAfter,
      wasm_opt_duration=wasm_opt_duration,
    )

  print("Build finished", flush=True)


def _collect_dts_fragments(buildConfig, libraryBasePath):
  """Walk bindings dir and collect all .d.ts.json fragments matching the YAML bindings."""
  typescriptDefinitions = []
  allBindings = list(chain(buildConfig["mainBuild"]["bindings"], *list(map(lambda x: x["bindings"], buildConfig["extraBuilds"]))))
  _AUTO_BINDING_DIRS = {"myMain.h"}
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
    rel_parts = dirpath.replace(libraryBasePath + "/bindings/", "").split("/")
    skip = any(not filterPackages(p) and p not in _AUTO_BINDING_DIRS for p in rel_parts if p)
    if skip:
      dirnames.clear()
      continue
    for item in filenames:
      if item.endswith(".d.ts.json") and shouldProcessSymbol(item[:-10], allBindings):
        f = open(dirpath + "/" + item, "r")
        typescriptDefinitions.append(json.loads(f.read()))
  return typescriptDefinitions


def main():
  from generateBindings import generateCustomCodeBindings
  from compileBindings import compileCustomCodeBindings

  parser = ArgumentParser()
  parser.add_argument(dest="filename", help="Custom build input file (.yml)", metavar="FILE.yml")
  parser.add_argument("--dts-only", action="store_true",
                       help="Regenerate only the .d.ts file from existing .d.ts.json fragments (no compile/link)")
  args = parser.parse_args()
  libraryBasePath = os.environ.get("BUILD_DIR", OCJS_ROOT + "/build")

  global _yaml_config_hash
  with open(args.filename, "rb") as yf:
    _yaml_config_hash = hashlib.sha256(yf.read()).hexdigest()[:12]
  buildConfig = yaml.safe_load(open(args.filename, "r"))
  schema = eval(open(OCJS_ROOT + "/src/customBuildSchema.py", "r").read())
  v = Validator(schema)
  if not v.validate(buildConfig, schema):
    raise Exception(v.errors)
  buildConfig = v.normalized(buildConfig)

  if not args.dts_only:
    custom_dir = libraryBasePath + "/bindings/myMain.h"
    if os.path.isdir(custom_dir):
      for f in os.listdir(custom_dir):
        stem = f.split(".")[0]
        if stem not in _auto_symbols:
          os.remove(os.path.join(custom_dir, f))

    additionalCppCode = buildConfig["additionalCppCode"]

    yaml_dir = os.path.dirname(os.path.abspath(args.filename))
    for cpp_file in buildConfig.get("additionalCppFiles", []):
      resolved = os.path.join(yaml_dir, cpp_file) if not os.path.isabs(cpp_file) else cpp_file
      if not os.path.isfile(resolved):
        raise FileNotFoundError(f"additionalCppFiles: file not found: {resolved} (from '{cpp_file}')")
      with open(resolved, "r") as f:
        additionalCppCode += "\n" + f.read()

    print("Generating custom code bindings...", flush=True)
    known_exports = {
      b["symbol"]
      for b in chain(
        buildConfig["mainBuild"]["bindings"],
        *(x["bindings"] for x in buildConfig["extraBuilds"]),
      )
    } | _auto_symbols
    generateCustomCodeBindings(additionalCppCode, known_exports=known_exports)
    print("Compiling custom code bindings...", flush=True)
    compileCustomCodeBindings({
      "threading": os.environ['THREADING'],
    })
    print("Custom code bindings done.", flush=True)

    verifyBindings(buildConfig["mainBuild"]["bindings"], libraryBasePath)
    for extraBuild in buildConfig["extraBuilds"]:
      verifyBindings(extraBuild, libraryBasePath)
    print("All bindings verified.", flush=True)

    runBuild(buildConfig["mainBuild"], libraryBasePath)
    for extraBuild in buildConfig["extraBuilds"]:
      runBuild(extraBuild, libraryBasePath)

  typescriptDefinitions = _collect_dts_fragments(buildConfig, libraryBasePath)

  if buildConfig["generateTypescriptDefinitions"]:
    typescriptDefinitionOutput = ""
    typescriptExports = []
    ancestorChains: dict = {}
    for dts in typescriptDefinitions:
      typescriptDefinitionOutput += dts[".d.ts"]
      for export in dts["exports"]:
        typescriptExports.append({
          "export": export,
          "kind": dts["kind"],
        })
      for cls, ancestor_chain in (dts.get("ancestors") or {}).items():
        ancestorChains.setdefault(cls, ancestor_chain)

    # Declarations for built-in types provided via BUILTIN_ADDITIONAL_BIND_CODE
    declarations_dir = os.path.join(os.path.dirname(__file__), 'declarations')

    with open(os.path.join(declarations_dir, 'builtin-bindings.d.ts'), 'r') as f:
      typescriptDefinitionOutput += f.read() + "\n\n"
    typescriptExports.extend([
      {"export": "TColStd_IndexedDataMapOfStringString", "kind": "class"},
      {"export": "TopoDS", "kind": "class"},
      {"export": "OCJS", "kind": "class"},
    ])

    with open(os.path.join(declarations_dir, 'emscripten-fs.d.ts'), 'r') as f:
      typescriptDefinitionOutput += f.read() + "\n\n"

    runtime_methods = _parse_exported_runtime_methods(
      buildConfig["mainBuild"].get("emccFlags", [])
    )
    heap_methods_requested = [m for m in runtime_methods if m in _KNOWN_HEAP_METHODS]
    if heap_methods_requested:
      with open(os.path.join(declarations_dir, 'emscripten-runtime.d.ts'), 'r') as f:
        typescriptDefinitionOutput += f.read() + "\n\n"

    # Auto-generated `export namespace <prefix> { ... }` blocks were removed in
    # v3.0 (see CHANGELOG). Consumers must now use the flat `gp_Pnt`,
    # `TopoDS_Edge`, ... names directly. The hand-written `TopoDS` runtime API
    # in builtin-bindings.d.ts is unaffected.

    main_flags = buildConfig["mainBuild"].get("emccFlags", [])
    uses_native_wasm_eh = any('-fwasm-exceptions' in f for f in main_flags)
    exports_eh_helpers = any('-sEXPORT_EXCEPTION_HANDLING_HELPERS' in f for f in main_flags)

    if uses_native_wasm_eh and not exports_eh_helpers:
      # Hard fail: native wasm EH without the runtime helpers is a footgun -- the
      # JS module will catch WebAssembly.Exception but consumers cannot decode it
      # (no getExceptionMessage). Force the YAML to make this explicit.
      raise ValueError(
        "mainBuild.emccFlags contains '-fwasm-exceptions' but not "
        "'-sEXPORT_EXCEPTION_HANDLING_HELPERS'. Add the helpers flag so JS "
        "consumers can decode caught WebAssembly.Exception via getExceptionMessage(), "
        "or remove '-fwasm-exceptions' if exception handling is intentionally "
        "compiled-out."
      )

    if uses_native_wasm_eh and exports_eh_helpers:
      typescriptDefinitionOutput += \
        "/**\n" + \
        " * Extract the exception type and message from a caught `WebAssembly.Exception`.\n" + \
        " *\n" + \
        " * Only available in builds compiled with `-fwasm-exceptions` (native WASM exception handling).\n" + \
        " *\n" + \
        " * @param ex - The caught `WebAssembly.Exception` object.\n" + \
        " * @returns A `[type, message]` tuple where `type` is the C++ exception class name\n" + \
        " *   (e.g. `'Standard_DomainError'`) and `message` is the exception text.\n" + \
        " */\n" + \
        "export declare function getExceptionMessage(ex: WebAssembly.Exception): [string, string];\n" + \
        "/**\n" + \
        " * Increment the reference count of a `WebAssembly.Exception` to prevent premature disposal.\n" + \
        " *\n" + \
        " * Call this when storing an exception reference beyond its catch scope.\n" + \
        " *\n" + \
        " * @param ex - The exception whose refcount to increment.\n" + \
        " */\n" + \
        "export declare function incrementExceptionRefcount(ex: WebAssembly.Exception): void;\n" + \
        "/**\n" + \
        " * Decrement the reference count of a `WebAssembly.Exception`, freeing it when count reaches zero.\n" + \
        " *\n" + \
        " * @param ex - The exception whose refcount to decrement.\n" + \
        " */\n" + \
        "export declare function decrementExceptionRefcount(ex: WebAssembly.Exception): void;\n\n"
      typescriptExports.append({"export": "getExceptionMessage", "kind": "function"})
      typescriptExports.append({"export": "incrementExceptionRefcount", "kind": "function"})
      typescriptExports.append({"export": "decrementExceptionRefcount", "kind": "function"})

    runtime_lines = []
    if 'FS' in runtime_methods:
      runtime_lines.append('  /** Emscripten virtual filesystem for reading/writing files in the WASM heap. */')
      runtime_lines.append('  FS: typeof FS;')
    for m in heap_methods_requested:
      doc = _HEAP_JSDOC.get(m, f'{m} view of the WASM linear memory.')
      runtime_lines.append(f'  /** {doc} */')
      runtime_lines.append(f'  {m}: typeof {m};')
    if 'wasmMemory' in runtime_methods:
      runtime_lines.append('  /**')
      runtime_lines.append('   * The live `WebAssembly.Memory` instance backing the WASM linear memory.')
      runtime_lines.append('   *')
      runtime_lines.append('   * Use `wasmMemory.buffer` to obtain the current `ArrayBuffer` after any')
      runtime_lines.append('   * call that may have grown memory (e.g. allocations during `extract()`).')
      runtime_lines.append('   * Cached `HEAP*` views may be detached after growth — taking fresh views')
      runtime_lines.append('   * off `wasmMemory.buffer` is the safe pattern.')
      runtime_lines.append('   */')
      runtime_lines.append('  wasmMemory: WebAssembly.Memory;')
    runtime_type = '{\n' + '\n'.join(runtime_lines) + '\n}' if runtime_lines else '{}'

    runtime_desc_parts = []
    if 'FS' in runtime_methods:
      runtime_desc_parts.append('the Emscripten virtual filesystem (`oc.FS`)')
    if heap_methods_requested:
      runtime_desc_parts.append('WASM heap views (' + ', '.join(f'`oc.{m}`' for m in heap_methods_requested) + ')')
    if 'wasmMemory' in runtime_methods:
      runtime_desc_parts.append('the live `WebAssembly.Memory` (`oc.wasmMemory`)')
    runtime_desc = ' and '.join(runtime_desc_parts) if runtime_desc_parts else 'Emscripten runtime methods'

    seen_export_names = set()
    deduped_exports = []
    for export_entry in typescriptExports:
      name = export_entry["export"]
      if name in seen_export_names:
        continue
      seen_export_names.add(name)
      deduped_exports.append(export_entry)

    typescriptDefinitionOutput += \
      "\n/**\n" + \
      " * Union of the Emscripten runtime exports and all bound OCCT classes, enums, and functions.\n" + \
      " *\n" + \
      " * Returned by {@link init | `init`} after the WASM module is fully loaded. Access any\n" + \
      " * OCCT binding as a property (e.g. `oc.BRepPrimAPI_MakeBox`) and use\n" + \
      " * " + runtime_desc + ".\n" + \
      " */\n" + \
      "export type OpenCascadeInstance = " + runtime_type + " & {\n  " + ";\n  ".join(map(lambda x: x["export"] + ": typeof " + x["export"], deduped_exports)) + ";\n" + \
      "};\n\n" + \
      "/**\n" + \
      " * Initialize the OpenCASCADE WASM module and return the fully populated instance.\n" + \
      " *\n" + \
      " * Downloads, compiles, and instantiates the WASM binary. The returned\n" + \
      " * `OpenCascadeInstance` provides access to all bound OCCT classes and the\n" + \
      " * Emscripten virtual filesystem.\n" + \
      " *\n" + \
      " * @param options - Emscripten module overrides (e.g. `locateFile`, `print`, `instantiateWasm`).\n" + \
      " * @returns The initialized instance with all OCCT bindings and the `FS` namespace.\n" + \
      " */\n" + \
      "export default function init(options?: Record<string, unknown>): Promise<OpenCascadeInstance>;\n"

    from bindings import TypescriptBindings as _TSB
    unrecognized = _TSB._any_reasons.get("unrecognized_template", {})
    if unrecognized:
      print(f"\n=== UNRECOGNIZED TEMPLATE TYPES ({len(unrecognized)} unique) ===", flush=True)
      for type_info, count in sorted(unrecognized.items(), key=lambda x: -x[1])[:15]:
        print(f"  {type_info} ({count}x)", flush=True)
      if len(unrecognized) > 15:
        print(f"  ... and {len(unrecognized) - 15} more", flush=True)
      print("These template types have no known typedef/using-alias.", flush=True)
      print("Auto-discovery should capture NCollection types; check discover.py for missing patterns.\n", flush=True)

    # Post-process to neutralize references to types not actually emitted in
    # this build. Fragments are pre-generated against the FULL bindgen filter,
    # so a per-build subset YAML (e.g. replicad_single) inherits references like
    # `Standard_Type` that the subset never declares. Replace each with `unknown`
    # (no value at runtime, structural fallback at type level) to keep the
    # generated `.d.ts` semantically valid (zero TS2304/TS2552 diagnostics).
    declared_names = {x["export"] for x in deduped_exports}
    declared_names.update(
      re.findall(r"^export\s+(?:declare\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)", typescriptDefinitionOutput, re.MULTILINE)
    )
    declared_names.update(
      re.findall(r"^export\s+(?:declare\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)", typescriptDefinitionOutput, re.MULTILINE)
    )
    typescriptDefinitionOutput = _replace_undeclared_with_unknown(
      typescriptDefinitionOutput,
      declared_names=declared_names,
      ancestor_chains=ancestorChains,
    )

    typescriptDefinitionsFile = open(os.getcwd() + "/" + os.path.splitext(buildConfig["mainBuild"]["name"])[0] + ".d.ts", "w")
    typescriptDefinitionsFile.write(typescriptDefinitionOutput)
    print("TypeScript definitions written.", flush=True)

if __name__ == "__main__":
  multiprocessing.set_start_method("fork")
  main()

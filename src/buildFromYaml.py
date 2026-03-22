#!/usr/bin/python3

import hashlib
import os
import subprocess
import json
import time
import multiprocessing
from itertools import chain
import yaml
import shutil
from cerberus import Validator
from argparse import ArgumentParser
from Common import OCJS_ROOT, getFlatIncludePaths, PCH_FILE, WASM_EXCEPTION_FLAGS, USE_WASM_EXCEPTIONS, SIMD_FLAGS, EXTRA_COMPILE_FLAGS, validate_build_flags, BuildFlagMismatch
from filter.filterPackages import filterPackages
try:
    import provenance as prov
except ImportError:
    prov = None

_yaml_config_hash = ""

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
#include <FairCurve_Batten.hxx>
#include <FairCurve_MinimalVariation.hxx>
#include <FairCurve_AnalysisCode.hxx>
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
  function("FairCurve_Batten_Compute", optional_override([](FairCurve_Batten& self, emscripten::val codeRef, int nbIter, double tol) -> bool {
    FairCurve_AnalysisCode code = static_cast<FairCurve_AnalysisCode>(codeRef["current"].as<int>());
    bool result = self.Compute(code, nbIter, tol);
    codeRef.set("current", static_cast<int>(code));
    return result;
  }));
  function("FairCurve_MinimalVariation_Compute", optional_override([](FairCurve_MinimalVariation& self, emscripten::val codeRef, int nbIter, double tol) -> bool {
    FairCurve_AnalysisCode code = static_cast<FairCurve_AnalysisCode>(codeRef["current"].as<int>());
    bool result = self.Compute(code, nbIter, tol);
    codeRef.set("current", static_cast<int>(code));
    return result;
  }));
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
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
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

def shouldProcessSymbol(symbol: str, bindings) -> bool:
  if len(bindings) == 0:
    return True
  entry = next((b for b in bindings if b["symbol"] == symbol), None)
  if not entry is None:
    return True
  return False

def _validate_yaml_env_consistency(build):
  """Fail fast if YAML emccFlags disagree with OCJS_EXCEPTIONS env var."""
  yaml_flags = build.get("emccFlags", [])
  yaml_has_exc = any(f in ("-fwasm-exceptions", "-fexceptions") for f in yaml_flags)
  yaml_disables_exc = any("-sDISABLE_EXCEPTION_CATCHING=1" in f for f in yaml_flags)
  env_exc = os.environ.get("OCJS_EXCEPTIONS", "0") == "1"

  if env_exc and yaml_disables_exc:
    raise BuildFlagMismatch(
      "ERROR: YAML↔env exception mismatch.\n"
      f"  OCJS_EXCEPTIONS=1 but YAML emccFlags contains -sDISABLE_EXCEPTION_CATCHING=1.\n"
      f"  YAML config: {build.get('name', '?')}\n\n"
      "To fix: either set OCJS_EXCEPTIONS=0 or remove -sDISABLE_EXCEPTION_CATCHING=1 from the YAML."
    )
  if not env_exc and yaml_has_exc:
    raise BuildFlagMismatch(
      "ERROR: YAML↔env exception mismatch.\n"
      f"  OCJS_EXCEPTIONS=0 but YAML emccFlags contains exception flags ({[f for f in yaml_flags if f in ('-fwasm-exceptions', '-fexceptions')]}).\n"
      f"  YAML config: {build.get('name', '?')}\n\n"
      "To fix: either set OCJS_EXCEPTIONS=1 or use a YAML config without exception flags."
    )


def runBuild(build, libraryBasePath):
  try:
    validate_build_flags()
  except BuildFlagMismatch as e:
    print(str(e), flush=True)
    raise SystemExit(1)
  _validate_yaml_env_consistency(build)

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
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
    rel_parts = dirpath.replace(libraryBasePath + "/bindings/", "").split("/")
    skip = any(not filterPackages(p) for p in rel_parts if p)
    if skip:
      dirnames.clear()
      continue
    for item in filenames:
      if item.endswith(".cpp.o") and shouldProcessSymbol(item[:-6], build["bindings"]):
        bindingsO.append(dirpath + "/" + item)
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

  OPT_LEVEL = os.environ.get("OCJS_LINK_OPT", os.environ.get("OCJS_OPT", "-O2"))
  USE_LTO = os.environ.get("OCJS_LTO", "1") == "1"
  yaml_flags = [f for f in build["emccFlags"] if not f.startswith("-O") and f != "-flto"]
  if os.environ.get("OCJS_EH_MODE", "wasm") == "js":
    yaml_flags = ["-fexceptions" if f == "-fwasm-exceptions" else f for f in yaml_flags]
  env_flags = [OPT_LEVEL] + (["-flto"] if USE_LTO else [])
  linkCmd = [
    "emcc", "-lembind",
    *([additionalBindCodeO] if additionalBindCodeO else []),
    *bindingsO, *sourcesO,
    "-o", os.getcwd() + "/" + build["name"],
    *(["-pthread"] if os.environ["THREADING"] == "multi-threaded" else []),
    *env_flags,
    *yaml_flags,
    *allowed_undef_flags,
  ]
  if os.environ.get("OCJS_BIGINT", "0") == "1":
    linkCmd.append("-sWASM_BIGINT=1")
  if os.environ.get("OCJS_CLOSURE", "false") == "true":
    linkCmd.extend(["--closure", "1"])
  if os.environ.get("OCJS_EVAL_CTORS", "false") == "true":
    eval_ctors_level = os.environ.get("OCJS_EVAL_CTORS_LEVEL", "1")
    linkCmd.append(f"-sEVAL_CTORS={eval_ctors_level}")
  print(f"Linking {len(bindingsO)} bindings + {len(sourcesO)} sources ...", flush=True)
  link_start = time.time()
  subprocess.check_call(linkCmd)
  link_duration = time.time() - link_start

  wasmFile = os.getcwd() + "/" + os.path.splitext(build["name"])[0] + ".wasm"
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
    wasm_opt_flag_list = [wasm_opt_level, "--strip-debug", "--strip-producers", "--enable-mutable-globals", "--enable-bulk-memory", "--enable-sign-ext", "--enable-nontrapping-float-to-int"]
    if os.environ.get("OCJS_CONVERGE", "false") == "true":
      wasm_opt_flag_list.append("--converge")
    wasmOptCmd = [wasmOptPath] + wasm_opt_flag_list
    wasmOptCmd.append("--enable-exception-handling")
    wasm_opt_flag_list.append("--enable-exception-handling")
    if os.environ.get("OCJS_SIMD", "0") == "1":
      wasmOptCmd.extend(["--enable-simd", "--enable-relaxed-simd"])
      wasm_opt_flag_list.extend(["--enable-simd", "--enable-relaxed-simd"])
    if os.environ.get("THREADING") == "multi-threaded":
      wasmOptCmd.append("--enable-threads")
      wasm_opt_flag_list.append("--enable-threads")
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
      emcc_flags=build.get("emccFlags", []),
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
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
    rel_parts = dirpath.replace(libraryBasePath + "/bindings/", "").split("/")
    skip = any(not filterPackages(p) for p in rel_parts if p)
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
  libraryBasePath = OCJS_ROOT + "/build"

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
    try:
      shutil.rmtree(libraryBasePath + "/bindings/myMain.h")
    except Exception:
      pass

    additionalCppCode = buildConfig["additionalCppCode"]

    yaml_dir = os.path.dirname(os.path.abspath(args.filename))
    for cpp_file in buildConfig.get("additionalCppFiles", []):
      resolved = os.path.join(yaml_dir, cpp_file) if not os.path.isabs(cpp_file) else cpp_file
      if not os.path.isfile(resolved):
        raise FileNotFoundError(f"additionalCppFiles: file not found: {resolved} (from '{cpp_file}')")
      with open(resolved, "r") as f:
        additionalCppCode += "\n" + f.read()

    print("Generating custom code bindings...", flush=True)
    generateCustomCodeBindings(additionalCppCode)
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
    for dts in typescriptDefinitions:
      typescriptDefinitionOutput += dts[".d.ts"]
      for export in dts["exports"]:
        typescriptExports.append({
          "export": export,
          "kind": dts["kind"],
        })

    # Declarations for built-in types provided via BUILTIN_ADDITIONAL_BIND_CODE
    declarations_dir = os.path.join(os.path.dirname(__file__), 'declarations')

    with open(os.path.join(declarations_dir, 'builtin-bindings.d.ts'), 'r') as f:
      typescriptDefinitionOutput += f.read() + "\n\n"
    typescriptExports.extend([
      {"export": "TColStd_IndexedDataMapOfStringString", "kind": "class"},
      {"export": "TopoDS", "kind": "class"},
      {"export": "OCJS", "kind": "class"},
      {"export": "FairCurve_Batten_Compute", "kind": "function"},
      {"export": "FairCurve_MinimalVariation_Compute", "kind": "function"},
    ])

    with open(os.path.join(declarations_dir, 'emscripten-fs.d.ts'), 'r') as f:
      typescriptDefinitionOutput += f.read() + "\n\n"

    # --- Generate namespace blocks for OCCT package organization (Finding 6, Path A) ---
    from collections import defaultdict
    namespaces = defaultdict(list)
    for ex in typescriptExports:
      name = ex["export"]
      idx = name.find("_")
      if idx > 0:
        prefix = name[:idx]
        short_name = name[idx+1:]
        if short_name and not short_name[0].isdigit():
          namespaces[prefix].append((short_name, ex))

    for ns_name in sorted(namespaces.keys()):
      entries = namespaces[ns_name]
      typescriptDefinitionOutput += f"export namespace {ns_name} {{\n"
      for short_name, ex in sorted(entries, key=lambda e: e[0]):
        full_name = ex["export"]
        if ex["kind"] == "function":
          typescriptDefinitionOutput += f"  export type {short_name} = typeof {full_name};\n"
        else:
          typescriptDefinitionOutput += f"  export type {short_name} = {full_name};\n"
      typescriptDefinitionOutput += "}\n\n"
    # --- End namespace blocks ---

    main_flags = buildConfig["mainBuild"].get("emccFlags", [])
    uses_native_wasm_eh = any('-fwasm-exceptions' in f for f in main_flags)
    if uses_native_wasm_eh:
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

    typescriptDefinitionOutput += \
      "\n/**\n" + \
      " * Union of the Emscripten `FS` namespace and all bound OCCT classes, enums, and functions.\n" + \
      " *\n" + \
      " * Returned by {@link init} after the WASM module is fully loaded. Access any\n" + \
      " * OCCT binding as a property (e.g. `oc.BRepPrimAPI_MakeBox`) and use `oc.FS`\n" + \
      " * for virtual filesystem operations.\n" + \
      " */\n" + \
      "export type OpenCascadeInstance = {FS: typeof FS} & {\n  " + ";\n  ".join(map(lambda x: x["export"] + ": typeof " + x["export"], typescriptExports)) + ";\n" + \
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

    typescriptDefinitionsFile = open(os.getcwd() + "/" + os.path.splitext(buildConfig["mainBuild"]["name"])[0] + ".d.ts", "w")
    typescriptDefinitionsFile.write(typescriptDefinitionOutput)
    print("TypeScript definitions written.", flush=True)

if __name__ == "__main__":
  multiprocessing.set_start_method("fork")
  main()

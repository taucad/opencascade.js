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
from Common import OCJS_ROOT, getFlatIncludePaths, PCH_FILE, WASM_EXCEPTION_FLAGS, USE_WASM_EXCEPTIONS, EXTRA_COMPILE_FLAGS
from filter.filterPackages import filterPackages
try:
    import provenance as prov
except ImportError:
    prov = None

_yaml_config_hash = ""


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

def runBuild(build, libraryBasePath):
  def getAdditionalBindCodeO():
    if "additionalBindCode" in build:
      try:
        os.mkdir(libraryBasePath + "/additionalBindCode")
      except Exception:
        pass
      additionalBindCodeFileName = libraryBasePath + "/additionalBindCode/" + build["name"] + ".cpp"
      f = open(additionalBindCodeFileName, "w")
      f.write(build["additionalBindCode"])
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
    else:
      return None
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

  OPT_LEVEL = os.environ.get("OCJS_OPT", "-O2")
  USE_LTO = os.environ.get("OCJS_LTO", "1") == "1"
  yaml_flags = [f for f in build["emccFlags"] if not f.startswith("-O") and f != "-flto"]
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
  if os.environ.get("OCJS_CLOSURE", "false") == "true":
    linkCmd.extend(["--closure", "1"])
  if os.environ.get("OCJS_EVAL_CTORS", "false") == "true":
    linkCmd.append("-sEVAL_CTORS=1")
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

  if os.path.exists(wasmFile) and wasmOptPath and os.path.exists(wasmOptPath):
    print(f"Running wasm-opt on {wasmFile} ({sizeBefore / (1024*1024):.1f} MB)...", flush=True)
    wasm_opt_level = os.environ.get("OCJS_WASM_OPT_LEVEL", "-O3")
    wasm_opt_flag_list = [wasm_opt_level, "--strip-debug", "--strip-producers", "--enable-mutable-globals", "--enable-bulk-memory", "--enable-sign-ext", "--enable-nontrapping-float-to-int"]
    if os.environ.get("OCJS_CONVERGE", "false") == "true":
      wasm_opt_flag_list.append("--converge")
    wasmOptCmd = [wasmOptPath] + wasm_opt_flag_list
    wasmOptCmd.append("--enable-exception-handling")
    wasm_opt_flag_list.append("--enable-exception-handling")
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


def main():
  from generateBindings import generateCustomCodeBindings
  from compileBindings import compileCustomCodeBindings

  parser = ArgumentParser()
  parser.add_argument(dest="filename", help="Custom build input file (.yml)", metavar="FILE.yml")
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

  runBuild(buildConfig["mainBuild"], libraryBasePath)
  for extraBuild in buildConfig["extraBuilds"]:
    runBuild(extraBuild, libraryBasePath)

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

    # Declarations for types provided via additionalBindCode
    typescriptDefinitionOutput += \
      "export declare class TColStd_IndexedDataMapOfStringString {\n" + \
      "  constructor();\n" + \
      "  delete(): void;\n" + \
      "}\n\n" + \
      "export declare class TopoDS_Cast {\n" + \
      "  static Edge(shape: TopoDS_Shape): TopoDS_Edge;\n" + \
      "  static Wire(shape: TopoDS_Shape): TopoDS_Wire;\n" + \
      "  static Face(shape: TopoDS_Shape): TopoDS_Face;\n" + \
      "  static Vertex(shape: TopoDS_Shape): TopoDS_Vertex;\n" + \
      "  static Shell(shape: TopoDS_Shape): TopoDS_Shell;\n" + \
      "  static Solid(shape: TopoDS_Shape): TopoDS_Solid;\n" + \
      "  static Compound(shape: TopoDS_Shape): TopoDS_Compound;\n" + \
      "}\n\n"
    typescriptExports.extend([
      {"export": "TColStd_IndexedDataMapOfStringString", "kind": "class"},
      {"export": "TopoDS_Cast", "kind": "class"},
    ])

    typescriptDefinitionOutput += \
      "type Standard_Boolean = boolean;\n" + \
      "type Standard_Byte = number;\n" + \
      "type Standard_Character = string;\n" + \
      "type Standard_CString = string;\n" + \
      "type Standard_Integer = number;\n" + \
      "type Standard_Real = number;\n" + \
      "type Standard_ShortReal = number;\n" + \
      "type Standard_Size = number;\n\n" + \
      "declare namespace FS {\n" + \
      "  interface Lookup {\n" + \
      "      path: string;\n" + \
      "      node: FSNode;\n" + \
      "  }\n" + \
      "\n" + \
      "  interface FSStream {}\n" + \
      "  interface FSNode {}\n" + \
      "  interface ErrnoError {}\n" + \
      "\n" + \
      "  let ignorePermissions: boolean;\n" + \
      "  let trackingDelegate: any;\n" + \
      "  let tracking: any;\n" + \
      "  let genericErrors: any;\n" + \
      "\n" + \
      "  //\n" + \
      "  // paths\n" + \
      "  //\n" + \
      "  function lookupPath(path: string, opts: any): Lookup;\n" + \
      "  function getPath(node: FSNode): string;\n" + \
      "\n" + \
      "  //\n" + \
      "  // nodes\n" + \
      "  //\n" + \
      "  function isFile(mode: number): boolean;\n" + \
      "  function isDir(mode: number): boolean;\n" + \
      "  function isLink(mode: number): boolean;\n" + \
      "  function isChrdev(mode: number): boolean;\n" + \
      "  function isBlkdev(mode: number): boolean;\n" + \
      "  function isFIFO(mode: number): boolean;\n" + \
      "  function isSocket(mode: number): boolean;\n" + \
      "\n" + \
      "  //\n" + \
      "  // devices\n" + \
      "  //\n" + \
      "  function major(dev: number): number;\n" + \
      "  function minor(dev: number): number;\n" + \
      "  function makedev(ma: number, mi: number): number;\n" + \
      "  function registerDevice(dev: number, ops: any): void;\n" + \
      "\n" + \
      "  //\n" + \
      "  // core\n" + \
      "  //\n" + \
      "  function syncfs(populate: boolean, callback: (e: any) => any): void;\n" + \
      "  function syncfs(callback: (e: any) => any, populate?: boolean): void;\n" + \
      "  function mount(type: any, opts: any, mountpoint: string): any;\n" + \
      "  function unmount(mountpoint: string): void;\n" + \
      "\n" + \
      "  function mkdir(path: string, mode?: number): any;\n" + \
      "  function mkdev(path: string, mode?: number, dev?: number): any;\n" + \
      "  function symlink(oldpath: string, newpath: string): any;\n" + \
      "  function rename(old_path: string, new_path: string): void;\n" + \
      "  function rmdir(path: string): void;\n" + \
      "  function readdir(path: string): any;\n" + \
      "  function unlink(path: string): void;\n" + \
      "  function readlink(path: string): string;\n" + \
      "  function stat(path: string, dontFollow?: boolean): any;\n" + \
      "  function lstat(path: string): any;\n" + \
      "  function chmod(path: string, mode: number, dontFollow?: boolean): void;\n" + \
      "  function lchmod(path: string, mode: number): void;\n" + \
      "  function fchmod(fd: number, mode: number): void;\n" + \
      "  function chown(path: string, uid: number, gid: number, dontFollow?: boolean): void;\n" + \
      "  function lchown(path: string, uid: number, gid: number): void;\n" + \
      "  function fchown(fd: number, uid: number, gid: number): void;\n" + \
      "  function truncate(path: string, len: number): void;\n" + \
      "  function ftruncate(fd: number, len: number): void;\n" + \
      "  function utime(path: string, atime: number, mtime: number): void;\n" + \
      "  function open(path: string, flags: string, mode?: number, fd_start?: number, fd_end?: number): FSStream;\n" + \
      "  function close(stream: FSStream): void;\n" + \
      "  function llseek(stream: FSStream, offset: number, whence: number): any;\n" + \
      "  function read(stream: FSStream, buffer: ArrayBufferView, offset: number, length: number, position?: number): number;\n" + \
      "  function write(\n" + \
      "      stream: FSStream,\n" + \
      "      buffer: ArrayBufferView,\n" + \
      "      offset: number,\n" + \
      "      length: number,\n" + \
      "      position?: number,\n" + \
      "      canOwn?: boolean,\n" + \
      "  ): number;\n" + \
      "  function allocate(stream: FSStream, offset: number, length: number): void;\n" + \
      "  function mmap(\n" + \
      "      stream: FSStream,\n" + \
      "      buffer: ArrayBufferView,\n" + \
      "      offset: number,\n" + \
      "      length: number,\n" + \
      "      position: number,\n" + \
      "      prot: number,\n" + \
      "      flags: number,\n" + \
      "  ): any;\n" + \
      "  function ioctl(stream: FSStream, cmd: any, arg: any): any;\n" + \
      "  function readFile(path: string, opts: { encoding: 'binary'; flags?: string }): Uint8Array;\n" + \
      "  function readFile(path: string, opts: { encoding: 'utf8'; flags?: string }): string;\n" + \
      "  function readFile(path: string, opts?: { flags?: string }): Uint8Array;\n" + \
      "  function writeFile(path: string, data: string | ArrayBufferView, opts?: { flags?: string }): void;\n" + \
      "\n" + \
      "  //\n" + \
      "  // module-level FS code\n" + \
      "  //\n" + \
      "  function cwd(): string;\n" + \
      "  function chdir(path: string): void;\n" + \
      "  function init(\n" + \
      "      input: null | (() => number | null),\n" + \
      "      output: null | ((c: number) => any),\n" + \
      "      error: null | ((c: number) => any),\n" + \
      "  ): void;\n" + \
      "\n" + \
      "  function createLazyFile(\n" + \
      "      parent: string | FSNode,\n" + \
      "      name: string,\n" + \
      "      url: string,\n" + \
      "      canRead: boolean,\n" + \
      "      canWrite: boolean,\n" + \
      "  ): FSNode;\n" + \
      "  function createPreloadedFile(\n" + \
      "      parent: string | FSNode,\n" + \
      "      name: string,\n" + \
      "      url: string,\n" + \
      "      canRead: boolean,\n" + \
      "      canWrite: boolean,\n" + \
      "      onload?: () => void,\n" + \
      "      onerror?: () => void,\n" + \
      "      dontCreateFile?: boolean,\n" + \
      "      canOwn?: boolean,\n" + \
      "  ): void;\n" + \
      "  function createDataFile(\n" + \
      "      parent: string | FSNode,\n" + \
      "      name: string,\n" + \
      "      data: ArrayBufferView | string,\n" + \
      "      canRead: boolean,\n" + \
      "      canWrite: boolean,\n" + \
      "      canOwn: boolean,\n" + \
      "  ): FSNode;\n" + \
      "  interface AnalysisResults {\n" + \
      "    isRoot: boolean,\n" + \
      "    exists: boolean,\n" + \
      "    error: Error,\n" + \
      "    name: string,\n" + \
      "    path: any,\n" + \
      "    object: any,\n" + \
      "    parentExists: boolean,\n" + \
      "    parentPath: any,\n" + \
      "    parentObject: any\n" + \
      "  }\n" + \
      "  function analyzePath(path: string): AnalysisResults;\n" + \
      "}\n\n" + \
      "\nexport type OpenCascadeInstance = {FS: typeof FS} & {\n  " + ";\n  ".join(map(lambda x: x["export"] + ((": typeof " + x["export"]) if x["kind"] == "class" else (": " + x["export"])), typescriptExports)) + ";\n" + \
      "};\n\n" + \
      "declare function init(): Promise<OpenCascadeInstance>;\n\n" + \
      "export default init;\n"

    typescriptDefinitionsFile = open(os.getcwd() + "/" + os.path.splitext(buildConfig["mainBuild"]["name"])[0] + ".d.ts", "w")
    typescriptDefinitionsFile.write(typescriptDefinitionOutput)
    print("TypeScript definitions written.", flush=True)

if __name__ == "__main__":
  multiprocessing.set_start_method("fork")
  main()

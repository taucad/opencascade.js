#!/usr/bin/python3

from typing import Callable
from bindings import EmbindBindings, TypescriptBindings, shouldProcessClass
import clang.cindex
import os
import errno
import hashlib
from wasmGenerator.Common import SkipException
from Common import ocIncludeStatements
import json
from filter.filterPackages import filterPackages
from TuInfo import TuInfo

from Common import OCJS_ROOT, OCCT_ROOT
libraryBasePath = OCJS_ROOT + "/build/bindings"
buildDirectory = OCJS_ROOT + "/build"
occtBasePath = OCCT_ROOT + "/src/"

GENERATOR_HASH_FILE = os.path.join(libraryBasePath, ".generator-hash")

def _generator_source_hash() -> str:
  """Hash all Python source files that affect binding generation."""
  h = hashlib.sha256()
  src_dir = os.path.join(OCJS_ROOT, "src")
  for root, dirs, files in os.walk(src_dir):
    dirs[:] = [d for d in sorted(dirs) if d != "__pycache__"]
    for fname in sorted(files):
      if fname.endswith(".py"):
        fpath = os.path.join(root, fname)
        with open(fpath, "rb") as f:
          h.update(f.read())
  return h.hexdigest()[:16]

def _check_generator_hash_and_clean():
  """Compare current generator code hash to stored hash; purge stale outputs on mismatch."""
  current_hash = _generator_source_hash()

  stored_hash = ""
  if os.path.exists(GENERATOR_HASH_FILE):
    with open(GENERATOR_HASH_FILE, "r") as f:
      stored_hash = f.read().strip()

  if stored_hash == current_hash:
    return

  if stored_hash:
    print(f"Generator code changed (was {stored_hash[:8]}..., now {current_hash[:8]}...). Purging stale .d.ts.json and .cpp files.")
  else:
    print(f"No generator hash found. Will regenerate all bindings.")

  target = libraryBasePath
  if os.path.islink(target):
    target = os.path.realpath(target)

  count = 0
  for dirpath, dirnames, filenames in os.walk(target):
    for fname in filenames:
      if fname.endswith(".d.ts.json") or (fname.endswith(".cpp") and not fname.endswith(".cpp.o")):
        os.remove(os.path.join(dirpath, fname))
        count += 1
  if count > 0:
    print(f"  Removed {count} stale generated files.")

  os.makedirs(os.path.dirname(GENERATOR_HASH_FILE), exist_ok=True)
  with open(GENERATOR_HASH_FILE, "w") as f:
    f.write(current_hash)

def mkdirp(name: str) -> None:
  try:
    os.makedirs(name)
  except OSError as e:
    if e.errno != errno.EEXIST:
      raise

def filterClasses(child, customBuild):
  if customBuild:
    return (
      child.location.file is not None and child.location.file.name == "myMain.h" and
      shouldProcessClass(child, occtBasePath)
    )
  return (
    child.extent.start.file is not None and child.extent.start.file.name.startswith(occtBasePath) and
    filterPackages(os.path.basename(os.path.dirname(child.location.file.name))) and
    shouldProcessClass(child, occtBasePath)
  )

_FILTERED_TEMPLATE_TYPEDEFS = frozenset({
  "Handle_math_NotSquare",
  "Handle_math_SingularMatrix",
  "TColStd_PackedMapOfInteger",
  "TColStd_SequenceOfAddress",
  "TopTools_IndexedDataMapOfShapeAddress",
})

def filterTemplates(child, customBuild):
  if child.spelling in _FILTERED_TEMPLATE_TYPEDEFS:
    return False
  if child.spelling.startswith("Handle_"):
    return False
  if customBuild:
    return (
      child.location.file is not None and child.location.file.name == "myMain.h" and
      child.kind == clang.cindex.CursorKind.TYPEDEF_DECL and
      (
        child.underlying_typedef_type.kind == clang.cindex.TypeKind.ELABORATED or
        child.underlying_typedef_type.kind == clang.cindex.TypeKind.UNEXPOSED
      )
    )
  return ((
      child.extent.start.file is not None and child.extent.start.file.name.startswith(occtBasePath) and
      filterPackages(os.path.basename(os.path.dirname(child.location.file.name)))
    ) and
    child.kind == clang.cindex.CursorKind.TYPEDEF_DECL and
    (
      child.underlying_typedef_type.kind == clang.cindex.TypeKind.ELABORATED or
      child.underlying_typedef_type.kind == clang.cindex.TypeKind.UNEXPOSED
    )
  )

def filterEnums(child, customBuild):
  if customBuild:
    return child.location.file is not None and child.location.file.name == "myMain.h"
  return ((
      child.extent.start.file is not None and child.extent.start.file.name.startswith(occtBasePath) and
      filterPackages(os.path.basename(os.path.dirname(child.location.file.name)))
    ) and
    child.kind == clang.cindex.CursorKind.ENUM_DECL
  )

def processChildren(tuInfo: TuInfo, children, extension: str, filterFunction: Callable[[any], bool], processFunction: Callable[[any, any], str], preamble: str, customBuild: bool):
  for child in children:
    if not filterFunction(child, customBuild) or child.spelling == "" or child.spelling.startswith("("):
      continue

    relOcFileName: str = child.extent.start.file.name.replace(occtBasePath, "")
    mkdirp(buildDirectory + "/bindings/" + os.path.dirname(relOcFileName))
    mkdirp(buildDirectory + "/bindings/" + relOcFileName)
    filename = buildDirectory + "/bindings/" + relOcFileName + "/" + (child.spelling if not child.spelling == "" else child.type.spelling) + extension

    if not os.path.exists(filename):
      print("Processing " + child.spelling)
      try:
        output = processFunction(tuInfo, preamble, child)
        bindingsFile = open(filename, "w")
        bindingsFile.write(output)
      except SkipException as e:
        print(str(e))
    else:
      print("file " + child.spelling + ".cpp already exists, skipping")

def split(a, n):
  k, m = divmod(len(a), n)
  return (a[i * k + min(i, m):(i + 1) * k + min(i + 1, m)] for i in range(n))

def processTemplate(child):
  templateRefs = list(filter(lambda x: x.kind == clang.cindex.CursorKind.TEMPLATE_REF, child.get_children()))
  if len(templateRefs) != 1:
    raise SkipException("The number of template refs for the template typedef \"" + child.spelling + "\" is not 1!")

  templateClass = templateRefs[0].get_definition()
  if templateClass is None:
    raise SkipException("Template class is None (" + child.spelling + ")")
  templateArgNames = list(filter(lambda x: x.kind == clang.cindex.CursorKind.TEMPLATE_TYPE_PARAMETER, templateClass.get_children()))
  templateArgs = {}
  for i, templateArgName in enumerate(templateArgNames):
    templateArgType = child.type.get_template_argument_type(i)
    if templateArgType.spelling == "":
      raise SkipException("Template argument type is empty for at least one argument. Is this class using default values for template arguments? This is currently not supported (" + child.spelling + ")")
    templateArgs[templateArgName.spelling] = templateArgType
  
  return [templateClass, templateArgs]

def embindGenerationFuncClasses(tuInfo: TuInfo, preamble, child) -> str:
  embindings = EmbindBindings(tuInfo)
  output = embindings.processClass(child)

  return preamble + output

def embindGenerationFuncTemplates(tuInfo: TuInfo, preamble, child) -> str:
  [templateClass, templateArgs] = processTemplate(child)
  embindings = EmbindBindings(tuInfo)
  output = embindings.processClass(templateClass, child, templateArgs)

  return preamble + output

def embindGenerationFuncEnums(tuInfo: TuInfo, preamble, child) -> str:
  embindings = EmbindBindings(tuInfo)
  output = embindings.processEnum(child)

  return preamble + output

def process(tuInfo: TuInfo, extension, embindGenerationFuncClasses, embindGenerationFuncTemplates, embindGenerationFuncEnums, preamble, customBuild):
  processChildren(tuInfo, tuInfo.allChildren, extension, filterClasses, embindGenerationFuncClasses, preamble, customBuild)
  processChildren(tuInfo, tuInfo.templateTypedefs, extension, filterTemplates, embindGenerationFuncTemplates, preamble, customBuild)
  processChildren(tuInfo, tuInfo.enums, extension, filterEnums, embindGenerationFuncEnums, preamble, customBuild)

def typescriptGenerationFuncClasses(tuInfo: TuInfo, preamble, child) -> str:
  typescript = TypescriptBindings(tuInfo)
  output = typescript.processClass(child)

  return json.dumps({
    ".d.ts": preamble + output,
    "kind": "class",
    "exports": typescript.exports,
  })

def typescriptGenerationFuncTemplates(tuInfo: TuInfo, preamble, child) -> str:
  [templateClass, templateArgs] = processTemplate(child)
  typescript = TypescriptBindings(tuInfo)
  output = typescript.processClass(templateClass, child, templateArgs)

  return json.dumps({
    ".d.ts": preamble + output,
    "kind": "class",
    "exports": typescript.exports,
  })

def typescriptGenerationFuncEnums(tuInfo: TuInfo, preamble, child) -> str:
  typescript = TypescriptBindings(tuInfo)
  output = typescript.processEnum(child)

  return json.dumps({
    ".d.ts": preamble + output,
    "kind": "enum",
    "exports": typescript.exports,
  })

referenceTypeTemplateDefs = \
  "\n" + \
  "#include <emscripten/bind.h>\n" + \
  "#include <emscripten/wire.h>\n" + \
  "using namespace emscripten;\n" + \
  "#include <functional>\n" + \
  "#include <stdexcept>\n" + \
  "#include \"ocjs_smart_ptr.h\"\n" + \
  "#include \"ocjs_handle_helpers.h\"\n" + \
  "\n" + \
  "template<typename T>\n" + \
  "T getReferenceValue(const emscripten::val& v) {\n" + \
  "  if(!(v.typeOf().as<std::string>() == \"object\")) {\n" + \
  "    return v.as<T>(allow_raw_pointers());\n" + \
  "  } else if(v.typeOf().as<std::string>() == \"object\" && v.hasOwnProperty(\"current\")) {\n" + \
  "    return v[\"current\"].as<T>(allow_raw_pointers());\n" + \
  "  }\n" + \
  "  throw(\"unsupported type\");\n" + \
  "}\n" + \
  "\n" + \
  "template<typename T>\n" + \
  "void updateReferenceValue(emscripten::val& v, T& val) {\n" + \
  "  if(v.typeOf().as<std::string>() == \"object\" && v.hasOwnProperty(\"current\")) {\n" + \
  "    v.set(\"current\", val);\n" + \
  "  }\n" + \
  "}\n" + \
  "\n"

def generateCustomCodeBindings(customCode):
  try:
    os.makedirs(libraryBasePath)
  except Exception:
    pass

  embindPreamble = ocIncludeStatements + "\n" + referenceTypeTemplateDefs + "\n" + customCode

  tuInfo = TuInfo(customCode)
  process(tuInfo, ".cpp", embindGenerationFuncClasses, embindGenerationFuncTemplates, embindGenerationFuncEnums, embindPreamble, True)
  process(tuInfo, ".d.ts.json", typescriptGenerationFuncClasses, typescriptGenerationFuncTemplates, typescriptGenerationFuncEnums, "", True)

if __name__ == "__main__":
  import argparse
  parser = argparse.ArgumentParser(description="Generate OCCT Embind/TypeScript bindings")
  parser.add_argument("--config", default=None, help="Path to bindgen-filters.yaml for config-driven filtering")
  args = parser.parse_args()

  if args.config:
    from ocjs_bindgen.config import get_config
    from ocjs_bindgen import filters
    config = get_config(args.config)
    filters.install(config)
    if config.excluded_template_typedefs:
      _FILTERED_TEMPLATE_TYPEDEFS = _FILTERED_TEMPLATE_TYPEDEFS | config.excluded_template_typedefs

  try:
    os.makedirs(libraryBasePath)
  except Exception:
    pass

  _check_generator_hash_and_clean()

  tuInfo = TuInfo("")

  embindPreamble = ocIncludeStatements + "\n" + referenceTypeTemplateDefs
  process(tuInfo, ".cpp", embindGenerationFuncClasses, embindGenerationFuncTemplates, embindGenerationFuncEnums, embindPreamble, False)

  process(tuInfo, ".d.ts.json", typescriptGenerationFuncClasses, typescriptGenerationFuncTemplates, typescriptGenerationFuncEnums, "", False)

import clang.cindex
from Common import includePathArgs, ocAllIncludeStatements, occtBasePath
from filter.filterTypedefs import filterTypedef
from filter.filterEnums import filterEnum
from wasmGenerator.Common import ignoreDuplicateTypedef

def parse(additionalCppCode = ""):
  index = clang.cindex.Index.create()
  translationUnit = index.parse(
    "myMain.h", [
      "-x",
      "c++",
      "-stdlib=libc++",
      "-D__EMSCRIPTEN__"
    ] + includePathArgs,
    [["myMain.h", ocAllIncludeStatements + "\n" + additionalCppCode]]
  )

  if len(translationUnit.diagnostics) > 0:
    print("Diagnostic Messages:")
    for d in translationUnit.diagnostics:
      print("  " + d.format())

  return translationUnit

def _collect_from_cursor(cursor, predicate):
  """Recursively collect declarations matching predicate, descending into namespaces."""
  result = []
  for child in cursor.get_children():
    if child.kind == clang.cindex.CursorKind.NAMESPACE:
      result.extend(_collect_from_cursor(child, predicate))
    elif predicate(child):
      result.append(child)
  return result

def templateTypedefGenerator(tu):
  return _collect_from_cursor(
    tu.cursor,
    lambda x:
      x.kind in (clang.cindex.CursorKind.TYPEDEF_DECL, clang.cindex.CursorKind.TYPE_ALIAS_DECL) and
      not (x.get_definition() is None or not x == x.get_definition()) and
      filterTypedef(x) and
      x.type.get_num_template_arguments() != -1 and
      not ignoreDuplicateTypedef(x),
  )

def typedefGenerator(tu):
  return _collect_from_cursor(
    tu.cursor,
    lambda x: x.kind in (clang.cindex.CursorKind.TYPEDEF_DECL, clang.cindex.CursorKind.TYPE_ALIAS_DECL),
  )

def allChildrenGenerator(tu):
  return list(tu.cursor.get_children())

def enumGenerator(tu):
  return list(filter(lambda x: x.kind == clang.cindex.CursorKind.ENUM_DECL and filterEnum(x), tu.cursor.get_children()))

def classDict(tu):
  d = dict()
  for x in tu.cursor.get_children():
    if (
      x.kind == clang.cindex.CursorKind.CLASS_DECL or
      x.kind == clang.cindex.CursorKind.STRUCT_DECL
    ) and not (
      x.get_definition() is None or
      not x == x.get_definition()
    ):
      if x.spelling not in d:
        d[x.spelling] = x
  return d

_SKIP_UNDERLYING_TYPES = frozenset({
  "void",  # AdvApp2Var_Data_f2c.hxx: typedef VOID C_f -- Fortran artifact
})

def underlyingDict(l, checkOcctBasePath: bool):
  """Return a dict mapping underlying type spelling → typedef cursor.

  Only the first cursor seen wins (legacy single-cursor consumers depend on
  this). Use ``underlyingMultimap`` when *all* aliases for an underlying type
  are needed (e.g. deterministic alias selection in bindings.py).
  """
  d = dict()
  for x in l:
    if checkOcctBasePath and not x.location.file.name.startswith(occtBasePath):
      continue
    underlying = x.underlying_typedef_type.spelling
    if underlying in _SKIP_UNDERLYING_TYPES:
      continue
    if underlying not in d:
      d[underlying] = x
  return d


def underlyingMultimap(l, checkOcctBasePath: bool):
  """Return a dict mapping underlying type spelling → list of typedef cursors.

  Unlike ``underlyingDict``, every alias is retained so callers can pick the
  best one based on naming heuristics. Iteration order matches the source
  list.
  """
  d = dict()
  for x in l:
    if checkOcctBasePath and not x.location.file.name.startswith(occtBasePath):
      continue
    underlying = x.underlying_typedef_type.spelling
    if underlying in _SKIP_UNDERLYING_TYPES:
      continue
    d.setdefault(underlying, []).append(x)
  return d


class TuInfo:
  def __init__(self, customCode):
    self.tu = parse(customCode)
    self.allChildren = allChildrenGenerator(self.tu)
    self.typedefs = typedefGenerator(self.tu)
    self.enums = enumGenerator(self.tu)
    self.templateTypedefs = templateTypedefGenerator(self.tu)
    self.classDict = classDict(self.tu)
    self.typedefUnderlyingDict = underlyingDict(self.typedefs, True)
    self.templateTypedefUnderlyingDict = underlyingDict(self.templateTypedefs, False)
    self.typedefUnderlyingMultimap = underlyingMultimap(self.typedefs, True)
    self.templateTypedefUnderlyingMultimap = underlyingMultimap(self.templateTypedefs, False)

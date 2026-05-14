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

# Namespaces whose contents must NOT be enumerated for binding generation —
# these are stdlib / Emscripten internals that would (a) blow up symbol counts
# with thousands of irrelevant declarations and (b) cause libclang assertion
# failures on internal class templates.
_SKIPPED_NAMESPACES = frozenset({
  "std",
  "emscripten",
  "__gnu_cxx",
  "__cxxabiv1",
  "__cxx",
  "__1",
  # Flex/Bison generated parser internals from OCCT V8's StepFile module.
  # The `step::parser` and `step::scanner` classes carry private data members
  # and union-typed semantic stacks that Embind cannot bind, and are not part
  # of any public API surface (they're invoked through the `StepData_*`
  # facade). Admitting them yields compile errors like `'private member'` /
  # `union with non-trivial member` in the emitted bindings.
  "step",
})

def _walk_namespaces(cursor, predicate, results):
  """Single-level walker: apply `predicate` to each direct non-namespace child of `cursor`.

  This is intentionally NON-recursive. Doubly-nested namespaces
  (`Outer::Inner::Type`) are out of scope for the current namespace-aware
  bindgen — `getClassJsPublicName` only encodes the IMMEDIATE parent
  namespace as the `Namespace_TypeName` prefix, so admitting deeper types
  here produces a JS public name that doesn't match the C++ binding's
  `class_<Outer::Inner::Type>("Inner_Type")` reference and the binding
  fails with `use of undeclared identifier 'Inner'` at compile time.
  Recursing into nested namespaces would require the helper, the JS
  public-name encoder, AND every emit site to agree on a multi-level
  mangling scheme — deferred until a real consumer surfaces.
  """
  for child in cursor.get_children():
    if child.kind == clang.cindex.CursorKind.NAMESPACE:
      continue
    predicate(child, results)

def _is_top_level_namespace_member(cursor):
  """True if `cursor` is directly inside a non-stdlib namespace (not nested in a class/struct)."""
  parent = cursor.semantic_parent
  return (
    parent is not None
    and parent.kind == clang.cindex.CursorKind.NAMESPACE
    and parent.spelling
    and parent.spelling not in _SKIPPED_NAMESPACES
  )

def allChildrenGenerator(tu):
  """Top-level decls plus class/struct decls discovered inside non-stdlib namespaces.

  The original implementation only returned `tu.cursor.get_children()`, which silently
  dropped namespace-scoped types like `ExtremaPC::Result`. We now augment the flat list
  with namespace-descended class/struct cursors so the existing class binding pipeline
  (driven by `processChildren(tuInfo.allChildren, …, filterClasses, …)`) picks them up
  without any other plumbing changes. Namespace cursors themselves are preserved in the
  result so legacy consumers iterating top-level decls observe an identical surface.
  """
  flat = list(tu.cursor.get_children())
  ns_descended = []
  def _collect(child, out):
    if child.kind in (clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
      out.append(child)
  for top in flat:
    if top.kind == clang.cindex.CursorKind.NAMESPACE and top.spelling and top.spelling not in _SKIPPED_NAMESPACES:
      _walk_namespaces(top, _collect, ns_descended)
  return flat + ns_descended

def enumGenerator(tu):
  """All enum decls visible at top-level OR inside non-stdlib namespaces."""
  results = []
  for child in tu.cursor.get_children():
    if child.kind == clang.cindex.CursorKind.ENUM_DECL and filterEnum(child):
      results.append(child)
    elif child.kind == clang.cindex.CursorKind.NAMESPACE and child.spelling and child.spelling not in _SKIPPED_NAMESPACES:
      def _collect_enum(c, out):
        if c.kind == clang.cindex.CursorKind.ENUM_DECL and filterEnum(c):
          out.append(c)
      _walk_namespaces(child, _collect_enum, results)
  return results

def classDict(tu):
  """Map of class/struct spelling → cursor, including namespace-scoped types.

  Namespace-scoped names are keyed by their bare spelling (e.g. `Result`, not
  `ExtremaPC_Result`). This mirrors how `isTransientDerived` / `getBaseClass`
  query the dict by raw `spelling` strings extracted from `CXX_BASE_SPECIFIER`
  type names. When a namespace-scoped type collides with a top-level type of
  the same spelling, the top-level definition wins (insertion order).
  """
  d = dict()
  def _add(cursor):
    if cursor.kind not in (clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
      return
    if cursor.get_definition() is None or cursor != cursor.get_definition():
      return
    if cursor.spelling and cursor.spelling not in d:
      d[cursor.spelling] = cursor
  for x in tu.cursor.get_children():
    _add(x)
  for x in tu.cursor.get_children():
    if x.kind == clang.cindex.CursorKind.NAMESPACE and x.spelling and x.spelling not in _SKIPPED_NAMESPACES:
      def _collect_class(c, _out):
        _add(c)
      _walk_namespaces(x, _collect_class, [])
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

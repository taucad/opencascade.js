import clang.cindex
import json
import os
import re
from collections import defaultdict, namedtuple
from dataclasses import dataclass, field

from wasmGenerator.Common import SkipException, isAbstractClass, isTransientDerived, getMethodOverloadPostfix
from filter.filterClasses import filterClass
from filter.filterMethodOrProperties import filterMethodOrProperty
from typing import Tuple, List, Any, Optional, Dict

JsType = namedtuple('JsType', ['category', 'name'])

def _normalize_handle_ns(s: str) -> str:
  """Normalize handle namespace to canonical occ::handle spelling."""
  return s.replace("opencascade::handle", "occ::handle")

@dataclass
class DispatchLeaf:
  overload: Any

@dataclass
class DispatchBranch:
  arg_position: int
  branches: dict = field(default_factory=dict)

@dataclass
class DispatchAmbiguous:
  overloads: list = field(default_factory=list)

def merge(sep: str, *strings: List[str]):
  return sep.join(strings)

def pick(condition: bool, strTrue: str, strFalse: str):
  return strTrue if condition else strFalse

def pickWrap(condition: bool, wrapStart: Tuple[str, str], center: str, wrapEnd: Tuple[str, str]):
  return (wrapStart[0] if condition else wrapStart[1]) + center + (wrapEnd[0] if condition else wrapEnd[1])

def indent(level: int):
  return " " * level * 2

def shouldProcessClass(child: clang.cindex.Cursor, occtBasePath: str):
  if child.get_definition() is None or not child == child.get_definition():
    return False

  if not filterClass(child):
    return False

  if (
    child.kind == clang.cindex.CursorKind.CLASS_DECL or
    child.kind == clang.cindex.CursorKind.STRUCT_DECL
  ) and not child.type.get_num_template_arguments() == -1:
    return False

  if (
    child.kind == clang.cindex.CursorKind.CLASS_DECL or
    child.kind == clang.cindex.CursorKind.STRUCT_DECL
  ):
    baseSpec = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, child.get_children()))
    if len(baseSpec) > 1:
      print("cannot handle multiple base classes (" + child.spelling + ")")
      return False
    
    return True

  return False

builtInTypes = [ # according to https://en.cppreference.com/w/cpp/language/types
  # Integer types
  "int",
  "short", "short int", "signed short", "signed short int",
  "unsigned short", "unsigned short int",
  "int", "signed", "signed int",
  "unsigned", "unsigned int",
  "long", "long int", "signed long", "signed long int",
  "unsigned long", "unsigned long int",
  "long long", "long long int", "signed long long", "signed long long int",
  "unsigned long long", "unsigned long long int",
  # Boolean type
  "bool",
  # Character types
  "char",
  "signed char", "unsigned char",
  "wchar_t",
  "char16_t", "char32_t", "char8_t",
  # Floating point types
  "float", "double", "long double"
]

cStringTypes = [
  "const char *",
  "const char *const",
  "char *",
  "char *const",
]

unbindablePointerTypes = [
  "const char16_t *",
  "const char16_t *const",
  "char16_t *",
  "char16_t *const",
]

def isCString(type):
  return type.get_canonical().spelling in cStringTypes

def _isDefaultConstructibleClass(pointee):
  """True iff the pointee is a non-abstract class/struct/class-template type
  with an accessible default constructor (explicit zero-arg ctor OR implicit
  default ctor when no ctors are declared). Drives class-typed
  input-passthrough RBV.

  Abstract classes are excluded — embind binds class-typed lambda parameters
  by value, which requires an instantiable type. OCCT exposes many abstract
  function objects (e.g. math_Function, math_MultipleVarFunctionWithGradient)
  as non-const-ref parameters; those stay on the standard embind reference
  path rather than the input-passthrough RBV transform.

  Defensive fallback: when the AST declaration cannot be resolved, returns
  False so the legacy embind proxy-mutation path stays in effect.
  """
  decl = pointee.get_declaration()
  if decl is None:
    return False
  if decl.kind not in (
    clang.cindex.CursorKind.CLASS_DECL,
    clang.cindex.CursorKind.STRUCT_DECL,
    clang.cindex.CursorKind.CLASS_TEMPLATE,
  ):
    return False
  if decl.is_abstract_record():
    return False

  # The class must be value-parameter-safe — embind binds class-typed lambda
  # parameters by value, so an accessible non-deleted copy constructor is
  # required in addition to a default ctor. Many OCCT classes (e.g.
  # BRepGProp_Domain) are *implicitly* non-copyable because they hold a
  # non-copyable member (e.g. NCollection_LocalArray inside TopExp_Explorer)
  # without declaring a copy ctor themselves. libclang in this build does not
  # expose is_copy_constructible, so we approximate by recursively walking
  # fields/bases.
  if not _isCopyConstructibleClass(decl):
    return False

  public_ctors = [
    c for c in decl.get_children()
    if c.kind == clang.cindex.CursorKind.CONSTRUCTOR
    and c.access_specifier == clang.cindex.AccessSpecifier.PUBLIC
  ]
  if not public_ctors:
    return True
  return any(
    len(list(c.get_arguments())) == 0 and not c.is_deleted_method()
    for c in public_ctors
  )


def _ctor_is_copy(ctor, decl):
  """True iff `ctor` is a copy constructor for `decl` — a single argument
  whose pointee declaration is `decl` itself. Works for both concrete
  classes and class templates (where the canonical type spelling carries
  template parameters that don't match the unparameterised decl spelling).
  """
  args = list(ctor.get_arguments())
  if len(args) != 1:
    return False
  arg_type = args[0].type
  if arg_type.kind != clang.cindex.TypeKind.LVALUEREFERENCE:
    return False
  pointee = arg_type.get_pointee()
  pointee_decl = pointee.get_declaration()
  if pointee_decl is not None:
    # Cursor equality in libclang's Python binding compares the underlying
    # CXCursor structs which include hashable USR identity; both `==` and
    # USR comparison are reliable. For templates, the injected class name
    # inside the class body refers back to the same CLASS_TEMPLATE cursor.
    if pointee_decl == decl:
      return True
    if pointee_decl.get_usr() and decl.get_usr() and pointee_decl.get_usr() == decl.get_usr():
      return True
    # For class templates the injected-class-name reference may surface as
    # a typedef/alias to the same template; compare unqualified spellings
    # as a last resort.
    if pointee_decl.spelling and decl.spelling and pointee_decl.spelling == decl.spelling:
      return True
  # Fall back to canonical spelling match (concrete classes).
  pointee_canon = pointee.get_canonical()
  return pointee_canon.spelling.replace("const ", "").strip() == decl.type.get_canonical().spelling


# Cached on canonical class spelling so we don't re-walk the same class for
# every call site. The cache is populated only after a definitive answer
# (recursion-cycle short-circuit returns True conservatively but is NOT
# cached so that a later non-cyclic call can record the real answer).
_COPY_CTOR_CACHE = {}


# Lazily built once per TU traversal pass. Maps unqualified class-template
# name → CLASS_TEMPLATE cursor with a non-empty body. Populated on first
# fallback lookup from `_resolve_record_decl` when an instantiation node has
# no children (i.e. libclang's synthetic instantiation CLASS_DECL is empty).
_CLASS_TEMPLATE_INDEX = {}


def _findClassTemplateByName(synthetic_decl):
  """Find the original CLASS_TEMPLATE definition for a synthetic
  instantiation CLASS_DECL. Walks up to the TU root (via translation_unit)
  and caches the result.
  """
  global _CLASS_TEMPLATE_INDEX
  tu = getattr(synthetic_decl, "translation_unit", None)
  if tu is None:
    return None
  if not _CLASS_TEMPLATE_INDEX:
    def _walk(c):
      if c.kind == clang.cindex.CursorKind.CLASS_TEMPLATE and c.spelling:
        if list(c.get_children()):
          existing = _CLASS_TEMPLATE_INDEX.get(c.spelling)
          if existing is None:
            _CLASS_TEMPLATE_INDEX[c.spelling] = c
      for child in c.get_children():
        _walk(child)
    _walk(tu.cursor)
  return _CLASS_TEMPLATE_INDEX.get(synthetic_decl.spelling)


def _isCopyConstructibleClass(decl, _visiting=None):
  """Conservative recursive copy-constructibility check.

  - If the class explicitly declares any copy ctor, the union of those ctors
    must contain an accessible non-deleted one.
  - If there is no user-declared copy ctor, every non-static field's class
    type and every base's class type must itself be copy-constructible
    (recursive). Primitives, enums, pointers, and Handle<T> smart-pointers
    are always copy-constructible. Reference members are not — a class with
    a `T&` field has its implicit copy assignment deleted but copy ctor is
    OK; treat them as fine.

  Cycles (e.g. CRTP self-reference) short-circuit to True (conservative)
  but the result is NOT cached for the cyclic node so a later non-cyclic
  evaluation can record the real answer.
  """
  if _visiting is None:
    _visiting = set()

  decl_key = decl.type.get_canonical().spelling
  if not decl_key:
    decl_key = decl.spelling or "<anon>"
  if decl_key in _COPY_CTOR_CACHE:
    return _COPY_CTOR_CACHE[decl_key]
  if decl_key in _visiting:
    return True  # cycle: defer to outer caller
  _visiting.add(decl_key)

  try:
    all_ctors = [
      c for c in decl.get_children()
      if c.kind == clang.cindex.CursorKind.CONSTRUCTOR
    ]
    copy_ctors = [c for c in all_ctors if _ctor_is_copy(c, decl)]
    if copy_ctors:
      ok_copy = any(
        c.access_specifier == clang.cindex.AccessSpecifier.PUBLIC
        and not c.is_deleted_method()
        for c in copy_ctors
      )
      _COPY_CTOR_CACHE[decl_key] = ok_copy
      return ok_copy

    _record_decl_kinds = (
      clang.cindex.CursorKind.CLASS_DECL,
      clang.cindex.CursorKind.STRUCT_DECL,
      clang.cindex.CursorKind.CLASS_TEMPLATE,
      clang.cindex.CursorKind.CLASS_TEMPLATE_PARTIAL_SPECIALIZATION,
    )

    def _resolve_record_decl(t):
      """Resolve a type to its underlying record declaration if any. libclang
      sometimes hands back UNEXPOSED/ELABORATED for template instantiations
      where TypeKind.RECORD would be expected, so we fall back to
      get_declaration() and probe the cursor kind directly.

      For template instantiations the AST node returned by get_declaration()
      is a synthetic CLASS_DECL with NO child cursors — the template body
      lives on the underlying CLASS_TEMPLATE. We follow the specialization
      link so the recursive copy-ctor walk sees the real ctors / fields.
      """
      d = t.get_declaration()
      if d is None:
        return None
      if d.kind in _record_decl_kinds:
        # Template-instantiation CLASS_DECL nodes have no children; fall
        # back to the underlying template's definition. Try the cursor's
        # own definition link first, then probe the TU for a CLASS_TEMPLATE
        # with the same unqualified name (libclang in this version does
        # not expose clang_getSpecializedCursorTemplate on Cursor).
        if not list(d.get_children()):
          defn = d.get_definition()
          if defn is not None and defn != d and list(defn.get_children()):
            return defn
          tmpl = _findClassTemplateByName(d)
          if tmpl is not None:
            return tmpl
        return d
      return None

    for child in decl.get_children():
      if child.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER:
        base_type = child.type.get_canonical()
        base_decl = _resolve_record_decl(base_type)
        if base_decl and not _isCopyConstructibleClass(base_decl, _visiting):
          _COPY_CTOR_CACHE[decl_key] = False
          return False
      elif child.kind == clang.cindex.CursorKind.FIELD_DECL:
        field_type = child.type.get_canonical()
        spelling = field_type.spelling
        # Handle<T> smart-pointer types are always copy-constructible
        # (refcount bump). Detect by canonical spelling.
        if spelling.startswith("opencascade::handle<") or \
           spelling.startswith("Handle_"):
          continue
        field_decl = _resolve_record_decl(field_type)
        if field_decl is None:
          continue
        if not _isCopyConstructibleClass(field_decl, _visiting):
          _COPY_CTOR_CACHE[decl_key] = False
          return False

    _COPY_CTOR_CACHE[decl_key] = True
    return True
  finally:
    _visiting.discard(decl_key)

def isClassOutputParam(arg_type):
  """Non-const lvalue reference to a default-constructible class/struct type
  (excluding handles, which are detected separately)."""
  if arg_type.kind != clang.cindex.TypeKind.LVALUEREFERENCE:
    return False
  pointee = arg_type.get_pointee()
  if pointee.is_const_qualified():
    return False
  if pointee.kind == clang.cindex.TypeKind.POINTER:
    return False
  canonical = pointee.get_canonical()
  if canonical.spelling in builtInTypes:
    return False
  if pointee.kind == clang.cindex.TypeKind.ENUM or canonical.kind == clang.cindex.TypeKind.ENUM:
    return False
  if _isHandleType(pointee):
    return False
  return _isDefaultConstructibleClass(pointee)

# Names used for the C++ return value inside an RBV envelope. Renamed from the
# legacy "result" to "returnValue" per R4 of docs/research/ocjs-rbv-return-shape-revisit.md
# so the envelope field that carries the C++ return is not mistaken for the
# whole result object. The collision fallback is used when an OCCT output
# parameter is itself named `returnValue` — picking a trailing underscore keeps
# the canonical name available for the C++ return.
ENVELOPE_RETURN_FIELD = "returnValue"
ENVELOPE_RETURN_FIELD_COLLISION = "returnValue_"

def isOutputParam(arg_type):
  """Non-const lvalue reference to primitive, enum, handle, or default-
  constructible class = output parameter. Excludes pointer references
  (char*&, etc.) which need C-string or val wrapping instead.

  The class branch enables input-passthrough RBV for user-defined class types
  (gp_Pnt, gp_Vec, Bnd_Box, ...). See docs/research/ocjs-unified-rbv-blueprint.md
  Architecture Blueprint.
  """
  if arg_type.kind != clang.cindex.TypeKind.LVALUEREFERENCE:
    return False
  pointee = arg_type.get_pointee()
  if pointee.is_const_qualified():
    return False
  if pointee.kind == clang.cindex.TypeKind.POINTER:
    return False
  canonical = pointee.get_canonical()
  if canonical.spelling in builtInTypes:
    return True
  if pointee.kind == clang.cindex.TypeKind.ENUM or canonical.kind == clang.cindex.TypeKind.ENUM:
    return True
  if _isHandleType(pointee):
    return True
  if _isDefaultConstructibleClass(pointee):
    return True
  return False

def _isHandleType(pointee):
  """Check if a type is opencascade::handle<T> or Handle(T)."""
  decl = pointee.get_declaration()
  if decl is None:
    return False
  if decl.spelling == "handle":
    parent = decl.semantic_parent
    if parent is not None and parent.spelling in ("opencascade", "occ"):
      return True
  if pointee.get_num_template_arguments() == 1:
    if decl.spelling == "handle":
      return True
  return False

def isHandleOutputParam(arg_type):
  """Non-const lvalue reference to handle<T> specifically."""
  if arg_type.kind != clang.cindex.TypeKind.LVALUEREFERENCE:
    return False
  pointee = arg_type.get_pointee()
  if pointee.is_const_qualified():
    return False
  return _isHandleType(pointee)

def isPrimitiveOutputParam(arg_type):
  """Non-const lvalue reference to builtin type or enum."""
  if arg_type.kind != clang.cindex.TypeKind.LVALUEREFERENCE:
    return False
  pointee = arg_type.get_pointee()
  if pointee.is_const_qualified():
    return False
  canonical = pointee.get_canonical()
  return canonical.spelling in builtInTypes or pointee.kind == clang.cindex.TypeKind.ENUM or canonical.kind == clang.cindex.TypeKind.ENUM

def isRawPointerParam(arg_type):
  """Check if an argument type is a raw pointer (not a reference).
  Raw pointers cannot be passed from JS via val::as<T*>() — Embind forbids it."""
  return arg_type.get_canonical().kind == clang.cindex.TypeKind.POINTER

def shouldStripParam(arg_type, method):
  """Whether to remove the param from the JS-visible signature.

  The R1-R6 minimal transformation (`docs/research/ocjs-rbv-return-shape-revisit.md`)
  describes the full decision tree the codegen applies to each output param.
  Strip-from-JS-signature is the right-most branch of that tree:

    - Primitive/enum output (input-passthrough): stays as JS arg; value copies
      in and an updated copy comes back via the envelope's named field.
    - Class output (`gp_Pnt&`, `Bnd_Box&`, ...): stays as JS arg; the caller
      supplies the instance and the C++ lambda mutates it in place via
      `*<arg>.as<T*>(allow_raw_pointers())` (R1/R2 in the research doc).
      It is NOT echoed in the envelope.
    - Handle<T> output (Approach G — input elision): REMOVED from the
      JS-visible surface. OCCT's contract guarantees non-const `Handle<T>&`
      is output-only (never read by C++), so the caller's input is gratuitous.
      The C++ codegen allocates a stack-local null Handle inside the
      optional_override lambda instead; the resulting wrapper is surfaced as
      a container field whose lifetime is owned by the envelope's
      `[Symbol.dispose]`.

  Flipping this predicate to return True for `isHandleOutputParam` propagates
  the elision through every downstream arity, kept-name, and JSDoc path
  (see bindings.py:501, 560, 1726, 1735, 1749, 2507, 4088, 4116, 4347, 4419,
  4462). The C++ lambda emitter (`_emitOutputParamBinding`) does its own
  per-arg inspection and emits the stack-local declaration for Handle outputs
  and the `val::as<T*>` deref for class outputs.

  Design refs:
    - docs/research/ocjs-rbv-return-shape-revisit.md (R1-R6 decision tree)
    - docs/research/ocjs-rbv-handle-output-param-elision.md (Approach G)
  """
  return isHandleOutputParam(arg_type)

def getClassTypeName(theClass, templateDecl = None):
  return templateDecl.spelling if templateDecl is not None else theClass.spelling

def getClassQualifiedName(theClass, templateDecl = None):
  """Fully-qualified C++ symbol for a class (e.g. BRepGraph::CacheView).

  Walks semantic_parent for CXX-nested and namespace-nested classes so
  EMSCRIPTEN_BINDINGS template args and member pointers use names visible at file scope.

  When ``templateDecl`` is set (template typedef alias, e.g. IMeshData::BndBox2dTreeFiller),
  walk the typedef's parents — ``theClass`` is the underlying template (NCollection_UBTreeFiller),
  whose semantic_parent chain does not include IMeshData.
  """
  parent_kinds = (
    clang.cindex.CursorKind.CLASS_DECL,
    clang.cindex.CursorKind.STRUCT_DECL,
    clang.cindex.CursorKind.CLASS_TEMPLATE,
    clang.cindex.CursorKind.NAMESPACE,
  )
  if templateDecl is not None and templateDecl.spelling:
    parts = [templateDecl.spelling]
    parent = templateDecl.semantic_parent
    while parent and parent.kind in parent_kinds:
      if parent.spelling:
        parts.append(parent.spelling)
      parent = parent.semantic_parent
    return "::".join(reversed(parts))
  base = theClass.spelling if (templateDecl is None or not templateDecl.spelling) else templateDecl.spelling
  parts = [base]
  parent = theClass.semantic_parent
  while parent and parent.kind in parent_kinds:
    if parent.spelling:
      parts.append(parent.spelling)
    parent = parent.semantic_parent
  return "::".join(reversed(parts))

class Bindings:
  def __init__(self, tuInfo):
    self.tuInfo = tuInfo

  def _effectiveArgName(self, arg, index):
    """Return the structural name used for an argument across both the C++
    value_object field generator (EmbindBindings) and the TS signature
    generator (TypescriptBindings). Both must agree so the runtime payload
    keys match the declared TS keys for output-param RBV results.
    """
    return arg.spelling if arg.spelling else f"argNo{index}"

  def _find_base_override_target(self, theClass, method):
    """Walk the inheritance chain to find the most precisely matching
    same-name method on a base class.

    Matching strategy: prefer base methods with the same kept-arity AND same
    canonical kept-arg type tuple. If no exact-types match, fall back to any
    method with the same raw arity. Returns the deepest (closest-to-root)
    match so derived overrides mirror the canonical virtual contract.

    Python libclang doesn't expose `clang_getOverriddenCursors`, so we
    traverse base specifiers manually.
    """
    if theClass is None or method is None:
      return None
    name = method.spelling
    target_raw_arity = len(list(method.get_arguments()))
    target_kept = tuple(
      a.type.get_canonical().spelling
      for a in method.get_arguments()
      if not shouldStripParam(a.type, method)
    )
    target_kept_arity = len(target_kept)
    target_output_count = sum(1 for a in method.get_arguments() if isOutputParam(a.type))
    target_is_static = method.is_static_method()

    # AST overload index of the derived method within its declaring class —
    # used as a final tiebreaker when no kept-arg / output-count match exists.
    # `getMethodOverloadPostfix` uses the same indexing for the `_N` suffix,
    # so aligning here keeps the structural-compat check honest.
    same_name_in_derived = [
      c for c in theClass.get_children()
      if c.kind == clang.cindex.CursorKind.CXX_METHOD and c.spelling == name
    ]
    derived_overload_index = (
      same_name_in_derived.index(method) if method in same_name_in_derived else None
    )

    visited = set()

    def _walk(cls):
      if cls is None:
        return None
      key = cls.spelling
      if key in visited:
        return None
      visited.add(key)
      best_exact = None
      best_output_match = None
      best_arity = None
      best_index_match = None
      for child in cls.get_children():
        if child.kind != clang.cindex.CursorKind.CXX_BASE_SPECIFIER:
          continue
        if child.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
          continue
        base_decl = child.type.get_declaration()
        if base_decl is None or base_decl.kind == clang.cindex.CursorKind.NO_DECL_FOUND:
          continue
        deeper = _walk(base_decl)
        if deeper is not None:
          return deeper

        # Capture base's same-name methods in AST order so we can fall back to
        # positional matching when shape-based matching fails.
        base_same_name = []
        for sibling in base_decl.get_children():
          if sibling.kind != clang.cindex.CursorKind.CXX_METHOD:
            continue
          if sibling.spelling != name:
            continue
          if sibling.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
            continue
          if sibling.is_static_method() != target_is_static:
            continue
          base_same_name.append(sibling)
          sib_kept = tuple(
            a.type.get_canonical().spelling
            for a in sibling.get_arguments()
            if not shouldStripParam(a.type, sibling)
          )
          sib_output_count = sum(1 for a in sibling.get_arguments() if isOutputParam(a.type))
          if sib_kept == target_kept and sib_output_count == target_output_count:
            best_exact = sibling
            break
          if (
            best_output_match is None
            and len(sib_kept) == target_kept_arity
            and sib_output_count == target_output_count
            and target_output_count > 0
          ):
            best_output_match = sibling
          if best_arity is None and len(sib_kept) == target_kept_arity and len(list(sibling.get_arguments())) == target_raw_arity:
            best_arity = sibling

        if (
          best_index_match is None
          and derived_overload_index is not None
          and derived_overload_index < len(base_same_name)
        ):
          best_index_match = base_same_name[derived_overload_index]

      return best_exact or best_output_match or best_arity or best_index_match

    return _walk(theClass)

  def _effectiveOutputNames(self, theClass, method, allArgs):
    """Compute the effective output-parameter field names for a method.

    Returns a list of (arg_index, effective_name) tuples for every output
    parameter. When the method overrides a base's same-name method with the
    same output-param count, the names are taken verbatim from the base so
    the derived signature stays structurally assignable to the base both at
    the TS layer (`_buildOutputParamReturnType`) and at the C++ value_object
    field layer (`_ensureResultStruct`). Without this, the runtime payload's
    field names (e.g. `ACode`) would diverge from the type signature
    (e.g. `Code`), producing TS-valid code that returns `undefined` at
    runtime.
    """
    output_args = [(i, a) for i, a in enumerate(allArgs) if isOutputParam(a.type)]
    if not output_args:
      return []
    base_override = self._find_base_override_target(theClass, method) if theClass is not None else None
    if base_override is None:
      return [(i, self._effectiveArgName(a, i)) for i, a in output_args]
    base_args = list(base_override.get_arguments())
    base_output = [(i, a) for i, a in enumerate(base_args) if isOutputParam(a.type)]
    if len(base_output) != len(output_args):
      return [(i, self._effectiveArgName(a, i)) for i, a in output_args]
    pairs = []
    for (di, _derived_a), (bi, base_a) in zip(output_args, base_output):
      pairs.append((di, self._effectiveArgName(base_a, bi)))
    return pairs

  _MEMBER_TYPEDEFS = {"value_type", "const_reference", "reference", "Array1Type", "Array2Type", "SequenceType", "Point", "Target"}
  _DEPRECATED_TYPEDEFS = {
    "Standard_Real", "Standard_Integer", "Standard_Boolean",
    "Standard_ShortReal", "Standard_Character", "Standard_Byte",
    "Standard_Size", "Standard_CString", "Standard_ExtCharacter",
    "Standard_Utf8Char", "Standard_Utf8UChar",
  }
  _TYPE_PARAM_RE = None
  _reverse_typedef_cache = None

  _UNBINDABLE_PATTERNS = [
    "std::istream", "std::ostream", "std::ifstream", "std::ofstream",
    "std::istringstream", "std::ostringstream", "std::stringstream",
    "std::streambuf", "std::basic_istream", "std::basic_ostream",
    "std::string_view", "std::basic_string_view",
    "void *", "void*",
    "NCollection_Vec2", "NCollection_Vec3", "NCollection_Vec4",
  ]

  _UNBINDABLE_SUFFIX_PATTERNS = [
    "::Iterator", "::iterator",
  ]

  def _checkUnbindableArgs(self, methodName, className, args):
    """Raise SkipException if any argument type is known to be unbindable."""
    for arg in args:
      spelling = arg.type.spelling
      canonical = arg.type.get_canonical().spelling
      for pat in self._UNBINDABLE_PATTERNS:
        if pat in spelling or pat in canonical:
          raise SkipException(
            f"Skipping {className}::{methodName}: arg \"{arg.spelling}\" has unbindable type \"{spelling}\""
          )
      for suffix in self._UNBINDABLE_SUFFIX_PATTERNS:
        if spelling.endswith(suffix) or canonical.endswith(suffix):
          raise SkipException(
            f"Skipping {className}::{methodName}: arg \"{arg.spelling}\" has unbindable iterator type \"{spelling}\""
          )
      if "type-parameter-" in canonical and "type-parameter-" in spelling:
        raise SkipException(
          f"Skipping {className}::{methodName}: arg \"{arg.spelling}\" has unresolved template param \"{spelling}\""
        )

  def _constructorsHaveUniqueArities(self, publicConstructors):
    """Check if all public constructors have unique argument counts (enabling native Embind overloading).
    Also rejects cstring args which need wrapper subclasses for string conversion."""
    arities = [len(list(c.get_arguments())) for c in publicConstructors]
    if len(arities) != len(set(arities)):
      return False
    hasCStringArgs = any(
      any(isCString(arg.type) for arg in c.get_arguments())
      for c in publicConstructors
    )
    return not hasCStringArgs

  # ---------------------------------------------------------------------------
  # Safe overload filtering
  # ---------------------------------------------------------------------------

  def _is_move_constructor(self, ctor):
    """Detect T(T&&) move constructors — no JS equivalent."""
    args = list(ctor.get_arguments())
    if len(args) != 1:
      return False
    return args[0].type.kind == clang.cindex.TypeKind.RVALUEREFERENCE

  def _is_deleted_method(self, ctor):
    """Detect explicitly-deleted constructors (`= delete`).

    OCCT V8 marks copy (and sometimes move) ctors `= delete` on many classes.
    Bindgen still lists them as public CONSTRUCTOR cursors; emitting
    ``.constructor<const T &>()`` instantiates embind ``operator_new<T, const T&>``
    against the deleted symbol and the TU fails. ``is_deleted_method()`` is the
    libclang hook for deleted special members.
    """
    return ctor.is_deleted_method()

  def _is_float_only_variant(self, ctor):
    """Check if constructor uses float (not double) args."""
    for arg in ctor.get_arguments():
      if arg.type.get_canonical().kind == clang.cindex.TypeKind.FLOAT:
        return True
    return False

  def _dedupe_float_double(self, overloads):
    """Remove overloads that are float variants when a double variant exists at the same arity."""
    if len(overloads) <= 1:
      return overloads
    by_arity = defaultdict(list)
    for ov in overloads:
      by_arity[len(list(ov.get_arguments()))].append(ov)
    result = []
    for group in by_arity.values():
      if len(group) <= 1:
        result.extend(group)
        continue
      has_float = any(self._is_float_only_variant(ov) for ov in group)
      has_non_float = any(not self._is_float_only_variant(ov) for ov in group)
      if has_float and has_non_float:
        result.extend(ov for ov in group if not self._is_float_only_variant(ov))
      else:
        result.extend(group)
    return result

  def _is_wider_string_ctor(self, ctor):
    """Check if constructor uses wide string types (char16_t, char32_t, wchar_t)."""
    for arg in ctor.get_arguments():
      canonical = arg.type.get_canonical().spelling
      if any(ws in canonical for ws in ('char16_t', 'char32_t', 'wchar_t')):
        return True
    return False

  def _dedupe_string_encodings(self, overloads):
    """Remove overloads that use wide string encodings (keep UTF-8/char*)."""
    if len(overloads) <= 1:
      return overloads
    has_narrow = any(not self._is_wider_string_ctor(ov) for ov in overloads)
    if not has_narrow:
      return overloads
    return [ov for ov in overloads if not self._is_wider_string_ctor(ov)]

  def _filter_overloads(self, overloads):
    """Apply all safe filters: deleted ctors, move ctors, float/double dedup, string encoding dedup."""
    filtered = [c for c in overloads if not self._is_deleted_method(c)]
    filtered = [c for c in filtered if not self._is_move_constructor(c)]
    filtered = self._dedupe_float_double(filtered)
    filtered = self._dedupe_string_encodings(filtered)
    return filtered

  def _isWireSafeFieldType(self, clang_type):
    """Embind value_object/.property cannot wire raw pointers, deleted-copy
    types, or std::atomic. Skip those fields instead of failing the TU."""
    if isRawPointerParam(clang_type):
      return False
    canonical = clang_type.get_canonical().spelling
    if 'std::atomic' in canonical:
      return False
    decl = clang_type.get_canonical().get_declaration()
    if decl:
      for child in decl.get_children():
        if (child.kind == clang.cindex.CursorKind.CONSTRUCTOR
            and child.is_copy_constructor()
            and child.is_deleted_method()):
          return False
    return True

  def _returnTypeRequiresValueWrapper(self, method):
    """Embind copy-marshals C++ returns through wire.h:391. Non-copyable
    types (deleted copy ctor) need optional_override: ref returns use
    ``val(&ref)``; by-value returns use a ``thread_local`` staging slot."""
    rt = method.result_type
    if rt.spelling == "void":
      return False
    if rt.kind in (
      clang.cindex.TypeKind.LVALUEREFERENCE,
      clang.cindex.TypeKind.RVALUEREFERENCE,
    ):
      target = rt.get_pointee()
    else:
      target = rt
    decl = target.get_canonical().get_declaration()
    if not decl:
      return False
    for child in decl.get_children():
      if (child.kind == clang.cindex.CursorKind.CONSTRUCTOR
          and child.is_copy_constructor()
          and child.is_deleted_method()):
        return True
    return False

  # ---------------------------------------------------------------------------
  # Default parameter detection
  # ---------------------------------------------------------------------------

  def _countTrailingDefaults(self, cursor):
    """Count trailing parameters with default values from clang AST."""
    args = list(cursor.get_arguments())
    count = 0
    for arg in reversed(args):
      tokens = list(arg.get_tokens())
      if any(t.spelling == "=" for t in tokens):
        count += 1
      else:
        break
    return count

  # ---------------------------------------------------------------------------
  # JS type classification for dispatch
  # ---------------------------------------------------------------------------

  _JS_INTEGER_KINDS = frozenset({
    clang.cindex.TypeKind.INT, clang.cindex.TypeKind.UINT,
    clang.cindex.TypeKind.LONG, clang.cindex.TypeKind.ULONG,
    clang.cindex.TypeKind.LONGLONG, clang.cindex.TypeKind.ULONGLONG,
    clang.cindex.TypeKind.SHORT, clang.cindex.TypeKind.USHORT,
  })

  _JS_FLOAT_KINDS = frozenset({
    clang.cindex.TypeKind.FLOAT, clang.cindex.TypeKind.DOUBLE,
    clang.cindex.TypeKind.LONGDOUBLE,
  })

  _JS_NUMERIC_KINDS = _JS_INTEGER_KINDS | _JS_FLOAT_KINDS

  _JS_CHAR_KINDS = frozenset({
    clang.cindex.TypeKind.CHAR_U, clang.cindex.TypeKind.UCHAR,
    clang.cindex.TypeKind.CHAR_S, clang.cindex.TypeKind.SCHAR,
  })

  _JS_WIDECHAR_KINDS = frozenset({
    clang.cindex.TypeKind.CHAR16, clang.cindex.TypeKind.CHAR32,
  })

  _JS_STRING_KINDS = _JS_CHAR_KINDS | _JS_WIDECHAR_KINDS

  def _strip_type_qualifiers(self, clang_type):
    """Strip const, reference, and pointer qualifiers for dispatch classification."""
    t = clang_type
    if t.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
      t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.RVALUEREFERENCE:
      t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.POINTER:
      t = t.get_pointee()
    return t

  def _resolve_template_typedef(self, type_spelling):
    """Resolve a template instantiation like NCollection_Array1<gp_Pnt> to its typedef name like TColgp_Array1OfPnt."""
    if Bindings._reverse_typedef_cache is None:
      Bindings._reverse_typedef_cache = {}
      for underlying_spelling, typedef_cursor in self.tuInfo.typedefUnderlyingDict.items():
        clean = _normalize_handle_ns(underlying_spelling.replace("const ", "").replace("&", "").replace("*", "").strip())
        Bindings._reverse_typedef_cache[clean] = typedef_cursor.spelling
    clean_spelling = _normalize_handle_ns(type_spelling.replace("const ", "").replace("&", "").replace("*", "").strip())
    return Bindings._reverse_typedef_cache.get(clean_spelling)

  def _classify_js_type(self, clang_type, templateDecl=None, templateArgs=None):
    """Map a C++ type to its JS runtime type category for dispatch discrimination."""
    t = self._strip_type_qualifiers(clang_type)

    if t.get_num_template_arguments() == 1:
      decl = t.get_declaration()
      if decl and decl.spelling == "handle":
        parent = decl.semantic_parent
        if parent and parent.spelling in ("opencascade", "occ"):
          inner = t.get_template_argument_type(0)
          inner_decl = inner.get_declaration()
          name = inner_decl.spelling if (inner_decl and inner_decl.spelling) else inner.spelling
          return JsType('object', name)

    canonical = t.get_canonical()
    kind = canonical.kind

    if kind == clang.cindex.TypeKind.ENUM:
      decl = canonical.get_declaration()
      if decl and decl.spelling:
        return JsType('string_enum', decl.spelling)
      return JsType('string', 'string')

    if kind in self._JS_INTEGER_KINDS:
      return JsType('number_int', 'number')
    if kind in self._JS_FLOAT_KINDS:
      return JsType('number_float', 'number')
    if kind == clang.cindex.TypeKind.BOOL:
      return JsType('boolean', 'boolean')
    if kind in self._JS_STRING_KINDS:
      return JsType('string', 'string')
    if isCString(clang_type):
      return JsType('string', 'string')

    decl = t.get_declaration()
    if decl and decl.spelling:
      if '<' in t.spelling:
        typedef_name = self._resolve_template_typedef(t.spelling)
        if typedef_name:
          return JsType('object', typedef_name)
      return JsType('object', decl.spelling)

    decl = canonical.get_declaration()
    if decl and decl.spelling:
      if '<' in canonical.spelling:
        typedef_name = self._resolve_template_typedef(canonical.spelling)
        if typedef_name:
          return JsType('object', typedef_name)
      return JsType('object', decl.spelling)

    if templateArgs and "type-parameter-" in canonical.spelling:
      import re
      if Bindings._TYPE_PARAM_RE is None:
        Bindings._TYPE_PARAM_RE = re.compile(r'type-parameter-(\d+)-(\d+)')
      m = Bindings._TYPE_PARAM_RE.search(canonical.spelling)
      if m:
        depth, index = int(m.group(1)), int(m.group(2))
        if depth == 0:
          argValues = list(templateArgs.values())
          if index < len(argValues):
            resolved_type = argValues[index]
            resolved_decl = resolved_type.get_declaration()
            resolved_name = resolved_decl.spelling if (resolved_decl and resolved_decl.spelling) else resolved_type.spelling
            return JsType('object', resolved_name)

    return JsType('number_float', 'number')

  def _classify_js_dispatch_type(self, clang_type, templateDecl=None, templateArgs=None):
    """Coarse JS type classification matching what the bugra9 embind runtime can distinguish.

    Unlike _classify_js_type which has fine-grained categories (number_int, number_float,
    string_enum), this maps to what typeof/instanceof can actually distinguish at runtime:
    - object(ClassName) — instanceof check
    - number — typeof === 'number' (int and float are indistinguishable)
    - boolean — typeof === 'boolean'
    - string — typeof === 'string' (string_enum and string are indistinguishable)
    """
    fine = self._classify_js_type(clang_type, templateDecl, templateArgs)
    if fine.category == 'object':
      return fine
    if fine.category == 'boolean':
      return JsType('boolean', 'boolean')
    if fine.category in ('number_int', 'number_float'):
      return JsType('number', 'number')
    if fine.category in ('string', 'string_enum'):
      return JsType('string', 'string')
    return JsType('number', 'number')

  def _build_js_dispatch_tree(self, group, available_positions=None, templateDecl=None, templateArgs=None):
    """Build dispatch tree using coarse JS-dispatch types (what bugra9 runtime can distinguish)."""
    if len(group) == 1:
      return DispatchLeaf(group[0])

    if available_positions is None:
      available_positions = list(range(len(list(group[0].get_arguments()))))

    if not available_positions:
      return DispatchAmbiguous(group)

    best_pos = None
    best_count = 0
    for p in available_positions:
      types = set()
      for ov in group:
        args = list(ov.get_arguments())
        if p < len(args):
          types.add(self._classify_js_dispatch_type(args[p].type, templateDecl, templateArgs))
      if len(types) > best_count:
        best_count = len(types)
        best_pos = p

    if best_pos is None or best_count <= 1:
      return DispatchAmbiguous(group)

    type_groups = defaultdict(list)
    for ov in group:
      args = list(ov.get_arguments())
      js_type = self._classify_js_dispatch_type(args[best_pos].type, templateDecl, templateArgs)
      type_groups[js_type].append(ov)

    remaining = [p for p in available_positions if p != best_pos]
    branches = {}
    for js_type, sub_group in type_groups.items():
      branches[js_type] = self._build_js_dispatch_tree(sub_group, remaining, templateDecl, templateArgs)

    return DispatchBranch(best_pos, branches)

  def _dispatch_primitive_sort_key(self, js_type_subtree_pair):
    """Order primitive JS branches: string_enum (membership) before generic string/number."""
    jt = js_type_subtree_pair[0]
    cat = jt.category
    if cat == 'string_enum':
      return (0, jt.name)
    if cat == 'boolean':
      return (1, '')
    if cat == 'number_int':
      return (2, '')
    if cat == 'number_float':
      return (3, '')
    if cat in ('string', 'string_char'):
      return (4, '')
    return (5, cat)

  # ---------------------------------------------------------------------------
  # Dispatch tree construction
  # ---------------------------------------------------------------------------

  def _build_dispatch_tree(self, group, available_positions=None, templateDecl=None, templateArgs=None):
    """Recursively partition same-arity overloads by JS type checks.
    Returns DispatchLeaf, DispatchBranch, or DispatchAmbiguous."""
    if len(group) == 1:
      return DispatchLeaf(group[0])

    if available_positions is None:
      available_positions = list(range(len(list(group[0].get_arguments()))))

    if not available_positions:
      return DispatchAmbiguous(group)

    best_pos = None
    best_count = 0
    for p in available_positions:
      types = set()
      for ov in group:
        args = list(ov.get_arguments())
        if p < len(args):
          types.add(self._classify_js_type(args[p].type, templateDecl, templateArgs))
      if len(types) > best_count:
        best_count = len(types)
        best_pos = p

    if best_pos is None or best_count <= 1:
      return DispatchAmbiguous(group)

    type_groups = defaultdict(list)
    for ov in group:
      args = list(ov.get_arguments())
      js_type = self._classify_js_type(args[best_pos].type, templateDecl, templateArgs)
      type_groups[js_type].append(ov)

    remaining = [p for p in available_positions if p != best_pos]
    branches = {}
    for js_type, sub_group in type_groups.items():
      branches[js_type] = self._build_dispatch_tree(sub_group, remaining, templateDecl, templateArgs)

    return DispatchBranch(best_pos, branches)

  def _collect_ambiguous_overloads(self, tree):
    """Collect all overloads from DispatchAmbiguous nodes in the tree."""
    if isinstance(tree, DispatchLeaf):
      return []
    if isinstance(tree, DispatchAmbiguous):
      return list(tree.overloads)
    if isinstance(tree, DispatchBranch):
      result = []
      for subtree in tree.branches.values():
        result.extend(self._collect_ambiguous_overloads(subtree))
      return result
    return []

  def _collect_ambiguous_primaries(self, tree, primaries):
    """Collect the id() of the first overload in each DispatchAmbiguous group (the dispatch fallback)."""
    if isinstance(tree, DispatchLeaf):
      return
    if isinstance(tree, DispatchAmbiguous):
      primaries.add(id(tree.overloads[0]))
      return
    if isinstance(tree, DispatchBranch):
      for subtree in tree.branches.values():
        self._collect_ambiguous_primaries(subtree, primaries)

  def _tree_has_only_leaves(self, tree):
    """Check if tree has only DispatchLeaf nodes (no ambiguous, no nested branches)."""
    if isinstance(tree, DispatchLeaf):
      return True
    if isinstance(tree, DispatchAmbiguous):
      return False
    if isinstance(tree, DispatchBranch):
      return all(isinstance(v, DispatchLeaf) for v in tree.branches.values())
    return False

  def _qualify_nested_type(self, type_spelling, clang_type):
    """Qualify nested class/typedef names with their parent class scope.

    In EMSCRIPTEN_BINDINGS blocks (global scope), nested type names like
    'NullString' or 'OperationsFlags' must be fully qualified as
    'Message_ProgressScope::NullString' or 'ShapeProcess::OperationsFlags'.
    Also recurses into template arguments (e.g. std::pair<Operation, bool>).
    """
    result = type_spelling
    base = clang_type
    if base.kind in (clang.cindex.TypeKind.POINTER, clang.cindex.TypeKind.LVALUEREFERENCE, clang.cindex.TypeKind.RVALUEREFERENCE):
      base = base.get_pointee()
    decl = base.get_declaration()
    if decl and decl.spelling:
      unqualified = decl.spelling
      parent = decl.semantic_parent
      if (
        parent
        and parent.spelling
        and parent.kind
        in (
          clang.cindex.CursorKind.CLASS_DECL,
          clang.cindex.CursorKind.STRUCT_DECL,
          clang.cindex.CursorKind.CLASS_TEMPLATE,
          clang.cindex.CursorKind.NAMESPACE,
        )
      ):
        qualified = f"{parent.spelling}::{unqualified}"
        if qualified not in result:
          # Do not rewrite `handle` in `occ::handle<…>` / `opencascade::handle<…>` into
          # `opencascade::handle` (libclang parents the template under namespace opencascade).
          pattern = re.compile(r'(?<!::)\b' + re.escape(unqualified) + r'\b')
          if pattern.search(result):
            result = pattern.sub(qualified, result, count=1)
    num_targs = base.get_num_template_arguments()
    for idx in range(num_targs):
      targ = base.get_template_argument_type(idx)
      if targ and targ.kind != clang.cindex.TypeKind.INVALID:
        result = self._qualify_nested_type(result, targ)
    return result

  def _substitute_canonical_template_names(self, canonical_spelling: str, templateArgs) -> str:
    """Substitute template parameter names and type-parameter-0-N in a canonical type spelling.

    libclang 18+ often spells dependent types with the source parameter name (e.g. TheItemType)
    instead of ``type-parameter-0-0``. ``replaceTemplateArgs`` handles those names; ``_TYPE_PARAM_RE``
    handles the internal spellings.
    """
    if not templateArgs:
      return canonical_spelling
    s = self.replaceTemplateArgs(canonical_spelling, templateArgs)
    if "type-parameter-" not in s:
      return s
    if Bindings._TYPE_PARAM_RE is None:
      Bindings._TYPE_PARAM_RE = re.compile(r'type-parameter-(\d+)-(\d+)')

    def replacer(m):
      depth, index = int(m.group(1)), int(m.group(2))
      if depth == 0:
        arg_values = list(templateArgs.values())
        if index < len(arg_values):
          return arg_values[index].spelling
      return m.group(0)

    return Bindings._TYPE_PARAM_RE.sub(replacer, s)

  def resolveWithCanonicalFallback(self, spelling, clangType, templateDecl = None, templateArgs = None):
    """Resolve a type spelling, falling back to canonical type for member typedefs.
    
    Template specializations like NCollection_Array1<gp_Pnt> use member typedefs
    (value_type, const_reference) that resolve to concrete types (gp_Pnt, const gp_Pnt&)
    in the canonical form. When clang returns type-parameter-0-N for the canonical type
    (template definitions), we map it through templateArgs to the concrete type.
    With libclang 18+, canonical spellings may use the source template parameter name
    (e.g. TheItemType) instead of type-parameter-0-0; templateArgs substitutes those too.
    Nested types are always qualified with their parent class scope.
    """
    resolved = self.getTypedefedTemplateTypeAsString(spelling, templateDecl, templateArgs)
    if any(td in resolved for td in self._DEPRECATED_TYPEDEFS):
      canonical = clangType.get_canonical().spelling
      if "type-parameter-" not in canonical:
        return self._qualify_nested_type(
          self._substitute_canonical_template_names(canonical, templateArgs),
          clangType,
        )
    if not any(td in resolved for td in self._MEMBER_TYPEDEFS):
      return self._qualify_nested_type(resolved, clangType)

    canonical = clangType.get_canonical().spelling
    if "type-parameter-" not in canonical:
      return self._qualify_nested_type(
        self._substitute_canonical_template_names(canonical, templateArgs),
        clangType,
      )

    if not templateArgs:
      return self._qualify_nested_type(resolved, clangType)

    substituted = self._substitute_canonical_template_names(canonical, templateArgs)
    return self._qualify_nested_type(substituted, clangType)

  def getTypedefedTemplateTypeAsString(self, theTypeSpelling, templateDecl = None, templateArgs = None):
    if templateDecl is None:
      tud = self.tuInfo.typedefUnderlyingDict
      if theTypeSpelling in tud:
        typedefType = tud[theTypeSpelling].spelling
      else:
        typedefType = None
    else:
      templateType = self.replaceTemplateArgs(theTypeSpelling, templateArgs)
      rawTemplateType = templateType.replace("&", "").replace("const", "").strip()
      ttud = self.tuInfo.templateTypedefUnderlyingDict
      oc_rawTemplateType = "opencascade::" + rawTemplateType
      occ_rawTemplateType = "occ::" + rawTemplateType
      normalized = rawTemplateType.replace("occ::", "opencascade::")
      if rawTemplateType in ttud:
        rawTypedefType = ttud[rawTemplateType].spelling
      elif oc_rawTemplateType in ttud:
        rawTypedefType = ttud[oc_rawTemplateType].spelling
      elif occ_rawTemplateType in ttud:
        rawTypedefType = ttud[occ_rawTemplateType].spelling
      elif normalized in ttud:
        rawTypedefType = ttud[normalized].spelling
      else:
        rawTypedefType = rawTemplateType
      typedefType = templateType.replace(rawTemplateType, rawTypedefType)
    return theTypeSpelling if typedefType is None else typedefType

  def replaceTemplateArgs(self, string, templateArgs = None):
    newString = string
    if templateArgs is None:
      return newString
    for key in templateArgs:
      p = re.compile("(\\W+|^)" + key + "(\\W|$)")
      newString = p.sub("\\1" + templateArgs[key].spelling + "\\2", newString)
    return newString

  def processClass(self, theClass, templateDecl = None, templateArgs = None):
    output = ""
    isAbstract = isAbstractClass(theClass, self.tuInfo.classDict)
    if not isAbstract:
      try:
        output += self.processSimpleConstructor(theClass, templateDecl, templateArgs)
      except SkipException as e:
        print(str(e))

    # Group methods by name to detect same-arity overloads
    method_groups = defaultdict(list)
    all_children = list(theClass.get_children())
    for method in all_children:
      if not filterMethodOrProperty(theClass, method):
        continue
      if method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.CXX_METHOD and not method.spelling.startswith("operator"):
        method_groups[method.spelling].append(method)
      elif method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.FIELD_DECL:
        try:
          output += self.processMethodOrProperty(theClass, method, templateDecl, templateArgs)
        except SkipException as e:
          print(str(e))

    # Process each method group
    processed_groups = set()
    for method_name, methods in method_groups.items():
      if method_name in processed_groups:
        continue
      processed_groups.add(method_name)
      try:
        output += self.processMethodGroup(theClass, methods, templateDecl, templateArgs)
      except SkipException as e:
        print(str(e))

    output += self.processFinalizeClass()
    if not isAbstract:
      try:
        output += self.processOverloadedConstructors(theClass, None, templateDecl, templateArgs)
      except SkipException as e:
        print(str(e))
    return output

  def processMethodGroup(self, theClass, methods, templateDecl=None, templateArgs=None):
    """Process a group of methods with the same name. Override in subclasses."""
    output = ""
    arity_seen = {}
    for method in methods:
      nargs = len(list(method.get_arguments()))
      key = nargs
      arity_idx = arity_seen.get(key, 0)
      arity_seen[key] = arity_idx + 1
      try:
        output += self.processMethodOrProperty(theClass, method, templateDecl, templateArgs, overload_index=arity_idx)
      except SkipException as e:
        print(str(e))
    return output

class EmbindBindings(Bindings):
  def __init__(
    self,
    tuInfo
  ):
    super().__init__(tuInfo)
    self._result_struct_defs = []
    self._result_struct_registrations = []
    self._emitted_structs = {}
    self._ret_wrapper_serial = 0

  def processClass(self, theClass, templateDecl = None, templateArgs = None):
    output = ""
    className = getClassTypeName(theClass, templateDecl)
    if className == "":
      className = theClass.type.spelling
    classCpp = getClassQualifiedName(theClass, templateDecl)
    if not classCpp:
      classCpp = className

    baseSpec = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, theClass.get_children()))

    if len(baseSpec) > 0:
      baseType = baseSpec[0].type.spelling
      if any(x in baseType for x in [":", "<"]):
        baseClassBinding = ""
      else:
        baseClassBinding = ", base<" + baseType + ">"
    else:
      baseClassBinding = ""

    self._result_struct_defs = []
    self._result_struct_registrations = []
    self._emitted_structs = {}

    method_output = super().processClass(theClass, templateDecl, templateArgs)

    for struct_def in self._result_struct_defs:
      output += struct_def

    output += "EMSCRIPTEN_BINDINGS(" + (theClass.spelling if templateDecl is None else templateDecl.spelling) + ") {\n"

    for reg in self._result_struct_registrations:
      output += reg

    output += "  class_<" + classCpp + baseClassBinding + ">(\"" + className + "\")\n"

    if isTransientDerived(theClass, self.tuInfo.classDict):
      output += "    .smart_ptr<opencascade::handle<" + classCpp + ">>(\"Handle_" + className + "\")\n"

    if className == "Standard_Transient":
      output += "    .function(\"isNull\", &handle_isNull<Standard_Transient>)\n"
      output += "    .function(\"nullify\", &handle_nullify<Standard_Transient>)\n"

    output += method_output

    for child in theClass.get_children():
      if child.kind == clang.cindex.CursorKind.ENUM_DECL and child.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and child.spelling != "" and child.spelling.isidentifier():
        enumName = className + "_" + child.spelling
        isScoped = child.is_scoped_enum()
        valuePrefix = classCpp + "::" + child.spelling + "::" if isScoped else classCpp + "::"
        output += "  enum_<" + classCpp + "::" + child.spelling + ">(\"" + enumName + "\", emscripten::enum_value_type::string)\n"
        for enumChild in list(child.get_children()):
          if enumChild.kind == clang.cindex.CursorKind.ENUM_CONSTANT_DECL:
            output += "    .value(\"" + enumChild.spelling + "\", " + valuePrefix + enumChild.spelling + ")\n"
        output += "  ;\n"

      if child.kind == clang.cindex.CursorKind.STRUCT_DECL and child.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and child.spelling != "" and child.spelling.isidentifier():
        fields = [f for f in child.get_children() if f.kind == clang.cindex.CursorKind.FIELD_DECL]
        non_field_members = [f for f in child.get_children() if f.kind not in (
          clang.cindex.CursorKind.FIELD_DECL,
          clang.cindex.CursorKind.CXX_ACCESS_SPEC_DECL,
          clang.cindex.CursorKind.CONSTRUCTOR,
          clang.cindex.CursorKind.DESTRUCTOR,
        )]
        if fields and not non_field_members:
          ctors_nested = [
            c for c in child.get_children()
            if c.kind == clang.cindex.CursorKind.CONSTRUCTOR
            and c.access_specifier == clang.cindex.AccessSpecifier.PUBLIC
          ]
          has_default_ctor = (
            not ctors_nested
            or any(
              len(list(c.get_arguments())) == 0 and not c.is_deleted_method()
              for c in ctors_nested
            )
          )
          if not has_default_ctor:
            continue
          # Nested public POD struct (fields only) → standalone embind `value_object`.
          # This is the **S0** return path for struct *values* returned from methods that
          # have no OCJS-classified output params (see `_emitOutputParamBinding` for S1/S2).
          # Taxonomy: `docs/research/ocjs-rbv-test-corpus-contract-drift.md`.
          structName = className + "_" + child.spelling
          cppType = classCpp + "::" + child.spelling
          output += f'  value_object<{cppType}>("{structName}")\n'
          for field in fields:
            if not self._isWireSafeFieldType(field.type):
              continue
            output += f'    .field("{field.spelling}", &{cppType}::{field.spelling})\n'
          output += "  ;\n"

    output += "}\n\n"

    # Epilog
    nonPublicDestructor = any(x.kind == clang.cindex.CursorKind.DESTRUCTOR and not x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC for x in theClass.get_children())
    placementDelete = next((x for x in theClass.get_children() if x.spelling == "operator delete" and len(list(x.get_arguments())) == 2), None) is not None
    if nonPublicDestructor or placementDelete:
      output += "namespace emscripten { namespace internal { template<> void raw_destructor<" + classCpp + ">(" + classCpp + "* ptr) { /* do nothing */ } } }\n"
    return output

  def processFinalizeClass(self):
    return "  ;\n"

  def _rewrite_typedef_nested_types(self, type_str, class_cpp, underlying_spelling, template_decl):
    """Template typedefs (e.g. BndBox2dTreeFiller -> NCollection_UBTreeFiller<int,Bnd_Box2d>)
    need nested names like ``Underlying::UBTree`` rewritten to ``class_cpp::UBTree`` so
    constructor templates instantiate the typedef's nested members, not an unspecialized template."""
    if template_decl is None or not underlying_spelling or not class_cpp:
      return type_str
    prefix = underlying_spelling + "::"
    if prefix not in type_str:
      return type_str
    return type_str.replace(prefix, class_cpp + "::")

  def _emitConstructor(self, class_cpp, args, template_decl, template_args, use_handle_override, underlying_spelling=None):
    """Emit a single constructor binding, using optional_override for Handle wrapping or CString conversion."""
    def rw(s):
      return self._rewrite_typedef_nested_types(s, class_cpp, underlying_spelling, template_decl)

    has_c_string = any(isCString(a.type) for a in args)
    needs_raw = any(isRawPointerParam(a.type) and not isCString(a.type) for a in args)

    if not use_handle_override and not has_c_string and not needs_raw:
      arg_types_bindings = ", ".join([
        rw(self.getSingleArgumentBinding(False, True, template_decl, template_args)(arg)[0])
        for arg in args
      ])
      return "    .constructor<" + arg_types_bindings + ">()\n"

    named_args = []
    for i, arg in enumerate(args):
      name = arg.spelling if arg.spelling else f"a{i}"
      type_str = rw(self.getSingleArgumentBinding(False, True, template_decl, template_args)(arg)[0])
      if isCString(arg.type):
        named_args.append(("std::string " + name, name + ".c_str()"))
      else:
        named_args.append((type_str + " " + name, name))
    typed_args = ", ".join([a[0] for a in named_args])
    arg_names = ", ".join([a[1] for a in named_args])

    if use_handle_override:
      return (
        "    .constructor(optional_override([](" + typed_args + ") {\n"
        "      return opencascade::handle<" + class_cpp + ">(new " + class_cpp + "(" + arg_names + "));\n"
        "    }))\n"
      )

    return (
      "    .constructor(optional_override([](" + typed_args + ") {\n"
      "      return new " + class_cpp + "(" + arg_names + ");\n"
      "    }), allow_raw_pointers())\n"
    )

  def _codegen_dispatch_tree(self, tree, className, useHandleOverride, templateDecl, templateArgs, ind=6, arity=None):
    """Recursively generate C++ if/else dispatch from a dispatch tree."""
    sp = " " * ind
    if isinstance(tree, DispatchLeaf):
      args = list(tree.overload.get_arguments())
      if arity is not None:
        args = args[:arity]
      conversions = []
      for i, arg in enumerate(args):
        if isRawPointerParam(arg.type) and not isCString(arg.type):
          conversions.append('nullptr')
          continue
        cpp_type = self.getOriginalArgumentType(arg, templateDecl, templateArgs)
        js_type = self._classify_js_type(arg.type, templateDecl, templateArgs)
        if js_type.category == 'object':
          conversions.append(f'arg{i}.as<{cpp_type}>(emscripten::allow_raw_pointers())')
        elif js_type.category == 'string' and isCString(arg.type):
          conversions.append(f'arg{i}.as<std::string>().c_str()')
        else:
          canon = arg.type.get_canonical().spelling
          if "type-parameter-" in canon:
            canon = self.resolveWithCanonicalFallback(arg.type.spelling, arg.type, templateDecl, templateArgs)
          conversions.append(f'arg{i}.as<{canon}>()')
      args_str = ", ".join(conversions)
      if useHandleOverride:
        return f'{sp}return opencascade::handle<{className}>(new {className}({args_str}));\n'
      return f'{sp}return new {className}({args_str});\n'

    if isinstance(tree, DispatchBranch):
      code = ''
      first = True
      primitives = []
      objects = []
      for js_type, subtree in tree.branches.items():
        if js_type.category == 'object':
          objects.append((js_type, subtree))
        else:
          primitives.append((js_type, subtree))
      has_int = any(jt.category == 'number_int' for jt, _ in primitives)
      has_float = any(jt.category == 'number_float' for jt, _ in primitives)
      int_float_split = has_int and has_float
      primitives.sort(key=self._dispatch_primitive_sort_key)
      ordered = primitives + objects
      for idx, (js_type, subtree) in enumerate(ordered):
        is_last = (idx == len(ordered) - 1)
        if first:
          keyword = "if"
        elif is_last:
          keyword = "else"
        else:
          keyword = "else if"
        first = False
        if is_last:
          code += f'{sp}{keyword} {{\n'
        elif js_type.category == 'object':
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "object" && !emscripten::val::module_property("{js_type.name}").isUndefined() && arg{tree.arg_position}.instanceof(emscripten::val::module_property("{js_type.name}"))'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'boolean':
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "boolean"'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'string_enum':
          check = (
            f'arg{tree.arg_position}.typeOf().as<std::string>() == "string"'
            f' && !emscripten::val::module_property("{js_type.name}")'
            f'[arg{tree.arg_position}.as<std::string>()].isUndefined()'
          )
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'string':
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "string"'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'number_int' and int_float_split:
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "number" && emscripten::val::global("Number").call<bool>("isInteger", arg{tree.arg_position})'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'number_float' and int_float_split:
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "number"'
          code += f'{sp}{keyword} ({check}) {{\n'
        else:
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "number"'
          code += f'{sp}{keyword} ({check}) {{\n'
        code += self._codegen_dispatch_tree(subtree, className, useHandleOverride, templateDecl, templateArgs, ind + 2, arity=arity)
        code += f'{sp}}}\n'
      return code

    if isinstance(tree, DispatchAmbiguous):
      fallback = DispatchLeaf(tree.overloads[0])
      return self._codegen_dispatch_tree(fallback, className, useHandleOverride, templateDecl, templateArgs, ind, arity=arity)

    return ''

  def _emitValDispatchConstructor(self, className, arity, tree, useHandleOverride, templateDecl, templateArgs):
    """Emit a single optional_override constructor with val-based dispatch for a same-arity group."""
    val_args = ", ".join([f"emscripten::val arg{i}" for i in range(arity)])
    if useHandleOverride:
      ret_type = f"opencascade::handle<{className}>"
    else:
      ret_type = f"{className}*"
    output = f"    .constructor(optional_override([]({val_args}) -> {ret_type} {{\n"
    output += self._codegen_dispatch_tree(tree, className, useHandleOverride, templateDecl, templateArgs, ind=6, arity=arity)
    if useHandleOverride:
      output += f"      return opencascade::handle<{className}>();\n"
    else:
      output += f"      return nullptr;\n"
    output += "    }))\n"
    return output

  def processSimpleConstructor(self, theClass, templateDecl = None, templateArgs = None):
    output = ""
    children = list(theClass.get_children())
    constructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR, children))
    className = getClassTypeName(theClass, templateDecl)
    if className == "":
      className = theClass.type.spelling
    classCpp = getClassQualifiedName(theClass, templateDecl)
    if not classCpp:
      classCpp = className
    useHandleOverride = isTransientDerived(theClass, self.tuInfo.classDict)
    underlying_spelling = theClass.spelling if templateDecl is not None else None

    if len(constructors) == 0:
      if useHandleOverride:
        output += "    .constructor(optional_override([]() {\n"
        output += "      return opencascade::handle<" + classCpp + ">(new " + classCpp + "());\n"
        output += "    }))\n"
      else:
        output += "    .constructor<>()\n"
      return output
    publicConstructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, children))
    if len(publicConstructors) == 0:
      return output

    # Apply safe filtering
    filtered = self._filter_overloads(publicConstructors)
    filtered = [c for c in filtered if filterMethodOrProperty(theClass, c)]
    bindable = []
    for c in filtered:
      try:
        self._checkUnbindableArgs("constructor", theClass.spelling, list(c.get_arguments()))
        bindable.append(c)
      except SkipException as e:
        print(str(e))

    if len(bindable) == 0:
      return output

    if len(bindable) == 1:
      args = list(bindable[0].get_arguments())
      output += self._emitConstructor(classCpp, args, templateDecl, templateArgs, useHandleOverride, underlying_spelling)
      # Default parameter expansion for single constructor
      nDefaults = self._countTrailingDefaults(bindable[0])
      nArgs = len(args)
      for d in range(1, nDefaults + 1):
        truncated = args[:nArgs - d]
        output += self._emitConstructor(classCpp, truncated, templateDecl, templateArgs, useHandleOverride, underlying_spelling)
      return output

    # Group by arity and handle each group
    by_arity = defaultdict(list)
    for c in bindable:
      by_arity[len(list(c.get_arguments()))].append(c)

    # Collect default expansions and merge into by_arity groups (collisions handled by dispatch)
    default_expansions = []
    for c in bindable:
      nDefaults = self._countTrailingDefaults(c)
      nArgs = len(list(c.get_arguments()))
      for d in range(1, nDefaults + 1):
        trunc_arity = nArgs - d
        default_expansions.append((c, trunc_arity))

    # Merge default expansions into by_arity using a synthetic "truncated" constructor proxy
    for c, trunc_arity in default_expansions:
      by_arity[trunc_arity].append(c)

    for arity, group in sorted(by_arity.items()):
      # Deduplicate: same constructor may appear via default expansion and explicit arity
      seen_ids = set()
      deduped = []
      for c in group:
        if id(c) not in seen_ids:
          seen_ids.add(id(c))
          deduped.append(c)
      group = deduped

      if len(group) == 1:
        c = group[0]
        actual_args = list(c.get_arguments())
        emit_args = actual_args[:arity]
        output += self._emitConstructor(classCpp, emit_args, templateDecl, templateArgs, useHandleOverride, underlying_spelling)
      else:
        js_tree = self._build_js_dispatch_tree(group, available_positions=list(range(arity)), templateDecl=templateDecl, templateArgs=templateArgs)
        js_ambiguous = self._collect_ambiguous_overloads(js_tree)
        js_distinguishable = [c for c in group if c not in js_ambiguous]

        for c in js_distinguishable:
          actual_args = list(c.get_arguments())[:arity]
          output += self._emitConstructor(classCpp, actual_args, templateDecl, templateArgs, useHandleOverride, underlying_spelling)

        if js_ambiguous:
          val_tree = self._build_dispatch_tree(js_ambiguous, available_positions=list(range(arity)), templateDecl=templateDecl, templateArgs=templateArgs)
          val_ambiguous_remaining = self._collect_ambiguous_overloads(val_tree)

          if val_ambiguous_remaining:
            val_dispatchable = [c for c in js_ambiguous if c not in val_ambiguous_remaining]
          else:
            val_dispatchable = []

          if val_dispatchable or (js_ambiguous and not val_ambiguous_remaining):
            output += self._emitValDispatchConstructor(classCpp, arity, val_tree, useHandleOverride, templateDecl, templateArgs)

          # Truly ambiguous overloads (indistinguishable even by val dispatch) are handled
          # by processOverloadedConstructors which emits _N subclasses

    return output

  def getOriginalArgumentType(self, arg, templateDecl = None, templateArgs = None):
    """Resolve type for select_overload: keeps original const/ref qualifiers exactly."""
    argChildren = list(arg.get_children())
    hasDefaultValue = any(x.spelling == "=" for x in list(arg.get_tokens()))
    isArray = not hasDefaultValue and len(argChildren) > 1 and argChildren[1].kind == clang.cindex.CursorKind.INTEGER_LITERAL
    if isArray:
      const = "const " if list(arg.get_tokens())[0].spelling == "const" else ""
      arrayCount = list(argChildren[1].get_tokens())[0].spelling
      return const + argChildren[0].type.spelling + " (&)[" + arrayCount + "]"
    return self.resolveWithCanonicalFallback(arg.type.spelling, arg.type, templateDecl, templateArgs)

  def getSingleArgumentBinding(self, argNames = True, isConstructor = False, templateDecl = None, templateArgs = None):
    def f(arg):
      argChildren = list(arg.get_children())
      argBinding = ""
      hasDefaultValue = any(x.spelling == "=" for x in list(arg.get_tokens()))
      isArray = not hasDefaultValue and len(argChildren) > 1 and argChildren[1].kind == clang.cindex.CursorKind.INTEGER_LITERAL
      changed = False
      if isArray:
        const = "const " if list(arg.get_tokens())[0].spelling == "const" else ""
        arrayCount = list(argChildren[1].get_tokens())[0].spelling
        argBinding = const + argChildren[0].type.spelling + " (&" + (arg.spelling if argNames else "") + ")[" + arrayCount + "]"
        changed = True
      else:
        typename = self.resolveWithCanonicalFallback(arg.type.spelling, arg.type, templateDecl, templateArgs)
        decl = arg.type.get_declaration()
        if decl and decl.kind == clang.cindex.CursorKind.ENUM_DECL:
          parent = decl.semantic_parent
          if parent and parent.kind in (clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
            typename = arg.type.get_canonical().spelling
        if arg.type.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
          tokenList = list(arg.get_tokens())
          isConstRef = len(tokenList) > 0 and tokenList[0].spelling == "const"
          if not isConstRef:
            if typename[-2] == "*" or "".join(typename.rsplit("&", 1)).strip() in ["Standard_Boolean", "Standard_Real", "Standard_Integer"]: # types that can be copied
              typename = "".join(typename.rsplit("&", 1))
              changed = True
            else:
              if isConstructor:
                typename = typename
                changed = True
              else:
                typename = "const " + typename
                changed = True
        argBinding = typename + ((" " + arg.spelling) if argNames else "")
      return [argBinding, changed]
    return f

  def _resolveArgType(self, arg, templateDecl, templateArgs):
    """Resolve an argument's C++ type, substituting template args."""
    pointee = arg.type.get_pointee()
    if pointee.kind != clang.cindex.TypeKind.INVALID:
      spelling = pointee.spelling
    else:
      spelling = arg.type.spelling
    if templateArgs is not None:
      bare = spelling.replace("const ", "")
      if bare in templateArgs:
        spelling = spelling.replace(bare, templateArgs[bare].spelling)
    return spelling

  def _getArgName(self, arg, index):
    return arg.spelling if arg.spelling else f"argNo{index}"

  def _needsCStringWrapper(self, type):
    return type.get_canonical().kind == clang.cindex.TypeKind.POINTER and isCString(type)

  def _canDoRbv(self, method):
    """Check if a method with output params can use the RBV value_object pattern."""
    ret_type = method.result_type
    if ret_type.spelling != "void" and ret_type.get_canonical().kind == clang.cindex.TypeKind.POINTER:
      return False
    if ret_type.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
      pointee = ret_type.get_pointee()
      if not pointee.is_const_qualified():
        return False
    return True

  def _getJsArity(self, method):
    """Get the JS-visible arity after RBV output param stripping."""
    args = list(method.get_arguments())
    if not any(isOutputParam(a.type) for a in args):
      return len(args)
    if not self._canDoRbv(method):
      return len(args)
    return sum(1 for a in args if not shouldStripParam(a.type, method) and not isRawPointerParam(a.type))

  def _getJsVisibleArgs(self, method):
    """Get list of (original_cpp_index, arg) for JS-visible args."""
    args = list(method.get_arguments())
    if not any(isOutputParam(a.type) for a in args):
      return [(i, a) for i, a in enumerate(args)]
    if not self._canDoRbv(method):
      return [(i, a) for i, a in enumerate(args)]
    return [(i, a) for i, a in enumerate(args) if not shouldStripParam(a.type, method) and not isRawPointerParam(a.type)]

  def _ensureResultStruct(self, method, args, className, overloadPostfix, templateDecl, templateArgs, theClass=None):
    """Register the value_object result struct for an RBV method.
    Returns (structName, struct_fields, output_params, stripped_indices) or None."""
    ret_type = method.result_type
    if ret_type.spelling != "void" and ret_type.get_canonical().kind == clang.cindex.TypeKind.POINTER:
      return None
    if ret_type.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
      pointee = ret_type.get_pointee()
      if not pointee.is_const_qualified():
        return None

    # Envelope-bound output params: every output param EXCEPT concrete classes
    # (non-Handle, default-constructible). Per R1 of
    # docs/research/ocjs-rbv-return-shape-revisit.md class outputs are mutated
    # in place via val::as<T&>() and never mirrored into the return envelope;
    # the caller reads the updated value from the input variable they own.
    output_params = [(i, a) for i, a in enumerate(args)
                     if isOutputParam(a.type) and not isClassOutputParam(a.type)]
    stripped_indices = set(i for i, a in enumerate(args) if shouldStripParam(a.type, method))

    structName = f"{className}_{method.spelling}_Result"
    if overloadPostfix:
      structName += overloadPostfix

    # Align the value_object field names with the base class's output-param
    # names when this method overrides one. This keeps the JS payload keys in
    # lock-step with `_buildOutputParamReturnType`'s TS signature, preventing
    # `returnValue.ACode` (runtime) vs `returnValue.Code` (TS) divergence.
    effective_output_names = dict(self._effectiveOutputNames(theClass, method, args))

    struct_fields = []
    disposable_field_names = []
    for i, arg in output_params:
      name = effective_output_names.get(i, self._getArgName(arg, i))
      pointee = arg.type.get_pointee()
      cppType = self._resolveArgType(arg, templateDecl, templateArgs)
      if _isHandleType(pointee):
        cppType = pointee.spelling
        disposable_field_names.append(name)
      elif pointee.get_canonical().spelling in builtInTypes:
        cppType = pointee.get_canonical().spelling
      elif pointee.kind == clang.cindex.TypeKind.ENUM or pointee.get_canonical().kind == clang.cindex.TypeKind.ENUM:
        cppType = pointee.spelling
      struct_fields.append((name, cppType))

    has_nonvoid_return = method.result_type.spelling != "void"
    if has_nonvoid_return:
      ret = method.result_type
      if ret.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
        ret = ret.get_pointee()
      retSpelling = ret.spelling.replace("const ", "").strip()
      retType = self.resolveWithCanonicalFallback(retSpelling, ret, templateDecl, templateArgs)
      if retType.endswith(' &'):
        retType = retType[:-2].strip()
      if retType.startswith('const '):
        retType = retType[6:].strip()
      ret_field_name = ENVELOPE_RETURN_FIELD
      existing_names = {n for n, _ in struct_fields}
      if ret_field_name in existing_names:
        ret_field_name = ENVELOPE_RETURN_FIELD_COLLISION
      struct_fields.insert(0, (ret_field_name, retType))
      # `result` is embind-managed when the C++ return type is a Handle<T> or
      # a registered class. Detect either by walking the canonical type of the
      # method's return.
      ret_canonical = ret.get_canonical()
      if _isHandleType(ret) or _isHandleType(ret_canonical) or _isDefaultConstructibleClass(ret_canonical):
        if ret_canonical.spelling not in builtInTypes and not (
          ret.kind == clang.cindex.TypeKind.ENUM or ret_canonical.kind == clang.cindex.TypeKind.ENUM
        ):
          disposable_field_names.insert(0, ret_field_name)

    field_key = tuple((fname, ftype) for fname, ftype in struct_fields)

    existing = self._emitted_structs.get(structName)
    if existing is not None and existing != field_key:
      counter = 2
      while f"{structName}_{counter}" in self._emitted_structs:
        counter += 1
      structName = f"{structName}_{counter}"
    self._emitted_structs[structName] = field_key

    # When the container holds embind-managed fields (class instances or
    # Handle<T>), the per-method lambda returns ::emscripten::val (not the
    # value_object struct) so it can attach Symbol.dispose via the EM_JS
    # shared disposer registered in BUILTIN_ADDITIONAL_BIND_CODE. Skip the
    # struct definition + value_object registration for those — embind would
    # also fail to auto-register class fields inside a value_object anyway.
    needs_dispose = bool(disposable_field_names)
    # value_object structs are only used by the S1 lambda return type. R2
    # collapses methods whose only outputs are mutated-in-place class refs
    # to a native return — when `output_params` is empty the lambda never
    # references this struct, so skip the registration to avoid emitting a
    # dead `<Class>_<Method>_Result` symbol that only carries the C++ return.
    is_s1_envelope_path = bool(output_params) and not needs_dispose
    already_defined = any(f"struct {structName} {{" in d for d in self._result_struct_defs)
    if not already_defined and is_s1_envelope_path:
      struct_def = f"struct {structName} {{\n"
      for fname, ftype in struct_fields:
        struct_def += f"  {ftype} {fname};\n"
      struct_def += f"}};\n\n"
      self._result_struct_defs.append(struct_def)

    already_registered = any(f'"{structName}"' in r for r in self._result_struct_registrations)
    if not already_registered and is_s1_envelope_path:
      reg = f"  value_object<{structName}>(\"{structName}\")\n"
      for fname, ftype in struct_fields:
        reg += f"    .field(\"{fname}\", &{structName}::{fname})\n"
      reg += f"  ;\n"
      self._result_struct_registrations.append(reg)

    return (structName, struct_fields, output_params, stripped_indices, disposable_field_names)

  def _emitRbvCollisionDispatch(self, theClass, colliding_methods, js_arity, className, templateDecl, templateArgs):
    """Emit separate typed bindings for methods that collide at same JS arity due to RBV stripping.

    Each method gets its own binding with the same name. The patched embind runtime
    handles JS-side type dispatch. RBV optional_override wrappers remain for
    value_object packing but without type discrimination logic.
    """
    output = ""
    methodName = colliding_methods[0].spelling

    for m in colliding_methods:
      args = list(m.get_arguments())
      has_output = any(isOutputParam(a.type) for a in args)

      if has_output:
        try:
          output += self.processMethodOrProperty(theClass, m, templateDecl, templateArgs, overload_index=0, override_postfix="")
        except SkipException as e:
          print(str(e))
      else:
        try:
          output += self.processMethodOrProperty(theClass, m, templateDecl, templateArgs, overload_index=0, override_postfix="")
        except SkipException as e:
          print(str(e))

    return output

  def _containerNeedsDispose(self, disposable_field_names):
    """Pure predicate over the disposable-field list produced by
    `_ensureResultStruct`. The list is non-empty iff at least one container
    field is an embind-managed type (class instance or Handle<T>).

    Drives the val::object()-vs-value_object branch in `_emitOutputParamBinding`
    and the `[Symbol.dispose](): void` member in `_buildOutputParamReturnType`.
    """
    return bool(disposable_field_names)

  def _emitOutputParamBinding(self, theClass, method, args, className, classTypeName, overloadPostfix, templateDecl, templateArgs):
    """Emit the embind binding lambda for a method with OCJS-classified output parameters.

    Three **cross-boundary return shapes** (S0/S1/S2) determine what TS/JS consumers see.
    This function implements **S1** and **S2** only — it is skipped when the method has
    no output params (**S0**: direct native embind return; struct PODs register as nested
    `value_object` in `processClass`).

    The R1-R6 minimal transformation
    (`docs/research/ocjs-rbv-return-shape-revisit.md`) trims the envelope further:
      - R1 — class output params are NOT echoed in the envelope (they mutate in
        place via `*<arg>.as<T*>(allow_raw_pointers())`).
      - R3 — when filtering by R1 yields no envelope outputs, this hook collapses
        to a native return (or `void` if the C++ return is `void`); no
        `value_object`/`val::object` is registered.
      - R5 — the C++ return-value field inside any envelope is named
        ``returnValue`` (with ``returnValue_`` reserved as the collision fallback
        when an OCCT parameter is already named ``returnValue``).
      - R6 — `_jsdoc` consumes `_describeEnvelope` to emit a multi-line
        ``@returns A result object with fields:`` block and tag every class
        output param with ``Mutated in place; read the updated value from this
        argument after the call.``

    **S0 — Direct return (no RBV envelope from this hook).**
      Trigger: `isOutputParam` is false for every argument (e.g. `BRepGraph_Builder::Add`),
      OR R1 filtered every output away so only class mutations remain (R3 collapse).
      Codegen: no `optional_override` from this function; struct returns use nested
      `value_object<Class_Nested>` registration in `processClass`.
      Consumer dts (representative)::
          static Add(theGraph: BRepGraph, theShape: TopoDS_Shape): BRepGraph_Builder_Result;
          D2(u: number, v: number, P: gp_Pnt, D1U: gp_Vec, D1V: gp_Vec, D2U: gp_Vec, D2V: gp_Vec, D2UV: gp_Vec): void;
      Consumer call-site: ``const r = oc.BRepGraph_Builder.Add(g, s);`` — no `using`, no
      `Symbol.dispose`; for class-output-only voids the caller reads mutated args back.

    **S1 — `value_object` envelope (primitive / enum outputs only; no `Symbol.dispose`).**
      Trigger: at least one R1-surviving output param AND `_containerNeedsDispose` is false.
      Codegen: `optional_override` returning aggregate ``StructName{ret?, outs...}`` where
      the C++ return (if any) lives at field ``returnValue``.
      Consumer dts (representative)::
          Bounds(U1: number, U2: number, V1: number, V2: number):
              { U1: number; U2: number; V1: number; V2: number };
      Consumer call-site: ``const b = surface.Bounds(0, 0, 0, 0);`` — input-passthrough
      seed values; no `using`.

    **S2 — `val::object` envelope + `[Symbol.dispose]` (embind-managed fields).**
      Trigger: `_containerNeedsDispose` is true (any Handle<T> field; class instances
      no longer trigger this branch — they mutate in place per R1).
      Includes **Approach G**: non-const `Handle<T>&` outputs are elided from the JS arity
      (`shouldStripParam`); stack-local null Handles are declared inside this lambda; fresh
      wrappers surface as container fields. See `docs/research/ocjs-rbv-handle-output-param-elision.md`.
      Consumer dts (representative; Handle elision on `Segment`)::
          Segment(Index: number):
              { Curve1: Geom2d_Curve; Curve2: Geom2d_Curve; [Symbol.dispose](): void };
      Consumer call-site: ``using seg = inter.Segment(1);`` — `tau-lint/require-using-on-disposable`
      enforces disposal of the envelope.

    Output-param paths inside S1/S2:
      - Primitive / enum (input-passthrough): JS arg, in/out value copy (fixes zero-init bug).
      - Default-constructible class: JS arg; caller supplies the instance.
      - `Handle<T>&` (**Approach G**): **not** a JS arg; stack-local Handle in this lambda;
        populated wrapper is a container field.

    Branch authority:
      - S0 vs (S1|S2): whether this function runs at all (any `isOutputParam`).
      - S1 vs S2: `_containerNeedsDispose(disposable_field_names)`.

    Returns None if the method can't use this codepath (e.g. raw pointer return).
    """
    result = self._ensureResultStruct(method, args, className, overloadPostfix, templateDecl, templateArgs, theClass=theClass)
    if result is None:
      return None
    structName, struct_fields, output_params, stripped_indices, disposable_field_names = result
    has_nonvoid_return = method.result_type.spelling != "void"
    needs_dispose = self._containerNeedsDispose(disposable_field_names)

    lambda_params = []
    elided_handle_decls = []  # stack-local null Handle declarations (Approach G)
    if not method.is_static_method():
      constPrefix = "const " if method.is_const_method() else ""
      lambda_params.append(f"{constPrefix}{classTypeName}& self")

    # Per-arg metadata so we can pair the lambda-params loop with the
    # call-args loop without re-classifying each arg in two places. Class
    # outputs (R1: mutated in place via val::as<T&>()) and Handle outputs
    # (Approach G: stack-local null) need their own forwarding lanes.
    class_output_call_types = {}

    for i, arg in enumerate(args):
      name = self._getArgName(arg, i)
      if self._needsCStringWrapper(arg.type):
        lambda_params.append(f"std::string {name}")
        continue
      argType = self.getOriginalArgumentType(arg, templateDecl, templateArgs)
      if isOutputParam(arg.type):
        pointee = arg.type.get_pointee()
        if isHandleOutputParam(arg.type):
          # Approach G: elide from JS-facing arg list; declare a stack-local
          # null Handle inside the lambda body so the C++ business call still
          # receives a non-const Handle<T>& to write into. The resulting
          # wrapper is exposed via the val::object() container field below.
          elided_handle_decls.append(f"        {pointee.spelling} {name};\n")
          continue
        if isClassOutputParam(arg.type):
          # R1 minimal transformation: lambda accepts the caller's JS instance
          # as ::emscripten::val and decodes it with val::as<T&>() so the C++
          # method mutates the caller's underlying instance in place. The
          # mutated value lives on the input variable; the envelope (if any)
          # does NOT mirror it.
          raw = pointee.get_canonical().spelling.replace("const ", "").strip()
          class_output_call_types[i] = self.replaceTemplateArgs(raw, templateArgs)
          lambda_params.append(f"::emscripten::val {name}")
          continue
        if pointee.get_canonical().spelling in builtInTypes:
          argType = pointee.get_canonical().spelling
        elif pointee.kind == clang.cindex.TypeKind.ENUM or pointee.get_canonical().kind == clang.cindex.TypeKind.ENUM:
          argType = pointee.spelling
      lambda_params.append(f"{argType} {name}")

    call_args = []
    for i, arg in enumerate(args):
      name = self._getArgName(arg, i)
      if self._needsCStringWrapper(arg.type):
        if not arg.type.get_canonical().get_pointee().is_const_qualified() or arg.type.is_const_qualified():
          call_args.append(f"strdup({name}.c_str())")
        else:
          call_args.append(f"{name}.c_str()")
      elif i in class_output_call_types:
        # Decode the JS-side val into the underlying C++ class instance so the
        # OCCT call mutates the caller's object. We deliberately use the raw
        # pointer wire format (`val::as<T*>(allow_raw_pointers())` + deref)
        # instead of `val::as<T&>()` — embind's reference wire format
        # round-trips by value (BindingType<T&> degrades to BindingType<T>
        # which materialises a copy), so mutations on a `T&` view of a val
        # never propagate back to the JS instance. The pointer wire returns
        # the registered class pointer directly, so dereferencing it inside
        # the call yields a true reference into the caller's heap object.
        call_args.append(f"*{name}.as<{class_output_call_types[i]}*>(emscripten::allow_raw_pointers())")
      else:
        call_args.append(name)

    caller = "self." if not method.is_static_method() else f"{classTypeName}::"
    call_str = f"{caller}{method.spelling}({', '.join(call_args)})"

    # R2: when the envelope-bound output list is empty (only class outputs
    # were present, and they are mutated in place rather than mirrored), the
    # lambda has nothing to wrap — return the native C++ value or void
    # directly. Approach G's elided Handle outputs still count as envelope
    # fields, so methods that only have class + elided-Handle outputs go
    # through the envelope path.
    envelope_is_empty = not output_params and not has_nonvoid_return
    envelope_native_only = not output_params and has_nonvoid_return

    body = "".join(elided_handle_decls)
    params_str = ", ".join(lambda_params)

    if envelope_is_empty:
      # Class-only method with `void` C++ return — mutate inputs in place and
      # return void. No value_object, no val::object envelope, no Symbol.dispose.
      body += f"        {call_str};\n"
      return f"\n      optional_override([]({params_str}) -> void {{\n{body}      }})"

    if envelope_native_only:
      # Class-only method with a non-void C++ return — forward the native
      # value as-is. The caller reads class outputs from their inputs and
      # uses the return value directly (no envelope, no Symbol.dispose).
      ret = method.result_type
      if ret.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
        ret = ret.get_pointee()
      retSpelling = ret.spelling.replace("const ", "").strip()
      retType = self.resolveWithCanonicalFallback(retSpelling, ret, templateDecl, templateArgs)
      if retType.endswith(' &'):
        retType = retType[:-2].strip()
      if retType.startswith('const '):
        retType = retType[6:].strip()
      body += f"        return {call_str};\n"
      return f"\n      optional_override([]({params_str}) -> {retType} {{\n{body}      }})"

    if has_nonvoid_return:
      body += f"        auto ret = {call_str};\n"
    else:
      body += f"        {call_str};\n"

    if needs_dispose:
      # val::object() return + EM_JS-registered Symbol.dispose. The disposer
      # is unbound — `using` invokes it as a method call so `this` is the
      # container at runtime, sidestepping the V8 13.6 bound-function bug.
      body += "        ::emscripten::val out = ::emscripten::val::object();\n"
      if has_nonvoid_return:
        ret_field_name = struct_fields[0][0]
        body += f'        out.set("{ret_field_name}", ret);\n'
      for i, arg in output_params:
        name = self._getArgName(arg, i)
        body += f'        out.set("{name}", {name});\n'
      body += "        out.set(::ocjs::getSymbolDispose(), ::ocjs::getRbvDispose());\n"
      body += "        return out;\n"
      return f"\n      optional_override([]({params_str}) -> ::emscripten::val {{\n{body}      }})"

    # Primitive-only: keep value_object struct return. Faster and no
    # Symbol.dispose needed.
    return_fields = []
    if has_nonvoid_return:
      return_fields.append("ret")
    for i, arg in output_params:
      name = self._getArgName(arg, i)
      return_fields.append(name)
    body += f"        return {structName}{{{', '.join(return_fields)}}};\n"
    return f"\n      optional_override([]({params_str}) -> {structName} {{\n{body}      }})"

  def processMethodOrProperty(self, theClass, method, templateDecl = None, templateArgs = None, overload_index = 0, override_postfix = None):
    output = ""
    className = getClassTypeName(theClass, templateDecl)
    if className == "":
      className = theClass.type.spelling
    classCpp = getClassQualifiedName(theClass, templateDecl)
    if not classCpp:
      classCpp = className
    if method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.CXX_METHOD and not method.spelling.startswith("operator"):
      [overloadPostfix, numOverloads] = getMethodOverloadPostfix(theClass, method)
      if override_postfix is not None:
        overloadPostfix = override_postfix

      args = list(method.get_arguments())
      self._checkUnbindableArgs(method.spelling, theClass.spelling, args)

      hasOutputParams = any(isOutputParam(a.type) for a in args)
      hasCStringArgs = any(self._needsCStringWrapper(a.type) for a in args)
      returnIsCString = self._needsCStringWrapper(method.result_type)

      functionBinding = None
      if hasOutputParams:
        functionBinding = self._emitOutputParamBinding(
          theClass, method, args, className, classCpp, overloadPostfix, templateDecl, templateArgs)
      if functionBinding is None and hasOutputParams:
        print(f"Skipping {className}::{method.spelling}: output params with unbindable return type")
        return ""
      if functionBinding is None and (hasCStringArgs or returnIsCString):
        def needsCStringOrLvalueWrapper(type):
          return (
            type.kind == clang.cindex.TypeKind.LVALUEREFERENCE and (
              type.get_pointee().kind == clang.cindex.TypeKind.POINTER or (
                theClass.kind == clang.cindex.CursorKind.CLASS_TEMPLATE and
                templateArgs is not None and
                type.get_pointee().spelling in templateArgs and
                templateArgs[type.get_pointee().spelling].get_canonical().spelling in builtInTypes
              )
            ) or (
              type.get_canonical().kind == clang.cindex.TypeKind.POINTER and
              isCString(type)
            )
          )
        argsNeedingWrapper = list(map(lambda arg: needsCStringOrLvalueWrapper(arg.type), args))
        returnNeedsWrapper = needsCStringOrLvalueWrapper(method.result_type)
        def replaceTemplateArgs(x):
          if templateArgs is not None and args[x[0]].type.get_pointee().spelling.replace("const ", "") in templateArgs:
            return args[x[0]].type.spelling.replace(args[x[0]].type.get_pointee().spelling.replace("const ", ""), templateArgs[args[x[0]].type.get_pointee().spelling.replace("const ", "")].spelling)
          else:
            return args[x[0]].type.spelling
        def getArgName(x):
          return pick(
            not args[x[0]].spelling == "",
            args[x[0]].spelling,
            f"argNo{str(x[0])}"
          )
        classTypeName = classCpp
        wrappedParamTypes = merge(", ", *map(lambda x:
          pick(
            x[1],
            "std::string" if isCString(args[x[0]].type) else "emscripten::val",
            replaceTemplateArgs(x)
          ),
          enumerate(argsNeedingWrapper)
        ))
        wrappedParamTypesAndNames = merge(", ", *map(lambda x:
          pick(
            x[1],
            f"std::string {getArgName(x)}" if isCString(args[x[0]].type) else f"emscripten::val {getArgName(x)}",
            f"{replaceTemplateArgs(x)} {getArgName(x)}",
          ), enumerate(argsNeedingWrapper)))
        def generateInvocationArgs(x):
          if x[1]:
            if isCString(args[x[0]].type):
              if not args[x[0]].type.get_canonical().get_pointee().is_const_qualified() or args[x[0]].type.is_const_qualified():
                return f"strdup({getArgName(x)}.c_str())"
              else:
                return f"{getArgName(x)}.c_str()"
            else:
              return getArgName(x)
          else:
            return getArgName(x)
        returnNeedsCStringWrapper = isCString(method.result_type)
        returnNeedsValWrapper = returnNeedsWrapper and not returnNeedsCStringWrapper
        resultTypeSpelling = \
          pick(returnNeedsValWrapper, "emscripten::val",
            pick(returnNeedsCStringWrapper, "std::string",
              self.resolveWithCanonicalFallback(method.result_type.spelling, method.result_type, templateDecl, templateArgs)))
        functionBindingHead = \
          merge("",
            "\n",
            indent(3),
            pickWrap(not method.is_static_method(),
              [f"std::function<{resultTypeSpelling}(", f"(({resultTypeSpelling} (*)("],
              merge("",
                pick(not method.is_static_method(), f"{classTypeName}&", ""),
                pick(not method.is_static_method() and len(args) > 0, ", ", ""),
                wrappedParamTypes,
              ),
              [")>(", "))"]
            ),
            merge("",
              "[](",
              pick(not method.is_static_method(), f"{classTypeName}& that", ""),
              pick(not method.is_static_method() and len(args) > 0, ", ", ""),
              wrappedParamTypesAndNames,
              ")",
            ),
            f" -> {resultTypeSpelling} {{\n",
          )
        functionBindingBody = \
          merge("",
            indent(4),
            pick(
              not method.result_type.spelling == "void",
              merge("",
                pick(not isCString(method.result_type) and (method.result_type.is_const_qualified() or method.result_type.get_pointee().is_const_qualified()), "const ", ""),
                "auto",
                pick(not isCString(method.result_type) and method.result_type.kind == clang.cindex.TypeKind.LVALUEREFERENCE, "& ", " "),
                "ret = ",
              ),
              ""
            ),
            merge("",
              pick(not method.is_static_method(), "that.", f"{classCpp}::"),
              f'{method.spelling}({merge(", ", *map(lambda x: generateInvocationArgs(x), enumerate(argsNeedingWrapper)))})',
            ),
            ";\n",
            pick(
              method.result_type.spelling == "void",
              "",
              pick(
                returnNeedsValWrapper,
                pick(
                  method.result_type.kind == clang.cindex.TypeKind.POINTER,
                  merge("",
                    indent(4),
                    "return ret == nullptr ? emscripten::val::null() : emscripten::val(static_cast<",
                      self.getTypedefedTemplateTypeAsString(method.result_type.spelling, templateDecl, templateArgs),
                    ">(ret), allow_raw_pointers());\n",
                  ),
                  f"{indent(4)}return emscripten::val(ret, allow_raw_pointers());\n",
                ),
                pick(
                  returnNeedsCStringWrapper,
                  merge("",
                    indent(4),
                    "return ret == nullptr ? std::string() : std::string(ret);\n",
                  ),
                  f"{indent(4)}return ret;\n",
                ),
              ),
            ),
          )
        functionBinding = \
          merge("",
            functionBindingHead,
            functionBindingBody,
            f"{indent(3)}}}\n",
            f"{indent(2)})",
          )
      if functionBinding is None:
        if self._returnTypeRequiresValueWrapper(method):
          self._ret_wrapper_serial += 1
          storage = f"__ocjs_ret_{self._ret_wrapper_serial}"
          args_m = list(method.get_arguments())
          arg_decl = []
          fwd = []
          for i, a in enumerate(args_m):
            typ = self.getOriginalArgumentType(a, templateDecl, templateArgs)
            nm = a.spelling if a.spelling else f"a{i}"
            arg_decl.append(f"{typ} {nm}")
            fwd.append(nm)
          decls = ", ".join(arg_decl)
          call_fwd = ", ".join(fwd)
          rt = method.result_type
          return_by_ref = rt.kind in (
            clang.cindex.TypeKind.LVALUEREFERENCE,
            clang.cindex.TypeKind.RVALUEREFERENCE,
          )
          ret_clang_type = rt.get_pointee() if return_by_ref else rt
          ret_cpp = self.resolveWithCanonicalFallback(
            ret_clang_type.spelling, ret_clang_type, templateDecl, templateArgs)
          if method.is_static_method():
            call_expr = f"{classCpp}::{method.spelling}({call_fwd})"
          else:
            call_expr = f"self.{method.spelling}({call_fwd})"
          if return_by_ref:
            if method.is_static_method():
              functionBinding = merge("",
                " optional_override([](",
                decls,
                ") -> emscripten::val {\n",
                indent(3),
                "auto& ret = ",
                call_expr,
                ";\n",
                indent(3),
                "return emscripten::val(&ret, allow_raw_pointers());\n",
                indent(2),
                "})",
              )
            else:
              const_self = "const " if method.is_const_method() else ""
              self_and = f"{const_self}{classCpp}& self"
              sep = ", " if decls else ""
              functionBinding = merge("",
                " optional_override([](",
                self_and,
                sep,
                decls,
                ") -> emscripten::val {\n",
                indent(3),
                "auto& ret = ",
                call_expr,
                ";\n",
                indent(3),
                "return emscripten::val(&ret, allow_raw_pointers());\n",
                indent(2),
                "})",
              )
          else:
            if method.is_static_method():
              functionBinding = merge("",
                " optional_override([](",
                decls,
                ") -> emscripten::val {\n",
                indent(3),
                f"thread_local {ret_cpp} {storage};\n",
                indent(3),
                f"{storage} = {call_expr};\n",
                indent(3),
                f"return emscripten::val(&{storage}, allow_raw_pointers());\n",
                indent(2),
                "})",
              )
            else:
              const_self = "const " if method.is_const_method() else ""
              self_and = f"{const_self}{classCpp}& self"
              sep = ", " if decls else ""
              functionBinding = merge("",
                " optional_override([](",
                self_and,
                sep,
                decls,
                ") -> emscripten::val {\n",
                indent(3),
                f"thread_local {ret_cpp} {storage};\n",
                indent(3),
                f"{storage} = {call_expr};\n",
                indent(3),
                f"return emscripten::val(&{storage}, allow_raw_pointers());\n",
                indent(2),
                "})",
              )
        elif numOverloads == 1:
          functionBinding = " &" + classCpp + "::" + method.spelling
        else:
          functionBinding = merge("",
            " select_overload<",
            self.resolveWithCanonicalFallback(method.result_type.spelling, method.result_type, templateDecl, templateArgs),
            f'({merge(", ", *map(lambda x: self.getOriginalArgumentType(x, templateDecl, templateArgs), list(method.get_arguments())))})',
            pick(method.is_const_method(), "const", ""),
            pick(not method.is_static_method(), f", {classCpp}", ""),
            f">(&{classCpp}::{method.spelling})",
          )

      if method.is_static_method():
        functionCommand = "class_function"
      else:
        functionCommand = "function"

      output += f"{indent(2)}.{functionCommand}(\"{method.spelling}{overloadPostfix}\",{functionBinding}, allow_raw_pointers())\n"
    if method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.FIELD_DECL:
      if method.type.kind == clang.cindex.TypeKind.CONSTANTARRAY:
        print("Cannot handle array properties, skipping " + className + "::" + method.spelling)
      elif not method.type.get_pointee().kind == clang.cindex.TypeKind.INVALID:
        print("Cannot handle pointer properties, skipping " + className + "::" + method.spelling)
      else:
        if not self._isWireSafeFieldType(method.type):
          return output
        output += f"{indent(2)}.property(\"{method.spelling}\", &{classCpp}::{method.spelling})\n"
    return output

  def _emitValDispatchMethod(self, theClass, methodName, arity, tree, classCpp, isStatic, templateDecl, templateArgs, mixed_returns=False):
    """Emit a single optional_override method binding with val-based dispatch for same-arity overloads."""
    val_args = ", ".join([f"emscripten::val arg{i}" for i in range(arity)])
    if isStatic:
      sig_args = val_args
      functionCommand = "class_function"
    else:
      sig_args = f"{classCpp}& self" + (", " + val_args if val_args else "")
      functionCommand = "function"

    ret_type = " -> emscripten::val" if mixed_returns else ""
    output = f'{indent(2)}.{functionCommand}("{methodName}", optional_override([]({sig_args}){ret_type} {{\n'
    output += self._codegen_method_dispatch_tree(tree, classCpp, isStatic, templateDecl, templateArgs, ind=6, mixed_returns=mixed_returns)
    output += "    }), allow_raw_pointers())\n"
    return output

  def _codegen_method_dispatch_tree(self, tree, classCpp, isStatic, templateDecl, templateArgs, ind=6, mixed_returns=False):
    """Generate C++ dispatch code for a method dispatch tree."""
    sp = " " * ind
    if isinstance(tree, DispatchLeaf):
      method = tree.overload
      args = list(method.get_arguments())
      conversions = []
      for i, arg in enumerate(args):
        if isRawPointerParam(arg.type) and not isCString(arg.type):
          conversions.append('nullptr')
          continue
        cpp_type = self.getOriginalArgumentType(arg, templateDecl, templateArgs)
        js_type = self._classify_js_type(arg.type, templateDecl, templateArgs)
        if js_type.category == 'object':
          conversions.append(f'arg{i}.as<{cpp_type}>(emscripten::allow_raw_pointers())')
        elif js_type.category == 'string' and isCString(arg.type):
          conversions.append(f'arg{i}.as<std::string>().c_str()')
        else:
          canon = arg.type.get_canonical().spelling
          if "type-parameter-" in canon:
            canon = self.resolveWithCanonicalFallback(arg.type.spelling, arg.type, templateDecl, templateArgs)
          conversions.append(f'arg{i}.as<{canon}>()')
      args_str = ", ".join(conversions)
      caller = f"{classCpp}::" if method.is_static_method() else "self."
      has_return = method.result_type.spelling != "void"
      if mixed_returns:
        if has_return:
          return f'{sp}return emscripten::val({caller}{method.spelling}({args_str}));\n'
        return f'{sp}{caller}{method.spelling}({args_str});\n{sp}return emscripten::val::undefined();\n'
      if has_return:
        return f'{sp}return {caller}{method.spelling}({args_str});\n'
      return f'{sp}{caller}{method.spelling}({args_str});\n{sp}return;\n'

    if isinstance(tree, DispatchBranch):
      code = ''
      first = True
      primitives = []
      objects = []
      for js_type, subtree in tree.branches.items():
        if js_type.category == 'object':
          objects.append((js_type, subtree))
        else:
          primitives.append((js_type, subtree))
      has_int = any(jt.category == 'number_int' for jt, _ in primitives)
      has_float = any(jt.category == 'number_float' for jt, _ in primitives)
      int_float_split = has_int and has_float
      primitives.sort(key=self._dispatch_primitive_sort_key)
      ordered = primitives + objects
      for idx, (js_type, subtree) in enumerate(ordered):
        is_last = (idx == len(ordered) - 1)
        if first:
          keyword = "if"
        elif is_last:
          keyword = "else"
        else:
          keyword = "else if"
        first = False
        if is_last:
          code += f'{sp}{keyword} {{\n'
        elif js_type.category == 'object':
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "object" && !emscripten::val::module_property("{js_type.name}").isUndefined() && arg{tree.arg_position}.instanceof(emscripten::val::module_property("{js_type.name}"))'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'boolean':
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "boolean"'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'string_enum':
          check = (
            f'arg{tree.arg_position}.typeOf().as<std::string>() == "string"'
            f' && !emscripten::val::module_property("{js_type.name}")'
            f'[arg{tree.arg_position}.as<std::string>()].isUndefined()'
          )
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'string':
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "string"'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'number_int' and int_float_split:
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "number" && emscripten::val::global("Number").call<bool>("isInteger", arg{tree.arg_position})'
          code += f'{sp}{keyword} ({check}) {{\n'
        elif js_type.category == 'number_float' and int_float_split:
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "number"'
          code += f'{sp}{keyword} ({check}) {{\n'
        else:
          check = f'arg{tree.arg_position}.typeOf().as<std::string>() == "number"'
          code += f'{sp}{keyword} ({check}) {{\n'
        code += self._codegen_method_dispatch_tree(subtree, classCpp, isStatic, templateDecl, templateArgs, ind + 2, mixed_returns=mixed_returns)
        code += f'{sp}}}\n'
      return code

    if isinstance(tree, DispatchAmbiguous):
      fallback = DispatchLeaf(tree.overloads[0])
      return self._codegen_method_dispatch_tree(fallback, classCpp, isStatic, templateDecl, templateArgs, ind, mixed_returns=mixed_returns)

    return ''

  def _emitSuffixedMethod(self, theClass, m, suffix, className, templateDecl, templateArgs):
    """Emit a single method binding with a _N suffix for ambiguous overloads."""
    args = list(m.get_arguments())
    argsNeedingWrapper = any(
      m_arg.type.kind == clang.cindex.TypeKind.LVALUEREFERENCE and (
        m_arg.type.get_pointee().get_canonical().spelling in builtInTypes or
        m_arg.type.get_pointee().kind == clang.cindex.TypeKind.ENUM
      ) or isCString(m_arg.type)
      for m_arg in args
    )
    if argsNeedingWrapper:
      try:
        return self.processMethodOrProperty(theClass, m, templateDecl, templateArgs, overload_index=0)
      except SkipException as e:
        print(str(e))
        return ""
    argList = list(m.get_arguments())
    returnType = self.resolveWithCanonicalFallback(m.result_type.spelling, m.result_type, templateDecl, templateArgs)
    argTypesStr = ', '.join(self.getOriginalArgumentType(a, templateDecl, templateArgs) for a in argList)
    constStr = "const" if m.is_const_method() else ""
    classCpp = getClassQualifiedName(theClass, templateDecl)
    if not classCpp:
      classCpp = className
    if m.is_static_method():
      selectStr = f' select_overload<{returnType}({argTypesStr})>(&{classCpp}::{m.spelling})'
    else:
      selectStr = f' select_overload<{returnType}({argTypesStr}){constStr}, {classCpp}>(&{classCpp}::{m.spelling})'
    funcCmd = "class_function" if m.is_static_method() else "function"
    return f'{indent(2)}.{funcCmd}("{m.spelling}{suffix}",{selectStr}, allow_raw_pointers())\n'

  def processMethodGroup(self, theClass, methods, templateDecl=None, templateArgs=None):
    """Process a group of methods with the same name, using dispatch for same-arity groups."""
    output = ""
    className = getClassTypeName(theClass, templateDecl)
    if className == "":
      className = theClass.type.spelling
    classCpp = getClassQualifiedName(theClass, templateDecl)
    if not classCpp:
      classCpp = className

    bindable = []
    for m in methods:
      try:
        self._checkUnbindableArgs(m.spelling, theClass.spelling, list(m.get_arguments()))
        bindable.append(m)
      except SkipException as e:
        print(str(e))

    if not bindable:
      return output

    # Filter rvalue-reference overloads — JS has no move semantics.
    # These create JS-ambiguous duplicates of const-ref overloads,
    # forcing unnecessary _N suffixes on the entire arity group.
    bindable = [m for m in bindable if not any(
      a.type.kind == clang.cindex.TypeKind.RVALUEREFERENCE
      for a in m.get_arguments()
    )]
    if not bindable:
      return output

    # Deduplicate const/non-const overloads with identical argument types.
    # JS has no const `this` — these are JS-indistinguishable and force
    # unnecessary _N suffixes. Prefer the const version.
    deduped = {}
    for m in bindable:
      arg_key = tuple(a.type.get_canonical().spelling for a in m.get_arguments())
      is_const = m.is_const_method()
      if arg_key not in deduped:
        deduped[arg_key] = m
      elif is_const and not deduped[arg_key].is_const_method():
        deduped[arg_key] = m
    bindable = list(deduped.values())
    if not bindable:
      return output

    by_arity = defaultdict(list)
    for m in bindable:
      by_arity[len(list(m.get_arguments()))].append(m)

    all_unique_arities = all(len(group) == 1 for group in by_arity.values())

    by_js_arity = defaultdict(list)
    for m in bindable:
      by_js_arity[self._getJsArity(m)].append(m)

    js_collisions = {
      js_arity: group
      for js_arity, group in by_js_arity.items()
      if len(group) > 1 and len(set(len(list(m.get_arguments())) for m in group)) > 1
    }

    if js_collisions:
      collision_methods = set(id(m) for group in js_collisions.values() for m in group)
      for js_arity, group in sorted(js_collisions.items()):
        output += self._emitRbvCollisionDispatch(theClass, group, js_arity, className, templateDecl, templateArgs)
      bindable = [m for m in bindable if id(m) not in collision_methods]
      if not bindable:
        return output
      by_arity = defaultdict(list)
      for m in bindable:
        by_arity[len(list(m.get_arguments()))].append(m)
      all_unique_arities = all(len(group) == 1 for group in by_arity.values())

    if all_unique_arities:
      arity_idx = {}
      for m in bindable:
        nargs = len(list(m.get_arguments()))
        idx = arity_idx.get(nargs, 0)
        arity_idx[nargs] = idx + 1
        try:
          output += self.processMethodOrProperty(theClass, m, templateDecl, templateArgs, overload_index=idx, override_postfix="")
        except SkipException as e:
          print(str(e))
      return output

    # Some arities collide — handle per-arity group
    all_methods_of_name = [m for m in theClass.get_children()
                           if m.kind == clang.cindex.CursorKind.CXX_METHOD
                           and m.access_specifier == clang.cindex.AccessSpecifier.PUBLIC
                           and m.spelling == bindable[0].spelling]

    for arity, group in sorted(by_arity.items()):
      if len(group) == 1:
        try:
          output += self.processMethodOrProperty(theClass, group[0], templateDecl, templateArgs, overload_index=0, override_postfix="")
        except SkipException as e:
          print(str(e))
      else:
        def _method_has_wrapper_args(m):
          return any(
            (m_arg.type.kind == clang.cindex.TypeKind.LVALUEREFERENCE and
             not m_arg.type.get_pointee().is_const_qualified() and (
               m_arg.type.get_pointee().get_canonical().spelling in builtInTypes or
               m_arg.type.get_pointee().get_canonical().kind == clang.cindex.TypeKind.ENUM
             ) and not shouldStripParam(m_arg.type, m))
            or m_arg.type.get_canonical().spelling in unbindablePointerTypes
            for m_arg in m.get_arguments()
          )

        dispatchable = [m for m in group if not _method_has_wrapper_args(m)]
        wrapper_methods = [m for m in group if _method_has_wrapper_args(m)]

        if not dispatchable:
          arity_idx = {}
          for m in group:
            nargs = len(list(m.get_arguments()))
            idx = arity_idx.get(nargs, 0)
            arity_idx[nargs] = idx + 1
            try:
              output += self.processMethodOrProperty(theClass, m, templateDecl, templateArgs, overload_index=idx)
            except SkipException as e:
              print(str(e))
        else:
          if len(dispatchable) == 1:
            try:
              output += self.processMethodOrProperty(theClass, dispatchable[0], templateDecl, templateArgs, overload_index=0, override_postfix="")
            except SkipException as e:
              print(str(e))
          else:
            js_tree = self._build_js_dispatch_tree(dispatchable, templateDecl=templateDecl, templateArgs=templateArgs)
            js_ambiguous = self._collect_ambiguous_overloads(js_tree)
            js_distinguishable = [m for m in dispatchable if m not in js_ambiguous]

            for m in js_distinguishable:
              try:
                output += self.processMethodOrProperty(theClass, m, templateDecl, templateArgs, overload_index=0, override_postfix="")
              except SkipException as e:
                print(str(e))

            if js_ambiguous:
              val_tree = self._build_dispatch_tree(js_ambiguous, templateDecl=templateDecl, templateArgs=templateArgs)
              val_ambiguous = self._collect_ambiguous_overloads(val_tree)

              if len(js_ambiguous) > len(val_ambiguous):
                return_types = set(m.result_type.get_canonical().spelling for m in js_ambiguous)
                mixed_returns = len(return_types) > 1
                isStatic = all(m.is_static_method() for m in js_ambiguous)
                output += self._emitValDispatchMethod(theClass, js_ambiguous[0].spelling, arity, val_tree, classCpp, isStatic, templateDecl, templateArgs, mixed_returns=mixed_returns)

              for m in val_ambiguous:
                idx = all_methods_of_name.index(m) if m in all_methods_of_name else 0
                suffix = "_" + str(idx + 1)
                output += self._emitSuffixedMethod(theClass, m, suffix, className, templateDecl, templateArgs)

          for m in wrapper_methods:
            idx = all_methods_of_name.index(m) if m in all_methods_of_name else 0
            suffix = "_" + str(idx + 1)
            output += self._emitSuffixedMethod(theClass, m, suffix, className, templateDecl, templateArgs)

    return output

  def processOverloadedConstructors(self, theClass, children = None, templateDecl = None, templateArgs = None):
    """Emit _N subclass bindings ONLY for genuinely ambiguous constructor overloads."""
    output = ""
    if children is None:
      children = list(theClass.get_children())
    constructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, children))
    if len(constructors) <= 1:
      return output

    filtered = self._filter_overloads(constructors)
    filtered = [c for c in filtered if filterMethodOrProperty(theClass, c)]
    bindable = []
    for c in filtered:
      try:
        self._checkUnbindableArgs("constructor", theClass.spelling, list(c.get_arguments()))
        bindable.append(c)
      except SkipException:
        continue

    # Find same-arity groups that are genuinely ambiguous
    by_arity = defaultdict(list)
    for c in bindable:
      by_arity[len(list(c.get_arguments()))].append(c)

    ambiguous_ctors = []
    for group in by_arity.values():
      if len(group) <= 1:
        continue
      tree = self._build_dispatch_tree(group, templateDecl=templateDecl, templateArgs=templateArgs)
      ambiguous_ctors.extend(self._collect_ambiguous_overloads(tree))

    if not ambiguous_ctors:
      return output

    useHandleOverride = isTransientDerived(theClass, self.tuInfo.classDict)
    name = getClassTypeName(theClass, templateDecl)
    qual = getClassQualifiedName(theClass, templateDecl)
    if not qual:
      qual = name
    allOverloads = constructors

    for constructor in ambiguous_ctors:
      try:
        overloadPostfix = "_" + str(allOverloads.index(constructor) + 1)
        args = ", ".join(list(map(lambda x: ("std::string " + x.spelling) if isCString(x.type) else self.getSingleArgumentBinding(True, True, templateDecl, templateArgs)(x)[0], constructor.get_arguments())))
        argNames = ", ".join(list(map(lambda x: (x.spelling + ".c_str()") if isCString(x.type) else x.spelling, constructor.get_arguments())))
        argTypes = ", ".join(list(map(lambda x: "std::string" if isCString(x.type) else self.getSingleArgumentBinding(False, True, templateDecl, templateArgs)(x)[0], constructor.get_arguments())))

        output += "    struct " + name + overloadPostfix + " : public " + qual + " {\n"
        output += "      " + name + overloadPostfix + "(" + args + ") : " + qual + "(" + argNames + ") {}\n"
        output += "    };\n"
        output += "    class_<" + name + overloadPostfix + ", base<" + qual + ">>(\"" + name + overloadPostfix + "\")\n"
        if useHandleOverride:
          output += "      .smart_ptr<opencascade::handle<" + name + overloadPostfix + ">>(\"Handle_" + name + overloadPostfix + "\")\n"
          output += "      .constructor(optional_override([](" + args + ") {\n"
          output += "        return opencascade::handle<" + name + overloadPostfix + ">(new " + name + overloadPostfix + "(" + argNames + "));\n"
          output += "      }))\n"
        else:
          output += "      .constructor<" + argTypes + ">()\n"
        output += "    ;\n"

      except SkipException as e:
        print(str(e))
        continue
    return output

  def processEnum(self, theEnum):
    output = "EMSCRIPTEN_BINDINGS(" + theEnum.spelling + ") {\n"

    bindingsOutput = "  enum_<" + theEnum.spelling + ">(\"" + theEnum.spelling + "\", emscripten::enum_value_type::string)\n"
    enumChildren = list(theEnum.get_children())
    prefix = (theEnum.spelling + "::") if theEnum.is_scoped_enum() else ""
    for enumChild in enumChildren:
      bindingsOutput += "    .value(\"" + enumChild.spelling + "\", " + prefix + enumChild.spelling + ")\n"
    bindingsOutput += "  ;\n"
    output += bindingsOutput

    output += "}\n\n"
    return output

class TypescriptBindings(Bindings):
  """TypeScript declaration generator for OCCT/custom-code Embind bindings.

  ============================================================================
  PRECONDITION — `_known_export_names` MUST be seeded before first use
  ============================================================================

  `resolve_type` (and the helper paths it depends on: `_is_known_export_name`,
  `_resolve_handle_recursive`, `_resolve_template_typedef`, etc.) consults
  the class-level set `_known_export_names` to decide whether a referenced
  C++ identifier corresponds to an exported TS symbol the consumer can
  resolve. When the set is empty, EVERY cross-class reference falls through
  to the `unknown` fallback in `resolve_type`. This produces silently broken
  `.d.ts` output where method signatures lose their real return/parameter
  types.

  Two seed paths exist; both must complete before any
  `processClass`/`processEnum`/`processTemplateTypedef` call:

    1. **Main OCCT build path** (full and custom builds, OCCT-side classes):
       `prepare_known_exports(tuInfo, filterClasses, filterTemplates)` walks
       the post-using-decl `tuInfo` and seeds class, template-typedef, and
       enum names. Called from `generateBindings.__main__` before `process()`.

    2. **Custom-code path** (`additionalCppCode` block from YAML):
       `generateCustomCodeBindings(customCode, known_exports=...)` accepts an
       explicit seed set computed by `buildFromYaml.main` from
       (a) YAML `bindings:` symbols ∪ (b) `_auto_symbols` ∪ (c) AST-discovered
       custom classes. The seed is assigned directly to
       `_known_export_names` before the per-fragment `process(...)` calls.

  Adding a third invocation path? You MUST seed `_known_export_names` first,
  or every cross-class reference in your fragments will collapse to `unknown`.
  ============================================================================
  """
  _docs_cache = None

  def __init__(
    self,
    tuInfo
  ):
    super().__init__(tuInfo)
    self.imports = {}

    self.exports = set()
    self.ancestorChains = {}
    self._docs = self._load_docs()

  def _classify_js_type(self, clang_type, templateDecl=None, templateArgs=None):
    """Override to distinguish bare char from const char* for TypeScript overload resolution.

    At the C++ runtime level both are JS strings, but for TypeScript's type system we
    classify bare char as 'string_char' so the dispatch tree treats it as a distinct
    category. This lets const char* constructors appear on the base class while char
    constructors become _N subclasses.
    """
    result = super()._classify_js_type(clang_type, templateDecl, templateArgs)
    if result.category == 'string' and not isCString(clang_type):
      t = self._strip_type_qualifiers(clang_type)
      kind = t.get_canonical().kind
      if kind in self._JS_CHAR_KINDS:
        return JsType('string_char', 'string')
    return result

  @staticmethod
  def _load_docs():
    if TypescriptBindings._docs_cache is not None:
      return TypescriptBindings._docs_cache
    docs_path = os.path.join(
      os.path.dirname(__file__), "..", "build", "occt-docs.json"
    )
    if os.path.isfile(docs_path):
      with open(docs_path, "r") as f:
        TypescriptBindings._docs_cache = json.load(f)
    else:
      TypescriptBindings._docs_cache = {}
    return TypescriptBindings._docs_cache

  @staticmethod
  def _escape_jsdoc(text):
    """Escape any embedded `*/` so it can't terminate the surrounding /** ... */ block.

    Doxygen briefs occasionally contain literal `*/` (especially in code samples or
    pointer-style notation). Without escaping, the generated JSDoc closes early and
    every subsequent declaration is parsed as a comment continuation. The detailed
    Markdown emitted by `extract-docs.py::_render_description` can also include
    fenced code blocks containing `*/`, so the same escape applies to multi-line
    block content.
    """
    if not text:
      return text
    return text.replace("*/", "*\\/")

  _LINK_TOKEN_RE = re.compile(r"\{@link\s+([^}|]+?)\s*\}")

  def _classify_link_target(self, target):
    """Resolve a Doxygen `<ref>`-derived target to an emitted TS export name.

    Mirrors the priority cascade from `_resolve_qualified_member_type` (rsplit
    on `::` then test `parent + "_" + member` before the bare leaf), and routes
    every candidate through `_is_known_export_name` which already excludes
    typedef-only names that would emit dangling links.

    Strategy (returns the first hit, or None):
      1. Strip template args (drop everything from `<` onward) and trailing
         pointer/ref/const noise; trim whitespace. Call this `clean`.
      2. As-is: if `_is_known_export_name(clean)`, return `clean`.
      3. Underscore-flatten: if `"::" in clean`, test
         `_is_known_export_name(parent + "_" + member)`.
      4. Leaf-only: if step 3 missed, test `_is_known_export_name(member)`.
      5. Container alias: consult `_CONTAINER_ALIASES` against `clean` and
         the underscore-flattened candidate.

    Cross-references R2 + R3 in docs/research/monaco-intellisense-jsdoc-rendering.md.
    """
    if not target:
      return None
    base = target.split("<", 1)[0]
    clean = self._strip_type_qualifiers_str(base)
    if not clean:
      return None
    if self._is_known_export_name(clean):
      return clean
    flat = None
    leaf = None
    if "::" in clean:
      parent, leaf = clean.rsplit("::", 1)
      parent = parent.strip()
      leaf = leaf.strip()
      if parent and leaf:
        flat = parent + "_" + leaf
        if self._is_known_export_name(flat):
          return flat
        if self._is_known_export_name(leaf):
          return leaf
    aliased = TypescriptBindings._CONTAINER_ALIASES.get(clean)
    if aliased and self._is_known_export_name(aliased):
      return aliased
    if flat:
      aliased = TypescriptBindings._CONTAINER_ALIASES.get(flat)
      if aliased and self._is_known_export_name(aliased):
        return aliased
    return None

  def _normalize_link_tokens(self, text):
    """Rewrite `{@link X}` tokens in JSDoc body text for Monaco-friendly tooltips.

    For each `{@link <target>}` token:
      - resolved = self._classify_link_target(target)
      - If resolved: emit `{@link <resolved> | `<target>`}` so VS Code/TypeDoc
        keep the clickable link, the visible text becomes inline code, and
        Monaco's naive `displayPartsToString` collapses to a clean code span.
      - Else: emit `` `<target>` `` so Monaco shows themed inline code instead
        of the literal `{@link …}` artifact.

    Cross-references R2 + R3 in docs/research/monaco-intellisense-jsdoc-rendering.md.
    """
    if not text or "{@link" not in text:
      return text

    def replace(match):
      target = match.group(1).strip()
      if not target:
        return match.group(0)
      resolved = self._classify_link_target(target)
      if resolved:
        return "{@link " + resolved + " | `" + target + "`}"
      return "`" + target + "`"

    return TypescriptBindings._LINK_TOKEN_RE.sub(replace, text)

  _SENTENCE_SPLIT_RE = re.compile(r"(?<=\.)\s+(?=[A-Z])")
  _LONG_PROSE_THRESHOLD = 600
  _MIN_FRAGMENT_LEN = 120
  _SOFT_WRAP_TARGET = 1000

  @staticmethod
  def _soft_wrap_long_line(line):
    """Wrap a single overlong line on the nearest space boundary near
    `_SOFT_WRAP_TARGET`. Used as the R5 backstop when a paragraph has no
    `". (Capital)"` boundaries (e.g. dense pseudocode prose) but still
    overflows Monaco's hover width budget.
    """
    if len(line) <= TypescriptBindings._SOFT_WRAP_TARGET:
      return [line]
    pieces: list[str] = []
    rest = line
    while len(rest) > TypescriptBindings._SOFT_WRAP_TARGET:
      cut = rest.rfind(" ", 0, TypescriptBindings._SOFT_WRAP_TARGET)
      if cut <= 0:
        cut = rest.find(" ", TypescriptBindings._SOFT_WRAP_TARGET)
      if cut <= 0:
        pieces.append(rest)
        return pieces
      pieces.append(rest[:cut])
      rest = rest[cut + 1:]
    if rest:
      pieces.append(rest)
    return pieces

  def _split_long_lines(self, text):
    """Per-line variant of `extract-docs.py::_split_long_sentences`, applied
    after `_normalize_link_tokens` has expanded short `{@link X}` tokens into
    longer `{@link Y | \\`X\\`}` aliases. Splitting at extract time runs against
    the pre-expansion text, which can mask paragraphs that only become Monaco
    hover offenders once the alias text is added (R2 inflates length, R5
    re-checks). Splitting per-line keeps existing intentional paragraph breaks
    intact while only intervening when a single line crosses the threshold.
    Lines that still exceed `_SOFT_WRAP_TARGET` after sentence splitting (rare,
    but happens for dense pseudocode prose with no `. ` boundaries) are
    soft-wrapped on space boundaries as a backstop.

    Cross-references R5 in docs/research/monaco-intellisense-jsdoc-rendering.md.
    """
    if not text:
      return text
    out: list[str] = []
    for line in text.split("\n"):
      if len(line) <= TypescriptBindings._LONG_PROSE_THRESHOLD:
        out.append(line)
        continue
      parts = TypescriptBindings._SENTENCE_SPLIT_RE.split(line)
      if len(parts) >= 2:
        merged: list[str] = []
        for part in parts:
          if merged and len(part) < TypescriptBindings._MIN_FRAGMENT_LEN:
            merged[-1] = merged[-1] + " " + part
          else:
            merged.append(part)
        candidate_lines = merged
      else:
        candidate_lines = [line]
      for cand in candidate_lines:
        out.extend(TypescriptBindings._soft_wrap_long_line(cand))
    return "\n".join(out)

  def _emit_jsdoc_text(self, lines, indent_str, body):
    """Append a Markdown body (single or multi-line) into a JSDoc lines buffer.

    Empty lines become a bare ` * ` separator so paragraph breaks survive in the
    rendered JSDoc tooltip. Trailing whitespace on each non-empty line is removed
    so the output stays diff-clean.
    """
    if not body:
      return
    for line in body.splitlines():
      stripped = line.rstrip()
      if stripped:
        lines.append(f"{indent_str} * {stripped}")
      else:
        lines.append(f"{indent_str} *")

  def _emit_simplesect_tags(self, lines, indent_str, entry):
    """Emit `@remarks **Note:** ...`, `@remarks **Warning:** ...`, `@see ...`
    for the simplesects captured per entry by `extract-docs.py::_extract_simplesects`.

    Note/warning bodies are routed through `_normalize_link_tokens` so any
    `{@link X}` they contain is rewritten with the same classifier used for
    inline body text. `@see` targets are routed through `_classify_link_target`
    directly (rather than the historical `target in self._docs` predicate which
    drifts from the actual export set): when the target resolves to an emitted
    TS export, we emit ``@see {@link <resolved> | `<target>`}`` so the alias
    text reads as themed inline code in Monaco; otherwise we degrade to
    ``@see `<target>` `` to keep the cross-reference rendered as code instead
    of a literal `{@link …}` artifact.

    Cross-references R2 in docs/research/monaco-intellisense-jsdoc-rendering.md.
    """
    for note in entry.get("notes", []) or []:
      normalized = self._normalize_link_tokens(note)
      escaped = self._escape_jsdoc(normalized)
      lines.append(f"{indent_str} * @remarks **Note:** {escaped}")
    for warning in entry.get("warnings", []) or []:
      normalized = self._normalize_link_tokens(warning)
      escaped = self._escape_jsdoc(normalized)
      lines.append(f"{indent_str} * @remarks **Warning:** {escaped}")
    for see in entry.get("sees", []) or []:
      target = see.get("target", "")
      if not target:
        continue
      resolved = self._classify_link_target(target)
      target_escaped = self._escape_jsdoc(target)
      if resolved:
        resolved_escaped = self._escape_jsdoc(resolved)
        lines.append(
          f"{indent_str} * @see {{@link {resolved_escaped} | `{target_escaped}`}}"
        )
      else:
        lines.append(f"{indent_str} * @see `{target_escaped}`")

  # Suffix appended to @param descriptions for class outputs that mutate in
  # place (R5 of docs/research/ocjs-rbv-return-shape-revisit.md). Generated
  # JSDoc preserves upstream Doxygen prose and concatenates this with a single
  # space so the IntelliSense tooltip carries both the OCCT description and
  # the OCJS mechanic on the same line.
  MUTATED_CLASS_PARAM_SUFFIX = "Mutated in place; read the updated value from this argument after the call."

  def _param_description(self, member, param_name):
    """Look up the upstream Doxygen `@param` description for a given name on
    a resolved member entry. Returns the escaped/normalized text (without
    surrounding tags) or "" when no description is present. Used by the
    envelope-fields block in `_jsdoc` to mine reusable copy for Handle /
    primitive envelope fields whose value originated as an output param.
    """
    for param in member.get("params", []):
      if param["name"] == param_name:
        return self._escape_jsdoc(self._normalize_link_tokens(param.get("description", "")))
    return ""

  def _jsdoc(self, class_name, member_name=None, indent_str="", param_count=None, overload_index=0, template_name=None, param_names=None, mutated_class_param_names=None, envelope_descriptor=None):
    """Emit a JSDoc block from Doxygen-derived brief, detailed text, `@param`,
    `@returns`, and simplesect tags only.

    Consumer-facing return-shape contract: see the read-site decision tree in
    docs/research/ocjs-rbv-return-shape-revisit.md. When the dts signature
    embeds an RBV envelope (`{ returnValue, …, [Symbol.dispose] }`), the
    caller passes an `envelope_descriptor` so this method rewrites `@returns`
    into the corresponding envelope-fields block. When a JS-visible class
    output param is mutated in place, the caller passes its name in
    `mutated_class_param_names` so this method appends `MUTATED_CLASS_PARAM_SUFFIX`
    to the existing description (or synthesizes one when upstream Doxygen
    omits the param).
    """
    used_template = False
    entry = self._docs.get(class_name)
    if not entry and template_name:
      entry = self._docs.get(template_name)
      used_template = True
    if not entry:
      return ""
    if member_name is None:
      brief = self._split_long_lines(self._escape_jsdoc(self._normalize_link_tokens(entry.get("brief", ""))))
      detailed = self._split_long_lines(self._escape_jsdoc(self._normalize_link_tokens(entry.get("detailed", ""))))
      has_simplesects = bool(entry.get("notes") or entry.get("warnings") or entry.get("sees"))
      if not brief and not detailed and not has_simplesects and not entry.get("deprecated"):
        return ""
      lines = [f"{indent_str}/**"]
      if brief:
        self._emit_jsdoc_text(lines, indent_str, brief)
      if detailed:
        if brief:
          lines.append(f"{indent_str} *")
        self._emit_jsdoc_text(lines, indent_str, detailed)
      self._emit_simplesect_tags(lines, indent_str, entry)
      if entry.get("deprecated"):
        lines.append(f"{indent_str} * @deprecated")
      lines.append(f"{indent_str} */")
      return "\n".join(lines) + "\n"
    members = entry.get("members", {})
    member = members.get(member_name)
    if not member and used_template and template_name and member_name == class_name:
      member = members.get(template_name)
    if not member:
      return ""
    member = self._resolve_overload(member, param_count, overload_index, param_names=param_names)
    brief = self._split_long_lines(self._escape_jsdoc(self._normalize_link_tokens(member.get("brief", ""))))
    detailed = self._split_long_lines(self._escape_jsdoc(self._normalize_link_tokens(member.get("detailed", ""))))
    has_simplesects = bool(member.get("notes") or member.get("warnings") or member.get("sees"))
    has_param_or_return = bool(member.get("params") or member.get("returns_description"))
    if not brief and not detailed and not has_simplesects and not has_param_or_return and not member.get("deprecated"):
      return ""
    lines = [f"{indent_str}/**"]
    if brief:
      self._emit_jsdoc_text(lines, indent_str, brief)
    if detailed:
      if brief:
        lines.append(f"{indent_str} *")
      self._emit_jsdoc_text(lines, indent_str, detailed)
    mutated_seq = mutated_class_param_names or ()
    mutated_set = set(mutated_seq)
    emitted_param_names = set()
    suffix = TypescriptBindings.MUTATED_CLASS_PARAM_SUFFIX
    for param in member.get("params", []):
      if param_names is not None and param["name"] not in param_names:
        continue
      pname = param["name"]
      desc = self._escape_jsdoc(self._normalize_link_tokens(param.get("description", "")))
      if pname in mutated_set:
        desc = (desc + " " + suffix).strip() if desc else suffix
      lines.append(f"{indent_str} * @param {pname} {desc}".rstrip())
      emitted_param_names.add(pname)
    # R5/Q4: synthesize a concise `@param` for class outputs that mutate in
    # place when upstream Doxygen omitted them. Restricted to JS-visible
    # mutated class params — elided Handle outputs and primitives without
    # docs deliberately stay silent (per the JSDoc contract table). Iterates
    # in argument order (mutated_seq is a tuple) so output is deterministic.
    for pname in mutated_seq:
      if pname in emitted_param_names:
        continue
      if param_names is not None and pname not in param_names:
        continue
      lines.append(f"{indent_str} * @param {pname} {suffix}")
      emitted_param_names.add(pname)

    ret_desc = self._escape_jsdoc(self._normalize_link_tokens(member.get("returns_description", "")))
    if envelope_descriptor and envelope_descriptor.get("has_envelope"):
      # R5: rewrite `@returns` as a multi-line envelope-fields block so the
      # tooltip surfaces every field a caller can read.
      lines.append(f"{indent_str} * @returns A result object with fields:")
      for field in envelope_descriptor.get("fields", []):
        fname = field["name"]
        kind = field["kind"]
        if kind == "return":
          field_desc = ret_desc if ret_desc else "the C++ return value"
        elif kind == "handle":
          base_desc = self._param_description(member, fname)
          field_desc = (base_desc + ", owned by the returned envelope.") if base_desc else "owned by the returned envelope."
        else:
          # Primitive / enum envelope field — placeholder param the caller
          # also passed in. Use the upstream `@param` description when present.
          base_desc = self._param_description(member, fname)
          field_desc = base_desc if base_desc else "updated value from the call."
        lines.append(f"{indent_str} * - `{fname}`: {field_desc}".rstrip())
      if envelope_descriptor.get("has_dispose"):
        lines.append(f"{indent_str} * Dispose the returned envelope to release owned Handle fields.")
    elif ret_desc:
      lines.append(f"{indent_str} * @returns {ret_desc}")
    self._emit_simplesect_tags(lines, indent_str, member)
    if member.get("deprecated"):
      lines.append(f"{indent_str} * @deprecated")
    lines.append(f"{indent_str} */")
    return "\n".join(lines) + "\n"

  def _enum_member_jsdoc(self, enum_name, member_name):
    """Emit JSDoc for an individual enum member if Doxygen docs are available.

    Emits brief, then detailed body (separated by a blank `*` line), then any
    `@remarks **Note:**`/`@remarks **Warning:**`/`@see` tags captured by
    `extract-docs.py::_extract_simplesects`. This mirrors the class/member
    JSDoc layout so enum-value tooltips are not orphaned when the original
    Doxygen brief ends in `:` and the bullets live in `<detaileddescription>`.
    """
    entry = self._docs.get(enum_name)
    if not entry or entry.get("kind") != "enum":
      return ""
    members = entry.get("members", {})
    member = members.get(member_name, {})
    brief = self._split_long_lines(self._escape_jsdoc(self._normalize_link_tokens(member.get("brief", ""))))
    detailed = self._split_long_lines(self._escape_jsdoc(self._normalize_link_tokens(member.get("detailed", ""))))
    has_simplesects = bool(member.get("notes") or member.get("warnings") or member.get("sees"))
    if not brief and not detailed and not has_simplesects:
      return ""
    indent_str = "  "
    lines = [f"{indent_str}/**"]
    if brief:
      self._emit_jsdoc_text(lines, indent_str, brief)
    if detailed:
      if brief:
        lines.append(f"{indent_str} *")
      self._emit_jsdoc_text(lines, indent_str, detailed)
    self._emit_simplesect_tags(lines, indent_str, member)
    lines.append(f"{indent_str} */")
    return "\n".join(lines) + "\n"

  @staticmethod
  def _resolve_overload(member, param_count, overload_index=0, param_names=None):
    """Select the correct overload entry when a member has multiple definitions.

    When multiple overloads share the same param_count, overload_index
    disambiguates by selecting the Nth match (0-based) among those
    with the matching arity. When param_names is provided, scores
    candidates by parameter name overlap to pick the best match.
    """
    overloads = member.get("overloads")
    if not overloads:
      return member
    if param_count is None:
      return overloads[0]
    matches = [o for o in overloads if o.get("param_count") == param_count]
    if not matches:
      if param_names:
        scored = [(o, len(set(p["name"] for p in o.get("params", [])) & set(param_names))) for o in overloads]
        scored.sort(key=lambda x: -x[1])
        if scored[0][1] > 0:
          return scored[0][0]
      return overloads[0]
    if len(matches) == 1 or not param_names:
      idx = min(overload_index, len(matches) - 1)
      return matches[idx]
    scored = [(o, len(set(p["name"] for p in o.get("params", [])) & set(param_names))) for o in matches]
    scored.sort(key=lambda x: -x[1])
    top_score = scored[0][1]
    best = [o for o, s in scored if s == top_score]
    idx = min(overload_index, len(best) - 1)
    return best[idx]

  def _findBoundAncestor(self, theClass):
    """Walk the inheritance chain to find the nearest ancestor that is in the build.
    
    When an intermediate class (e.g. GeomAdaptor_TransformedSurface) is not included
    in the build config, skip it and find the next ancestor that IS included, so the
    TypeScript `extends` clause references a declared class.
    """
    visited = set()
    current = theClass
    while current is not None:
      if current.spelling in visited:
        break
      visited.add(current.spelling)
      baseSpecs = list(filter(
        lambda x: x.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC,
        current.get_children()
      ))
      if not baseSpecs:
        break
      baseType = baseSpecs[0].type.spelling
      if any(x in baseType for x in [":", "<"]):
        break
      if baseType in self.exports:
        return baseType
      baseDef = baseSpecs[0].type.get_declaration()
      if baseDef is None or baseDef.kind == clang.cindex.CursorKind.NO_DECL_FOUND:
        return baseType
      current = baseDef
    return None

  def _computeAncestorChain(self, theClass):
    """Walk the full public inheritance chain via clang AST and return the list of
    ancestor type spellings (nearest base first).

    Captured in fragment metadata so the cross-file assembler can re-link
    `extends` clauses when an intermediate ancestor is not part of the merged
    declaration set. Stops at templated/qualified base names (as the current
    `extends` codegen does) so the chain only contains identifiers safe to emit
    verbatim.
    """
    chain = []
    visited = set()
    current = theClass
    while current is not None:
      if current.spelling in visited:
        break
      visited.add(current.spelling)
      baseSpecs = list(filter(
        lambda x: x.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC,
        current.get_children()
      ))
      if not baseSpecs:
        break
      baseType = baseSpecs[0].type.spelling
      if any(x in baseType for x in [":", "<"]):
        break
      chain.append(baseType)
      baseDef = baseSpecs[0].type.get_declaration()
      if baseDef is None or baseDef.kind == clang.cindex.CursorKind.NO_DECL_FOUND:
        break
      current = baseDef
    return chain

  def resolve_handle_type(self, clang_type):
    """Extract inner type from opencascade::handle<T> via AST inspection.
    Returns the inner type's spelling (e.g. 'Geom_Curve') or None."""
    t = clang_type
    if t.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
      t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.POINTER:
      t = t.get_pointee()
    if t.get_num_template_arguments() != 1:
      return None
    decl = t.get_declaration()
    if decl.spelling != "handle":
      return None
    parent = decl.semantic_parent
    if not parent or parent.spelling not in ("opencascade", "occ"):
      return None
    return t.get_template_argument_type(0).spelling

  def processClass(self, theClass, templateDecl = None, templateArgs = None):
    output = ""
    baseSpec = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, theClass.get_children()))
    baseClassDefinition = ""
    if len(baseSpec) > 0:
      if any(x in baseSpec[0].type.spelling for x in [":", "<"]):
        print("Unsupported character for base class \"" + baseSpec[0].type.spelling + "\" (" + theClass.spelling + ")")
      else:
        directBase = baseSpec[0].type.spelling
        if directBase in self.exports:
          baseClassDefinition = " extends " + directBase
        else:
          boundAncestor = self._findBoundAncestor(theClass)
          if boundAncestor:
            baseClassDefinition = " extends " + boundAncestor
          else:
            baseClassDefinition = " extends " + directBase

    name = getClassTypeName(theClass, templateDecl)
    tplName = theClass.spelling if templateDecl is not None else None
    output += self._jsdoc(name, template_name=tplName)
    output += "export declare class " + name + baseClassDefinition + " {\n"
    self.exports.add(name)
    ancestorChain = self._computeAncestorChain(theClass)
    if ancestorChain:
      self.ancestorChains[name] = ancestorChain

    if name == "Standard_Transient":
      output += "  /** Returns true if the underlying handle is null. */\n"
      output += "  isNull(): boolean;\n"
      output += "  /** Releases the handle, setting it to null. */\n"
      output += "  nullify(): void;\n"

    output += super().processClass(theClass, templateDecl, templateArgs)

    for child in theClass.get_children():
      if child.kind == clang.cindex.CursorKind.ENUM_DECL and child.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and child.spelling != "" and child.spelling.isidentifier():
        enumName = name + "_" + child.spelling
        output += "export type " + enumName + " = typeof " + enumName + "[keyof typeof " + enumName + "];\n"
        output += self._jsdoc(enumName)
        output += "export declare const " + enumName + ": {\n"
        for enumChild in list(child.get_children()):
          if enumChild.kind == clang.cindex.CursorKind.ENUM_CONSTANT_DECL:
            if not enumChild.spelling or not enumChild.spelling.isidentifier():
              # Skip non-identifier enumerators (anon helpers, macro-mangled names)
              # so the resulting enum body parses as valid TypeScript.
              continue
            output += self._enum_member_jsdoc(enumName, enumChild.spelling)
            output += "  readonly " + enumChild.spelling + ": '" + enumChild.spelling + "';\n"
        output += "};\n\n"
        self.exports.add(enumName)

      if child.kind == clang.cindex.CursorKind.STRUCT_DECL and child.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and child.spelling != "" and child.spelling.isidentifier():
        fields = [f for f in child.get_children() if f.kind == clang.cindex.CursorKind.FIELD_DECL]
        non_field_members = [f for f in child.get_children() if f.kind not in (
          clang.cindex.CursorKind.FIELD_DECL,
          clang.cindex.CursorKind.CXX_ACCESS_SPEC_DECL,
          clang.cindex.CursorKind.CONSTRUCTOR,
          clang.cindex.CursorKind.DESTRUCTOR,
        )]
        if fields and not non_field_members:
          structName = name + "_" + child.spelling
          if structName in TypescriptBindings._emitted_stub_names:
            continue
          output += "export interface " + structName + " {\n"
          for field in fields:
            fieldType = self.resolve_type(field.type, templateDecl, templateArgs)
            output += "  " + field.spelling + ": " + fieldType + ";\n"
          output += "}\n\n"
          # Nested-struct interfaces are TYPE-ONLY (no JS runtime value).
          # Tracking them in `_emitted_stub_names` keeps them out of
          # `self.exports`, preventing the OpenCascadeInstance aggregate from
          # emitting `structName: typeof structName` (TS2693).
          TypescriptBindings._emitted_stub_names.add(structName)

    return output

  def processFinalizeClass(self):
    output = ""
    output += "  /** Releases the C++ object. The caller must ensure no further access. */\n"
    output += "  delete(): void;\n"
    output += "  [Symbol.dispose](): void;\n"
    output += "}\n\n"

    for iface_name in sorted(TypescriptBindings._namespace_scoped_interfaces):
      if iface_name in self.exports or iface_name in TypescriptBindings._emitted_stub_names:
        continue
      # Emit `unknown` aliases for namespace-scoped forward declarations
      # rather than empty `interface X {}` stubs. Empty interfaces structurally
      # match every value, masking missing decls; `unknown` forces explicit
      # narrowing at consumer sites.
      #
      # Stubs are TYPE-ONLY (no runtime value), so they must NOT be added to
      # self.exports — that would surface them in the OpenCascadeInstance
      # aggregate as `: typeof X`, triggering TS2693.
      output += "export type " + iface_name + " = unknown;\n\n"
      TypescriptBindings._emitted_stub_names.add(iface_name)
    TypescriptBindings._namespace_scoped_interfaces = set()

    return output

  def _emitTsConstructor(self, className, args, templateDecl, templateArgs, tplName, numOptional=0, overload_index=0):
    """Emit a single TypeScript constructor signature, marking trailing args as optional."""
    parts = []
    names = []
    nArgs = len(args)
    for i, arg in enumerate(args):
      name = self._argname(arg, i)
      names.append(name)
      typeName = self.resolve_type(arg.type, templateDecl, templateArgs)
      if i >= nArgs - numOptional:
        parts.append(f"{name}?: {typeName}")
      else:
        parts.append(f"{name}: {typeName}")
    argsStr = ", ".join(parts)
    output = self._jsdoc(className, className, "  ", param_count=nArgs, overload_index=overload_index, template_name=tplName, param_names=names)
    output += f"  constructor({argsStr});\n"
    return output

  def processSimpleConstructor(self, theClass, templateDecl = None, templateArgs = None):
    output = ""
    children = list(theClass.get_children())
    constructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR, children))
    className = getClassTypeName(theClass, templateDecl)
    tplName = theClass.spelling if templateDecl is not None else None

    if len(constructors) == 0:
      output += self._jsdoc(className, className, "  ", param_count=0, template_name=tplName, param_names=[])
      output += "  constructor();\n"
      return output
    publicConstructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, children))
    if len(publicConstructors) == 0:
      return output

    # Apply safe filtering
    filtered = self._filter_overloads(publicConstructors)
    filtered = [c for c in filtered if filterMethodOrProperty(theClass, c)]
    bindable = []
    for c in filtered:
      try:
        self._checkUnbindableArgs("constructor", theClass.spelling, list(c.get_arguments()))
        bindable.append(c)
      except SkipException as e:
        print(str(e))

    if len(bindable) == 0:
      return output

    if len(bindable) == 1:
      args = list(bindable[0].get_arguments())
      nDefaults = self._countTrailingDefaults(bindable[0])
      output += self._emitTsConstructor(className, args, templateDecl, templateArgs, tplName, numOptional=nDefaults)
      return output

    # Group by arity — emit overloaded constructor() signatures for all distinguishable overloads
    by_arity = defaultdict(list)
    for c in bindable:
      by_arity[len(list(c.get_arguments()))].append(c)

    # Merge default expansions into by_arity (collisions handled by dispatch)
    for c in bindable:
      nDefaults = self._countTrailingDefaults(c)
      nArgs = len(list(c.get_arguments()))
      for d in range(1, nDefaults + 1):
        trunc_arity = nArgs - d
        by_arity[trunc_arity].append(c)

    arity_idx_map = {}
    for arity, group in sorted(by_arity.items()):
      seen_ids = set()
      deduped = []
      for c in group:
        if id(c) not in seen_ids:
          seen_ids.add(id(c))
          deduped.append(c)
      group = deduped

      if len(group) == 1:
        c = group[0]
        actual_args = list(c.get_arguments())
        nDefaults = self._countTrailingDefaults(c)
        actual_arity = len(actual_args)
        trailing_optional = actual_arity - arity if actual_arity > arity else nDefaults
        idx = arity_idx_map.get(arity, 0)
        arity_idx_map[arity] = idx + 1
        output += self._emitTsConstructor(className, actual_args[:arity] if actual_arity > arity else actual_args, templateDecl, templateArgs, tplName, numOptional=trailing_optional if actual_arity == arity else 0, overload_index=idx)
      else:
        tree = self._build_dispatch_tree(group, available_positions=list(range(arity)), templateDecl=templateDecl, templateArgs=templateArgs)
        ambiguous = self._collect_ambiguous_overloads(tree)
        distinguishable = [ov for ov in group if ov not in ambiguous]
        for ov in distinguishable:
          actual_args = list(ov.get_arguments())
          idx = arity_idx_map.get(arity, 0)
          arity_idx_map[arity] = idx + 1
          output += self._emitTsConstructor(className, actual_args[:arity], templateDecl, templateArgs, tplName, overload_index=idx)

    return output

  _NUMERIC_TYPES = frozenset({
    "int", "int8_t", "int16_t", "int32_t", "int64_t",
    "unsigned", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
    "unsigned int", "unsigned long",
    "long", "long int", "long long",
    "unsigned long long", "unsigned short",
    "short", "short int",
    "float", "double", "long double",
    "size_t", "ptrdiff_t", "ssize_t",
    "intptr_t", "uintptr_t", "__SIZE_TYPE__",
    "Standard_Integer", "Standard_Real",
    "Standard_ShortReal", "Standard_Size",
    "Standard_Byte",
  })

  _STRING_TYPES = frozenset({
    "char", "unsigned char",
    "wchar_t", "char8_t", "char16_t", "char32_t",
    "std::string", "std::string_view",
    "Standard_Character", "Standard_ExtCharacter",
    "Standard_CString", "Standard_WideChar",
    "Standard_PCharacter",
  })

  _BOOLEAN_TYPES = frozenset({
    "bool", "Standard_Boolean",
  })

  def convertBuiltinTypes(self, typeName):
    if typeName in self._NUMERIC_TYPES:
      return "number"

    if typeName in self._STRING_TYPES:
      return "string"

    if typeName in self._BOOLEAN_TYPES:
      return "boolean"

    if typeName in ("Standard_SStream",):
      return "string"

    return typeName

  _namespace_scoped_interfaces = set()
  # Track stub aliases emitted across all class instances so each
  # forward-declared name is declared exactly once in the final .d.ts. Without
  # this, every class that references the type re-emits it, triggering TS2300.
  _emitted_stub_names = set()

  def _resolve_nested_type(self, decl):
    """Resolve nested C++ types (enum/class/struct inside a class or namespace) to Parent_Child format."""
    if not decl or decl.spelling == "":
      return None
    if decl.kind not in (clang.cindex.CursorKind.ENUM_DECL, clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
      return None
    parent = decl.semantic_parent
    if not parent:
      return None
    if parent.kind in (clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
      return parent.spelling + "_" + decl.spelling
    if parent.kind == clang.cindex.CursorKind.NAMESPACE:
      resolved = parent.spelling + "_" + decl.spelling
      TypescriptBindings._namespace_scoped_interfaces.add(resolved)
      return resolved
    return None

  def _resolve_qualified_member_type(self, resolved, templateDecl=None, templateArgs=None):
    """Resolve a qualified type like 'typename ConcreteClass::Point' after template substitution.

    Walks the class hierarchy to find member typedefs inherited from base classes.
    """
    clean = resolved.replace("typename ", "").strip()
    clean = re.sub(r'\bconst\b', '', clean).replace("&", "").replace("*", "").strip()
    if "::" not in clean:
      return None
    parts = clean.rsplit("::", 1)
    if len(parts) != 2:
      return None
    parent_name, member_name = parts[0].strip(), parts[1].strip()
    if not parent_name or not member_name:
      return None

    combined = parent_name + "_" + member_name
    if combined in self.exports or combined in TypescriptBindings._known_export_names:
      return combined

    class_cursor = self.tuInfo.classDict.get(parent_name)
    if not class_cursor:
      return None

    visited = set()
    queue = [class_cursor]
    while queue:
      cls = queue.pop(0)
      cls_id = cls.spelling
      if cls_id in visited:
        continue
      visited.add(cls_id)

      for child in cls.get_children():
        if child.kind in (clang.cindex.CursorKind.TYPEDEF_DECL, clang.cindex.CursorKind.TYPE_ALIAS_DECL):
          if child.spelling == member_name:
            underlying = child.underlying_typedef_type
            return self.resolve_type(underlying, templateDecl, templateArgs)
        if child.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER:
          base_decl = child.get_definition()
          if base_decl and base_decl.spelling:
            queue.append(base_decl)
            base_from_dict = self.tuInfo.classDict.get(base_decl.spelling)
            if base_from_dict:
              queue.append(base_from_dict)

    return None

  _CONST_RE = re.compile(r'\bconst\b')

  @staticmethod
  def _strip_type_qualifiers_str(spelling):
    """Strip const, &, and * from a type spelling using word boundaries for const."""
    s = TypescriptBindings._CONST_RE.sub('', spelling)
    return s.replace("&", "").replace("*", "").strip()

  def _strip_qualifiers(self, clang_type):
    """Strip const, reference, and pointer qualifiers via AST traversal."""
    t = clang_type
    if t.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
      t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.RVALUEREFERENCE:
      t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.POINTER:
      t = t.get_pointee()
    return t

  _any_reasons = {}
  _known_export_names = set()
  _CONTAINER_ALIASES = {
    "NCollection_Vector": "NCollection_DynamicArray",
  }

  @classmethod
  def prepare_known_exports(cls, tuInfo, filter_classes_fn, filter_templates_fn):
    """Pre-compute the global set of known export names for O(1) fallback lookups.

    Also eagerly seeds `_known_typedef_names` so the resolve_type early-return
    guard has a complete validation set on first call.
    """
    cls._known_export_names = set()
    for child in tuInfo.allChildren:
      if filter_classes_fn(child, False) and child.spelling:
        cls._known_export_names.add(child.spelling)
    for td in tuInfo.templateTypedefs:
      if td.spelling:
        cls._known_export_names.add(td.spelling)
    for enumDecl in getattr(tuInfo, "enums", []):
      if enumDecl.spelling:
        cls._known_export_names.add(enumDecl.spelling)

    cls._known_typedef_names = set()
    for td in tuInfo.typedefs:
      if td.spelling:
        cls._known_typedef_names.add(td.spelling)
    for td in tuInfo.templateTypedefs:
      if td.spelling:
        cls._known_typedef_names.add(td.spelling)

  def _collect_any(self, reason, type_spelling):
    """Collect any-type resolution failures for reporting."""
    if reason not in TypescriptBindings._any_reasons:
      TypescriptBindings._any_reasons[reason] = {}
    bucket = TypescriptBindings._any_reasons[reason]
    bucket[type_spelling] = bucket.get(type_spelling, 0) + 1

  def _is_known_export_name(self, name):
    """O(1) lookup: is `name` an emitted TS export the consumer can actually resolve?

    Used by `resolve_type` early-return guard to avoid emitting unbound symbols.
    Falls through to canonical-fallback path when this returns False so the codegen
    keeps trying further resolution strategies before resorting to `unknown`.

    Note: typedef names are *deliberately* excluded — a typedef like `XCAFDoc_PartId`
    aliases `TCollection_AsciiString` but is not itself emitted as an `export`. Returning
    the typedef name produces TS2304 dangling references; we want callers to fall through
    to the canonical class spelling instead.
    """
    if not name:
      return False
    if name in self.exports:
      return True
    if name in TypescriptBindings._known_export_names:
      return True
    return False

  _reverse_typedef_cache = None

  def _find_typedef_for_container(self, container, clang_type):
    """Look up whether a C++ type has a typedef or using-alias in the AST.

    Builds a reverse cache from both typedefUnderlyingDict and
    templateTypedefUnderlyingDict, mapping underlying type spellings
    to their alias names. Returns the alias name if found, else None.
    """
    if TypescriptBindings._reverse_typedef_cache is None:
      candidates = {}
      # Collect *all* aliases for each underlying type so the priority
      # function below can pick the OCCT-public name (TColStd_*, TColgp_*, …)
      # over the generic NCollection_<TemplateInst>_<T> spelling.
      for src in (
        self.tuInfo.typedefUnderlyingMultimap,
        self.tuInfo.templateTypedefUnderlyingMultimap,
      ):
        for underlying_spelling, typedef_cursors in src.items():
          clean = _normalize_handle_ns(underlying_spelling.replace("const ", "").replace("&", "").strip())
          for typedef_cursor in typedef_cursors:
            if typedef_cursor.spelling not in candidates.get(clean, []):
              candidates.setdefault(clean, []).append(typedef_cursor.spelling)

      def _alias_priority(name):
        # Deterministic typedef selection.
        # 1. Exported names win (consumer-facing surface area).
        # 2. OCCT-domain aliases (TColStd_/TColgp_/TopTools_/MeshVS_/XCAFDoc_/...)
        #    win over generic NCollection_<TemplateInst>_<T> spellings — domain
        #    aliases are the documented public API surface.
        # 3. NCollection_ aliases win over everything else (still public).
        # 4. Alphabetical tiebreaker for reproducible builds across libclang versions.
        in_exports = 0 if name in self.exports or name in TypescriptBindings._known_export_names else 1
        if re.match(
          r"^(TColStd_|TColgp_|TopTools_|MeshVS_|XCAFDoc_|TDataStd_|TDF_|TopoDS_|Geom_|GeomAdaptor_|gp_)",
          name,
        ):
          alias_tier = 0
        elif re.match(r"^NCollection_", name):
          alias_tier = 1
        else:
          alias_tier = 2
        return (in_exports, alias_tier, name)

      TypescriptBindings._reverse_typedef_cache = {
        clean: sorted(names, key=_alias_priority)[0]
        for clean, names in candidates.items()
      }

    type_spelling = _normalize_handle_ns(clang_type.spelling.replace("const ", "").replace("&", "").replace("*", "").strip())
    result = TypescriptBindings._reverse_typedef_cache.get(type_spelling)
    if result:
      return result

    numArgs = clang_type.get_num_template_arguments()
    if numArgs > 0 and "<>" in type_spelling:
      arg_spellings = []
      for i in range(numArgs):
        arg_type = clang_type.get_template_argument_type(i)
        arg_spelling = arg_type.spelling if arg_type.spelling else arg_type.get_canonical().spelling
        arg_spellings.append(_normalize_handle_ns(arg_spelling))
      reconstructed = container + "<" + ", ".join(arg_spellings) + ">"
      result = TypescriptBindings._reverse_typedef_cache.get(reconstructed)
      if result:
        return result

    return None

  _VEC_TUPLES = {
    "NCollection_Vec2": "[number, number]",
    "NCollection_Vec3": "[number, number, number]",
    "NCollection_Vec4": "[number, number, number, number]",
  }

  _known_typedef_names = None

  def _resolve_template_type(self, clang_type, templateDecl=None, templateArgs=None):
    """Resolve template types via AST using generic C++ type resolution.

    Resolution order:
    1. Check original declaration spelling against known typedefs (catches using-aliases)
    2. Canonicalize if needed, then resolve via:
       a. handle<T> unwrapping (smart pointer)
       b. Vec tuple mapping (fixed-arity numeric vectors)
       c. Template class itself is exported or a known typedef name
       d. STL type mappings
       e. General typedef/using-alias lookup (resolves ALL container types)
    3. Generic guardrail: collect unrecognized template types
    """
    if TypescriptBindings._known_typedef_names is None:
      TypescriptBindings._known_typedef_names = set()
      for td in self.tuInfo.typedefs:
        TypescriptBindings._known_typedef_names.add(td.spelling)
      for td in self.tuInfo.templateTypedefs:
        TypescriptBindings._known_typedef_names.add(td.spelling)

    t = clang_type
    numArgs = t.get_num_template_arguments()
    if numArgs <= 0:
      orig_decl = clang_type.get_declaration()
      if orig_decl and orig_decl.spelling:
        # Typedefs whose canonical type is a builtin primitive must NOT be
        # returned verbatim — `size_t`, `uint8_t`, `Standard_Real`, etc. all
        # resolve to numeric/string TS types via the downstream builtin path.
        canonical_kind = clang_type.get_canonical().kind
        is_primitive_typedef = (
          canonical_kind in self._BUILTIN_NUMERIC_KINDS
          or canonical_kind in self._BUILTIN_STRING_KINDS
          or canonical_kind == clang.cindex.TypeKind.BOOL
          or canonical_kind == clang.cindex.TypeKind.VOID
          or orig_decl.spelling in self._NUMERIC_TYPES
          or orig_decl.spelling in self._STRING_TYPES
          or orig_decl.spelling in self._BOOLEAN_TYPES
        )
        if not is_primitive_typedef:
          if orig_decl.spelling in self.exports:
            return orig_decl.spelling
          # Do NOT return a typedef name that isn't actually emitted as an
          # export — that produces a dangling reference (TS2304). Fall through
          # to the canonical type so unbound typedefs resolve to the underlying
          # class (e.g. `XCAFDoc_PartId` → `TCollection_AsciiString`).
      t = clang_type.get_canonical()
      numArgs = t.get_num_template_arguments()
      if numArgs <= 0:
        return None

    decl = t.get_declaration()
    if not decl:
      return None
    container = self._CONTAINER_ALIASES.get(decl.spelling, decl.spelling)

    if container not in self.exports and container not in self._VEC_TUPLES and container != "handle":
      if decl.kind in (clang.cindex.CursorKind.TYPEDEF_DECL, clang.cindex.CursorKind.TYPE_ALIAS_DECL):
        canonical_t = t.get_canonical()
        canonical_decl = canonical_t.get_declaration()
        if canonical_decl and canonical_decl.spelling and canonical_decl.spelling != container:
          container = self._CONTAINER_ALIASES.get(canonical_decl.spelling, canonical_decl.spelling)
          t = canonical_t

    parent = decl.semantic_parent
    if container == "handle" and parent and parent.spelling in ("opencascade", "occ"):
      inner = t.get_template_argument_type(0)
      if inner.spelling:
        return self.resolve_type(inner, templateDecl, templateArgs)
      canonical_inner = inner.get_canonical()
      if canonical_inner.spelling:
        return self.resolve_type(canonical_inner, templateDecl, templateArgs)
      decl_inner = inner.get_declaration()
      if decl_inner and decl_inner.spelling and decl_inner.spelling in self.exports:
        return decl_inner.spelling
      self._collect_any("handle_inner_unresolvable", t.spelling)
      return "any"

    if container in self._VEC_TUPLES:
      return self._VEC_TUPLES[container]

    # Only return container if it actually appears as an emitted export.
    # Typedef names like `XCAFDoc_PartId` (alias for TCollection_AsciiString)
    # are NOT emitted, so returning them produces TS2304 dangling references.
    # Fall through to the canonical-fallback resolution path instead.
    if container in self.exports or container in TypescriptBindings._known_export_names:
      return container

    stl_result = self._resolve_stl_type(container, t, templateDecl, templateArgs)
    if stl_result is not None:
      return stl_result

    typedef_name = self._find_typedef_for_container(container, t)
    if typedef_name:
      return typedef_name

    numArgs_resolve = t.get_num_template_arguments()
    if numArgs_resolve > 0:
      resolved_args = []
      all_resolved = True
      for i in range(numArgs_resolve):
        arg_type = t.get_template_argument_type(i)
        arg_spelling = arg_type.spelling if arg_type else ""
        arg_canonical = arg_type.get_canonical().spelling if arg_type else ""
        if not arg_type or (not arg_spelling and not arg_canonical):
          all_resolved = False
          break
        resolved_arg = self._resolve_template_arg(arg_type, templateDecl, templateArgs)
        if not resolved_arg or resolved_arg == "any" or "type-parameter-" in resolved_arg:
          all_resolved = False
          break
        resolved_args.append(resolved_arg)
      if all_resolved and resolved_args:
        mangled = container + "_" + "_".join(resolved_args)
        if mangled in self.exports or mangled in TypescriptBindings._known_export_names:
          return mangled

    self._collect_any("unrecognized_template", t.spelling)
    return "any"

  @staticmethod
  def _is_std_decl(decl):
    """Check if a declaration is within the std namespace (handles std::__1, std::__cxx11, etc.)."""
    parent = decl.semantic_parent
    while parent:
      if parent.spelling == "std":
        return True
      if parent.kind != clang.cindex.CursorKind.NAMESPACE:
        break
      parent = parent.semantic_parent
    return False

  def _resolve_template_arg(self, arg_type, templateDecl=None, templateArgs=None):
    """Resolve a single template argument type, handling type-parameter-N-M substitution."""
    canonical = arg_type.get_canonical()
    spelling = canonical.spelling if canonical.spelling else arg_type.spelling
    if not spelling:
      spelling = arg_type.spelling
    if templateArgs and spelling and "type-parameter-" in spelling:
      if Bindings._TYPE_PARAM_RE is None:
        Bindings._TYPE_PARAM_RE = re.compile(r'type-parameter-(\d+)-(\d+)')
      m = Bindings._TYPE_PARAM_RE.search(spelling)
      if m:
        depth, index = int(m.group(1)), int(m.group(2))
        if depth == 0:
          argValues = list(templateArgs.values())
          if index < len(argValues):
            concrete = argValues[index]
            resolved = self.resolve_type(concrete, templateDecl, templateArgs)
            if resolved and resolved != "any":
              return resolved
    result = self.resolve_type(arg_type, templateDecl, templateArgs)
    if result and result != "any" and "type-parameter-" not in result:
      return result
    return None

  def _resolve_stl_type(self, container, clang_type, templateDecl=None, templateArgs=None):
    """Resolve standard library template types to TypeScript equivalents."""
    t = clang_type
    numArgs = t.get_num_template_arguments()

    if container == "shared_ptr":
      if self._is_std_decl(t.get_declaration()) and numArgs >= 1:
        inner = t.get_template_argument_type(0)
        return self.resolve_type(inner, templateDecl, templateArgs)

    if container == "vector":
      if self._is_std_decl(t.get_declaration()) and numArgs >= 1:
        inner = self.resolve_type(t.get_template_argument_type(0), templateDecl, templateArgs)
        return f"{inner}[]"

    if container == "NCollection_LinearVector":
      if numArgs >= 1:
        inner = self.resolve_type(t.get_template_argument_type(0), templateDecl, templateArgs)
        return f"{inner}[]"

    if container == "initializer_list":
      if numArgs >= 1:
        inner = self.resolve_type(t.get_template_argument_type(0), templateDecl, templateArgs)
        return f"{inner}[]"
      return "any[]"

    if container == "pair":
      if numArgs >= 2:
        t0 = self.resolve_type(t.get_template_argument_type(0), templateDecl, templateArgs)
        t1 = self.resolve_type(t.get_template_argument_type(1), templateDecl, templateArgs)
        return f"[{t0}, {t1}]"

    if container == "optional":
      if numArgs >= 1:
        inner = self.resolve_type(t.get_template_argument_type(0), templateDecl, templateArgs)
        return f"{inner} | undefined"

    if container == "array":
      decl = t.get_declaration()
      if self._is_std_decl(decl) and numArgs >= 1:
        inner = self.resolve_type(t.get_template_argument_type(0), templateDecl, templateArgs)
        if decl.get_num_template_arguments() >= 2:
          arg_kind = decl.get_template_argument_kind(1)
          if arg_kind == clang.cindex.TemplateArgumentKind.INTEGRAL:
            n = decl.get_template_argument_value(1)
            if 1 <= n <= 16:
              return "[" + ", ".join([inner] * n) + "]"
        import re
        m = re.search(r',\s*(\d+)\s*>$', t.spelling)
        if m:
          n = int(m.group(1))
          if 1 <= n <= 16:
            return "[" + ", ".join([inner] * n) + "]"
        return f"{inner}[]"

    if container in ("basic_string_view", "string_view", "u16string_view"):
      return "string"

    if container in ("basic_string",):
      return "string"

    if container in ("NCollection_UtfString",):
      return "string"

    return None

  _BUILTIN_NUMERIC_KINDS = frozenset({
    clang.cindex.TypeKind.INT, clang.cindex.TypeKind.UINT,
    clang.cindex.TypeKind.LONG, clang.cindex.TypeKind.ULONG,
    clang.cindex.TypeKind.LONGLONG, clang.cindex.TypeKind.ULONGLONG,
    clang.cindex.TypeKind.SHORT, clang.cindex.TypeKind.USHORT,
    clang.cindex.TypeKind.FLOAT, clang.cindex.TypeKind.DOUBLE,
    clang.cindex.TypeKind.LONGDOUBLE,
  })

  _BUILTIN_STRING_KINDS = frozenset({
    clang.cindex.TypeKind.CHAR_U, clang.cindex.TypeKind.UCHAR,
    clang.cindex.TypeKind.CHAR16, clang.cindex.TypeKind.CHAR32,
    clang.cindex.TypeKind.CHAR_S, clang.cindex.TypeKind.SCHAR,
  })

  def _resolve_handle_recursive(self, clang_type, templateDecl=None, templateArgs=None):
    """Unwrap handle<T> and recursively resolve the inner type via AST.

    Also accepts `Handle_*` typedefs that alias `opencascade::handle<T>`.
    OCCT defines DEFINE_STANDARD_HANDLE which generates `typedef Handle_Foo`
    aliases that callers use interchangeably with `Handle(Foo)` /
    `opencascade::handle<Foo>`. Without this branch the typedef form falls into
    the unbound-reference fallback and emits `unknown`.
    """
    t = clang_type
    if t.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
      t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.POINTER:
      t = t.get_pointee()

    decl = t.get_declaration()
    if decl and decl.spelling and re.match(r"^Handle_[A-Z]", decl.spelling):
      canonical = t.get_canonical()
      if canonical.get_num_template_arguments() == 1:
        canonical_decl = canonical.get_declaration()
        if (
          canonical_decl
          and canonical_decl.spelling == "handle"
          and canonical_decl.semantic_parent
          and canonical_decl.semantic_parent.spelling in ("opencascade", "occ")
        ):
          inner_type = canonical.get_template_argument_type(0)
          return self.resolve_type(inner_type, templateDecl, templateArgs)

    if t.get_num_template_arguments() != 1:
      return None
    if decl.spelling != "handle":
      return None
    parent = decl.semantic_parent
    if not parent or parent.spelling not in ("opencascade", "occ"):
      return None
    inner_type = t.get_template_argument_type(0)
    return self.resolve_type(inner_type, templateDecl, templateArgs)

  def resolve_type(self, clang_type, templateDecl=None, templateArgs=None):
    """Resolve a clang type to its TypeScript equivalent using AST-first analysis.

    Resolution order:
    1. Handle<T> unwrapping via AST (recursive)
    2. Strip const/ref/ptr qualifiers via AST
    3. Template type resolution via AST
    4. Nested type (enum/class inside class) resolution
    5. Builtin type mapping via AST TypeKind
    6. Canonical fallback for template member typedefs
    7. Declaration spelling lookup in exports
    """
    handleInner = self._resolve_handle_recursive(clang_type, templateDecl, templateArgs)
    if handleInner:
      return handleInner

    t = self._strip_qualifiers(clang_type)

    # Detect C-arrays *before* the template/canonical resolution paths so
    # `gp_XYZ (&)[3]` becomes a fixed-size tuple rather than `gp_XYZ[3]`
    # (which would parse as element-access syntax in TypeScript).
    if t.kind in (
      clang.cindex.TypeKind.CONSTANTARRAY,
      clang.cindex.TypeKind.INCOMPLETEARRAY,
      clang.cindex.TypeKind.VARIABLEARRAY,
    ):
      element_type = t.get_array_element_type()
      element_ts = self.resolve_type(element_type, templateDecl, templateArgs)
      element_count = t.get_array_size() if t.kind == clang.cindex.TypeKind.CONSTANTARRAY else -1
      if 1 <= element_count <= 16:
        return "[" + ", ".join([element_ts] * element_count) + "]"
      return f"{element_ts}[]"

    handleInner = self._resolve_handle_recursive(t, templateDecl, templateArgs)
    if handleInner:
      return handleInner

    template_result = self._resolve_template_type(t, templateDecl, templateArgs)
    if template_result is not None:
      return template_result

    decl = t.get_declaration()
    nested = self._resolve_nested_type(decl)
    if nested:
      return nested

    canonical = t.get_canonical()
    kind = canonical.kind

    pre_canonical_spelling = self._strip_type_qualifiers_str(t.spelling)
    if pre_canonical_spelling in self._NUMERIC_TYPES:
      return "number"
    if pre_canonical_spelling in self._BOOLEAN_TYPES:
      return "boolean"

    if kind in self._BUILTIN_NUMERIC_KINDS:
      return "number"
    if kind in self._BUILTIN_STRING_KINDS:
      return "string"
    if kind == clang.cindex.TypeKind.BOOL:
      return "boolean"
    if kind == clang.cindex.TypeKind.VOID:
      return "void"

    if (
      kind == clang.cindex.TypeKind.CONSTANTARRAY
      or kind == clang.cindex.TypeKind.INCOMPLETEARRAY
      or kind == clang.cindex.TypeKind.VARIABLEARRAY
    ):
      element_type = canonical.get_array_element_type()
      element_ts = self.resolve_type(element_type, templateDecl, templateArgs)
      element_count = canonical.get_array_size() if kind == clang.cindex.TypeKind.CONSTANTARRAY else -1
      if 1 <= element_count <= 16:
        return "[" + ", ".join([element_ts] * element_count) + "]"
      return f"{element_ts}[]"

    spelling = self._strip_type_qualifiers_str(t.spelling)
    resolved = self.resolveWithCanonicalFallback(spelling, t, templateDecl, templateArgs)
    resolved = self._strip_type_qualifiers_str(resolved)
    resolved = self.convertBuiltinTypes(resolved)

    if resolved in ("number", "string", "boolean", "void"):
      return resolved
    if (
      resolved
      and resolved != ""
      and "(" not in resolved
      and ":" not in resolved
      and "<" not in resolved
      and "[" not in resolved
      and self._is_known_export_name(resolved)
    ):
      return resolved

    if resolved and "::" in resolved and "(" not in resolved:
      member_result = self._resolve_qualified_member_type(resolved, templateDecl, templateArgs)
      if member_result:
        return member_result

    canonical_spelling = self._strip_type_qualifiers_str(canonical.spelling)
    canonical_spelling = self.convertBuiltinTypes(canonical_spelling)
    if canonical_spelling in ("number", "string", "boolean", "void"):
      return canonical_spelling
    if canonical_spelling and "(" not in canonical_spelling and ":" not in canonical_spelling and "<" not in canonical_spelling:
      if canonical_spelling in self.exports or canonical_spelling in TypescriptBindings._known_export_names:
        return canonical_spelling

    if decl and decl.spelling and (decl.spelling in self.exports or decl.spelling in TypescriptBindings._known_export_names):
      return decl.spelling

    self._collect_any("unbound_reference", f"{t.spelling} (canonical: {canonical.spelling})")
    return "unknown"

  def getTypescriptDefFromResultType(self, res, templateDecl = None, templateArgs = None):
    if res.spelling == "void":
      return "void"
    return self.resolve_type(res, templateDecl, templateArgs)

  _TS_RESERVED_WORDS = frozenset({
    "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "enum", "export", "extends", "false",
    "finally", "for", "function", "if", "import", "in", "instanceof", "new",
    "null", "return", "super", "switch", "this", "throw", "true", "try",
    "typeof", "var", "void", "while", "with",
    "as", "implements", "interface", "let", "package", "private", "protected",
    "public", "static", "yield", "any", "boolean", "constructor", "declare",
    "get", "module", "require", "number", "set", "string", "symbol", "type",
    "from", "of", "namespace", "async", "await",
  })

  def _argname(self, arg, suffix = ""):
    argname = (arg.spelling if not arg.spelling == "" else ("a" + str(suffix)))
    if argname in TypescriptBindings._TS_RESERVED_WORDS:
      argname += "_"
    return argname

  def getTypescriptDefFromArg(self, arg, suffix = "", templateDecl = None, templateArgs = None):
    typeName = self.resolve_type(arg.type, templateDecl, templateArgs)
    return self._argname(arg, suffix) + ": " + typeName

  def _render_synthesized_base_signature(self, method, className, tplName):
    """Render a TS overload signature for a base-class method synthesized into
    a derived class to satisfy the structural override contract.

    Emitted independently of the normal overload pipeline because the cursor
    does not belong to `theClass.get_children()` — `getMethodOverloadPostfix`
    would crash on it.

    Uses the same RBV emission path as direct methods so synthesized base
    overloads keep their (optional-input, RBV-return) shape — without this
    the base would emit `Show(theUserSec?: number): {theUserSec: number}`
    while the derived's synthesized copy would emit `Show(theUserSec: number): void`,
    tripping TS2416 override variance.
    """
    try:
      allArgs = list(method.get_arguments())
      outputReturnType = self._buildOutputParamReturnType(method, allArgs, None, None, theClass=None)
      if outputReturnType is not None:
        args = self._buildKeptArgs(method, allArgs, None, None)
        returnType = outputReturnType
      else:
        args = ", ".join(
          self.getTypescriptDefFromArg(arg, i, None, None)
          for i, arg in enumerate(allArgs)
        )
        returnType = self.getTypescriptDefFromResultType(method.result_type, None, None)
    except Exception:
      return ""
    kept_names = [self._argname(arg, i) for i, arg in enumerate(allArgs)
                  if not shouldStripParam(arg.type, method)]
    mutated_names = self._mutatedClassParamNames(method, allArgs)
    envelope = self._describeEnvelope(method, allArgs, None, None, theClass=None)
    out = self._jsdoc(className, method.spelling, "  ", param_count=len(allArgs), overload_index=0, template_name=tplName, param_names=kept_names, mutated_class_param_names=mutated_names, envelope_descriptor=envelope)
    out += "  " + ("static " if method.is_static_method() else "") + method.spelling + "(" + args + "): " + returnType + ";\n"
    return out

  def _missing_base_overloads(self, theClass, methods):
    """Append base-class overloads of the same name that the derived class
    does not redeclare.

    TypeScript class methods must be structurally assignable to the base. When
    the base has overloads `SetID(g)` and `SetID()` and the derived only
    redeclares `SetID(g)`, TS reports the no-arg overload as unsatisfied. We
    walk overridden cursors → base classes → find every `SetID` declaration on
    the base and pull in the ones whose arity (and stripped-output param shape)
    is not represented in the derived.
    """
    if not methods:
      return methods

    name = methods[0].spelling

    def _arity_signature(m):
      try:
        args = list(m.get_arguments())
      except Exception:
        return None
      kept = [a for a in args if not shouldStripParam(a.type, m)]
      return (len(kept), tuple(a.type.get_canonical().spelling for a in kept))

    derived_signatures = set()
    for m in methods:
      sig = _arity_signature(m)
      if sig is not None:
        derived_signatures.add((m.is_static_method(),) + sig)

    # Walk the inheritance chain — Python libclang doesn't expose
    # clang_getOverriddenCursors, so we traverse base specifiers manually.
    base_overloads = []
    seen_base_ids = set()
    visited_classes = set()

    def _walk_bases(cls):
      if cls is None:
        return
      key = cls.spelling
      if key in visited_classes:
        return
      visited_classes.add(key)
      for child in cls.get_children():
        if child.kind != clang.cindex.CursorKind.CXX_BASE_SPECIFIER:
          continue
        if child.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
          continue
        base_decl = child.type.get_declaration()
        if base_decl is None or base_decl.kind == clang.cindex.CursorKind.NO_DECL_FOUND:
          continue
        for sibling in base_decl.get_children():
          if sibling.kind != clang.cindex.CursorKind.CXX_METHOD:
            continue
          if sibling.spelling != name:
            continue
          if sibling.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
            continue
          if any(
            a.type.kind == clang.cindex.TypeKind.RVALUEREFERENCE
            for a in sibling.get_arguments()
          ):
            continue
          sig = _arity_signature(sibling)
          # Differentiate static vs. instance overloads — TS static and
          # instance sides are checked independently (TS2417 vs. TS2416).
          sig = (sibling.is_static_method(),) + sig
          if sig is None or sig in derived_signatures:
            continue
          loc_file = sibling.location.file.name if sibling.location.file else ""
          loc_key = (loc_file, sibling.location.line, sibling.location.column)
          if loc_key in seen_base_ids:
            continue
          seen_base_ids.add(loc_key)
          derived_signatures.add(sig)
          base_overloads.append(sibling)
        _walk_bases(base_decl)

    _walk_bases(theClass)
    return base_overloads

  def _outputArgIsEmbindManaged(self, arg):
    """True if an output-param arg's pointee is a Handle<T> or default-
    constructible class. Drives `[Symbol.dispose](): void` emission on the
    return container literal.
    """
    if not isOutputParam(arg.type):
      return False
    pointee = arg.type.get_pointee()
    if _isHandleType(pointee):
      return True
    canonical = pointee.get_canonical()
    if canonical.spelling in builtInTypes:
      return False
    if pointee.kind == clang.cindex.TypeKind.ENUM or canonical.kind == clang.cindex.TypeKind.ENUM:
      return False
    return _isDefaultConstructibleClass(pointee)

  def _returnIsEmbindManaged(self, method):
    """True if the method's non-void return type is a Handle<T> or class."""
    ret_type = method.result_type
    if ret_type.spelling == "void":
      return False
    ret = ret_type
    if ret.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
      ret = ret.get_pointee()
    if _isHandleType(ret):
      return True
    canonical = ret.get_canonical()
    if _isHandleType(canonical):
      return True
    if canonical.spelling in builtInTypes:
      return False
    if ret.kind == clang.cindex.TypeKind.ENUM or canonical.kind == clang.cindex.TypeKind.ENUM:
      return False
    if canonical.kind == clang.cindex.TypeKind.POINTER:
      return False
    return _isDefaultConstructibleClass(canonical)

  def _containerNeedsDispose(self, outputArgs, method):
    """TS-side mirror of `EmbindBindings._containerNeedsDispose` — returns
    True iff at least one output arg OR the non-void return is embind-managed
    (class instance or Handle<T>). Keeps the `[Symbol.dispose](): void` member
    in the return type literal aligned with the C++ codegen's val::object()
    branch in `_emitOutputParamBinding`.
    """
    for _i, arg in outputArgs:
      if self._outputArgIsEmbindManaged(arg):
        return True
    return self._returnIsEmbindManaged(method)

  def _mutatedClassParamNames(self, method, allArgs):
    """Names of the JS-visible class output params that this method mutates in
    place (R1), preserving argument order. Used by `_jsdoc` to append the
    "Mutated in place..." suffix to each param's description and to synthesize
    a `@param` when upstream Doxygen omits it.

    Returns a tuple (insertion-stable) so JSDoc emission is deterministic
    across runs — iterating a `set` mixes hash order across builds and
    produces byte-divergent `.d.ts` outputs.
    """
    names = []
    seen = set()
    for i, arg in enumerate(allArgs):
      if isClassOutputParam(arg.type) and not shouldStripParam(arg.type, method):
        name = self._argname(arg, i)
        if name not in seen:
          names.append(name)
          seen.add(name)
    return tuple(names)

  def _describeEnvelope(self, method, allArgs, templateDecl, templateArgs, theClass=None):
    """Describe the envelope `_buildOutputParamReturnType` will emit for this
    method, in the shape `_jsdoc` consumes. Returns None when the method
    collapses to a native return (no envelope).

    Keeping this in lockstep with `_buildOutputParamReturnType` is critical —
    a drift between the two would silently produce JSDoc that describes
    fields the dts no longer contains.
    """
    ret_type = method.result_type
    if ret_type.spelling != "void" and ret_type.get_canonical().kind == clang.cindex.TypeKind.POINTER:
      return None
    outputArgs = [(i, a) for i, a in enumerate(allArgs)
                  if isOutputParam(a.type) and not isClassOutputParam(a.type)]
    if not outputArgs:
      return None
    base_override = self._find_base_override_target(theClass, method) if theClass is not None else None
    if base_override is not None:
      base_args = list(base_override.get_arguments())
      base_output = [(i, a) for i, a in enumerate(base_args)
                     if isOutputParam(a.type) and not isClassOutputParam(a.type)]
      if not base_output:
        return None
      if len(base_output) == len(outputArgs):
        outputArgs = [(i, derived_a) for (i, derived_a), (_bi, base_a) in zip(outputArgs, base_output)]
        output_names = [self._argname(base_a, bi) for (bi, base_a) in base_output]
      else:
        # Mixed-arity virtual override — describe the union of base + derived
        # output names (matching `_buildOutputParamReturnType`'s union path).
        emitted = set()
        union_fields = []
        if method.result_type.spelling != "void":
          base_names = {self._argname(a, i) for i, a in base_output}
          ret_field_name = ENVELOPE_RETURN_FIELD_COLLISION if ENVELOPE_RETURN_FIELD in base_names else ENVELOPE_RETURN_FIELD
          union_fields.append({"name": ret_field_name, "kind": "return"})
          emitted.add(ret_field_name)
        for bi, base_a in base_output:
          base_name = self._argname(base_a, bi)
          if base_name in emitted:
            continue
          union_fields.append({"name": base_name, "kind": self._envelopeFieldKind(base_a)})
          emitted.add(base_name)
        for di, derived_a in outputArgs:
          derived_name = self._argname(derived_a, di)
          if derived_name in emitted:
            continue
          union_fields.append({"name": derived_name, "kind": self._envelopeFieldKind(derived_a)})
          emitted.add(derived_name)
        needs_dispose = self._containerNeedsDispose(outputArgs, method)
        return {
          "has_envelope": True,
          "return_field": union_fields[0]["name"] if union_fields and union_fields[0]["kind"] == "return" else None,
          "fields": union_fields,
          "has_dispose": needs_dispose,
        }
    else:
      output_names = [self._argname(a, i) for i, a in outputArgs]

    fields = []
    return_field = None
    if method.result_type.spelling != "void":
      names_set = set(output_names)
      return_field = ENVELOPE_RETURN_FIELD_COLLISION if ENVELOPE_RETURN_FIELD in names_set else ENVELOPE_RETURN_FIELD
      fields.append({"name": return_field, "kind": "return"})
    for (i, arg), out_name in zip(outputArgs, output_names):
      fields.append({"name": out_name, "kind": self._envelopeFieldKind(arg)})
    needs_dispose = self._containerNeedsDispose(outputArgs, method)
    return {
      "has_envelope": True,
      "return_field": return_field,
      "fields": fields,
      "has_dispose": needs_dispose,
    }

  def _envelopeFieldKind(self, arg):
    """Classify an envelope-bound output arg for JSDoc emission. Class outputs
    never reach this helper — they are filtered out before any envelope
    description is built. Returns 'handle', 'enum', or 'primitive'.
    """
    pointee = arg.type.get_pointee()
    if _isHandleType(pointee):
      return "handle"
    canonical = pointee.get_canonical()
    if pointee.kind == clang.cindex.TypeKind.ENUM or canonical.kind == clang.cindex.TypeKind.ENUM:
      return "enum"
    return "primitive"

  def _buildOutputParamReturnType(self, method, allArgs, templateDecl, templateArgs, theClass=None):
    """Build a TS inline object return type from output params, or None when
    the method should fall back to the native C++ return.

    Per R1 of docs/research/ocjs-rbv-return-shape-revisit.md, concrete class
    outputs (non-Handle, default-constructible) are mutated in place and do
    NOT appear in the return envelope. Per R2, methods whose only output
    params are class refs collapse to a plain native return (or void).

    For overrides, mirrors the base class's output-param field names so the
    derived signature stays structurally assignable to the base (TS2416).
    """
    # R1 filter: class outputs are mutated in place and not envelope fields.
    outputArgs = [(i, a) for i, a in enumerate(allArgs)
                  if isOutputParam(a.type) and not isClassOutputParam(a.type)]
    ret_type = method.result_type
    if ret_type.spelling != "void" and ret_type.get_canonical().kind == clang.cindex.TypeKind.POINTER:
      return None
    if not outputArgs:
      # R2: no envelope-bound outputs → native return path. Caller emits the
      # raw C++ return type directly (`void` or the native return).
      return None
    needsDispose = self._containerNeedsDispose(outputArgs, method)

    # Virtual overrides must keep the base class signature shape, otherwise
    # TS2416 fires. If the same-name same-arity method exists on a base, mirror
    # its output-param naming. If the base has no envelope-bound output params,
    # drop the inline-object transform entirely.
    base_override = self._find_base_override_target(theClass, method) if theClass is not None else None
    if base_override is not None:
      base_args = list(base_override.get_arguments())
      base_output = [(i, a) for i, a in enumerate(base_args)
                     if isOutputParam(a.type) and not isClassOutputParam(a.type)]
      if not base_output:
        return None
      if len(base_output) == len(outputArgs):
        # Mirror the base's argument names for the output fields, but use the
        # derived's (more specific) types to preserve covariance.
        outputArgs = [(i, derived_a) for (i, derived_a), (_bi, base_a) in zip(outputArgs, base_output)]
        derived_output_names = [self._argname(base_a, bi) for (bi, base_a) in base_output]
      else:
        # The derived override carries a different number of output params
        # than the base. To stay structurally assignable to the base, we must
        # at minimum expose ALL of base's output keys. We emit the *union* of
        # base's and derived's keys (base's verbatim, derived's appended only
        # when names don't collide). Lossy at runtime — derived's actual
        # binding doesn't populate base's keys — but type-safe for callers.
        fields = []
        emitted = set()
        if method.result_type.spelling != "void":
          ret = self.getTypescriptDefFromResultType(method.result_type, templateDecl, templateArgs)
          base_names = {self._argname(a, i) for i, a in base_output}
          ret_field_name = ENVELOPE_RETURN_FIELD_COLLISION if ENVELOPE_RETURN_FIELD in base_names else ENVELOPE_RETURN_FIELD
          fields.append(f"{ret_field_name}: {ret}")
          emitted.add(ret_field_name)
        for bi, base_a in base_output:
          base_name = self._argname(base_a, bi)
          if base_name in emitted:
            continue
          tsType = self.resolve_type(base_a.type, templateDecl, templateArgs)
          fields.append(f"{base_name}: {tsType}")
          emitted.add(base_name)
        for di, derived_a in outputArgs:
          derived_name = self._argname(derived_a, di)
          if derived_name in emitted:
            continue
          tsType = self.resolve_type(derived_a.type, templateDecl, templateArgs)
          fields.append(f"{derived_name}: {tsType}")
          emitted.add(derived_name)
        if needsDispose:
          fields.append("[Symbol.dispose](): void")
        return "{ " + "; ".join(fields) + " }"
    else:
      derived_output_names = [self._argname(a, i) for i, a in outputArgs]

    fields = []
    hasNonVoidReturn = method.result_type.spelling != "void"
    output_names = set(derived_output_names)
    if hasNonVoidReturn:
      origReturn = self.getTypescriptDefFromResultType(method.result_type, templateDecl, templateArgs)
      ret_field_name = ENVELOPE_RETURN_FIELD_COLLISION if ENVELOPE_RETURN_FIELD in output_names else ENVELOPE_RETURN_FIELD
      fields.append(f"{ret_field_name}: {origReturn}")

    for (i, arg), out_name in zip(outputArgs, derived_output_names):
      tsType = self.resolve_type(arg.type, templateDecl, templateArgs)
      fields.append(f"{out_name}: {tsType}")

    if needsDispose:
      fields.append("[Symbol.dispose](): void")

    return "{ " + "; ".join(fields) + " }"

  def _buildKeptArgs(self, method, allArgs, templateDecl, templateArgs):
    """Build the TS arg list under Input-Passthrough RBV with Approach G
    Handle elision.

    Primitive/enum and default-constructible class output params continue to
    appear in the JS signature as REQUIRED slots (input-passthrough — the
    caller supplies the seed and reads the result via the return container).
    Non-const `Handle<T>&` outputs are ELIDED — per OCCT contract these are
    output-only, never read by C++, and the JS-facing input was a gratuitous
    wrapper allocation. `shouldStripParam` is the single source of truth for
    elision; `_emitOutputParamBinding` declares the matching stack-local null
    Handle inside the optional_override lambda body.

    See `docs/research/ocjs-rbv-handle-output-param-elision.md` for the
    decision record (Approach G); supersedes the earlier Option C from
    `docs/research/ocjs-rbv-blueprint-p0-p1-stocktake.md` §F3.
    """
    keptArgs = [self.getTypescriptDefFromArg(arg, i, templateDecl, templateArgs)
                for i, arg in enumerate(allArgs)
                if not shouldStripParam(arg.type, method)]
    return ", ".join(keptArgs)

  def processMethodOrProperty(self, theClass, method, templateDecl = None, templateArgs = None, overload_index = 0, override_postfix = None):
    output = ""
    if method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.CXX_METHOD and not method.spelling.startswith("operator"):
      [overloadPostfix, numOverloads] = getMethodOverloadPostfix(theClass, method)
      if override_postfix is not None:
        overloadPostfix = override_postfix

      allArgs = list(method.get_arguments())
      outputReturnType = self._buildOutputParamReturnType(method, allArgs, templateDecl, templateArgs, theClass=theClass)

      if outputReturnType is not None:
        args = self._buildKeptArgs(method, allArgs, templateDecl, templateArgs)
        returnType = outputReturnType
      else:
        args = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x[1], x[0], templateDecl, templateArgs), enumerate(allArgs))))
        returnType = self.getTypescriptDefFromResultType(method.result_type, templateDecl, templateArgs)

      className = getClassTypeName(theClass, templateDecl)
      tplName = theClass.spelling if templateDecl is not None else None
      kept_names = [self._argname(arg, i) for i, arg in enumerate(allArgs)
                    if not shouldStripParam(arg.type, method)]
      mutated_names = self._mutatedClassParamNames(method, allArgs)
      envelope = self._describeEnvelope(method, allArgs, templateDecl, templateArgs, theClass=theClass)
      output += self._jsdoc(className, method.spelling, "  ", param_count=len(allArgs), overload_index=overload_index, template_name=tplName, param_names=kept_names, mutated_class_param_names=mutated_names, envelope_descriptor=envelope)
      output += "  " + ("static " if method.is_static_method() else "") + method.spelling + overloadPostfix + "(" + args + "): " + returnType + ";\n"
    if method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.FIELD_DECL:
      if method.type.kind == clang.cindex.TypeKind.CONSTANTARRAY:
        pass
      elif not method.type.get_pointee().kind == clang.cindex.TypeKind.INVALID:
        pass
      else:
        fieldType = self.resolve_type(method.type, templateDecl, templateArgs)
        output += "  " + method.spelling + ": " + fieldType + ";\n"
    return output

  def processMethodGroup(self, theClass, methods, templateDecl=None, templateArgs=None):
    """Process a group of methods with the same name — emit overloaded signatures."""
    output = ""
    className = getClassTypeName(theClass, templateDecl)
    tplName = theClass.spelling if templateDecl is not None else None

    bindable = []
    for m in methods:
      try:
        self._checkUnbindableArgs(m.spelling, theClass.spelling, list(m.get_arguments()))
        bindable.append(m)
      except SkipException as e:
        print(str(e))

    if not bindable:
      return output

    # Discover missing base-class overloads. When a derived class declares
    # an override of a base virtual but does NOT redeclare every base overload
    # of the same name, the missing overloads are hidden in C++ but TypeScript
    # still requires the derived to satisfy the full base contract — otherwise
    # TS2416 fires (`(guid: unknown) => void` not assignable to base's
    # `{ (a0): void; (): void }`). We render these synthesized base signatures
    # at the end of the group so the derived satisfies structural compatibility.
    base_overloads_to_synthesize = self._missing_base_overloads(theClass, bindable)

    # Filter rvalue-reference overloads — JS has no move semantics.
    # These create JS-ambiguous duplicates of const-ref overloads,
    # forcing unnecessary _N suffixes on the entire arity group.
    bindable = [m for m in bindable if not any(
      a.type.kind == clang.cindex.TypeKind.RVALUEREFERENCE
      for a in m.get_arguments()
    )]
    if not bindable:
      return output

    # Deduplicate const/non-const overloads with identical argument types.
    # JS has no const `this` — these are JS-indistinguishable and force
    # unnecessary _N suffixes. Prefer the const version.
    deduped = {}
    for m in bindable:
      arg_key = tuple(a.type.get_canonical().spelling for a in m.get_arguments())
      is_const = m.is_const_method()
      if arg_key not in deduped:
        deduped[arg_key] = m
      elif is_const and not deduped[arg_key].is_const_method():
        deduped[arg_key] = m
    bindable = list(deduped.values())
    if not bindable:
      return output

    # Group by *kept* arity (post output-param stripping) so that methods
    # which collapse to the same TS signature shape (e.g. three C++ Show()
    # overloads that all become `Show()` in TS) are routed to the _N suffix
    # branch and don't produce structurally identical, conflicting overloads
    # that fail the base-class assignability check (TS2416).
    def _kept_arity(m):
      return sum(1 for a in m.get_arguments() if not shouldStripParam(a.type, m))

    by_arity = defaultdict(list)
    for m in bindable:
      by_arity[_kept_arity(m)].append(m)

    all_unique_arities = all(len(group) == 1 for group in by_arity.values())

    if all_unique_arities:
      arity_idx = {}
      for m in bindable:
        nargs = _kept_arity(m)
        idx = arity_idx.get(nargs, 0)
        arity_idx[nargs] = idx + 1
        try:
          output += self.processMethodOrProperty(theClass, m, templateDecl, templateArgs, overload_index=idx, override_postfix="")
        except SkipException as e:
          print(str(e))
      for base_method in base_overloads_to_synthesize:
        output += self._render_synthesized_base_signature(base_method, className, tplName)
      return output

    # Same-arity groups exist — determine which need _N suffix
    all_methods_of_name = [m for m in theClass.get_children()
                           if m.kind == clang.cindex.CursorKind.CXX_METHOD
                           and m.access_specifier == clang.cindex.AccessSpecifier.PUBLIC
                           and m.spelling == bindable[0].spelling]
    def _ts_args_and_return(m):
      """Get TS args string and return type, accounting for output params."""
      allArgs = list(m.get_arguments())
      outputReturnType = self._buildOutputParamReturnType(m, allArgs, templateDecl, templateArgs, theClass=theClass)
      if outputReturnType is not None:
        args = self._buildKeptArgs(m, allArgs, templateDecl, templateArgs)
        returnType = outputReturnType
      else:
        args = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x[1], x[0], templateDecl, templateArgs), enumerate(allArgs))))
        returnType = self.getTypescriptDefFromResultType(m.result_type, templateDecl, templateArgs)
      return args, returnType

    def _kept_names(m):
      """Compute TS param names for a method, excluding stripped output params."""
      allArgs = list(m.get_arguments())
      return [self._argname(arg, i) for i, arg in enumerate(allArgs)
              if not shouldStripParam(arg.type, m)]

    def _jsdoc_kwargs(m):
      """Compute the mutated-class-param set and envelope descriptor for `m`
      so every same-arity-group `_jsdoc` call shares a single source of truth
      (kept in lockstep with `_buildOutputParamReturnType` via
      `_describeEnvelope`).
      """
      allArgs = list(m.get_arguments())
      return {
        "mutated_class_param_names": self._mutatedClassParamNames(m, allArgs),
        "envelope_descriptor": self._describeEnvelope(m, allArgs, templateDecl, templateArgs, theClass=theClass),
      }

    arity_idx_map = {}
    for arity, group in sorted(by_arity.items()):
      if len(group) == 1:
        idx = arity_idx_map.get(arity, 0)
        arity_idx_map[arity] = idx + 1
        args, returnType = _ts_args_and_return(group[0])
        methodArgs = list(group[0].get_arguments())
        names = _kept_names(group[0])
        output += self._jsdoc(className, group[0].spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName, param_names=names, **_jsdoc_kwargs(group[0]))
        output += "  " + ("static " if group[0].is_static_method() else "") + group[0].spelling + "(" + args + "): " + returnType + ";\n"
      else:
        def _ts_method_has_wrapper_args(m):
          return any(
            m_arg.type.get_canonical().spelling in unbindablePointerTypes
            for m_arg in m.get_arguments()
          )

        dispatchable = [m for m in group if not _ts_method_has_wrapper_args(m)]
        wrapper_methods = [m for m in group if _ts_method_has_wrapper_args(m)]

        if dispatchable:
          tree = self._build_dispatch_tree(dispatchable, templateDecl=templateDecl, templateArgs=templateArgs) if len(dispatchable) > 1 else None
          ambiguous = self._collect_ambiguous_overloads(tree) if tree else []
          distinguishable = [ov for ov in dispatchable if ov not in ambiguous]


          ambiguous_primaries = set()
          if tree:
            self._collect_ambiguous_primaries(tree, ambiguous_primaries)

          for ov in distinguishable:
            idx = arity_idx_map.get(arity, 0)
            arity_idx_map[arity] = idx + 1
            args, returnType = _ts_args_and_return(ov)
            methodArgs = list(ov.get_arguments())
            names = _kept_names(ov)
            output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName, param_names=names, **_jsdoc_kwargs(ov))
            output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + "(" + args + "): " + returnType + ";\n"

          for ov in ambiguous:
            ovIdx = all_methods_of_name.index(ov) if ov in all_methods_of_name else 0
            suffix = "_" + str(ovIdx + 1)
            idx = arity_idx_map.get(arity, 0)
            arity_idx_map[arity] = idx + 1
            args, returnType = _ts_args_and_return(ov)
            methodArgs = list(ov.get_arguments())
            names = _kept_names(ov)
            is_primary = id(ov) in ambiguous_primaries
            jsdoc_extra = _jsdoc_kwargs(ov)
            if is_primary:
              output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName, param_names=names, **jsdoc_extra)
              output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + "(" + args + "): " + returnType + ";\n"
            output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName, param_names=names, **jsdoc_extra)
            output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + suffix + "(" + args + "): " + returnType + ";\n"

        for ov in wrapper_methods:
          ovIdx = all_methods_of_name.index(ov) if ov in all_methods_of_name else 0
          suffix = "_" + str(ovIdx + 1)
          idx = arity_idx_map.get(arity, 0)
          arity_idx_map[arity] = idx + 1
          args, returnType = _ts_args_and_return(ov)
          methodArgs = list(ov.get_arguments())
          names = _kept_names(ov)
          output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName, param_names=names, **_jsdoc_kwargs(ov))
          output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + suffix + "(" + args + "): " + returnType + ";\n"

    for base_method in base_overloads_to_synthesize:
      output += self._render_synthesized_base_signature(base_method, className, tplName)
    return output

  def processOverloadedConstructors(self, theClass, children = None, templateDecl = None, templateArgs = None):
    """Emit _N subclass TypeScript declarations ONLY for genuinely ambiguous constructor overloads."""
    output = ""
    if children is None:
      children = list(theClass.get_children())
    constructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, children))
    if len(constructors) <= 1:
      return output

    filtered = self._filter_overloads(constructors)
    filtered = [c for c in filtered if filterMethodOrProperty(theClass, c)]
    bindable = []
    for c in filtered:
      try:
        self._checkUnbindableArgs("constructor", theClass.spelling, list(c.get_arguments()))
        bindable.append(c)
      except SkipException:
        continue

    by_arity = defaultdict(list)
    for c in bindable:
      by_arity[len(list(c.get_arguments()))].append(c)

    ambiguous_ctors = []
    for group in by_arity.values():
      if len(group) <= 1:
        continue
      tree = self._build_dispatch_tree(group, templateDecl=templateDecl, templateArgs=templateArgs)
      ambiguous_ctors.extend(self._collect_ambiguous_overloads(tree))

    if not ambiguous_ctors:
      return output

    name = getClassTypeName(theClass, templateDecl)
    tplName = theClass.spelling if templateDecl is not None else None
    allOverloads = constructors
    allOverloadedConstructors = []
    arity_seen = {}

    for constructor in ambiguous_ctors:
      overloadPostfix = "_" + str(allOverloads.index(constructor) + 1)
      ctorArgs = list(constructor.get_arguments())
      nargs = len(ctorArgs)
      arity_idx = arity_seen.get(nargs, 0)
      arity_seen[nargs] = arity_idx + 1
      argsTypescriptDef = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x, "", templateDecl, templateArgs), ctorArgs)))
      ctor_names = [self._argname(arg, i) for i, arg in enumerate(ctorArgs)]
      output += self._jsdoc(name, name, "  ", param_count=nargs, overload_index=arity_idx, template_name=tplName, param_names=ctor_names)
      output += "  export declare class " + name + overloadPostfix + " extends " + name + " {\n"
      output += self._jsdoc(name, name, "    ", param_count=nargs, overload_index=arity_idx, template_name=tplName, param_names=ctor_names)
      output += "    constructor(" + argsTypescriptDef + ");\n"
      output += "  }\n\n"
      allOverloadedConstructors.append(name + overloadPostfix)
    self.exports.update(allOverloadedConstructors)
    return output

  def processEnum(self, theEnum):
    output = ""
    enumName = theEnum.spelling
    output += "export type " + enumName + " = typeof " + enumName + "[keyof typeof " + enumName + "];\n"
    output += self._jsdoc(enumName)
    output += "export declare const " + enumName + ": {\n"
    for enumChild in list(theEnum.get_children()):
      if not enumChild.spelling or not enumChild.spelling.isidentifier():
        # Skip non-identifier enumerators so the const literal stays parseable.
        continue
      output += self._enum_member_jsdoc(enumName, enumChild.spelling)
      output += "  readonly " + enumChild.spelling + ": '" + enumChild.spelling + "';\n"
    output += "};\n\n"
    self.exports.add(enumName)
    return output

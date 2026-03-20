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

def getClassTypeName(theClass, templateDecl = None):
  return templateDecl.spelling if templateDecl is not None else theClass.spelling

class Bindings:
  def __init__(self, tuInfo):
    self.tuInfo = tuInfo

  _MEMBER_TYPEDEFS = {"value_type", "const_reference", "reference", "Array1Type", "Array2Type", "SequenceType"}
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
    """Apply all safe filters: move ctors, float/double dedup, string encoding dedup."""
    filtered = [c for c in overloads if not self._is_move_constructor(c)]
    filtered = self._dedupe_float_double(filtered)
    filtered = self._dedupe_string_encodings(filtered)
    return filtered

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

  _JS_STRING_KINDS = frozenset({
    clang.cindex.TypeKind.CHAR_U, clang.cindex.TypeKind.UCHAR,
    clang.cindex.TypeKind.CHAR16, clang.cindex.TypeKind.CHAR32,
    clang.cindex.TypeKind.CHAR_S, clang.cindex.TypeKind.SCHAR,
  })

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
        clean = underlying_spelling.replace("const ", "").replace("&", "").replace("*", "").strip()
        Bindings._reverse_typedef_cache[clean] = typedef_cursor.spelling
    clean_spelling = type_spelling.replace("const ", "").replace("&", "").replace("*", "").strip()
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
    if cat == 'string':
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

  def resolveWithCanonicalFallback(self, spelling, clangType, templateDecl = None, templateArgs = None):
    """Resolve a type spelling, falling back to canonical type for member typedefs.
    
    Template specializations like NCollection_Array1<gp_Pnt> use member typedefs
    (value_type, const_reference) that resolve to concrete types (gp_Pnt, const gp_Pnt&)
    in the canonical form. When clang returns type-parameter-0-N for the canonical type
    (template definitions), we map it through templateArgs to the concrete type.
    """
    resolved = self.getTypedefedTemplateTypeAsString(spelling, templateDecl, templateArgs)
    if any(td in resolved for td in self._DEPRECATED_TYPEDEFS):
      canonical = clangType.get_canonical().spelling
      if "type-parameter-" not in canonical:
        return canonical
    if not any(td in resolved for td in self._MEMBER_TYPEDEFS):
      return resolved

    canonical = clangType.get_canonical().spelling
    if "type-parameter-" not in canonical:
      return canonical

    if not templateArgs:
      return resolved

    import re
    if Bindings._TYPE_PARAM_RE is None:
      Bindings._TYPE_PARAM_RE = re.compile(r'type-parameter-(\d+)-(\d+)')

    def replacer(m):
      depth, index = int(m.group(1)), int(m.group(2))
      if depth == 0:
        argValues = list(templateArgs.values())
        if index < len(argValues):
          return argValues[index].spelling
      return m.group(0)

    return Bindings._TYPE_PARAM_RE.sub(replacer, canonical)

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

  def processClass(self, theClass, templateDecl = None, templateArgs = None):
    output = ""
    className = getClassTypeName(theClass, templateDecl)
    if className == "":
      className = theClass.type.spelling

    baseSpec = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, theClass.get_children()))

    if len(baseSpec) > 0:
      baseType = baseSpec[0].type.spelling
      if any(x in baseType for x in [":", "<"]):
        baseClassBinding = ""
      else:
        baseClassBinding = ", base<" + baseType + ">"
    else:
      baseClassBinding = ""

    output += "EMSCRIPTEN_BINDINGS(" + (theClass.spelling if templateDecl is None else templateDecl.spelling) + ") {\n"
    output += "  class_<" + className + baseClassBinding + ">(\"" + className + "\")\n"

    if isTransientDerived(theClass, self.tuInfo.classDict):
      output += "    .smart_ptr<opencascade::handle<" + className + ">>(\"Handle_" + className + "\")\n"

    if className == "Standard_Transient":
      output += "    .function(\"isNull\", &handle_isNull<Standard_Transient>)\n"
      output += "    .function(\"nullify\", &handle_nullify<Standard_Transient>)\n"

    output += super().processClass(theClass, templateDecl, templateArgs)

    for child in theClass.get_children():
      if child.kind == clang.cindex.CursorKind.ENUM_DECL and child.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and child.spelling != "" and child.spelling.isidentifier():
        enumName = className + "_" + child.spelling
        isScoped = child.is_scoped_enum()
        valuePrefix = className + "::" + child.spelling + "::" if isScoped else className + "::"
        output += "  enum_<" + className + "::" + child.spelling + ">(\"" + enumName + "\", emscripten::enum_value_type::string)\n"
        for enumChild in list(child.get_children()):
          if enumChild.kind == clang.cindex.CursorKind.ENUM_CONSTANT_DECL:
            output += "    .value(\"" + enumChild.spelling + "\", " + valuePrefix + enumChild.spelling + ")\n"
        output += "  ;\n"

    output += "}\n\n"

    # Epilog
    nonPublicDestructor = any(x.kind == clang.cindex.CursorKind.DESTRUCTOR and not x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC for x in theClass.get_children())
    placementDelete = next((x for x in theClass.get_children() if x.spelling == "operator delete" and len(list(x.get_arguments())) == 2), None) is not None
    if nonPublicDestructor or placementDelete:
      output += "namespace emscripten { namespace internal { template<> void raw_destructor<" + className + ">(" + className + "* ptr) { /* do nothing */ } } }\n"
    return output

  def processFinalizeClass(self):
    return "  ;\n"

  def _emitConstructor(self, className, args, templateDecl, templateArgs, useHandleOverride):
    """Emit a single constructor binding, using optional_override for Transient-derived classes."""
    argTypesBindings = ", ".join([
      self.getSingleArgumentBinding(False, True, templateDecl, templateArgs)(arg)[0]
      for arg in args
    ])
    if not useHandleOverride:
      return "    .constructor<" + argTypesBindings + ">()\n"
    namedArgs = []
    for i, arg in enumerate(args):
      name = arg.spelling if arg.spelling else f"a{i}"
      typeStr = self.getSingleArgumentBinding(False, True, templateDecl, templateArgs)(arg)[0]
      if isCString(arg.type):
        namedArgs.append(("std::string " + name, name + ".c_str()"))
      else:
        namedArgs.append((typeStr + " " + name, name))
    typedArgs = ", ".join([a[0] for a in namedArgs])
    argNames = ", ".join([a[1] for a in namedArgs])
    return (
      "    .constructor(optional_override([](" + typedArgs + ") {\n"
      "      return opencascade::handle<" + className + ">(new " + className + "(" + argNames + "));\n"
      "    }))\n"
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
    useHandleOverride = isTransientDerived(theClass, self.tuInfo.classDict)

    if len(constructors) == 0:
      if useHandleOverride:
        output += "    .constructor(optional_override([]() {\n"
        output += "      return opencascade::handle<" + className + ">(new " + className + "());\n"
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
      output += self._emitConstructor(className, args, templateDecl, templateArgs, useHandleOverride)
      # Default parameter expansion for single constructor
      nDefaults = self._countTrailingDefaults(bindable[0])
      nArgs = len(args)
      for d in range(1, nDefaults + 1):
        truncated = args[:nArgs - d]
        output += self._emitConstructor(className, truncated, templateDecl, templateArgs, useHandleOverride)
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
        # If this arity comes from default expansion, emit truncated constructor
        emit_args = actual_args[:arity]
        if not any(isCString(a.type) for a in emit_args):
          output += self._emitConstructor(className, emit_args, templateDecl, templateArgs, useHandleOverride)
        else:
          tree = DispatchLeaf(c)
          output += self._emitValDispatchConstructor(className, arity, tree, useHandleOverride, templateDecl, templateArgs)
      else:
        tree = self._build_dispatch_tree(group, available_positions=list(range(arity)), templateDecl=templateDecl, templateArgs=templateArgs)
        output += self._emitValDispatchConstructor(className, arity, tree, useHandleOverride, templateDecl, templateArgs)

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

  def processMethodOrProperty(self, theClass, method, templateDecl = None, templateArgs = None, overload_index = 0, override_postfix = None):
    output = ""
    className = getClassTypeName(theClass, templateDecl)
    if className == "":
      className = theClass.type.spelling
    if method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.CXX_METHOD and not method.spelling.startswith("operator"):
      [overloadPostfix, numOverloads] = getMethodOverloadPostfix(theClass, method)
      if override_postfix is not None:
        overloadPostfix = override_postfix

      def needsWrapper(type):
        return (
          type.kind == clang.cindex.TypeKind.LVALUEREFERENCE and (
            type.get_pointee().get_canonical().spelling in builtInTypes or
            type.get_pointee().kind == clang.cindex.TypeKind.ENUM or
            type.get_pointee().kind == clang.cindex.TypeKind.POINTER or (
              theClass.kind == clang.cindex.CursorKind.CLASS_TEMPLATE and
              type.get_pointee().spelling in templateArgs and
              templateArgs[type.get_pointee().spelling].get_canonical().spelling in builtInTypes
            )
          ) or (
            type.get_canonical().kind == clang.cindex.TypeKind.POINTER and 
            isCString(type)
          )
        )

      args = list(method.get_arguments())
      self._checkUnbindableArgs(method.spelling, theClass.spelling, args)
      argsNeedingWrapper = list(map(lambda arg: needsWrapper(arg.type), args))
      returnNeedsWrapper = needsWrapper(method.result_type)
      if any(argsNeedingWrapper) or returnNeedsWrapper:
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
        def getArgTypeName(type):
          if templateArgs is not None and type.get_pointee().spelling.replace("const ", "") in templateArgs:
            return type.get_pointee().spelling.replace(type.get_pointee().spelling.replace("const ", ""), templateArgs[type.get_pointee().spelling.replace("const ", "")].spelling)
          else:
            return type.get_pointee().spelling
        classTypeName = getClassTypeName(theClass, templateDecl)
        wrappedParamTypes = merge(", ", *map(lambda x:
          pick(
            x[1],
            "emscripten::val",
            replaceTemplateArgs(x)
          ),
          enumerate(argsNeedingWrapper)
        ))
        wrappedParamTypesAndNames = merge(", ", *map(lambda x:
          pick(
            x[1],
            f"emscripten::val {getArgName(x)}",
            f"{replaceTemplateArgs(x)} {getArgName(x)}",
          ), enumerate(argsNeedingWrapper)))
        def generateGetReferenceValue(x):
          if x[1] and not isCString(args[x[0]].type):
            return (
              merge("",
                indent(4),
                "auto ref_",
                pick(not args[x[0]].spelling == "",
                  args[x[0]].spelling,
                  f"argNo{str(x[0])}"
                ),
                f" = getReferenceValue<{getArgTypeName(args[x[0]].type)}>({getArgName(x)});\n"
              )
            )
          else:
            return ""
        def generateUpdateReferenceValue(x):
          if x[1] and not isCString(args[x[0]].type):
            return  f"{indent(4)}updateReferenceValue<{getArgTypeName(args[x[0]].type)}>({getArgName(x)}, ref_{getArgName(x)});\n"
          else:
            return ""
        def generateInvocationArgs(x):
          if x[1]:
            if not isCString(args[x[0]].type):
              return f"ref_{getArgName(x)}"
            else:
              if not args[x[0]].type.get_canonical().get_pointee().is_const_qualified() or args[x[0]].type.is_const_qualified():
                return f"{getArgName(x)}.isNull() ? nullptr : strdup({getArgName(x)}.as<std::string>().c_str())"
              else:
                return f"{getArgName(x)}.isNull() ? nullptr : {getArgName(x)}.as<std::string>().c_str()"
          else:
            return getArgName(x)
        resultTypeSpelling = \
          pick(returnNeedsWrapper, "emscripten::val", self.resolveWithCanonicalFallback(method.result_type.spelling, method.result_type, templateDecl, templateArgs))
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
            merge("", *map(lambda x: generateGetReferenceValue(x), enumerate(argsNeedingWrapper))),
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
              pick(not method.is_static_method(), "that.", f"{className}::"),
              f'{method.spelling}({merge(", ", *map(lambda x: generateInvocationArgs(x), enumerate(argsNeedingWrapper)))})',
            ),
            ";\n",
            merge("", *map(lambda x: generateUpdateReferenceValue(x), enumerate(argsNeedingWrapper))),
            pick(
              method.result_type.spelling == "void",
              "",
              pick(
                returnNeedsWrapper,
                pick(
                  method.result_type.kind == clang.cindex.TypeKind.POINTER,
                  merge("",
                    indent(4),
                    "return ret == nullptr ? emscripten::val::null() : emscripten::val(static_cast<",
                      pick(isCString(method.result_type), "std::string", self.getTypedefedTemplateTypeAsString(method.result_type.spelling, templateDecl, templateArgs)),
                    ">(ret), allow_raw_pointers());\n",
                  ),
                  f"{indent(4)}return emscripten::val(ret, allow_raw_pointers());\n",
                ),
                f"{indent(4)}return ret;\n",
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
      else:
        if numOverloads == 1:
          functionBinding = " &" + className + "::" + method.spelling
        else:
          functionBinding = merge("",
            " select_overload<",
            self.resolveWithCanonicalFallback(method.result_type.spelling, method.result_type, templateDecl, templateArgs),
            f'({merge(", ", *map(lambda x: self.getOriginalArgumentType(x, templateDecl, templateArgs), list(method.get_arguments())))})',
            pick(method.is_const_method(), "const", ""),
            pick(not method.is_static_method(), f", {getClassTypeName(theClass, templateDecl)}", ""),
            f">(&{className}::{method.spelling})",
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
        output += f"{indent(2)}.property(\"{method.spelling}\", &{className}::{method.spelling})\n"
    return output

  def _emitValDispatchMethod(self, theClass, methodName, arity, tree, className, isStatic, templateDecl, templateArgs, mixed_returns=False):
    """Emit a single optional_override method binding with val-based dispatch for same-arity overloads."""
    val_args = ", ".join([f"emscripten::val arg{i}" for i in range(arity)])
    if isStatic:
      sig_args = val_args
      functionCommand = "class_function"
    else:
      sig_args = f"{className}& self" + (", " + val_args if val_args else "")
      functionCommand = "function"

    ret_type = " -> emscripten::val" if mixed_returns else ""
    output = f'{indent(2)}.{functionCommand}("{methodName}", optional_override([]({sig_args}){ret_type} {{\n'
    output += self._codegen_method_dispatch_tree(tree, className, isStatic, templateDecl, templateArgs, ind=6, mixed_returns=mixed_returns)
    output += "    }), allow_raw_pointers())\n"
    return output

  def _codegen_method_dispatch_tree(self, tree, className, isStatic, templateDecl, templateArgs, ind=6, mixed_returns=False):
    """Generate C++ dispatch code for a method dispatch tree."""
    sp = " " * ind
    if isinstance(tree, DispatchLeaf):
      method = tree.overload
      args = list(method.get_arguments())
      conversions = []
      for i, arg in enumerate(args):
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
      caller = f"{className}::" if method.is_static_method() else "self."
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
        code += self._codegen_method_dispatch_tree(subtree, className, isStatic, templateDecl, templateArgs, ind + 2, mixed_returns=mixed_returns)
        code += f'{sp}}}\n'
      return code

    if isinstance(tree, DispatchAmbiguous):
      fallback = DispatchLeaf(tree.overloads[0])
      return self._codegen_method_dispatch_tree(fallback, className, isStatic, templateDecl, templateArgs, ind, mixed_returns=mixed_returns)

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
    classTypeName = getClassTypeName(theClass, templateDecl)
    if m.is_static_method():
      selectStr = f' select_overload<{returnType}({argTypesStr})>(&{className}::{m.spelling})'
    else:
      selectStr = f' select_overload<{returnType}({argTypesStr}){constStr}, {classTypeName}>(&{className}::{m.spelling})'
    funcCmd = "class_function" if m.is_static_method() else "function"
    return f'{indent(2)}.{funcCmd}("{m.spelling}{suffix}",{selectStr}, allow_raw_pointers())\n'

  def processMethodGroup(self, theClass, methods, templateDecl=None, templateArgs=None):
    """Process a group of methods with the same name, using dispatch for same-arity groups."""
    output = ""
    className = getClassTypeName(theClass, templateDecl)
    if className == "":
      className = theClass.type.spelling

    bindable = []
    for m in methods:
      try:
        self._checkUnbindableArgs(m.spelling, theClass.spelling, list(m.get_arguments()))
        bindable.append(m)
      except SkipException as e:
        print(str(e))

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
             ))
            or isCString(m_arg.type)
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
            return_types = set(m.result_type.get_canonical().spelling for m in dispatchable)
            mixed_returns = len(return_types) > 1

            tree = self._build_dispatch_tree(dispatchable, templateDecl=templateDecl, templateArgs=templateArgs)
            ambiguous = self._collect_ambiguous_overloads(tree)

            isStatic = all(m.is_static_method() for m in dispatchable)
            output += self._emitValDispatchMethod(theClass, dispatchable[0].spelling, arity, tree, className, isStatic, templateDecl, templateArgs, mixed_returns=mixed_returns)
            for m in ambiguous:
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
    allOverloads = constructors

    for constructor in ambiguous_ctors:
      try:
        overloadPostfix = "_" + str(allOverloads.index(constructor) + 1)
        args = ", ".join(list(map(lambda x: ("std::string " + x.spelling) if isCString(x.type) else self.getSingleArgumentBinding(True, True, templateDecl, templateArgs)(x)[0], constructor.get_arguments())))
        argNames = ", ".join(list(map(lambda x: (x.spelling + ".c_str()") if isCString(x.type) else x.spelling, constructor.get_arguments())))
        argTypes = ", ".join(list(map(lambda x: "std::string" if isCString(x.type) else self.getSingleArgumentBinding(False, True, templateDecl, templateArgs)(x)[0], constructor.get_arguments())))

        output += "    struct " + name + overloadPostfix + " : public " + name + " {\n"
        output += "      " + name + overloadPostfix + "(" + args + ") : " + name + "(" + argNames + ") {}\n"
        output += "    };\n"
        output += "    class_<" + name + overloadPostfix + ", base<" + name + ">>(\"" + name + overloadPostfix + "\")\n"
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
  _docs_cache = None

  def __init__(
    self,
    tuInfo
  ):
    super().__init__(tuInfo)
    self.imports = {}

    self.exports = []
    self._docs = self._load_docs()

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

  def _jsdoc(self, class_name, member_name=None, indent_str="", param_count=None, overload_index=0, template_name=None):
    used_template = False
    entry = self._docs.get(class_name)
    if not entry and template_name:
      entry = self._docs.get(template_name)
      used_template = True
    if not entry:
      return ""
    if member_name is None:
      brief = entry.get("brief", "")
      if not brief:
        return ""
      lines = [f"{indent_str}/**"]
      for line in brief.splitlines():
        lines.append(f"{indent_str} * {line}")
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
    member = self._resolve_overload(member, param_count, overload_index)
    brief = member.get("brief", "")
    if not brief:
      return ""
    lines = [f"{indent_str}/**"]
    for line in brief.splitlines():
      lines.append(f"{indent_str} * {line}")
    for param in member.get("params", []):
      desc = param.get("description", "")
      lines.append(f"{indent_str} * @param {param['name']} {desc}".rstrip())
    ret_desc = member.get("returns_description", "")
    if ret_desc:
      lines.append(f"{indent_str} * @returns {ret_desc}")
    if member.get("deprecated"):
      lines.append(f"{indent_str} * @deprecated")
    lines.append(f"{indent_str} */")
    return "\n".join(lines) + "\n"

  def _enum_member_jsdoc(self, enum_name, member_name):
    """Emit JSDoc for an individual enum member if Doxygen docs are available."""
    entry = self._docs.get(enum_name)
    if not entry or entry.get("kind") != "enum":
      return ""
    members = entry.get("members", {})
    member = members.get(member_name, {})
    brief = member.get("brief", "")
    if not brief:
      return ""
    lines = ["  /**"]
    for line in brief.splitlines():
      lines.append(f"   * {line}")
    lines.append("   */")
    return "\n".join(lines) + "\n"

  @staticmethod
  def _resolve_overload(member, param_count, overload_index=0):
    """Select the correct overload entry when a member has multiple definitions.

    When multiple overloads share the same param_count, overload_index
    disambiguates by selecting the Nth match (0-based) among those
    with the matching arity.
    """
    overloads = member.get("overloads")
    if not overloads:
      return member
    if param_count is None:
      return overloads[0]
    matches = [o for o in overloads if o.get("param_count") == param_count]
    if not matches:
      return overloads[0]
    idx = min(overload_index, len(matches) - 1)
    return matches[idx]

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
    self.exports.append(name)

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
            output += self._enum_member_jsdoc(enumName, enumChild.spelling)
            output += "  readonly " + enumChild.spelling + ": '" + enumChild.spelling + "';\n"
        output += "};\n\n"
        self.exports.append(enumName)

    return output

  def processFinalizeClass(self):
    output = ""
    output += "  /** Releases the C++ object. The caller must ensure no further access. */\n"
    output += "  delete(): void;\n"
    output += "  [Symbol.dispose](): void;\n"
    output += "}\n\n"
    return output

  def _emitTsConstructor(self, className, args, templateDecl, templateArgs, tplName, numOptional=0):
    """Emit a single TypeScript constructor signature, marking trailing args as optional."""
    parts = []
    nArgs = len(args)
    for i, arg in enumerate(args):
      name = self._argname(arg, i)
      typeName = self.resolve_type(arg.type, templateDecl, templateArgs)
      if i >= nArgs - numOptional:
        parts.append(f"{name}?: {typeName}")
      else:
        parts.append(f"{name}: {typeName}")
    argsStr = ", ".join(parts)
    output = self._jsdoc(className, className, "  ", param_count=nArgs, template_name=tplName)
    output += f"  constructor({argsStr});\n"
    return output

  def processSimpleConstructor(self, theClass, templateDecl = None, templateArgs = None):
    output = ""
    children = list(theClass.get_children())
    constructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR, children))
    className = getClassTypeName(theClass, templateDecl)
    tplName = theClass.spelling if templateDecl is not None else None

    if len(constructors) == 0:
      output += self._jsdoc(className, className, "  ", param_count=0, template_name=tplName)
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
        output += self._emitTsConstructor(className, actual_args[:arity] if actual_arity > arity else actual_args, templateDecl, templateArgs, tplName, numOptional=trailing_optional if actual_arity == arity else 0)
      else:
        tree = self._build_dispatch_tree(group, available_positions=list(range(arity)), templateDecl=templateDecl, templateArgs=templateArgs)
        ambiguous = self._collect_ambiguous_overloads(tree)
        distinguishable = [ov for ov in group if ov not in ambiguous]
        for ov in distinguishable:
          actual_args = list(ov.get_arguments())
          output += self._emitTsConstructor(className, actual_args[:arity], templateDecl, templateArgs, tplName)

    return output

  _NUMERIC_TYPES = frozenset({
    "int", "int16_t", "int32_t", "int64_t",
    "unsigned", "uint32_t", "uint64_t",
    "unsigned int", "unsigned long",
    "long", "long int", "long long",
    "unsigned long long", "unsigned short",
    "short", "short int",
    "float", "double", "long double",
    "size_t", "ptrdiff_t", "ssize_t",
    "Standard_Integer", "Standard_Real",
    "Standard_ShortReal", "Standard_Size",
    "Standard_Byte",
  })

  _STRING_TYPES = frozenset({
    "char", "unsigned char",
    "std::string", "std::string_view",
    "Standard_Character", "Standard_ExtCharacter",
    "Standard_CString", "Standard_WideChar",
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

  def _resolve_nested_type(self, decl):
    """Resolve nested C++ types (enum/class/struct inside a class) to Parent_Child format."""
    if not decl or decl.spelling == "":
      return None
    if decl.kind not in (clang.cindex.CursorKind.ENUM_DECL, clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
      return None
    parent = decl.semantic_parent
    if not parent or parent.kind not in (clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
      return None
    return parent.spelling + "_" + decl.spelling

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

  _reverse_typedef_cache = None

  def _find_typedef_for_container(self, container, clang_type):
    """Check if a container type (e.g., NCollection_Array1<gp_Pnt>) has a
    known typedef (e.g., TColgp_Array1OfPnt) that is a bound class."""
    if TypescriptBindings._reverse_typedef_cache is None:
      TypescriptBindings._reverse_typedef_cache = {}
      for underlying_spelling, typedef_cursor in self.tuInfo.typedefUnderlyingDict.items():
        clean = underlying_spelling.replace("const ", "").replace("&", "").strip()
        TypescriptBindings._reverse_typedef_cache[clean] = typedef_cursor.spelling

    type_spelling = clang_type.spelling.replace("const ", "").replace("&", "").replace("*", "").strip()
    return TypescriptBindings._reverse_typedef_cache.get(type_spelling)

  def _resolve_template_type(self, clang_type, templateDecl=None, templateArgs=None):
    """Resolve template types via AST, returning inner type for known containers."""
    t = clang_type
    numArgs = t.get_num_template_arguments()
    if numArgs <= 0:
      t = clang_type.get_canonical()
      numArgs = t.get_num_template_arguments()
      if numArgs <= 0:
        return None

    decl = t.get_declaration()
    if not decl:
      return None
    container = decl.spelling

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
      return "any"

    SINGLE_ARG_CONTAINERS = {
      "NCollection_Array1", "NCollection_Sequence", "NCollection_List",
      "NCollection_HArray1", "NCollection_HSequence",
      "NCollection_IndexedMap", "NCollection_Map",
    }

    if container in SINGLE_ARG_CONTAINERS:
      typedef_name = self._find_typedef_for_container(container, t)
      if typedef_name:
        return typedef_name
      inner = t.get_template_argument_type(0)
      return self.resolve_type(inner, templateDecl, templateArgs)

    if container in ("NCollection_DataMap", "NCollection_IndexedDataMap"):
      return "any"

    VEC_TUPLES = {
      "NCollection_Vec2": "[number, number]",
      "NCollection_Vec3": "[number, number, number]",
      "NCollection_Vec4": "[number, number, number, number]",
    }
    if container in VEC_TUPLES:
      return VEC_TUPLES[container]

    if container in self.exports:
      return container

    return "any"

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
    """Unwrap handle<T> and recursively resolve the inner type via AST."""
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

    handleInner = self._resolve_handle_recursive(t, templateDecl, templateArgs)
    if handleInner:
      return handleInner

    template_result = self._resolve_template_type(t, templateDecl, templateArgs)
    if template_result is not None:
      return template_result

    decl = t.get_declaration()
    nested = self._resolve_nested_type(decl)
    if nested:
      return nested if nested in self.exports else "any"

    canonical = t.get_canonical()
    kind = canonical.kind
    if kind in self._BUILTIN_NUMERIC_KINDS:
      return "number"
    if kind in self._BUILTIN_STRING_KINDS:
      return "string"
    if kind == clang.cindex.TypeKind.BOOL:
      return "boolean"
    if kind == clang.cindex.TypeKind.VOID:
      return "void"

    spelling = t.spelling.replace("&", "").replace("const", "").replace("*", "").strip()
    resolved = self.resolveWithCanonicalFallback(spelling, t, templateDecl, templateArgs)
    resolved = resolved.replace("&", "").replace("const", "").replace("*", "").strip()
    resolved = self.convertBuiltinTypes(resolved)

    if resolved in ("number", "string", "boolean", "void"):
      return resolved
    if resolved and resolved != "" and "(" not in resolved and ":" not in resolved and "<" not in resolved:
      return resolved

    canonical_spelling = canonical.spelling.replace("&", "").replace("const", "").replace("*", "").strip()
    canonical_spelling = self.convertBuiltinTypes(canonical_spelling)
    if canonical_spelling in ("number", "string", "boolean", "void"):
      return canonical_spelling
    if canonical_spelling and "(" not in canonical_spelling and ":" not in canonical_spelling and "<" not in canonical_spelling:
      if canonical_spelling in self.exports:
        return canonical_spelling

    if decl and decl.spelling and decl.spelling in self.exports:
      return decl.spelling

    print(f"could not generate proper types for type '{t.spelling}' (canonical: '{canonical.spelling}'), using 'any' instead.")
    return "any"

  def getTypescriptDefFromResultType(self, res, templateDecl = None, templateArgs = None):
    if res.spelling == "void":
      return "void"
    return self.resolve_type(res, templateDecl, templateArgs)

  def _argname(self, arg, suffix = ""):
    argname = (arg.spelling if not arg.spelling == "" else ("a" + str(suffix)))
    if argname in ["var", "with", "super"]:
      argname += "_"
    return argname

  def getTypescriptDefFromArg(self, arg, suffix = "", templateDecl = None, templateArgs = None):
    typeName = self.resolve_type(arg.type, templateDecl, templateArgs)
    return self._argname(arg, suffix) + ": " + typeName

  def processMethodOrProperty(self, theClass, method, templateDecl = None, templateArgs = None, overload_index = 0, override_postfix = None):
    output = ""
    if method.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and method.kind == clang.cindex.CursorKind.CXX_METHOD and not method.spelling.startswith("operator"):
      [overloadPostfix, numOverloads] = getMethodOverloadPostfix(theClass, method)
      if override_postfix is not None:
        overloadPostfix = override_postfix

      args = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x[1], x[0], templateDecl, templateArgs), enumerate(method.get_arguments()))))
      returnType = self.getTypescriptDefFromResultType(method.result_type, templateDecl, templateArgs)

      className = getClassTypeName(theClass, templateDecl)
      tplName = theClass.spelling if templateDecl is not None else None
      methodArgs = list(method.get_arguments())
      output += self._jsdoc(className, method.spelling, "  ", param_count=len(methodArgs), overload_index=overload_index, template_name=tplName)
      output += "  " + ("static " if method.is_static_method() else "") + method.spelling + overloadPostfix + "(" + args + "): " + returnType + ";\n"
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

    # Same-arity groups exist — determine which need _N suffix
    all_methods_of_name = [m for m in theClass.get_children()
                           if m.kind == clang.cindex.CursorKind.CXX_METHOD
                           and m.access_specifier == clang.cindex.AccessSpecifier.PUBLIC
                           and m.spelling == bindable[0].spelling]
    arity_idx_map = {}
    for arity, group in sorted(by_arity.items()):
      if len(group) == 1:
        idx = arity_idx_map.get(arity, 0)
        arity_idx_map[arity] = idx + 1
        args = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x[1], x[0], templateDecl, templateArgs), enumerate(group[0].get_arguments()))))
        returnType = self.getTypescriptDefFromResultType(group[0].result_type, templateDecl, templateArgs)
        methodArgs = list(group[0].get_arguments())
        output += self._jsdoc(className, group[0].spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName)
        output += "  " + ("static " if group[0].is_static_method() else "") + group[0].spelling + "(" + args + "): " + returnType + ";\n"
      else:
        def _ts_method_has_wrapper_args(m):
          return any(
            (m_arg.type.kind == clang.cindex.TypeKind.LVALUEREFERENCE and
             not m_arg.type.get_pointee().is_const_qualified() and (
               m_arg.type.get_pointee().get_canonical().spelling in builtInTypes or
               m_arg.type.get_pointee().get_canonical().kind == clang.cindex.TypeKind.ENUM
             ))
            or isCString(m_arg.type)
            or m_arg.type.get_canonical().spelling in unbindablePointerTypes
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
            args = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x[1], x[0], templateDecl, templateArgs), enumerate(ov.get_arguments()))))
            returnType = self.getTypescriptDefFromResultType(ov.result_type, templateDecl, templateArgs)
            methodArgs = list(ov.get_arguments())
            output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName)
            output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + "(" + args + "): " + returnType + ";\n"

          for ov in ambiguous:
            ovIdx = all_methods_of_name.index(ov) if ov in all_methods_of_name else 0
            suffix = "_" + str(ovIdx + 1)
            idx = arity_idx_map.get(arity, 0)
            arity_idx_map[arity] = idx + 1
            args = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x[1], x[0], templateDecl, templateArgs), enumerate(ov.get_arguments()))))
            returnType = self.getTypescriptDefFromResultType(ov.result_type, templateDecl, templateArgs)
            methodArgs = list(ov.get_arguments())
            is_primary = id(ov) in ambiguous_primaries
            if is_primary:
              output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName)
              output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + "(" + args + "): " + returnType + ";\n"
            output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName)
            output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + suffix + "(" + args + "): " + returnType + ";\n"

        for ov in wrapper_methods:
          ovIdx = all_methods_of_name.index(ov) if ov in all_methods_of_name else 0
          suffix = "_" + str(ovIdx + 1)
          idx = arity_idx_map.get(arity, 0)
          arity_idx_map[arity] = idx + 1
          args = ", ".join(list(map(lambda x: self.getTypescriptDefFromArg(x[1], x[0], templateDecl, templateArgs), enumerate(ov.get_arguments()))))
          returnType = self.getTypescriptDefFromResultType(ov.result_type, templateDecl, templateArgs)
          methodArgs = list(ov.get_arguments())
          output += self._jsdoc(className, ov.spelling, "  ", param_count=len(methodArgs), overload_index=idx, template_name=tplName)
          output += "  " + ("static " if ov.is_static_method() else "") + ov.spelling + suffix + "(" + args + "): " + returnType + ";\n"

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
      output += self._jsdoc(name, name, "  ", param_count=nargs, overload_index=arity_idx, template_name=tplName)
      output += "  export declare class " + name + overloadPostfix + " extends " + name + " {\n"
      output += self._jsdoc(name, name, "    ", param_count=nargs, overload_index=arity_idx, template_name=tplName)
      output += "    constructor(" + argsTypescriptDef + ");\n"
      output += "  }\n\n"
      allOverloadedConstructors.append(name + overloadPostfix)
    self.exports.extend(allOverloadedConstructors)
    return output

  def processEnum(self, theEnum):
    output = ""
    enumName = theEnum.spelling
    output += "export type " + enumName + " = typeof " + enumName + "[keyof typeof " + enumName + "];\n"
    output += self._jsdoc(enumName)
    output += "export declare const " + enumName + ": {\n"
    for enumChild in list(theEnum.get_children()):
      output += self._enum_member_jsdoc(enumName, enumChild.spelling)
      output += "  readonly " + enumChild.spelling + ": '" + enumChild.spelling + "';\n"
    output += "};\n\n"
    self.exports.append(enumName)
    return output

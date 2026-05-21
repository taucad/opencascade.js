"""Embind constructor codegen (Phase 2 PR 2.3).

Owns:

* :func:`emit_constructor` — single binding, with optional_override fallback
  for Handle wrapping or CString conversion
* :func:`process_simple_constructor` — primary constructor pipeline
  (single ctor + arity-grouped multi-ctors with default-param expansion and
  val-based dispatch)
* :func:`process_overloaded_constructors` — `_N`-suffixed subclass bindings
  for genuinely ambiguous overloads
* :func:`rewrite_typedef_nested_types` — template typedef rewrite helper
"""

from __future__ import annotations

from collections import defaultdict

import clang.cindex

from filter.filterMethodOrProperties import filterMethodOrProperty

from ocjs_bindgen.codegen import dispatch as _dispatch
from ocjs_bindgen.codegen.wasm_common import SkipException, isTransientDerived
from ocjs_bindgen.naming.cpp import getClassQualifiedName, getClassTypeName
from ocjs_bindgen.naming.ts import getClassJsPublicName
from ocjs_bindgen.predicates.types import isCString, isRawPointerParam


def rewrite_typedef_nested_types(type_str, class_cpp, underlying_spelling, template_decl):
  """Template typedefs (e.g. `BndBox2dTreeFiller` -> `NCollection_UBTreeFiller<int,Bnd_Box2d>`)
  need nested names like ``Underlying::UBTree`` rewritten to ``class_cpp::UBTree`` so
  constructor templates instantiate the typedef's nested members, not an unspecialized template.
  """
  if template_decl is None or not underlying_spelling or not class_cpp:
    return type_str
  prefix = underlying_spelling + "::"
  if prefix not in type_str:
    return type_str
  return type_str.replace(prefix, class_cpp + "::")


def emit_constructor(b, class_cpp, args, template_decl, template_args, use_handle_override, underlying_spelling=None):
  """Emit a single constructor binding, using optional_override for Handle wrapping or CString conversion."""
  def rw(s):
    return rewrite_typedef_nested_types(s, class_cpp, underlying_spelling, template_decl)

  has_c_string = any(isCString(a.type) for a in args)
  needs_raw = any(isRawPointerParam(a.type) and not isCString(a.type) for a in args)

  if not use_handle_override and not has_c_string and not needs_raw:
    arg_types_bindings = ", ".join([
      rw(b.getSingleArgumentBinding(False, True, template_decl, template_args)(arg)[0])
      for arg in args
    ])
    return "    .constructor<" + arg_types_bindings + ">()\n"

  named_args = []
  for i, arg in enumerate(args):
    name = arg.spelling if arg.spelling else f"a{i}"
    type_str = rw(b.getSingleArgumentBinding(False, True, template_decl, template_args)(arg)[0])
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


def process_simple_constructor(b, theClass, templateDecl=None, templateArgs=None):
  """Emit the primary constructor binding for a class (single, multi-arity, or val-dispatched)."""
  output = ""
  children = list(theClass.get_children())
  constructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR, children))
  className = getClassTypeName(theClass, templateDecl)
  if className == "":
    className = theClass.type.spelling
  classCpp = getClassQualifiedName(theClass, templateDecl)
  if not classCpp:
    classCpp = className
  useHandleOverride = isTransientDerived(theClass, b.tuInfo.classDict)
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

  filtered = b._filter_overloads(publicConstructors)
  filtered = [c for c in filtered if filterMethodOrProperty(theClass, c)]
  bindable = []
  for c in filtered:
    try:
      b._checkUnbindableArgs("constructor", theClass.spelling, list(c.get_arguments()))
      bindable.append(c)
    except SkipException as e:
      print(str(e))

  if len(bindable) == 0:
    return output

  if len(bindable) == 1:
    args = list(bindable[0].get_arguments())
    output += emit_constructor(b, classCpp, args, templateDecl, templateArgs, useHandleOverride, underlying_spelling)
    nDefaults = b._countTrailingDefaults(bindable[0])
    nArgs = len(args)
    for d in range(1, nDefaults + 1):
      truncated = args[:nArgs - d]
      output += emit_constructor(b, classCpp, truncated, templateDecl, templateArgs, useHandleOverride, underlying_spelling)
    return output

  by_arity = defaultdict(list)
  for c in bindable:
    by_arity[len(list(c.get_arguments()))].append(c)

  default_expansions = []
  for c in bindable:
    nDefaults = b._countTrailingDefaults(c)
    nArgs = len(list(c.get_arguments()))
    for d in range(1, nDefaults + 1):
      trunc_arity = nArgs - d
      default_expansions.append((c, trunc_arity))

  for c, trunc_arity in default_expansions:
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
      emit_args = actual_args[:arity]
      output += emit_constructor(b, classCpp, emit_args, templateDecl, templateArgs, useHandleOverride, underlying_spelling)
    else:
      js_tree = b._build_js_dispatch_tree(group, available_positions=list(range(arity)), templateDecl=templateDecl, templateArgs=templateArgs)
      js_ambiguous = _dispatch.collect_ambiguous_overloads(js_tree)
      js_distinguishable = [c for c in group if c not in js_ambiguous]

      for c in js_distinguishable:
        actual_args = list(c.get_arguments())[:arity]
        output += emit_constructor(b, classCpp, actual_args, templateDecl, templateArgs, useHandleOverride, underlying_spelling)

      if js_ambiguous:
        val_tree = _dispatch.build_dispatch_tree(b, js_ambiguous, available_positions=list(range(arity)), templateDecl=templateDecl, templateArgs=templateArgs)
        val_ambiguous_remaining = _dispatch.collect_ambiguous_overloads(val_tree)

        if val_ambiguous_remaining:
          val_dispatchable = [c for c in js_ambiguous if c not in val_ambiguous_remaining]
        else:
          val_dispatchable = []

        if val_dispatchable or (js_ambiguous and not val_ambiguous_remaining):
          output += _dispatch.emit_val_dispatch_constructor(b, classCpp, arity, val_tree, useHandleOverride, templateDecl, templateArgs)

  return output


def process_overloaded_constructors(b, theClass, children=None, templateDecl=None, templateArgs=None):
  """Emit `_N` subclass bindings ONLY for genuinely ambiguous constructor overloads."""
  output = ""
  if children is None:
    children = list(theClass.get_children())
  constructors = list(filter(lambda x: x.kind == clang.cindex.CursorKind.CONSTRUCTOR and x.access_specifier == clang.cindex.AccessSpecifier.PUBLIC, children))
  if len(constructors) <= 1:
    return output

  filtered = b._filter_overloads(constructors)
  filtered = [c for c in filtered if filterMethodOrProperty(theClass, c)]
  bindable = []
  for c in filtered:
    try:
      b._checkUnbindableArgs("constructor", theClass.spelling, list(c.get_arguments()))
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
    tree = _dispatch.build_dispatch_tree(b, group, templateDecl=templateDecl, templateArgs=templateArgs)
    ambiguous_ctors.extend(_dispatch.collect_ambiguous_overloads(tree))

  if not ambiguous_ctors:
    return output

  useHandleOverride = isTransientDerived(theClass, b.tuInfo.classDict)
  name = getClassJsPublicName(theClass, templateDecl)
  qual = getClassQualifiedName(theClass, templateDecl)
  if not qual:
    qual = name
  allOverloads = constructors

  for constructor in ambiguous_ctors:
    try:
      overloadPostfix = "_" + str(allOverloads.index(constructor) + 1)
      args = ", ".join(list(map(lambda x: ("std::string " + x.spelling) if isCString(x.type) else b.getSingleArgumentBinding(True, True, templateDecl, templateArgs)(x)[0], constructor.get_arguments())))
      argNames = ", ".join(list(map(lambda x: (x.spelling + ".c_str()") if isCString(x.type) else x.spelling, constructor.get_arguments())))
      argTypes = ", ".join(list(map(lambda x: "std::string" if isCString(x.type) else b.getSingleArgumentBinding(False, True, templateDecl, templateArgs)(x)[0], constructor.get_arguments())))

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

import re

# Detect `Outer::Nested<…>` at the start of an underlying type spelling. We
# admit aliases whose underlying is a nested-class-template instantiation of
# a top-level class (e.g. `BRepGraph_NodeId::Typed<BRepGraph_NodeId::Kind::
# Product>` exposed via `using BRepGraph_ProductId = …`). The downstream
# bindgen will then drive class binding from the canonical instantiation and
# emit the alias as the JS public name. Restricted to a SINGLE `Outer::Nested`
# component so deeper paths (`A::B::C<…>`) still flow through the existing
# heuristics — keeping the change scoped to OCCT's typed-id pattern.
_NESTED_TPL_PATTERN = re.compile(r"^[A-Za-z_]\w*::[A-Za-z_]\w*<")

# Stdlib / Emscripten internal namespace prefixes whose templated typedefs we
# must NEVER bind. Without this guard, OCCT V8 typedefs like
# `typedef std::deque<gp_Pnt, NCollection_OccAllocator<gp_Pnt>> SequenceOfPnt`
# (declared inside `namespace IMeshData::Model`) get admitted by the nested-
# template heuristic above (their underlying spelling matches
# `^std::deque<…>`) and the bindings generator then emits a
# `class_<IMeshData::Model::SequenceOfPnt>(…)` referencing libc++ inline-
# namespace internals (`__1::deque`, `__cxxabiv1::…`) which never compile.
# Restrict the heuristic to OCCT-rooted nested templates only.
_STDLIB_NS_PREFIXES = (
  "std::",
  "__1::",
  "__gnu_cxx::",
  "__cxxabiv1::",
  "emscripten::",
)


def filterTypedef(typedef, additionalInfo=None):
  # Name-based typedef exclusions are in bindgen-filters.yaml.
  # Only semantic/AST checks remain here.

  # ::Iterator typedefs cause extreme memory growth which fails the build
  if "::Iterator" in typedef.underlying_typedef_type.spelling:
    return False

  underlying = typedef.underlying_typedef_type.spelling
  if typedef.location.file.name == "myMain.h" or underlying.startswith((
    "opencascade::handle",
    "handle",
    "NCollection",
    # OCCT V8 collapsed the per-instantiation curve/surface local-property
    # classes (BRepLProp_SLProps, GeomLProp_SLProps, HLRBRep_SLProps, …)
    # into a single template family rooted at GeomLProp_*PropsBase<…> and
    # surfaces each public class via `using X = GeomLProp_*PropsBase<…>;`.
    # Without this prefix the LProps curvature API is unreachable from JS
    # and there is no public-facade alternative.
    # See docs/research/ocjs-removed-bindings-stocktake.md (Recipe R-P1).
    "GeomLProp_",
  )):
    return True

  if underlying.startswith(_STDLIB_NS_PREFIXES):
    return False

  if _NESTED_TPL_PATTERN.match(underlying):
    return True

  return False

from __future__ import annotations

from dataclasses import dataclass

from ocjs_bindgen.codegen import dispatch
from ocjs_bindgen.codegen.embind import constructor


@dataclass(frozen=True)
class _JsType:
  category: str
  name: str


@dataclass
class _Argument:
  type: _JsType


class _Constructor:
  def __init__(self, name: str, types: list[_JsType], trailing_defaults: int = 0):
    self.name = name
    self.arguments = [_Argument(argument_type) for argument_type in types]
    self.trailing_defaults = trailing_defaults

  def get_arguments(self):
    return iter(self.arguments)


class _Bindings:
  @staticmethod
  def _classify_js_type(argument_type, _template_decl=None, _template_args=None):
    return argument_type

  @staticmethod
  def _countTrailingDefaults(candidate):
    return candidate.trailing_defaults


NUMBER = _JsType("number_int", "number")
MULTI_LINE = _JsType("object", "BRepApprox_TheMultiLineOfApprox")
VECTOR = _JsType("object", "math_VectorBase_double")


def test_merged_primary_family_guard_precedes_internal_dispatch(monkeypatch) -> None:
  primary_number = _Constructor("primary-number", [MULTI_LINE, NUMBER])
  primary_vector = _Constructor("primary-vector", [MULTI_LINE, VECTOR])
  fallback_number = _Constructor("fallback-number", [NUMBER], trailing_defaults=1)
  fallback_vector = _Constructor("fallback-vector", [VECTOR])
  tree = dispatch.DispatchBranch(
    arg_position=1,
    branches={
      NUMBER: dispatch.DispatchLeaf(primary_number),
      VECTOR: dispatch.DispatchLeaf(primary_vector),
    },
  )
  internal_check = 'Number").call<bool>("isInteger", arg1)'

  monkeypatch.setattr(
    constructor,
    "_merged_default_aware_tree",
    lambda _b, subtree, *_args, **_kwargs: (
      f"dispatch-{type(subtree).__name__}-{internal_check};\n"
    ),
  )

  rendered = constructor._emit_primary_chain_with_fallback(
    _Bindings(),
    tree,
    "Candidate",
    2,
    False,
    None,
    None,
    None,
    0,
    "fallback;\n",
    [fallback_number, fallback_vector],
  )

  shared_leading_check = 'arg0.instanceof(emscripten::val::module_property("BRepApprox_TheMultiLineOfApprox"))'
  assert shared_leading_check in rendered
  assert internal_check in rendered
  assert rendered.index(shared_leading_check) < rendered.index(internal_check)


def test_merged_fallback_routes_undefined_to_defaultable_branch(monkeypatch) -> None:
  numeric = _Constructor("numeric", [NUMBER], trailing_defaults=1)
  vector = _Constructor("vector", [VECTOR])
  tree = dispatch.DispatchBranch(
    arg_position=0,
    branches={
      NUMBER: dispatch.DispatchLeaf(numeric),
      VECTOR: dispatch.DispatchLeaf(vector),
    },
  )

  monkeypatch.setattr(
    constructor,
    "_emit_ctor_call_from_val_args",
    lambda _b, _class, candidate, *_args, **_kwargs: f"return {candidate.name};\n",
  )

  rendered = constructor._merged_default_aware_tree(
    _Bindings(),
    tree,
    "Candidate",
    1,
    False,
    None,
    None,
    None,
    0,
  )

  undefined_check = "if (arg0.isUndefined())"
  assert undefined_check in rendered
  assert rendered.index(undefined_check) < rendered.index("return numeric;")

from collections import namedtuple

from ocjs_bindgen.codegen.typescript.constructor import (
    dedupe_js_equivalent_constructors,
)

JsType = namedtuple("JsType", ["category", "name"])


class _Argument:
    def __init__(self, category: str):
        self.type = category


class _Constructor:
    def __init__(self, *categories: str, defaults: int = 0):
        self.arguments = [_Argument(category) for category in categories]
        self.defaults = defaults

    def get_arguments(self):
        return self.arguments


class _Binder:
    def _classify_js_type(self, type_, template_decl, template_args):
        return JsType(type_, type_)

    def _countTrailingDefaults(self, constructor):
        return constructor.defaults


def test_dedupes_cpp_constructors_with_the_same_javascript_signature() -> None:
    string_view = _Constructor("string")
    c_string = _Constructor("string")
    character = _Constructor("string_char")

    result = dedupe_js_equivalent_constructors(
        _Binder(),
        [string_view, c_string, character],
    )

    assert result == [string_view, character]


def test_prefers_the_equivalent_constructor_with_more_trailing_defaults() -> None:
    required = _Constructor("object", "boolean")
    optional = _Constructor("object", "boolean", defaults=1)

    result = dedupe_js_equivalent_constructors(
        _Binder(),
        [required, optional],
    )

    assert result == [optional]

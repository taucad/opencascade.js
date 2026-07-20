from dataclasses import dataclass

from ocjs_bindgen.codegen.dispatch import (
    DispatchBranch,
    DispatchLeaf,
    _emit_branch_chain,
    dispatch_primitive_sort_key,
)


@dataclass(frozen=True)
class _JsType:
    category: str
    name: str = "string"


def test_character_dispatch_precedes_general_string_dispatch() -> None:
    branches = {
        _JsType("string"): DispatchLeaf("whole-string"),
        _JsType("string_char"): DispatchLeaf("single-character"),
    }

    rendered = _emit_branch_chain(
        lambda subtree, indent: f'{" " * indent}{subtree.overload};\n',
        DispatchBranch(arg_position=0, branches=branches),
        "",
    )

    character_check = 'arg0["length"].as<unsigned>() == 1'
    assert character_check in rendered
    assert rendered.index(character_check) < rendered.index("single-character")
    assert rendered.index("single-character") < rendered.index("whole-string")


def test_character_sort_key_precedes_general_string() -> None:
    character = dispatch_primitive_sort_key((_JsType("string_char"), None))
    whole_string = dispatch_primitive_sort_key((_JsType("string"), None))

    assert character < whole_string

from __future__ import annotations

import clang.cindex

from ocjs_bindgen.predicates.classes import _hasImplicitDestructorWithIncompleteValueField
from tests.conftest import _MockType, cursor_mock


def test_implicit_destructor_rejects_incomplete_template_field_value() -> None:
  owner = cursor_mock(
    kind=clang.cindex.CursorKind.CLASS_DECL,
    spelling="Owner",
  )
  incomplete = cursor_mock(
    kind=clang.cindex.CursorKind.STRUCT_DECL,
    spelling="Slot",
    get_definition=lambda: None,
    semantic_parent=owner,
  )
  slot_type = _MockType(
    spelling="Owner::Slot",
    kind=clang.cindex.TypeKind.RECORD,
    declaration=incomplete,
  )
  container_type = _MockType(
    spelling="Vector<Owner::Slot>",
    kind=clang.cindex.TypeKind.RECORD,
    template_args=[slot_type],
  )
  field = cursor_mock(
    kind=clang.cindex.CursorKind.FIELD_DECL,
    spelling="mySlots",
    type=container_type,
  )
  owner.get_children = lambda: iter([field])

  assert _hasImplicitDestructorWithIncompleteValueField(owner)

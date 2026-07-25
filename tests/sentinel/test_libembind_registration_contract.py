from __future__ import annotations

from pathlib import Path


PATCH = Path(__file__).parents[2] / "src" / "patches" / "libembind-overloading.patch"


def test_should_promote_first_member_and_static_registration_to_owned_dispatchers() -> None:
  source = PATCH.read_text()

  assert "createOwnedSignatureDispatcher" in source
  assert "proto[methodName] = createOwnedSignatureDispatcher" in source
  assert "First registrations use the same owned dispatcher representation" in source

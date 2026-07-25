from __future__ import annotations

import json
from pathlib import Path

import pytest

from ocjs_bindgen.build_state import (
  build_content_ledger,
  materialize_ledger,
  replace_tree,
)


def test_should_build_the_same_ledger_for_reversed_creation_order(tmp_path: Path) -> None:
  first = tmp_path / "first"
  second = tmp_path / "second"
  first.mkdir()
  second.mkdir()
  for root, names in ((first, ("b/file.txt", "a/file.txt")), (second, ("a/file.txt", "b/file.txt"))):
    for name in names:
      path = root / name
      path.parent.mkdir(parents=True, exist_ok=True)
      path.write_text(name)

  assert build_content_ledger(first) == build_content_ledger(second)


def test_should_change_identity_when_equal_size_content_changes(tmp_path: Path) -> None:
  root = tmp_path / "root"
  root.mkdir()
  path = root / "value.txt"
  path.write_text("first")
  first = build_content_ledger(root)
  path.write_text("other")

  assert build_content_ledger(root)["sha256"] != first["sha256"]


def test_should_reject_duplicate_logical_paths_with_every_source(tmp_path: Path) -> None:
  root = tmp_path / "root"
  for name in ("one/Shared.cpp.o", "two/Shared.cpp.o"):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(name.encode())

  with pytest.raises(ValueError) as exc_info:
    build_content_ledger(root, logical_name=lambda path: path.name)

  message = str(exc_info.value)
  assert "one/Shared.cpp.o" in message
  assert "two/Shared.cpp.o" in message


def test_should_preserve_live_tree_when_staged_publication_fails(tmp_path: Path) -> None:
  destination = tmp_path / "destination"
  destination.mkdir()
  (destination / "kept.txt").write_text("kept")

  def fail(stage: Path) -> None:
    (stage / "partial.txt").write_text("partial")
    raise RuntimeError("injected failure")

  with pytest.raises(RuntimeError, match="injected failure"):
    replace_tree(destination, fail)

  assert sorted(path.name for path in destination.iterdir()) == ["kept.txt"]


def test_should_materialize_exact_files_without_clobbering_unowned_content(tmp_path: Path) -> None:
  source = tmp_path / "source"
  destination = tmp_path / "destination"
  source.mkdir()
  destination.mkdir()
  (source / "owned.js").write_text("new")
  (destination / "owned.js").write_text("old")
  (destination / "consumer.yml").write_text("keep")
  ledger = build_content_ledger(source)

  materialize_ledger(source, destination, ledger)

  assert (destination / "owned.js").read_text() == "new"
  assert (destination / "consumer.yml").read_text() == "keep"
  assert json.loads((destination / ".ocjs-artifacts.json").read_text()) == ledger

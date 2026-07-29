"""Identity guard for the single incremental OCCT CMake scratch tree."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from ocjs_bindgen.build_state import (
  _write_json_atomic,
  build_content_ledger,
  replace_tree,
)


class CMakeState:
  def __init__(self, scratch: Path) -> None:
    self.scratch = scratch
    self.state_path = scratch / ".ocjs-cmake-state.json"

  def _read(self) -> dict[str, Any] | None:
    try:
      return json.loads(self.state_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
      return None

  def prepare(self, identity: str) -> bool:
    current = self._read()
    if current == {"schema": "ocjs-cmake-state-v1", "identity": identity, "complete": True}:
      _write_json_atomic(self.state_path, {
        "schema": "ocjs-cmake-state-v1",
        "identity": identity,
        "complete": False,
      })
      return True
    shutil.rmtree(self.scratch, ignore_errors=True)
    self.scratch.mkdir(parents=True)
    _write_json_atomic(self.state_path, {
      "schema": "ocjs-cmake-state-v1",
      "identity": identity,
      "complete": False,
    })
    return False

  def complete(self, identity: str) -> None:
    current = self._read()
    if current is None or current.get("identity") != identity:
      raise ValueError("cannot complete CMake scratch with a different identity")
    _write_json_atomic(self.state_path, {
      "schema": "ocjs-cmake-state-v1",
      "identity": identity,
      "complete": True,
    })

  @staticmethod
  def publish_libraries(source: Path, destination: Path, *, identity: str) -> dict[str, Any]:
    source = source.resolve()
    libraries = sorted(source.glob("*.a"), key=lambda path: path.name)
    if not libraries:
      raise ValueError(f"no static libraries found in {source}")
    names = [path.name for path in libraries]
    if len(names) != len(set(names)):
      raise ValueError(f"duplicate static library names: {names}")

    manifest: dict[str, Any] = {}

    def populate(stage: Path) -> None:
      nonlocal manifest
      for library in libraries:
        shutil.copyfile(library, stage / library.name)
      ledger = build_content_ledger(stage)
      manifest = {
        "schema": "ocjs-cmake-libraries-v1",
        "identity": identity,
        "sha256": ledger["sha256"],
        "files": ledger["files"],
      }
      _write_json_atomic(stage / "manifest.json", manifest)

    replace_tree(destination, populate)
    return manifest

from __future__ import annotations

import os
from pathlib import Path

import pytest

import compileBindings


def test_should_rebuild_when_source_bytes_change_without_newer_mtime(
  tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
  source = tmp_path / "Binding.cpp"
  object_path = tmp_path / "Binding.cpp.o"
  source.write_text("first")
  object_path.write_bytes(b"object")
  old_mtime = object_path.stat().st_mtime
  source.write_text("other")
  os.utime(source, (old_mtime - 10, old_mtime - 10))
  monkeypatch.setattr(compileBindings, "_cpp_to_object_path", lambda _path: str(object_path))

  assert compileBindings.object_needs_build(str(source), str(object_path), ["emcc", "-O2"])


def test_should_change_object_identity_for_semantic_compiler_inputs(tmp_path: Path) -> None:
  source = tmp_path / "Binding.cpp"
  pch = tmp_path / "pch.h.pch"
  source.write_text("binding")
  pch.write_bytes(b"pch")
  baseline = compileBindings.object_identity(
    str(source),
    ["emcc", "-O2"],
    pch_path=str(pch),
    dependency_identity="deps-a",
    generator_identity="generator-a",
    compiler_identity="emcc-a",
  )

  variants = [
    (["emcc", "-O3"], str(pch), "deps-a", "generator-a", "emcc-a"),
    (["emcc", "-O2"], str(pch), "deps-b", "generator-a", "emcc-a"),
    (["emcc", "-O2"], str(pch), "deps-a", "generator-b", "emcc-a"),
    (["emcc", "-O2"], str(pch), "deps-a", "generator-a", "emcc-b"),
  ]
  for argv, pch_path, dependency, generator, compiler in variants:
    assert compileBindings.object_identity(
      str(source),
      argv,
      pch_path=pch_path,
      dependency_identity=dependency,
      generator_identity=generator,
      compiler_identity=compiler,
    ) != baseline

  pch.write_bytes(b"changed")
  assert compileBindings.object_identity(
    str(source),
    ["emcc", "-O2"],
    pch_path=str(pch),
    dependency_identity="deps-a",
    generator_identity="generator-a",
    compiler_identity="emcc-a",
  ) != baseline


def test_should_not_accept_partial_object_when_compiler_fails(
  tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
  source = tmp_path / "Binding.cpp"
  object_path = tmp_path / "Binding.cpp.o"
  source.write_text("binding")

  class Failed:
    returncode = 1
    stderr = "error: injected"

  def fail(command: list[str], **_kwargs: object) -> Failed:
    Path(command[command.index("-o") + 1]).write_bytes(b"partial")
    return Failed()

  monkeypatch.setattr(compileBindings.subprocess, "run", fail)

  result = compileBindings.compile_atomic(["emcc", "-c", str(source)], object_path)

  assert result.returncode == 1
  assert not object_path.exists()
  assert list(tmp_path.glob("*.tmp-*")) == []

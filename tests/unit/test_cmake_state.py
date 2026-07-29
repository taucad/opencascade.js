from __future__ import annotations

from pathlib import Path

from ocjs_bindgen.cmake_state import CMakeState


def test_should_reuse_only_complete_matching_cmake_state(tmp_path: Path) -> None:
  scratch = tmp_path / "occt-cmake"
  state = CMakeState(scratch)

  assert not state.prepare("A")
  state.complete("A")
  (scratch / "incremental.o").write_bytes(b"keep")
  assert state.prepare("A")
  assert (scratch / "incremental.o").exists()

  assert not state.prepare("B")
  assert not (scratch / "incremental.o").exists()
  state.complete("B")

  assert not state.prepare("A")


def test_should_reject_incomplete_state_after_interruption(tmp_path: Path) -> None:
  scratch = tmp_path / "occt-cmake"
  state = CMakeState(scratch)
  state.prepare("A")
  (scratch / "partial.a").write_bytes(b"partial")

  assert not CMakeState(scratch).prepare("A")
  assert not (scratch / "partial.a").exists()


def test_should_publish_sorted_relative_static_library_inventory(tmp_path: Path) -> None:
  source = tmp_path / "source"
  destination = tmp_path / "published"
  source.mkdir()
  for name in ("libB.a", "libA.a"):
    (source / name).write_bytes(name.encode())

  manifest = CMakeState.publish_libraries(source, destination, identity="A")

  assert [entry["path"] for entry in manifest["files"]] == ["libA.a", "libB.a"]
  assert all(not Path(entry["path"]).is_absolute() for entry in manifest["files"])
  assert (destination / "manifest.json").exists()

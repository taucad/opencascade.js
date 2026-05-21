"""Per-YAML NCollection reachability filter for the link step.

Covers `_compute_yaml_class_scope` and `_filter_auto_symbols_by_scope`
in `ocjs_bindgen.link.yaml_build`. Asserts that auto-discovered NCollection
entries are dropped when their source class is outside the consumer YAML's
reachable scope, and kept when an in-scope class's method signature mentions them.
"""

from __future__ import annotations

import json
import os

import pytest

from ocjs_bindgen.link.yaml_build import (
  _CUSTOM_CODE_SOURCE_TAG,
  _compute_yaml_class_scope,
  _filter_auto_symbols_by_scope,
)


# ----------------------------------------------------------------------------
# `_compute_yaml_class_scope` — direct bindings, ancestors, custom code.
# ----------------------------------------------------------------------------


def _write_dts_fragment(library_base, package, stem, ancestors):
  """Write a synthetic `.d.ts.json` fragment with the given ancestor chains."""
  dirpath = os.path.join(library_base, "bindings", package)
  os.makedirs(dirpath, exist_ok=True)
  payload = {
    ".d.ts": "",
    "kind": "class",
    "exports": [stem],
    "ancestors": ancestors,
  }
  with open(os.path.join(dirpath, f"{stem}.d.ts.json"), "w") as f:
    json.dump(payload, f)


def _build_config(symbols, extra_builds=None):
  return {
    "mainBuild": {"name": "test.js", "bindings": [{"symbol": s} for s in symbols]},
    "extraBuilds": extra_builds or [],
  }


def test_scope_includes_direct_bindings(tmp_path) -> None:
  scope = _compute_yaml_class_scope(_build_config(["gp_Pnt", "TopoDS_Shape"]), str(tmp_path))
  assert {"gp_Pnt", "TopoDS_Shape"} <= scope


def test_scope_includes_custom_sentinel(tmp_path) -> None:
  scope = _compute_yaml_class_scope(_build_config(["gp_Pnt"]), str(tmp_path))
  assert _CUSTOM_CODE_SOURCE_TAG in scope


def test_scope_includes_extra_builds_bindings(tmp_path) -> None:
  config = _build_config(
    ["gp_Pnt"],
    extra_builds=[{"name": "extra.js", "bindings": [{"symbol": "Geom_Curve"}]}],
  )
  scope = _compute_yaml_class_scope(config, str(tmp_path))
  assert {"gp_Pnt", "Geom_Curve"} <= scope


def test_scope_lifts_ancestor_chains_from_dts_fragments(tmp_path) -> None:
  """Binding `BRepBuilderAPI_MakeEdge` should automatically pull in
  `BRepBuilderAPI_MakeShape` and `BRepBuilderAPI_Command` via the
  serialised ancestor chain — those parents' NCollection-touching
  methods are inherited and therefore reachable from JS.
  """
  _write_dts_fragment(
    str(tmp_path), "ModelingAlgorithms/TKBO/BRepBuilderAPI", "BRepBuilderAPI_MakeEdge",
    ancestors={"BRepBuilderAPI_MakeEdge": ["BRepBuilderAPI_MakeShape", "BRepBuilderAPI_Command"]},
  )
  scope = _compute_yaml_class_scope(
    _build_config(["BRepBuilderAPI_MakeEdge"]), str(tmp_path)
  )
  assert {"BRepBuilderAPI_MakeEdge", "BRepBuilderAPI_MakeShape", "BRepBuilderAPI_Command"} <= scope


def test_scope_includes_custom_code_class_names(tmp_path) -> None:
  """Custom-code classes compiled into `build/bindings/myMain.h/` must
  enter the scope so any NCollection their methods reference survives
  the link filter."""
  custom_dir = os.path.join(str(tmp_path), "bindings", "myMain.h")
  os.makedirs(custom_dir)
  with open(os.path.join(custom_dir, "BRepToolsWrapper.d.ts.json"), "w") as f:
    json.dump({".d.ts": "", "kind": "class", "exports": ["BRepToolsWrapper"]}, f)
  with open(os.path.join(custom_dir, "ReplicadMeshData.d.ts.json"), "w") as f:
    json.dump({".d.ts": "", "kind": "class", "exports": ["ReplicadMeshData"]}, f)

  scope = _compute_yaml_class_scope(_build_config(["gp_Pnt"]), str(tmp_path))
  assert {"BRepToolsWrapper", "ReplicadMeshData"} <= scope


def test_scope_skips_ncollection_stems_under_mymain(tmp_path) -> None:
  """Auto-NCollection fragments live alongside custom-code classes in
  `build/bindings/myMain.h/` due to cross-YAML cache reuse. They must
  NOT enter scope — R2 source_classes are always OCCT class names, so
  an NCollection mangled name would never participate in a real
  intersection, and including it would just inflate the |scope|= log
  count misleadingly."""
  custom_dir = os.path.join(str(tmp_path), "bindings", "myMain.h")
  os.makedirs(custom_dir)
  # Real consumer custom class.
  with open(os.path.join(custom_dir, "BRepToolsWrapper.d.ts.json"), "w") as f:
    json.dump({".d.ts": "", "kind": "class", "exports": ["BRepToolsWrapper"]}, f)
  # Auto-generated NCollection fragment cached from a prior build.
  with open(os.path.join(custom_dir, "NCollection_Array1_TopoDS_Shape.d.ts.json"), "w") as f:
    json.dump({".d.ts": "", "kind": "class", "exports": ["NCollection_Array1_TopoDS_Shape"]}, f)

  scope = _compute_yaml_class_scope(_build_config(["gp_Pnt"]), str(tmp_path))
  assert "BRepToolsWrapper" in scope
  assert "NCollection_Array1_TopoDS_Shape" not in scope


def test_scope_ignores_bindings_dir_when_absent(tmp_path) -> None:
  """A pristine workspace with no `build/bindings/` must not crash —
  the scope falls back to direct bindings + sentinel only."""
  scope = _compute_yaml_class_scope(_build_config(["gp_Pnt"]), str(tmp_path))
  assert scope == {"gp_Pnt", _CUSTOM_CODE_SOURCE_TAG}


# ----------------------------------------------------------------------------
# `_filter_auto_symbols_by_scope` — reachability intersection + transitive
# closure + fail-loud guard.
# ----------------------------------------------------------------------------


def _write_manifest(tmp_path, declarations):
  manifest_path = os.path.join(str(tmp_path), "ncollection-manifest.json")
  with open(manifest_path, "w") as f:
    json.dump(
      {
        "symbols": sorted(d["mangled_name"] for d in declarations),
        "declarations": declarations,
      },
      f,
    )
  return manifest_path


def test_filter_keeps_entries_whose_source_intersects_yaml_scope(tmp_path) -> None:
  manifest = _write_manifest(tmp_path, [
    {
      "mangled_name": "NCollection_Array1_gp_Pnt",
      "container": "NCollection_Array1",
      "args": ["gp_Pnt"],
      "source_classes": ["TColgp_Array1OfPnt"],
    },
  ])
  kept = _filter_auto_symbols_by_scope(manifest, {"TColgp_Array1OfPnt"})
  assert kept == {"NCollection_Array1_gp_Pnt"}


def test_filter_drops_entries_whose_source_is_out_of_scope(tmp_path) -> None:
  manifest = _write_manifest(tmp_path, [
    {
      "mangled_name": "NCollection_DynamicArray_BRepGraphInc_VertexRef",
      "container": "NCollection_DynamicArray",
      "args": ["BRepGraphInc_VertexRef"],
      "source_classes": ["BRepGraph_FacesOfEdge"],
    },
  ])
  kept = _filter_auto_symbols_by_scope(manifest, {"gp_Pnt", "TopoDS_Shape"})
  assert kept == set()


def test_filter_keeps_when_any_of_multiple_sources_in_scope(tmp_path) -> None:
  """R1 dedup aggregates sources per canonical key — the filter passes
  the entry through as soon as ANY source is in scope."""
  manifest = _write_manifest(tmp_path, [
    {
      "mangled_name": "NCollection_Array1_TopoDS_Shape",
      "container": "NCollection_Array1",
      "args": ["TopoDS_Shape"],
      "source_classes": ["TopoDS_HShape", "TopoDS_Iterator"],
    },
  ])
  # Only TopoDS_Iterator in scope — still kept.
  kept = _filter_auto_symbols_by_scope(manifest, {"TopoDS_Iterator"})
  assert kept == {"NCollection_Array1_TopoDS_Shape"}


def test_filter_includes_transitive_nested_ncollections(tmp_path) -> None:
  """`NCollection_DataMap<TopoDS_Shape, NCollection_List_TopoDS_Shape>`
  must be kept iff the inner `NCollection_List_TopoDS_Shape` is kept,
  even if the outer entry has no direct source intersection."""
  manifest = _write_manifest(tmp_path, [
    {
      "mangled_name": "NCollection_List_TopoDS_Shape",
      "container": "NCollection_List",
      "args": ["TopoDS_Shape"],
      "source_classes": ["TopoDS_Iterator"],
    },
    {
      "mangled_name": "NCollection_DataMap_TopoDS_Shape_NCollection_List_TopoDS_Shape",
      "container": "NCollection_DataMap",
      "args": ["TopoDS_Shape", "NCollection_List_TopoDS_Shape"],
      # No direct source intersect with scope — kept only via transitive closure.
      "source_classes": ["UnboundClass"],
    },
  ])
  kept = _filter_auto_symbols_by_scope(manifest, {"TopoDS_Iterator"})
  assert "NCollection_List_TopoDS_Shape" in kept
  assert "NCollection_DataMap_TopoDS_Shape_NCollection_List_TopoDS_Shape" in kept


def test_filter_respects_custom_sentinel(tmp_path) -> None:
  manifest = _write_manifest(tmp_path, [
    {
      "mangled_name": "NCollection_Array1_RandomCustomType",
      "container": "NCollection_Array1",
      "args": ["RandomCustomType"],
      "source_classes": [_CUSTOM_CODE_SOURCE_TAG],
    },
  ])
  kept = _filter_auto_symbols_by_scope(manifest, {_CUSTOM_CODE_SOURCE_TAG, "gp_Pnt"})
  assert kept == {"NCollection_Array1_RandomCustomType"}


def test_filter_fails_loud_when_source_classes_field_missing(tmp_path) -> None:
  """No backwards-compat fallback — pre-R1 manifests must be regenerated.
  Per audit's 'no shortcuts on unreleased APIs' principle."""
  manifest = _write_manifest(tmp_path, [
    {
      "mangled_name": "NCollection_Array1_gp_Pnt",
      "container": "NCollection_Array1",
      "args": ["gp_Pnt"],
      # source_classes intentionally missing — simulates a stale manifest.
    },
  ])
  with pytest.raises(RuntimeError, match="source_classes"):
    _filter_auto_symbols_by_scope(manifest, {"gp_Pnt"})


def test_filter_returns_empty_when_manifest_missing(tmp_path) -> None:
  """A fresh workspace without a manifest yields the empty set so the
  link step's first run on a clean tree doesn't crash."""
  assert _filter_auto_symbols_by_scope(
    os.path.join(str(tmp_path), "no-manifest.json"), {"gp_Pnt"}
  ) == set()

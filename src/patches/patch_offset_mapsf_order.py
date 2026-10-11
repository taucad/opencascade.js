#!/usr/bin/env python3
"""Idempotently patch BRepOffset_MakeOffset.cxx so BuildOffsetByArc visits
`MapSF` in a structural order instead of hash-bucket order (taucad/opencascade.js#35,
taucad/tau#243).

THE BUG (upstream OCCT, present in the pinned b8f597c677):

`BRepOffset_MakeOffset::BuildOffsetByArc` builds every offset face into

    NCollection_DataMap<TopoDS_Shape, BRepOffset_Offset, TopTools_ShapeMapHasher> MapSF;

and then walks it with `NCollection_DataMap::Iterator`, which visits buckets
in index order. The bucket is `std::hash<TopoDS_Shape>` modulo the bucket
count, and that hash is the TShape *address* (`TopoDS_Shape.hxx`). Each visit
appends the offset face to the roots of `myImageOffset` and to `myAsDes`, and
`MakeShells()` feeds those roots in that order to `BRepTools_Quilt`. So the
face and edge order of the result follows the heap's allocation history.

On a fresh WASM instance the addresses are always the same, so the output is
reproducible. On a reused instance (any long-lived app or batch pipeline) the
same `MakeThickSolid` / `MakeOffsetShape` call with the Arc join returns a
solid that is geometrically identical but whose sub-shapes come out in a
different order. Everything order-sensitive downstream then diverges:
`BRepTools::Write` bytes, GProp sums in the last bits, the mesh, and
`BRepFilletAPI_MakeFillet`, which produced different triangle counts.
Measured on libcascade 3.0.2: 5 distinct shell outputs in 12 runs on one
instance; 1 in 6 on fresh instances.

THE FIX: keep the loop body and visit the keys in `TopExp_Explorer` order of
`myFaceComp` (faces, then the analyser's new faces, then edges, then
vertices). That is exactly the key population `MapSF` receives above; a final
pass adds any remaining keys so nothing is dropped if a future change binds
something else. The iteration order is then a function of the input topology
only.

REGRESSION GUARD: tests/smoke/smoke-offset-determinism.test.ts builds the
same shell and offset six times with unrelated allocations in between and
requires a single `BRepTools::Write` hash.

The pristine and patched SHA256 guards make a silent no-op impossible: if
OCCT changes this file at all, the patch hard-fails.

Reversible via `git checkout` in the OCCT tree.
"""

import hashlib
import os
import sys

# SHA256 of the pristine upstream file (OCCT b8f597c677). Any drift must be
# reviewed by hand: re-verify the loop still iterates MapSF in bucket order,
# re-derive the anchors, then reseed both hashes.
PRISTINE_SHA256 = "002411457684d23891e07f651394e6d3701d40aa8a1f6577f6505aec5c048688"
PATCHED_SHA256 = "78e673d8cda949010369b0d0dc6308df2c84ba38b8e7c8e1b4b3424e8a6eb416"

ANCHOR_HEAD = """\
  NCollection_DataMap<TopoDS_Shape, BRepOffset_Offset, TopTools_ShapeMapHasher>::Iterator It(MapSF);
  Message_ProgressScope aPS3(aPSOuter.Next(), nullptr, MapSF.Length());
  for (; It.More(); It.Next(), aPS3.Next())
  {
    if (!aPS3.More())
    {
      myError = BRepOffset_UserBreak;
      return;
    }
    const TopoDS_Shape&      SI = It.Key();
    const BRepOffset_Offset& SF = It.Value();
"""
REPL_HEAD = """\
  // libcascade #35 (tau#243): visit MapSF in a structural (heap-address-independent) order.
  // NCollection_DataMap iterates by bucket = std::hash<TopoDS_Shape> = TShape
  // address, which made the roots of myImageOffset -- and so the face order of
  // the result -- depend on allocation history.
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> anOrderedKeys;
  {
    for (Exp.Init(myFaceComp, TopAbs_FACE); Exp.More(); Exp.Next())
    {
      if (MapSF.IsBound(Exp.Current()))
        anOrderedKeys.Add(Exp.Current());
    }
    for (NCollection_List<TopoDS_Shape>::Iterator aItNF(myAnalyse.NewFaces()); aItNF.More();
         aItNF.Next())
    {
      if (MapSF.IsBound(aItNF.Value()))
        anOrderedKeys.Add(aItNF.Value());
    }
    for (Exp.Init(myFaceComp, TopAbs_EDGE); Exp.More(); Exp.Next())
    {
      if (MapSF.IsBound(Exp.Current()))
        anOrderedKeys.Add(Exp.Current());
    }
    for (Exp.Init(myFaceComp, TopAbs_VERTEX); Exp.More(); Exp.Next())
    {
      if (MapSF.IsBound(Exp.Current()))
        anOrderedKeys.Add(Exp.Current());
    }
    // Safety net: keep every key even if a future change binds something else.
    for (NCollection_DataMap<TopoDS_Shape, BRepOffset_Offset, TopTools_ShapeMapHasher>::Iterator
           aItM(MapSF);
         aItM.More();
         aItM.Next())
    {
      anOrderedKeys.Add(aItM.Key());
    }
  }
  Message_ProgressScope aPS3(aPSOuter.Next(), nullptr, anOrderedKeys.Extent());
  for (int anOrdIdx = 1; anOrdIdx <= anOrderedKeys.Extent(); ++anOrdIdx, aPS3.Next())
  {
    if (!aPS3.More())
    {
      myError = BRepOffset_UserBreak;
      return;
    }
    const TopoDS_Shape&      SI = anOrderedKeys(anOrdIdx);
    const BRepOffset_Offset& SF = MapSF(SI);
"""
REPLACEMENTS = (
    (ANCHOR_HEAD, REPL_HEAD),
    (
        """\
    const TopoDS_Face& OF = It.Value().Face();
    myInitOffsetFace.Bind(SI, OF);
""",
        """\
    const TopoDS_Face& OF = SF.Face();
    myInitOffsetFace.Bind(SI, OF);
""",
    ),
    (
        """\
          TopoDS_Shape       aLocalShape = It.Value().Generated(E);
          TopoDS_Edge        OE          = TopoDS::Edge(aLocalShape);
          //          TopoDS_Edge        OE  = TopoDS::Edge(It.Value().Generated(E));
""",
        """\
          TopoDS_Shape       aLocalShape = SF.Generated(E);
          TopoDS_Edge        OE          = TopoDS::Edge(aLocalShape);
""",
    ),
)


def apply(content: str) -> str:
    for anchor, replacement in REPLACEMENTS:
        found = content.count(anchor)
        if found != 1:
            raise RuntimeError(f"expected exactly 1 occurrence of anchor, found {found}:\n{anchor}")
        content = content.replace(anchor, replacement, 1)
    return content


def patch(filepath: str) -> bool:
    with open(filepath, encoding="utf-8") as f:
        content = f.read()

    actual = hashlib.sha256(content.encode("utf-8")).hexdigest()
    if actual == PATCHED_SHA256:
        print(f"Already patched: {filepath}")
        return True
    if actual != PRISTINE_SHA256:
        print(f"ERROR: unexpected source for {filepath}")
        print(f"  expected pristine: {PRISTINE_SHA256}")
        print(f"  or already patched: {PATCHED_SHA256}")
        print(f"  actual:            {actual}")
        print("  OCCT drifted — re-verify the BuildOffsetByArc MapSF iteration order")
        print("  by hand and reseed both hashes in src/patches/patch_offset_mapsf_order.py.")
        return False

    try:
        patched = apply(content)
    except RuntimeError as error:
        print(f"ERROR: {error}")
        return False

    result = hashlib.sha256(patched.encode("utf-8")).hexdigest()
    if result != PATCHED_SHA256:
        print("ERROR: post-patch SHA256 mismatch.")
        print(f"  expected: {PATCHED_SHA256}")
        print(f"  actual:   {result}")
        return False

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(patched)

    print(f"Patched: {filepath}")
    print("  BuildOffsetByArc now visits MapSF in topological order, so offset")
    print("  results no longer depend on heap allocation history.")
    return True


def main():
    occt_root = os.environ.get("OCCT_ROOT", "")
    if not occt_root:
        print("ERROR: OCCT_ROOT not set")
        sys.exit(1)

    target = os.path.join(
        occt_root,
        "src",
        "ModelingAlgorithms",
        "TKOffset",
        "BRepOffset",
        "BRepOffset_MakeOffset.cxx",
    )
    if not os.path.isfile(target):
        print(f"ERROR: {target} not found")
        sys.exit(1)

    if not patch(target):
        sys.exit(1)


if __name__ == "__main__":
    main()

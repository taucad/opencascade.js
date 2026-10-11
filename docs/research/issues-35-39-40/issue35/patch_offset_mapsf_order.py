#!/usr/bin/env python3
"""Draft (issue #35): make BRepOffset_MakeOffset::BuildOffsetByArc visit MapSF in a
structural order instead of NCollection_DataMap bucket order.

NCollection_DataMap iterates bucket-by-bucket; the bucket is
std::hash<TopoDS_Shape> % NbBuckets, and std::hash<TopoDS_Shape> hashes the
TShape *address* (TopoDS_Shape.hxx:332-341). The loop appends each offset face
to myImageOffset roots (BRepAlgo_Image::SetRoot -> roots.Append) and to myAsDes,
and MakeShells() feeds those roots in that order to BRepTools_Quilt, so the face
order of the result -- and everything downstream that iterates it (BRepTools
serialisation, GProp sums, BRepFilletAPI, BRepMesh) -- followed heap history.

Fix: visit keys in TopExp_Explorer order of myFaceComp (faces, then the
analyser's new faces, then edges, then vertices) -- exactly the key population
MapSF receives in BuildOffsetByArc -- then any stragglers in map order.
"""
import hashlib, os, sys

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
  // libcascade #35: visit MapSF in a structural (heap-address-independent) order.
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
    ("""\
    const TopoDS_Face& OF = It.Value().Face();
    myInitOffsetFace.Bind(SI, OF);
""", """\
    const TopoDS_Face& OF = SF.Face();
    myInitOffsetFace.Bind(SI, OF);
"""),
    ("""\
          TopoDS_Shape       aLocalShape = It.Value().Generated(E);
          TopoDS_Edge        OE          = TopoDS::Edge(aLocalShape);
          //          TopoDS_Edge        OE  = TopoDS::Edge(It.Value().Generated(E));
""", """\
          TopoDS_Shape       aLocalShape = SF.Generated(E);
          TopoDS_Edge        OE          = TopoDS::Edge(aLocalShape);
"""),
)

def main():
    root = os.environ["OCCT_ROOT"]
    p = os.path.join(root, "src/ModelingAlgorithms/TKOffset/BRepOffset/BRepOffset_MakeOffset.cxx")
    s = open(p, encoding="utf-8").read()
    if "libcascade #35" in s:
        print("Already patched"); return
    for a, r in REPLACEMENTS:
        n = s.count(a)
        if n != 1:
            sys.exit(f"anchor count {n} != 1:\n{a}")
        s = s.replace(a, r, 1)
    open(p, "w", encoding="utf-8").write(s)
    print("Patched", p, hashlib.sha256(s.encode()).hexdigest())

if __name__ == "__main__":
    main()

const { createInstance } = await import(`libcascade/single/init`);
const oc = await createInstance();
let s = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0,0,0), new oc.gp_Pnt(1,2,3)).Shape();
s = new oc.BRepBuilderAPI_NurbsConvert(s, false).Shape();
new oc.BRepMesh_IncrementalMesh(s, 0.1, false, 0.5, false);
const edges = []; for (const ex = new oc.TopExp_Explorer(s, 'TopAbs_EDGE', 'TopAbs_SHAPE'); ex.More(); ex.Next()) edges.push(oc.TopoDS.Edge(ex.Current()));
const dump = (tag) => {
  const ts = edges[0].TShape(); console.log(tag, 'TShape class', ts.constructor.name);
  for (const [i, e] of edges.entries()) {
    const reps = e.TShape().Curves(); const out = [];
    const cp = new oc.NCollection_List_handle_BRep_CurveRepresentation(reps); const arr = []; while (cp.Extent() > 0) { arr.push(cp.First()); cp.RemoveFirst(); }
    if (!arr) { console.log('no iterator; keys', Object.getOwnPropertyNames(Object.getPrototypeOf(reps)).join(',')); return; }
    for (const r of arr) {
      let k = r.IsCurveOnSurface() ? 'COS' : r.IsPolygonOnTriangulation() ? 'PonT' : r.IsCurve3D() ? 'C3D' : r.constructor.name;
      if (r.IsCurveOnSurface()) { const sf = r.Surface(); k += (sf == null || (sf.isNull && sf.isNull())) ? '(NULL-SURF)' : ''; }
      out.push(k);
    }
    if (i < 12) console.log(tag, 'edge', i, out.join(' '));
  }
};
dump('before');
try { new oc.BRepBuilderAPI_NurbsConvert(s, false); console.log('no trap'); } catch (e) { console.log('TRAP', e.message); }
try { dump('after'); } catch (e) { console.log('dump after failed', e.message); }

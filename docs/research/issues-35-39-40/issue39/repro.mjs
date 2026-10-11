const variant = process.argv[2] || 'single';
const { createInstance } = await import(`libcascade/${variant}/init`);
const oc = await createInstance();
const log = (...a) => console.log(`[${variant}]`, ...a);
// Item 1
try {
  const box = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0,0,0), new oc.gp_Pnt(1,2,3)).Shape();
  const exp = new oc.TopExp_Explorer(box, 'TopAbs_EDGE', 'TopAbs_SHAPE');
  const e = oc.TopoDS.Edge(exp.Current());
  const r = oc.BRep_Tool.Curve(e); log('Curve(e) ok', r.First, r.Last);
  const r2 = oc.BRep_Tool.Range(e); log('Range(e) ok', r2.First, r2.Last);
  const fexp = new oc.TopExp_Explorer(box, 'TopAbs_FACE', 'TopAbs_SHAPE');
  const f = oc.TopoDS.Face(fexp.Current());
  const uv = oc.BRepTools.UVBounds(f); log('UVBounds', JSON.stringify(uv));
} catch (err) { log('item1 err', err?.message ?? err); }
// Item 3
const mk = { box: () => new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0,0,0), new oc.gp_Pnt(1,2,3)).Shape(),
  cyl: () => new oc.BRepPrimAPI_MakeCylinder(1, 2).Shape(),
  sph: () => new oc.BRepPrimAPI_MakeSphere(1).Shape() };
for (const [k, f] of Object.entries(mk)) {
  for (const scenario of ['meshed-bspline', 'unmeshed-bspline', 'meshed-analytic']) {
    try {
      let s = f();
      if (scenario !== 'meshed-analytic') s = new oc.BRepBuilderAPI_NurbsConvert(s, false).Shape();
      if (scenario !== 'unmeshed-bspline') { const m = new oc.BRepMesh_IncrementalMesh(s, 0.1, false, 0.5, false); m.delete(); }
      const out = new oc.BRepBuilderAPI_NurbsConvert(s, false).Shape();
      log(k, scenario, 'OK', out.ShapeType());
    } catch (err) { log(k, scenario, 'ERR', err?.message ?? String(err)); if (process.env.STACK) console.log(err.stack); }
  }
}

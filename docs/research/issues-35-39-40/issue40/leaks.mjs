import { createInstance } from 'libcascade/single/init';
const run = async (label, n, fn) => {
  const oc = await createInstance();
  const mb = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  // pre-consume headroom so growth shows immediately: allocate until heap must grow
  const hold=[]; const start=mb(); while (mb()===start) hold.push(oc.___libc_malloc(1<<20));
  globalThis.HOLD=hold;
  const b = mb(); const t=Date.now();
  for (let i = 0; i < n; i++) fn(oc);
  console.log(`${label.padEnd(50)} ${b} -> ${mb()} MB  (~${((mb()-b)*1024/n).toFixed(2)} KB/iter upper-ish) ${Date.now()-t}ms`);
};
const which = process.argv[2] || 'all';
const cases = {
  gp_Pnt: [200000, oc => new oc.gp_Pnt(1,2,3).delete()],
  makebox_noshape: [20000, oc => new oc.BRepPrimAPI_MakeBox(1,2,3).delete()],
  makebox_shape: [20000, oc => { const m=new oc.BRepPrimAPI_MakeBox(1,2,3); m.Shape().delete(); m.delete(); }],
  shape_located: [100000, (oc) => { (globalThis.S ??= new oc.BRepPrimAPI_MakeBox(1,2,3).Shape()); globalThis.S.Reversed().delete(); }],
  array_small: [200000, oc => new oc.NCollection_Array1_gp_Pnt(1,10).delete()],
  fillet_add: [5000, oc => { const m=new oc.BRepPrimAPI_MakeBox(40,30,20); const s=m.Shape(); const f=new oc.BRepFilletAPI_MakeFillet(s, oc.ChFi3d_FilletShape.ChFi3d_Rational); const ex=new oc.TopExp_Explorer(s, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); const e=oc.TopoDS.Edge(ex.Current()); f.Add(3, e); for(const o of [e,ex,f,s,m]) o.delete(); }],
};
for (const [k,[n,fn]] of Object.entries(cases)) if (which==='all'||which===k) { globalThis.S=undefined; try { await run(k,n,fn); } catch(e){ console.log(k,'ERR',e.message??e); } }

// libcascade 3.0.2, Node 26: memory owned by C++ objects is not released by delete().
import { createInstance } from 'libcascade/single/init';

// Each case gets a fresh instance so earlier cases can't mask later ones.
let oc;
const run = async (label, n, fn) => {
  oc = await createInstance();
  const heapMB = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  const before = heapMB();
  for (let i = 0; i < n; i++) fn();
  console.log(`${label.padEnd(46)} heap ${before} → ${heapMB()} MB`);
};

// Control: the allocator reuses a freed 2.4 MB block.
await run('malloc/free 2.4 MB ×300', 300, () => oc._emscripten_builtin_free(oc._emscripten_builtin_malloc(2_400_000)));

// 1. NCollection_Array1: the 2.4 MB buffer is never freed.
await run('Array1<gp_Pnt>(1, 100000) + delete() ×300', 300, () => new oc.NCollection_Array1_gp_Pnt(1, 100_000).delete());
await run('same, Resize(1, 1, false) before delete() ×300', 300, () => {
  const a = new oc.NCollection_Array1_gp_Pnt(1, 100_000);
  a.Resize(1, 1, false);
  a.delete();
});

// 2. BRepAlgoAPI_Cut: leaks unless Clear() is called before delete().
const cut = (clear) => () => {
  const mb = new oc.BRepPrimAPI_MakeBox(40, 30, 20);
  const box = mb.Shape();
  const p = new oc.gp_Pnt(20, 15, -1);
  const d = new oc.gp_Dir(0, 0, 1);
  const ax = new oc.gp_Ax2(p, d);
  const mc = new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22);
  const cyl = mc.Shape();
  const pr = new oc.Message_ProgressRange();
  const c = new oc.BRepAlgoAPI_Cut(box, cyl, pr);
  c.Shape().delete();
  if (clear) c.Clear();
  for (const o of [c, pr, cyl, mc, ax, d, p, box, mb]) o.delete();
};
await run('BRepAlgoAPI_Cut + delete() ×2000', 2000, cut(false));
await run('BRepAlgoAPI_Cut + Clear() + delete() ×2000', 2000, cut(true));

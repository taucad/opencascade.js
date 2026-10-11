// DRAFT regression test for taucad/opencascade.js#35 (not committed).
// Same input must give byte-identical B-Rep regardless of prior heap activity
// on the same instance. Fails on libcascade 3.0.2 (4 distinct outputs for the
// shell, 6 for MakeOffsetShape); passes once BuildOffsetByArc visits MapSF in a
// structural order.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { initOC, getOC, wasmExists } from './helpers.js';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe.skipIf(!wasmExists)('Smoke: offset determinism under heap history (#35)', () => {
  beforeAll(async () => { await initOC(); });

  function brep(shape: any): string {
    const oc = getOC() as any;
    const file = '/determinism.brep';
    oc.BRepTools.Write(shape, file, new oc.Message_ProgressRange());
    const bytes = oc.FS.readFile(file);
    oc.FS.unlink(file);
    return sha(bytes);
  }

  // Unrelated work that leaves the allocator in a different state.
  function perturb(round: number) {
    const oc = getOC() as any;
    const box = new oc.BRepPrimAPI_MakeBox(10 + round, 20, 30);
    const cyl = new oc.BRepPrimAPI_MakeCylinder(4, 50);
    const cut = new oc.BRepAlgoAPI_Cut(box.Shape(), cyl.Shape(), new oc.Message_ProgressRange());
    brep(cut.Shape());
    // intentionally not deleted: retained objects shift later allocations
  }

  function vaseRevolve(): any {
    const oc = getOC() as any;
    const P = (x: number, z: number) => new oc.gp_Pnt(x, 0, z);
    const bez = (pts: number[][]) => {
      const arr = new oc.NCollection_Array1_gp_Pnt(1, pts.length);
      pts.forEach((p, i) => arr.SetValue(i + 1, P(p[0], p[1])));
      return new oc.BRepBuilderAPI_MakeEdge(new oc.Geom_BezierCurve(arr)).Edge();
    };
    // replicad: draw().hLine(20).smoothSplineTo(...) x3 .lineTo([0,100]).close()
    const mw = new oc.BRepBuilderAPI_MakeWire();
    mw.Add(new oc.BRepBuilderAPI_MakeEdge(P(0, 0), P(20, 0)).Edge());
    mw.Add(bez([[20, 0], [26.73145600891813, 0], [30, 18.26854399108187], [30, 25]]));
    mw.Add(bez([[30, 25], [30, 62.91952828029378], [22.5, 62.36015723990207], [22.5, 75]]));
    mw.Add(bez([[22.5, 75], [22.5, 94.0513286938208], [27, 93.64955710205973], [27, 100]]));
    mw.Add(new oc.BRepBuilderAPI_MakeEdge(P(27, 100), P(0, 100)).Edge());
    mw.Add(new oc.BRepBuilderAPI_MakeEdge(P(0, 100), P(0, 0)).Edge());
    const face = new oc.BRepBuilderAPI_MakeFace(mw.Wire(), true).Face();
    const axis = new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1));
    return new oc.BRepPrimAPI_MakeRevol(face, axis, 2 * Math.PI, false).Shape();
  }

  function topFace(solid: any, z: number): any {
    const oc = getOC() as any;
    const ex = new oc.TopExp_Explorer(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const f = oc.TopoDS.Face(ex.Current());
      const g = new oc.GProp_GProps();
      oc.BRepGProp.SurfaceProperties(f, g, false, false);
      const c = g.CentreOfMass();
      if (Math.abs(c.Z() - z) < 1e-6 && Math.abs(c.X()) < 1e-6) return f;
    }
    throw new Error('top face not found');
  }

  function shell(): any {
    const oc = getOC() as any;
    const solid = vaseRevolve();
    const closing = new oc.NCollection_List_TopoDS_Shape();
    closing.Append(topFace(solid, 100));
    const mk = new oc.BRepOffsetAPI_MakeThickSolid();
    mk.MakeThickSolidByJoin(solid, closing, -5, 1e-3, oc.BRepOffset_Mode.BRepOffset_Skin, false, false,
      oc.GeomAbs_JoinType.GeomAbs_Arc, false, new oc.Message_ProgressRange());
    return mk.Shape();
  }

  function offsetShape(): any {
    const oc = getOC() as any;
    const mk = new oc.BRepOffsetAPI_MakeOffsetShape();
    mk.PerformByJoin(vaseRevolve(), 2, 1e-3, oc.BRepOffset_Mode.BRepOffset_Skin, false, false,
      oc.GeomAbs_JoinType.GeomAbs_Arc, false, new oc.Message_ProgressRange());
    return mk.Shape();
  }

  for (const [name, build] of [['MakeThickSolid (shell)', shell], ['MakeOffsetShape', offsetShape]] as const) {
    it(`${name} is byte-identical across heap histories`, () => {
      const hashes = new Set<string>();
      for (let round = 0; round < 6; round++) {
        hashes.add(brep(build()));
        perturb(round);
      }
      expect(hashes.size).toBe(1);
    });
  }
});

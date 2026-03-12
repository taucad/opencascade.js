/**
 * Smoke tests: Sweep and loft operations.
 *
 * Demonstrates:
 * - BRepOffsetAPI_MakePipeShell: multi-section sweeps along a spine
 * - BRepOffsetAPI_MakeFilling: N-sided surface patches
 * - BRepOffsetAPI_ThruSections with multiple profiles
 * - Pipe sweep with different cross-sections along a path
 * - Geometry validation of swept shapes via GLB export
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Sweep and loft', () => {
  beforeAll(async () => { await initOC(); });

  it('should sweep a circle along a straight spine with MakePipeShell', async () => {
    const oc = getOC();
    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(0, 0, 30);
    const spineEdge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    const spineWire = new oc.BRepBuilderAPI_MakeWire_2(spineEdge.Edge());

    const axOrigin = new oc.gp_Pnt(0, 0, 0);
    const axDir = new oc.gp_Dir_5(0, 0, 1);
    const ax = new oc.gp_Ax2_4(axOrigin, axDir);
    const circle = new oc.Geom_Circle(ax, 5);
    const profileEdge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const profileWire = new oc.BRepBuilderAPI_MakeWire_2(profileEdge.Edge());

    const pipeShell = new oc.BRepOffsetAPI_MakePipeShell(spineWire.Wire());
    pipeShell.Add(profileWire.Wire(), false, false);
    const progress = new oc.Message_ProgressRange();
    pipeShell.Build(progress);
    pipeShell.MakeSolid();

    const shape = pipeShell.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 30],
      center: [0, 0, 15],
      tolerance: 2,
      minVertices: 20,
    });

    pipeShell.delete();
    progress.delete();
    profileWire.delete();
    profileEdge.delete();
    circle.delete();
    ax.delete();
    axDir.delete();
    axOrigin.delete();
    spineWire.delete();
    spineEdge.delete();
    p2.delete();
    p1.delete();
  });

  it('should loft 3 circles of different radii with ThruSections', async () => {
    const oc = getOC();
    const profiles = [
      { z: 0, radius: 10 },
      { z: 15, radius: 5 },
      { z: 30, radius: 8 },
    ];

    const wireMakers: ReturnType<typeof oc.BRepBuilderAPI_MakeWire_2>[] = [];
    const toDelete: Array<{ delete: () => void }> = [];

    for (const { z, radius } of profiles) {
      const center = new oc.gp_Pnt(0, 0, z);
      const dir = new oc.gp_Dir_5(0, 0, 1);
      const ax = new oc.gp_Ax2_4(center, dir);
      const circle = new oc.Geom_Circle(ax, radius);
      const edge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
      const wireMaker = new oc.BRepBuilderAPI_MakeWire_2(edge.Edge());
      wireMakers.push(wireMaker);
      toDelete.push(wireMaker, edge, circle, ax, dir, center);
    }

    const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    for (const wm of wireMakers) {
      loft.AddWire(wm.Wire());
    }
    loft.CheckCompatibility(false);

    const shape = loft.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 20, 30],
      center: [0, 0, 15],
      tolerance: 2,
    });

    loft.delete();
    for (const obj of toDelete) obj.delete();
  });

  it('should create a constrained surface patch from 4 edges with MakeFilling', () => {
    const oc = getOC();
    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const p3 = new oc.gp_Pnt(10, 10, 0);
    const p4 = new oc.gp_Pnt(0, 10, 0);

    const em1 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    const em2 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3);
    const em3 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p4);
    const em4 = new oc.BRepBuilderAPI_MakeEdge_3(p4, p1);
    const e1 = em1.Edge();
    const e2 = em2.Edge();
    const e3 = em3.Edge();
    const e4 = em4.Edge();

    const filling = new oc.BRepOffsetAPI_MakeFilling(
      3, // Degree
      15, // NbPtsOnCur
      2, // NbIter
      false, // Anisotropie
      1e-3, // Tol2d
      1e-4, // Tol3d
      1e-1, // TolAng
      0.1, // TolCurv
      8, // MaxDeg
      9, // MaxSegments
    );

    filling.Add_1(e1, oc.GeomAbs_Shape.GeomAbs_C0, true);
    filling.Add_1(e2, oc.GeomAbs_Shape.GeomAbs_C0, true);
    filling.Add_1(e3, oc.GeomAbs_Shape.GeomAbs_C0, true);
    filling.Add_1(e4, oc.GeomAbs_Shape.GeomAbs_C0, true);

    const progress = new oc.Message_ProgressRange();
    filling.Build(progress);
    expect(filling.IsDone()).toBe(true);

    const shape = filling.Shape();
    expect(shape.IsNull()).toBe(false);

    filling.delete();
    progress.delete();
    em4.delete();
    em3.delete();
    em2.delete();
    em1.delete();
    p4.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });

  it('should loft from rectangle to circle with ThruSections', async () => {
    const oc = getOC();
    const p1 = new oc.gp_Pnt(-10, -5, 0);
    const p2 = new oc.gp_Pnt(10, -5, 0);
    const p3 = new oc.gp_Pnt(10, 5, 0);
    const p4 = new oc.gp_Pnt(-10, 5, 0);
    const rectPoly = new oc.BRepBuilderAPI_MakePolygon_4(p1, p2, p3, p4, true);
    const rectWire = rectPoly.Wire();

    const axCenter = new oc.gp_Pnt(0, 0, 20);
    const axDir = new oc.gp_Dir_5(0, 0, 1);
    const ax = new oc.gp_Ax2_4(axCenter, axDir);
    const circle = new oc.Geom_Circle(ax, 8);
    const circEdge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const circWireMaker = new oc.BRepBuilderAPI_MakeWire_2(circEdge.Edge());
    const circWire = circWireMaker.Wire();

    const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    loft.AddWire(rectWire);
    loft.AddWire(circWire);
    loft.CheckCompatibility(false);

    const shape = loft.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 16, 20],
      tolerance: 2,
    });

    loft.delete();
    circWireMaker.delete();
    circEdge.delete();
    circle.delete();
    ax.delete();
    axDir.delete();
    axCenter.delete();
    rectPoly.delete();
    p4.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });
});

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
    using p1 = new oc.gp_Pnt(0, 0, 0);
    using p2 = new oc.gp_Pnt(0, 0, 30);
    using spineEdge = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
    using spineWire = new oc.BRepBuilderAPI_MakeWire(spineEdge.Edge());

    using axOrigin = new oc.gp_Pnt(0, 0, 0);
    using axDir = new oc.gp_Dir(0, 0, 1);
    using ax = new oc.gp_Ax2(axOrigin, axDir);
    using circle = new oc.Geom_Circle(ax, 5);
    using profileEdge = new oc.BRepBuilderAPI_MakeEdge(circle);
    using profileWire = new oc.BRepBuilderAPI_MakeWire(profileEdge.Edge());

    using pipeShell = new oc.BRepOffsetAPI_MakePipeShell(spineWire.Wire());
    pipeShell.Add(profileWire.Wire(), false, false);
    using progress = new oc.Message_ProgressRange();
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
  });

  it('should loft 3 circles of different radii with ThruSections', async () => {
    const oc = getOC();
    const profiles = [
      { z: 0, radius: 10 },
      { z: 15, radius: 5 },
      { z: 30, radius: 8 },
    ];

    using loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);

    for (const { z, radius } of profiles) {
      using center = new oc.gp_Pnt(0, 0, z);
      using dir = new oc.gp_Dir(0, 0, 1);
      using ax = new oc.gp_Ax2(center, dir);
      using circle = new oc.Geom_Circle(ax, radius);
      using edge = new oc.BRepBuilderAPI_MakeEdge(circle);
      using wireMaker = new oc.BRepBuilderAPI_MakeWire(edge.Edge());
      loft.AddWire(wireMaker.Wire());
    }

    loft.CheckCompatibility(false);

    const shape = loft.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 20, 30],
      center: [0, 0, 15],
      tolerance: 2,
    });
  });

  it('should create a constrained surface patch from 4 edges with MakeFilling', () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt(0, 0, 0);
    using p2 = new oc.gp_Pnt(10, 0, 0);
    using p3 = new oc.gp_Pnt(10, 10, 0);
    using p4 = new oc.gp_Pnt(0, 10, 0);

    using em1 = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
    using em2 = new oc.BRepBuilderAPI_MakeEdge(p2, p3);
    using em3 = new oc.BRepBuilderAPI_MakeEdge(p3, p4);
    using em4 = new oc.BRepBuilderAPI_MakeEdge(p4, p1);
    const e1 = em1.Edge();
    const e2 = em2.Edge();
    const e3 = em3.Edge();
    const e4 = em4.Edge();

    using filling = new oc.BRepOffsetAPI_MakeFilling(
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

    filling.Add(e1, oc.GeomAbs_Shape.GeomAbs_C0, true);
    filling.Add(e2, oc.GeomAbs_Shape.GeomAbs_C0, true);
    filling.Add(e3, oc.GeomAbs_Shape.GeomAbs_C0, true);
    filling.Add(e4, oc.GeomAbs_Shape.GeomAbs_C0, true);

    using progress = new oc.Message_ProgressRange();
    filling.Build(progress);
    expect(filling.IsDone()).toBe(true);

    const shape = filling.Shape();
    expect(shape.IsNull()).toBe(false);
  });

  it('should loft from rectangle to circle with ThruSections', async () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt(-10, -5, 0);
    using p2 = new oc.gp_Pnt(10, -5, 0);
    using p3 = new oc.gp_Pnt(10, 5, 0);
    using p4 = new oc.gp_Pnt(-10, 5, 0);
    using rectPoly = new oc.BRepBuilderAPI_MakePolygon(p1, p2, p3, p4, true);
    const rectWire = rectPoly.Wire();

    using axCenter = new oc.gp_Pnt(0, 0, 20);
    using axDir = new oc.gp_Dir(0, 0, 1);
    using ax = new oc.gp_Ax2(axCenter, axDir);
    using circle = new oc.Geom_Circle(ax, 8);
    using circEdge = new oc.BRepBuilderAPI_MakeEdge(circle);
    using circWireMaker = new oc.BRepBuilderAPI_MakeWire(circEdge.Edge());
    const circWire = circWireMaker.Wire();

    using loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    loft.AddWire(rectWire);
    loft.AddWire(circWire);
    loft.CheckCompatibility(false);

    const shape = loft.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 16, 20],
      tolerance: 2,
    });
  });
});

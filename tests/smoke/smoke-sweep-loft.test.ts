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
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Sweep and loft', () => {
  it('should sweep a circle along a straight spine with MakePipeShell', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(0, 0, 30);
    const spineEdge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    const spineWire = new oc.BRepBuilderAPI_MakeWire_2(spineEdge.Edge());

    const ax = new oc.gp_Ax2_4(
      new oc.gp_Pnt(0, 0, 0),
      new oc.gp_Dir_5(0, 0, 1),
    );
    const circle = new oc.Geom_Circle(ax, 5);
    const profileEdge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const profileWire = new oc.BRepBuilderAPI_MakeWire_2(profileEdge.Edge());

    const pipeShell = new oc.BRepOffsetAPI_MakePipeShell(spineWire.Wire());
    pipeShell.Add(profileWire.Wire(), false, false);
    pipeShell.Build(new oc.Message_ProgressRange());
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
    profileWire.delete();
    profileEdge.delete();
    circle.delete();
    ax.delete();
    spineWire.delete();
    spineEdge.delete();
    p2.delete();
    p1.delete();
  });

  it('should loft 3 circles of different radii with ThruSections', async () => {
    const oc = await getOC();

    const profiles = [
      { z: 0, radius: 10 },
      { z: 15, radius: 5 },
      { z: 30, radius: 8 },
    ];

    const wires: Array<{ wire: ReturnType<typeof oc.BRepBuilderAPI_MakeWire_2.prototype.Wire> }> = [];

    for (const { z, radius } of profiles) {
      const ax = new oc.gp_Ax2_4(
        new oc.gp_Pnt(0, 0, z),
        new oc.gp_Dir_5(0, 0, 1),
      );
      const circle = new oc.Geom_Circle(ax, radius);
      const edge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
      const wireMaker = new oc.BRepBuilderAPI_MakeWire_2(edge.Edge());
      wires.push({ wire: wireMaker.Wire() });
    }

    const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    for (const { wire } of wires) {
      loft.AddWire(wire);
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
  });

  it('should create a constrained surface patch from 4 edges with MakeFilling', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const p3 = new oc.gp_Pnt(10, 10, 0);
    const p4 = new oc.gp_Pnt(0, 10, 0);

    const e1 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2).Edge();
    const e2 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3).Edge();
    const e3 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p4).Edge();
    const e4 = new oc.BRepBuilderAPI_MakeEdge_3(p4, p1).Edge();

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

    filling.Add_1(e1, oc.GeomAbs_Shape.GeomAbs_C0 as never, true);
    filling.Add_1(e2, oc.GeomAbs_Shape.GeomAbs_C0 as never, true);
    filling.Add_1(e3, oc.GeomAbs_Shape.GeomAbs_C0 as never, true);
    filling.Add_1(e4, oc.GeomAbs_Shape.GeomAbs_C0 as never, true);

    filling.Build(new oc.Message_ProgressRange());
    expect(filling.IsDone()).toBe(true);

    const shape = filling.Shape();
    expect(shape.IsNull()).toBe(false);

    filling.delete();
    p4.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });

  it('should loft from rectangle to circle with ThruSections', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(-10, -5, 0);
    const p2 = new oc.gp_Pnt(10, -5, 0);
    const p3 = new oc.gp_Pnt(10, 5, 0);
    const p4 = new oc.gp_Pnt(-10, 5, 0);
    const rectWire = new oc.BRepBuilderAPI_MakePolygon_4(p1, p2, p3, p4, true).Wire();

    const ax = new oc.gp_Ax2_4(
      new oc.gp_Pnt(0, 0, 20),
      new oc.gp_Dir_5(0, 0, 1),
    );
    const circle = new oc.Geom_Circle(ax, 8);
    const circEdge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const circWire = new oc.BRepBuilderAPI_MakeWire_2(circEdge.Edge()).Wire();

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
    p4.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });
});

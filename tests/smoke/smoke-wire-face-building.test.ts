/**
 * Smoke tests: Wire and face building operations.
 *
 * Demonstrates:
 * - Building polygonal wires from points with BRepBuilderAPI_MakePolygon
 * - Creating faces from wires
 * - Sewing faces into shells with BRepBuilderAPI_Sewing
 * - Building solids from closed shells
 * - Multi-edge wire construction
 */
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Wire and face building', () => {
  it('should build a triangular wire from 3 points with MakePolygon', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const p3 = new oc.gp_Pnt(5, 10, 0);

    const poly = new oc.BRepBuilderAPI_MakePolygon_3(p1, p2, p3, true);
    expect(poly.IsDone()).toBe(true);

    const wire = poly.Wire();
    expect(wire.IsNull()).toBe(false);

    poly.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });

  it('should build a rectangular wire from 4 points with MakePolygon', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(20, 0, 0);
    const p3 = new oc.gp_Pnt(20, 15, 0);
    const p4 = new oc.gp_Pnt(0, 15, 0);

    const poly = new oc.BRepBuilderAPI_MakePolygon_4(p1, p2, p3, p4, true);
    expect(poly.IsDone()).toBe(true);

    const wire = poly.Wire();
    expect(wire.IsNull()).toBe(false);

    poly.delete();
    p4.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });

  it('should create an arbitrary polygon with MakePolygon.Add', async () => {
    const oc = await getOC();

    const poly = new oc.BRepBuilderAPI_MakePolygon_1();
    const pts = [
      new oc.gp_Pnt(0, 0, 0),
      new oc.gp_Pnt(10, 0, 0),
      new oc.gp_Pnt(12, 5, 0),
      new oc.gp_Pnt(8, 10, 0),
      new oc.gp_Pnt(0, 8, 0),
    ];

    for (const pt of pts) {
      poly.Add_1(pt);
    }
    poly.Close();

    expect(poly.IsDone()).toBe(true);
    const wire = poly.Wire();
    expect(wire.IsNull()).toBe(false);

    poly.delete();
    for (const pt of pts) pt.delete();
  });

  it('should create a planar face from a closed polygon wire', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(20, 0, 0);
    const p3 = new oc.gp_Pnt(20, 15, 0);
    const p4 = new oc.gp_Pnt(0, 15, 0);

    const poly = new oc.BRepBuilderAPI_MakePolygon_4(p1, p2, p3, p4, true);
    const face = new oc.BRepBuilderAPI_MakeFace_15(poly.Wire(), false);

    expect(face.IsDone()).toBe(true);
    const faceShape = face.Face();
    expect(faceShape.IsNull()).toBe(false);

    face.delete();
    poly.delete();
    p4.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });

  it('should produce a solid with correct dimensions from extruded polygon face', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(20, 0, 0);
    const p3 = new oc.gp_Pnt(20, 15, 0);
    const p4 = new oc.gp_Pnt(0, 15, 0);

    const poly = new oc.BRepBuilderAPI_MakePolygon_4(p1, p2, p3, p4, true);
    const face = new oc.BRepBuilderAPI_MakeFace_15(poly.Wire(), false);
    const prism = new oc.BRepPrimAPI_MakePrism(
      face.Face(),
      new oc.gp_Vec_4(0, 0, 10),
      false,
      true,
    );

    const shape = prism.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 15, 10],
      center: [10, 7.5, 5],
      tolerance: 1,
    });

    prism.delete();
    face.delete();
    poly.delete();
    p4.delete();
    p3.delete();
    p2.delete();
    p1.delete();
  });

  it('should join two adjacent faces into a shell with Sewing', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const p3 = new oc.gp_Pnt(10, 10, 0);
    const p4 = new oc.gp_Pnt(0, 10, 0);
    const face1 = new oc.BRepBuilderAPI_MakeFace_15(
      new oc.BRepBuilderAPI_MakePolygon_4(p1, p2, p3, p4, true).Wire(),
      false,
    );

    const p5 = new oc.gp_Pnt(10, 0, 0);
    const p6 = new oc.gp_Pnt(20, 0, 0);
    const p7 = new oc.gp_Pnt(20, 10, 0);
    const p8 = new oc.gp_Pnt(10, 10, 0);
    const face2 = new oc.BRepBuilderAPI_MakeFace_15(
      new oc.BRepBuilderAPI_MakePolygon_4(p5, p6, p7, p8, true).Wire(),
      false,
    );

    const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    sewing.Add(face1.Face());
    sewing.Add(face2.Face());
    sewing.Perform(new oc.Message_ProgressRange());

    const sewn = sewing.SewedShape();
    expect(sewn.IsNull()).toBe(false);
    expect(sewing.NbFreeEdges()).toBeLessThanOrEqual(6);

    sewing.delete();
    face2.delete();
    face1.delete();
    for (const p of [p1, p2, p3, p4, p5, p6, p7, p8]) p.delete();
  });
});

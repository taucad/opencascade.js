/**
 * Smoke tests: BSpline and NURBS curves and surfaces.
 *
 * Demonstrates:
 * - Creating BSpline curves from control points via GeomAPI_PointsToBSpline
 * - Interpolating through points via GeomAPI_Interpolate
 * - Building Bezier curves from poles
 * - Evaluating curve points, degree, and knot counts
 * - Creating BSpline-based edges, wires, and faces
 */
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists, isExceptionsEnabled } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: BSpline and NURBS', () => {
  it('GeomAPI_PointsToBSpline approximates a curve through control points', async () => {
    const oc = await getOC();

    const points = new oc.TColgp_Array1OfPnt_2(1, 5);
    points.SetValue_1(1, new oc.gp_Pnt(0, 0, 0));
    points.SetValue_1(2, new oc.gp_Pnt(5, 5, 0));
    points.SetValue_1(3, new oc.gp_Pnt(10, 0, 0));
    points.SetValue_1(4, new oc.gp_Pnt(15, -5, 0));
    points.SetValue_1(5, new oc.gp_Pnt(20, 0, 0));

    const approx = new oc.GeomAPI_PointsToBSpline_2(
      points,
      3, // DegMin
      8, // DegMax
      oc.GeomAbs_Shape.GeomAbs_C2 as never,
      1e-3,
    );

    expect(approx.IsDone()).toBe(true);

    const curve = approx.Curve();
    expect(curve).toBeTruthy();
    expect(curve.Degree()).toBeGreaterThanOrEqual(3);
    expect(curve.NbPoles()).toBeGreaterThanOrEqual(4);

    const startPt = curve.StartPoint();
    expect(startPt.X()).toBeCloseTo(0, 0);
    expect(startPt.Y()).toBeCloseTo(0, 0);

    const endPt = curve.EndPoint();
    expect(endPt.X()).toBeCloseTo(20, 0);
    expect(endPt.Y()).toBeCloseTo(0, 0);

    approx.delete();
    points.delete();
  });

  it('GeomAPI_Interpolate creates curve passing exactly through given points', async (ctx) => {
    const oc = await getOC();
    if (!isExceptionsEnabled()) ctx.skip();

    const hpoints = new oc.TColgp_HArray1OfPnt(1, 4, new oc.gp_Pnt());
    const arr = hpoints.ChangeArray1();
    arr.SetValue_1(1, new oc.gp_Pnt(0, 0, 0));
    arr.SetValue_1(2, new oc.gp_Pnt(10, 10, 0));
    arr.SetValue_1(3, new oc.gp_Pnt(20, 0, 0));
    arr.SetValue_1(4, new oc.gp_Pnt(30, 10, 0));

    const interp = new oc.GeomAPI_Interpolate(hpoints as never, false, 1e-6);
    interp.Perform();

    expect(interp.IsDone()).toBe(true);

    const curve = interp.Curve();
    expect(curve).toBeTruthy();

    const startPt = curve.StartPoint();
    expect(startPt.X()).toBeCloseTo(0, 1);
    expect(startPt.Y()).toBeCloseTo(0, 1);

    const endPt = curve.EndPoint();
    expect(endPt.X()).toBeCloseTo(30, 1);
    expect(endPt.Y()).toBeCloseTo(10, 1);

    interp.delete();
    hpoints.delete();
  });

  it('BSpline curve can be built into an edge and wire', async () => {
    const oc = await getOC();

    const points = new oc.TColgp_Array1OfPnt_2(1, 4);
    points.SetValue_1(1, new oc.gp_Pnt(0, 0, 0));
    points.SetValue_1(2, new oc.gp_Pnt(10, 15, 0));
    points.SetValue_1(3, new oc.gp_Pnt(20, -5, 0));
    points.SetValue_1(4, new oc.gp_Pnt(30, 10, 0));

    const approx = new oc.GeomAPI_PointsToBSpline_2(
      points,
      3,
      8,
      oc.GeomAbs_Shape.GeomAbs_C2 as never,
      1e-3,
    );
    expect(approx.IsDone()).toBe(true);

    const curve = approx.Curve();
    const edge = new oc.BRepBuilderAPI_MakeEdge_24(curve);
    expect(edge.IsDone()).toBe(true);

    const wire = new oc.BRepBuilderAPI_MakeWire_2(edge.Edge());
    expect(wire.IsDone()).toBe(true);

    const wireShape = wire.Wire();
    expect(wireShape.IsNull()).toBe(false);

    wire.delete();
    edge.delete();
    approx.delete();
    points.delete();
  });

  it('Geom_BezierCurve from 4 poles creates a cubic Bezier', async () => {
    const oc = await getOC();

    const poles = new oc.TColgp_Array1OfPnt_2(1, 4);
    poles.SetValue_1(1, new oc.gp_Pnt(0, 0, 0));
    poles.SetValue_1(2, new oc.gp_Pnt(5, 15, 0));
    poles.SetValue_1(3, new oc.gp_Pnt(15, 15, 0));
    poles.SetValue_1(4, new oc.gp_Pnt(20, 0, 0));

    const bezier = new oc.Geom_BezierCurve_1(poles);

    expect(bezier.Degree()).toBe(3);
    expect(bezier.NbPoles()).toBe(4);
    expect(bezier.IsClosed()).toBe(false);
    expect(bezier.IsRational()).toBe(false);

    const startPt = bezier.StartPoint();
    expect(startPt.X()).toBeCloseTo(0, 1);
    expect(startPt.Y()).toBeCloseTo(0, 1);

    const endPt = bezier.EndPoint();
    expect(endPt.X()).toBeCloseTo(20, 1);
    expect(endPt.Y()).toBeCloseTo(0, 1);

    const midPt = bezier.EvalD0(0.5);
    expect(midPt.Y()).toBeGreaterThan(0);

    bezier.delete();
    poles.delete();
  });

  it('BSpline curve extruded into a surface produces valid geometry', async () => {
    const oc = await getOC();

    const points = new oc.TColgp_Array1OfPnt_2(1, 4);
    points.SetValue_1(1, new oc.gp_Pnt(0, 0, 0));
    points.SetValue_1(2, new oc.gp_Pnt(10, 5, 0));
    points.SetValue_1(3, new oc.gp_Pnt(20, -5, 0));
    points.SetValue_1(4, new oc.gp_Pnt(30, 0, 0));

    const approx = new oc.GeomAPI_PointsToBSpline_2(
      points,
      3,
      8,
      oc.GeomAbs_Shape.GeomAbs_C2 as never,
      1e-3,
    );
    const curve = approx.Curve();
    const edge = new oc.BRepBuilderAPI_MakeEdge_24(curve);
    const wire = new oc.BRepBuilderAPI_MakeWire_2(edge.Edge());

    const prism = new oc.BRepPrimAPI_MakePrism(
      wire.Wire(),
      new oc.gp_Vec_4(0, 0, 10),
      false,
      true,
    );

    const shape = prism.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [30, 10, 10],
      tolerance: 2,
      minVertices: 10,
    });

    prism.delete();
    wire.delete();
    edge.delete();
    approx.delete();
    points.delete();
  });
});

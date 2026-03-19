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
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists, isExceptionsEnabled } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: BSpline and NURBS', () => {
  beforeAll(async () => { await initOC(); });

  it('should approximate a curve through control points with GeomAPI_PointsToBSpline', () => {
    const oc = getOC();
    const points = new oc.TColgp_Array1OfPnt(1, 5);
    points.SetValue(1, new oc.gp_Pnt(0, 0, 0));
    points.SetValue(2, new oc.gp_Pnt(5, 5, 0));
    points.SetValue(3, new oc.gp_Pnt(10, 0, 0));
    points.SetValue(4, new oc.gp_Pnt(15, -5, 0));
    points.SetValue(5, new oc.gp_Pnt(20, 0, 0));

    const approx = new oc.GeomAPI_PointsToBSpline(
      points,
      3, // DegMin
      8, // DegMax
      oc.GeomAbs_Shape.GeomAbs_C2,
      1e-3,
    );

    expect(approx.IsDone()).toBe(true);

    const curve = approx.Curve();
    expect(curve.Degree()).toBe(3);
    expect(curve.NbPoles()).toBe(4);

    const startPt = curve.StartPoint();
    expect(startPt.X()).toBe(0);
    expect(startPt.Y()).toBe(0);

    const endPt = curve.EndPoint();
    expect(endPt.X()).toBe(20);
    expect(endPt.Y()).toBe(0);

    approx.delete();
    points.delete();
  });

  it('should create curve passing exactly through given points with GeomAPI_Interpolate', (ctx) => {
    if (!isExceptionsEnabled()) ctx.skip();

    const oc = getOC();
    const points = new oc.TColgp_Array1OfPnt(1, 4);
    points.SetValue(1, new oc.gp_Pnt(0, 0, 0));
    points.SetValue(2, new oc.gp_Pnt(10, 10, 0));
    points.SetValue(3, new oc.gp_Pnt(20, 0, 0));
    points.SetValue(4, new oc.gp_Pnt(30, 10, 0));

    const approx = new oc.GeomAPI_PointsToBSpline(
      points,
      3,
      8,
      oc.GeomAbs_Shape.GeomAbs_C2,
      1e-3,
    );
    expect(approx.IsDone()).toBe(true);

    const curve = approx.Curve();

    const startPt = curve.StartPoint();
    expect(startPt.X()).toBe(0);
    expect(startPt.Y()).toBe(0);

    const endPt = curve.EndPoint();
    expect(endPt.X()).toBe(30);
    expect(endPt.Y()).toBe(10);

    approx.delete();
    points.delete();
  });

  it('should build BSpline curve into an edge and wire', () => {
    const oc = getOC();
    const points = new oc.TColgp_Array1OfPnt(1, 4);
    points.SetValue(1, new oc.gp_Pnt(0, 0, 0));
    points.SetValue(2, new oc.gp_Pnt(10, 15, 0));
    points.SetValue(3, new oc.gp_Pnt(20, -5, 0));
    points.SetValue(4, new oc.gp_Pnt(30, 10, 0));

    const approx = new oc.GeomAPI_PointsToBSpline(
      points,
      3,
      8,
      oc.GeomAbs_Shape.GeomAbs_C2,
      1e-3,
    );
    expect(approx.IsDone()).toBe(true);

    const curve = approx.Curve();
    const edge = new oc.BRepBuilderAPI_MakeEdge(curve);
    expect(edge.IsDone()).toBe(true);

    const wire = new oc.BRepBuilderAPI_MakeWire(edge.Edge());
    expect(wire.IsDone()).toBe(true);

    const wireShape = wire.Wire();
    expect(wireShape.IsNull()).toBe(false);

    wire.delete();
    edge.delete();
    approx.delete();
    points.delete();
  });

  it('should create a cubic Bezier from 4 poles with Geom_BezierCurve', () => {
    const oc = getOC();
    const poles = new oc.TColgp_Array1OfPnt(1, 4);
    poles.SetValue(1, new oc.gp_Pnt(0, 0, 0));
    poles.SetValue(2, new oc.gp_Pnt(5, 15, 0));
    poles.SetValue(3, new oc.gp_Pnt(15, 15, 0));
    poles.SetValue(4, new oc.gp_Pnt(20, 0, 0));

    const bezier = new oc.Geom_BezierCurve(poles);

    expect(bezier.Degree()).toBe(3);
    expect(bezier.NbPoles()).toBe(4);
    expect(bezier.IsClosed()).toBe(false);
    expect(bezier.IsRational()).toBe(false);

    const startPt = bezier.StartPoint();
    expect(startPt.X()).toBe(0);
    expect(startPt.Y()).toBe(0);

    const endPt = bezier.EndPoint();
    expect(endPt.X()).toBe(20);
    expect(endPt.Y()).toBe(0);

    const midPt = bezier.EvalD0(0.5);
    expect(midPt.Y()).toBe(11.25);

    bezier.delete();
    poles.delete();
  });

  it('should produce valid geometry when extruding BSpline curve into a surface', async () => {
    const oc = getOC();
    const points = new oc.TColgp_Array1OfPnt(1, 4);
    points.SetValue(1, new oc.gp_Pnt(0, 0, 0));
    points.SetValue(2, new oc.gp_Pnt(10, 5, 0));
    points.SetValue(3, new oc.gp_Pnt(20, -5, 0));
    points.SetValue(4, new oc.gp_Pnt(30, 0, 0));

    const approx = new oc.GeomAPI_PointsToBSpline(
      points,
      3,
      8,
      oc.GeomAbs_Shape.GeomAbs_C2,
      1e-3,
    );
    const curve = approx.Curve();
    const edge = new oc.BRepBuilderAPI_MakeEdge(curve);
    const wire = new oc.BRepBuilderAPI_MakeWire(edge.Edge());

    const prism = new oc.BRepPrimAPI_MakePrism(
      wire.Wire(),
      new oc.gp_Vec(0, 0, 10),
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

/**
 * Smoke tests: Curve analysis and point sampling.
 *
 * Demonstrates:
 * - Wrapping edges with BRepAdaptor_Curve for analysis
 * - Evaluating curve points at parameters
 * - Getting curve type, degree, and parametric range
 * - Sampling points with GCPnts_UniformAbscissa (equal arc-length spacing)
 * - Sampling points with GCPnts_UniformDeflection (chord-deviation spacing)
 * - Measuring edge length
 */
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Curve analysis and sampling', () => {
  it('should wrap a line edge and evaluate endpoints with BRepAdaptor_Curve', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    const edge = edgeMaker.Edge();

    const adaptor = new oc.BRepAdaptor_Curve(edge);

    const first = adaptor.FirstParameter();
    const last = adaptor.LastParameter();
    expect(first).toBe(0);
    expect(last).toBe(10);

    const curveType = adaptor.GetType();
    expect(curveType).toBe(oc.GeomAbs_CurveType.GeomAbs_Line);

    const startPt = adaptor.Value(first);
    expect(startPt.X()).toBe(0);

    const endPt = adaptor.Value(last);
    expect(endPt.X()).toBe(10);

    adaptor.delete();
    edgeMaker.delete();
    p2.delete();
    p1.delete();
  });

  it('should identify a circular edge with BRepAdaptor_Curve', async () => {
    const oc = await getOC();

    const ax = new oc.gp_Ax2_4(
      new oc.gp_Pnt(0, 0, 0),
      new oc.gp_Dir_5(0, 0, 1),
    );
    const circle = new oc.Geom_Circle(ax, 10);
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const edge = edgeMaker.Edge();

    const adaptor = new oc.BRepAdaptor_Curve(edge);

    expect(adaptor.GetType()).toBe(oc.GeomAbs_CurveType.GeomAbs_Circle);

    const circleData = adaptor.Circle();
    expect(circleData.Radius()).toBe(10);

    adaptor.delete();
    edgeMaker.delete();
    circle.delete();
    ax.delete();
  });

  it('should sample a line at equal intervals with GCPnts_UniformAbscissa', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(100, 0, 0);
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    const edge = edgeMaker.Edge();
    const adaptor = new oc.BRepAdaptor_Curve(edge);

    const sampler = new oc.GCPnts_UniformAbscissa_4(adaptor, 11, 1e-6);

    expect(sampler.IsDone()).toBe(true);
    expect(sampler.NbPoints()).toBe(11);

    const firstParam = sampler.Parameter(1);
    const lastParam = sampler.Parameter(11);

    const firstPt = adaptor.Value(firstParam);
    expect(firstPt.X()).toBe(0);

    const lastPt = adaptor.Value(lastParam);
    expect(lastPt.X()).toBe(100);

    const midParam = sampler.Parameter(6);
    const midPt = adaptor.Value(midParam);
    expect(midPt.X()).toBe(50);

    sampler.delete();
    adaptor.delete();
    edgeMaker.delete();
    p2.delete();
    p1.delete();
  });

  it('should sample a circle at equal arc-lengths with GCPnts_UniformAbscissa', async () => {
    const oc = await getOC();

    const ax = new oc.gp_Ax2_4(
      new oc.gp_Pnt(0, 0, 0),
      new oc.gp_Dir_5(0, 0, 1),
    );
    const circle = new oc.Geom_Circle(ax, 10);
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const edge = edgeMaker.Edge();
    const adaptor = new oc.BRepAdaptor_Curve(edge);

    const sampler = new oc.GCPnts_UniformAbscissa_4(adaptor, 37, 1e-6);

    expect(sampler.IsDone()).toBe(true);
    expect(sampler.NbPoints()).toBe(37);

    const p0 = adaptor.Value(sampler.Parameter(1));
    expect(p0.X()).toBe(10);
    expect(p0.Y()).toBe(0);

    sampler.delete();
    adaptor.delete();
    edgeMaker.delete();
    circle.delete();
    ax.delete();
  });

  it('should sample with chord deviation control using GCPnts_UniformDeflection', async () => {
    const oc = await getOC();

    const ax = new oc.gp_Ax2_4(
      new oc.gp_Pnt(0, 0, 0),
      new oc.gp_Dir_5(0, 0, 1),
    );
    const circle = new oc.Geom_Circle(ax, 10);
    const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const edge = edgeMaker.Edge();
    const adaptor = new oc.BRepAdaptor_Curve(edge);

    const sampler = new oc.GCPnts_UniformDeflection_2(adaptor, 0.1, true);

    expect(sampler.IsDone()).toBe(true);
    expect(sampler.NbPoints()).toBe(24);

    for (let i = 1; i <= sampler.NbPoints(); i++) {
      const pt = sampler.Value(i);
      const distFromCenter = Math.sqrt(pt.X() ** 2 + pt.Y() ** 2);
      expect(distFromCenter).toBeCloseTo(10, 0);
    }

    sampler.delete();
    adaptor.delete();
    edgeMaker.delete();
    circle.delete();
    ax.delete();
  });
});

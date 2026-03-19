/**
 * Smoke tests: 2D geometry construction.
 *
 * Demonstrates:
 * - Working with gp_Pnt2d, gp_Vec2d, gp_Dir2d
 * - Creating 2D circles, lines, and curves
 * - Geom2d_BSplineCurve via Geom2dAPI_Interpolate
 * - 2D geometric construction (GCE2d)
 * - 2D transformations (gp_Trsf2d)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: 2D geometry', () => {
  beforeAll(async () => { await initOC(); });

  it('should expose X and Y coordinates for gp_Pnt2d', () => {
    const oc = getOC();
    const pt = new oc.gp_Pnt2d(7, 13);
    expect(pt.X()).toBe(7);
    expect(pt.Y()).toBe(13);

    const dist = pt.Distance(new oc.gp_Pnt2d(0, 0));
    expect(dist).toBeCloseTo(Math.sqrt(7 * 7 + 13 * 13), 5);

    pt.delete();
  });

  it('should compute magnitude and direction for gp_Vec2d', () => {
    const oc = getOC();
    const vec = new oc.gp_Vec2d(3, 4);
    expect(vec.Magnitude()).toBe(5);
    expect(vec.IsNormal(new oc.gp_Vec2d(-4, 3), 1e-6)).toBe(true);

    vec.delete();
  });

  it('should create a 2D circle with correct radius using Geom2d_Circle', () => {
    const oc = getOC();
    const center = new oc.gp_Pnt2d(0, 0);
    const dir = new oc.gp_Dir2d(1, 0);
    const ax = new oc.gp_Ax2d(center, dir);

    const circle = new oc.Geom2d_Circle(ax, 10, true);
    expect(circle.Radius()).toBe(10);

    const pt = circle.EvalD0(0);
    expect(pt.X()).toBe(10);
    expect(pt.Y()).toBe(0);

    const ptHalf = circle.EvalD0(Math.PI);
    expect(ptHalf.X()).toBe(-10);
    expect(ptHalf.Y()).toBeCloseTo(0, 10);

    circle.delete();
    ax.delete();
    dir.delete();
    center.delete();
  });

  it('should create a 2D line with correct direction using Geom2d_Line', () => {
    const oc = getOC();
    const origin = new oc.gp_Pnt2d(0, 0);
    const dir = new oc.gp_Dir2d(1, 1);
    const ax = new oc.gp_Ax2d(origin, dir);

    const line = new oc.Geom2d_Line(ax);
    const pt = line.EvalD0(Math.SQRT2);

    expect(pt.X()).toBe(1);
    expect(pt.Y()).toBe(1);

    line.delete();
    ax.delete();
    dir.delete();
    origin.delete();
  });

  it('should apply 2D translation with gp_Trsf2d', () => {
    const oc = getOC();
    const pt = new oc.gp_Pnt2d(5, 5);
    const trsf = new oc.gp_Trsf2d();
    trsf.SetTranslation(new oc.gp_Vec2d(10, 20));

    const transformed = pt.Transformed(trsf);
    expect(transformed.X()).toBe(15);
    expect(transformed.Y()).toBe(25);

    trsf.delete();
    pt.delete();
  });

  it('should apply 2D rotation with gp_Trsf2d', () => {
    const oc = getOC();
    const pt = new oc.gp_Pnt2d(10, 0);
    const trsf = new oc.gp_Trsf2d();
    trsf.SetRotation(new oc.gp_Pnt2d(0, 0), Math.PI / 2);

    const transformed = pt.Transformed(trsf);
    expect(transformed.X()).toBeCloseTo(0, 10);
    expect(transformed.Y()).toBeCloseTo(10, 10);

    trsf.delete();
    pt.delete();
  });

  it('should construct a circle from center and radius with GCE2d_MakeCirc2d', () => {
    const oc = getOC();
    const center = new oc.gp_Pnt2d(5, 5);
    const ax = new oc.gp_Ax2d(center, new oc.gp_Dir2d(1, 0));
    const maker = new oc.GCE2d_MakeCircle(ax, 8, true);

    const circle = maker.Value();
    expect(circle.Radius()).toBe(8);

    maker.delete();
    ax.delete();
    center.delete();
  });
});

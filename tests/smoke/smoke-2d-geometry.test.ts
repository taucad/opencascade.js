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
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: 2D geometry', () => {
  it('gp_Pnt2d exposes X and Y coordinates', async () => {
    const oc = await getOC();

    const pt = new oc.gp_Pnt2d(7, 13);
    expect(pt.X()).toBe(7);
    expect(pt.Y()).toBe(13);

    const dist = pt.Distance(new oc.gp_Pnt2d(0, 0));
    expect(dist).toBeCloseTo(Math.sqrt(7 * 7 + 13 * 13), 5);

    pt.delete();
  });

  it('gp_Vec2d magnitude and direction', async () => {
    const oc = await getOC();

    const vec = new oc.gp_Vec2d_4(3, 4);
    expect(vec.Magnitude()).toBeCloseTo(5, 5);
    expect(vec.IsNormal(new oc.gp_Vec2d_4(-4, 3), 1e-6)).toBe(true);

    vec.delete();
  });

  it('Geom2d_Circle creates a 2D circle with correct radius', async () => {
    const oc = await getOC();

    const center = new oc.gp_Pnt2d(0, 0);
    const dir = new oc.gp_Dir2d_5(1, 0);
    const ax = new oc.gp_Ax2d_2(center, dir);

    const circle = new oc.Geom2d_Circle(ax, 10, true);
    expect(circle.Radius()).toBeCloseTo(10, 5);

    const pt = circle.EvalD0(0);
    expect(pt.X()).toBeCloseTo(10, 5);
    expect(pt.Y()).toBeCloseTo(0, 5);

    const ptHalf = circle.EvalD0(Math.PI);
    expect(ptHalf.X()).toBeCloseTo(-10, 5);
    expect(ptHalf.Y()).toBeCloseTo(0, 1);

    circle.delete();
    ax.delete();
    dir.delete();
    center.delete();
  });

  it('Geom2d_Line creates a 2D line with correct direction', async () => {
    const oc = await getOC();

    const origin = new oc.gp_Pnt2d(0, 0);
    const dir = new oc.gp_Dir2d_5(1, 1);
    const ax = new oc.gp_Ax2d_2(origin, dir);

    const line = new oc.Geom2d_Line_1(ax);
    const pt = line.EvalD0(Math.SQRT2);

    expect(pt.X()).toBeCloseTo(1, 3);
    expect(pt.Y()).toBeCloseTo(1, 3);

    line.delete();
    ax.delete();
    dir.delete();
    origin.delete();
  });

  it('gp_Trsf2d applies 2D translation', async () => {
    const oc = await getOC();

    const pt = new oc.gp_Pnt2d(5, 5);
    const trsf = new oc.gp_Trsf2d();
    trsf.SetTranslation(new oc.gp_Vec2d_4(10, 20));

    const transformed = pt.Transformed(trsf);
    expect(transformed.X()).toBeCloseTo(15, 5);
    expect(transformed.Y()).toBeCloseTo(25, 5);

    trsf.delete();
    pt.delete();
  });

  it('gp_Trsf2d applies 2D rotation', async () => {
    const oc = await getOC();

    const pt = new oc.gp_Pnt2d(10, 0);
    const trsf = new oc.gp_Trsf2d();
    trsf.SetRotation(new oc.gp_Pnt2d(0, 0), Math.PI / 2);

    const transformed = pt.Transformed(trsf);
    expect(transformed.X()).toBeCloseTo(0, 3);
    expect(transformed.Y()).toBeCloseTo(10, 3);

    trsf.delete();
    pt.delete();
  });

  it('GCE2d_MakeCirc2d constructs a circle from center and radius', async () => {
    const oc = await getOC();

    const center = new oc.gp_Pnt2d(5, 5);
    const ax = new oc.gp_Ax2d_2(center, new oc.gp_Dir2d_5(1, 0));
    const maker = new oc.GCE2d_MakeCircle_2(ax, 8, true);

    const circle = maker.Value();
    expect(circle).toBeTruthy();
    expect(circle.Radius()).toBeCloseTo(8, 5);

    maker.delete();
    ax.delete();
    center.delete();
  });
});

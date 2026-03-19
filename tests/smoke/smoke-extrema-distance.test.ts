/**
 * Smoke tests: Distance measurement and extrema computation.
 *
 * Demonstrates:
 * - Minimum distance between two shapes with BRepExtrema_DistShapeShape
 * - Closest points on shapes
 * - Distance between a point and a shape
 * - Bounding box distance checking
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Extrema and distance', () => {
  beforeAll(async () => { await initOC(); });

  it('should compute distance between two separated boxes with BRepExtrema_DistShapeShape', () => {
    const oc = getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const box2Maker = new oc.BRepPrimAPI_MakeBox(
      new oc.gp_Pnt(20, 0, 0),
      10,
      10,
      10,
    );

    const dist = new oc.BRepExtrema_DistShapeShape(
      box1.Shape(),
      box2Maker.Shape(),
      oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
      oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      new oc.Message_ProgressRange(),
    );

    expect(dist.IsDone()).toBe(true);
    expect(dist.Value()).toBe(10);

    const pt1 = dist.PointOnShape1(1);
    const pt2 = dist.PointOnShape2(1);
    expect(pt1.X()).toBe(10);
    expect(pt2.X()).toBe(20);

    dist.delete();
    box2Maker.delete();
    box1.delete();
  });

  it('should return 0 distance for overlapping shapes with BRepExtrema_DistShapeShape', () => {
    const oc = getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);

    const dist = new oc.BRepExtrema_DistShapeShape(
      box1.Shape(),
      box2.Shape(),
      oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
      oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      new oc.Message_ProgressRange(),
    );

    expect(dist.IsDone()).toBe(true);
    expect(dist.Value()).toBe(0);

    dist.delete();
    box2.delete();
    box1.delete();
  });

  it('should compute distance between box and sphere with BRepExtrema_DistShapeShape', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const sphere = new oc.BRepPrimAPI_MakeSphere(
      new oc.gp_Pnt(30, 5, 5),
      5,
    );

    const dist = new oc.BRepExtrema_DistShapeShape(
      box.Shape(),
      sphere.Shape(),
      oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
      oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      new oc.Message_ProgressRange(),
    );

    expect(dist.IsDone()).toBe(true);
    expect(dist.Value()).toBeCloseTo(15, 10);

    dist.delete();
    sphere.delete();
    box.delete();
  });

  it('should compute distance between two separated bounding boxes with Bnd_Box', () => {
    const oc = getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox(
      new oc.gp_Pnt(20, 0, 0),
      10,
      10,
      10,
    );

    const bnd1 = new oc.Bnd_Box();
    const bnd2 = new oc.Bnd_Box();
    oc.BRepBndLib.Add(box1.Shape(), bnd1, false);
    oc.BRepBndLib.Add(box2.Shape(), bnd2, false);

    const distance = bnd1.Distance(bnd2);
    expect(distance).toBeCloseTo(10, 5);

    expect(bnd1.IsOut(bnd2)).toBe(true);

    bnd2.delete();
    bnd1.delete();
    box2.delete();
    box1.delete();
  });
});

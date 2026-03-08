/**
 * Smoke tests: Distance measurement and extrema computation.
 *
 * Demonstrates:
 * - Minimum distance between two shapes with BRepExtrema_DistShapeShape
 * - Closest points on shapes
 * - Distance between a point and a shape
 * - Bounding box distance checking
 */
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Extrema and distance', () => {
  it('BRepExtrema_DistShapeShape computes distance between two separated boxes', async () => {
    const oc = await getOC();

    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2Maker = new oc.BRepPrimAPI_MakeBox_3(
      new oc.gp_Pnt(20, 0, 0),
      10,
      10,
      10,
    );

    const dist = new oc.BRepExtrema_DistShapeShape(
      box1.Shape(),
      box2Maker.Shape(),
      oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN as never,
      oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad as never,
      new oc.Message_ProgressRange(),
    );

    expect(dist.IsDone()).toBe(true);
    expect(dist.Value()).toBeCloseTo(10, 1);

    const pt1 = dist.PointOnShape1(1);
    const pt2 = dist.PointOnShape2(1);
    expect(pt1.X()).toBeCloseTo(10, 1);
    expect(pt2.X()).toBeCloseTo(20, 1);

    dist.delete();
    box2Maker.delete();
    box1.delete();
  });

  it('BRepExtrema_DistShapeShape returns 0 for overlapping shapes', async () => {
    const oc = await getOC();

    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);

    const dist = new oc.BRepExtrema_DistShapeShape(
      box1.Shape(),
      box2.Shape(),
      oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN as never,
      oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad as never,
      new oc.Message_ProgressRange(),
    );

    expect(dist.IsDone()).toBe(true);
    expect(dist.Value()).toBeCloseTo(0, 1);

    dist.delete();
    box2.delete();
    box1.delete();
  });

  it('BRepExtrema_DistShapeShape between box and sphere', async () => {
    const oc = await getOC();

    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const sphere = new oc.BRepPrimAPI_MakeSphere_5(
      new oc.gp_Pnt(30, 5, 5),
      5,
    );

    const dist = new oc.BRepExtrema_DistShapeShape(
      box.Shape(),
      sphere.Shape(),
      oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN as never,
      oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad as never,
      new oc.Message_ProgressRange(),
    );

    expect(dist.IsDone()).toBe(true);
    expect(dist.Value()).toBeCloseTo(15, 1);

    dist.delete();
    sphere.delete();
    box.delete();
  });

  it('Bnd_Box distance between two separated bounding boxes', async () => {
    const oc = await getOC();

    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_3(
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
    expect(distance).toBeCloseTo(10, 1);

    expect(bnd1.IsOut_4(bnd2)).toBe(true);

    bnd2.delete();
    bnd1.delete();
    box2.delete();
    box1.delete();
  });
});

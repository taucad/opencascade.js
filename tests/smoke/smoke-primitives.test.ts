import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRep primitives', () => {
  it('should create a 10x20x30 box with correct dimensions', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 20, 30],
      center: [5, 10, 15],
    });

    box.delete();
  });

  it('should create a cylinder with correct diameter and height', async () => {
    const oc = await getOC();
    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(5, 15);
    const shape = cyl.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 15],
      center: [0, 0, 7.5],
    });

    cyl.delete();
  });

  it('should create a sphere with correct diameter', async () => {
    const oc = await getOC();
    const sphere = new oc.BRepPrimAPI_MakeSphere_1(8);
    const shape = sphere.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [16, 16, 16],
      center: [0, 0, 0],
    });

    sphere.delete();
  });

  it('should create an offset box with gp_Pnt origin', async () => {
    const oc = await getOC();
    const origin = new oc.gp_Pnt(1, 2, 3);
    const box = new oc.BRepPrimAPI_MakeBox_3(origin, 10, 20, 30);
    const shape = box.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 20, 30],
      center: [6, 12, 18],
    });

    box.delete();
    origin.delete();
  });

  it('should create an offset sphere with center point', async () => {
    const oc = await getOC();
    const center = new oc.gp_Pnt(5, 5, 5);
    const sphere = new oc.BRepPrimAPI_MakeSphere_5(center, 12);
    const shape = sphere.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [24, 24, 24],
      center: [5, 5, 5],
    });

    sphere.delete();
    center.delete();
  });

  it('should create a cone with correct dimensions', async () => {
    const oc = await getOC();
    const cone = new oc.BRepPrimAPI_MakeCone_1(10, 5, 20);
    const shape = cone.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 20, 20],
      center: [0, 0, 10],
    });

    cone.delete();
  });

  it('should create a torus with correct dimensions', async () => {
    const oc = await getOC();
    const torus = new oc.BRepPrimAPI_MakeTorus_1(10, 3);
    const shape = torus.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [26, 26, 6],
      center: [0, 0, 0],
    });

    torus.delete();
  });
});

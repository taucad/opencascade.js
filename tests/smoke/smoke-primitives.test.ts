import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRep primitives', () => {
  it('MakeBox creates a non-null shape', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
  });

  it('MakeCylinder creates a non-null shape', async () => {
    const oc = await getOC();
    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(5, 15);
    const shape = cyl.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    cyl.delete();
  });

  it('MakeSphere creates a non-null shape', async () => {
    const oc = await getOC();
    const sphere = new oc.BRepPrimAPI_MakeSphere_1(8);
    const shape = sphere.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    sphere.delete();
  });

  it('MakeBox with gp_Pnt origin creates a non-null shape', async () => {
    const oc = await getOC();
    const origin = new oc.gp_Pnt(1, 2, 3);
    const box = new oc.BRepPrimAPI_MakeBox_3(origin, 10, 20, 30);
    const shape = box.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
    origin.delete();
  });

  it('MakeSphere with center point creates a non-null shape', async () => {
    const oc = await getOC();
    const center = new oc.gp_Pnt(5, 5, 5);
    const sphere = new oc.BRepPrimAPI_MakeSphere_5(center, 12);
    const shape = sphere.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    sphere.delete();
    center.delete();
  });
});

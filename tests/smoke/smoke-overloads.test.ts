import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: overloaded constructors and methods', () => {
  it('gp_Pnt has 0-arg and 3-arg constructor overloads', async () => {
    const oc = await getOC();
    const pnt0 = new oc.gp_Pnt();
    const pnt3 = new oc.gp_Pnt(1, 2, 3);
    expect(pnt0).toBeTruthy();
    expect(pnt3).toBeTruthy();
    expect(pnt3.X()).toBe(1);
    expect(pnt3.Y()).toBe(2);
    expect(pnt3.Z()).toBe(3);
    pnt0.delete();
    pnt3.delete();
  });

  it('BRepPrimAPI_MakeBox has _2 (dx/dy/dz) and _3 (gp_Pnt + dx/dy/dz) subclass constructors', async () => {
    const oc = await getOC();
    const box2 = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const origin = new oc.gp_Pnt(1, 2, 3);
    const box3 = new oc.BRepPrimAPI_MakeBox_3(origin, 10, 20, 30);
    expect(box2.Shape().IsNull()).toBe(false);
    expect(box3.Shape().IsNull()).toBe(false);
    box2.delete();
    box3.delete();
    origin.delete();
  });

  it('gp_Pnt.SetCoord overloads work (index+value and x,y,z)', async () => {
    const oc = await getOC();
    const pnt = new oc.gp_Pnt(0, 0, 0);
    pnt.SetCoord(1, 5); // set Y to 5 (index 0=X, 1=Y, 2=Z)
    pnt.SetCoord(10, 20, 30); // set all coords
    expect(pnt.X()).toBe(10);
    expect(pnt.Y()).toBe(20);
    expect(pnt.Z()).toBe(30);
    pnt.delete();
  });
});

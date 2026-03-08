import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Geometry', () => {
  it('gp_Pnt exposes X, Y, Z coordinates', async () => {
    const oc = await getOC();
    const pnt = new oc.gp_Pnt_3(1, 2, 3);
    expect(pnt.X()).toBe(1);
    expect(pnt.Y()).toBe(2);
    expect(pnt.Z()).toBe(3);
    pnt.delete();
  });

  it('gp_Vec IsNull and Magnitude work', async () => {
    const oc = await getOC();
    const nullVec = new oc.gp_Vec_4(0, 0, 0);
    expect(nullVec.IsNull()).toBe(true);
    const vec = new oc.gp_Vec_4(3, 4, 0);
    expect(vec.IsNull()).toBe(false);
    expect(vec.Magnitude()).toBe(5);
    nullVec.delete();
    vec.delete();
  });

  it('Geom_Circle, BRepBuilderAPI_MakeEdge, MakeWire, MakeFace produce valid face', async () => {
    const oc = await getOC();
    const axis = new oc.gp_Ax2_3(
      new oc.gp_Pnt_1(),
      new oc.gp_Dir_4(0, 0, 1),
    );
    const circle = new oc.Geom_Circle_2(axis, 5);
    const makeEdge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const edge = makeEdge.Edge();
    const makeWire = new oc.BRepBuilderAPI_MakeWire_2(edge);
    const wire = makeWire.Wire();
    const makeFace = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
    const shape = makeFace.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    axis.delete();
    circle.delete();
    makeEdge.delete();
    makeWire.delete();
    makeFace.delete();
  });
});

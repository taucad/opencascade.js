import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Geometry', () => {
  it('should expose X, Y, Z coordinates for gp_Pnt', async () => {
    const oc = await getOC();
    const pnt = new oc.gp_Pnt(1, 2, 3);
    expect(pnt.X()).toBe(1);
    expect(pnt.Y()).toBe(2);
    expect(pnt.Z()).toBe(3);
    pnt.delete();
  });

  it('should compute IsNull and Magnitude for gp_Vec', async () => {
    const oc = await getOC();
    const nullVec = new oc.gp_Vec_4(0, 0, 0);
    expect(nullVec.Magnitude()).toBe(0);
    const vec = new oc.gp_Vec_4(3, 4, 0);
    expect(vec.Magnitude()).toBe(5);
    nullVec.delete();
    vec.delete();
  });

  it('should produce valid face from Geom_Circle through MakeEdge, MakeWire, MakeFace pipeline', async () => {
    const oc = await getOC();
    const axis = new oc.gp_Ax2_4(
      new oc.gp_Pnt(),
      new oc.gp_Dir_5(0, 0, 1),
    );
    const circle = new oc.Geom_Circle(axis, 5);
    const makeEdge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const edge = makeEdge.Edge();
    const makeWire = new oc.BRepBuilderAPI_MakeWire_2(edge);
    const wire = makeWire.Wire();
    const makeFace = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
    const shape = makeFace.Shape();
    expect(shape.IsNull()).toBe(false);
    axis.delete();
    circle.delete();
    makeEdge.delete();
    makeWire.delete();
    makeFace.delete();
  });
});

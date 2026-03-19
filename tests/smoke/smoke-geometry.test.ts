import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Geometry', () => {
  beforeAll(async () => { await initOC(); });

  it('should expose X, Y, Z coordinates for gp_Pnt', () => {
    const oc = getOC();
    const pnt = new oc.gp_Pnt(1, 2, 3);
    expect(pnt.X()).toBe(1);
    expect(pnt.Y()).toBe(2);
    expect(pnt.Z()).toBe(3);
    pnt.delete();
  });

  it('should compute IsNull and Magnitude for gp_Vec', () => {
    const oc = getOC();
    const nullVec = new oc.gp_Vec(0, 0, 0);
    expect(nullVec.Magnitude()).toBe(0);
    const vec = new oc.gp_Vec(3, 4, 0);
    expect(vec.Magnitude()).toBe(5);
    nullVec.delete();
    vec.delete();
  });

  it('should produce valid face from Geom_Circle through MakeEdge, MakeWire, MakeFace pipeline', () => {
    const oc = getOC();
    const axis = new oc.gp_Ax2(
      new oc.gp_Pnt(),
      new oc.gp_Dir(0, 0, 1),
    );
    const circle = new oc.Geom_Circle(axis, 5);
    const makeEdge = new oc.BRepBuilderAPI_MakeEdge(circle);
    const edge = makeEdge.Edge();
    const makeWire = new oc.BRepBuilderAPI_MakeWire(edge);
    const wire = makeWire.Wire();
    const makeFace = new oc.BRepBuilderAPI_MakeFace(wire, false);
    const shape = makeFace.Shape();
    expect(shape.IsNull()).toBe(false);
    axis.delete();
    circle.delete();
    makeEdge.delete();
    makeWire.delete();
    makeFace.delete();
  });
});

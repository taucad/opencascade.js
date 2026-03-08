import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Handle construction and cross-class passing', () => {
  it('creates Geom_Line, passes directly to BRepBuilderAPI_MakeEdge (unified API)', async () => {
    const oc = await getOC();

    const ax1 = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(1, 0, 0));
    const geomLine = new oc.Geom_Line_1(ax1);
    expect(geomLine.isNull()).toBe(false);

    const makeEdge = new oc.BRepBuilderAPI_MakeEdge_24(geomLine);
    expect(makeEdge.IsDone()).toBe(true);
    const edge = makeEdge.Edge();
    expect(edge).toBeTruthy();
    expect(edge.IsNull()).toBe(false);

    makeEdge.delete();
    geomLine.delete();
    ax1.delete();
  });

  it('creates Geom_Circle, passes directly to BRepBuilderAPI_MakeEdge (unified API)', async () => {
    const oc = await getOC();

    const ax2 = new oc.gp_Ax2_3(new oc.gp_Pnt_1(), new oc.gp_Dir_4(0, 0, 1));
    const geomCircle = new oc.Geom_Circle_2(ax2, 5);
    expect(geomCircle.isNull()).toBe(false);

    const makeEdge = new oc.BRepBuilderAPI_MakeEdge_24(geomCircle);
    expect(makeEdge.IsDone()).toBe(true);
    const edge = makeEdge.Edge();
    expect(edge).toBeTruthy();
    expect(edge.IsNull()).toBe(false);

    makeEdge.delete();
    geomCircle.delete();
    ax2.delete();
  });
});

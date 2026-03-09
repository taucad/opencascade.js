import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Handle construction and cross-class passing', () => {
  it('should create edge from Geom_Line via unified API', async () => {
    const oc = await getOC();

    const ax1 = new oc.gp_Ax1_2(new oc.gp_Pnt(), new oc.gp_Dir_5(1, 0, 0));
    const geomLine = new oc.Geom_Line_1(ax1);
    expect(geomLine.isNull()).toBe(false);

    const makeEdge = new oc.BRepBuilderAPI_MakeEdge_24(geomLine);
    expect(makeEdge.IsDone()).toBe(true);
    const edge = makeEdge.Edge();
    expect(edge.IsNull()).toBe(false);

    makeEdge.delete();
    geomLine.delete();
    ax1.delete();
  });

  it('should create edge from Geom_Circle via unified API', async () => {
    const oc = await getOC();

    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const geomCircle = new oc.Geom_Circle(ax2, 5);
    expect(geomCircle.isNull()).toBe(false);

    const makeEdge = new oc.BRepBuilderAPI_MakeEdge_24(geomCircle);
    expect(makeEdge.IsDone()).toBe(true);
    const edge = makeEdge.Edge();
    expect(edge.IsNull()).toBe(false);

    makeEdge.delete();
    geomCircle.delete();
    ax2.delete();
  });
});

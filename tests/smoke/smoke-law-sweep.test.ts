/**
 * Smoke tests: Law-governed sweep operations.
 *
 * Validates Law_Linear, Law_S, and pipe sweeps with variable scaling.
 * Used by brepjs for variable-section sweep operations.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Law-governed sweeps', () => {
  beforeAll(async () => { await initOC(); });

  it('should return correct boundary values from Law_Linear at first and last parameter', () => {
    const oc = getOC();
    using law = new oc.Law_Linear();
    law.Set(0, 1, 1, 2);

    expect(Math.abs(law.Value(0) - 1)).toBeLessThan(1e-7);
    expect(Math.abs(law.Value(1) - 2)).toBeLessThan(1e-7);
    expect(Math.abs(law.Value(0.5) - 1.5)).toBeLessThan(1e-7);
  });

  it('should return smooth S-curve values from Law_S at endpoints and midpoint', () => {
    const oc = getOC();
    using law = new oc.Law_S();
    law.Set(0, 1, 1, 3);

    expect(Math.abs(law.Value(0) - 1)).toBeLessThan(1e-6);
    expect(Math.abs(law.Value(1) - 3)).toBeLessThan(1e-6);

    const midValue = law.Value(0.5);
    expect(midValue).toBeGreaterThan(1);
    expect(midValue).toBeLessThan(3);
  });

  it('should produce a swept solid with expected dimensions using Law_Linear scaling', async () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt(0, 0, 0);
    using p2 = new oc.gp_Pnt(0, 0, 30);
    using spineEdge = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
    using spineWire = new oc.BRepBuilderAPI_MakeWire(spineEdge.Edge());

    using axOrigin = new oc.gp_Pnt(0, 0, 0);
    using axDir = new oc.gp_Dir(0, 0, 1);
    using ax = new oc.gp_Ax2(axOrigin, axDir);
    using circle = new oc.Geom_Circle(ax, 5);
    using profileEdge = new oc.BRepBuilderAPI_MakeEdge(circle);
    using profileWire = new oc.BRepBuilderAPI_MakeWire(profileEdge.Edge());

    using pipeShell = new oc.BRepOffsetAPI_MakePipeShell(spineWire.Wire());

    using law = new oc.Law_Linear();
    law.Set(0, 1, 1, 0.5);

    pipeShell.SetLaw(profileWire.Wire(), law, false, false);

    using progress = new oc.Message_ProgressRange();
    pipeShell.Build(progress);
    pipeShell.MakeSolid();

    const shape = pipeShell.Shape();
    expect(shape.IsNull()).toBe(false);

    using bbox = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, bbox, false);

    const widthAtBase = bbox.GetXMax() - bbox.GetXMin();
    expect(widthAtBase).toBeGreaterThan(4);
    expect(bbox.GetZMax()).toBeCloseTo(30, 0);
  });
});

import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Helix geometry', () => {
  it('should construct HelixBRep_BuilderHelix', async () => {
    const oc = await getOC();
    const builder = new oc.HelixBRep_BuilderHelix();
    expect(builder.ErrorStatus()).toBe(1);
    builder.delete();
  });

  it('should construct and configure HelixGeom_BuilderHelix', async () => {
    const oc = await getOC();
    const ax = new oc.gp_Ax2_4(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir_5(0, 0, 1));
    const builder = new oc.HelixGeom_BuilderHelix();
    builder.SetPosition(ax);
    builder.SetCurveParameters(0, 2 * Math.PI * 3, 10, 5, 0, false);
    builder.Perform();

    expect(builder.ErrorStatus()).toBe(0);

    builder.delete();
    ax.delete();
  });

  it('should construct and configure HelixGeom_BuilderHelixCoil', async () => {
    const oc = await getOC();
    const builder = new oc.HelixGeom_BuilderHelixCoil();
    builder.SetCurveParameters(0, 2 * Math.PI * 2, 8, 4, 0, true);
    builder.Perform();

    expect(builder.ErrorStatus()).toBe(0);

    builder.delete();
  });

  it('should load HelixGeom_HelixCurve with parameters', async () => {
    const oc = await getOC();
    const curve = new oc.HelixGeom_HelixCurve();
    curve.Load(0, 2 * Math.PI * 3, 10, 5, 0, false);

    expect(curve.FirstParameter()).toBe(0);
    expect(curve.LastParameter()).toBeCloseTo(2 * Math.PI * 3, 3);

    curve.delete();
  });
});

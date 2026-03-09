import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Fair curves', () => {
  it('should compute a constrained curve via FairCurve_Batten wrapper', async () => {
    const oc = await getOC();
    const p1 = new oc.gp_Pnt2d(0, 0);
    const p2 = new oc.gp_Pnt2d(10, 5);
    const batten = new oc.FairCurve_Batten(p1, p2, 2.0, 1);

    const computeFn = (oc as any).FairCurve_Batten_Compute;
    const code = computeFn(batten, 50, 1e-3);
    expect(code).toBeDefined();
    expect(typeof code).toBe('number');

    const curve = batten.Curve();
    expect(curve.Degree()).toBeGreaterThanOrEqual(1);

    batten.delete();
    p2.delete();
    p1.delete();
  });

  it('should compute a smoother constrained curve via FairCurve_MinimalVariation', async () => {
    const oc = await getOC();
    const p1 = new oc.gp_Pnt2d(0, 0);
    const p2 = new oc.gp_Pnt2d(10, 5);
    const mv = new oc.FairCurve_MinimalVariation(p1, p2, 2.0, 1, 0);

    const computeFn = (oc as any).FairCurve_MinimalVariation_Compute;
    const code = computeFn(mv, 50, 1e-3);
    expect(code).toBeDefined();
    expect(typeof code).toBe('number');

    const curve = mv.Curve();
    expect(curve.Degree()).toBeGreaterThanOrEqual(1);

    mv.delete();
    p2.delete();
    p1.delete();
  });
});

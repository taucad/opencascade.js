import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

/* eslint-disable @typescript-eslint/naming-convention -- OpenCASCADE C++ API naming */
describe.skipIf(!wasmExists)('Smoke: Fair curves', () => {
  it('should compute a constrained curve via FairCurve_Batten', async () => {
    const oc = await getOC();
    const p1 = new oc.gp_Pnt2d(0, 0);
    const p2 = new oc.gp_Pnt2d(10, 5);
    const batten = new oc.FairCurve_Batten(p1, p2, 2.0, 1);

    const codeRef = { current: 0 };
    (oc as any).FairCurve_Batten_Compute(batten, codeRef, 50, 1e-3);
    expect(typeof codeRef.current).toBe('number');

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

    const codeRef = { current: 0 };
    (oc as any).FairCurve_MinimalVariation_Compute(mv, codeRef, 50, 1e-3);
    expect(typeof codeRef.current).toBe('number');

    const curve = mv.Curve();
    expect(curve.Degree()).toBeGreaterThanOrEqual(1);

    mv.delete();
    p2.delete();
    p1.delete();
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

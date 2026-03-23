import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

/* eslint-disable @typescript-eslint/naming-convention -- OpenCASCADE C++ API naming */
describe.skipIf(!wasmExists)('Smoke: Fair curves', () => {
  beforeAll(async () => { await initOC(); });

  it('should compute a constrained curve via FairCurve_Batten', () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt2d(0, 0);
    using p2 = new oc.gp_Pnt2d(10, 5);
    using batten = new oc.FairCurve_Batten(p1, p2, 2.0, 1);

    const codeRef = { current: 0 };
    oc.FairCurve_Batten_Compute(batten, codeRef, 50, 1e-3);
    expect(typeof codeRef.current).toBe('number');

    const curve = batten.Curve();
    expect(curve.Degree()).toBeGreaterThanOrEqual(1);
  });

  it('should compute a smoother constrained curve via FairCurve_MinimalVariation', () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt2d(0, 0);
    using p2 = new oc.gp_Pnt2d(10, 5);
    using mv = new oc.FairCurve_MinimalVariation(p1, p2, 2.0, 1, 0);

    const codeRef = { current: 0 };
    oc.FairCurve_MinimalVariation_Compute(mv, codeRef, 50, 1e-3);
    expect(typeof codeRef.current).toBe('number');

    const curve = mv.Curve();
    expect(curve.Degree()).toBeGreaterThanOrEqual(1);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

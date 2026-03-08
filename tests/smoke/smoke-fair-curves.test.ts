import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Fair curves', () => {
  it('FairCurve_Batten computes a constrained curve', async () => {
    const oc = await getOC();
    const p1 = new oc.gp_Pnt2d_3(0, 0);
    const p2 = new oc.gp_Pnt2d_3(10, 5);
    const batten = new oc.FairCurve_Batten(p1, p2, 2.0, 1);
    const code = batten.Compute();
    expect(code).toBeDefined();
    batten.delete();
    p1.delete();
    p2.delete();
  });
});

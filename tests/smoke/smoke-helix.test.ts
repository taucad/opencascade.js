import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Helix geometry', () => {
  it('HelixGeom_BuilderApproxCurve creates a helical curve', async () => {
    const oc = await getOC();
    const axis = new oc.gp_Ax2_1();
    const builder = new oc.HelixGeom_BuilderApproxCurve(axis, 10, 5);
    builder.Build();
    expect(builder.IsDone()).toBe(true);
    builder.delete();
    axis.delete();
  });
});

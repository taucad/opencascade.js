import { describe, it, expect } from 'vitest';
import { getOC, wasmExists, isExceptionsEnabled } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Exception handling', () => {
  it('MakeCone with zero height throws Standard_Failure', async (ctx) => {
    const oc = await getOC();
    if (!isExceptionsEnabled()) ctx.skip();

    let caught = false;
    let message = '';

    try {
      const cone = new oc.BRepPrimAPI_MakeCone_1(1, 0.5, 0);
      cone.delete();
    } catch (e) {
      caught = true;
      if ((oc as any).OCJS?.getStandard_FailureData) {
        const failureData = (oc as any).OCJS.getStandard_FailureData(e);
        message = failureData.GetMessageString();
        failureData.delete();
      } else {
        message = String(e);
      }
    }

    expect(caught).toBe(true);
    expect(message.toLowerCase()).toContain('cone');
  });

  it('MakeBox with zero dimensions throws or produces invalid shape', async (ctx) => {
    const oc = await getOC();
    if (!isExceptionsEnabled()) ctx.skip();

    let failedAsExpected = false;

    try {
      const box = new oc.BRepPrimAPI_MakeBox_2(0, 0, 0);
      if (box.IsDone && !box.IsDone()) {
        failedAsExpected = true;
      }
      const shape = box.Shape();
      if (shape.IsNull()) {
        failedAsExpected = true;
      }
      box.delete();
    } catch {
      failedAsExpected = true;
    }

    expect(failedAsExpected).toBe(true);
  });
});

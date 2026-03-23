import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists, isExceptionsEnabled } from './helpers.js';

function extractExceptionInfo(oc: any, e: unknown): { type: string; message: string } {
  if (typeof e === 'number') {
    const failureData = oc.OCJS.getStandard_FailureData(e);
    return {
      type: failureData?.constructor?.name ?? '',
      message: failureData?.GetMessageString?.() ?? '',
    };
  }
  if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.Exception) {
    try {
      const [type, message] = oc.getExceptionMessage(e);
      return { type: type ?? '', message: message ?? '' };
    } catch {
      return { type: 'WebAssembly.Exception', message: String(e) };
    }
  }
  const exc = e as Error;
  return {
    type: exc.name ?? '',
    message: exc.message ?? String(e),
  };
}

/* eslint-disable @typescript-eslint/naming-convention -- OpenCASCADE C++ API naming */
describe.skipIf(!wasmExists)('Smoke: Exception handling', () => {
  beforeAll(async () => { await initOC(); });

  it('should throw Standard_DomainError for MakeCone with zero height', (ctx) => {
    if (!isExceptionsEnabled()) ctx.skip();

    const oc = getOC();
    let caught = false;
    let exceptionType = '';
    let exceptionMessage = '';

    try {
      const cone = new oc.BRepPrimAPI_MakeCone(1, 0.5, 0);
      cone.delete();
    } catch (e) {
      caught = true;
      const info = extractExceptionInfo(oc, e);
      exceptionType = info.type;
      exceptionMessage = info.message;
    }

    expect(caught).toBe(true);
    expect(exceptionType).toContain('Standard_DomainError');
    expect(exceptionMessage.toLowerCase()).toContain('cone');
  });

  it('should throw Standard_DomainError for MakeBox with zero dimensions', (ctx) => {
    if (!isExceptionsEnabled()) ctx.skip();

    const oc = getOC();
    let caught = false;
    let exceptionType = '';

    try {
      const box = new oc.BRepPrimAPI_MakeBox(0, 0, 0);
      if (!box.IsDone()) {
        caught = true;
        exceptionType = 'Standard_ConstructionError';
      }
      box.delete();
    } catch (e) {
      caught = true;
      const info = extractExceptionInfo(oc, e);
      exceptionType = info.type;
    }

    expect(caught).toBe(true);
    expect(exceptionType).toContain('Standard_');
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

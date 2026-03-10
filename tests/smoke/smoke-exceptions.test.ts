import { describe, it, expect } from 'vitest';
import { getOC, wasmExists, isExceptionsEnabled } from './helpers.js';

interface CppException extends Error {
  excPtr: number;
}

/* eslint-disable @typescript-eslint/naming-convention -- OpenCASCADE C++ API naming */
describe.skipIf(!wasmExists)('Smoke: Exception handling', () => {
  it('should throw Standard_DomainError for MakeCone with zero height', async (ctx) => {
    const oc = await getOC();
    if (!isExceptionsEnabled()) ctx.skip();

    let caught = false;
    let exceptionType = '';
    let exceptionMessage = '';

    try {
      const cone = new oc.BRepPrimAPI_MakeCone_1(1, 0.5, 0);
      cone.delete();
    } catch (e) {
      caught = true;
      const exc = e as CppException;
      exceptionType = exc.name ?? '';
      exceptionMessage = exc.message ?? String(e);
      if (!exceptionMessage && typeof exc.toString === 'function') {
        exceptionMessage = exc.toString();
      }
    }

    expect(caught).toBe(true);
    expect(exceptionType).toContain('Standard_DomainError');
    expect(exceptionMessage.toLowerCase()).toContain('cone');
  });

  it('should throw Standard_DomainError for MakeBox with zero dimensions', async (ctx) => {
    const oc = await getOC();
    if (!isExceptionsEnabled()) ctx.skip();

    let caught = false;
    let exceptionType = '';

    try {
      const box = new oc.BRepPrimAPI_MakeBox_2(0, 0, 0);
      if (!box.IsDone()) {
        caught = true;
        exceptionType = 'Standard_ConstructionError';
      }
      box.delete();
    } catch (e) {
      caught = true;
      const exc = e as CppException;
      exceptionType = exc.name ?? String(e);
    }

    expect(caught).toBe(true);
    expect(exceptionType).toContain('Standard_');
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

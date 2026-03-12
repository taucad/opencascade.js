import * as fs from 'node:fs';
import * as path from 'node:path';

const BUILD_DIR = path.resolve(import.meta.dirname, '../../build-configs');
const WASM_PATH = path.join(BUILD_DIR, 'opencascade_full.wasm');
const JS_PATH = path.join(BUILD_DIR, 'opencascade_full.js');

export const wasmExists = fs.existsSync(WASM_PATH) && fs.existsSync(JS_PATH);

let _oc: any;

/**
 * Initializes the shared OpenCASCADE WASM module.
 * Must be called once (typically in beforeAll) before using any OC bindings.
 * Safe to call multiple times -- subsequent calls are no-ops.
 * Returns the OpenCascadeInstance with all bindings.
 */
export async function initOC(): Promise<any> {
  if (!_oc) {
    const mod = await import(JS_PATH);
    const init: (opts?: Record<string, unknown>) => Promise<any> =
      mod.default ?? mod;

    _oc = await init({
      locateFile: (filename: string) => path.join(BUILD_DIR, filename),
    });
  }
  return _oc;
}

export function getOC(): any {
  if (!_oc) throw new Error('Call initOC() before getOC()');
  return _oc;
}

/**
 * Whether the loaded WASM build has exception handling enabled.
 * Checks for the OCJS.getStandard_FailureData method which is present
 * in exception-enabled builds.
 */
export function isExceptionsEnabled(): boolean {
  if (!_oc) return false;
  return typeof _oc.OCJS?.getStandard_FailureData === 'function';
}

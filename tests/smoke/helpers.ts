import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OpenCascadeInstance } from '../../build-configs/opencascade_full.js';
import init from '../../build-configs/opencascade_full.js';

const BUILD_DIR = path.resolve(import.meta.dirname, '../../build-configs');
const WASM_PATH = path.join(BUILD_DIR, 'opencascade_full.wasm');

export const wasmExists = fs.existsSync(WASM_PATH);

let _oc: OpenCascadeInstance | undefined;

/**
 * Initializes the shared OpenCASCADE WASM module.
 * Must be called once (typically in beforeAll) before using any OC bindings.
 * Safe to call multiple times -- subsequent calls are no-ops.
 * Returns the OpenCascadeInstance with all bindings.
 */
export async function initOC(): Promise<OpenCascadeInstance> {
  if (!_oc) {
    _oc = await init({
      locateFile: (filename: string) => path.join(BUILD_DIR, filename),
    });
  }
  return _oc;
}

export function getOC(): OpenCascadeInstance {
  if (!_oc) throw new Error('Call initOC() before getOC()');
  return _oc;
}

/**
 * Whether the loaded WASM build has exception handling enabled.
 * Uses the OCJS.exceptionsEnabled() method which checks the
 * OCJS_EXCEPTIONS compile-time macro.
 */
export function isExceptionsEnabled(): boolean {
  if (!_oc) return false;
  return _oc.OCJS.exceptionsEnabled();
}

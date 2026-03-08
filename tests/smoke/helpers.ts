import * as fs from 'node:fs';
import * as path from 'node:path';

const BUILD_DIR = path.resolve(import.meta.dirname, '../../build-configs');
const WASM_PATH = path.join(BUILD_DIR, 'opencascade_full.wasm');
const JS_PATH = path.join(BUILD_DIR, 'opencascade_full.js');

export const wasmExists = fs.existsSync(WASM_PATH) && fs.existsSync(JS_PATH);

type OpenCascadeInstance = Awaited<ReturnType<typeof initModule>>;

let instance: OpenCascadeInstance | undefined;

async function initModule() {
  const mod = await import(JS_PATH);
  const init: (opts?: Record<string, unknown>) => Promise<OpenCascadeInstance> =
    mod.default ?? mod;

  return init({
    locateFile: (filename: string) => path.join(BUILD_DIR, filename),
  });
}

/**
 * Returns a lazily-initialized, shared OpenCASCADE instance.
 * The WASM module is loaded once and reused across all smoke tests.
 */
export async function getOC(): Promise<OpenCascadeInstance> {
  if (!instance) {
    instance = await initModule();
  }
  return instance;
}

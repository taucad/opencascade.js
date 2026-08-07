import { createInstance, type OpenCascadeInstance } from 'libcascade/init';
import wasmUrl from 'libcascade/wasm?url';

let cached: Promise<OpenCascadeInstance> | null = null;

/**
 * Canonical exactly-once libcascade init for browser bundles.
 *
 * The memoized Promise is the single source of truth for the WASM runtime;
 * never call `createInstance({...})` directly elsewhere in the bundle.
 */
export function getLibcascade(): Promise<OpenCascadeInstance> {
  if (cached === null) {
    const instance = createInstance({ variant: 'single', locateFile: () => wasmUrl });
    cached = instance;
    return instance;
  }
  return cached;
}

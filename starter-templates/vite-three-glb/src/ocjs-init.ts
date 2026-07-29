import init from 'cascadic';
import wasmUrl from 'cascadic/wasm?url';

let cached: ReturnType<typeof init> | null = null;

/**
 * Canonical exactly-once OCJS init for browser bundles.
 *
 * The memoized Promise is the single source of truth for the WASM runtime;
 * never call `init({...})` directly elsewhere in the bundle.
 */
export function getOcjs(): ReturnType<typeof init> {
  if (cached === null) {
    cached = init({ locateFile: () => wasmUrl });
  }
  return cached;
}

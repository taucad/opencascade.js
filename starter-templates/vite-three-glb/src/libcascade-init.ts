import init from 'libcascade';
import wasmUrl from 'libcascade/wasm?url';

let cached: ReturnType<typeof init> | null = null;

/**
 * Canonical exactly-once libcascade init for browser bundles.
 *
 * The memoized Promise is the single source of truth for the WASM runtime;
 * never call `init({...})` directly elsewhere in the bundle.
 */
export function getLibcascade(): ReturnType<typeof init> {
  if (cached === null) {
    cached = init({ locateFile: () => wasmUrl });
  }
  return cached;
}

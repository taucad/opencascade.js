import * as path from 'node:path';
import init from 'ocjs';

let cached: ReturnType<typeof init> | null = null;

/**
 * Canonical exactly-once OCJS init for Node ESM.
 *
 * We resolve `opencascade_full.wasm` via `import.meta.resolve` so the
 * locator works regardless of how the consumer manages packages
 * (pnpm hoisting, npm linking, monorepo workspaces).
 */
export function getOcjs(): ReturnType<typeof init> {
  if (cached === null) {
    const wasmUrl = new URL(import.meta.resolve('ocjs/wasm'));
    const buildDir = path.dirname(wasmUrl.pathname);
    cached = init({
      locateFile: (filename: string) => path.join(buildDir, filename),
    });
  }
  return cached;
}

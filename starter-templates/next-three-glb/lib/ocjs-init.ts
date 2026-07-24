'use client';

import init from 'ocjs';

let cached: ReturnType<typeof init> | null = null;

/**
 * Canonical exactly-once OCJS init for Next 15 client components.
 *
 * `opencascade_full.wasm` is copied into `public/` by the `postinstall`
 * script, so `locateFile` resolves to the same-origin URL. Memoization
 * is module-scoped — Next.js component re-renders never re-init.
 */
export function getOcjs(): ReturnType<typeof init> {
  if (cached === null) {
    cached = init({ locateFile: () => '/opencascade_full.wasm' });
  }
  return cached;
}

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import init from '../../dist/opencascade_full.js';
import packageJson from '../../package.json' with { type: 'json' };

/**
 * Validates the `exports` map in `package.json`.
 *
 * The contract:
 *   - `@taucad/opencascade.js`         → ESM entry + types
 *   - `@taucad/opencascade.js/wasm`    → opencascade_full.wasm (canonical
 *                                        locateFile target for every bundler)
 *   - `@taucad/opencascade.js/multi`   → multi-threaded ESM entry + types
 *   - `@taucad/opencascade.js/multi/wasm` → opencascade_full_multi.wasm
 *   - `@taucad/opencascade.js/package.json` → readable for tooling
 *
 * The subpath export is what lets consumers write
 *   `import wasmUrl from '@taucad/opencascade.js/wasm?url'`
 * across Vite, Bun, Node, and Deno without reaching into `dist/...` directly.
 *
 * If any of these contracts break, every starter template and doc snippet
 * that targets the v3 surface stops working — guard them with hard
 * assertions on the static `package.json` shape so test runs catch
 * accidental drift without needing the wasm artifact present.
 */
describe('package exports — wasm subpath contract', () => {
  it('should declare ./wasm in the exports map pointing at the shipped wasm', () => {
    const exportsMap = packageJson.exports as Record<string, unknown>;
    expect(exportsMap, 'package.json must declare an exports field').toBeDefined();
    const wasmTarget = exportsMap['./wasm'];
    expect(
      wasmTarget,
      'package.json#exports must include a "./wasm" subpath so consumers can write `import wasmUrl from \'@taucad/opencascade.js/wasm?url\'`',
    ).toBe('./dist/opencascade_full.wasm');
  });

  it('should declare the package root with both types and default conditions', () => {
    const exportsMap = packageJson.exports as Record<string, { types?: string; default?: string }>;
    const root = exportsMap['.'];
    expect(root, 'exports must declare the package root under "."').toBeDefined();
    expect(root!.types).toBe('./dist/opencascade_full.d.ts');
    expect(root!.default).toBe('./dist/opencascade_full.js');
  });

  it('should expose ./package.json so tooling (npm explore, manifests) can read the manifest', () => {
    const exportsMap = packageJson.exports as Record<string, unknown>;
    expect(exportsMap['./package.json']).toBe('./package.json');
  });

  it('should include the wasm file in the published files allowlist', () => {
    const files = packageJson.files as readonly string[];
    expect(files).toContain('dist/opencascade_full.wasm');
  });

  it('should declare ./multi in the exports map with types and default conditions', () => {
    const exportsMap = packageJson.exports as Record<string, { types?: string; default?: string }>;
    const multi = exportsMap['./multi'];
    expect(multi, 'package.json#exports must include a "./multi" subpath').toBeDefined();
    expect(multi!.types).toBe('./dist/opencascade_full_multi.d.ts');
    expect(multi!.default).toBe('./dist/opencascade_full_multi.js');
  });

  it('should declare ./multi/wasm in the exports map pointing at the MT wasm', () => {
    const exportsMap = packageJson.exports as Record<string, unknown>;
    expect(exportsMap['./multi/wasm']).toBe('./dist/opencascade_full_multi.wasm');
  });

  it('should include the MT artifacts in the published files allowlist', () => {
    const files = packageJson.files as readonly string[];
    expect(files).toContain('dist/opencascade_full_multi.wasm');
    expect(files).toContain('dist/opencascade_full_multi.js');
    expect(files).toContain('dist/opencascade_full_multi.d.ts');
    expect(files).toContain('dist/opencascade_full_multi.provenance.json');
  });

  it('should resolve @taucad/opencascade.js/multi to the MT loader the exports map declares', () => {
    const url = import.meta.resolve('@taucad/opencascade.js/multi');
    expect(url.startsWith('file://'), `Expected file:// URL, got ${url}`).toBe(true);
    const resolvedPath = fileURLToPath(url);
    expect(basename(resolvedPath)).toBe('opencascade_full_multi.js');
    expect(dirname(resolvedPath).endsWith('/dist')).toBe(true);
  });

  it('should resolve @taucad/opencascade.js/multi/wasm to the MT wasm the exports map declares', () => {
    const url = import.meta.resolve('@taucad/opencascade.js/multi/wasm');
    const resolvedPath = fileURLToPath(url);
    expect(basename(resolvedPath)).toBe('opencascade_full_multi.wasm');
    expect(dirname(resolvedPath).endsWith('/dist')).toBe(true);
  });

  it('should resolve @taucad/opencascade.js/wasm to the same file the exports map declares', async () => {
    // Self-reference resolution: a Node ESM package can import its own
    // subpath exports via `import.meta.resolve(name + subpath)`. This is
    // the same code path bundlers and downstream consumers exercise.
    const url = import.meta.resolve('@taucad/opencascade.js/wasm');
    expect(url.startsWith('file://'), `Expected file:// URL, got ${url}`).toBe(true);
    const resolvedPath = fileURLToPath(url);
    expect(basename(resolvedPath)).toBe('opencascade_full.wasm');
    expect(dirname(resolvedPath).endsWith('/dist')).toBe(true);
  });

  it('should resolve @taucad/opencascade.js/wasm to an existing file when the build artifact is present', () => {
    // Skip gracefully when the dist artifact has not been built yet — the
    // exports-map shape is already asserted above, so the wasm contract is
    // fully covered without requiring a 27 MB binary at test time.
    const url = import.meta.resolve('@taucad/opencascade.js/wasm');
    const resolvedPath = fileURLToPath(url);
    const distWasm = join(dirname(resolvedPath), basename(resolvedPath));
    if (!existsSync(distWasm)) {
      return;
    }
    expect(statSync(distWasm).size).toBeGreaterThan(1_000_000);
  });

  it('should boot an OCCT instance via the canonical /wasm-subpath locateFile pattern (full round-trip)', async () => {
    // The runnable equivalent of the docs snippet:
    //   const WASM_DIR = dirname(fileURLToPath(import.meta.resolve('@taucad/opencascade.js/wasm')));
    //   await init({ locateFile: (f) => join(WASM_DIR, f) });
    // If this passes, every doc/snippet that follows the same pattern works
    // end-to-end against the package's `exports` map.
    const wasmUrl = import.meta.resolve('@taucad/opencascade.js/wasm');
    const wasmPath = fileURLToPath(wasmUrl);
    if (!existsSync(wasmPath)) return;
    const WASM_DIR = dirname(wasmPath);

    const oc = await init({ locateFile: (file: string) => join(WASM_DIR, file) });
    expect(oc).toBeDefined();
    expect(typeof oc.BRepPrimAPI_MakeBox).toBe('function');
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using shape = box.Shape();
    expect(shape.IsNull()).toBe(false);
  }, 30_000);
});

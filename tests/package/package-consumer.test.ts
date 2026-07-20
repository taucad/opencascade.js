import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACKAGE_FILES, validateExactFiles } from '../../scripts/package-candidate.mjs';

const tarball = process.env.OCJS_PACKAGE_TARBALL;
if (!tarball) throw new Error('OCJS_PACKAGE_TARBALL is required');

let workDir: string;
let packageDir: string;

const walk = (root: string, relative = ''): string[] => fs.readdirSync(path.join(root, relative), {
  withFileTypes: true,
}).flatMap((entry) => {
  const child = path.join(relative, entry.name);
  return entry.isDirectory() ? walk(root, child) : [child.replaceAll(path.sep, '/')];
});

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocjs-package-'));
  fs.writeFileSync(path.join(workDir, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', path.resolve(tarball)], {
    cwd: workDir,
    stdio: 'inherit',
  });
  packageDir = path.join(workDir, 'node_modules/@taucad/opencascade.js');
});

afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

describe('installed npm candidate', () => {
  it('contains exactly the public 18-file contract', () => {
    validateExactFiles(walk(packageDir), PACKAGE_FILES, 'installed package');
  });

  it('resolves every public export and boots both runtimes', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    expect(Object.keys(manifest.exports).sort()).toEqual([
      '.', './multi', './multi/wasm', './package.json', './wasm',
    ]);

    for (const variant of [
      { module: 'opencascade_full.js', wasm: 'opencascade_full.wasm', threaded: false },
      { module: 'opencascade_full_multi.js', wasm: 'opencascade_full_multi.wasm', threaded: true },
    ]) {
      const init = (await import(pathToFileURL(path.join(packageDir, 'dist', variant.module)).href)).default;
      const oc = await init({ locateFile: (file: string) => path.join(packageDir, 'dist', file) });
      expect(oc.wasmMemory).toBeInstanceOf(WebAssembly.Memory);
      expect(oc.wasmMemory.buffer).toBeInstanceOf(
        variant.threaded ? SharedArrayBuffer : ArrayBuffer,
      );
      using box = new oc.BRepPrimAPI_MakeBox(1, 2, 3);
      using shape = box.Shape();
      expect(shape.IsNull()).toBe(false);
      if (variant.threaded) {
        using pool = oc.OSD_ThreadPool.DefaultPool(-1);
        expect(pool.NbThreads()).toBeGreaterThan(1);
        oc.PThread?.terminateAllThreads?.();
      }
      expect(fs.statSync(path.join(packageDir, 'dist', variant.wasm)).size).toBeGreaterThan(1_000_000);
    }
  });
});

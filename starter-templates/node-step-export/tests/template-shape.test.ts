/**
 * Fork-internal shape guard for the `node-step-export` v3 starter template.
 *
 * Runs from the fork's root `vitest.config.ts` (the `include` glob picks up
 * `starter-templates/<name>/tests/**` so the whole fork runs a single
 * vitest invocation — no per-template runner is wired). Assertions cover the
 * load-bearing surface a consumer first encounters: README presence, the
 * canonical `@taucad/opencascade.js` dep, the `ocjs-<name>` package name,
 * the optional CI-gated lockfile, and the canonical memoized-Promise
 * singleton in `src/ocjs-init.ts`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEMPLATE_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_NAME = 'node-step-export';
const EXPECTED_PACKAGE_NAME = 'ocjs-node-step-export';
const INIT_PATH = path.join(TEMPLATE_ROOT, 'src', 'ocjs-init.ts');

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readPackageJson = (): PackageJson => {
  const raw = fs.readFileSync(path.join(TEMPLATE_ROOT, 'package.json'), 'utf8');
  return JSON.parse(raw) as PackageJson;
};

describe(`starter-templates/${TEMPLATE_NAME} shape`, () => {
  it('ships a top-level README.md', () => {
    expect(fs.existsSync(path.join(TEMPLATE_ROOT, 'README.md'))).toBe(true);
  });

  it('package.json declares the canonical ocjs- name', () => {
    const pkg = readPackageJson();
    expect(pkg.name).toBe(EXPECTED_PACKAGE_NAME);
  });

  it('package.json depends on the scoped @taucad/opencascade.js, not the unscoped opencascade.js', () => {
    const pkg = readPackageJson();
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(
      Object.prototype.hasOwnProperty.call(deps, '@taucad/opencascade.js'),
      `package.json must list "@taucad/opencascade.js" as a dependency. Got keys: ${Object.keys(deps).join(', ')}`,
    ).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(deps, 'opencascade.js'),
      'package.json must NOT list the unscoped "opencascade.js" — v3 uses the scoped fork @taucad/opencascade.js.',
    ).toBe(false);
  });

  it.skipIf(process.env.CI !== 'true')(
    'commits pnpm-lock.yaml so CI consumers reproduce byte-for-byte',
    () => {
      expect(fs.existsSync(path.join(TEMPLATE_ROOT, 'pnpm-lock.yaml'))).toBe(true);
    },
  );

  describe('src/ocjs-init.ts canonical memoized-Promise singleton', () => {
    const readInit = (): string => fs.readFileSync(INIT_PATH, 'utf8');

    it('exists at the canonical path', () => {
      expect(fs.existsSync(INIT_PATH)).toBe(true);
    });

    it('declares the module-scoped `let cached` slot', () => {
      const src = readInit();
      expect(
        /\blet\s+cached\b/.test(src),
        `src/ocjs-init.ts must declare a module-scoped \`let cached\` slot. Got first 300 chars:\n${src.slice(0, 300)}`,
      ).toBe(true);
    });

    it('gates the init call on `if (cached === null)`', () => {
      const src = readInit();
      expect(
        /if\s*\(\s*cached\s*===\s*null\s*\)/.test(src),
        `src/ocjs-init.ts must gate on \`if (cached === null)\`. Got first 300 chars:\n${src.slice(0, 300)}`,
      ).toBe(true);
    });

    it('invokes init({...}) exactly once', () => {
      const src = readInit();
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const matches = codeOnly.match(/\binit\s*\(\s*\{/g) ?? [];
      expect(
        matches.length,
        `src/ocjs-init.ts must invoke init({...}) exactly once outside comments (got ${matches.length}). Code-only source:\n${codeOnly}`,
      ).toBe(1);
    });
  });
});

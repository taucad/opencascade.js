import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCS_ROOT = resolve(import.meta.dirname, '../content/docs');

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(DOCS_ROOT, relativePath), 'utf8')) as Record<string, unknown>;

describe('root-toggle meta.json', () => {
  it('should list package and toolchain as top-level pages', () => {
    const top = readJson('meta.json');
    expect(top['pages']).toEqual(['package', 'toolchain']);
  });

  it('should mark package and toolchain roots with icons and descriptions', () => {
    for (const root of ['package', 'toolchain'] as const) {
      const meta = readJson(`${root}/meta.json`);
      expect(meta['root']).toBe(true);
      expect(typeof meta['title']).toBe('string');
      expect(typeof meta['description']).toBe('string');
      expect(String(meta['icon'])).toMatch(/^lucide:[a-z-]+ text-[a-z]+$/);
      expect(Array.isArray(meta['pages'])).toBe(true);
      expect((meta['pages'] as unknown[]).length).toBeGreaterThan(0);
    }
  });
});

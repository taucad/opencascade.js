import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OLD_PACKAGE = ['@taucad', 'opencascade.js'].join('/');
const ABANDONED_PACKAGE = 'cascadic';
const ALLOWED_HISTORY = new Set(['CHANGELOG.md']);
const ALLOWED_ABANDONED_PACKAGE_TESTS = new Set([
  'tests/ci/ci-contracts.test.ts',
  'tests/ci/package-identity.test.ts',
]);

const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')) as Record<string, unknown>;

const trackedFilesContaining = (needle: string): string[] => {
  const tracked = spawnSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  expect(tracked.status).toBe(0);
  return tracked.stdout
    .split('\0')
    .filter(Boolean)
    .filter((relative) => fs.existsSync(path.join(ROOT, relative)))
    .filter((relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').includes(needle));
};

describe('npm package identity', () => {
  it('should publish the ocjs project through the libcascade npm coordinate', () => {
    const manifest = readJson('package.json');
    const lock = readJson('package-lock.json');
    const project = readJson('project.json');
    const nx = readJson('nx.json');

    expect(manifest.name).toBe('libcascade');
    expect(lock.name).toBe('libcascade');
    expect((lock.packages as Record<string, { name?: string }>)['']?.name).toBe('libcascade');
    expect(project.name).toBe('ocjs');
    expect(
      (nx.release as { groups: Record<string, { projects: string[] }> }).groups,
    ).toMatchObject({ ocjs: { projects: ['ocjs'] } });

    const pyproject = fs.readFileSync(path.join(ROOT, 'pyproject.toml'), 'utf8');
    expect(pyproject).toContain('name = "ocjs-bindgen"');
    expect(fs.existsSync(path.join(ROOT, 'src', 'ocjs_bindgen'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'src', 'libcascade_bindgen'))).toBe(false);
  });

  it('should keep the previous scoped package only in historical changelog evidence', () => {
    const matches = trackedFilesContaining(OLD_PACKAGE);
    expect(matches.length).toBeGreaterThan(0);
    expect(new Set(matches)).toEqual(ALLOWED_HISTORY);
  });

  it('should keep the abandoned package only in explicit negative tests', () => {
    expect(new Set(trackedFilesContaining(ABANDONED_PACKAGE)))
      .toEqual(ALLOWED_ABANDONED_PACKAGE_TESTS);
  });
});

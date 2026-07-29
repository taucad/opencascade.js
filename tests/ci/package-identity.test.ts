import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OLD_PACKAGE = ['@taucad', 'opencascade.js'].join('/');
const ALLOWED_HISTORY = new Set(['CHANGELOG.md']);

const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')) as Record<string, unknown>;

describe('npm package identity', () => {
  it('should publish the ocjs project through the cascadic npm coordinate', () => {
    const manifest = readJson('package.json');
    const lock = readJson('package-lock.json');
    const project = readJson('project.json');
    const nx = readJson('nx.json');

    expect(manifest.name).toBe('cascadic');
    expect(lock.name).toBe('cascadic');
    expect((lock.packages as Record<string, { name?: string }>)['']?.name).toBe('cascadic');
    expect(project.name).toBe('ocjs');
    expect(
      (nx.release as { groups: Record<string, { projects: string[] }> }).groups,
    ).toMatchObject({ ocjs: { projects: ['ocjs'] } });

    const pyproject = fs.readFileSync(path.join(ROOT, 'pyproject.toml'), 'utf8');
    expect(pyproject).toContain('name = "ocjs-bindgen"');
    expect(fs.existsSync(path.join(ROOT, 'src', 'ocjs_bindgen'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'src', 'cascadic_bindgen'))).toBe(false);
  });

  it('should keep the previous scoped package only in historical changelog evidence', () => {
    const tracked = spawnSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(tracked.status).toBe(0);
    const matches = tracked.stdout
      .split('\0')
      .filter(Boolean)
      .filter((relative) => fs.existsSync(path.join(ROOT, relative)))
      .filter((relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').includes(OLD_PACKAGE));
    expect(matches.length).toBeGreaterThan(0);
    expect(new Set(matches)).toEqual(ALLOWED_HISTORY);
  });
});

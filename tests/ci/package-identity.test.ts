import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OLD_PACKAGE = ['@taucad', 'opencascade.js'].join('/');
const ALLOWED = new Set(['BREAKING_CHANGES.md', 'CHANGELOG.md', 'README.md']);

describe('npm package identity', () => {
  it('should keep the old package name only in the migration guide', () => {
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
    expect(new Set(matches)).toEqual(ALLOWED);
  });
});

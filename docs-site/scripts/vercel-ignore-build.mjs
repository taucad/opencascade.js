#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEVANT_PATHS = [
  'docs-site',
  'Dockerfile',
  'package.json',
  'package-lock.json',
  'project.json',
  'scripts/generate-docs.mjs',
  'scripts/lib/dts-parser.mjs',
  'scripts/lib/source-date-epoch.mjs',
];

export const shouldBuild = ({ before, after, cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..') }) => {
  if (!before || !after) return true;
  const result = spawnSync('git', ['-C', cwd, 'diff', '--quiet', before, after, '--', ...RELEVANT_PATHS]);
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(result.stderr?.toString() || `git diff exited ${result.status}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(shouldBuild({
      before: process.env.VERCEL_GIT_PREVIOUS_SHA,
      after: process.env.VERCEL_GIT_COMMIT_SHA,
    }) ? 1 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

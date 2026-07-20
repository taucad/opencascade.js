#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

export const DIST_FILES = [
  'opencascade_full.build-manifest.json',
  'opencascade_full.d.ts',
  'opencascade_full.js',
  'opencascade_full.js.symbols',
  'opencascade_full.provenance.json',
  'opencascade_full.wasm',
  'opencascade_full_multi.build-manifest.json',
  'opencascade_full_multi.d.ts',
  'opencascade_full_multi.js',
  'opencascade_full_multi.js.symbols',
  'opencascade_full_multi.provenance.json',
  'opencascade_full_multi.wasm',
].sort();

export const PACKAGE_FILES = [
  'BREAKING_CHANGES.md',
  'CHANGELOG.md',
  'LICENSE',
  'LICENSE.OCCT-Exception',
  'README.md',
  'package.json',
  ...DIST_FILES.map((file) => `dist/${file}`),
].sort();

export const validateExactFiles = (actual, expected, label) => {
  const normalized = actual.map((file) => file.replaceAll(path.sep, '/')).sort();
  const missing = expected.filter((file) => !normalized.includes(file));
  const extra = normalized.filter((file) => !expected.includes(file));
  if (missing.length || extra.length) {
    throw new Error(`${label} mismatch; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`);
  }
};

export const validateDist = (directory) => {
  const files = fs.readdirSync(directory).sort();
  validateExactFiles(files, DIST_FILES, 'dist');
  for (const file of DIST_FILES) {
    if (fs.statSync(path.join(directory, file)).size === 0) throw new Error(`empty dist file: ${file}`);
  }
};

export const validateProvenance = (directory, fullSha) => {
  for (const name of ['opencascade_full.provenance.json', 'opencascade_full_multi.provenance.json']) {
    const provenance = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (provenance.source?.opencascadejsCommit !== fullSha) {
      throw new Error(`${name} source SHA does not match ${fullSha}`);
    }
  }
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const packJson = process.argv.indexOf('--pack-json');
    if (packJson !== -1) {
      const packed = JSON.parse(fs.readFileSync(process.argv[packJson + 1], 'utf8'));
      validateExactFiles(packed[0].files.map(({ path: file }) => file), PACKAGE_FILES, 'npm tarball');
      console.log('npm tarball contains exactly 18 files');
      process.exit(0);
    }
    const directory = path.resolve(process.argv[2] ?? 'dist');
    validateDist(directory);
    if (process.env.OCJS_EXPECTED_SHA) validateProvenance(directory, process.env.OCJS_EXPECTED_SHA);
    console.log('candidate dist contains exactly 12 non-empty files');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

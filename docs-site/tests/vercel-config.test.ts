import { describe, expect, it } from 'vitest';
import config from '../vercel.json';
import { RELEVANT_PATHS } from '../scripts/vercel-ignore-build.mjs';

describe('Vercel build selection', () => {
  it('uses the tested ignore-build script and watches every docs input', () => {
    expect(config.ignoreCommand).toBe('node scripts/vercel-ignore-build.mjs');
    expect(RELEVANT_PATHS).toEqual(expect.arrayContaining([
      'docs-site',
      'Dockerfile',
      'scripts/generate-docs.mjs',
      'scripts/lib/dts-parser.mjs',
    ]));
  });
});

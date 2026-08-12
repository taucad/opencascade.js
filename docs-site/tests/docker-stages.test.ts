import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

const DOCKERFILE = resolve(import.meta.dirname, '../../Dockerfile');

const REQUIRED_STAGES: ReadonlyArray<{
  readonly target: string;
  readonly label: string;
}> = [
  { target: 'bindgen-base', label: 'libcascade (bindgen-base)' },
  { target: 'final-single', label: 'libcascade (single-threaded)' },
  { target: 'final-multi', label: 'libcascade (multi-threaded)' },
];

describe('Dockerfile multi-stage layout', () => {
  it('should declare every stage required by `docker buildx --target` invocations', async () => {
    const dockerfile = await fs.readFile(DOCKERFILE, 'utf8');
    for (const { target } of REQUIRED_STAGES) {
      const pattern = new RegExp(`^FROM\\s+[^\\s]+\\s+AS\\s+${target}\\b`, 'm');
      expect(pattern.test(dockerfile), `missing stage target ${target}`).toBe(true);
    }
  });

  it('should label each stage with the expected org.opencontainers.image.title value', async () => {
    const dockerfile = await fs.readFile(DOCKERFILE, 'utf8');
    for (const { label } of REQUIRED_STAGES) {
      const expected = `org.opencontainers.image.title="${label}"`;
      expect(dockerfile.includes(expected), `missing label for "${label}"`).toBe(true);
    }
  });

  it('should share bindgen-content and split compiled single/multi descendants', async () => {
    const dockerfile = await fs.readFile(DOCKERFILE, 'utf8');
    expect(dockerfile).toMatch(/^FROM\s+deps-base\s+AS\s+bindgen-content\b/m);
    expect(dockerfile).toMatch(/^FROM\s+bindgen-content\s+AS\s+bindgen-base\b/m);
    expect(dockerfile).toMatch(/^FROM\s+bindgen-content\s+AS\s+compiled-single-threaded\b/m);
    expect(dockerfile).toMatch(/^FROM\s+bindgen-content\s+AS\s+compiled-multi-threaded\b/m);
    expect(dockerfile).toMatch(/^FROM\s+compiled-single-threaded\s+AS\s+final-single\b/m);
    expect(dockerfile).toMatch(/^FROM\s+compiled-multi-threaded\s+AS\s+final-multi\b/m);
  });

  it('should bake the default FreeType port into deps-base', async () => {
    const dockerfile = await fs.readFile(DOCKERFILE, 'utf8');
    const portBuild = dockerfile.indexOf('RUN embuilder build freetype');
    const bindgenStage = dockerfile.indexOf('FROM deps-base AS bindgen-content');
    expect(portBuild).toBeGreaterThan(-1);
    expect(portBuild).toBeLessThan(bindgenStage);
  });
});

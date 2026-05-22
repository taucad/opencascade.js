import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

const DOCKERFILE = resolve(import.meta.dirname, '../../Dockerfile');

const REQUIRED_STAGES: ReadonlyArray<{
  readonly target: string;
  readonly label: string;
}> = [
  { target: 'deps-base', label: 'opencascade.js (deps-base)' },
  { target: 'bindgen-base', label: 'opencascade.js (bindgen-base)' },
  { target: 'final', label: 'opencascade.js' },
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

  it('should chain stages so bindgen-base extends deps-base and final extends bindgen-base', async () => {
    const dockerfile = await fs.readFile(DOCKERFILE, 'utf8');
    expect(dockerfile).toMatch(/^FROM\s+deps-base\s+AS\s+bindgen-base\b/m);
    expect(dockerfile).toMatch(/^FROM\s+bindgen-base\s+AS\s+final\b/m);
  });
});

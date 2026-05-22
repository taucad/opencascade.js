import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLAYGROUND_PATH = resolve(
  import.meta.dirname,
  '../content/docs/package/playground/index.mdx',
);

describe('playground placeholder (Phase 3 blocked on @taucad/runtime)', () => {
  it('should document the runtime release dependency', () => {
    const body = readFileSync(PLAYGROUND_PATH, 'utf8');
    expect(body).toContain('@taucad/runtime');
    expect(body.toLowerCase()).toContain('blocked');
  });
});

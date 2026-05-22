import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FAQ_PATH = resolve(
  import.meta.dirname,
  '../content/docs/package/getting-started/faq.mdx',
);

describe('faq content', () => {
  it('should answer fork, maintenance, and contribution questions', () => {
    const body = readFileSync(FAQ_PATH, 'utf8');
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.toLowerCase());
    expect(headings.some((h) => h.includes('fork'))).toBe(true);
    expect(headings.some((h) => h.includes('maintain'))).toBe(true);
    expect(headings.some((h) => h.includes('contribute'))).toBe(true);
    expect(body).toContain('merge back upstream');
    expect(body).toContain('donalffons');
  });
});

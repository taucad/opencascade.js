import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const DOCS_DIR = resolve(import.meta.dirname, '../content/docs');
const EXCLUDED = new Set(['api']);

const collectMdxFiles = async (dir: string, acc: string[] = []): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED.has(entry.name)) continue;
      await collectMdxFiles(full, acc);
    } else if (entry.name.endsWith('.mdx')) {
      acc.push(full);
    }
  }
  return acc;
};

const stripFrontmatter = (body: string): string => body.replace(/^---\n[\s\S]+?\n---\n/, '');

const BANNED: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: /\bpowerful\b/i, label: "marketing word 'powerful'" },
  { pattern: /\bflexible\b/i, label: "marketing word 'flexible'" },
  { pattern: /\beasy[-\s]?to[-\s]?use\b/i, label: "marketing phrase 'easy to use'" },
  { pattern: /\bWelcome to\b/, label: "'Welcome to' opener" },
  { pattern: /\bblazing[-\s]?fast\b/i, label: "superlative 'blazing fast'" },
  { pattern: /\bsimply\b/i, label: "filler 'simply'" },
  { pattern: /\bas you can see\b/i, label: "filler 'as you can see'" },
];

describe('anti-slop prose lint', () => {
  it('should not use any banned marketing phrases in MDX body text', async () => {
    const files = await collectMdxFiles(DOCS_DIR);
    const hits: string[] = [];
    for (const file of files) {
      const body = stripFrontmatter(await fs.readFile(file, 'utf8'));
      for (const { pattern, label } of BANNED) {
        if (pattern.test(body)) hits.push(`${file}: ${label}`);
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

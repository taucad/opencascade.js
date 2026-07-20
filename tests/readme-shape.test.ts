/**
 * Fork-internal shape guards for README.md and MAINTAINER.md.
 *
 * The README is the persona-routed top page for consumers. Its three load-
 * bearing properties — a bounded length, the Choose-Your-Path matrix, and a
 * working pointer at MAINTAINER.md — must not drift accidentally.
 *
 * These assertions are fork-internal: they say nothing about external repos.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const MAINTAINER_PATH = path.join(REPO_ROOT, 'MAINTAINER.md');

const README_LINE_BUDGET = 200;

const MAINTAINER_REQUIRED_SECTIONS = [
  '## Quick Start (Native Build)',
  '## Build Configuration',
  '### YAML Configs',
  '### Configurations',
  '### Environment Variables',
  '## Customizing Your Build',
  '## Build Commands',
] as const;

const README_REQUIRED_SECTIONS = [
  '## Choose Your Path',
  '## Quickstart (npm)',
  '## Quickstart (Docker)',
  '## Tags',
  "## What's New in v3",
  '## Documentation',
  '## Projects Using opencascade.js',
  '## License',
] as const;

describe('README.md shape', () => {
  it('exists', () => {
    expect(fs.existsSync(README_PATH)).toBe(true);
  });

  it(`is at most ${README_LINE_BUDGET} lines (persona-routed top page)`, () => {
    const lineCount = fs.readFileSync(README_PATH, 'utf-8').split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(README_LINE_BUDGET);
  });

  it('contains the Choose-Your-Path persona matrix at the top', () => {
    const body = fs.readFileSync(README_PATH, 'utf-8');
    const personaIdx = body.indexOf('## Choose Your Path');
    expect(personaIdx).toBeGreaterThanOrEqual(0);

    const firstH2Match = body.match(/^## .+$/m);
    expect(firstH2Match).not.toBeNull();
    expect(firstH2Match![0]).toBe('## Choose Your Path');
  });

  it.each(README_REQUIRED_SECTIONS)('contains the %s section', (heading) => {
    const body = fs.readFileSync(README_PATH, 'utf-8');
    expect(body).toContain(heading);
  });

  it('links to MAINTAINER.md', () => {
    const body = fs.readFileSync(README_PATH, 'utf-8');
    expect(body).toMatch(/\(MAINTAINER\.md(#[\w-]+)?\)/);
  });
});

describe('MAINTAINER.md shape', () => {
  it('exists', () => {
    expect(fs.existsSync(MAINTAINER_PATH)).toBe(true);
  });

  it.each(MAINTAINER_REQUIRED_SECTIONS)(
    'contains the %s section migrated from the legacy README',
    (heading) => {
      const body = fs.readFileSync(MAINTAINER_PATH, 'utf-8');
      expect(body).toContain(heading);
    },
  );
});

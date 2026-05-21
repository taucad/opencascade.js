/**
 * Fork-internal dead-code sweep.
 *
 * Asserts that legacy surfaces decommissioned during the OCJS Production DX
 * rollout no longer leak into the live fork:
 *
 * - The Docusaurus tree under `repos/opencascade.js/website/` is decommissioned;
 *   nothing outside `website/` itself may reference its files.
 * - The v3 starter templates use the canonical OCCT API names (`_1`, `_3`, …),
 *   never the legacy v2-beta-suffixed names (`Perform_2`, `Handle_TDocStd_Document_2`,
 *   `BRepMesh_IncrementalMesh_2`).
 * - The v3 starter `package.json` files depend on the scoped
 *   `@taucad/opencascade.js` package, never the unscoped `opencascade.js@beta`.
 * - The cross-repo research-doc breadcrumb (the `<docs>/<research>/` substring
 *   the fork hygiene CI guard blocks in `.github/workflows/general.yml`) does
 *   not leak into the fork during local development either.
 *
 * `docs-site/data/` is tolerated because the R-side worker generates JSON
 * datasets there that intentionally mention the forbidden patterns as
 * historical artefacts.
 *
 * Heavy build outputs and dependency trees are excluded so a CI run that
 * happens to ship a populated `build/`, `dist/`, or `node_modules/` directory
 * does not produce false positives.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..');

const EXCLUDE_GLOBS = [
  '!node_modules/**',
  '!build/**',
  '!deps/**',
  '!cache/**',
  '!.nx/**',
  '!dist/**',
  '!docs-site/data/**',
];

interface RgResult {
  matchedFiles: string[];
}

const runRg = (pattern: string, extraGlobs: string[] = []): RgResult => {
  const args = [
    '--files-with-matches',
    '--hidden',
    '--no-messages',
    pattern,
  ];
  for (const glob of [...EXCLUDE_GLOBS, ...extraGlobs]) {
    args.push('--glob', glob);
  }
  args.push(REPO_ROOT);
  let raw = '';
  try {
    raw = execFileSync('rg', args, { encoding: 'utf8' });
  } catch (err) {
    const exec = err as { status?: number; stdout?: string };
    // ripgrep exits 1 when there are no matches; that's a success for us.
    if (exec.status === 1) {
      raw = exec.stdout ?? '';
    } else {
      throw err;
    }
  }
  const matchedFiles = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((abs) => path.relative(REPO_ROOT, abs));
  return { matchedFiles };
};

// Construct the cross-repo breadcrumb pattern via concatenation so this test
// source itself doesn't trip the same regex the fork hygiene CI guard scans
// for. The runtime value is identical to the literal substring.
const CROSS_REPO_BREADCRUMB = 'docs/' + 'research/';

// This test file unavoidably embeds the literal forbidden patterns (the
// decommissioned `website/` path) as the search targets for ripgrep.
// Exclude the test file itself from each result set so the regression guard
// does not self-trigger.
const SELF_TEST_REL_PATH = 'tests/dead-code-sweep.test.ts';

describe('dead-code sweep', () => {
  it('the decommissioned website/ Docusaurus tree is not referenced from outside website/ itself', () => {
    const { matchedFiles } = runRg('repos/opencascade.js/website/');
    const offenders = matchedFiles.filter(
      (file) => !file.startsWith('website/') && file !== SELF_TEST_REL_PATH,
    );
    expect(
      offenders,
      `Decommissioned website/ tree referenced from outside website/:\n  ${offenders.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('starter-templates/v3 contains no legacy v2-suffixed OCCT identifiers (Perform_2, Handle_TDocStd_Document_2, BRepMesh_IncrementalMesh_2)', () => {
    const offenders: string[] = [];
    for (const symbol of [
      'Perform_2',
      'Handle_TDocStd_Document_2',
      'BRepMesh_IncrementalMesh_2',
    ]) {
      const { matchedFiles } = runRg(`\\b${symbol}\\b`, ['starter-templates/v3/**']);
      const inV3 = matchedFiles.filter((file) => file.startsWith('starter-templates/v3/'));
      for (const file of inV3) {
        offenders.push(`${file} contains legacy ${symbol}`);
      }
    }
    expect(
      offenders,
      `Legacy v2-suffixed OCCT identifiers leaked into v3 templates:\n  ${offenders.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('starter-templates/v3 package.json files depend on @taucad/opencascade.js, never the unscoped "opencascade.js@beta"', () => {
    const { matchedFiles } = runRg(`"opencascade\\.js"\\s*:\\s*"beta"`, [
      'starter-templates/v3/**/package.json',
    ]);
    const offenders = matchedFiles.filter(
      (file) =>
        file.startsWith('starter-templates/v3/') && file.endsWith('package.json'),
    );
    expect(
      offenders,
      `v3 starter package.json files declare the unscoped "opencascade.js":"beta" dep:\n  ${offenders.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('the cross-repo research-doc breadcrumb is absent from the fork (matches the fork hygiene CI guard locally)', () => {
    const { matchedFiles } = runRg(CROSS_REPO_BREADCRUMB);
    // Two intentional carve-outs:
    // - This test file itself constructs the pattern at runtime via string
    //   concatenation so its source never embeds the literal substring; it
    //   should never appear in the rg result.
    // - `.github/workflows/general.yml` deliberately embeds the breadcrumb as
    //   the rg search pattern that powers the fork hygiene CI guard. Its
    //   presence there is load-bearing, not a leak.
    const offenders = matchedFiles.filter(
      (file) =>
        !file.endsWith('tests/dead-code-sweep.test.ts') &&
        file !== '.github/workflows/general.yml',
    );
    expect(
      offenders,
      `Cross-repo research-doc breadcrumb leaked into the fork:\n  ${offenders.join('\n  ')}`,
    ).toHaveLength(0);
  });
});

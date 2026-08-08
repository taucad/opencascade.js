/**
 * The W2 acceptance gate: four wrong configs must be **compile** errors, and a
 * correct one must be clean.
 *
 * Mechanism — a tsc runner rather than inline `@ts-expect-error`. `@ts-expect-error`
 * only proves "an error happens somewhere on the next line"; it cannot assert
 * *which* diagnostic, and it suppresses the error so nothing can read it back.
 * Running tsc over the fixture project instead lets each fixture assert its own
 * diagnostic code on its own line, and — the part that cannot rot silently — the
 * positive fixture asserts **zero** diagnostics from the same invocation. A
 * harness that stopped type-checking would fail every negative case; a harness
 * that started reporting spurious errors would fail the positive case.
 *
 * Expected error lines are not hardcoded: each fixture marks its offending line
 * with a `// EXPECT-ERROR` comment on the line above.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, 'fixtures');
const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');

type Diagnostic = { readonly file: string; readonly line: number; readonly code: string };

/** `path/to/file.ts(12,7): error TS2322: …` */
const DIAGNOSTIC = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;

const typecheckFixtures = (): { diagnostics: Diagnostic[]; raw: string } => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(PACKAGE_ROOT, '../../node_modules/typescript/lib/tsc.js'),
      '--project',
      path.join(FIXTURES_DIRECTORY, 'tsconfig.json'),
      '--pretty',
      'false',
    ],
    { encoding: 'utf8', cwd: PACKAGE_ROOT },
  );
  const raw = `${result.stdout}${result.stderr}`;
  const diagnostics = raw
    .split('\n')
    .map((line) => DIAGNOSTIC.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => ({
      file: path.resolve(PACKAGE_ROOT, match[1]!),
      line: Number(match[2]),
      code: match[3]!,
    }));
  return { diagnostics, raw };
};

/** Line number (1-based) the fixture's `// EXPECT-ERROR` marker points at. */
const expectedErrorLine = (fixture: string): number => {
  const lines = fs.readFileSync(fixture, 'utf8').split('\n');
  const marker = lines.findIndex((line) => line.includes('// EXPECT-ERROR'));
  if (marker === -1) throw new Error(`${fixture} carries no // EXPECT-ERROR marker.`);
  return marker + 2;
};

const { diagnostics, raw } = typecheckFixtures();
const errorsIn = (fixture: string): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.file === fixture);

describe('compile-failure fixtures', () => {
  const negatives = fs
    .readdirSync(path.join(FIXTURES_DIRECTORY, 'negative'))
    .filter((entry) => entry.endsWith('.ts'))
    .sort();

  it('covers every documented wrong-config case', () => {
    expect(negatives).toStrictEqual([
      'assemble-exports.ts',
      'bad-memory-grammar.ts',
      'string-for-array.ts',
      'typo-symbol-with-custom-bindings.ts',
      'typo-symbol.ts',
      'unknown-setting.ts',
    ]);
  });

  it.each(negatives)('%s fails to compile on its marked line', (fixture) => {
    const resolved = path.join(FIXTURES_DIRECTORY, 'negative', fixture);
    const onMarkedLine = errorsIn(resolved).filter(
      (diagnostic) => diagnostic.line === expectedErrorLine(resolved),
    );
    expect(onMarkedLine.length, `no diagnostic on the marked line.\ntsc said:\n${raw}`).toBeGreaterThan(0);
  });

  it('reports the typo as an unassignable literal with a suggestion', () => {
    // TS2820 is "not assignable … Did you mean 'X'?" — the union is what makes
    // the compiler able to suggest the right symbol.
    expect(
      errorsIn(path.join(FIXTURES_DIRECTORY, 'negative/typo-symbol.ts')).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain('TS2820');
  });

  it('reports an unknown -s setting as an unknown property', () => {
    expect(
      errorsIn(path.join(FIXTURES_DIRECTORY, 'negative/unknown-setting.ts')).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain('TS2561');
  });

  it('reports the removed assemble mode as an unknown property', () => {
    expect(
      errorsIn(path.join(FIXTURES_DIRECTORY, 'negative/assemble-exports.ts')).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toContain('TS2353');
  });

  it('compiles the correct config with no diagnostics at all', () => {
    expect(errorsIn(path.join(FIXTURES_DIRECTORY, 'positive/valid.config.ts'))).toStrictEqual([]);
  });
});

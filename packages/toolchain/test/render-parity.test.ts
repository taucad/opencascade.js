/**
 * Renderer parity: the two real `libcascade.config.ts` files must render ymls
 * that are semantically identical to the hand-maintained / ytt-generated ones
 * they replace.
 *
 * Deviation from strict sequence equality — `emccFlags`:
 *   The reference ymls interleave typed and raw flags in hand-chosen positions
 *   (`--no-entry` sits between two `-s` settings; libcascade's
 *   `-Wl,--allow-undefined` and `--emit-symbol-map` sit between
 *   `ERROR_ON_UNDEFINED_SYMBOLS` and `STACK_SIZE`). The blueprint fixes
 *   `rawFlags` as "passed through verbatim AFTER typed flags", so no canonical
 *   render order can reproduce both files positionally. emcc treats distinct
 *   flags as order-insensitive, so parity is asserted as a **multiset** for
 *   `emccFlags` and as an exact **sequence** for everything else (bindings,
 *   additionalBindFiles, additionalCppFiles). The exact rendered sequence is
 *   separately pinned by `config.test.ts`.
 *
 * Deviation — the pthread spelling (replicad's multi variant only):
 *   The reference ymls request pthreads twice, as `-pthread` *and* as
 *   `-sUSE_PTHREADS=1`. emcc documents the latter purely as a legacy alias of
 *   the former (`tools/settings.py` LEGACY_SETTINGS, which is why the generated
 *   type carries it `@deprecated`), so the pair is one request written two ways.
 *   C1 moved replicad's config to the typed `compilerFlags: { threads: true }`,
 *   which renders the flag and drops the alias; parity for that variant is
 *   therefore asserted modulo removing the alias from the reference. libcascade's
 *   config is untouched and its references are compared with no such rewrite.
 *
 * Deviation — bare `-sNAME`:
 *   The references write `-sMODULARIZE` / `-sWASM_BIGINT` /
 *   `-sEXPORT_EXCEPTION_HANDLING_HELPERS` with no value; the typed `settings`
 *   surface renders booleans as `=1`/`=0`. emcc defines bare `-sNAME` as
 *   `-sNAME=1`, so the comparison normalises bare settings before matching.
 *
 * The three rewrites live in `./reference-deltas.ts` because `migrate.test.ts`
 * asserts its round-trip modulo exactly the same ones.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import type { BuildConfig, BuildVariant } from '../src/config/index.ts';
import { renderBuild } from '../src/config/render.ts';
import {
  applyEmsdk605ExceptionDelta,
  dropDeprecatedUsePthreads,
  flagMultiset,
} from './reference-deltas.ts';

import libcascadeConfig from '../../../libcascade.config.ts';
import replicadConfig from '../../../../replicad/packages/replicad-opencascadejs/libcascade.config.ts';

const OCJS_ROOT = path.resolve(import.meta.dirname, '../../..');
const REPLICAD_ROOT = path.resolve(
  import.meta.dirname,
  '../../../../replicad/packages/replicad-opencascadejs',
);

/**
 * Wave W4 deleted replicad's ytt sources and the `build-config/custom_build_*.yml`
 * they generated. The last generated copies are committed here verbatim so the
 * parity assertions keep proving the renderer reproduces the machinery it
 * replaced — they are frozen references, not live build inputs.
 */
const REPLICAD_REFERENCE_DIRECTORY = path.join(import.meta.dirname, 'fixtures/reference/replicad');

type ReferenceYaml = {
  mainBuild: {
    name: string;
    bindings: { symbol: string }[];
    emccFlags: string[];
    additionalBindFiles?: string[];
  };
  additionalCppFiles?: string[];
  generateTypescriptDefinitions?: boolean;
};

const assertParity = (
  config: BuildConfig,
  variant: BuildVariant,
  configDirectory: string,
  referencePath: string,
  options: {
    readonly referenceFlagRewrite?: (flags: readonly string[]) => string[];
    /**
     * Directory the reference yml was written for, when it no longer lives
     * there. Relative `additionalBindFiles` paths are rendered from it.
     * @defaultValue the reference file's own directory
     */
    readonly outputDirectory?: string;
  } = {},
): void => {
  const reference = parse(fs.readFileSync(referencePath, 'utf8')) as ReferenceYaml;
  if (options.referenceFlagRewrite) {
    reference.mainBuild.emccFlags = options.referenceFlagRewrite(reference.mainBuild.emccFlags);
  }
  const rendered = renderBuild({
    config,
    variant,
    configDirectory,
    outputDirectory: options.outputDirectory ?? path.dirname(referencePath),
  });
  const actual = parse(rendered.contents) as ReferenceYaml;

  expect(actual.mainBuild.name).toBe(reference.mainBuild.name);
  expect(actual.mainBuild.bindings).toStrictEqual(reference.mainBuild.bindings);
  expect(actual.mainBuild.additionalBindFiles ?? []).toStrictEqual(
    reference.mainBuild.additionalBindFiles ?? [],
  );
  expect(actual.additionalCppFiles ?? []).toStrictEqual(reference.additionalCppFiles ?? []);
  expect(actual.generateTypescriptDefinitions ?? true).toBe(
    reference.generateTypescriptDefinitions ?? true,
  );
  expect(flagMultiset(actual.mainBuild.emccFlags)).toStrictEqual(
    flagMultiset(reference.mainBuild.emccFlags),
  );
};

const variantNamed = (config: BuildConfig, name: string): BuildVariant => {
  const variant = config.variants.find((candidate) => candidate.name === name);
  if (variant === undefined) throw new Error(`no variant "${name}"`);
  return variant;
};

describe('libcascade.config.ts', () => {
  it('renders build-configs/full.yml', () => {
    assertParity(
      libcascadeConfig,
      variantNamed(libcascadeConfig, 'single'),
      OCJS_ROOT,
      path.join(OCJS_ROOT, 'build-configs/full.yml'),
    );
  });

  it('renders build-configs/full_multi.yml', () => {
    assertParity(
      libcascadeConfig,
      variantNamed(libcascadeConfig, 'multi'),
      OCJS_ROOT,
      path.join(OCJS_ROOT, 'build-configs/full_multi.yml'),
    );
  });

  it('names both variants by the `<name>_<variant>` convention', () => {
    const rendered = renderBuild({
      config: libcascadeConfig,
      variant: variantNamed(libcascadeConfig, 'single'),
      configDirectory: OCJS_ROOT,
      outputDirectory: path.join(OCJS_ROOT, '.libcascade'),
    });
    expect(rendered.fileName).toBe('opencascade_single.yml');
    expect(rendered.outputName).toBe('opencascade_single');
  });

  it('rewrites cpp paths relative to the yml directory', () => {
    const rendered = renderBuild({
      config: libcascadeConfig,
      variant: variantNamed(libcascadeConfig, 'single'),
      configDirectory: OCJS_ROOT,
      outputDirectory: path.join(OCJS_ROOT, '.libcascade'),
    });
    const document = parse(rendered.contents) as ReferenceYaml;
    expect(document.mainBuild.additionalBindFiles).toStrictEqual([
      '../build-configs/full-bindings.cpp',
    ]);
  });
});

describe('replicad libcascade.config.ts', () => {
  const assertReplicadParity = (variant: string, referenceName: string): void => {
    assertParity(
      replicadConfig,
      variantNamed(replicadConfig, variant),
      REPLICAD_ROOT,
      path.join(REPLICAD_REFERENCE_DIRECTORY, referenceName),
      {
        referenceFlagRewrite: (flags) =>
          dropDeprecatedUsePthreads(applyEmsdk605ExceptionDelta(flags)),
        outputDirectory: path.join(REPLICAD_ROOT, 'build-config'),
      },
    );
  };

  it('renders the retired custom_build_single.yml (modulo the documented deltas)', () => {
    assertReplicadParity('single', 'custom_build_single.yml');
  });

  it('renders the retired custom_build_multi.yml (modulo the documented deltas)', () => {
    assertReplicadParity('multi', 'custom_build_multi.yml');
  });

  it('declares every custom symbol that appears in bindings', () => {
    const declared = new Set(
      (replicadConfig.customBindings ?? []).flatMap((customBinding) => customBinding.symbols),
    );
    const bound = new Set(replicadConfig.bindings);
    expect([...declared].filter((symbol) => !bound.has(symbol))).toStrictEqual([]);
    // The 18 `Replicad*` / `*Wrapper` classes the 11
    // wrapper files bind (the blueprint's "17" undercounted by one).
    expect(declared.size).toBe(18);
  });
});

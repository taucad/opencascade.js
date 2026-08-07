/**
 * `defineBuild` — the typed configuration surface for custom libcascade WASM builds.
 *
 * The config is an identity-typed description of one binding set rendered into N
 * container-side yml files (one per variant). See
 * `docs/research/libcascade-toolchain-npm-distribution.md` (wave W1).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// The generated layer. Both specifiers are `.js` on purpose: NodeNext resolves
// them to the sibling `.d.ts` without the importer needing
// `allowImportingTsExtensions`, which a consumer's tsconfig will not have.
import type { EmccSettings, VariantEmccSettings } from '../../generated/emcc-settings.js';
import type { OcctSymbol } from '../../generated/occt-symbols.js';

export type {
  EmccEnvironment,
  EmccSettings,
  MemorySize,
  VariantEmccSettings,
} from '../../generated/emcc-settings.js';
export type { OcctSymbol } from '../../generated/occt-symbols.js';

/**
 * A single emcc `-s` setting value, as the renderer sees it.
 *
 * The *typed* surface is the generated {@link EmccSettings} (one field per
 * setting, with that setting's own value grammar); this is the erased union the
 * serializer switches on once the field name has been forgotten. Consequence:
 * it is the type you need when writing code *over* a config — walking
 * `mergeSettings()` output, for instance — and never the type you write in one.
 */
export type EmccSettingValue = boolean | number | string | readonly string[];

/**
 * Non-`-s` compiler and linker flags, as a curated closed set.
 *
 * These are **clang driver** flags. emcc forwards them to clang and its own
 * argument parser (`tools/cmdline.py`) never sees them, so — unlike
 * {@link EmccSettings}, which is generated 1:1 from the image's emsdk
 * `settings.js` — this set cannot be generated from anything the toolchain
 * image ships. The only complete source would be LLVM's `Options.td`: thousands
 * of entries, almost none wasm-relevant, and a fresh upstream-parsing liability
 * on every emsdk bump.
 *
 * So the set is curated — but deliberately **not frozen**. It models the flags
 * the reference builds actually use; when a real config needs another one, add
 * a member here *and* its case in `renderEmccFlags`, rather than leaving it in
 * {@link BuildConfig.rawFlags} forever. Until then `rawFlags` is the supported
 * escape hatch, not a lesser one.
 *
 * Declare these on {@link BuildConfig} to apply them to every variant, and on
 * {@link BuildVariant} to override individual keys for one variant — the two
 * are merged key by key, variant wins.
 *
 * @example
 * ```typescript
 * compilerFlags: { exceptions: 'wasm', noEntry: true, simd: true, optimize: 'O3' }
 * ```
 */
export type CompilerFlags = {
  /**
   * Optimisation level, rendered verbatim (`'O3'` → `-O3`).
   *
   * Both reference builds use `'O3'`; the lower levels exist for bisecting a
   * miscompile, not as a shipping choice.
   *
   * Note that the container yml schema's *default* `emccFlags` includes `-O3`,
   * but the renderer always emits `emccFlags` explicitly and therefore replaces
   * that default wholesale: leaving this unset means no `-O` flag at all, not
   * `-O3`.
   */
  readonly optimize?: 'O0' | 'O1' | 'O2' | 'O3' | 'Os' | 'Oz';
  /**
   * Emit `-msimd128`: allow the WebAssembly SIMD instruction set.
   *
   * The produced wasm then requires a host implementing the SIMD proposal. That
   * is not modelled as a {@link VariantCapability} because no reference build
   * ships a scalar variant to fall back to — the selector can only choose
   * between variants that exist.
   */
  readonly simd?: boolean;
  /**
   * Exception-handling lowering: `'wasm'` → `-fwasm-exceptions` (the native
   * WebAssembly exception proposal), `'emscripten'` → `-fexceptions` (the older
   * JavaScript-based lowering).
   *
   * OCCT throws across the binding boundary, so one of the two is mandatory for
   * a usable build. `'wasm'` carries a link-time obligation: emsdk 6.0.5 hard-
   * fails a `-fwasm-exceptions` link unless `EXPORTED_RUNTIME_METHODS` also
   * lists `getExceptionMessage`, `incrementExceptionRefcount`, and
   * `decrementExceptionRefcount` — the JS side needs them to read a thrown
   * OCCT `Standard_Failure`.
   */
  readonly exceptions?: 'wasm' | 'emscripten';
  /**
   * Emit `-flto`: link-time optimisation across translation units.
   *
   * In the yml schema's default `emccFlags` but, as with {@link optimize},
   * that default is replaced wholesale by the rendered list, and neither
   * reference build opts back in — so an OCCT-scale link with LTO enabled is
   * an untested configuration here. Measure build time and output size before
   * adopting it.
   */
  readonly lto?: boolean;
  /**
   * Emit `--no-entry`: link a library, not an executable.
   *
   * Without it emcc links an executable and expects an entry point. Every
   * libcascade build is a library, so in practice this is always `true`; it is
   * a flag rather than an implicit because the yml is a general emcc link, not
   * a libcascade-only one.
   */
  readonly noEntry?: boolean;
  /**
   * Emit `-pthread`: build against shared memory and atomics.
   *
   * This is the current spelling. emcc's `USE_PTHREADS` setting survives only
   * as a deprecated legacy *alias of this flag*, so setting both says the same
   * thing twice — prefer this and leave the setting out.
   *
   * The consequence reaches past codegen: a `-pthread` wasm imports a
   * `SharedArrayBuffer`-backed memory and therefore cannot instantiate on a
   * host without cross-origin isolation (COOP/COEP). That is why setting this
   * also **infers** `requires: ['threads']` for the variant (see
   * {@link variantCapabilities}), which in turn selects the multi-threaded
   * container image and emits the host capability probe into the generated
   * `./init` entry.
   */
  readonly threads?: boolean;
};

/**
 * A custom C++ file and the symbols it provides.
 *
 * The file is compiled into the build alongside the generated OCCT bindings,
 * and the names it declares in {@link CustomBinding.symbols} become legal
 * entries in {@link BuildConfig.bindings} — that is how a config binds a class
 * the OCCT catalog has never heard of.
 */
export type CustomBinding = {
  /** Path to the `.cpp` file, resolved relative to the config file's directory. */
  readonly file: string;
  /**
   * Symbols this file provides.
   *
   * These are the only names `bindings` may carry that are not in
   * {@link OcctSymbol}: `defineBuild` infers the custom-symbol union from here.
   */
  readonly symbols: readonly string[];
  /**
   * Which container pipeline compiles the file — two genuinely different
   * things, not two spellings of one.
   *
   * `'all'` (the default) renders the file into the yml's top-level
   * `additionalCppFiles`: the **custom-code path**. The file is compiled and
   * linked into the bundle and the discovery scan sees it, but it is *not*
   * parsed as a binding translation unit. Pick this for a self-contained
   * wrapper that registers its own Embind classes and needs nothing from the
   * generated binding TU. replicad's eleven `build-config/wrappers/*.cpp` are
   * all of this kind.
   *
   * `'main'` renders it into `mainBuild.additionalBindFiles`: the container
   * concatenates the file with `BUILTIN_BINDINGS_SOURCE` into **one** binding
   * translation unit, which libclang then parses to extract every Embind
   * registration. Pick this when the file's `class_<…>` registrations must
   * enter the binding registry itself — when they extend, cast between, or
   * otherwise participate in the generated OCCT bindings rather than sitting
   * beside them. libcascade's `build-configs/full-bindings.cpp` is the
   * reference example.
   *
   * When in doubt, `'all'`: it is the weaker coupling, and a file that only
   * needs to be linked never needs to be parsed.
   *
   * @defaultValue 'all'
   */
  readonly scope?: 'main' | 'all';
};

/**
 * A capability a variant's artifacts require from the host at load time.
 *
 * Every member needs a matching probe in `CAPABILITY_PROBES`
 * (`src/assemble/index.ts`); assemble fails loudly rather than emit a variant
 * whose requirement nothing checks.
 */
export type VariantCapability = 'threads';

/**
 * One build of the config: same bindings and custom C++, different flags.
 *
 * Every variant is a separate container run producing its own
 * `<outputName>.{js,wasm,d.ts,…}`; `libcascade assemble` then generates one
 * package surface that picks between them at load time.
 */
export type BuildVariant = {
  /**
   * Variant identifier, e.g. `single` / `multi`. Unique within a config.
   *
   * It names the rendered yml, the default artifact base name, the `--variant`
   * CLI selector, and the generated `./<variant>` export subpaths — so renaming
   * one is a breaking change for the published package.
   */
  readonly name: string;
  /**
   * Overrides the default `<config.name>_<variant.name>` artifact base name.
   *
   * Escape hatch for builds whose published filenames predate the convention
   * and cannot move — `libcascade migrate` emits it when a v2 yml's artifact
   * names do not decompose into `<name>_<variant>`. Prefer the default: the
   * name reaches consumers through `locateFile` calls and hand-written
   * `exports` maps, so it is expensive to change later.
   */
  readonly outputName?: string;
  /**
   * Host capabilities this variant's artifacts need in order to load.
   *
   * Normally you do **not** write this: {@link variantCapabilities} infers it
   * from the variant's own effective build flags, and what it infers is added
   * to whatever is declared here rather than replacing it. Declare it
   * explicitly only for a requirement the flags cannot reveal.
   *
   * What it drives, in three places: the driver picks the multi-threaded
   * container image for a variant requiring `'threads'`; assemble emits one
   * host probe per distinct capability into the generated `./init`, plus the
   * COOP/COEP remediation hint shown when the probe fails; and a config whose
   * variants require nothing at all degenerates — with a single variant,
   * assemble emits no probes and no selector machinery whatsoever.
   */
  readonly requires?: readonly VariantCapability[];
  /**
   * Settings merged over {@link BuildConfig.settings}.
   *
   * A variant value replaces the base value wholesale (settings values have no
   * nested structure, so there is nothing to merge *within* a value). Setting a
   * key to `null` **removes** the inherited base setting — this is how the
   * multi-threaded variant drops the base `EVAL_CTORS`, whose constructor
   * evaluation order is non-deterministic under pthread workers. Unsetting a
   * key the base never declared is a configuration error, caught by
   * {@link validateBuildConfig}, because it always means one of the two spots
   * has drifted.
   *
   * @example
   * ```typescript
   * settings: { EVAL_CTORS: null, PTHREAD_POOL_SIZE: 'navigator.hardwareConcurrency' }
   * ```
   */
  readonly settings?: VariantEmccSettings;
  /**
   * Compiler flags merged over {@link BuildConfig.compilerFlags}, key by key.
   *
   * A shallow merge: each key the variant declares replaces the base value for
   * this variant only, and keys it leaves out keep the base value. There is no
   * `null` unset here (unlike {@link BuildVariant.settings}) — no configuration
   * has yet needed to *remove* an inherited compiler flag, and adding the
   * escape hatch before there is a use for it would only add a state to reason
   * about.
   *
   * @example
   * ```typescript
   * { name: 'multi', compilerFlags: { threads: true } } // renders `-pthread`
   * ```
   */
  readonly compilerFlags?: CompilerFlags;
  /** Verbatim flags for this variant, appended after the base `rawFlags`. */
  readonly rawFlags?: readonly string[];
};

/**
 * How `libcascade assemble` shapes the package's default export (wave W3).
 */
export type AssembleOptions = {
  /**
   * `'factory'` — the package's root re-exports the variant-selecting
   * `createInstance` factory and nothing else. The consumer awaits it and gets
   * the instance; no OCCT symbol is reachable before that. This is the honest
   * shape for a wasm module and what replicad uses.
   *
   * `'eager'` — the root additionally emits a named-export barrel over the
   * shared type surface, so consumers can `import { gp_Pnt } from '…'` and get
   * the binding of whichever variant was initialised. Convenient, at the cost
   * of an import surface that is only populated after init has run. libcascade
   * itself uses this for source compatibility with its pre-toolchain package.
   */
  readonly exports: 'factory' | 'eager';
};

/**
 * One binding set, built N ways.
 *
 * Everything above `variants` describes what to build and is shared by all of
 * them; `variants` describes the per-build deltas. `libcascade build` renders
 * one container-side yml per variant from this object, and `libcascade
 * assemble` turns the resulting artifacts into the published package surface.
 */
export type BuildConfig = {
  /**
   * Artifact base name: variant `single` of `name: 'replicad'` builds
   * `replicad_single.js` / `.wasm` / `.d.ts`, unless the variant overrides it
   * with {@link BuildVariant.outputName}.
   *
   * It is a filename, not a package name — it ends up in the published tarball
   * and in every consumer's `locateFile`.
   */
  readonly name: string;
  /**
   * The OCCT and custom symbols to bind, rendered verbatim into
   * `mainBuild.bindings`.
   *
   * This list *is* the build's cost and its API: the container binds the
   * transitive closure needed to make these usable, and anything absent throws
   * a runtime `BindingError` on first touch rather than failing the link. Use
   * `libcascade detect` / `libcascade check` to keep it in step with the code
   * that consumes it.
   *
   * Typed loosely here because this type is also the *loaded* config the CLI
   * validates at runtime; {@link defineBuild} is where the {@link OcctSymbol}
   * union and the inferred custom-symbol union are enforced.
   */
  readonly bindings: readonly string[];
  /**
   * Custom C++ compiled into the build, and the symbols each file provides.
   *
   * Declaring a file here is what makes its symbols legal in
   * {@link BuildConfig.bindings}. See {@link CustomBinding.scope} for the
   * choice between the two container pipelines.
   */
  readonly customBindings?: readonly CustomBinding[];
  /**
   * emcc `-s` settings applied to every variant.
   *
   * The field names and their value grammars are generated from the pinned
   * image's own `settings.js`, so an unknown name or an ill-formed value is a
   * compile error rather than an emcc warning nobody reads. Variants override
   * individual keys via {@link BuildVariant.settings}.
   */
  readonly settings?: EmccSettings;
  /** Compiler/linker flags applied to every variant; see {@link CompilerFlags}. */
  readonly compilerFlags?: CompilerFlags;
  /**
   * Escape hatch for flags {@link CompilerFlags} does not model.
   *
   * Passed through verbatim and appended **after** every typed flag, base list
   * first and then the variant's own {@link BuildVariant.rawFlags}. That fixed
   * position is the whole contract: a raw flag can always override a typed one
   * (emcc takes the last occurrence of a repeated flag), never the reverse.
   *
   * Reach for it when a flag is genuinely one-off — `--emit-symbol-map`,
   * `-Wl,--allow-undefined`. When a flag turns out to be load-bearing for more
   * than one config, promote it to a {@link CompilerFlags} member instead.
   */
  readonly rawFlags?: readonly string[];
  /**
   * The builds to produce, in declaration order.
   *
   * Order matters downstream: assemble's generated selector prefers the
   * most-demanding loadable variant, and declaration order is the tiebreak.
   */
  readonly variants: readonly BuildVariant[];
  /** How the assembled package exposes the build; see {@link AssembleOptions}. */
  readonly assemble?: AssembleOptions;
  /**
   * Build against a different container image than the pinned one.
   *
   * `$LIBCASCADE_IMAGE` wins over this. Either one skips digest verification
   * and prints a provenance warning: the produced artifacts then carry no
   * reproducible toolchain provenance, so this is a dev-loop tool, not a
   * release setting.
   */
  readonly image?: string;
  /**
   * Set `false` to stop the container emitting the per-variant `.d.ts`.
   *
   * Rendered into the yml only when explicitly `false` (the schema defaults it
   * to `true`), so the rendered file stays diffable against hand-written ones.
   * Note that `libcascade assemble` *parses* those per-variant `.d.ts` to build
   * the package's shared type surface — turning them off turns assemble off
   * with them.
   */
  readonly generateTypescriptDefinitions?: boolean;
};

/**
 * The type-checked shape of a `defineBuild` argument.
 *
 * `bindings` accepts every OCCT symbol the pinned image can bind, plus exactly
 * the symbols this config's own `customBindings` declare. `TCustomSymbol` is
 * inferred **only** from `customBindings[].symbols` — the `NoInfer` on the
 * `bindings` element type is what keeps a typo'd OCCT name from silently
 * widening the custom union and typing itself as valid.
 */
export type StrictBuildConfig<TCustomSymbol extends string> = BuildConfig & {
  readonly bindings: readonly (OcctSymbol | NoInfer<TCustomSymbol>)[];
  readonly customBindings?: readonly (CustomBinding & {
    readonly symbols: readonly TCustomSymbol[];
  })[];
};

/**
 * Identity function that types a libcascade build configuration.
 *
 * Symbol names, `-s` setting names, and setting value grammars are compile
 * errors when wrong; everything a type cannot see (wrapper files existing on
 * disk, duplicate variant names, `null` unsets with no base key) is checked at
 * config-load time by {@link validateBuildConfig}.
 *
 * The wrapping call is not ceremony: it is what supplies the OCCT symbol union
 * to `bindings` and infers this config's own custom-symbol union from
 * `customBindings`. A bare object literal typed as {@link BuildConfig} gets
 * neither.
 *
 * @param config - The build configuration.
 * @returns The same object, typed as {@link BuildConfig}.
 * @example
 * ```typescript
 * import { defineBuild } from '@libcascade/toolchain';
 *
 * export default defineBuild({
 *   name: 'replicad',
 *   bindings: ['gp_Pnt', 'BRepPrimAPI_MakeBox', 'ReplicadMeshData'],
 *   customBindings: [{ file: 'wrappers/mesh.cpp', symbols: ['ReplicadMeshData'] }],
 *   settings: { ALLOW_MEMORY_GROWTH: true, EVAL_CTORS: 2 },
 *   compilerFlags: { optimize: 'O3', simd: true, exceptions: 'wasm', noEntry: true },
 *   variants: [
 *     { name: 'single' },
 *     // `requires: ['threads']` is inferred from `compilerFlags.threads`.
 *     { name: 'multi', compilerFlags: { threads: true }, settings: { EVAL_CTORS: null } },
 *   ],
 * });
 * ```
 */
export const defineBuild = <const TCustomSymbol extends string = never>(
  config: StrictBuildConfig<TCustomSymbol>,
): BuildConfig => config;

/**
 * Validate a loaded config against the invariants the container-side yml schema
 * cannot express.
 *
 * @param config - The configuration returned by {@link defineBuild}.
 * @param configDirectory - Directory the config file lives in; every
 *   {@link CustomBinding.file} is resolved against it.
 * @throws Error listing every problem found, with resolved absolute paths.
 */
export const validateBuildConfig = (config: BuildConfig, configDirectory: string): void => {
  const problems: string[] = [];

  if (config.name.trim() === '') {
    problems.push('`name` is empty. Set it to the artifact base name, e.g. `name: \'replicad\'`.');
  }

  if (config.bindings.length === 0) {
    problems.push(
      '`bindings` is empty. List at least one symbol to bind, e.g. `bindings: [\'gp_Pnt\']`. ' +
        'A build with no bindings produces a WASM module with no exported OCCT classes.',
    );
  }

  if (config.variants.length === 0) {
    problems.push(
      '`variants` is empty. Declare at least one, e.g. `variants: [{ name: \'single\' }]`.',
    );
  }

  const seenVariants = new Set<string>();
  for (const variant of config.variants) {
    if (seenVariants.has(variant.name)) {
      problems.push(
        `Duplicate variant name "${variant.name}". Variant names must be unique — they name the ` +
          'rendered yml, the artifact base name, and the `--variant` CLI selector.',
      );
    }
    seenVariants.add(variant.name);

    for (const [setting, value] of Object.entries<unknown>(variant.settings ?? {})) {
      if (value === null && !(setting in (config.settings ?? {}))) {
        problems.push(
          `Variant "${variant.name}" unsets \`settings.${setting}\` with \`null\`, but the base ` +
            '`settings` never declares it. Remove the `null`, or add the setting to the base ' +
            '`settings` so the other variants inherit it.',
        );
      }
    }
  }

  for (const customBinding of config.customBindings ?? []) {
    const resolved = path.resolve(configDirectory, customBinding.file);
    if (!fs.existsSync(resolved)) {
      problems.push(
        `customBindings file not found: ${resolved} (declared as "${customBinding.file}"). ` +
          'Paths are resolved relative to the config file\'s directory.',
      );
    }
    if (customBinding.symbols.length === 0) {
      problems.push(
        `customBindings entry "${customBinding.file}" declares no symbols. List the symbols the ` +
          'file binds so they can be validated against the OCCT catalog.',
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid libcascade build config (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
  }
};

/** Resolved artifact base name for a variant (without the `.js` extension). */
export const variantOutputName = (config: BuildConfig, variant: BuildVariant): string =>
  variant.outputName ?? `${config.name}_${variant.name}`;

/**
 * Merge a variant's compiler flags over the base ones.
 *
 * A shallow, key-by-key merge: a key the variant declares wins for that
 * variant, a key it omits keeps the base value. A key present but `undefined`
 * counts as omitted — there is no `null`-style unset here, deliberately (see
 * {@link BuildVariant.compilerFlags}).
 *
 * @param config - The build configuration.
 * @param variant - The variant being rendered.
 * @returns The flags that apply to this variant's build.
 */
export const mergeCompilerFlags = (config: BuildConfig, variant: BuildVariant): CompilerFlags => {
  // Not a plain spread: that would copy an explicitly-`undefined` variant key
  // over the base value, which is exactly the `null`-unset behaviour this type
  // deliberately does not have.
  const merged: Record<string, unknown> = { ...config.compilerFlags };
  for (const [flag, value] of Object.entries(variant.compilerFlags ?? {})) {
    if (value !== undefined) merged[flag] = value;
  }
  return merged as CompilerFlags;
};

/**
 * Effective value of one `-s` setting for a variant.
 *
 * Same rule `mergeSettings` applies, for a single key: the variant's
 * value wins, and its `null` unset reads back as "not set".
 */
const effectiveSetting = (
  config: BuildConfig,
  variant: BuildVariant,
  setting: string,
): EmccSettingValue | undefined => {
  const overrides = variant.settings as
    | Readonly<Record<string, EmccSettingValue | null | undefined>>
    | undefined;
  const override = overrides?.[setting];
  if (override !== undefined) return override ?? undefined;
  return (config.settings as Readonly<Record<string, EmccSettingValue>> | undefined)?.[setting];
};

/** A setting counts as requesting its feature unless it is absent, `false`, or `0`. */
const settingEnabled = (value: EmccSettingValue | undefined): boolean =>
  value !== undefined && value !== false && value !== 0;

/**
 * Host capabilities a variant's artifacts require at load time.
 *
 * The **union** of what the variant declares in {@link BuildVariant.requires}
 * and what its effective (base-merged) build flags imply. `'threads'` is
 * inferred from any of: `compilerFlags.threads`, a `-pthread` entry in the
 * effective `rawFlags`, or a truthy merged `USE_PTHREADS` / `SHARED_MEMORY`
 * setting.
 *
 * Union rather than override, and deliberately so: those flags are the *cause*
 * of the requirement, not a declaration of it. A build with shared memory
 * imports a `SharedArrayBuffer`-backed memory and genuinely cannot instantiate
 * without cross-origin isolation, so there must be no way — not even an
 * explicit `requires: []` — to opt out of a capability the artifact really
 * needs. Inference can only ever add.
 *
 * @param config - The build configuration.
 * @param variant - The variant being resolved.
 * @returns The capabilities, declared ones first, without duplicates.
 */
export const variantCapabilities = (
  config: BuildConfig,
  variant: BuildVariant,
): readonly VariantCapability[] => {
  const capabilities = new Set<VariantCapability>(variant.requires ?? []);
  const threaded =
    mergeCompilerFlags(config, variant).threads === true ||
    [...(config.rawFlags ?? []), ...(variant.rawFlags ?? [])].includes('-pthread') ||
    settingEnabled(effectiveSetting(config, variant, 'USE_PTHREADS')) ||
    settingEnabled(effectiveSetting(config, variant, 'SHARED_MEMORY'));
  if (threaded) capabilities.add('threads');
  return [...capabilities];
};

/**
 * Whether a variant needs threads — and so the multi-threaded container image.
 *
 * Thin reading of {@link variantCapabilities}; see it for the inference rule.
 *
 * @param config - The build configuration.
 * @param variant - The variant being resolved.
 * @returns True when the variant declares or implies the `threads` capability.
 */
export const variantRequiresThreads = (config: BuildConfig, variant: BuildVariant): boolean =>
  variantCapabilities(config, variant).includes('threads');

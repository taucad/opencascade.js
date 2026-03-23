# Build System

The opencascade.js build system uses **Nx** for task orchestration and caching, replacing the custom `build-cache.py` system. The underlying Python build scripts (`Common.py`, `compileBindings.py`, `buildFromYaml.py`) remain, but are now invoked through Nx targets with correct input hashing and cache management.

## Architecture

The central design principle: **compile-time configuration and link-time flags are orthogonal concerns controlled by different actors**.

### Channel 1: Compile-time configuration (maintainer-controlled)

- Defined in `build-configs/configurations.json` as named configurations
- Selected via `--config <name>` CLI argument or `OCJS_CONFIG` env var
- Sets `OCJS_*` env vars for compile, wasm-opt, and closure compiler steps
- Individual env vars can override any config value

### Channel 2: Link-time flags (consumer-controlled)

- Defined in the consumer YAML's `emccFlags` array
- Passed **verbatim** to `emcc` at link time — no stripping, no filtering
- Exactly the same API consumers have used since v7.6.2

## Task Graph

```
setup (uncached) → pch → generate → compile-bindings ─┐
                     │                                   ├─→ link → build
                     └─→ compile-sources ───────────────┘
```

`compile-bindings` and `compile-sources` run in parallel after `pch` completes.

## configurations.json

All named compile-time configurations live in `build-configs/configurations.json`. Each entry is a map of `OCJS_*` environment variable names to values.

### Supported keys

| Key | Description | Default |
|---|---|---|
| `OCJS_OPT` | Compile optimization level (`-O0`, `-O2`, `-O3`, `-Os`) | `-O2` |
| `OCJS_LTO` | Enable LTO at compile time (`0` or `1`) | `0` |
| `OCJS_EXCEPTIONS` | Enable native WASM exceptions (`0` or `1`) | `0` |
| `OCJS_SIMD` | Enable SIMD instructions (`0` or `1`) | `0` |
| `THREADING` | Threading mode (`single-threaded` or `multi-threaded`) | `single-threaded` |
| `OCJS_DEFINES` | Comma-separated C preprocessor defines | _(empty)_ |
| `OCJS_UNDEFINES` | Comma-separated C preprocessor undefines | _(empty)_ |
| `OCJS_WASM_OPT_LEVEL` | wasm-opt optimization level | `-O3` |
| `OCJS_CLOSURE` | Run Closure Compiler (`true` or `false`) | `false` |
| `OCJS_EVAL_CTORS` | Enable Emscripten eval ctors (`true` or `false`) | `false` |
| `OCJS_CONVERGE` | Use `--converge` in wasm-opt (`true` or `false`) | `false` |
| `OCJS_PATCH_DUMP` | Patch OCCT Standard_Dump.hxx (`true` or `false`) | `false` |

### Adding a new configuration

Add an entry to `build-configs/configurations.json`:

```json
{
  "my-experiment": {
    "OCJS_OPT": "-O3",
    "OCJS_LTO": "1",
    "OCJS_EXCEPTIONS": "0",
    "THREADING": "single-threaded",
    "OCJS_WASM_OPT_LEVEL": "-O4",
    "OCJS_CLOSURE": "true",
    "OCJS_CONVERGE": "true"
  }
}
```

Unspecified keys fall back to the defaults in `build-wasm.sh`.

## Consumer YAML Format

The consumer YAML format is unchanged from v7.6.2:

```yaml
mainBuild:
  name: my_build.js
  bindings:
    - symbol: TopoDS_Shape
    - symbol: BRepBuilderAPI_MakeEdge
  emccFlags:
    - -O3
    - -flto
    - -fwasm-exceptions
    - -sEXPORT_ES6=1
    - -sMODULARIZE
    - -sALLOW_MEMORY_GROWTH=1
    - -sWASM_BIGINT
    - --no-entry
```

All `emccFlags` are passed **verbatim** to `emcc` at link time. The consumer has full control over link-time behavior.

## Fill-Not-Strip Rules

When linking, the build system applies "fill-not-strip" logic for optimization and LTO flags:

1. If consumer `emccFlags` already contains an `-O*` flag → used as-is
2. If consumer `emccFlags` lacks `-O*` → the config's `OCJS_OPT` value is added (default: `-O2`)
3. If consumer `emccFlags` already contains `-flto` → used as-is
4. If consumer `emccFlags` lacks `-flto` and `OCJS_LTO=1` → `-flto` is added

Consumer flags are never stripped or modified.

## Flag Precedence

For compile-time flags, precedence is (highest to lowest):

1. Explicit env var in the shell (e.g., `OCJS_OPT=-Os`)
2. Value from `configurations.json` entry (via `--config`)
3. `build-wasm.sh` built-in defaults

## Consistency Validation

The build system warns (non-fatal) when compile-time and link-time flags are mismatched:

- Compiled with `OCJS_EXCEPTIONS=1` but emccFlags has `-sDISABLE_EXCEPTION_CATCHING=1`
- Compiled with `OCJS_SIMD=1` but emccFlags lacks `-msimd128`
- Compiled without exceptions but emccFlags has `-fwasm-exceptions`

## Caching Behavior

Nx computes cache keys from `namedInputs` defined in `nx.json`:

- **compileConfig**: `configurations.json` content, `OCJS_CONFIG`, and all compile-time `OCJS_*` env vars
- **linkConfig**: Post-processing env vars (`OCJS_WASM_OPT_LEVEL`, `OCJS_CLOSURE`, `OCJS_CONVERGE`, etc.)
- **toolchain**: `emcc --version` output
- **depsVersion**: `DEPS.json` content
- **generatorCode**: All `src/**/*.py` files and `bindgen-filters.yaml`

### Cache sharing

Same config + different consumer YAMLs → compile targets cache-hit, link target cache-miss.
Different configs → fully separate compile caches.

### Debugging cache misses

```bash
npx nx show project ocjs         # Show resolved project config
NX_VERBOSE_LOGGING=true npx nx run ocjs:pch  # Verbose logging
```

## Maintainer Workflows

### Full build with a named configuration

```bash
./build-wasm.sh --config O3-maxperf full path/to/consumer.yml
```

### Link only (reuses compile cache)

```bash
./build-wasm.sh --config O3-maxperf link path/to/consumer.yml
```

### Override a single flag from the config

```bash
OCJS_WASM_OPT_LEVEL=-O4 ./build-wasm.sh --config O3-maxperf full consumer.yml
```

### Using Nx directly

```bash
OCJS_CONFIG=O3-maxperf OCJS_YAML=path/to/consumer.yml npx nx run ocjs:build
```

### Running individual targets

```bash
OCJS_CONFIG=default npx nx run ocjs:pch
OCJS_CONFIG=default npx nx run ocjs:generate
OCJS_CONFIG=default npx nx run ocjs:compile-bindings
OCJS_CONFIG=default npx nx run ocjs:compile-sources
OCJS_CONFIG=O3-maxperf OCJS_YAML=consumer.yml npx nx run ocjs:link
```

## Consumer Workflows

### Docker

```bash
docker run -e OCJS_CONFIG=default \
  -v $(pwd)/my-config.yml:/src/config.yml \
  -v $(pwd)/output:/output \
  opencascade-js link /src/config.yml
```

### Checkout-based

```bash
cd repos/opencascade.js
./scripts/setup-deps.sh
./build-wasm.sh --config O3-maxperf full path/to/consumer.yml
```

## Self-Contained Dependencies

Run `scripts/setup-deps.sh` to clone all dependencies into `deps/`:

- `deps/emsdk/` — Emscripten SDK (version from `DEPS.json`)
- `deps/OCCT/` — OpenCASCADE Technology (pinned commit)
- `deps/rapidjson/` — RapidJSON (pinned commit)
- `deps/freetype/` — FreeType (pinned commit)

The script is idempotent and validates pinned commits when `OCJS_STRICT_DEPS=1`.

## Migration from Old System

| Old | New |
|---|---|
| `--preset O3-maxperf` | `--config O3-maxperf` |
| `build-configs/presets/*.yml` | `build-configs/configurations.json` |
| `scripts/experiments/*.yml` | Entries in `configurations.json` + separate consumer YAML |
| `build-cache.py compute-key` | Nx content-hash based caching |
| `cache-list` / `cache-gc` | `npx nx reset` to clear all caches |
| `step_compile_all()` | Nx `dependsOn` task graph |
| `../assimpjs/emsdk` | `deps/emsdk/` (via `setup-deps.sh`) |
| Flag stripping in `buildFromYaml.py` | Fill-not-strip (consumer flags verbatim) |
| `OCJS_BIGINT` env var appendage | Consumer specifies `-sWASM_BIGINT` directly in emccFlags |
| `OCJS_EVAL_CTORS` env var appendage | Consumer specifies `-sEVAL_CTORS=N` directly in emccFlags |

## Troubleshooting

### Stale dependencies

```bash
rm -rf deps/ && ./scripts/setup-deps.sh
```

### Unexpected cache miss

Set `NX_VERBOSE_LOGGING=true` to see which inputs changed.

### Flag consistency warnings

These are non-fatal. They indicate a mismatch between compile-time configuration and consumer link-time flags. Review both your `--config` choice and consumer YAML's `emccFlags`.

### Full cache reset

```bash
npx nx reset
```

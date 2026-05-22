# Maintainer Guide

Build-from-source, configuration, and release workflow for `@taucad/opencascade.js`. Consumers reaching for the published tarball should start from [README.md](README.md) — this document is for fork maintainers and contributors building OCCT WASM locally.

## Table of Contents

- [Quick Start (Native Build)](#quick-start-native-build)
- [Build Configuration](#build-configuration)
  - [YAML Configs](#yaml-configs)
  - [Configurations](#configurations)
  - [Environment Variables](#environment-variables)
- [Customizing Your Build](#customizing-your-build)
- [Build Commands](#build-commands)
- [Docker End-to-End Validation](#docker-end-to-end-validation)
- [Additional Documentation](#additional-documentation)

## Quick Start (Native Build)

Prerequisites: Python 3.10+, Git, CMake, a C++ toolchain.

```bash
# 1. Clone opencascade.js
git clone https://github.com/taucad/opencascade.js.git
cd opencascade.js

# 2. Install Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git ../emsdk
cd ../emsdk && ./emsdk install 5.0.1 && ./emsdk activate 5.0.1 && source ./emsdk_env.sh
cd ../opencascade.js

# 3. Clone dependencies at pinned commits
./scripts/clone-deps.sh

# 4. Install Python build dependencies
pip install -r requirements.txt

# 5. Build WASM (use nohup — full builds take 10-30+ min)
nohup env OCJS_LTO=0 ./build-wasm.sh full build-configs/full.yml > build.log 2>&1 &
tail -f build.log
```

> **Tip:** Full builds take 10-30+ minutes (longer with cold caches). Using `nohup` ensures the build continues if your terminal session disconnects. For link-only rebuilds (~1-2 min), `nohup` is optional.

Output files appear alongside the YAML config: `opencascade_full.wasm`, `opencascade_full.js`, `opencascade_full.d.ts`.

## Build Configuration

### YAML Configs

YAML configs define which OCCT classes are bound to JavaScript:

- `build-configs/full.yml` — all symbols, single-threaded, native WASM exceptions on by default with `getExceptionMessage` runtime helpers

See [docs/reference/yaml-schema.md](docs/reference/yaml-schema.md) for the full YAML schema, including `additionalCppCode`, `additionalCppFiles`, `mainBuild.additionalBindCode`, and `mainBuild.allowedUndefinedSymbols`.

### Configurations

Named compile-time configurations live in [`build-configs/configurations.json`](build-configs/configurations.json). Apply one with `--config`:

```bash
# Production default — what the published tarball is built with: -O3, baseline SIMD,
# BigInt, native WASM exceptions, EVAL_CTORS=2, Closure, converge, mimalloc.
./build-wasm.sh --config single-threaded full build-configs/full.yml

# Size-tuned variant: -Os compile + wasm-opt -O3, same feature set, smaller binary
./build-wasm.sh --config single-threaded-smallest full build-configs/full.yml

# Threaded variant for SAB/COOP+COEP-isolated deployments
./build-wasm.sh --config multi-threaded full build-configs/full.yml

# Debug — fastest build, -O0 compile + wasm-opt -O0, SIMD off, converge off
./build-wasm.sh --config debug full build-configs/full.yml
```

Add your own entry to `configurations.json` to define a new configuration. See [BUILD_SYSTEM.md](BUILD_SYSTEM.md) for the full list of `OCJS_*` keys.

The published npm tarball ships **both** build outputs:

| Artifact prefix | Config | Subpath export |
| --- | --- | --- |
| `opencascade_full.*` | `single-threaded` + `full.yml` | `@taucad/opencascade.js` / `@taucad/opencascade.js/wasm` |
| `opencascade_full_multi.*` | `multi-threaded` + `full_multi.yml` | `@taucad/opencascade.js/multi` / `@taucad/opencascade.js/multi/wasm` |

Each triple includes a matching `*.provenance.json` sidecar (`dist/opencascade_full.provenance.json` and `dist/opencascade_full_multi.provenance.json`).

### npm release

After `dist/` contains both ST and MT artifacts and smoke tests pass:

```bash
npm pack --dry-run   # verify tarball lists all 12 dist files (6 ST + 6 MT)
npm publish --tag rc --access public
```

Do **not** publish from a dirty tree or without both binaries present — consumers expect the MT subpath to resolve at install time.

### Environment Variables

Two layers of "default" matter here. The **bare default** is what `build-wasm.sh` falls back to if you set neither an env var nor a `--config`. The **shipped `full.yml` build** is what the published `@taucad/opencascade.js` tarball was actually linked with — the YAML config carries its own `emccFlags` (`-sWASM_BIGINT`, `-sEVAL_CTORS=2`, `-msimd128`) that win regardless of env var, and every named entry in [`build-configs/configurations.json`](build-configs/configurations.json) sets the corresponding `OCJS_*` envs to match.

| Variable            | Bare default      | Shipped `full.yml` build | Description                                                                                                  |
| ------------------- | ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `OCJS_OPT`          | `-O2`             | `-O3`                    | Compile optimization level                                                                                   |
| `OCJS_LTO`          | `1`               | `0`                      | LTO at compile time. Empirically harmful for OCCT — see [custom emcc flags guide](docs/guides/custom-emcc-flags.md). |
| `OCJS_EXCEPTIONS`   | `0`               | `1`                      | Native WASM exceptions. Shipped build forces this on for decodable C++ exceptions.                           |
| `OCJS_SIMD`         | `0`               | `1`                      | Baseline WASM SIMD (`-msimd128`). Universally supported.                                                     |
| `OCJS_RELAXED_SIMD` | `0`               | `0`                      | Relaxed SIMD ops on top of `OCJS_SIMD`. Safari 26.x cannot parse these — leave off for cross-browser builds. |
| `OCJS_BIGINT`       | `0`               | `1`                      | `-sWASM_BIGINT` for native i64↔BigInt; eliminates the i64 legalization pass.                                 |
| `OCJS_EVAL_CTORS`   | `false`           | `true`                   | `-sEVAL_CTORS=N` static-init evaluation at compile time.                                                     |
| `OCJS_EXTRA_CFLAGS` | _(empty)_         | _(empty)_                | Extra compile flags appended to C/CXX (e.g. `"-mllvm -inline-threshold=128"`).                               |
| `OCJS_DEFINES`      | _(empty)_         | `OCCT_NO_DUMP`           | Comma-separated list of `-D` macros.                                                                         |
| `OCJS_UNDEFINES`    | _(empty)_         | `OCC_CONVERT_SIGNALS`    | Comma-separated list of `-U` undefines.                                                                      |
| `THREADING`         | `single-threaded` | `single-threaded`        | Threading mode (`single-threaded` or `multi-threaded`).                                                      |

The bare-default column is only relevant if you invoke `build-wasm.sh` without `--config` _and_ without `OCJS_CONFIG` — the script's own fallback selects the `single-threaded` configuration when both are unset, so in practice you always get the rightmost column unless you go out of your way to disable it.

## Customizing Your Build

Create a custom YAML config with only the symbols your application needs:

1. Copy `build-configs/full.yml` as a starting point
2. Remove symbols you don't use from `bindings`
3. (Most cases) handle typedefs for NCollection and `Handle<T>` types are auto-discovered, so manual `additionalCppCode` edits are usually unnecessary. Edit only when you hit a missing-handle linker error.
4. Validate: `./build-wasm.sh validate build-configs/my-config.yml`
5. Build: `./build-wasm.sh link build-configs/my-config.yml`

Fewer symbols = smaller WASM binary. Each symbol adds ~15-25 KB.

## Build Commands

```bash
# Full build — always use nohup (10-30+ min)
nohup env ./build-wasm.sh full <yaml> > build.log 2>&1 &

./build-wasm.sh link <yaml>        # Link only (fastest, reuses .o files)
./build-wasm.sh validate <yaml>    # Validate config without building
./build-wasm.sh cache-list         # List cached compilations
./build-wasm.sh cache-gc [n]       # Clean old cache entries
./build-wasm.sh --help             # Full usage information
```

## Docker End-to-End Validation

`scripts/docker-e2e-validate.sh` builds the image, links a consumer YAML, asserts byte-size delta versus a locally-built baseline, and runs a JS smoke test. Driven via Nx:

```bash
pnpm nx run ocjs:docker-e2e
```

The script verifies image build success, consumer link, wasm byte-size delta against a local baseline, and a JS-side smoke test.

## Additional Documentation

- [BREAKING_CHANGES.md](BREAKING_CHANGES.md) — consumer migration guide
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [BUILD_SYSTEM.md](BUILD_SYSTEM.md) — full `OCJS_*` env-var matrix and configuration authoring
- [docs/reference/yaml-schema.md](docs/reference/yaml-schema.md) — YAML schema reference
- [docs/guides/custom-emcc-flags.md](docs/guides/custom-emcc-flags.md) — tuning size, speed, and build time
- [docs/guides/trim-symbols.md](docs/guides/trim-symbols.md) — trim from `full.yml` to a consumer-sized build
- [docs/guides/extend-with-cpp.md](docs/guides/extend-with-cpp.md) — add wrappers via `additionalCppCode` / `additionalCppFiles` / `additionalBindCode`
- [docs/guides/reproducible-ci.md](docs/guides/reproducible-ci.md) — pin-by-SHA, `provenance.json`, SBOM, lockfile discipline
- [TODO.md](TODO.md) — contributor backlog

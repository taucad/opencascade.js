<p align="center">
  <img src="https://github.com/donalffons/opencascade.js/raw/master/images/logo.svg" alt="Logo" width="50%">

  <h3 align="center">OpenCascade.js</h3>

  <p align="center">
    A port of the <a href="https://www.opencascade.com/">OpenCascade</a> CAD library to JavaScript and WebAssembly via Emscripten.
    <br />
    <a href="https://ocjs.org/"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/donalffons/opencascade.js-examples">Examples</a>
    ·
    <a href="https://github.com/donalffons/opencascade.js/issues">Issues</a>
    ·
    <a href="https://github.com/donalffons/opencascade.js/discussions">Discuss</a>
  </p>
</p>

## What's New in v3

- **OCCT 8.0.0 RC5** — 1,085 commits of improvements; 22-31% faster boolean operations
- **Emscripten 5.0.1** — LLVM 17, modern WASM features
- **Native WASM Exceptions** — `-fwasm-exceptions` replaces JS invoke trampolines, decodable end-to-end via `getExceptionMessage`
- **ESM-only single-file distribution** — `"type": "module"`; `dist/` ships exactly one variant (`opencascade_full.{js,wasm,d.ts}`) with a default-export `init` function and explicit `locateFile` (no facade module to choose between variants)
- **Full TypeScript bindings** — Doxygen-derived JSDoc rendered correctly in Monaco IntelliSense
- **Suffix-free overloads** — single symbol per class with val-based dispatcher, no more `_2`/`_3` subclasses
- **Reproducible builds** — `DEPS.json` pins every dependency to an exact commit; per-build `provenance.json` sidecar
- **Cached, incremental builds** — content-addressed compilation cache turns 10-30 minute clean builds into seconds on hit

See [CHANGELOG.md](CHANGELOG.md) for the full v3.0.0 entry.

## Install

> **Upgrading?** See **[BREAKING_CHANGES.md](BREAKING_CHANGES.md)** for the full v3 migration guide (package rename, ESM-only loading, exception decode pattern, OCCT V8 API).

```bash
pnpm add @taucad/opencascade.js@beta
# or: npm install @taucad/opencascade.js@beta
```

The package is ESM-only with a default-export `init` function. Pass `locateFile` so the Emscripten loader can resolve `opencascade_full.wasm` from your bundler's output (browser) or `node_modules` layout (Node).

```ts
// Node — mirrors tests/smoke/helpers.ts
import * as path from 'node:path';
import init from '@taucad/opencascade.js';

const BUILD_DIR = path.dirname(
  new URL(import.meta.resolve('@taucad/opencascade.js/dist/opencascade_full.wasm')).pathname,
);

const oc = await init({
  locateFile: (filename: string) => path.join(BUILD_DIR, filename),
});

using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
const shape = box.Shape();
```

```ts
// Vite / browser
import init from '@taucad/opencascade.js';
import wasmUrl from '@taucad/opencascade.js/dist/opencascade_full.wasm?url';

const oc = await init({ locateFile: () => wasmUrl });
```

The published tarball ships pre-built WASM at `dist/opencascade_full.{wasm,js,d.ts}` along with a `provenance.json` sidecar describing the exact toolchain and source commits used.

The rest of this README covers building from source — for customizing the binding set, optimization presets, or contributing to the fork.

## Quick Start (Native Build)

Prerequisites: Python 3.10+, Git, CMake, a C++ toolchain.

```bash
# 1. Clone opencascade.js
git clone https://github.com/donalffons/opencascade.js.git
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

## Docker Build

For reproducible builds without installing dependencies locally:

```bash
# Build the Docker image
docker build -t opencascade-js .

# Build WASM (output mounted to ./output/)
docker run --rm -v $(pwd)/output:/output -e OCJS_EXCEPTIONS=1 \
  opencascade-js full build-configs/full.yml

# Build with a custom config
docker run --rm \
  -v $(pwd)/my-config.yml:/opencascade.js/build-configs/custom.yml \
  -v $(pwd)/output:/output \
  opencascade-js full build-configs/custom.yml
```

## Build Configuration

### YAML Configs

YAML configs define which OCCT classes are bound to JavaScript:

- `build-configs/full.yml` — all symbols, single-threaded, native WASM exceptions on by default with `getExceptionMessage` runtime helpers

See [Build Configuration Reference](docs/build-config-reference.md) for the full YAML schema.

### Configurations

Named compile-time configurations live in [`build-configs/configurations.json`](build-configs/configurations.json). Apply one with `--config`:

```bash
# Default — what the published tarball is built with: -O3, SIMD, BigInt, EVAL_CTORS, no exceptions
./build-wasm.sh --config default full build-configs/full.yml

# With native WASM exceptions (decodable C++ exceptions end-to-end)
./build-wasm.sh --config O3-wasm-exc-simd full build-configs/full.yml

# Size-optimized (-Os) variant
./build-wasm.sh --config Os-noLTO-simd full build-configs/full.yml

# Debug (fastest build, -O0, no SIMD)
./build-wasm.sh --config O0-debug full build-configs/full.yml
```

Add your own entry to `configurations.json` to define a new configuration. See [BUILD_SYSTEM.md](BUILD_SYSTEM.md) for the full list of `OCJS_*` keys.

### Environment Variables

Two layers of "default" matter here. The **bare default** is what `build-wasm.sh` falls back to if you set neither an env var nor a `--config`. The **shipped `full.yml` build** is what the published `@taucad/opencascade.js` tarball was actually linked with — the YAML config carries its own `emccFlags` (`-sWASM_BIGINT`, `-sEVAL_CTORS=2`, `-msimd128`) that win regardless of env var, and every named entry in [`build-configs/configurations.json`](build-configs/configurations.json) sets the corresponding `OCJS_*` envs to match.

| Variable             | Bare default      | Shipped `full.yml` build | Description |
|----------------------|-------------------|--------------------------|-------------|
| `OCJS_OPT`           | `-O2`             | `-O3`                    | Compile optimization level |
| `OCJS_LTO`           | `1`               | `0`                      | LTO at compile time. Empirically harmful for OCCT — see [optimization guide](docs/optimization-guide.md). |
| `OCJS_EXCEPTIONS`    | `0`               | `1`                      | Native WASM exceptions. Shipped build forces this on for decodable C++ exceptions. |
| `OCJS_SIMD`          | `0`               | `1`                      | Baseline WASM SIMD (`-msimd128`). Universally supported. |
| `OCJS_RELAXED_SIMD`  | `0`               | `0`                      | Relaxed SIMD ops on top of `OCJS_SIMD`. Safari 26.x cannot parse these — leave off for cross-browser builds. |
| `OCJS_BIGINT`        | `0`               | `1`                      | `-sWASM_BIGINT` for native i64↔BigInt; eliminates the i64 legalization pass. |
| `OCJS_EVAL_CTORS`    | `false`           | `true`                   | `-sEVAL_CTORS=N` static-init evaluation at compile time. |
| `OCJS_EXTRA_CFLAGS`  | _(empty)_         | _(empty)_                | Extra compile flags appended to C/CXX (e.g. `"-mllvm -inline-threshold=128"`). |
| `OCJS_DEFINES`       | _(empty)_         | `OCCT_NO_DUMP`           | Comma-separated list of `-D` macros. |
| `OCJS_UNDEFINES`     | _(empty)_         | `OCC_CONVERT_SIGNALS`    | Comma-separated list of `-U` undefines. |
| `THREADING`          | `single-threaded` | `single-threaded`        | Threading mode (`single-threaded` or `multi-threaded`). |

The bare-default column is only relevant if you invoke `build-wasm.sh` without `--config`. Any named configuration (including `default`) sets the rightmost column.

## Customizing Your Build

Create a custom YAML config with only the symbols your application needs:

1. Copy `build-configs/full.yml` as a starting point
2. Remove symbols you don't use from `bindings`
3. (Most cases) handle typedefs for NCollection and `Handle<T>` types are auto-discovered in v3, so manual `additionalCppCode` edits are usually unnecessary. Edit only when you hit a missing-handle linker error.
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

## Documentation

- [BREAKING_CHANGES.md](BREAKING_CHANGES.md) — v3 consumer migration guide (package rename, ESM, exception handling, OCCT V8 API, removed symbols, build flags)
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [BUILD_SYSTEM.md](BUILD_SYSTEM.md) — full `OCJS_*` env-var matrix and configuration authoring guide
- [Optimization Guide](docs/optimization-guide.md) — tuning size, speed, and build time
- [Build Configuration Reference](docs/build-config-reference.md) — YAML schema and customization

## Projects Using opencascade.js

- [ArchiYou](https://archiyou.com/) — Library, Code-CAD Design Tool, Community Hub
- [BitByBit](https://bitbybit.dev/) — Code- & node-based CAD Design Tool
- [CascadeStudio](https://github.com/zalo/CascadeStudio) — Library and Code-CAD Design Tool
- [RepliCAD](https://replicad.xyz/) — Library and Code-CAD Design Tool
- [Tau](https://tau.new/) — AI-native CAD platform for the web

## Contributing

Contributions are welcome! See [TODO.md](TODO.md) for ideas.

## License

See [LICENSE](LICENSE).

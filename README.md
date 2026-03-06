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

## What's New in V8

- **OCCT 8.0.0-RC4** — 1,085 commits of improvements, 22-31% faster boolean operations
- **Emscripten 5.0.1** — LLVM 17, modern WASM features
- **Native WASM Exceptions** — replaces JS invoke trampolines, 39% smaller exception builds
- **Build System** — `build-wasm.sh` with compilation cache, presets, and provenance tracking
- **Pinned Dependencies** — `DEPS.json` locks all dependency versions for reproducible builds

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

# 5. Build WASM
OCJS_LTO=0 ./build-wasm.sh full build-configs/full.yml
```

Output files appear alongside the YAML config: `opencascade_full.wasm`, `opencascade_full.js`, `opencascade_full.d.ts`.

## Docker Build

For reproducible builds without installing dependencies locally:

```bash
# Build the Docker image
docker build -t opencascade-js .

# Build WASM (output mounted to ./output/)
docker run --rm -v $(pwd)/output:/output opencascade-js full build-configs/full.yml

# Build with exceptions
docker run --rm -v $(pwd)/output:/output -e OCJS_EXCEPTIONS=1 \
  opencascade-js full build-configs/full-exceptions.yml

# Build with a custom config
docker run --rm \
  -v $(pwd)/my-config.yml:/opencascade.js/build-configs/custom.yml \
  -v $(pwd)/output:/output \
  opencascade-js full build-configs/custom.yml
```

## Build Configuration

### YAML Configs

YAML configs define which OCCT classes are bound to JavaScript:

- `build-configs/full.yml` — 233 symbols, single-threaded, no exceptions
- `build-configs/full-exceptions.yml` — 235 symbols, native WASM exceptions

See [Build Configuration Reference](docs/build-config-reference.md) for the full YAML schema.

### Presets

Presets control optimization settings separately from what to bind:

```bash
# Balanced (recommended)
./build-wasm.sh --preset O2-balanced full build-configs/full.yml

# Maximum performance
./build-wasm.sh --preset O3-maxperf full build-configs/full.yml

# Minimum size
./build-wasm.sh --preset Os-minsize full build-configs/full.yml

# Debug (fastest build)
./build-wasm.sh --preset O0-debug full build-configs/full.yml
```

### Environment Variables

| Variable          | Default             | Description |
|-------------------|---------------------|-------------|
| `OCJS_OPT`        | `-O2`               | Compile optimization level |
| `OCJS_LTO`        | `1`                 | LTO at compile time (set `0` to disable) |
| `OCJS_EXCEPTIONS` | `0`                 | Native WASM exceptions (`1` to enable) |
| `THREADING`        | `single-threaded`   | Threading mode |

## Customizing Your Build

Create a custom YAML config with only the symbols your application needs:

1. Copy `build-configs/full.yml` as a starting point
2. Remove symbols you don't use from `bindings`
3. Remove corresponding handle typedefs from `additionalCppCode`
4. Validate: `./build-wasm.sh validate build-configs/my-config.yml`
5. Build: `./build-wasm.sh link build-configs/my-config.yml`

Fewer symbols = smaller WASM binary. Each symbol adds ~15-25 KB.

## Build Commands

```bash
./build-wasm.sh full <yaml>        # Full build with cache
./build-wasm.sh link <yaml>        # Link only (fastest, reuses .o files)
./build-wasm.sh validate <yaml>    # Validate config without building
./build-wasm.sh cache-list         # List cached compilations
./build-wasm.sh cache-gc [n]       # Clean old cache entries
./build-wasm.sh --help             # Full usage information
```

## Documentation

- [OCCT V8 Migration Guide](docs/occt-v8-migration.md) — breaking changes for upgrading from V7.6.2
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

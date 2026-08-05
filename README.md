<p align="center">
  <img src="images/logo.svg" alt="libcascade" width="50%">

  <h3 align="center">libcascade</h3>

  <p align="center">
    A port of the <a href="https://www.opencascade.com/">OpenCascade</a> CAD library to JavaScript and WebAssembly via Emscripten.
    <br />
    <a href="https://opencascade-js.vercel.app/"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/taucad/opencascade.js/issues">Issues</a>
    ·
    <a href="https://github.com/taucad/opencascade.js/issues">Get help</a>
  </p>
</p>

<p align="center">
  <a href="https://github.com/taucad/opencascade.js/actions/workflows/docker.yml"><img src="https://github.com/taucad/opencascade.js/actions/workflows/docker.yml/badge.svg" alt="docker"></a>
  <a href="https://github.com/taucad/opencascade.js/pkgs/container/opencascade.js"><img src="https://ghcr-badge.egpl.dev/taucad/opencascade.js/latest_tag?trim=major&label=ghcr" alt="ghcr"></a>
</p>

## Choose Your Path

| I want to…                                                 | Go to                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Use OCCT from JS or TS** (npm install, ESM `init`)       | [Quickstart (npm)](#quickstart-npm)                                                       |
| **Run a reproducible build** (CI, Docker, custom YAML)     | [Quickstart (Docker)](#quickstart-docker)                                                 |
| **See what changed in v3** (OCCT V8, ESM-only, exceptions) | [What's New in v3](#whats-new-in-v3) · [BREAKING_CHANGES.md](BREAKING_CHANGES.md)         |
| **Customize the binding set** (trim YAML, add wrappers)    | [YAML schema](https://opencascade-js.vercel.app/docs/toolchain/reference/yaml-schema)      |
| **Build OCCT WASM from source** (maintainers/contributors) | [MAINTAINER.md](MAINTAINER.md)                                                            |
| **Contribute or report an issue**                          | [Contributing](#contributing) · [Issues](https://github.com/taucad/opencascade.js/issues) |

## Quickstart (npm)

`libcascade` brings the OpenCASCADE Technology kernel to JavaScript and
WebAssembly. Its source is maintained in
[`taucad/opencascade.js`](https://github.com/taucad/opencascade.js); it is not
an official Open CASCADE Technology distribution.

```bash
pnpm add libcascade
# or: npm install libcascade
```

The package is ESM-only with one runtime export: the default `init` function.
It resolves the adjacent WASM automatically. Use `locateFile` only when a
bundler or deployment relocates the binary; `libcascade/wasm` is the supported
asset subpath, with no `dist/...` deep imports.

Build-time tools can consume the deterministic API-reference feed through
`libcascade/api-reference.json`. It includes the parsed class/member hierarchy, the
full source commit, build provenance, and exact input hashes; site-specific
routes and search indexes remain consumer-derived.

```ts
import init from 'libcascade';

const oc = await init();

using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
const shape = box.Shape();
```

```ts
// Vite / browser
import init from 'libcascade';
import wasmUrl from 'libcascade/wasm?url';

const oc = await init({ locateFile: () => wasmUrl });
```

The published tarball ships pre-built WASM at `dist/opencascade_full.{wasm,js,d.ts}` (single-threaded default) and `dist/opencascade_full_multi.{wasm,js,d.ts}` (multi-threaded opt-in), each with a `provenance.json` sidecar describing the exact toolchain and source commits used. npm releases are produced by GitHub OIDC Trusted Publishing and include Sigstore provenance; see the [maintainer release flow](MAINTAINER.md#ci-and-release-ownership).

### Multi-threaded build

For batch meshing, boolean grids, and STEP→glTF pipelines that benefit from OCCT's internal thread pool, import the pthread-enabled variant instead of the default:

```ts
import init from 'libcascade/multi';

const oc = await init();

// Run once after init — flip OCCT global parallel defaults.
oc.BOPAlgo_Options.SetParallelMode(true); // booleans fan out by default
oc.BRepMesh_IncrementalMesh.SetParallelDefault(true); // meshing fan out by default
```

```ts
// Vite / browser (requires COOP/COEP headers — see docs)
import init from 'libcascade/multi';
import wasmUrl from 'libcascade/multi/wasm?url';

const oc = await init({ locateFile: () => wasmUrl });

oc.BOPAlgo_Options.SetParallelMode(true);
oc.BRepMesh_IncrementalMesh.SetParallelDefault(true);
```

Browsers require `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every page that loads the threaded wasm. See the [multi-threaded build guide](https://opencascade-js.vercel.app/docs/package/guides/multi-threading) for activation, benchmarks, and when not to ship threaded; [toolchain custom-build](https://opencascade-js.vercel.app/docs/toolchain/guides/multi-threading) covers the YAML recipe for trimmed MT variants.

## Quickstart (Docker)

Pre-built images are published to [ghcr.io/taucad/opencascade.js](https://github.com/taucad/opencascade.js/pkgs/container/opencascade.js):

- Releases, `main`, and explicitly dispatched canaries publish multi-arch manifest lists (`linux/amd64` + `linux/arm64`) after each architecture builds, links, and passes its native runtime smoke.

No local build required.

```bash
docker pull ghcr.io/taucad/opencascade.js:single-threaded

# Single-mount Quickstart — outputs land next to your YAML
docker run --rm \
  -v "$(pwd):/src" \
  -u "$(id -u):$(id -g)" \
  ghcr.io/taucad/opencascade.js:single-threaded link my-config.yml
```

For cached iterative builds (link-only reruns in ≤ 5 min), see the named-volume recipe in [MAINTAINER.md](MAINTAINER.md#docker-end-to-end-validation). Apple Silicon runs natively from the manifest list — no `--platform` flag required.

The entrypoint dispatches subcommands (`link`, `compile-bindings`, `compile-sources`, `pch`, `generate`, `apply-patches`) through `npx nx run ocjs:<target>`. `link` is the end-to-end command: Nx caches the canonical internal `link-core`, then an uncached step materializes its exact inventory into `OCJS_OUTPUT_DIR` before validation and provenance finalization. A cache hit therefore still populates a fresh bind mount without relinking. Use `docker run … --help` for the complete reference, or `docker run … nx <args>` as an escape hatch into raw Nx.

## Tags

| Tag                                           | What it points at                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `:single-threaded`                            | Latest release, single-threaded warm cache (default for browser CAD UIs)           |
| `:multi-threaded`                             | Latest release, multi-threaded warm cache (requires COOP/COEP)                     |
| `:bindgen-base`                               | Latest release, post-PCH/generate but pre-compile (custom-bindings starting point) |
| `:<version>-<stage>`                          | Pinned release for `single-threaded`, `multi-threaded`, or `bindgen-base`           |
| `:canary-<sha8>-<stage>`                      | Immutable maintainer-dispatched canary, retained for seven days                    |
| `:branch-main[-<full-sha>]`                   | Current or immutable `main`, single-threaded                                       |
| `:multi-threaded-branch-main[-<full-sha>]`    | Current or immutable `main`, multi-threaded                                        |
| `:bindgen-base-branch-main[-<full-sha>]`      | Current or immutable `main`, bindgen-base                                          |

Docker resolves the right architecture from every published manifest list automatically — no `--platform` flag is needed on either `linux/amd64` or `linux/arm64` hosts.

## What's New in v3

- **OCCT 8.0.1** — 1,085+ commits of improvements; 22-31% faster boolean operations
- **Emscripten 6.0.5** — LLVM 24, modern WASM features
- **Native WASM Exceptions** — `-fwasm-exceptions` replaces JS invoke trampolines; decodable end-to-end via `oc.getExceptionMessage`
- **ESM-only distribution** — `"type": "module"`; default export is single-threaded `opencascade_full.{js,wasm,d.ts}`; multi-threaded `opencascade_full_multi.{js,wasm,d.ts}` ships under `libcascade/multi` and `/multi/wasm`
- **Full TypeScript bindings** — Doxygen-derived JSDoc rendered correctly in Monaco IntelliSense
- **Suffix-free overloads** — single symbol per class with val-based dispatcher, no more `_2`/`_3` subclasses (measured at ~264 ns/call, <0.011% of wall time on typical CAD models — see [BENCHMARKS.md](BENCHMARKS.md))
- **Reproducible builds** — `DEPS.json` pins every dependency to an exact commit; per-build `provenance.json` sidecar
- **Cached, incremental builds** — content-addressed compilation cache turns 10-30 minute clean builds into seconds on hit

See [CHANGELOG.md](CHANGELOG.md) for the full v3.0.0 entry. For empirical evidence of every measurable project change (wall-clock CAD perf vs native C++, multi-threading speedup, embind dispatch cost, RBV overhead), see **[BENCHMARKS.md](BENCHMARKS.md)**.

## Documentation

- [BREAKING_CHANGES.md](BREAKING_CHANGES.md) — v3 consumer migration guide
- [CHANGELOG.md](CHANGELOG.md) — release notes
- **[BENCHMARKS.md](BENCHMARKS.md)** — empirical evidence hub: wall-clock CAD perf vs native C++, multi-threading speedup, embind dispatch cost, RBV overhead
- [MAINTAINER.md](MAINTAINER.md) — native build, env vars, customization for maintainers and contributors
- [YAML schema](https://opencascade-js.vercel.app/docs/toolchain/reference/yaml-schema) — bindings, flags, `additionalCppFiles`, and `additionalBindFiles`
- [BUILD_SYSTEM.md](BUILD_SYSTEM.md) — `OCJS_*` env-var matrix and configuration authoring
- [Custom emcc flags](https://opencascade-js.vercel.app/docs/toolchain/guides/custom-emcc-flags) — tuning size, speed, and build time
- [Trim symbols](https://opencascade-js.vercel.app/docs/toolchain/guides/trim-symbols) — trim from `full.yml` to a consumer-sized build
- [Extend with C++](https://opencascade-js.vercel.app/docs/toolchain/guides/extend-with-cpp) — generated C++ and raw Embind files
- [Reproducible CI](https://opencascade-js.vercel.app/docs/toolchain/guides/reproducible-ci) — pin-by-SHA, provenance, SBOM, and lockfile discipline

## Projects Using libcascade

- [ArchiYou](https://archiyou.com/) — Library, Code-CAD Design Tool, Community Hub
- [BitByBit](https://bitbybit.dev/) — Code- & node-based CAD Design Tool
- [CascadeStudio](https://github.com/zalo/CascadeStudio) — Library and Code-CAD Design Tool
- [RepliCAD](https://replicad.xyz/) — Library and Code-CAD Design Tool
- [Tau](https://tau.new/) — AI-native CAD platform for the web

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), see
[TODO.md](TODO.md) for the current backlog, and use
[MAINTAINER.md](MAINTAINER.md) for build-from-source instructions.

## License

See [LICENSE](LICENSE).

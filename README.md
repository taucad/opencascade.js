<p align="center">
  <img src="https://github.com/donalffons/opencascade.js/raw/master/images/logo.svg" alt="Logo" width="50%">

  <h3 align="center">opencascade.js</h3>

  <p align="center">
    A port of the <a href="https://www.opencascade.com/">OpenCascade</a> CAD library to JavaScript and WebAssembly via Emscripten.
    <br />
    <a href="https://ocjs.org/"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/taucad/opencascade.js/issues">Issues</a>
    ·
    <a href="https://github.com/taucad/opencascade.js/discussions">Discuss</a>
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
| **Customize the binding set** (trim YAML, add wrappers)    | [docs/reference/yaml-schema.md](docs/reference/yaml-schema.md)                            |
| **Build OCCT WASM from source** (fork maintainers)         | [MAINTAINER.md](MAINTAINER.md)                                                            |
| **Contribute or report an issue**                          | [Contributing](#contributing) · [Issues](https://github.com/taucad/opencascade.js/issues) |

## Quickstart (npm)

`ocjs` is the Tau-maintained fork and npm distribution of OpenCascade.js. Its source remains in [`taucad/opencascade.js`](https://github.com/taucad/opencascade.js);
it is not an official Open CASCADE Technology distribution.

> Migrating from v2 or `@taucad/opencascade.js`? See
> **[BREAKING_CHANGES.md](BREAKING_CHANGES.md)** for the package rename,
> ESM-only loading, exception decode pattern, and OCCT V8 API changes.

```bash
pnpm add ocjs@canary
# or: npm install ocjs@canary
```

The package is ESM-only with a default-export `init` function. Pass `locateFile` so the Emscripten loader can resolve the wasm binary from your bundler's output (browser) or `node_modules` layout (Node). Both runtimes reach the binary through the `ocjs/wasm` subpath export — no `dist/...` deep imports required.

Build-time tools can consume the deterministic API-reference feed through
`ocjs/api-reference.json`. It includes the parsed class/member hierarchy, the
full source commit, build provenance, and exact input hashes; site-specific
routes and search indexes remain consumer-derived.

```ts
// Node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import init from 'ocjs';

const WASM_DIR = dirname(fileURLToPath(import.meta.resolve('ocjs/wasm')));

const oc = await init({
  locateFile: (filename: string) => join(WASM_DIR, filename),
});

using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
const shape = box.Shape();
```

```ts
// Vite / browser
import init from 'ocjs';
import wasmUrl from 'ocjs/wasm?url';

const oc = await init({ locateFile: () => wasmUrl });
```

The published tarball ships pre-built WASM at `dist/opencascade_full.{wasm,js,d.ts}` (single-threaded default) and `dist/opencascade_full_multi.{wasm,js,d.ts}` (multi-threaded opt-in), each with a `provenance.json` sidecar describing the exact toolchain and source commits used. npm releases are produced by GitHub OIDC Trusted Publishing and include Sigstore provenance; see the [maintainer release flow](MAINTAINER.md#ci-and-release-ownership).

### Multi-threaded build

For batch meshing, boolean grids, and STEP→glTF pipelines that benefit from OCCT's internal thread pool, import the pthread-enabled variant instead of the default:

```ts
// Node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import init from 'ocjs/multi';

const WASM_DIR = dirname(fileURLToPath(import.meta.resolve('ocjs/multi/wasm')));

const oc = await init({
  locateFile: (filename: string) => join(WASM_DIR, filename),
});

// Run once after init — flip OCCT global parallel defaults and size the thread pool.
oc.BOPAlgo_Options.SetParallelMode(true); // booleans fan out by default
oc.BRepMesh_IncrementalMesh.SetParallelDefault(true); // meshing fan out by default
const pool = oc.OSD_ThreadPool.DefaultPool(-1); // lazy-init pool to NbLogicalProcessors
pool.SetNbDefaultThreadsToLaunch(pool.NbThreads()); // let each call use all workers
```

```ts
// Vite / browser (requires COOP/COEP headers — see docs)
import init from 'ocjs/multi';
import wasmUrl from 'ocjs/multi/wasm?url';

const oc = await init({ locateFile: () => wasmUrl });

oc.BOPAlgo_Options.SetParallelMode(true);
oc.BRepMesh_IncrementalMesh.SetParallelDefault(true);
using pool = oc.OSD_ThreadPool.DefaultPool(-1);
pool.SetNbDefaultThreadsToLaunch(pool.NbThreads());
```

Browsers require `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every page that loads the threaded wasm. See the [multi-threaded build guide](https://ocjs.org/docs/package/guides/multi-threading) for activation, benchmarks, and when not to ship threaded; [toolchain custom-build](https://ocjs.org/docs/toolchain/guides/multi-threading) covers the YAML recipe for trimmed MT variants.

## Quickstart (Docker)

Pre-built images are published to [ghcr.io/taucad/opencascade.js](https://github.com/taucad/opencascade.js/pkgs/container/opencascade.js):

- **Every push**—branches and `main`—publishes multi-arch manifest lists (`linux/amd64` + `linux/arm64`) after each architecture builds, links, and passes its native runtime smoke.

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

| Tag                             | What it points at                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `:single-threaded`              | Latest release, single-threaded warm cache (default for browser CAD UIs)           |
| `:multi-threaded`               | Latest release, multi-threaded warm cache (requires COOP/COEP)                     |
| `:bindgen-base`                 | Latest release, post-PCH/generate but pre-compile (custom-bindings starting point) |
| `:<version>-single-threaded`    | Pinned release, single-threaded (e.g. `:3.0.0-single-threaded`)                    |
| `:<version>-multi-threaded`     | Pinned release, multi-threaded                                                     |
| `:<version>-bindgen-base`       | Pinned release, bindgen-base                                                       |
| `:branch-<slug>`                | Branch tip, single-threaded (amd64+arm64, ephemeral — 7-day GHCR retention)        |
| `:multi-threaded-branch-<slug>` | Branch tip, multi-threaded (amd64+arm64, ephemeral)                                |
| `:bindgen-base-branch-<slug>`   | Branch tip, bindgen-base (amd64+arm64, ephemeral)                                  |

Docker resolves the right architecture from every published manifest list automatically — no `--platform` flag is needed on either `linux/amd64` or `linux/arm64` hosts.

## What's New in v3

- **OCCT 8.0.0** — 1,085 commits of improvements; 22-31% faster boolean operations
- **Emscripten 5.0.1** — LLVM 17, modern WASM features
- **Native WASM Exceptions** — `-fwasm-exceptions` replaces JS invoke trampolines; decodable end-to-end via `getExceptionMessage`
- **ESM-only distribution** — `"type": "module"`; default export is single-threaded `opencascade_full.{js,wasm,d.ts}`; multi-threaded `opencascade_full_multi.{js,wasm,d.ts}` ships under `ocjs/multi` and `/multi/wasm`
- **Full TypeScript bindings** — Doxygen-derived JSDoc rendered correctly in Monaco IntelliSense
- **Suffix-free overloads** — single symbol per class with val-based dispatcher, no more `_2`/`_3` subclasses (measured at ~264 ns/call, <0.011% of wall time on typical CAD models — see [BENCHMARKS.md](BENCHMARKS.md))
- **Reproducible builds** — `DEPS.json` pins every dependency to an exact commit; per-build `provenance.json` sidecar
- **Cached, incremental builds** — content-addressed compilation cache turns 10-30 minute clean builds into seconds on hit

See [CHANGELOG.md](CHANGELOG.md) for the full v3.0.0 entry. For empirical evidence of every measurable fork change (wall-clock CAD perf vs native C++, multi-threading speedup, embind dispatch cost, RBV overhead), see **[BENCHMARKS.md](BENCHMARKS.md)**.

## Documentation

- [BREAKING_CHANGES.md](BREAKING_CHANGES.md) — v3 consumer migration guide
- [CHANGELOG.md](CHANGELOG.md) — release notes
- **[BENCHMARKS.md](BENCHMARKS.md)** — empirical evidence hub: wall-clock CAD perf vs native C++, multi-threading speedup, embind dispatch cost, RBV overhead
- [MAINTAINER.md](MAINTAINER.md) — native build, env vars, customization for fork maintainers
- [docs/reference/yaml-schema.md](docs/reference/yaml-schema.md) — YAML schema (bindings, emccFlags, additionalCppCode, additionalCppFiles, additionalBindCode)
- [BUILD_SYSTEM.md](BUILD_SYSTEM.md) — `OCJS_*` env-var matrix and configuration authoring
- [docs/guides/custom-emcc-flags.md](docs/guides/custom-emcc-flags.md) — tuning size, speed, and build time
- [docs/guides/trim-symbols.md](docs/guides/trim-symbols.md) — trim from `full.yml` to a consumer-sized build
- [docs/guides/extend-with-cpp.md](docs/guides/extend-with-cpp.md) — add wrappers via `additionalCppCode` / `additionalCppFiles` / `additionalBindCode`
- [docs/guides/reproducible-ci.md](docs/guides/reproducible-ci.md) — pin-by-SHA, `provenance.json`, SBOM, lockfile discipline

## Projects Using opencascade.js

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

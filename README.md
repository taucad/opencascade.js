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
| **Build a custom WASM** (trim symbols, add C++, CI)        | [Quickstart (custom build)](#quickstart-custom-build)                                     |
| **See what changed in v3** (OCCT V8, ESM-only, exceptions) | [What's New in v3](#whats-new-in-v3) · [BREAKING_CHANGES.md](BREAKING_CHANGES.md)         |
| **Configure the build** (`defineBuild`, settings, variants) | [Config reference](https://opencascade-js.vercel.app/docs/toolchain/reference/config)     |
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

The package is ESM-only. The root export is an initialised instance (every
bound symbol is also a named value export); `libcascade/init` exposes
`createInstance` for consumers who need options or a named variant. The WASM
resolves automatically — use `locateFile` only when a bundler or deployment
relocates the binary, through the supported `libcascade/wasm` subpath and no
`dist/...` deep imports.

Build-time tools can consume the deterministic API-reference feed through
`libcascade/api-reference.json`. It includes the parsed class/member hierarchy, the
full source commit, build provenance, and exact input hashes; site-specific
routes and search indexes remain consumer-derived.

```ts
import oc from 'libcascade';

using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
const shape = box.Shape();
```

The root entry selects the variant this host supports and initialises it at
import time. Use `libcascade/init` when you need options or a specific variant:

```ts
// Vite / browser, with a relocated wasm asset
import { createInstance } from 'libcascade/init';
import wasmUrl from 'libcascade/wasm?url';

const oc = await createInstance({ locateFile: () => wasmUrl });
```

The published tarball ships `dist/opencascade_single.{wasm,js}` and `dist/opencascade_multi.{wasm,js}`, each with a `provenance.json` sidecar describing the exact toolchain and source commits used. Both variants share the assembled `types.d.ts`/`variant.d.ts` surface; their intermediate per-variant declarations are not published. The eager root selects the most capable variant the host supports; use `createInstance({ variant: 'single' | 'multi' })` to choose explicitly. npm releases are produced by GitHub OIDC Trusted Publishing and include Sigstore provenance; see the [maintainer release flow](MAINTAINER.md#ci-and-release-ownership).

### Multi-threaded build

For batch meshing, boolean grids, and STEP→glTF pipelines that benefit from OCCT's internal thread pool, request the pthread-enabled variant explicitly:

```ts
import { createInstance } from 'libcascade/init';

const oc = await createInstance({ variant: 'multi' });

// Run once after init — flip OCCT global parallel defaults.
oc.BOPAlgo_Options.SetParallelMode(true); // booleans fan out by default
oc.BRepMesh_IncrementalMesh.SetParallelDefault(true); // meshing fan out by default
```

`createInstance` owns the pthread plumbing (worker script self-reference, Node
path conversion, OCCT thread-pool sizing). Under Vite, set
`worker: { format: 'es' }` — Emscripten's workers are ES modules.

Browsers require `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every page that loads the threaded wasm. See the [multi-threaded build guide](https://opencascade-js.vercel.app/docs/package/guides/multi-threading) for activation, benchmarks, and when not to ship threaded; [toolchain custom-build](https://opencascade-js.vercel.app/docs/toolchain/guides/multi-threading) covers the config recipe for trimmed MT variants.

## Quickstart (custom build)

Need a trimmed binary, your own C++ wrappers, or different Emscripten settings?
`@libcascade/toolchain` is the dev-time package for that. It drives the
published Docker images for you — digest-pinned, with the platform edges
handled — so there is no `docker run` string to maintain.

```bash
npm install --save-dev @libcascade/toolchain
```

```ts
// libcascade.config.ts
import { defineBuild } from '@libcascade/toolchain';

export default defineBuild({
  name: 'myapp',
  bindings: ['BRepPrimAPI_MakeBox', 'TopoDS_Shape', 'gp_Pnt'],
  settings: { MODULARIZE: true, EXPORT_ES6: true, ALLOW_MEMORY_GROWTH: true },
  compilerFlags: { optimize: 'O3', simd: true, exceptions: 'wasm', noEntry: true },
  variants: [{ name: 'single' }],
});
```

```bash
npx libcascade build       # link each variant through the pinned image → dist/
npx libcascade assemble    # shared types.d.ts + ./init entry + exports map
npx libcascade check src   # CI drift guard: referenced symbols ⊆ bound symbols
```

Symbol names and `-s` settings are compile-checked against unions generated
from the pinned image, so a typo is a TypeScript error rather than a runtime
`BindingError`. See the [toolchain quickstart](https://opencascade-js.vercel.app/docs/toolchain/getting-started/quick-start),
the [config reference](https://opencascade-js.vercel.app/docs/toolchain/reference/config),
and the [migration guide](https://opencascade-js.vercel.app/docs/toolchain/getting-started/migrate-from-yaml)
if you have an existing yml build.

Images are published to [ghcr.io/taucad/opencascade.js](https://github.com/taucad/opencascade.js/pkgs/container/opencascade.js)
as multi-arch manifest lists (`linux/amd64` + `linux/arm64`); Apple Silicon
runs natively. Building the image itself, or driving it directly, is covered in
[MAINTAINER.md](MAINTAINER.md#docker-end-to-end-validation).

## Tags

| Tag                                           | What it points at                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `:single-threaded`                            | Latest release, single-threaded warm cache (default for browser CAD UIs)           |
| `:multi-threaded`                             | Latest release, multi-threaded warm cache (requires COOP/COEP)                     |
| `:bindgen-base`                               | Latest release, post-PCH/generate but pre-compile (custom-bindings starting point) |
| `:<version>-<stage>`                          | Pinned release for `single-threaded`, `multi-threaded`, or `bindgen-base`           |
| `:3.0.0-canary.<sha8>-<stage>`                | Immutable maintainer-dispatched canary, retained for seven days                    |
| `:branch-main[-<full-sha>]`                   | Current or immutable `main`, single-threaded                                       |
| `:multi-threaded-branch-main[-<full-sha>]`    | Current or immutable `main`, multi-threaded                                        |
| `:bindgen-base-branch-main[-<full-sha>]`      | Current or immutable `main`, bindgen-base                                          |

Docker resolves the right architecture from every published manifest list automatically — no `--platform` flag is needed on either `linux/amd64` or `linux/arm64` hosts.

## What's New in v3

- **OCCT 8.0.1** — 1,085+ commits of improvements; 22-31% faster boolean operations
- **Emscripten 6.0.5** — LLVM 24, modern WASM features
- **Native WASM Exceptions** — `-fwasm-exceptions` replaces JS invoke trampolines; decodable end-to-end via `oc.getExceptionMessage`
- **ESM-only distribution** — `"type": "module"`; the eager root selects a supported variant, while `libcascade/init` selects explicitly; raw single- and multi-threaded glue remains available under `libcascade/single` and `libcascade/multi`
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
- [Config reference](https://opencascade-js.vercel.app/docs/toolchain/reference/config) — every `defineBuild` field and the generated type unions
- [CLI reference](https://opencascade-js.vercel.app/docs/toolchain/reference/cli) — `build`, `assemble`, `detect`, `check`
- [BUILD_SYSTEM.md](BUILD_SYSTEM.md) — `OCJS_*` env-var matrix and configuration authoring
- [Emscripten settings and flags](https://opencascade-js.vercel.app/docs/toolchain/guides/custom-emcc-flags) — tuning size, speed, and build time
- [Trim symbols](https://opencascade-js.vercel.app/docs/toolchain/guides/trim-symbols) — cut the binding set to a consumer-sized build
- [Extend with C++](https://opencascade-js.vercel.app/docs/toolchain/guides/extend-with-cpp) — `customBindings` scopes
- [Reproducible CI](https://opencascade-js.vercel.app/docs/toolchain/guides/reproducible-ci) — digest pinning, provenance, SBOM, lockfile discipline

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

---
ocjs: major
---

v3 is a ground-up modernisation: OCCT V8 (GA), native WebAssembly exceptions, ES modules, full TypeScript bindings with idiomatic JSDoc, content-addressed build caching, and reproducible builds via pinned dependency commits.

**Full v2 → v3 migration guide:** [BREAKING_CHANGES.md](BREAKING_CHANGES.md) — every consumer-visible change with Before / After code samples and migration steps.

### Highlights

- **OCCT V8.0.1** (GA, up from V7.6.2) and **Emscripten 6.0.5** (up from 3.1.14).
- **libclang 18.1.1** for the bindgen parser (up from `15.0.6.1`), paired with vendored **LLVM 17.0.6** libc++ + clang resource headers to satisfy the LLVM project's libc++/clang N-1 compat-window policy. This is what makes the v3 bindings _accurate_ for OCCT V8 — libclang 18 exposes `templateTypedefs`, sees through `DEFINE_STANDARD_HANDLE` expansions, and resolves `NCollection_*` template instantiations that v2's libclang 15 either skipped, mislabelled as `UNEXPOSED`, or surfaced as duplicate registrations. The parse environment is hermetic: `src/ocjs_bindgen/config/paths.py` routes libclang at the vendored libc++ headers and clang resource directory, not at the host system's clang.
- **Native WebAssembly exceptions** (`-fwasm-exceptions`) replace JS `invoke_*` trampolines: ~12% gzipped size overhead vs. the prior ~80%, with zero happy-path performance cost. `WebAssembly.Exception` is decodable end-to-end through instance helpers such as `oc.getExceptionMessage` — see [§C](BREAKING_CHANGES.md#section-c--webassembly-exception-handling).
- **Performance vs. V7.6.2**: 22-31% faster boolean operations, 16-19% faster fillets, 23-29% faster complex models. Full numbers in [Appendix G](BREAKING_CHANGES.md#appendix-g--performance--size).
- **ES module distribution** — `"type": "module"`, one runtime export (the default `init` function), type-only named exports, and a single `opencascade_full.{js,wasm,d.ts}` triple replacing v2's facade module. Zero-configuration initialization resolves the adjacent WASM; `libcascade/wasm` is the supported relocation subpath for bundlers — see [§A](BREAKING_CHANGES.md#section-a--module-loading).
- **Suffix-free overload symbols** — a single `gp_Pnt`, `BRepPrimAPI_MakeBox`, `BRepBuilderAPI_MakeEdge`, etc., with a value-based dispatcher that picks the right C++ overload from your argument types. The `_N`-suffixed overload subclasses are gone except for genuinely ambiguous same-arity cases. Same-arity dispatch is now unified across `class_function` + instance overload sets, fixing v2's silently-clobbered registrations. See [§B1](BREAKING_CHANGES.md#b1--suffix-free-overloads) and [§D7](BREAKING_CHANGES.md#d7--same-arity-overload-dispatch-unified-legacy-intsize_t-pairs-deduplicated). Dispatcher cost measured at ~264 ns/call (~5 µs per typical CAD render, 0.003–0.011% of wall time) — see [BENCHMARKS.md §3](BENCHMARKS.md#3--embind-overload-dispatch).
- **Output-parameter return shape redesigned** — methods with class output parameters (`gp_Pnt&`, `Bnd_Box&`, `GProp_GProps&`, …) mutate the caller's instance in place and read directly from it (no envelope mirroring). Methods with primitive / enum / elided-Handle outputs return a structured envelope; v2's `{ current: 0 }` placeholders are gone. See [§B2](BREAKING_CHANGES.md#b2--output-parameter-return-shape-class-outputs-mutate-in-place-envelopes-only-when-js-truly-needs-them).
- **Non-const `Handle<T>&` output positions elided** from the JS signature — callers no longer allocate `new oc.Handle_<T>()` placeholders for output-only Handle slots. Drop the position from the call entirely and read the freshly-assigned Handle from the envelope. ~2.29× wall-clock speedup on affected call sites. See [§B3](BREAKING_CHANGES.md#b3--non-const-handlet-output-positions-elided-from-the-js-signature).
- **`TopoDS` namespace bridge** — `oc.TopoDS.Edge(shape)`, `oc.TopoDS.Face(shape)`, etc., replacing v2's mix of `prototype.Edge`, `_TopoDS_Edge`, manual `getPointer` patterns. See [§D1](BREAKING_CHANGES.md#d1--topods-namespace-bridge).
- **Baseline WebAssembly SIMD** (`-msimd128`) on by default. Relaxed-SIMD ops (`-mrelaxed-simd`) are gated behind `OCJS_RELAXED_SIMD=1` because Safari 26.x cannot parse them.
- **`-sWASM_BIGINT`** on by default — eliminates the Emscripten i64 legalisation pass.
- **Full TypeScript bindings** with Doxygen-derived JSDoc rendered correctly in Monaco IntelliSense, fixed-width primitive types (`int8_t`, `uint32_t`, `int64_t`) mapped to TS scalars, sized-tuple emission for C array parameters, and string enums.
- **File-backed custom build inputs** — `additionalCppFiles` drives generated bindings and per-build `additionalBindFiles` drives raw Embind. Ordered paths and SHA-256 digests are recorded in build manifests and provenance.
- **`Symbol.dispose` lifecycle** on every disposable binding — explicit resource management is wired in for both class wrappers and envelope returns that own Handle resources. The disposer is idempotent and alias-safe.
- **Reproducible builds** via `DEPS.json` (every external dependency — OCCT, rapidjson, freetype, Emscripten, LLVM 17 — pinned to an exact commit hash) plus a `provenance.json` sidecar shipped alongside every release artefact.
- **Cached, incremental builds** through Nx with content-addressed inputs — 10-30 minute clean builds become seconds on a hit.

### Breaking changes

Each entry deep-links into [BREAKING_CHANGES.md](BREAKING_CHANGES.md) for Before / After code samples and migration steps.

- **[A — Module loading](BREAKING_CHANGES.md#section-a--module-loading)** — `dist/` ships a single triple (no facade); ESM-only with zero-configuration initialization; use the `libcascade/wasm` subpath only when a bundler relocates the asset (no `dist/*` deep-imports).
- **[B — JS / TS API surface](BREAKING_CHANGES.md#section-b--js--ts-api-surface-changes)** — `_N`-suffixed overload subclasses collapsed to single symbols; output-parameter return shape redesigned (class outputs mutate in place, primitives / enums / elided Handles ride a structured envelope); non-const `Handle<T>&` output positions elided from the JS signature; envelope native-return field is `envelope.returnValue` (reserved to avoid collision with OCCT parameters named `result`).
- **[C — WebAssembly exception handling](BREAKING_CHANGES.md#section-c--webassembly-exception-handling)** — caught exceptions are `WebAssembly.Exception` instances; decode via `oc.getExceptionMessage`.
- **[D — OCCT V8 API](BREAKING_CHANGES.md#section-d--occt-v8-api-breaking-changes)** — `TopoDS` namespace bridge replaces direct namespace binding; `Bnd_Box::Get` removed (use `CornerMin` / `CornerMax`); `Poly_Triangulation` normals API now value-returning; `BRepMesh_IncrementalMesh` constructor signature; `TopoDS_Shape::HashCode` removed with no shipped replacement; same-arity overload dispatch unified across static + instance variants; JS-indistinguishable `int`/`size_t` NCollection pairs collapsed at codegen time (V8's `size_t` migration).
- **[E — Removed symbol families](BREAKING_CHANGES.md#section-e--removed-symbol-families)** — `OpenGl_*` / `Aspect_Window` / rest of `TKOpenGl` (headless target); `TopOpe*` (use `BOPAlgo_*` / `BRepAlgoAPI_*`); legacy `Standard_Transient`-based collections (use auto-discovered `NCollection_*`); `GCE2d_*` aliases (use `GC_*2d`).
- **[F — Build flag changes](BREAKING_CHANGES.md#section-f--build-flag-changes)** — source-build CLI replaced (`src/buildFromYaml.py` → `build-wasm.sh` with explicit subcommands and an optional `--config <name>` selecting an optimisation profile from `configurations.json`); reference `full.yml` bundled inside the Docker image as the starting point for custom builds; native WebAssembly exceptions on by default; Emscripten flag renames and additions from the 3.x → 6.x toolchain upgrade.

### Build system

- **Native WASM exceptions as the baseline link mode** — replaces `-fexceptions` JS `invoke_*` trampolines with `-fwasm-exceptions`, cutting exception-build size overhead from ~80% to ~12% gzipped.
- **`build-wasm.sh` unified entry point** (Docker `ENTRYPOINT` + host CLI parity) — explicit subcommands (`full`, `link`, `validate`, `generate`, `bindings`, `sources`, `pch`), `--help`, optional `--config <name>` from `configurations.json`, and build-summary output.
- **Named compile configurations** in `configurations.json` — `single-threaded` (production default), `single-threaded-smallest` (size-tuned `-Os`), `multi-threaded` (SAB threading), `multi-threaded-browser` (resizable-buffer browsers), and `debug`. Link-only BigInt and eval-ctors settings live in each YAML's `emccFlags`.
- **Reference `full.yml` bundled inside the Docker image** at `/opencascade.js/build-configs/full.yml` — the complete symbol list the published tarball builds from. Extract it as a starting point using the [trim-symbols guide](https://opencascade-js.vercel.app/docs/toolchain/guides/trim-symbols).
- **`DEPS.json` dependency pinning** — every external dependency (OCCT, rapidjson, freetype, Emscripten, LLVM 17) is pinned to an exact commit hash with version metadata. `clone-deps.sh` automates setup.
- **Hermetic libclang parse environment** — `src/ocjs_bindgen/config/paths.py` is now the single source of truth for include resolution during the bindgen discover pass. It points libclang at the vendored LLVM 17 libc++ headers + clang resource directory (matching libclang 18's expectations under the N-1 policy) and at the OCCT flat-include symlink farm, so source generation is reproducible across hosts and immune to whatever system clang the developer happens to have. The same parse contract is validated on `darwin-arm64`, `linux-x86_64`, and `linux-aarch64` with `uv`-managed Python 3.14.4; native final-link bytes may differ by host toolchain.
- **Build provenance** — every build emits a `provenance.json` sidecar capturing toolchain versions, source commits, compile / link flags, cache key, and output sizes. Shipped alongside the WASM in the published tarball.
- **Nx-based caching** — the full pipeline (`apply-patches` → `pch` → `generate-bindings` → `compile-bindings` → `compile-sources` → `link` → `validate` → `provenance`) is wired through Nx with content-addressed inputs (including git-ignored files), so partial rebuilds are surgical. Clean full build ≈ 30 minutes; cache hits skip compilation entirely. Stale `.o` files compiled with one set of flags are invalidated when the flags change.
- **Validation harness** (`build-wasm.sh validate <yaml>`) — post-build checks that every requested symbol has a compiled `.o`, the `.wasm` exists at a reasonable size, and Emscripten EH helpers are present in the linked JS glue when requested.
- **Configurable optimisation** — `wasm-opt` runs at `-O4` for production configs and `-O3` for size-tuned; `--traps-never-happen` is enabled; `OCJS_EXTRA_CFLAGS` passes arbitrary flags through to `emcc`.
- **Updated Dockerfile** to `emscripten/emsdk:6.0.5` with pinned digest, dependencies cloned at exact commits from `DEPS.json`, entrypoint via `build-wasm.sh` with env-var passthrough; a Docker E2E validation script is included.

### Tests

- **Comprehensive smoke suite** under [`tests/smoke/`](tests/smoke/) — primitives, smart pointers, topology, transforms, wire/face building, fillets/chamfers, sweep/loft, OBJ I/O, XCAF, intersections, output params, enum dispatch, BRep tool overloads, embind machinery, missing-OCCT-modules detection, suffix-free overload resolution, Handle-output elision, exception decode, `Symbol.dispose` disposal, and modern `NCollection` bindings.
- **Type-only tests** (`tests/types.test-d.ts`, `enum-dispatch.test-d.ts`, `enums.test-d.ts`, `namespaces.test-d.ts`, `output-params.test-d.ts`, `disposable-containers.test-d.ts`) — lock the published `.d.ts` shape against regression.
- **Bindgen output-shape regression** (`tests/bindgen-output-shape.test.ts`) — asserts the codegen never emits envelope fields that mirror concrete class outputs and that class outputs always forward via `*val::as<T*>(allow_raw_pointers())`.
- **Semantic-diagnostic and `dts-validation` harnesses** — type-check the codegen output end-to-end and track the `any` count in the generated `.d.ts` to prevent silent type-resolution regressions.

### Documentation

- New [BREAKING_CHANGES.md](BREAKING_CHANGES.md) — single comprehensive v2 → v3 consumer migration guide with Before / After code samples for every breaking change.
- Rewritten [README.md](README.md) with quick start, Docker workflow, environment-variable reference, and customisation pointers.
- [BUILD_SYSTEM.md](BUILD_SYSTEM.md) — full `OCJS_*` env-var matrix, configuration authoring guide, and the v2 → v3 build-system migration table.
- [Custom emcc flags](https://opencascade-js.vercel.app/docs/toolchain/guides/custom-emcc-flags) — size vs. speed, LTO, defines, and `wasm-opt`.
- [YAML schema](https://opencascade-js.vercel.app/docs/toolchain/reference/yaml-schema) — build configuration and customisation reference.

### Source pinning (this release)

Full commit hashes live in [DEPS.json](DEPS.json).

- OCCT `V8_0_1` (GA, commit `b8f597c6`)
- rapidjson post-1.1.0 (commit `24b5e7a8`)
- freetype `VER-2-13-0` (commit `de8b92dd`)
- Emscripten `6.0.5` (LLVM 24; digest `sha256:76a44fff…`)
- libclang `18.1.1` (Python binding, pinned in `pyproject.toml` and `uv.lock`; up from v2's `15.0.6.1`)
- LLVM `17.0.6` (vendored prebuilt — parse-side libc++ + clang resource headers; N-1 compat with libclang 18.1.1)

# Maintainer Guide

Build-from-source, configuration, and release workflow for OpenCascade.js. Consumers reaching for the `cascadic` npm package should start from [README.md](README.md) — this document is for maintainers and contributors building OCCT WASM locally.

## Table of Contents

- [Quick Start (Native Build)](#quick-start-native-build)
- [Build Configuration](#build-configuration)
  - [YAML Configs](#yaml-configs)
  - [Configurations](#configurations)
  - [Environment Variables](#environment-variables)
- [CI and Release Ownership](#ci-and-release-ownership)
  - [Publication Channels](#publication-channels)
  - [npm Trusted Publishing](#npm-trusted-publishing)
  - [Cutting a Release](#cutting-a-release)
- [Customizing Your Build](#customizing-your-build)
- [Build Commands](#build-commands)
- [Docker End-to-End Validation](#docker-end-to-end-validation)
- [Additional Documentation](#additional-documentation)

## Quick Start (Native Build)

Prerequisites: Git, [uv](https://docs.astral.sh/uv/), and a C++ toolchain. `uv` installs the pinned Python 3.14 environment.

```bash
# 1. Clone opencascade.js
git clone https://github.com/taucad/opencascade.js.git
cd opencascade.js

# 2. Clone every dependency at its DEPS.json pin and sync uv.lock
./scripts/clone-deps.sh --dest deps
source deps/emsdk/emsdk_env.sh

# 3. Install locked JavaScript tools
npm ci

# 4. Build WASM (use nohup — full builds take 10-30+ min)
nohup env OCJS_LTO=0 ./build-wasm.sh full build-configs/full.yml > build.log 2>&1 &
tail -f build.log
```

> **Tip:** Full builds take 10-30+ minutes (longer with cold caches). Using `nohup` ensures the build continues if your terminal session disconnects. For link-only rebuilds (~1-2 min), `nohup` is optional.

Output files appear alongside the YAML config: `opencascade_full.wasm`, `opencascade_full.js`, `opencascade_full.d.ts`.

## Build Configuration

### YAML Configs

YAML configs define which OCCT classes are bound to JavaScript:

- `build-configs/full.yml` — all symbols, single-threaded, native WASM exceptions on by default with `getExceptionMessage` runtime helpers

See [docs/reference/yaml-schema.md](docs/reference/yaml-schema.md) for the full YAML schema, including `additionalCppCode`, `additionalCppFiles`, and `mainBuild.additionalBindCode`.

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

| Artifact prefix            | Config                              | Subpath export                                                       |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `opencascade_full.*`       | `single-threaded` + `full.yml`      | `cascadic` / `cascadic/wasm`             |
| `opencascade_full_multi.*` | `multi-threaded` + `full_multi.yml` | `cascadic/multi` / `cascadic/multi/wasm` |

Each six-file set includes a matching `*.provenance.json` sidecar (`dist/opencascade_full.provenance.json` and `dist/opencascade_full_multi.provenance.json`).

### Environment Variables

Two layers of "default" matter here. The **bare default** is what `build-wasm.sh` falls back to if you set neither an env var nor a `--config`. The **shipped `full.yml` build** is what the published `cascadic` tarball was actually linked with — the YAML config carries its own `emccFlags` (`-sWASM_BIGINT`, `-sEVAL_CTORS=2`, `-msimd128`) that win regardless of env var, and every named entry in [`build-configs/configurations.json`](build-configs/configurations.json) sets the corresponding `OCJS_*` envs to match.

| Variable            | Bare default      | Shipped `full.yml` build | Description                                                                                                          |
| ------------------- | ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `OCJS_OPT`          | `-O2`             | `-O3`                    | Compile optimization level                                                                                           |
| `OCJS_LTO`          | `1`               | `0`                      | LTO at compile time. Empirically harmful for OCCT — see [custom emcc flags guide](docs/guides/custom-emcc-flags.md). |
| `OCJS_EXCEPTIONS`   | `0`               | `1`                      | Native WASM exceptions. Shipped build forces this on for decodable C++ exceptions.                                   |
| `OCJS_SIMD`         | `0`               | `1`                      | Baseline WASM SIMD (`-msimd128`). Universally supported.                                                             |
| `OCJS_RELAXED_SIMD` | `0`               | `0`                      | Relaxed SIMD ops on top of `OCJS_SIMD`. Safari 26.x cannot parse these — leave off for cross-browser builds.         |
| `OCJS_BIGINT`       | `0`               | `1`                      | `-sWASM_BIGINT` for native i64↔BigInt; eliminates the i64 legalization pass.                                         |
| `OCJS_EVAL_CTORS`   | `false`           | `true`                   | `-sEVAL_CTORS=N` static-init evaluation at compile time.                                                             |
| `OCJS_EXTRA_CFLAGS` | _(empty)_         | _(empty)_                | Extra compile flags appended to C/CXX (e.g. `"-mllvm -inline-threshold=128"`).                                       |
| `OCJS_DEFINES`      | _(empty)_         | `OCCT_NO_DUMP`           | Comma-separated list of `-D` macros.                                                                                 |
| `OCJS_UNDEFINES`    | _(empty)_         | `OCC_CONVERT_SIGNALS`    | Comma-separated list of `-U` undefines.                                                                              |
| `THREADING`         | `single-threaded` | `single-threaded`        | Threading mode (`single-threaded` or `multi-threaded`).                                                              |

The bare-default column is only relevant if you invoke `build-wasm.sh` without `--config` _and_ without `OCJS_CONFIG` — the script's own fallback selects the `single-threaded` configuration when both are unset, so in practice you always get the rightmost column unless you go out of your way to disable it.

## CI and Release Ownership

| Responsibility | Owner |
| --- | --- |
| Source, workflow, shell, Python, ST/MT, bindgen, browser, package, template, docs, and prose checks | `.github/workflows/docker.yml` → `CI gate` |
| Branch and release GHCR images, SBOM/provenance, signing, npm publication, registry verification, annotated tags, and GitHub Releases | `.github/workflows/docker.yml` |
| Vercel preview and production deployment from the exact tested package candidate | `.github/workflows/docker.yml` after `CI gate` |
| GHCR branch/cache expiry without deleting releases or referrers | `.github/workflows/ghcr-retention.yml` |
| Fast-forward-only `main` mirror for the historical upstream PR | `.github/workflows/mirror-upstream-pr-head.yml` |
| Dependency and pinned-action updates | `.github/dependabot.yml` |

`CI gate` is the required aggregate. Vercel's Git integration is disabled in
`docs-site/vercel.json`; it must not create an independent build from a source
push. The long candidate workflow is the sole deployment owner because the
site consumes `api-reference.json` generated from the built WASM/declaration
artifacts. Production deployment rechecks the remote `main` SHA immediately
before promotion, so a completed older run cannot overwrite a newer main.

The workflow builds every Docker stage natively on amd64 and arm64 for
`main` pushes and explicitly dispatched canaries. Pull requests validate the
three stages on amd64 without publishing. Each final image passes the same
runtime contract on its native host.
Native toolchains may produce different bytes, so the tested amd64 ST/MT
outputs are the canonical npm inputs while both tested image digests are
required for GHCR promotion. The workflow packs those outputs plus the
deterministic API-reference feed into one immutable tarball. The same tarball
then drives installed-package, browser, starter-template, docs, publication,
registry, and Vercel jobs. Pull-request runs cancel superseded attempts;
publishing runs queue and are never canceled.

### Publication Channels

| Event | npm | GHCR | Vercel |
| --- | --- | --- | --- |
| Pull request targeting `main` | none | validation only | same-repository PR preview after `CI gate` |
| Feature-branch push without a PR | no workflow | no workflow | no workflow |
| Manual branch dispatch | `X.Y.Z-canary.<sha8>` under `canary` | signed `canary-<sha8>-<stage>` manifests | none |
| Ordinary `main` push | none | signed `main`/full-SHA manifests | production from the exact candidate |
| Merged `chore(release): ocjs vX.Y.Z-beta.N` | exact version under `beta` | signed version manifests | production from the exact candidate |
| Merged `chore(release): ocjs vX.Y.Z` | exact version under `latest` | signed version manifests and moving stable aliases | production from the exact candidate |

Canary identities use only the planned stable core and the source SHA. They
contain no date, are immutable across retries, and are not Git tags or GitHub
Releases. `canary`, `beta`, and `latest` are mutable discovery tags; lock or
deploy exact versions.

### npm Trusted Publishing

Configure the `cascadic` npm package once under **Settings → Trusted publishing**:

- provider: GitHub Actions
- organization/user: `taucad`
- repository: `opencascade.js`
- workflow filename: `docker.yml`
- environment: leave empty because manual canaries and releases share the
  repository workflow

Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN`. The publish job uses Node 24,
npm 11.5.1, `id-token: write`, and no source checkout. The maintainer performs
the one-time namespace bootstrap manually; after Trusted Publishing succeeds,
routine local publication is forbidden. Verify npm provenance, enable the
package setting that requires two-factor authentication and disallows tokens,
and revoke obsolete automation tokens.

There are two complementary provenance layers:

- `dist/*.provenance.json` records the OCJS/OCCT/toolchain recipe embedded beside each WASM file.
- npm/Sigstore provenance cryptographically ties the published tarball to `taucad/opencascade.js`, `.github/workflows/docker.yml`, and the full source commit.

The registry gate requires both layers to agree, verifies tarball integrity
and signatures, installs the exact published version, boots ST and MT, and
verifies all three promoted GHCR signatures. If the exact npm version already
exists, the publish job compares the registry tarball with the candidate. It
succeeds only for identical bytes and provenance; changed bytes under an
existing version fail without moving tags or creating a release.

### Cutting a Release

Contributors add `.nx/version-plans/*.md` files to package-affecting pull
requests. Pull requests and ordinary `main` builds do not change the checked
version; an explicit manual dispatch applies a canary version only in its
disposable candidate workspace.

Publish a canary from a branch only when an external consumer needs it:

```bash
gh workflow run docker.yml --repo taucad/opencascade.js --ref <branch>
```

The run summary reports the exact `npm install` command and immutable
single-threaded, multi-threaded, and bindgen-base GHCR pull commands. It does
not deploy Vercel.

Use the project skill to inspect or prepare a release:

```bash
/release-ocjs status
/release-ocjs prepare 3.0.0-beta.1
/release-ocjs submit 3.0.0
```

The underlying non-publishing helper is also available directly:

```bash
npm run release:prepare -- 3.0.0-beta.1 --dry-run
npm run release:prepare -- 3.0.0 --dry-run
```

A beta release validates the requested numeric `beta.N` against the stable
version implied by the pending Version Plans. A stable release must exactly
match the planned SemVer. Both generate their changelog entry and consume the
included plans. The resulting PR may contain only `package.json`,
`package-lock.json`, `CHANGELOG.md`, and deleted Version Plan files. Its single
commit subject is exactly `chore(release): ocjs v<version>`.

After that PR is merged, CI publishes and verifies the exact candidate, then
creates/verifies the annotated `v<version>` tag and GitHub Release. No release
PR comments are required: the CI summary, npm provenance, annotated tag, and
GitHub Release are the durable record. Never create the tag before registry
verification.

### Local documentation from CI artifacts

`docs-site/data/` is ignored and always derived from the package-owned
`cascadic/api-reference.json`. A local source build can generate the feed with
`npx nx run ocjs:api-reference` after producing the required ST artifacts.
Alternatively, download a tested `candidate.tgz` from a workflow run and build
entirely offline from it:

```bash
gh run download <run-id> --name npm-candidate-<run-id> --dir ./tmp-candidate
OCJS_API_REFERENCE_SOURCE=../tmp-candidate/candidate.tgz \
  pnpm --dir docs-site build
```

The sync is byte-idempotent for an unchanged feed and atomically replaces all
derived shards, so removed symbols cannot survive as stale checked data.

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
./build-wasm.sh --help             # Full usage information
```

## Docker End-to-End Validation

`scripts/docker-e2e-validate.sh` is the canonical local and CI image gate. It performs one bounded consumer link, requires exactly six outputs, validates structural provenance, and runs a JS smoke. `final-single` additionally retains the link-filter trim gate; `bindgen-base` regenerates, compiles, links, and runs the minimal `tests/docker/fixtures/simple.yml` build.

Build and test the default local single-threaded image through Nx:

```bash
npm exec nx -- run ocjs:docker-e2e
```

To validate existing images directly, pass the stage, matching YAML, platform, and source identity explicitly:

```bash
OCJS_E2E_IMAGE=ghcr.io/taucad/opencascade.js:canary-<sha8>-single-threaded \
OCJS_E2E_STAGE=final-single \
OCJS_E2E_BUILD_CONFIG=build-configs/full.yml \
OCJS_DOCKER_PLATFORM=linux/amd64 \
OCJS_EXPECTED_SHA=<full-commit-sha> \
SOURCE_DATE_EPOCH=<commit-epoch> \
./scripts/docker-e2e-validate.sh

OCJS_E2E_IMAGE=ghcr.io/taucad/opencascade.js:canary-<sha8>-multi-threaded \
OCJS_E2E_STAGE=final-multi \
OCJS_E2E_BUILD_CONFIG=build-configs/full_multi.yml \
OCJS_DOCKER_PLATFORM=linux/arm64 \
OCJS_EXPECTED_SHA=<full-commit-sha> \
SOURCE_DATE_EPOCH=<commit-epoch> \
./scripts/docker-e2e-validate.sh

OCJS_E2E_IMAGE=ghcr.io/taucad/opencascade.js:canary-<sha8>-bindgen-base \
OCJS_E2E_STAGE=bindgen-base \
OCJS_DOCKER_PLATFORM=linux/amd64 \
OCJS_EXPECTED_SHA=<full-commit-sha> \
SOURCE_DATE_EPOCH=<commit-epoch> \
./scripts/docker-e2e-validate.sh
```

The single `LINK_BUDGET_S` environment variable controls the full consumer-link ceiling. Timing remains in logs; distributable provenance and build-manifest sidecars contain reproducible build facts only.

The weekly/manual `reproducibility.yml` workflow builds two isolated
Linux/amd64 `final-single` images in parallel with cold caches, runs the
runtime smoke against both, and compares their exact artifact ledgers. Stable
publication calls the same workflow for the release commit and cannot publish
until it passes. Each cold job uses GitHub's native four-hour job timeout.

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

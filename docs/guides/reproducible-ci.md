# Reproducible builds in CI

Reproducibility for an OCCT WASM build means: given the same source revision, pinned image digest, and build configuration, the resulting bytes can be identified and verified. Native amd64 and arm64 images use different host toolchains and are validated for the same observable build/runtime contract; they are not expected to emit byte-identical WASM. The fork emits three artifacts that, together, let you assert the identity of a selected build in CI without trusting any single party:

- A multi-arch GHCR image (`ghcr.io/taucad/opencascade.js:<tag>`) built from a pinned `Dockerfile`
- A `provenance.json` sidecar (per WASM build) that records the exact toolchain and source commits used
- An SBOM extractable from the image manifest

This guide walks each layer and shows the discipline downstream consumers should adopt.

## Repository reproducibility gate

The repository's weekly/manual `reproducibility.yml` workflow builds
`final-single` twice in isolated `linux/amd64` jobs with BuildKit caches
disabled. Both jobs run the runtime smoke and emit a complete artifact ledger;
the comparison job requires every path, size, and SHA-256 digest to match.
Stable publication calls this same workflow for the release commit before npm
publication. Each cold runner uses GitHub's native four-hour job timeout.

Ordinary push and pull-request builds keep Nx and BuildKit caching enabled.
Native ARM candidates prove the same public and runtime behavior, but byte
equality is intentionally limited to the same architecture and toolchain.

## Layer 1: Pin the image by SHA

The `:beta` tag floats — every release advances it. For reproducible CI, pin to the image manifest digest:

```bash
# Find the digest:
docker buildx imagetools inspect ghcr.io/taucad/opencascade.js:beta

# Pin in your CI:
docker pull ghcr.io/taucad/opencascade.js@sha256:<digest>
```

`docker buildx imagetools` returns a manifest-list digest that resolves to the per-architecture image automatically. Pinning by digest beats pinning by tag for three reasons:

1. The digest cannot be re-pointed without the registry's signing key
2. The manifest list contains both `linux/amd64` and `linux/arm64` — the same digest works on every CI runner
3. The digest is the unit of truth for `provenance.json` lookups (see Layer 2)

Recommended cadence: re-pin once per release cycle, never inside the cycle.

## Layer 2: Verify `provenance.json`

Every WASM build (whether published via the tarball or extracted from a GHCR run) ships with a `provenance.json` sidecar next to the `.wasm`. The contents:

```jsonc
{
  "version": "3.0.0-beta.<sha>",
  "build_timestamp": "2026-…",
  "toolchain": {
    "emsdk": "5.0.1",
    "emcc": "5.0.1 (commit-…)",
    "llvm": "17.0.0",
    "node": "22.…"
  },
  "occt": {
    "commit": "<full SHA>",
    "version_tag": "V8_0_0"
  },
  "build_config": {
    "yaml": "build-configs/full.yml",
    "configuration": "default",
    "emccFlags": [ "-O3", "-msimd128", "-sWASM_BIGINT", "-sEVAL_CTORS=2", … ]
  },
  "outputs": {
    "wasm": { "path": "opencascade_full.wasm", "size": …, "sha256": "…" },
    "js":   { "path": "opencascade_full.js",   "size": …, "sha256": "…" },
    "dts":  { "path": "opencascade_full.d.ts", "size": …, "sha256": "…" }
  }
}
```

Recommended CI assertion (Node):

```js
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';

const prov = JSON.parse(await fs.readFile('opencascade_full.provenance.json', 'utf8'));
const wasm = await fs.readFile('opencascade_full.wasm');
const sha = crypto.createHash('sha256').update(wasm).digest('hex');

if (sha !== prov.outputs.wasm.sha256) {
  throw new Error(`opencascade_full.wasm hash mismatch: provenance=${prov.outputs.wasm.sha256} actual=${sha}`);
}
if (prov.toolchain.emsdk !== '5.0.1' || prov.occt.version_tag !== 'V8_0_0') {
  throw new Error('opencascade_full.wasm built with an unexpected toolchain');
}
```

A green check guarantees that the WASM you are about to ship matches the toolchain advertised in `provenance.json` — not the tarball's claim, not the registry's claim, but the actual bytes on disk.

## Layer 3: Extract the SBOM

GHCR exposes a Software Bill of Materials for every image build. To pull it:

```bash
# Manifest digest:
DIGEST=$(docker buildx imagetools inspect ghcr.io/taucad/opencascade.js:beta --raw \
  | jq -r '.manifests[] | select(.platform.os == "linux" and .platform.architecture == "amd64").digest')

# SBOM (in-toto + SPDX):
gh attestation verify \
  oci://ghcr.io/taucad/opencascade.js@$DIGEST \
  --repo taucad/opencascade.js

# Or via cosign:
cosign download sbom ghcr.io/taucad/opencascade.js@$DIGEST > sbom.json
```

The SBOM lists every apt package, every cloned dependency, and the resolved `DEPS.json` commits used during the build. For audit purposes this is the canonical inventory of what is inside the image.

## Layer 4: Lockfile / DEPS.json discipline (downstream)

A reproducible upstream is necessary but not sufficient. Downstream consumers need to lock the rest of the dependency graph:

- **`pnpm-lock.yaml` / `package-lock.json`** committed alongside `package.json`; `pnpm install --frozen-lockfile` (or `npm ci`) in CI
- **`DEPS.json`** (if your project also wraps OCCT or another WASM dependency) checked into the repo with the exact upstream commits used to produce the binary
- **Cosign signatures** on any image you publish on top of `opencascade.js`, so downstream consumers of *your* image can apply the same digest-pinning workflow

A typical consumer Dockerfile that wants to reproduce a Tau-style WASM artifact:

```Dockerfile
ARG OCJS_DIGEST=sha256:<digest>
FROM ghcr.io/taucad/opencascade.js@${OCJS_DIGEST} AS bindgen

ARG MY_CONFIG=build-configs/my-config.yml
COPY ${MY_CONFIG} /src/config.yml
RUN /opencascade.js/bin/build-wasm.sh link /src/config.yml

FROM scratch AS dist
COPY --from=bindgen /opencascade.js/build/my-config.wasm /
COPY --from=bindgen /opencascade.js/build/my-config.js /
COPY --from=bindgen /opencascade.js/build/my-config.d.ts /
COPY --from=bindgen /opencascade.js/build/my-config.provenance.json /
```

Every artifact downstream produces carries the upstream `provenance.json` plus the downstream lockfile, giving end-to-end attestation across the build graph.

## Summary

| Layer                       | Discipline                                                  | Surface area                |
| --------------------------- | ----------------------------------------------------------- | --------------------------- |
| 1. Pin image by SHA         | `docker buildx imagetools inspect` → `@sha256:<digest>`     | CI workflow YAML            |
| 2. Verify `provenance.json` | Hash check + toolchain assertion                            | Bundler / pre-publish step  |
| 3. Extract SBOM             | `gh attestation verify` / `cosign download sbom`            | Audit / compliance pipeline |
| 4. Lockfile / DEPS.json     | `pnpm install --frozen-lockfile`; checked-in pinning files  | Downstream repos            |

Adopting all four lets you state, with byte-level evidence, that the WASM in your production bundle was built from a specific OCCT commit by a specific emscripten version on a specific dated CI run. Skipping any layer leaves a window where supply-chain attacks or accidental drift can land in your output unobserved.

## Related references

- [`MAINTAINER.md`](../../MAINTAINER.md) — local build instructions; the same toolchain GHCR pins
- [`BUILD_SYSTEM.md`](../../BUILD_SYSTEM.md) — `OCJS_*` env vars and how named configurations land them
- [`build-configs/configurations.json`](../../build-configs/configurations.json) — named compile-time configurations
- [`build-configs/opencascade_full.provenance.json`](../../build-configs/opencascade_full.provenance.json) — concrete `provenance.json` example from the shipped build

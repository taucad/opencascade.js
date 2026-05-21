# opencascade.js — OCCT V8 WASM build image
#
# Build:
#   DOCKER_BUILDKIT=1 docker build -t opencascade-js .
#
# Per-config warm-cache images (recommended for downstream consumers):
#   docker build --build-arg OCJS_CONFIG_DEFAULT=single-threaded -t opencascade-js:single-threaded .
#   docker build --build-arg OCJS_CONFIG_DEFAULT=multi-threaded  -t opencascade-js:multi-threaded  .
#
# Run (link with consumer YAML):
#   docker run --rm \
#     -v $(pwd)/my-config.yml:/src/config.yml:ro \
#     -v $(pwd)/output:/output \
#     opencascade-js link /src/config.yml
#
# Run (full build with named configuration):
#   docker run --rm -e OCJS_CONFIG=single-threaded \
#     -v $(pwd)/my-config.yml:/src/config.yml:ro \
#     -v $(pwd)/output:/output \
#     opencascade-js full /src/config.yml
#
# Persistent caching across runs (recommended for iterative work):
#   docker volume create ocjs-nx-cache ocjs-build-cache
#   docker run --rm \
#     -v ocjs-nx-cache:/opencascade.js/.nx \
#     -v ocjs-build-cache:/opencascade.js/build \
#     -v $(pwd)/output:/output \
#     opencascade-js full build-configs/full.yml
#
# Environment overrides:
#   docker run -e OCJS_OPT="-Os" -e OCJS_EXCEPTIONS=1 ... opencascade-js full build-configs/full.yml
#
# This Dockerfile is split into three named stages so CI and downstream consumers
# can build/cache them independently:
#
#   - deps-base    OS toolchain (emsdk + apt + Node 24 + uv + Python 3.14 + clone-deps.sh)
#                  → invariant under in-repo source changes; cached aggressively
#   - bindgen-base deps-base + npm ci + apply-patches + pch + generate
#                  → invariant under YAML / consumer source changes; cached per-PR
#   - final        bindgen-base + OCI labels + ENTRYPOINT/CMD
#                  → the published image; rebuild on every commit
#
# Each stage is independently buildable via `--target`:
#   docker buildx build --target deps-base    -t ocjs-deps    .
#   docker buildx build --target bindgen-base -t ocjs-bindgen .
#   docker buildx build --target final        -t ocjs         .
#
# Notes on the underlying build pipeline:
#   - All dependency fetching (OCCT/rapidjson/freetype git clones, Python venv,
#     LLVM 17 tarball) is delegated to scripts/clone-deps.sh — the exact same
#     script the host build uses. The Dockerfile is a thin OS+toolchain layer
#     on top of it. Adding a new dep means editing DEPS.json + clone-deps.sh;
#     the Dockerfile picks it up free. No duplicated curl/git/sha256 logic.
#   - emsdk is the only dep clone-deps.sh skips here: the base image already
#     ships /emsdk with the `emsdk` launcher, and the script's §2 explicitly
#     detects this via `[ -x $EMSDK_DIR/emsdk ]` (see line 98-101 there).
#     A pre-symlink at /opencascade.js/deps/emsdk → /emsdk activates that path.
#   - apt-installed Doxygen satisfies _ensure_doxygen at runtime (no GitHub download).
#   - apply-patches + pch + generate are pre-baked into the bindgen-base stage so
#     consumers pay only the compile-bindings/compile-sources/link cost on first
#     `docker run`.
#   - Convenience top-level symlinks /occt /rapidjson /freetype /llvm-17 point
#     into /opencascade.js/deps/ so the `ENV OCCT_ROOT=/occt` defaults below
#     and any external bind-mount UX (`-v /my/occt:/occt`) keep working.
#   - The entrypoint dispatches recognised subcommands through `npx nx run` so
#     consumers benefit from Nx's content-addressed cache (warm runs ≤ 5 min).

# syntax=docker/dockerfile:1.7

# ═════════════════════════════════════════════════════════════════════════════
# Stage 1: deps-base
# OS toolchain + dependency clones. No in-repo source code beyond DEPS.json,
# requirements.txt, and clone-deps.sh.
# ═════════════════════════════════════════════════════════════════════════════
FROM emscripten/emsdk:5.0.1@sha256:c89732ef63a56de5a96395c5a8c1c7904f7420131a045406e6fedc4cbe1cc198 AS deps-base

LABEL org.opencontainers.image.title="opencascade.js (deps-base)" \
      org.opencontainers.image.description="OS toolchain + dependency clones (emsdk, Node 24, uv, Python 3.14, OCCT, rapidjson, freetype, LLVM 17)"

# ── System packages ─────────────────────────────────────────────────────────
# Notes on what is intentionally NOT installed:
#   - cmake: installed via the PyPI wheel `cmake==4.3.2` in the venv below.
#     Keeps host (`brew install cmake@4`) and container on the same major.
#   - python3/python3-pip/python3-venv: replaced by `uv python install 3.14.4`
#     which downloads python-build-standalone — bit-identical interpreter
#     lineage on macOS arm64 and Linux arm64. Foundation for libclang
#     parse-environment parity (see src/ocjs_bindgen/config/paths.py).
RUN --mount=type=cache,target=/var/cache/apt,id=ocjs-apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=ocjs-apt-lists,sharing=locked \
  apt-get update -y && \
  apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    doxygen \
    git \
    gnupg \
    jq \
    libc6-dev \
    unzip \
    xz-utils

# libc6-dev note: provides /usr/include/sys/types.h + friends (glibc userspace
# headers) that `_get_host_libc_include()` in src/ocjs_bindgen/config/paths.py
# routes libclang's parse pass at. Without this package, /usr/include has only
# /usr/include/stdint.h (from linux-libc-dev that build-essential pulls in) and
# OCCT headers transitively requesting <sys/types.h> fail to parse — the same
# silent type-degradation cascade that has historically struck libc++/libc
# version mismatches, just triggered by missing libc instead of mismatched
# libc++. On macOS Apple's SDK bundles a complete libc by default; on Linux it
# is a separate package.

# ── Node.js 24 (NodeSource) ─────────────────────────────────────────────────
RUN --mount=type=cache,target=/var/cache/apt,id=ocjs-apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=ocjs-apt-lists,sharing=locked \
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
  apt-get install -y --no-install-recommends nodejs

# ── uv (Python toolchain manager) + Python 3.14.4 ───────────────────────────
# uv installs python-build-standalone — same upstream CPython binary lineage
# on macOS arm64 and Linux arm64 for a given release tag. Replaces both apt
# python3* packages and pyenv. Host bootstrap is identical (see MAINTAINER.md).
RUN curl -LsSf https://astral.sh/uv/install.sh | \
      env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh && \
    uv python install 3.14.4

# Put /usr/local/bin (uv) ahead of emsdk's bundled Node 22 so `node`/`npm`
# resolve to the NodeSource-installed v24. The venv path gets prepended
# below after clone-deps.sh creates it.
#
# Emcc still uses its bundled Node 22 internally via the NODE_JS absolute
# path in /emsdk/.emscripten — that's how emscripten orchestrates its own
# toolchain and is independent of $PATH lookups. We only need Node 24 for
# our project's `npx nx run …` / `npm ci` invocations, matching the host's
# Node version (see .nvmrc and package.json:engines).
ENV PATH="/opencascade.js/.venv/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# ── Dependency fetch via the single host-tested script ──────────────────────
# clone-deps.sh is the source of truth for every dep the build needs:
#   §1 OCCT, rapidjson, freetype  → git clone + checkout at DEPS.json commits
#   §2 emsdk                       → SKIPPED here, pre-symlinked below (the
#                                    script's line 98-101 explicitly handles
#                                    this Docker case — base image already
#                                    ships /emsdk with the `emsdk` launcher)
#   §3 Python .venv + pip install  → uv venv + uv pip install requirements.txt
#   §4 LLVM 17 tarball             → curl + sha256 verify + tar -xJ
# Host and container go through the same code path; sha256/commit drift
# between them is impossible by construction. See clone-deps.sh.
WORKDIR /opencascade.js/

# Pre-create the venv with the pinned Python so /opencascade.js/.venv/bin/python3
# lands on PATH BEFORE clone-deps.sh runs (its line 53 requires python3 to parse
# DEPS.json). The script's §3 fast-paths past an already-created venv (line 121)
# and still runs `uv pip install -r requirements.txt`, so this does NOT
# re-duplicate the pip-install logic — it just bootstraps the python3 binary
# the script needs to function. The base image intentionally has no system
# python3 (see uv-only note above).
RUN uv venv --python 3.14.4 /opencascade.js/.venv

RUN mkdir -p /opencascade.js/deps && \
    ln -s /emsdk /opencascade.js/deps/emsdk

COPY DEPS.json requirements.txt /opencascade.js/
COPY scripts/clone-deps.sh /opencascade.js/scripts/clone-deps.sh
RUN bash scripts/clone-deps.sh --dest /opencascade.js/deps

# Convenience top-level symlinks: preserve the long-standing /occt, /rapidjson,
# /freetype, /llvm-17 paths so the `ENV OCCT_ROOT=/occt` defaults below (and
# any external bind-mount UX like `-v /my/occt:/occt`) keep working. The real
# bytes live under /opencascade.js/deps/<name>; these are just aliases.
RUN ln -s /opencascade.js/deps/OCCT      /occt && \
    ln -s /opencascade.js/deps/rapidjson /rapidjson && \
    ln -s /opencascade.js/deps/freetype  /freetype && \
    ln -s /opencascade.js/deps/llvm-17   /llvm-17

# ═════════════════════════════════════════════════════════════════════════════
# Stage 2: bindgen-base
# Adds: in-repo build system, npm ci, apply-patches, pch, generate.
# Cached at the YAML-config level — invariant under consumer YAML changes.
# ═════════════════════════════════════════════════════════════════════════════
FROM deps-base AS bindgen-base

LABEL org.opencontainers.image.title="opencascade.js (bindgen-base)" \
      org.opencontainers.image.description="deps-base + npm ci + apply-patches + pch + generate (bindings TUs pre-built)"

# Install Nx CLI + project devDeps deterministically from package-lock.json
COPY package.json package-lock.json nx.json project.json /opencascade.js/
RUN --mount=type=cache,target=/root/.npm,id=ocjs-npm,sharing=locked \
    npm ci --no-audit --no-fund

# Copy the build system. DEPS.json + scripts/clone-deps.sh were copied above
# (they are inputs to the dep-fetch RUN); this COPY refreshes scripts/ with
# the remaining helpers (docker-entrypoint.sh, validate-build.py, etc.) and
# brings in the rest of the build system.
COPY src ./src
COPY tsconfig.json* ./
COPY build-configs ./build-configs
COPY build-wasm.sh ./build-wasm.sh
COPY scripts ./scripts
COPY bindgen-filters.yaml ./bindgen-filters.yaml
RUN chmod +x build-wasm.sh scripts/*.sh

# ── Default environment ─────────────────────────────────────────────────────
# The named configuration in build-configs/configurations.json drives every
# build flag (-O3, SIMD, mimalloc, eval_ctors, closure, threading, etc.).
# Override at runtime with `-e OCJS_CONFIG=<name>` (see
# build-configs/configurations.json for available named configurations) or
# per-flag overrides (`-e OCJS_OPT=-Os`, etc.).
#
# OCJS_CONFIG_DEFAULT is the BUILD-TIME default that controls which config the
# PCH stage pre-bakes for. Downstream consumers who want a warm cache for a
# specific threading config can build with:
#   docker build --build-arg OCJS_CONFIG_DEFAULT=multi-threaded -t ocjs:multi-threaded .
# Runtime overrides still work, but a mismatched runtime `OCJS_CONFIG` will
# invalidate the Nx pch cache and force a rebuild on first `docker run`.
ARG OCJS_CONFIG_DEFAULT=single-threaded
ENV OCCT_ROOT=/occt
ENV RAPIDJSON_ROOT=/rapidjson
ENV FREETYPE_ROOT=/freetype
ENV EMSDK=/emsdk
ENV OCJS_CONFIG="${OCJS_CONFIG_DEFAULT}"
ENV OCJS_PATCH_DUMP=true
ENV OCJS_PATCH_STEPCAF=true
ENV OCJS_OUTPUT_DIR=/output
# Strict-types guardrail: defaults to warn-only -- the link step always
# prints a triage summary to stderr if the .d.ts contains rewrites-to-
# `unknown` method signatures or unbound class references (the silent
# type-loss failure mode from the May-2026 replicad regression). The
# build proceeds. CI consumers who want to escalate the warning to a
# hard build failure should set OCJS_STRICT_TYPES=1 explicitly at
# `docker run` time. See `ocjs_bindgen.link.yaml_build._enforce_strict_types_gate`
# for the policy.

RUN mkdir -p build/bindings build/sources /output

# Pre-bake apply-patches + pch + generate via Nx. These targets depend only on
# the pinned dep commits and the in-tree build system; their outputs (patched
# OCCT tree, flat includes, PCH, generated .cpp / .d.ts.json fragments, and
# the Nx cache itself) are baked into the bindgen-base stage so consumers skip
# straight to compile-bindings/compile-sources/link on first `docker run`.
RUN npx nx run ocjs:apply-patches && \
    npx nx run ocjs:pch && \
    npx nx run ocjs:generate

# ═════════════════════════════════════════════════════════════════════════════
# Stage 3: final
# Adds OCI labels, ENTRYPOINT, CMD. This is the published image.
# ═════════════════════════════════════════════════════════════════════════════
FROM bindgen-base AS final

# ── OCI image metadata ──────────────────────────────────────────────────────
# REVISION/VERSION are injected by CI (docker/metadata-action + github.sha);
# SOURCE_URL defaults to the taucad fork and can be overridden for downstream
# rebuilds. Labels follow the opencontainers.org spec so `docker inspect` and
# GHCR's UI surface provenance, licensing, and source links automatically.
ARG REVISION
ARG VERSION
ARG SOURCE_URL=https://github.com/taucad/opencascade.js
LABEL org.opencontainers.image.title="opencascade.js" \
      org.opencontainers.image.description="Emscripten build environment for OpenCASCADE.js (taucad fork, vendored LLVM 17 libclang)" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.url="${SOURCE_URL}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="LGPL-2.1-only" \
      org.opencontainers.image.vendor="taucad"

ENTRYPOINT ["/opencascade.js/scripts/docker-entrypoint.sh"]
CMD ["full", "build-configs/full.yml"]

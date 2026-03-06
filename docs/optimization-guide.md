# Build Optimization Guide

Practical reference for tuning opencascade.js WASM builds for size, speed, or build time.

## Quick Reference

| Goal                | Compile  | wasm-opt | LTO  | Defines               | Expected Size |
|---------------------|----------|----------|------|-----------------------|---------------|
| **Balanced** (rec.)  | `-O2`    | `-O3`    | No   | —                     | ~17.7 MB      |
| **Max performance**  | `-O3`    | `-O3`    | No   | `OCCT_NO_DUMP`, `-UOCC_CONVERT_SIGNALS` | ~19.0 MB |
| **Min size**          | `-Os`    | `-Oz`    | No   | `OCCT_NO_DUMP`, `-UOCC_CONVERT_SIGNALS` | ~16.1 MB |
| **Debug**             | `-O0`    | `-O0`    | No   | —                     | ~35+ MB       |

## Compile Optimization (`OCJS_OPT`)

Controls the `-O` flag passed to `emcc` during source and binding compilation.

| Level | Binary Size | Build Time | Runtime Speed | Notes |
|-------|-------------|------------|---------------|-------|
| `-O0` | ~35 MB      | Fastest    | Slowest       | Debug only. No inlining, no dead code removal. |
| `-O2` | ~17.7 MB    | Moderate   | Good          | **Recommended default.** Best size/speed tradeoff. |
| `-O3` | ~19.0 MB    | Moderate   | Marginally better | Aggressive inlining adds ~1.5 MB. Negligible speed gain for typical CAD ops. |
| `-Os` | ~16.1 MB    | Moderate   | ~5-10% slower | Optimizes for size. Good for bandwidth-constrained deployments. |
| `-Oz` | ~15.5 MB    | Moderate   | ~10-15% slower | Most aggressive size optimization. May hurt performance. |

## Link-Time Optimization (`OCJS_LTO`)

**Recommendation: Keep LTO disabled at compile time** (`OCJS_LTO=0`).

Emscripten's compile-time LTO (`-flto` on every `.o` file) produces LLVM bitcode instead of native object files. For OCCT-scale codebases (4000+ source files), this causes:

- 2x binary bloat during compilation (bitcode is larger than object code)
- Dramatically longer link times (the linker must re-optimize everything)
- No measurable runtime performance improvement

The link step's `-flto` in `emccFlags` still provides dead-code elimination of unused functions, which is the primary benefit of LTO.

## wasm-opt Level (`OCJS_WASM_OPT_LEVEL`)

Post-link optimization pass by Binaryen's `wasm-opt`:

| Level | Effect |
|-------|--------|
| `-O0` | No optimization. Fastest post-processing. |
| `-O2` | Good optimization without excessive compile time. |
| `-O3` | Full optimization. Recommended for production. |
| `-Os` | Optimize for size with reasonable speed. |
| `-Oz` | Aggressive size optimization. May reduce runtime speed. |

### `--converge` Flag (`OCJS_CONVERGE`)

When enabled, `wasm-opt` runs optimization passes iteratively until the binary stops shrinking. Typically saves an extra 0.1-0.5% but adds 30-60 seconds to the build.

## Compile Defines

### `-DNo_Exception` / `-DOCCT_NO_DUMP`

- `-DNo_Exception`: Disables OCCT's internal exception guard macros. Saves 100-300 KB. **Do not use with exception builds** — this disables the C++ throw sites.
- `-DOCCT_NO_DUMP`: Stubs out `DumpJson()` methods across OCCT. Combined with `patch_standard_dump.py`, this removes ~200 KB of serialization code.

### `-UOCC_CONVERT_SIGNALS`

Undefines the POSIX signal conversion macro. OCCT normally converts SIGSEGV/SIGFPE into C++ exceptions on Unix. This is dead code in WASM (no POSIX signals) and can be safely removed, saving ~50 KB.

## Emscripten Optimizations

### `-sEVAL_CTORS` (`OCJS_EVAL_CTORS`)

Evaluates C++ static initializers at compile time instead of runtime. Reduces startup time slightly. Safe for OCCT builds.

### `--closure 1` (`OCJS_CLOSURE`)

Runs Google Closure Compiler on the generated JavaScript glue code. Reduces JS file size by ~30-50%. Adds ~10 seconds to the build.

## Build Cache

The compilation cache (`build-cache.py`) stores compiled `.o` files keyed by build configuration. Cache hits skip the ~30-minute compilation step entirely.

### Cache Key

The cache key includes:
- Optimization level, LTO, exceptions, threading
- `filterPackages.py` content hash (which OCCT packages are included)
- OCCT commit hash
- Emscripten version

Changes to the YAML config or wasm-opt flags do **not** invalidate the cache — those only affect linking.

### Maintenance

```bash
# List cached compilations
./build-wasm.sh cache-list

# Keep only the 3 most recent cache entries
./build-wasm.sh cache-gc 3
```

## Symbol Count vs Binary Size

Each bound symbol adds approximately 15-25 KB to the final WASM binary (embind registration + C++ implementation + type metadata). The full build config binds ~233 symbols.

To reduce size, create a custom YAML config with only the symbols your application uses. See `docs/build-config-reference.md` for details.

## Gzip Compression

WASM binaries compress well with gzip. Typical compression ratios:

| Build Variant      | Raw Size | Gzipped  | Ratio |
|---------------------|----------|----------|-------|
| `-O2` no exceptions | 17.7 MB  | 5.65 MB  | 32%   |
| `-O2` with exceptions | 19.8 MB | 6.35 MB | 32%   |
| `-Os` no exceptions | 16.1 MB  | 5.2 MB   | 32%   |

Always serve WASM files with gzip or brotli compression enabled on your web server.

# OCCT V8 + Emscripten 5 Migration Guide

This document covers the migration of opencascade.js from OCCT V7.6.2 + Emscripten 3.x to OCCT V8.0.0 + Emscripten 5.x.

## Overview

| Component     | Before       | After           |
|---------------|-------------|-----------------|
| OCCT          | 7.6.2       | 8.0.0           |
| Emscripten    | 3.1.x       | 5.0.1           |
| Exceptions    | `-fexceptions` + `-sDISABLE_EXCEPTION_CATCHING` | `-fwasm-exceptions` (native) |
| LTO           | Enabled (`-flto`) | Disabled at compile time (`OCJS_LTO=0`) |
| Optimization  | `-O3` (link) | `-O3` (link), `-O2` (compile) |

## Breaking Changes

### 1. Native WASM Exceptions Replace JavaScript Exceptions

The `-fexceptions` / `-sDISABLE_EXCEPTION_CATCHING` Emscripten flags have been replaced with `-fwasm-exceptions`, which uses the WebAssembly Exception Handling proposal (Phase 4, shipped in all major browsers).

**Impact:**

- C++ exceptions are now thrown as `WebAssembly.Exception` objects instead of numeric pointers or Emscripten `CppException` wrappers
- The `OCJS_EXCEPTIONS` environment variable has been removed — exceptions are always enabled
- No separate "with_exceptions" build is needed; a single build provides full exception support with zero-cost happy-path performance
- Browser support: 94.5%+ (Chrome 95+, Firefox 100+, Safari 15.2+)

**For downstream consumers:**

- Exception decoding via `OCJS.getStandard_FailureData()` still works identically
- Stack traces are preserved natively by the WASM exception mechanism
- No proxy wrapping or special initialization mode is required

### 2. noLTO Build Pipeline

Link-time optimization is disabled at compile time (`OCJS_LTO=0`) because Emscripten 5.x's LTO pipeline produces marginally larger binaries with no measurable performance benefit for OCCT-scale codebases. The link step still uses `-flto` in `emccFlags` for dead-code elimination during final linking.

### 3. OCCT V8 API Changes

OCCT V8 introduced several API changes:

- **Removed `Message_ProgressIndicator`**: Replaced by `Message_ProgressRange` (already present in V7.6, now mandatory)
- **Removed `NCollection_Handle`**: Use `opencascade::handle<T>` directly
- **`Standard_Failure::GetStackString()`**: Now returns stack trace information when built with exception support
- **Removed `Geom2d_Conic::Reverse()` override**: Uses base class implementation
- **New toolkit organization**: Some headers moved between toolkits

### 4. Emscripten 5 Changes

- **Python build scripts**: Updated from Python 3.8+ patterns to 3.10+ (minor)
- **PCH compilation**: `-fwasm-exceptions` must be consistently applied to PCH, source, and binding compilation
- **`wasm-opt`**: Uses `--strip-debug --strip-producers` for smaller binaries without affecting runtime behavior

## Build Script Usage

The primary build script is `build-wasm.sh`:

```bash
# Full rebuild (PCH + sources + bindings + link)
OCJS_LTO=0 ./build-wasm.sh full path/to/custom_build.yml

# Link only (reuses compiled .o files — fastest iteration)
./build-wasm.sh link path/to/custom_build.yml

# Rebuild PCH then link
./build-wasm.sh pch link path/to/custom_build.yml
```

### Environment Variables

| Variable         | Default   | Description |
|------------------|-----------|-------------|
| `EMSDK`          | `../assimpjs/emsdk` | Path to Emscripten SDK |
| `OCCT_ROOT`      | `../OCCT`  | Path to OCCT source tree |
| `RAPIDJSON_ROOT` | `./rapidjson` | Path to RapidJSON headers |
| `FREETYPE_ROOT`  | `./freetype` | Path to FreeType library |
| `OCJS_OPT`       | `-O2`     | Compile optimization level |
| `OCJS_LTO`       | `1`       | Enable LTO at compile time (set `0` for noLTO) |
| `THREADING`      | `single-threaded` | Threading mode |

### YAML Configuration

Build configurations are specified via YAML files. Key `emccFlags` for the link step:

```yaml
emccFlags:
  - -flto                        # Dead-code elimination at link time
  - -fwasm-exceptions            # Native WASM exception handling
  - -sEXPORT_EXCEPTION_HANDLING_HELPERS  # JS helpers for exception decoding
  - -sEXPORT_ES6=1
  - -sALLOW_MEMORY_GROWTH=1
  - -sINITIAL_MEMORY=100MB
  - -sMAXIMUM_MEMORY=4GB
  - --no-entry
  - --emit-symbol-map
  - -O3                          # Link-time optimization level
```

### Adding Exception Decoding

To decode OCCT `Standard_Failure` exceptions, add the `OCJS` and `Standard_Failure` symbols to your YAML bindings, plus the `OCJS` helper class in `additionalCppCode`:

```yaml
bindings:
  - symbol: OCJS
  - symbol: Standard_Failure

additionalCppCode: |
  class OCJS {
  public:
    static Standard_Failure* getStandard_FailureData(intptr_t exceptionPtr) {
      return reinterpret_cast<Standard_Failure*>(exceptionPtr);
    }
  };
```

## Performance

Benchmarks comparing V7.6.2 to V8 (single-threaded, noLTO, `-O3` link):

| Category      | Avg improvement |
|---------------|----------------|
| Primitives    | -3% to +2%     |
| Booleans      | -16% to -31%   |
| Fillets       | -16% to -19%   |
| Sketches      | -9% to -13%    |
| Complex models| -23% to -29%   |

V8's boolean operations (BOPAlgo) show the largest improvement at 22-31% faster.

## Multi-threading (Deferred)

While the build system supports multi-threaded builds (`THREADING=multi-threaded`), OCCT's parallel algorithms are not currently activated in typical downstream usage:

- `BOPAlgo_Options::SetRunParallel()` defaults to `false`
- `BRepMesh_IncrementalMesh` requires explicit `isInParallel=true`
- The overhead of pthreads infrastructure (SharedArrayBuffer, mutex costs, worker pool) outweighs benefits for sequential workloads

Multi-threading support is retained in the build system but not recommended for production use without explicit parallel algorithm activation.

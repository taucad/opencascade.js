# Breaking Changes — `opencascade.js@3.0.0`

This guide is for **package consumers** upgrading from `opencascade.js@1.1.x` → `3.0.0`.

It lists every consumer-visible breaking change with **Before / After** code samples. All `After` snippets are taken directly from runnable smoke tests in [`tests/smoke/`](tests/smoke/) or from the published [`dist/opencascade_full.d.ts`](dist/opencascade_full.d.ts).

If you only build WASM yourself (no JS consumption), skip ahead to [Section F — Build flag changes](#section-f--build-flag-changes).

## Compatibility floor

Native WebAssembly exception handling is on by default in the published build. Consumers must run on a runtime that supports `WebAssembly.Exception`:

| Runtime | Minimum |
| ------- | ------- |
| Chrome / Edge | 95 |
| Firefox | 100 |
| Safari | 16.4 |
| Node.js | 22 |

To run on older runtimes, build a custom variant from source with the `Os-noLTO-simd` or `O3-noLTO-simd` configuration (both have `OCJS_EXCEPTIONS=0`).

## Index

- [Section A — Module loading](#section-a--module-loading)
- [Section B — JS / TS API surface changes](#section-b--js--ts-api-surface-changes)
- [Section C — WebAssembly exception handling](#section-c--webassembly-exception-handling)
- [Section D — OCCT V8 API breaking changes](#section-d--occt-v8-api-breaking-changes)
- [Section E — Removed symbol families](#section-e--removed-symbol-families)
- [Section F — Build flag changes](#section-f--build-flag-changes)
- [Appendix G — Performance & size](#appendix-g--performance--size)

---

## Section A — Module loading

### A1 — `dist/` layout: single triple, no facade

Upstream shipped a barrel module that lazily required one of several pre-built variants from `dist/`. v3 ships exactly one variant — `opencascade_full.{js,wasm,d.ts}` — and exports its loader as the package's default export. There is no facade module to choose between variants.

**Before**

```ts
import { initOpenCascade } from 'opencascade.js';
import opencascade from 'opencascade.js/dist/opencascade.full.js';
const oc = await initOpenCascade({ mainJS: opencascade });
```

**After**

```ts
import initOpenCascade from 'opencascade.js';
const oc = await initOpenCascade({ locateFile });
```

**Action**: drop any `mainJS` / variant-selection wiring. If you previously imported a specific variant file directly, switch to the package's default export.

### A2 — ESM-only with explicit `locateFile`

The package is `"type": "module"`. CommonJS entry points are gone. The Emscripten loader still needs a `locateFile` callback so it can resolve `opencascade_full.wasm` from your bundler's output directory or your Node `node_modules` layout.

The runnable reference for both Node and browser usage is [`tests/smoke/helpers.ts`](tests/smoke/helpers.ts):

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OpenCascadeInstance } from 'opencascade.js';
import init from 'opencascade.js';

const BUILD_DIR = path.dirname(
  new URL(import.meta.resolve('opencascade.js/dist/opencascade_full.wasm')).pathname,
);
const WASM_PATH = path.join(BUILD_DIR, 'opencascade_full.wasm');

let _oc: OpenCascadeInstance | undefined;
export async function initOC(): Promise<OpenCascadeInstance> {
  if (!_oc) {
    _oc = await init({
      locateFile: (filename: string) => path.join(BUILD_DIR, filename),
    });
  }
  return _oc;
}
```

For a Vite / browser app, resolve the WASM URL through your bundler:

```ts
import init from 'opencascade.js';
import wasmUrl from 'opencascade.js/dist/opencascade_full.wasm?url';

const oc = await init({ locateFile: () => wasmUrl });
```

**Action**: pass `locateFile` to every `init()` call; remove any CommonJS `require()` of the package.

---

## Section B — JS / TS API surface changes

### B1 — Suffix-free overloads

Upstream exposed each C++ overload as its own `_N`-suffixed subclass (`gp_Pnt_2`, `gp_Pnt_3`, …) and required the consumer to pick the right one. v3 collapses every uniquely-arity overload behind the bare symbol with a value-based dispatcher; the runtime picks the right C++ overload from your argument types.

Reference smoke test: [`tests/smoke/smoke-suffix-free.test.ts`](tests/smoke/smoke-suffix-free.test.ts).

**Before**

```ts
const p = new oc.gp_Pnt_3(1, 2, 3);
const dirFromXyz = new oc.gp_Dir_2(new oc.gp_XYZ(0, 0, 1));
const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
```

**After**

```ts
using p = new oc.gp_Pnt(1, 2, 3);
using dirFromXyz = new oc.gp_Dir(new oc.gp_XYZ(0, 0, 1));
using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
using edge = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
```

For genuinely ambiguous cases that share an arity (e.g. two constructors that both take three numbers but mean different things), the codegen still emits `_N` symbols — grep `dist/opencascade_full.d.ts` to find the exact name.

**Action**: search-and-replace `_N` overload subclass names with the bare symbol. Most call sites collapse cleanly; the few that don't surface as TypeScript errors with the correct alternative spelling visible in IntelliSense.

### B2 — Output parameters return a value object

Methods that previously took a `T&` output reference no longer require a caller-allocated placeholder. The codegen strips primitive output parameters from the JS signature and returns them as a structured object via `emscripten::val_object`.

Reference smoke test: [`tests/smoke/smoke-output-params.test.ts`](tests/smoke/smoke-output-params.test.ts).

**Before**

```ts
const u1 = { current: 0 }, u2 = { current: 0 };
const v1 = { current: 0 }, v2 = { current: 0 };
sphere.Bounds(u1, u2, v1, v2);
console.log(u1.current, u2.current, v1.current, v2.current);
```

**After**

```ts
const { U1, U2, V1, V2 } = sphere.Bounds();
console.log(U1, U2, V1, V2);
```

The same pattern applies to `Handle<T>&` outputs (returned objects own `.delete()`):

```ts
const { Curve1, Curve2 } = intersector.Segment(1);
Curve1.delete();
Curve2.delete();
```

…and to static methods (`oc.BRepTools.UVBounds(face)` returns `{ UMin, UMax, VMin, VMax }`).

**Action**: drop the placeholder-object pattern (`{current: 0}`) for every method whose `.d.ts` now shows a non-`void` return; destructure the named fields from the return value.

---

## Section C — WebAssembly exception handling

### C1 — Why this changed

Upstream's exception build wrapped every potentially-throwing call site in a JavaScript `invoke_*` trampoline (`-fexceptions` / `-sDISABLE_EXCEPTION_CATCHING=0`). That added ~80% gzipped binary overhead.

v3 uses native WASM exceptions (`-fwasm-exceptions`): the `throw` and `catch` instructions live in the WASM bytecode itself, the JS trampolines disappear, and the gzipped exception overhead drops to ~12%. The happy path has zero overhead.

The shipped `full.yml` build is linked with the helpers needed to decode exceptions from JS (`-sEXPORT_EXCEPTION_HANDLING_HELPERS`). Browser support: see [Compatibility floor](#compatibility-floor).

### C2 — Catch / decode pattern (consumer-facing)

A caught exception is now a `WebAssembly.Exception`, decodable via the runtime helpers. The pattern below is the same one used by [`tests/smoke/smoke-exceptions.test.ts`](tests/smoke/smoke-exceptions.test.ts) and Tau's runtime kernel formatter:

```ts
import init from 'opencascade.js';
const oc = await init({ locateFile });

try {
  using cone = new oc.BRepPrimAPI_MakeCone(1, 0.5, 0); // Standard_DomainError: zero height
  void cone.Shape();
} catch (e) {
  if (e instanceof WebAssembly.Exception) {
    const [type, message] = oc.getExceptionMessage(e);
    console.error(`${type}: ${message}`);
    oc.decrementExceptionRefcount(e);
  } else if (typeof e === 'number') {
    // Legacy embind exception pointer — decode via OCJS helper
    const failure = oc.OCJS.getStandard_FailureData(e);
    console.error(failure.what());
  } else {
    throw e;
  }
}
```

Key APIs (all live on the OC instance returned by `init()`):

- `oc.getExceptionMessage(e)` → `[typeName, message]` tuple
- `oc.incrementExceptionRefcount(e)` / `oc.decrementExceptionRefcount(e)` → manual refcount management when storing the exception across scopes
- `oc.OCJS.getStandard_FailureData(ptr)` → richer decode for OCCT `Standard_Failure` payloads
- `oc.OCJS.exceptionsEnabled()` → feature-detect at runtime (returns `false` for builds without exceptions)

**Action**: replace any `try { … } catch (rawPointer)` style with the `WebAssembly.Exception` branch above. If you support both old and new builds, gate on `oc.OCJS.exceptionsEnabled()`.

### C3 — Build flag migration (custom builds only)

Skip this if you consume the published tarball.

**Before**

```yaml
emccFlags:
  - -fexceptions
  - -sDISABLE_EXCEPTION_CATCHING=0
```

**After**

```yaml
emccFlags:
  - -fwasm-exceptions
  - -sEXPORT_EXCEPTION_HANDLING_HELPERS
```

Every `.o` file in your build must use the same exception ABI; mixing `-fexceptions` and `-fwasm-exceptions` produces an unresolved `__cpp_exception` import at link time. The `OCJS_EXCEPTIONS=1` env var (or any of the named configurations in [`build-configs/configurations.json`](build-configs/configurations.json) that set it) handles this consistently.

---

## Section D — OCCT V8 API breaking changes

OCCT itself moved from V7.6.2 → V8.0.0 RC5 (commit `0ebbbedb`). The classes and methods below are the V8 changes that surface in JavaScript code.

### D1 — `TopoDS` namespace bridge

OCCT's `TopoDS` is a C++ namespace, not a class, so Embind cannot bind it directly. v3 ships a bridge class registered under the name `TopoDS` that exposes the eight downcast functions as static methods.

Reference: [`tests/smoke/smoke-output-params.test.ts:126`](tests/smoke/smoke-output-params.test.ts), `dist/opencascade_full.d.ts:202837`.

**Before** (upstream patterns varied — `prototype.Edge`, `_TopoDS_Edge`, manual `getPointer`, etc.)

```ts
const edge = oc._TopoDS_Edge(shape);
```

**After**

```ts
const edge = oc.TopoDS.Edge(shape);
const face = oc.TopoDS.Face(shape);
const wire = oc.TopoDS.Wire(shape);
const vertex = oc.TopoDS.Vertex(shape);
const shell = oc.TopoDS.Shell(shape);
const solid = oc.TopoDS.Solid(shape);
const compound = oc.TopoDS.Compound(shape);
const compSolid = oc.TopoDS.CompSolid(shape);
```

**Action**: rewrite cast call sites to `oc.TopoDS.<Kind>(shape)`.

### D2 — `Bnd_Box::Get` / `Bnd_Box2d::Get` removed

OCCT V8 dropped the six-output-parameter accessor in favour of corner getters.

Reference: `dist/opencascade_full.d.ts:19008`.

**Before**

```ts
const xMin = { current: 0 }, yMin = { current: 0 }, zMin = { current: 0 };
const xMax = { current: 0 }, yMax = { current: 0 }, zMax = { current: 0 };
box.Get(xMin, yMin, zMin, xMax, yMax, zMax);
console.log(xMin.current, yMin.current, zMin.current);
```

**After**

```ts
using min = box.CornerMin();
using max = box.CornerMax();
console.log(min.X(), min.Y(), min.Z(), max.X(), max.Y(), max.Z());
```

`Bnd_Box2d` follows the same pattern with 2D `CornerMin()` / `CornerMax()` returning `gp_Pnt2d`.

**Action**: replace every `box.Get(…)` call with corner getters.

### D3 — `Poly_Triangulation` normals API

Upstream's `HasNormals()` + per-pass output reference is replaced by `HasNormals()` + value-returning `Normal(index)`.

Reference: `dist/opencascade_full.d.ts:20576-20624`.

**Before**

```ts
if (tri.HasNormals()) {
  for (let i = 1; i <= tri.NbNodes(); i++) {
    const normal = new oc.gp_Dir(0, 0, 1);
    tri.Normal(i, normal);
    consume(normal);
  }
}
```

**After**

```ts
if (tri.HasNormals()) {
  for (let i = 1; i <= tri.NbNodes(); i++) {
    using normal = tri.Normal(i); // returns gp_Dir
    consume(normal);
  }
}
```

To set normals, use `tri.SetNormal(i, gpDir)` (replaces upstream's mutate-in-place callbacks).

**Action**: remove caller-allocated `gp_Dir` placeholders from normal iteration loops.

### D4 — `BRepMesh_IncrementalMesh` constructor signature

OCCT V8 reorganised the constructor overload set. The previously-common 5-arity convenience constructor is still available, but it now sits alongside additional `IMeshTools_Parameters`-based overloads, and the canonical signature has changed parameter order.

Reference: `dist/opencascade_full.d.ts:82824-82831`.

**Before** (upstream `_N`-suffixed dispatch)

```ts
const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
```

**After**

```ts
using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.5, false);
// or with parameter object:
using params = new oc.IMeshTools_Parameters();
params.Deflection = 0.1;
params.Angle = 0.5;
using meshFromParams = new oc.BRepMesh_IncrementalMesh(shape, params);
```

**Action**: drop the `_N` suffix; if your call site looks ambiguous, check the matching overload arity in `dist/opencascade_full.d.ts`.

### D5 — `TopoDS_Shape::HashCode` removed

OCCT V8 removed the member function `TopoDS_Shape::HashCode(upperBound)` in favour of `std::hash<TopoDS_Shape>`. There is no JS-side replacement in the published build.

**Before**

```ts
const bucket = shape.HashCode(1024);
```

**After (consumer-side)** — derive a bucket from a stable shape property you already track, or maintain an external `Map<TopoDS_Shape, number>` keyed by reference identity for the lifetime of the shape.

**After (custom build)** — if you need the original bucket-mod-N semantics, inject a wrapper into your own YAML's `additionalCppCode`:

```cpp
#include <functional>
#include <TopoDS_Shape.hxx>

class OCJS_ShapeHasher {
public:
  static int HashCode(const TopoDS_Shape& shape, int upperBound) {
    if (upperBound <= 0) return 0;
    size_t h = std::hash<TopoDS_Shape>{}(shape);
    return static_cast<int>((h % static_cast<size_t>(upperBound)) + 1);
  }
};
```

```yaml
bindings:
  - symbol: OCJS_ShapeHasher
```

Then call it as `oc.OCJS_ShapeHasher.HashCode(shape, 1024)`.

**Action**: remove `.HashCode()` calls; either accept the loss or rebuild a custom variant with the snippet above.

### D6 — Constructor and method "renumbering" advice is inverted from V7.x

Upstream V7.x docs told consumers to read the `_N` suffix off the generated `.d.ts` and use it verbatim. v3's suffix-free overloads (Section B1) collapse most of those — so the new advice is:

1. Drop the `_N` suffix.
2. Only consult the `.d.ts` for the genuinely ambiguous cases that still emit suffixes (constructors / methods with two overloads sharing an arity).

If you have a working V7 codebase, search-and-replace `oc.gp_Pnt_3` → `oc.gp_Pnt` etc. and let TypeScript point out the few remaining ambiguous cases.

---

## Section E — Removed symbol families

The following families are excluded from the v3 default build entirely. Calls compile against TypeScript as `undefined` member access (no `.d.ts` declaration).

| Family | Why | Migration |
| ------ | --- | --------- |
| `OpenGl_*`, `Aspect_Window`, the rest of `TKOpenGl` | The package targets headless CAD; interactive rendering is out of scope. | Render with your own engine (Three.js, Babylon, etc.) using triangulation extracted via `Poly_Triangulation`. |
| `TopOpe*` | Deprecated in OCCT itself; superseded by `BOPAlgo_*` and `BRepAlgoAPI_*`. | Use `BRepAlgoAPI_Fuse` / `Cut` / `Common` / `Section`, or the lower-level `BOPAlgo_*` machinery. |
| Several `Standard_Transient`-based legacy collections | Deprecated in OCCT V8; the auto-discovered `NCollection_*` variants cover the same cases. | Use the `NCollection_Array1_*` / `NCollection_Sequence_*` aliases that auto-discovery now emits. |
| `GCE2d_*` aliases | OCCT V8 normalised on `GC_*2d` spellings. | Use `GC_MakeCircle2d`, `GC_MakeArcOfCircle2d`, etc. |

If your application depends on any of these and you cannot migrate, build a custom variant from source that adds them to the YAML `bindings` list — the codegen still understands them, they are just excluded from the published `full.yml`.

---

## Section F — Build flag changes

Skip if you only consume the prebuilt tarball.

### F1 — `--preset` → `--config`

The `--preset` flag and the `build-configs/presets/` directory are gone. The replacement is `--config <name>`, where `<name>` is a key in [`build-configs/configurations.json`](build-configs/configurations.json).

**Before**

```bash
./build-wasm.sh --preset O3-maxperf full build-configs/full.yml
./build-wasm.sh --preset Os-minsize full build-configs/full.yml
```

**After**

```bash
./build-wasm.sh --config default full build-configs/full.yml
./build-wasm.sh --config Os-noLTO-simd full build-configs/full.yml
./build-wasm.sh --config O3-wasm-exc-simd full build-configs/full.yml
./build-wasm.sh --config O0-debug full build-configs/full.yml
```

The five shipped configurations (full env-var matrix in [BUILD_SYSTEM.md](BUILD_SYSTEM.md)):

| Name | Purpose |
| ---- | ------- |
| `default` | What the published tarball is built with: `-O3`, SIMD, BigInt, `EVAL_CTORS=2`, Closure, converge. |
| `O3-wasm-exc-simd` | Like `default` but with native WASM exceptions on. |
| `O3-noLTO-simd` | Performance variant, no Closure, no converge — useful when iterating on the link step. |
| `Os-noLTO-simd` | Size-optimised (`-Os`), still fast enough for browser delivery. |
| `O0-debug` | Fastest build, no SIMD, no exceptions — debug only. |

The old preset names (`O2-balanced`, `O3-maxperf`, `Os-minsize`) no longer exist. Add your own entry to `configurations.json` for new variants.

### F2 — `full-exceptions.yml` merged into `full.yml`

The exception-enabled variant used to live in a separate YAML. v3 ships exceptions on by default in the single `full.yml` — its `emccFlags` block carries `-fwasm-exceptions`, `-sEXPORT_EXCEPTION_HANDLING_HELPERS`, `-sWASM_BIGINT`, `-sEVAL_CTORS=2`, `-msimd128`.

**Before**

```bash
./build-wasm.sh full build-configs/full-exceptions.yml
```

**After**

```bash
./build-wasm.sh full build-configs/full.yml
```

To build a non-exceptions variant, pick a configuration that sets `OCJS_EXCEPTIONS=0` (`Os-noLTO-simd`, `O3-noLTO-simd`, `default`) and let the YAML's exception flags get overridden by the env, or copy `full.yml` and strip the EH lines.

### F3 — Removed and renamed Emscripten flags

| Direction | Flag |
| --------- | ---- |
| Removed | `-sUSE_ES6_IMPORT_META=0` (default in Emscripten 5.x) |
| Removed | `-sDISABLE_EXCEPTION_CATCHING=0` (replaced by `-fwasm-exceptions`) |
| Removed | `-fexceptions` (replaced by `-fwasm-exceptions`) |
| Renamed | `-sLLD_REPORT_UNDEFINED` → `-sERROR_ON_UNDEFINED_SYMBOLS=0` |
| Added | `-fwasm-exceptions` (default for `full.yml`) |
| Added | `-sEXPORT_EXCEPTION_HANDLING_HELPERS` (default for `full.yml`) |
| Added | `-sWASM_BIGINT` (default for `full.yml`) |
| Added | `-sEVAL_CTORS=2` (default for `full.yml`) |
| Added | `-msimd128` (default for `full.yml`) |

Memory flags (`-sINITIAL_MEMORY=100MB`, `-sMAXIMUM_MEMORY=4GB`, `-sALLOW_MEMORY_GROWTH=1`) are unchanged.

---

## Appendix G — Performance & size

No consumer action — included for "is upgrading worth it" context.

### Performance vs. V7.6.2

Single-threaded, `-O3` link, no LTO.

| Workload | Improvement |
| -------- | ----------- |
| Primitives | -3% to +2% |
| Boolean operations | 22-31% faster |
| Fillets | 16-19% faster |
| Sketches | 9-13% faster |
| Complex models | 23-29% faster |

### Size (gzipped) vs. V7.6.2

| Build | V7.6.2 | V8 (v3) | Change |
| ----- | ------ | ------- | ------ |
| Single (no exceptions) | 6.05 MB | 5.65 MB | -6.6% |
| With exceptions | 10.42 MB | 6.35 MB | -39.1% |
| Exception overhead | +72.2% | +12.4% | — |

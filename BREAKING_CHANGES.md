# Breaking Changes — `opencascade.js@3.0.0`

This guide is for **package consumers** upgrading from `opencascade.js@1.1.x` → `3.0.0`.

It lists every consumer-visible breaking change with **Before / After** code samples. All `After` snippets are taken directly from runnable smoke tests in [`tests/smoke/`](tests/smoke/) or from the published [`dist/opencascade_full.d.ts`](dist/opencascade_full.d.ts).

If you only build WASM yourself (no JS consumption), skip ahead to [Section F — Build flag changes](#section-f--build-flag-changes).

## Compatibility floor

Native WebAssembly exception handling is on by default in the published build. Consumers must run on a runtime that supports `WebAssembly.Exception`:

| Runtime       | Minimum |
| ------------- | ------- |
| Chrome / Edge | 95      |
| Firefox       | 100     |
| Safari        | 16.4    |
| Node.js       | 22      |

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

const BUILD_DIR = path.dirname(new URL(import.meta.resolve('opencascade.js/dist/opencascade_full.wasm')).pathname);
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

### B2 — Minimal transformation — class outputs mutate in place; envelopes only when JS truly needs them

> **Updated 2026-05-13 (v3.0-beta)** — supersedes the prior "Universal Input-Passthrough RBV / read from the container" contract. The intermediate "envelope mirrors every output" approach has been replaced with a minimal transformation that keeps JS signatures recognisable to OCCT users.

The codegen now emits the narrowest JS shape that faithfully represents each C++ method. Class output parameters (`gp_Pnt&`, `Bnd_Box&`, `GProp_GProps&`, `TopoDS_Shape&`, etc.) **are no longer echoed** as fields on a return envelope — the caller's instance is mutated in place and read directly from the input variable. Envelopes are emitted only when JavaScript genuinely needs a multi-field return: primitives that mutate, elided `Handle<T>&` outputs, or a mix of both alongside a native C++ return value.

Reference smoke tests: [`tests/smoke/smoke-output-params.test.ts`](tests/smoke/smoke-output-params.test.ts), [`tests/smoke/smoke-properties.test.ts`](tests/smoke/smoke-properties.test.ts), [`tests/smoke/smoke-output-params-disposal.test.ts`](tests/smoke/smoke-output-params-disposal.test.ts). Type-level contract: [`tests/output-params.test-d.ts`](tests/output-params.test-d.ts), [`tests/disposable-containers.test-d.ts`](tests/disposable-containers.test-d.ts). Bindgen-shape regression guard: [`tests/bindgen-output-shape.test.ts`](tests/bindgen-output-shape.test.ts).

**Decision tree** (the codegen applies this to every C++ method with output parameters; the resulting JS shape follows from the bullet that fires first):

| C++ return | C++ output params                                                   | Resulting JS shape                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-`void` | None                                                                | Native return (no envelope). `Curve(): Handle_Geom_Curve`                                                                                                                                                                           |
| Non-`void` | Class only (mutated in place)                                       | Native return. Read mutated classes from your input variables. `curve.D0(u, pt) → void`; `surface.D2(u, v, P, D1U, D1V, D2U, D2V, D2UV) → void`                                                                                     |
| `void`     | Class only                                                          | `void`. Read mutated classes from your input variables. `BRepBndLib.Add(shape, box, useTri) → void`                                                                                                                                 |
| Non-`void` | Primitives / enums / elided Handles (with or without class outputs) | Envelope with `returnValue` for the C++ return + one named field per non-class output. Class outputs are NOT echoed. `Surface.Bounds(u1, u2, v1, v2): { U1: number; U2: number; V1: number; V2: number; [Symbol.dispose](): void }` |
| `void`     | Primitives / enums / elided Handles (with or without class outputs) | Envelope with the same shape minus `returnValue`                                                                                                                                                                                    |

**The six return-shape rules:**

1. **Class outputs never mirror into the return envelope.** A method that previously surfaced `result.thePlane` after mutating `thePlane` now mutates the caller's `thePlane` in place and never echoes it back. Regression: `tests/bindgen-output-shape.test.ts > no envelope mirrors a concrete class output as a non-return field`.
2. **Class arguments are mutated in place.** Pass your own freshly-constructed `gp_Pnt` / `Bnd_Box` / `GProp_GProps` / `TopoDS_Shape` and read it back after the call. There is no second copy.
3. **Native return values surface directly when no envelope is required.** A method whose only outputs are class-typed (or none at all) returns its native C++ value (or `void`) — not an `{ returnValue }` wrapper.
4. **Envelopes only for primitives, elided Handles, and mixed cases.** The envelope exists when JS cannot otherwise see a primitive/Handle output, and only those non-class outputs become fields.
5. **The C++ return value lives at `envelope.returnValue`.** Renamed from the prior `result` field so it never collides with any OCCT parameter named `result`.
6. **JSDoc is explicit.** Class params that mutate in place get a `Mutated in place; read the updated value from this argument after the call.` suffix (appended to the upstream Doxygen description when present). Envelope fields get a multi-line `@returns A result object with fields:` block.

**Placeholder conventions** (only relevant for envelope outputs — primitives and elided Handles):

| Slot type                                                                                  | Passes through as                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitive (`Standard_Real&`, `Standard_Integer&`, `Standard_Boolean&`)                     | Pass any value of the type (`0`, `0.0`, `false`); read the updated value from `envelope.<FieldName>`                                                           |
| Enum output (`TopAbs_State&`, `FairCurve_AnalysisCode&`)                                   | Pass any enum value (e.g. `oc.TopAbs_State.TopAbs_IN.value`); read from `envelope.<FieldName>`                                                                 |
| Concrete class output (`gp_Pnt&`, `gp_Vec&`, `Bnd_Box&`, `GProp_GProps&`, `TopoDS_Shape&`) | **Mutated in place** — construct it, pass it, read it back from your input variable. No envelope field.                                                        |
| `Handle<T>&` output (any class)                                                            | **Position elided from the JS signature** — see [§B3](#b3--non-const-handlet-output-positions-elided-from-the-js-signature). Read from `envelope.<FieldName>`. |

**Migration table** (canonical cases):

| Method                                                                                                    | Old (`result` envelope mirrors output)                                                                               | New (minimal transformation)                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Geom_Curve.D0` (class out, void return)                                                                  | `using r = curve.D0(u, pt); console.log(r.P)`                                                                        | `curve.D0(u, pt); console.log(pt.X(), pt.Y(), pt.Z())`                                                                                                                                                                                                 |
| `Geom_Curve.D2` (3 class outs, void return)                                                               | `using r = curve.D2(u, p, v1, v2); console.log(r.P, r.V1, r.V2)`                                                     | `curve.D2(u, p, v1, v2); console.log(p.X(), v1.X(), v2.X())`                                                                                                                                                                                           |
| `Geom_Surface.Bounds` (4 primitive outs, void return)                                                     | `using r = surface.Bounds(0, 0, 0, 0); console.log(r.U1, r.U2, r.V1, r.V2)`                                          | unchanged — envelope persists for primitive outs                                                                                                                                                                                                       |
| `BRepGProp.VolumeProperties` (class out, native return)                                                   | `using r = BRepGProp.VolumeProperties(shape, props); console.log(r.VProps.Mass(), r.result)`                         | `using props = new oc.GProp_GProps(); const epsilon = BRepGProp.VolumeProperties(shape, props); console.log(props.Mass(), epsilon)`                                                                                                                    |
| `BRepBndLib.Add` (class out, void return)                                                                 | `using r = BRepBndLib.Add(shape, box, useTri); console.log(r.B.IsVoid())`                                            | `BRepBndLib.Add(shape, box, useTri); console.log(box.IsVoid())`                                                                                                                                                                                        |
| `BRep_Builder.MakeVertex` (class out, void return)                                                        | `using r = builder.MakeVertex(v, p, tol); console.log(r.V)`                                                          | `builder.MakeVertex(v, p, tol); console.log(v.IsNull())`                                                                                                                                                                                               |
| `XCAFDoc_ColorTool.GetColor` (boolean return, class out)                                                  | `using r = colorTool.GetColor(label, type, color); console.log(r.result, r.<colorField>)`                            | `const hasColor = colorTool.GetColor(label, type, color); console.log(hasColor, color.Red(), color.Green(), color.Blue())`                                                                                                                             |
| `BRep_Tool.Curve` (Handle return, 2 primitive outs, 1 class loc out)                                      | `using r = BRep_Tool.Curve(edge, loc, 0, 0); console.log(r.Curve, r.First, r.Last)`                                  | `using r = BRep_Tool.Curve(edge, loc, 0, 0); console.log(r.returnValue, r.First, r.Last)` — class `loc` is mutated in place, primitives remain enveloped, native Handle return now at `returnValue`                                                    |
| `XCAFDoc_ClippingPlaneTool.GetClippingPlane` (boolean return, 1 class out, 1 Handle out, 1 primitive out) | `using r = tool.GetClippingPlane(label, plane, capping); console.log(r.result, r.thePlane, r.theName, r.theCapping)` | `using r = tool.GetClippingPlane(label, plane, capping); console.log(r.returnValue, plane.<…>, r.theName, r.theCapping)` — `plane` mutated in place; envelope holds boolean return as `returnValue`, the Handle output, and the primitive `theCapping` |

How the C++ layer mutates a JS-supplied class argument: the codegen accepts the slot as `::emscripten::val`, then dereferences a raw-pointer cast back into the registered class instance:

```cpp
BRepBndLib::Add(S, *B.as<Bnd_Box*>(emscripten::allow_raw_pointers()), useTriangulation);
```

The `val::as<T*>(allow_raw_pointers())` + deref pattern is the only form that round-trips through embind without making a copy — `val::as<T&>()` falls back to `BindingType<T>` which copies by value and would silently lose mutations. The regression is locked down by `tests/bindgen-output-shape.test.ts > class outputs forward via *val::as<T*>(allow_raw_pointers())`.

**`using` is still required for envelope returns** that own C++ resources (Handle fields). Lint rules that enforce `using` on disposable return values are recommended for large codebases. A class-output-only method returning `void` does **not** require `using` on the call site (there is nothing disposable to track).

**Disposer idempotency** (relevant for try/finally migration paths): the envelope's `[Symbol.dispose]()` is one-shot per instance and alias-safe. Callers can invoke it manually inside try/finally **and** rely on `using` scope-exit to re-dispose without throwing `BindingError: <T> instance already deleted`.

**Action**:

1. Walk the decision tree above for each call site and determine the new return shape.
2. For class output params: stop reading from a return envelope; read directly from the input variable after the call.
3. For envelope returns: rename every `r.result` to `r.returnValue` (see [§B4](#b4--envelope-return-field-renamed-from-result-to-returnvalue)).
4. Drop any `using` declaration on calls that now return `void` or a non-disposable native value; keep `using` for envelopes and class returns that own C++ resources.

### B3 — Non-const `Handle<T>&` output positions elided from the JS signature

> **Updated 2026-05-13 (v3.0-beta)** — composes with the minimal-transformation decision tree in [§B2](#b2--minimal-transformation--class-outputs-mutate-in-place-envelopes-only-when-js-truly-needs-them). The Handle-output elision is the row that makes an envelope appear in the first place when there are no other non-class outputs.

Methods with non-const `Handle<T>&` output parameters no longer accept a JS-side placeholder for those positions. The codegen drops the Handle position from the JS-facing signature entirely; the C++ optional_override lambda declares a stack-local null Handle internally and forwards it into the call by reference. The resulting wrapper is surfaced as a container field disposed by the envelope's `[Symbol.dispose]`.

Rationale: OCCT's contract guarantees that non-const `Handle<T>&` is output-only — C++ never reads the input. The prior placeholder was a gratuitous wrapper allocation (JS Embind wrapper + C++ smart_ptr) that doubled the dispose path and produced a "double dispose stutter" when the input variable was disposed alongside the container field aliasing it. Empirical benchmarks showed ~2.29× wall-clock speedup and half the JS wrapper allocations after elision.

Reference smoke test: [`tests/smoke/smoke-handle-output-elision.test.ts`](tests/smoke/smoke-handle-output-elision.test.ts).

**Before** (under B2's universal Input-Passthrough RBV):

```ts
using poly = new oc.Poly_PolygonOnTriangulation(0, false);
using tri = new oc.Poly_Triangulation();
using r = oc.BRep_Tool.PolygonOnTriangulation(edge, poly, tri, loc);
console.log(r.P, r.T);
```

**After**:

```ts
using r = oc.BRep_Tool.PolygonOnTriangulation(edge, loc);
console.log(r.P, r.T); // freshly-assigned Handles owned by r's Symbol.dispose
// loc (a class output) is mutated in place — read its updated value directly,
// it is never echoed into r per the §B2 class-in-place rule.
```

Other affected signatures (full list materialises in `dist/opencascade_full.d.ts`):

| Method                                                | Before (placeholder-style)                                                           | After (elided)                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `GeomInt_IntSS.BuildPCurves`                          | `BuildPCurves(f, l, Tol, S, C, /* placeholder */ null)`                              | `BuildPCurves(f, l, Tol, S, C)`                              |
| `ShapeAnalysis_Edge.TreatRLine`                       | `TreatRLine(RL, S1, S2, /* placeholder */ null, null, null, tol)`                    | `TreatRLine(RL, S1, S2, tol)`                                |
| `ShapeConstruct.JoinCurves` (and many `New*` methods) | `NewCurve(edge, loc, tol, /* placeholder */ null)`                                   | `NewCurve(edge, loc, tol)`                                   |
| `HelixGeom_BuilderApproxCurve3d.ApprHelix`            | `ApprHelix(t1, t2, pitch, rStart, taper, isCW, tol, /* placeholder */ null, maxErr)` | `ApprHelix(t1, t2, pitch, rStart, taper, isCW, tol, maxErr)` |

**Placeholder table delta** (refines the `Handle<T>&` row in the [§B2 placeholder table](#b2--minimal-transformation--class-outputs-mutate-in-place-envelopes-only-when-js-truly-needs-them)):

| Slot type                                                  | Placeholder                                                                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-const `Handle<T>&` output (concrete or abstract class) | **Elided — caller passes nothing for this position. Read from `envelope.<fieldName>` (see [§B4](#b4--envelope-return-field-renamed-from-result-to-returnvalue) for the `returnValue` rename).** |

Primitive and enum output positions retain the in-passthrough placeholder contract from [§B2](#b2--minimal-transformation--class-outputs-mutate-in-place-envelopes-only-when-js-truly-needs-them); concrete-class outputs mutate in place; only `Handle<T>&` outputs are elided.

**Action**:

1. Drop every non-const `Handle<T>&` argument from your call sites; the position is no longer part of the JS signature.
2. Continue to read every result field from the returned envelope (the field name and shape are unchanged).
3. Stop allocating `new oc.Handle_*()` placeholders for output-only Handle slots — they were never used by C++ and now have no effect.

### B4 — Envelope return field renamed from `result` to `returnValue`

> **Updated 2026-05-13 (v3.0-beta)** — composes with the minimal-transformation decision tree in [§B2](#b2--minimal-transformation--class-outputs-mutate-in-place-envelopes-only-when-js-truly-needs-them).

Inside every envelope return ([§B2](#b2--minimal-transformation--class-outputs-mutate-in-place-envelopes-only-when-js-truly-needs-them) row 4 and 5), the field that surfaces the C++ method's native return value is now `returnValue` rather than `result`. The rename eliminates a long-standing collision with OCCT parameters named `result` (OCCT uses `result` as a parameter name in roughly a dozen public methods), letting both the C++ return and an OCCT-named `result` parameter coexist in the same envelope without one shadowing the other.

The rename is mechanical and applies to every envelope that carries a non-`void` C++ return alongside one or more primitive/enum/Handle outputs. Envelopes that have no C++ return value (the `void`-return + primitive-outputs row) are unaffected — they never had a `result` field.

**Migration table** (canonical cases):

| Method                                                                             | Before                              | After                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| `BRep_Tool.Curve` (Handle return + primitive outs)                                 | `r.result, r.First, r.Last`         | `r.returnValue, r.First, r.Last`         |
| `XCAFDoc_ClippingPlaneTool.GetClippingPlane` (boolean + Handle + primitive)        | `r.result, r.theName, r.theCapping` | `r.returnValue, r.theName, r.theCapping` |
| `FairCurve_Batten.Compute` (`FairCurve_AnalysisCode` enum return + primitive outs) | `r.result, r.<paramOuts>`           | `r.returnValue, r.<paramOuts>`           |
| Any other envelope that previously surfaced `r.result`                             | `r.result`                          | `r.returnValue`                          |

Envelopes whose C++ return is `void` (e.g. `Geom_Surface.Bounds`) never had a `result` field and remain unchanged — the envelope only carries the primitive/Handle outputs.

**Collision fallback** — if a future OCCT method declares a parameter named `returnValue`, the codegen falls back to a suffixed name (`returnValue_`) for the parameter so the C++ return always stays at `envelope.returnValue`. This makes `returnValue` the stable, documented field name across every release.

**Action**: regex-replace `\.result\b` → `.returnValue` in your call sites where the receiver is an envelope returned from an OCCT method. Calls that read a class output (now mutated in place; see [§B2](#b2--minimal-transformation--class-outputs-mutate-in-place-envelopes-only-when-js-truly-needs-them)) drop the `.result` access entirely.

---

## Section C — WebAssembly exception handling

### C1 — Why this changed

Upstream's exception build wrapped every potentially-throwing call site in a JavaScript `invoke_*` trampoline (`-fexceptions` / `-sDISABLE_EXCEPTION_CATCHING=0`). That added ~80% gzipped binary overhead.

v3 uses native WASM exceptions (`-fwasm-exceptions`): the `throw` and `catch` instructions live in the WASM bytecode itself, the JS trampolines disappear, and the gzipped exception overhead drops to ~12%. The happy path has zero overhead.

The shipped `full.yml` build is linked with the helpers needed to decode exceptions from JS (`-sEXPORT_EXCEPTION_HANDLING_HELPERS`). Browser support: see [Compatibility floor](#compatibility-floor).

### C2 — Catch / decode pattern (consumer-facing)

A caught exception is now a `WebAssembly.Exception`, decodable via the runtime helpers. The pattern below is the same one used by [`tests/smoke/smoke-exceptions.test.ts`](tests/smoke/smoke-exceptions.test.ts):

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
const xMin = { current: 0 },
  yMin = { current: 0 },
  zMin = { current: 0 };
const xMax = { current: 0 },
  yMax = { current: 0 },
  zMax = { current: 0 };
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

### D7 — Same-arity overload dispatch unified, legacy `int`/`size_t` pairs deduplicated

Every same-arity method-overload group is now backed by a **single** embind val-dispatcher per access mode. Previously each JS-distinguishable overload was registered as its own `.function("Name", select_overload<…>(…))` entry, and embind's method table — keyed on `(name, arity)` — silently dropped every registration except the last. The surviving overload was the only one reachable from JS, which manifested as confusing `BindingError` failures on calls that the `.d.ts` declared as valid (e.g. `XCAFDoc_ColorTool::SetColor(TopoDS_Shape, Quantity_Color, …)`, `NCollection_List_TopoDS_Shape::Append(TopoDS_Shape)`).

Two consumer-visible consequences:

1. **JS-indistinguishable primitive pairs are collapsed at codegen time.** OCCT V8's NCollection `size_t` API migration ([upstream `#1212`](https://dev.opencascade.org/content/occt-800)) introduced parallel `int`/`size_t` overloads for every indexed-container accessor (`NCollection_IndexedMap::FindKey`, `Substitute`, `RemoveLast` callsites, etc.). JS classifies both as `"number"`, so the dispatcher cannot distinguish them at runtime. The codegen now keeps the V8-modern `size_t` variant and drops the legacy `int` variant — only one entry survives per JS-equivalent signature. The `_N`-suffixed variants for these specific pairs are no longer emitted because there is no longer ambiguity to disambiguate.

2. **Mixed static + instance same-arity groups now emit both `class_function` and `function`.** A handful of OCCT classes expose `static` and non-`static` overloads with identical arity (e.g. `XCAFDoc_ColorTool::GetColor` has a `static GetColor(TDF_Label, …)` family and an instance `GetColor(TopoDS_Shape, …)` family with the same arity). Previously the entire group was registered as one instance `.function(…)` and `oc.Class.foo(...)` static call sites hit an arity mismatch. Both shapes now exist on the JS class: `oc.XCAFDoc_ColorTool.GetColor(label, type, color)` (static) and `colorTool.GetColor(shape, type, color)` (instance) both dispatch correctly.

```ts
// Before — only one survived, the rest BindingError'd at runtime.
const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
// ...
const key = map.FindKey_1(1); // worked
const key = map.FindKey_2(1); // worked
const key = map.FindKey(1); // ❌ TypeError: map.FindKey is not a function

// After — single primary entry, no suffixed variants for this group.
const key = map.FindKey(1); // ✅ dispatches to the size_t overload
```

**Action**: existing call sites that already used the unsuffixed name now succeed where they previously threw. If your code path explicitly references a `_1` / `_2` suffix on one of the JS-indistinguishable primitive-pair overloads (notably the V8 `int`/`size_t` NCollection accessors), drop the suffix — the bare name resolves to the `size_t` overload.

---

## Section E — Removed symbol families

The following families are excluded from the v3 default build entirely. Calls compile against TypeScript as `undefined` member access (no `.d.ts` declaration).

| Family                                                | Why                                                                                       | Migration                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `OpenGl_*`, `Aspect_Window`, the rest of `TKOpenGl`   | The package targets headless CAD; interactive rendering is out of scope.                  | Render with your own engine (Three.js, Babylon, etc.) using triangulation extracted via `Poly_Triangulation`. |
| `TopOpe*`                                             | Deprecated in OCCT itself; superseded by `BOPAlgo_*` and `BRepAlgoAPI_*`.                 | Use `BRepAlgoAPI_Fuse` / `Cut` / `Common` / `Section`, or the lower-level `BOPAlgo_*` machinery.              |
| Several `Standard_Transient`-based legacy collections | Deprecated in OCCT V8; the auto-discovered `NCollection_*` variants cover the same cases. | Use the `NCollection_Array1_*` / `NCollection_Sequence_*` aliases that auto-discovery now emits.              |
| `GCE2d_*` aliases                                     | OCCT V8 normalised on `GC_*2d` spellings.                                                 | Use `GC_MakeCircle2d`, `GC_MakeArcOfCircle2d`, etc.                                                           |

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

| Name               | Purpose                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `default`          | What the published tarball is built with: `-O3`, SIMD, BigInt, `EVAL_CTORS=2`, Closure, converge. |
| `O3-wasm-exc-simd` | Like `default` but with native WASM exceptions on.                                                |
| `O3-noLTO-simd`    | Performance variant, no Closure, no converge — useful when iterating on the link step.            |
| `Os-noLTO-simd`    | Size-optimised (`-Os`), still fast enough for browser delivery.                                   |
| `O0-debug`         | Fastest build, no SIMD, no exceptions — debug only.                                               |

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

| Direction | Flag                                                               |
| --------- | ------------------------------------------------------------------ |
| Removed   | `-sUSE_ES6_IMPORT_META=0` (default in Emscripten 5.x)              |
| Removed   | `-sDISABLE_EXCEPTION_CATCHING=0` (replaced by `-fwasm-exceptions`) |
| Removed   | `-fexceptions` (replaced by `-fwasm-exceptions`)                   |
| Renamed   | `-sLLD_REPORT_UNDEFINED` → `-sERROR_ON_UNDEFINED_SYMBOLS=0`        |
| Added     | `-fwasm-exceptions` (default for `full.yml`)                       |
| Added     | `-sEXPORT_EXCEPTION_HANDLING_HELPERS` (default for `full.yml`)     |
| Added     | `-sWASM_BIGINT` (default for `full.yml`)                           |
| Added     | `-sEVAL_CTORS=2` (default for `full.yml`)                          |
| Added     | `-msimd128` (default for `full.yml`)                               |

Memory flags (`-sINITIAL_MEMORY=100MB`, `-sMAXIMUM_MEMORY=4GB`, `-sALLOW_MEMORY_GROWTH=1`) are unchanged.

---

## Appendix G — Performance & size

No consumer action — included for "is upgrading worth it" context.

### Performance vs. V7.6.2

Single-threaded, `-O3` link, no LTO.

| Workload           | Improvement   |
| ------------------ | ------------- |
| Primitives         | -3% to +2%    |
| Boolean operations | 22-31% faster |
| Fillets            | 16-19% faster |
| Sketches           | 9-13% faster  |
| Complex models     | 23-29% faster |

### Size (gzipped) vs. V7.6.2

| Build                  | V7.6.2   | V8 (v3) | Change |
| ---------------------- | -------- | ------- | ------ |
| Single (no exceptions) | 6.05 MB  | 5.65 MB | -6.6%  |
| With exceptions        | 10.42 MB | 6.35 MB | -39.1% |
| Exception overhead     | +72.2%   | +12.4%  | —      |

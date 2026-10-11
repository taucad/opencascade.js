# Investigation: issues #35, #39, #40 (2026-10-11)

Reproduced against `libcascade@3.0.2` from npm (Node 22) and, for #35, a native
OCCT V8_0_1 build. Reporter projects read: `taucad/tau` (#35) and
`zoltanf/extrudo` (#40). The #39 reporter (`nl-iea`) has no public repositories.
Scripts used are in the per-issue folders next to this file.

## Summary

| Issue | Status | Root cause | Where the fix lives |
|---|---|---|---|
| #40 delete() leaks | Confirmed, worse than reported | Bindgen emits an empty `raw_destructor<T>` for ~2,100 of 5,298 classes | Codegen (`src/ocjs_bindgen`) |
| #39.1 missing `register_optional` | Confirmed (custom builds; full build masked by luck) | RBV out-param path records optional inner types only for enums | Codegen |
| #39.2 parse-stub signature | Confirmed | Stub declares `register_optional(const char*)` | Parse stub |
| #39.3 NurbsConvert trap | Confirmed on prebuilt full package | OCCT null-handle deref; not link closure, not embind | OCCT patch (`src/patches`) |
| #35 offset nondeterminism | Confirmed, root-caused, fix verified natively | OCCT iterates a pointer-hashed map in `BuildOffsetByArc` | OCCT patch |

## #40: `delete()` never runs the C++ destructor

`src/ocjs_bindgen/codegen/embind/class_.py:155-158` writes
`template<> void raw_destructor<T>(T*) { /* do nothing */ }` for any class with a
non-public destructor **or any 2-argument `operator delete`**. OCCT's
`DEFINE_STANDARD_ALLOC` always declares placement `operator delete(void*, void*)`,
so nearly every non-transient class matches: `gp_*`, `TopoDS_Shape`, all
`BRep*API` builders, `NCollection_*`, `TopExp_Explorer`.

Evidence:
- Reporter's repro reproduces exactly (Array1 128 → 1391.9 MB; Cut 128 → 382.4 MB).
- The destructor pointer for Array1, Cut, MakeFillet, MakeBox, TopoDS_Shape,
  gp_Pnt, TopExp_Explorer and STEPControl_Reader is the same wasm function whose
  body is a bare `end` (`census.mjs`, `wasmfn.cjs`).
- 2,102 of 5,298 registered classes have the empty destructor. Real destructors are
  mostly `Standard_Transient` subclasses (they inherit `operator delete`).
- Control: `gp_Pnt` ×6M grows 128 → 184 MB; `Message_ProgressRange` ×6M stays flat.
- The report's "MakeBox only leaks on custom builds" is wrong: the prebuilt leaks
  ~8.4 KB/iter too; 12k iterations fit in the 128 MB starting heap.
- Sentinel baselines already contain the empty destructors (e.g. `gp_Pnt.cpp:5635`).

Proposed fix:
- **A.** Emit the no-op only when the destructor is non-public, or when the class
  declares `operator delete` overloads and none is a public standard form
  (`(void*)`, or sized/aligned). Regenerate sentinel baselines.
- **B. (must ship with A)** Paths that hand JS pointers it does not own become
  double-frees once destructors are real: `val(&ret)` reference returns and the
  `thread_local __ocjs_ret_N` staging slots (`codegen/embind/method.py:252-326`,
  `codegen/rbv.py:113`). Return `new T(std::move(...))` where movable; mark
  reference returns as borrowed/non-owning.
- **C.** Release note (likely minor bump): code that deletes an object OCCT still
  references will now hit use-after-free rather than silently leak.
- Tests: wasm census test (must-free classes may not map to the empty destructor),
  heap-growth smoke tests (Array1, Cut, MakeBox+Shape, `using`) with heap
  pre-filled so starting headroom does not mask growth.

extrudo works around this by calling `Clear?.()` before `delete()`, and has since
moved to a C++ facade that owns all OCCT memory; they say they'd return to raw
bindings once this is fixed.

## #39

### Item 1: `register_optional<T>` missing for out-param optionals
`codegen/rbv.py:633-641` adds to `b._optional_inner_types` only for enum
out-params, so `codegen/embind/class_.py:86-94` never emits
`register_optional<double|int|bool>()` for `T&` out-params. Visible in the
sentinel baseline (`gp_Pnt.cpp:5562-5586`: lambda takes `std::optional<double>`,
no registration). The full package works only because other classes' trailing
default-arg paths register those types globally. `std::optional<gp_Pnt>` is never
emitted by this path (class out-params go through `emscripten::val`), so the
reporter's class-typed case was likely hand-written.
Fix: record the inner type for every optional out-param; add a generated-fragment
invariant test (every `std::optional<X>` in a TU has `register_optional<X>()`).

### Item 2: parse-stub signature
`src/ocjs_bindgen/ast/parse_stubs/emscripten/bind.h:84-85` declares
`register_optional(const char*)`; emsdk's is no-arg. With libclang 18.1.1 the
correct no-arg form fails the bind-symbols parse (fatal via `ast/parse.py:176-186`)
and the named form fails the real `emcc` compile, so no spelling works
(`issue39/item2.py`). Fix: `template<typename T> void register_optional() {}`;
update `walker.py:139` docstring and `parse_stubs/README.md`.

### Item 3: `BRepBuilderAPI_NurbsConvert` of a meshed B-spline solid traps
Reproduces on the prebuilt full 3.0.2 package, single and multi (box, cylinder;
sphere doesn't trap but yields a face with a null surface that traps
`BRepCheck_Analyzer`). Causal chain in OCCT V8_0_1 (unchanged on master):
1. `NewSurface` returns false for already-B-spline faces
   (`BRepTools_NurbsConvertModification.cxx:249-253`), so they never enter `myMap`.
2. `NewTriangulation` (`:369-399`) still returns true via `CopyModification`
   (`copyMesh` defaults true); `NewPolygon` (`:489-513`) guards this case.
3. `BRepTools_Modifier::Rebuild` calls `B.MakeFace(result, aTriangulation)`
   (`BRepTools_Modifier.cxx:274-283`): a mesh-only face with no surface.
4. The pcurve loop (`:505`) attaches a pcurve on that surface-less face to the
   original input edge, mutating the input shape (`probe2.mjs` shows it).
5. Next face: `IsConvert(E)` calls `aSurface->IsKind()` on the null handle
   (`…NurbsConvertModification.cxx:357`). Wasm address 0 is readable, so the
   vtable load yields garbage and the indirect call traps.

Not a link gap: links use `-sERROR_ON_UNDEFINED_SYMBOLS=1`. Workaround:
`BRepTools.Clean(shape, true)` before converting.
Fix: OCCT patch adding `if (BRep_Tool::IsGeometric(F) && !isSurfaceConverted(myMap, F)) return false;`
to `NewTriangulation` and `NewPolygonOnTriangulation`, following the existing
patch-script pattern and wired into `step_apply_patches` in `build-wasm.sh`. Not
yet compiled. Test: smoke test for box/cylinder/sphere checking no throw, valid
`BRepCheck`, non-null surfaces, and no input-edge mutation.

## #35: offset/shell results depend on heap history

Root cause is upstream OCCT, reproduced on a native x86-64 build as well:
`BRepOffset_MakeOffset::BuildOffsetByArc` (`BRepOffset_MakeOffset.cxx` ~2092)
iterates `MapSF` (`NCollection_DataMap<TopoDS_Shape, BRepOffset_Offset, TopTools_ShapeMapHasher>`)
in bucket order. `std::hash<TopoDS_Shape>` (`TopoDS_Shape.hxx:332-341`) hashes the
TShape address, so order follows allocation history. The loop appends roots to
`myImageOffset` and `myAsDes`; `MakeShells()` feeds them in that order to
`BRepTools_Quilt`, so face/edge order of the result varies and everything
order-sensitive downstream (fillet, GProp sums, serialization) differs in the
last bits.

Evidence (wasm 3.0.2): same instance 4 hashes / 8 runs; fresh instance always
identical; N unrelated warm-up ops change the result; multi-threaded identical
behaviour. Dirty-vs-clean heap with the same allocation sequence makes no
difference, so it is address order, not uninitialized memory. Fillet alone is
deterministic. Arc join (`MakeThickSolid`, `MakeOffsetShape`) varies;
Intersection join, box shells, revolve, booleans were stable in these tests.

Fix (in `issue35/`): `patch_offset_mapsf_order.py` keeps the loop body and visits
`MapSF` keys in `TopExp_Explorer` order of `myFaceComp` (faces, `NewFaces()`,
edges, vertices, then any remaining keys). Natively: shell 4 → 1 hash, shell +
fillet 3 → 1, MakeOffsetShape 11 → 1. Still needs SHA guards like the other patch
scripts, wiring into `build-wasm.sh`/`patch-state.py`, and a wasm rebuild to
confirm. Other TKOffset loops still iterate in hash order; this one loop sufficed
for these cases. Draft test: `issue35/smoke-offset-determinism.test.ts` (fails on
3.0.2 today). Once shipped, tau#243's fresh-instance-per-fixture workaround can be
re-evaluated; worth upstreaming to OCCT.

## Overlap

- **#40 ↔ #35:** no shared cause, but interacting. Today nothing is freed, so
  addresses march forward; fixing #40 changes allocation patterns and could shift
  which inputs hit #35. Land #35's patch and test before or with #40, and re-run
  the determinism test after #40.
- **#39.3 ↔ #35:** conceptual only. NurbsConvert silently mutates input shapes on
  a reused instance, another "depends on what ran before" path.
- **#39.1 + #39.2:** same feature (optional registration), one PR.
- **#39.3 + #35:** both are OCCT source patches that need a TKBRep/TKOffset
  rebuild; same patch mechanism.

## Side findings (not in any issue)

- **Custom builds default to Emscripten's 64 KB stack.** The full build uses 8 MB
  (`build-configs/full.yml:4513`, `libcascade.config.ts:4526`), but
  `@libcascade/toolchain` / `src/customBuildSchema.py` set nothing. extrudo hit
  stack overflows that corrupted static data and caused later traps. Recommend
  defaulting `STACK_SIZE` to 8 MB in the toolchain.
- **Custom builds default to dlmalloc** (`link/yaml_build.py:858`), prebuilt uses
  mimalloc.
- **Shipped `.js.symbols` is stale:** `link/yaml_build.py:879-913` runs a second
  `wasm-opt -O3` after emcc writes the symbol map, renumbering functions (map
  74,493 vs wasm 74,469). Regenerate the map after the final pass or drop it.

## Proposed fix PRs

1. **Bindgen: optional registration (#39.1, #39.2).** Small, codegen + stub only.
2. **Bindgen: real destructors and ownership (#40).** Parts A + B + tests; the
   largest and riskiest change; needs full single/multi rebuilds.
3. **OCCT patches: NurbsConvert guard (#39.3) and offset ordering (#35).** One
   PR or two sharing the patch plumbing; needs wasm rebuild.
4. **Toolchain defaults (side findings):** 8 MB stack, symbol map regeneration.
   Small; could ride with PR 1 or go to the CI thread.

Order: 1 and 4 first (cheap), then 3, then 2 (re-run #35 test after 2).

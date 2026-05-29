/**
 * Smoke test: sub-2a semantic-conflict dispatch (matrix row 7).
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - Matrix row 7 — multi-overload, overlapping arities with semantic
 *     conflict. The canonical example called out in the policy itself is
 *     `BRepMesh_IncrementalMesh` with two arity-3 / arity-5 ctor branches
 *     whose first-parameter is the same `TopoDS_Shape` but whose second
 *     parameter differs in semantics (linear deflection scalar vs
 *     IMeshTools_Parameters value object).
 *   - Per Phase 3 completion doc (`docs/research/ocjs-phase-3-val-dispatch-completion.md`
 *     §Finding 5), the row-7 classifier hook is wired
 *     (`GroupClassificationInputs.has_sibling_aliasing`) but the
 *     production sub-2a auto-detector is future work. The conservative
 *     fallback is per-overload val-default emission, which still produces
 *     correct dispatch via the existing val-discrimination machinery; the
 *     only loss is a tighter merged binding.
 *
 * Target: `BRepMesh_IncrementalMesh` constructor overload set.
 *
 * Per OCCT V8 `BRepMesh_IncrementalMesh.hxx` the ctor surface includes:
 *   - `BRepMesh_IncrementalMesh()` — default.
 *   - `BRepMesh_IncrementalMesh(const TopoDS_Shape&,
 *        Standard_Real linDef, bool isRel = false, Standard_Real angDef = 0.5,
 *        bool isInParallel = false)` — arity-5 scalar / fan-out variant.
 *   - `BRepMesh_IncrementalMesh(const TopoDS_Shape&,
 *        const IMeshTools_Parameters& theParameters,
 *        const Message_ProgressRange& theRange = Message_ProgressRange())`
 *     — arity-3 parameters-struct variant.
 *
 * The sub-2a smoking gun: a call like
 * `new oc.BRepMesh_IncrementalMesh(shape, 0.1)` is arity-2 by JS count but
 * sits at the JS-effective arity boundary where legacy fan-out used to
 * shadow one branch with the other. The test exercises every distinguishable
 * JS call shape recorded in the surface audit's row-7 enumeration.
 *
 * Pre-Phase-4 verdict:
 *   - Arity-2 with `(shape, scalar)` PASSES today through the existing
 *     fan-out emission.
 *   - Arity-3 with `(shape, params, undefined)` may FAIL because the
 *     pre-Phase-3 dispatcher's optional-wildcard short-circuit may shadow
 *     the IMeshTools_Parameters branch with the scalar branch.
 *   - Arity-5 with `(shape, scalar, isRel, angDef, isInParallel)` PASSES.
 *
 * Post-Phase-4 verdict:
 *   - All four call shapes dispatch to the correct branch. The
 *     val-default lambdas emitted per-overload distinguish on
 *     `arg1.typeOf()` (number → scalar branch, object → params branch).
 *   - The progress-range trailing default on the params branch resolves
 *     via the rule-5 strict-null lambda — `undefined` → default
 *     Message_ProgressRange; `null` → throws BindingError.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRepMesh_IncrementalMesh sub-2a semantic conflict (row 7)', () => {
  beforeAll(async () => { await initOC(); });

  it('arity-2 scalar variant: (shape, linDef) dispatches to the scalar fan-out branch', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
    using shape = box.Shape();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.25);
    using progressRange = new oc.Message_ProgressRange();
    mesh.Perform(progressRange);
    expect(mesh.IsDone()).toBe(true);
  });

  it('arity-5 scalar fan-out: (shape, linDef, isRel, angDef, isInParallel)', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
    using shape = box.Shape();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.25, false, 0.5, false);
    using progressRange = new oc.Message_ProgressRange();
    mesh.Perform(progressRange);
    expect(mesh.IsDone()).toBe(true);
  });

  it('arity-3 parameters-struct variant: (shape, IMeshTools_Parameters, progress?)', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
    using shape = box.Shape();
    using params = new oc.IMeshTools_Parameters();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, params, undefined);
    expect(mesh).toBeDefined();
  });

  it('arity-2 with undefined trailing slot routes through val-default lambda: (shape, 0.1)', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
    using shape = box.Shape();
    expect(() => new oc.BRepMesh_IncrementalMesh(shape, 0.1)).not.toThrow();
  });
});

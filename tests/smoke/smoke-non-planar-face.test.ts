/**
 * Smoke: makeNonPlanarFace bug-fix canary (replicad post-migration).
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - Matrix row 34 — multi-overload, one overload has trailing default
 *     that overlaps another's arity. Best primitive: `emscripten::val`
 *     discrimination at the trailing-default position INSIDE the
 *     existing same-name overload dispatcher.
 *
 * Replicad canary (per
 * `docs/research/ocjs-replicad-post-migration-simplifications.md`,
 * `makeNonPlanarFace` bug-fix finding): replicad currently calls
 * `new BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 1e-2, 0.1, 8, 9)`
 * — passing all 10 trailing defaults verbatim — because OCJS's
 * pre-Phase-3 `numOverloads > 1 && trailing defaults` gate excluded the
 * trailing-default expansion from emission. Phase 3 removes the gate
 * (per `docs/research/ocjs-phase-3-val-dispatch-completion.md` §Finding
 * 1) and routes the multi-overload trailing-default group through
 * `val_default.emit_method_with_val_default`; Phase 4 regeneration is
 * what materialises the change in the published WASM.
 *
 * Construction recipe (multi-edge wire + non-planar face):
 *   1. Build 4 non-coplanar gp_Pnt corners (e.g. lift the 4th point
 *      out of the plane defined by the first 3).
 *   2. Connect them via BRepBuilderAPI_MakeEdge into 4 edges.
 *   3. Sew the edges into a wire via BRepBuilderAPI_MakeWire.
 *   4. Feed the wire into BRepOffsetAPI_MakeFilling (default-arg ctor
 *      pre-Phase-4 requires all 10 args; post-Phase-4 the zero-arg
 *      form succeeds).
 *   5. Add the wire's edges to the filling builder, build, return the
 *      face.
 *
 * Pre-Phase-4 verdict: the zero-arg ctor `new BRepOffsetAPI_MakeFilling()`
 * MAY work today (the audit confirms the ctor exists at arity 0) but
 * the row-34 trailing-default `.Add(edge, order)` 2-arg call FAILS
 * (per `smoke-multioverload-trailing-defaults.test.ts` regression pin).
 * The 10-arg full-arity ctor pre-Phase-4 may or may not succeed
 * depending on the legacy fan-out emission.
 *
 * Post-Phase-4 verdict: zero-arg ctor + 2-arg `.Add(edge, order)` both
 * succeed via val-default emission; the constructed face is valid and
 * non-null.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: makeNonPlanarFace canary (row 34)', () => {
  beforeAll(async () => { await initOC(); });

  it('builds a non-planar face from a 4-edge wire — POST-PHASE-4 zero-arg ctor + 2-arg Add', () => {
    const oc = getOC();
    // 4 non-coplanar corners: the 4th point is lifted out of the
    // (z=0) plane defined by the first 3 so the wire's bounded face
    // is genuinely non-planar.
    using p0 = new oc.gp_Pnt(0, 0, 0);
    using p1 = new oc.gp_Pnt(10, 0, 0);
    using p2 = new oc.gp_Pnt(10, 10, 0);
    using p3 = new oc.gp_Pnt(0, 10, 5);

    using e0Builder = new oc.BRepBuilderAPI_MakeEdge(p0, p1);
    using e1Builder = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
    using e2Builder = new oc.BRepBuilderAPI_MakeEdge(p2, p3);
    using e3Builder = new oc.BRepBuilderAPI_MakeEdge(p3, p0);

    using e0 = e0Builder.Edge();
    using e1 = e1Builder.Edge();
    using e2 = e2Builder.Edge();
    using e3 = e3Builder.Edge();

    using wireBuilder = new oc.BRepBuilderAPI_MakeWire();
    wireBuilder.Add(e0);
    wireBuilder.Add(e1);
    wireBuilder.Add(e2);
    wireBuilder.Add(e3);
    expect(wireBuilder.IsDone()).toBe(true);
    using wire = wireBuilder.Wire();

    // Zero-arg ctor — POST-PHASE-4 — pre-Phase-4 replicad passes all 10
    // trailing defaults verbatim per the bug-fix audit. Once Phase 4
    // ships, the zero-arg ctor is the canonical call site.
    using filling = new oc.BRepOffsetAPI_MakeFilling();

    // 2-arg `.Add(edge, GeomAbs_C0)` is the row-34 trailing-default
    // collapse. Pre-Phase-4 this throws BindingError (see
    // `smoke-multioverload-trailing-defaults.test.ts`); post-Phase-4
    // the val-default lambda materialises `IsBound = true`.
    // FINDING: these 2-arg `Add(edge, Order)` shapes are type-ACCEPTED because
    // `TopoDS_Edge` is structurally assignable to `TopoDS_Face`, so each call
    // binds to the arity-2 `Add(Support: TopoDS_Face, Order)` overload at the
    // type level (no @ts-expect-error needed). This is a pure RUNTIME pin: the
    // embind dispatch routes the edge to the `(Constr, Order, IsBound)` branch
    // and throws pre-Phase-4 because IsBound is unset. It flips green once the
    // row-34 trailing default (IsBound=true) is materialised.
    expect(() => {
      filling.Add(e0, oc.GeomAbs_Shape.GeomAbs_C0);
      filling.Add(e1, oc.GeomAbs_Shape.GeomAbs_C0);
      filling.Add(e2, oc.GeomAbs_Shape.GeomAbs_C0);
      filling.Add(e3, oc.GeomAbs_Shape.GeomAbs_C0);
    }).not.toThrow();

    using progress = new oc.Message_ProgressRange();
    filling.Build(progress);
    expect(filling.IsDone()).toBe(true);
    using face = filling.Shape();
    expect(face.IsNull()).toBe(false);

    // Bound the wire-derived face area to confirm geometry built.
    using bbox = new oc.Bnd_Box();
    oc.BRepBndLib.Add(face, bbox, true);
    expect(bbox.IsVoid()).toBe(false);
  });
});

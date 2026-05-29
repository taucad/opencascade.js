/**
 * Smoke test: TR-MO (multi-overload trailing-default gate).
 *
 * Pins the defect catalogued at
 * `docs/research/ocjs-bindgen-libembind-outstanding-issues-catalog.md`
 * Finding 1 row TR-MO. Concrete target identified by Phase 0 pre-scan
 * cross-referencing OCCT source for trailing-default methods on
 * multi-overload classes:
 * `BRepOffsetAPI_MakeFilling::Add(Edge, GeomAbs_Shape, IsBound = true)`
 * (`repos/opencascade.js/deps/OCCT/src/ModelingAlgorithms/TKOffset/BRepOffsetAPI/BRepOffsetAPI_MakeFilling.hxx:168-170`).
 *
 * `BRepOffsetAPI_MakeFilling::Add` has five overloads; two carry a
 * trailing `IsBound = true` default. Because `numOverloads == 5`, the
 * gate at `src/ocjs_bindgen/codegen/bindings.py:1722` skips the
 * truncation-lambda fan-out, so the compiled binding at
 * `build/bindings/.../BRepOffsetAPI_MakeFilling.cpp:5571` emits only
 * the full-arity `select_overload<int(const TopoDS_Edge&, const GeomAbs_Shape, const bool)>`
 * form. JS callers that pass 2-arg `Add(edge, GeomAbs_C0)` therefore
 * receive a `BindingError` today even though the underlying C++
 * default would make the call meaningful.
 *
 * Counterfactual (3-arg `Add(edge, GeomAbs_C0, true)`) is the exact
 * pattern used by the existing `smoke-sweep-loft.test.ts` so we know
 * the binding is sound when called at full arity.
 *
 * Expected outcome today: the 2-arg call throws. Expected outcome
 * after the bindgen TR-MO fix lands: the 2-arg call succeeds (treats
 * `IsBound` as `true`). This test is a regression pin against the
 * current defect and will flip from failing to passing when the fix
 * is shipped.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: TR-MO multi-overload trailing-default gate', () => {
  beforeAll(async () => { await initOC(); });

  describe('BRepOffsetAPI_MakeFilling.Add(edge, order, IsBound = true)', () => {
    it('counterfactual: 3-arg full-arity call succeeds (proves binding is sound)', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt(0, 0, 0);
      using p2 = new oc.gp_Pnt(10, 0, 0);
      using em = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
      using edge = em.Edge();
      using filling = new oc.BRepOffsetAPI_MakeFilling();
      expect(() => {
        filling.Add(edge, oc.GeomAbs_Shape.GeomAbs_C0, true);
      }).not.toThrow();
    });

    it('TR-MO defect: 2-arg call should succeed (IsBound defaults to true) but throws today', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt(0, 0, 0);
      using p2 = new oc.gp_Pnt(10, 0, 0);
      using em = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
      using edge = em.Edge();
      using filling = new oc.BRepOffsetAPI_MakeFilling();
      expect(() => {
        // FINDING: the 2-arg `Add(edge, Order)` shape is type-ACCEPTED — not via
        // a trailing-default on the `(Constr, Order, IsBound)` overload, but
        // because `TopoDS_Edge` is structurally assignable to `TopoDS_Face`, so
        // the call binds to the sibling `Add(Support: TopoDS_Face, Order)` arity-2
        // overload at the type level. The type system therefore does NOT reject
        // this call (no @ts-expect-error). This is purely a RUNTIME pin: pre-Phase-4
        // the embind dispatch routes the edge to the `(Constr, Order, IsBound)`
        // branch and throws because IsBound is unset. It flips green once the
        // multi-overload trailing default (IsBound=true) is emitted.
        filling.Add(edge, oc.GeomAbs_Shape.GeomAbs_C0);
      }).not.toThrow();
    });
  });
});

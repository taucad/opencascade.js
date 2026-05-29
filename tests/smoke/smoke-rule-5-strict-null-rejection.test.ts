/**
 * Smoke test: rule-5 strict-null rejection across val-default rows.
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - **Rule 5 (strict-by-default null/undefined)**: every defaulted
 *     parameter position whose val-default lambda is NOT carved out by
 *     row 30 MUST throw `BindingError` carrying the structured message
 *     `"[rule 5 / strict null] null is not a valid value for this slot
 *     — pass undefined to use the default"` when the JS caller passes
 *     `null` explicitly.
 *
 * The exact substring is sourced verbatim from
 * `src/ocjs_bindgen/codegen/val_default.py::_val_unwrap_expr`. If the
 * lambda's error wording drifts in either direction (e.g. someone
 * removes the bracketed citation or changes the prose) this pin fires
 * to catch the silent contract break.
 *
 * Rows covered (one representative call per row — the mechanism is
 * identical and the per-row enumeration documents the matrix surface):
 *   - **Row 1** — BRepMesh_IncrementalMesh trailing scalar `isRelative`.
 *   - **Row 2** — BRepAlgoAPI_Fuse `Build(Message_ProgressRange = ...)`.
 *   - **Row 24** — BRepMesh_IncrementalMesh trailing scalar stack
 *     (multi-scalar policy flags; row 1 plus the angDef/parallel triple).
 *   - **Row 33** — IFSelect_Act.SetGroup cstring trailing default.
 *   - **Row 34** — BRepOffsetAPI_MakeFilling.Add multi-overload trailing
 *     bool slot.
 *   - **Row 36** — same mechanism as row 1 / 24 (defaulted trailing param
 *     with `= T{}`); covered representatively by the multi-scalar stack
 *     of BRepMesh.
 *
 * Pre-Phase-4 verdict:
 *   - Today the bindgen has NOT regenerated the published WASM with
 *     val_default emission for rows {1, 2, 24, 33, 34, 36}. The current
 *     dispatch behaviour for `null` at these slots is:
 *       * Row 1 / 24 / 36 — embind's primitive coercion throws
 *         `BindingError("Cannot pass null as a Standard_Boolean")` or
 *         similar; the message DOES NOT contain "null is not a valid
 *         value", so the regex pin FAILS today.
 *       * Row 2 — passing `null` for the progress-range handle slot
 *         throws `BindingError("Expected null or instance of
 *         Message_ProgressRange")` — does not match.
 *       * Row 33 — IFSelect_Act.SetGroup with `null` second arg throws
 *         a different generic BindingError today.
 *       * Row 34 — BRepOffsetAPI_MakeFilling.Add with `null` last arg
 *         throws BindingError but the regex does not match.
 *   - Every `it` in this file is therefore EXPECTED TO FAIL today and
 *     FLIP TO PASSING when the val_default lambdas land via Phase 4
 *     regeneration.
 *
 * Post-Phase-4 verdict:
 *   - Each `null` argument routes through the strict-null branch of the
 *     emitted lambda and throws `Error` with the exact prose pinned by
 *     the `RULE_5_NULL_ERROR_FRAGMENT` regex.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

const RULE_5_NULL_ERROR_FRAGMENT = /null is not a valid value/;

describe.skipIf(!wasmExists)('Smoke: rule-5 strict-null rejection across val-default rows', () => {
  beforeAll(async () => { await initOC(); });

  describe('Row 1 — single overload trailing scalar default', () => {
    it('BRepMesh_IncrementalMesh(shape, 0.1, null, undefined, undefined) throws rule-5 BindingError', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
      using shape = box.Shape();
      // @ts-expect-error - null is not a valid Standard_Boolean for isRelative (rule-5 strict null)
      expect(() => new oc.BRepMesh_IncrementalMesh(shape, 0.1, null, undefined, undefined)).toThrow(
        RULE_5_NULL_ERROR_FRAGMENT,
      );
    });
  });

  describe('Row 2 — single overload trailing value-class default', () => {
    it('BRepAlgoAPI_Fuse.Build(null) throws rule-5 BindingError', () => {
      const oc = getOC();
      using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
      using box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
      using a = box1.Shape();
      using b = box2.Shape();
      using fuse = new oc.BRepAlgoAPI_Fuse(a, b);
      // @ts-expect-error - null is not a valid Message_ProgressRange (rule-5 strict null)
      expect(() => fuse.Build.call(fuse, null)).toThrow(RULE_5_NULL_ERROR_FRAGMENT);
    });
  });

  describe('Row 24 — multi-scalar trailing default stack (policy-flag triple)', () => {
    it('BRepMesh_IncrementalMesh trailing (isRel, angDef, parallel) all-null throws rule-5 BindingError', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
      using shape = box.Shape();
      // @ts-expect-error - null is not a valid value for the trailing scalar slots (rule-5 strict null)
      expect(() => new oc.BRepMesh_IncrementalMesh(shape, 0.1, null, null, null)).toThrow(
        RULE_5_NULL_ERROR_FRAGMENT,
      );
    });
  });

  describe('Row 33 — cstring-wrapper trailing default', () => {
    it('IFSelect_Act.SetGroup("grp", null) throws rule-5 BindingError', () => {
      const oc = getOC();
      // @ts-expect-error - null is not a valid Standard_CString for the file param (rule-5 strict null)
      expect(() => oc.IFSelect_Act.SetGroup('tau-rule5-row33', null)).toThrow(RULE_5_NULL_ERROR_FRAGMENT);
    });
  });

  describe('Row 34 — multi-overload trailing default', () => {
    it('BRepOffsetAPI_MakeFilling.Add(edge, GeomAbs_C0, null) throws rule-5 BindingError', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt(0, 0, 0);
      using p2 = new oc.gp_Pnt(10, 0, 0);
      using em = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
      using edge = em.Edge();
      using filling = new oc.BRepOffsetAPI_MakeFilling();
      // @ts-expect-error - null is not a valid Standard_Boolean for IsBound (rule-5 strict null)
      expect(() => filling.Add(edge, oc.GeomAbs_Shape.GeomAbs_C0, null)).toThrow(
        RULE_5_NULL_ERROR_FRAGMENT,
      );
    });
  });

  describe('Row 36 — defaulted trailing param `= T{}` (mechanism shared with row 1/24)', () => {
    it('representative case: BRepMesh_IncrementalMesh angDef null throws rule-5 BindingError', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
      using shape = box.Shape();
      // @ts-expect-error - null is not a valid Standard_Real for theAngDeflection (rule-5 strict null)
      expect(() => new oc.BRepMesh_IncrementalMesh(shape, 0.1, undefined, null)).toThrow(
        RULE_5_NULL_ERROR_FRAGMENT,
      );
    });
  });
});

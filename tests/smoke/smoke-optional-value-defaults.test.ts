/**
 * Smoke test: value-typed (primitive + class-value) trailing-default routing
 * with rule-5 strict-null contract.
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - Matrix row 1  — single overload, trailing scalar default (val-default emission).
 *   - Matrix row 2  — single overload, trailing value-class default.
 *   - Matrix row 24 — multi-scalar trailing defaults (BRepMesh's
 *     `isRelative`, `angDef`, `isInParallel` triple).
 *   - **Rule 5 (strict-by-default null/undefined)**: this file pins that
 *     contract — `undefined` materialises the C++ default; `null` rejects
 *     with `BindingError` carrying the structured message emitted by
 *     `src/ocjs_bindgen/codegen/val_default.py::_val_unwrap_expr`.
 *
 * Targets:
 *   - `BRepMesh_IncrementalMesh(shape, linDef, isRel?, angDef?, isInParallel?)`
 *     — four trailing primitive defaults. The `linDef` is required input;
 *     the trailing three are val-default slots tagged `DEFAULT_ON_ABSENCE`
 *     with strict-null semantics (no row-30 carve-out — there is no
 *     handle-reporter slot in this signature).
 *
 *   - `BRepAlgoAPI_Fuse(s1, s2)` ctor — reserved for shape-3/4 anchor
 *     coverage once a non-RBV-blocked class-value default ships.
 *
 * Pre-Phase-4 verdict (today, against the pre-regeneration WASM):
 *   - `undefined` cases PASS by coincidence (existing fan-out + permissive
 *     silent coercion to 0/false).
 *   - `null` cases throw `BindingError("Cannot pass null as a Standard_Boolean")`
 *     or similar — NOT the rule-5 structured error. The expected message
 *     pin therefore FAILS today.
 *
 * Post-Phase-4 verdict (after big-bang regeneration with classifier-driven
 * val_default emission):
 *   - `undefined` resolves through the strict-null lambda's
 *     `isUndefined() → C++ default` branch, materialising the correct
 *     source-level default (e.g. `IsRelative = false`).
 *   - `null` resolves through the strict-null lambda's
 *     `isNull() → throw new Error(...)` branch, surfacing the structured
 *     rule-5 message verbatim.
 *
 * The expected error message is the EXACT string emitted by
 * `_val_unwrap_expr` (the `[rule 5 / strict null] ...` prose) so the test
 * pins the emitted lambda's error path and catches accidental drift in
 * the codegen wording.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

/**
 * Exact substring carried by the BindingError thrown by the val-default
 * strict-null lambda. See
 * `src/ocjs_bindgen/codegen/val_default.py::_val_unwrap_expr` for the
 * source of truth.
 */
const RULE_5_NULL_ERROR_FRAGMENT = /null is not a valid value/;

describe.skipIf(!wasmExists)('Smoke: value-typed trailing-default routing (rule 5)', () => {
  beforeAll(async () => { await initOC(); });

  describe('BRepMesh_IncrementalMesh ctor — primitive trailing defaults', () => {
    it('explicit undefined for trailing primitives: (shape, 0.1, undefined, undefined, undefined) — succeeds via C++ defaults', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using shape = box.Shape();
      using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.1, undefined, undefined, undefined);
      using progressRange = new oc.Message_ProgressRange();
      mesh.Perform(progressRange);
      expect(mesh.IsDone()).toBe(true);
    });

    it('explicit null at any trailing slot throws rule-5 BindingError: (shape, 0.1, null, null, null)', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using shape = box.Shape();
      // @ts-expect-error - null is not a valid value for the trailing primitive slots (rule-5 strict null)
      expect(() => new oc.BRepMesh_IncrementalMesh(shape, 0.1, null, null, null)).toThrow(
        RULE_5_NULL_ERROR_FRAGMENT,
      );
    });

    it('mixed explicit/omitted with null at last slot throws rule-5 BindingError: (shape, 0.1, true, undefined, null)', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using shape = box.Shape();
      // @ts-expect-error - null is not a valid Standard_Boolean for isInParallel (rule-5 strict null)
      expect(() => new oc.BRepMesh_IncrementalMesh(shape, 0.1, true, undefined, null)).toThrow(
        RULE_5_NULL_ERROR_FRAGMENT,
      );
    });
  });

  /**
   * Class-value trailing default with JS-observable default recovery
   * (matrix rows 2/36 — `T()` / static-value-returning default).
   *
   * Concrete production target (confirmed against the Phase-4 `dist/`):
   *   `Message_Attribute(const TCollection_AsciiString& theName =
   *    TCollection_AsciiString::EmptyString())`
   *
   * Source: `deps/OCCT/src/FoundationClasses/TKernel/Message/Message_Attribute.{hxx,cxx}`
   * d.ts:    `class Message_Attribute … constructor(theName?: TCollection_AsciiString)`
   *          (`dist/opencascade_full.d.ts:963-988`)
   * Binding: `build/bindings/FoundationClasses/TKernel/Message/Message_Attribute.hxx/Message_Attribute.cpp`
   *          emits the val_default lambda
   *          `([&]() -> TCollection_AsciiString { if (theName.isUndefined())
   *           return (TCollection_AsciiString::EmptyString()); if
   *           (theName.isNull()) { …throw rule-5… } return
   *           theName.as<const TCollection_AsciiString&>(); })()`.
   *
   * Why this is a non-RBV-blocked, OBSERVABLE class-value default:
   *   - `theName` is a constructor input (no output param / RBV elision),
   *     so the val_default emit site is not RBV-blocked.
   *   - The recovered default is observable from JS: `GetMessageKey()`
   *     returns `!myName.IsEmpty() ? myName.ToCString() : ""`, so an
   *     omitted `theName` materialises `TCollection_AsciiString::EmptyString()`
   *     and `GetMessageKey()` reads back `""` while `GetName().IsEmpty()`
   *     reads back `true`. Supplying a real name reads that name back —
   *     proving the `isUndefined() → default` branch is distinct from the
   *     explicit-value branch (not a spurious always-empty result).
   */
  // Activation gate: flipped true — `Message_Attribute`'s class-value
  // `= TCollection_AsciiString::EmptyString()` ctor default ships as a
  // val_default emission at a non-RBV-blocked, JS-observable site.
  const CLASS_VALUE_DEFAULT_AVAILABLE = true;

  describe.skipIf(!CLASS_VALUE_DEFAULT_AVAILABLE)('class-value defaults via real OCCT migration site (matrix rows 2/36)', () => {
    it.skipIf(!CLASS_VALUE_DEFAULT_AVAILABLE)('omitted recovers the empty-string class default; explicit null throws rule-5', () => {
      const oc = getOC();

      // (a) Omitted `theName` → val_default `isUndefined()` branch
      // materialises `TCollection_AsciiString::EmptyString()`. The
      // recovered default is observable: GetMessageKey() returns "" and
      // GetName() is empty.
      using attrDefault = new oc.Message_Attribute();
      expect(attrDefault.GetMessageKey()).toBe('');
      using defaultName = attrDefault.GetName();
      expect(defaultName.IsEmpty()).toBe(true);

      // Explicit `undefined` resolves through the same default branch.
      using attrUndefined = new oc.Message_Attribute(undefined);
      expect(attrUndefined.GetMessageKey()).toBe('');

      // (a') A supplied name reads back unchanged — proving the
      // `isUndefined() → default` branch is genuinely distinct from the
      // explicit `arg.as<const TCollection_AsciiString&>()` branch (the
      // default-recovery is not a spurious always-empty result).
      using suppliedName = new oc.TCollection_AsciiString('hatch-pattern');
      using attrNamed = new oc.Message_Attribute(suppliedName);
      expect(attrNamed.GetMessageKey()).toBe('hatch-pattern');

      // (b) Explicit `null` rejects via the val_default strict-null lambda
      // (rule 5). The .d.ts types `theName` as `TCollection_AsciiString`
      // (no `| null`), so `null` is a type error here — Pattern B.
      expect(() => {
        // @ts-expect-error - null is not a valid TCollection_AsciiString (rule-5 strict null)
        using bad = new oc.Message_Attribute(null);
        void bad;
      }).toThrow(RULE_5_NULL_ERROR_FRAGMENT);
    });
  });
});

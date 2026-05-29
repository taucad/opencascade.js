/**
 * Smoke test: matrix row 30 — permissive null carve-out for handle-reporter slots.
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - Matrix row 30 — nullable object arguments where `null` is a
 *     meaningful C++ value (handle-optional reporter pattern).
 *   - The carve-out lives in
 *     `src/ocjs_bindgen/codegen/val_default.py::_val_unwrap_expr`
 *     (`accepts_meaningful_null=True` branch) and selects the
 *     permissive `(isUndefined() || isNull()) ? D : as<T>()` lambda
 *     shape instead of the strict-by-default rule-5 lambda.
 *   - The bindgen-side opt-in source of truth is the OCCT handle
 *     reporter suffix set in
 *     `src/ocjs_bindgen/codegen/bindings.py::_ROW_30_REPORTER_HANDLE_SUFFIXES`
 *     — currently `{Message_ProgressIndicator, Message_ProgressRange,
 *     Message_Report}` (Phase 3 conservative seed).
 *
 * Production surface audit verdict
 * (`docs/research/ocjs-occt-surface-audit.md` §Per-Row Instance Counts /
 * Row 30):
 *   - "Cross-cutting policy; no surface count" — the audit was unable to
 *     enumerate a concrete row-30 instance against OCCT V8 public
 *     headers. The carve-out logic exists but currently covers a
 *     surface of approximately 4 handle-reporter trailing defaults
 *     (the explicit count is recorded in the Phase 3 doc's per-row
 *     table). Most of those are `Handle<Message_Report>` style slots
 *     emitted by data-exchange (IGES / STEP) writer classes; the audit
 *     did not pin a single canonical class name.
 *
 * Pre-Phase-4 verdict: SKIPPED. We cannot construct a row-30 call
 * shape without a confirmed production target. The skip is durable —
 * the test file documents the carve-out's existence so Phase 4 review
 * surfaces the question.
 *
 * Post-Phase-4 verdict: when a concrete row-30 production target is
 * identified (e.g. a writer class with a `Handle<Message_Report>`
 * trailing default), un-skip the `describe` block and add `it` cases
 * asserting:
 *   1. `omitted` arg → default-constructed handle (empty).
 *   2. `undefined` arg → default-constructed handle (empty).
 *   3. explicit `null` → default-constructed handle (empty); does NOT
 *      throw rule-5 BindingError (row 30 carve-out is in effect).
 *   4. explicit `Handle<T>` value → caller's reporter reaches the C++
 *      call site.
 *
 * TODO: revisit when the row-30 surface audit lands a concrete
 * production target. Surface audit follow-up tracked in
 * `repos/opencascade.js/TODO.md` under "Row 30 opt-in source".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

const RULE_5_NULL_ERROR_FRAGMENT = /null is not a valid value/;

describe.skipIf(!wasmExists)('Smoke: row-30 permissive-null carve-out', () => {
  beforeAll(async () => { await initOC(); });

  /**
   * ACTIVE carve-out-scoping pin (replaces the former `expect(true)` existence
   * stub + 3 `it.skip` production-target placeholders).
   *
   * FINDING — no concrete row-30 production target exists. A genuine search
   * (surface audit `docs/research/ocjs-occt-surface-audit.md` §Row 30 +
   * cross-checking the seed set against real OCCT call sites) shows that the
   * three reporter suffixes in the Phase-3 seed
   * (`Message_ProgressIndicator`, `Message_ProgressRange`, `Message_Report`)
   * do NOT appear as a defaulted `Handle<T>` nullable-sentinel trailing param
   * on any public binding. Their real call sites — e.g.
   * `BRepAlgoAPI_Fuse::Build(const Message_ProgressRange& = ...)` — pass the
   * reporter by const-ref VALUE (matrix row 2), not as a `Handle<T>`, so they
   * route through rule-5 strict-null, NOT the row-30 permissive carve-out.
   *
   * What this test measures (distinct from `smoke-rule-5` which pins the error
   * prose, and `smoke-optional-handle-defaults` which pins the 4-shape
   * contract): the carve-out classifier `accepts_meaningful_null` is correctly
   * scoped OUT of the value-typed reporter slot. The proof is the DIVERGENCE
   * between `undefined` and `null` on the same slot — if the carve-out were
   * (incorrectly) applied, BOTH would collapse to the default and neither
   * would throw. Observing `undefined → default (build succeeds)` while
   * `null → rule-5 BindingError` demonstrates the carve-out is OFF here.
   *
   * Pre-Phase-4: the `null` branch is EXPECTED TO FAIL the prose match (the
   * val_default lambdas have not regenerated the published WASM yet — see
   * `smoke-rule-5` header). It flips green once Phase 4 lands. The `undefined`
   * branch already succeeds today.
   *
   * Post-Phase-4 + concrete target: when a real `Handle<Message_Report>`
   * defaulted writer slot is identified, ADD a sibling `describe` asserting
   * the permissive direction (omitted/undefined/null → default empty handle,
   * no throw; explicit handle → reaches C++). Until then, pinning the
   * carve-out's non-application is the only non-fabricated coverage.
   */
  const makeFuseFixture = () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    const a = box1.Shape();
    const b = box2.Shape();
    return { a, b };
  };

  describe('carve-out scoping: value-typed reporter slot stays rule-5 strict', () => {
    it('undefined → default reporter (Build succeeds): carve-out default branch', () => {
      const { a, b } = makeFuseFixture();
      using ashape = a;
      using bshape = b;
      const oc = getOC();
      using fuse = new oc.BRepAlgoAPI_Fuse(ashape, bshape);
      expect(() => fuse.Build.call(fuse, undefined)).not.toThrow();
      expect(fuse.IsDone()).toBe(true);
    });

    it('null → rule-5 BindingError (carve-out NOT applied to value-typed slot)', () => {
      const { a, b } = makeFuseFixture();
      using ashape = a;
      using bshape = b;
      const oc = getOC();
      using fuse = new oc.BRepAlgoAPI_Fuse(ashape, bshape);
      // @ts-expect-error - null is not a valid Message_ProgressRange (rule-5 strict null; row-30 carve-out is scoped out of value-typed reporter slots)
      expect(() => fuse.Build.call(fuse, null)).toThrow(RULE_5_NULL_ERROR_FRAGMENT);
    });
  });
});

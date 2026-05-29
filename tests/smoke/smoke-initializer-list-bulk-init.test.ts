/**
 * Smoke test: `std::initializer_list<T>` bulk-init constructors (matrix row 38).
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - Matrix row 38 — constructor or method parameter typed
 *     `std::initializer_list<T>`. Best primitive: `emscripten::val` +
 *     JS-Array → element-wise `.as<T>()` iteration inside the lambda.
 *   - Per the surface audit (`docs/research/ocjs-occt-surface-audit.md`
 *     §Uncovered Shapes / Row 38) the production surface contains
 *     **61 binding emissions** of this shape, all
 *     `NCollection_List_*` / `NCollection_Sequence_*` /
 *     `NCollection_Array1_*` bulk-init ctors emitted by the
 *     NCollection auto-discovery generator. They COMPILE but are
 *     **registered-but-unreachable** from JS because embind has no
 *     built-in wire converter for `std::initializer_list<T>`.
 *
 * Target: `NCollection_List_handle_BOPDS_PaveBlock` — chosen because it
 * is one of the simplest concrete instances cited verbatim in the
 * audit and because the `BOPDS_PaveBlock` element type is a handle (the
 * audit's per-element-validation risk).
 *
 * Pre-Phase-4 verdict (with the row-38 fix NOT yet shipped):
 *   - Constructing `new oc.NCollection_List_handle_BOPDS_PaveBlock([])`
 *     THROWS `BindingError` (embind cannot lift a JS Array to a C++
 *     `std::initializer_list<T>`). The class itself IS exposed but the
 *     `std::initializer_list<T>` ctor branch is unreachable.
 *
 * Post-Phase-4 verdict (after the NCollection auto-discovery generator
 * is updated to emit the val-array adapter lambda per the audit's
 * recommendation):
 *   - `new oc.NCollection_List_handle_BOPDS_PaveBlock([])` constructs an
 *     empty list.
 *   - `new oc.NCollection_List_handle_BOPDS_PaveBlock([h1, h2, h3])`
 *     constructs a list populated with the three handles in order.
 *
 * Note: this test pins the row 38 gap; Phase 4 will require EITHER
 * implementing the val-array adapter at bindgen time OR filtering row 38
 * entirely (the auto-discovery generator emits a bulk-init ctor that
 * NCollection auto-discovery itself can drop if the `.Append` pattern
 * is the canonical user-facing API). The verdict will be decided in
 * Phase 4 review.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: std::initializer_list<T> bulk-init (row 38)', () => {
  beforeAll(async () => { await initOC(); });

  it('empty initializer list: new NCollection_List_handle_BOPDS_PaveBlock([]) — POST-PHASE-4', () => {
    const oc = getOC();
    // The .d.ts declares the initializer-list ctor
    // `constructor(theInitList: BOPDS_PaveBlock[], theAllocator?)`, so the
    // call is type-valid. Pre-Phase-4 it THROWS at runtime because embind
    // cannot lift a JS Array to a C++ `std::initializer_list<T>` (the ctor
    // is registered-but-unreachable). This pin flips green once the
    // NCollection auto-discovery generator emits the val-array adapter.
    expect(() => {
      using list = new oc.NCollection_List_handle_BOPDS_PaveBlock([]);
      expect(list).toBeDefined();
      expect(list.Size()).toBe(0);
    }).not.toThrow();
  });

  it('populated initializer list of handles — POST-PHASE-4', () => {
    const oc = getOC();
    using h1 = new oc.BOPDS_PaveBlock();
    using h2 = new oc.BOPDS_PaveBlock();
    using h3 = new oc.BOPDS_PaveBlock();
    expect(() => {
      using list = new oc.NCollection_List_handle_BOPDS_PaveBlock([h1, h2, h3]);
      expect(list).toBeDefined();
      expect(list.Size()).toBe(3);
    }).not.toThrow();
  });
});

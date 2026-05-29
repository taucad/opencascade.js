/**
 * Smoke test: lifetime & refcount safety for std::optional-wrapped class- and
 * handle-typed parameters under repeated invocation (PoC U3 + U4).
 *
 * Pins the memory-safety contract validated by
 * `repos/opencascade.js/experiments/poc-occt-integration/u1-u3-u4.test.mjs`:
 *
 *   U3 — `std::optional<T>` for class-typed T (non-trivially-destructible):
 *     per-call ctor+copy+move count balances dtor count exactly. 1000x
 *     hammer must not leak heap. Omitted-arg path never enters T's wire
 *     (nullopt path bypasses constructor entirely).
 *
 *   U4 — `std::optional<opencascade::handle<T>>`: 500x mixed-call sweep
 *     (explicit handle / null / undefined / omitted) must leave the
 *     original handle's `GetRefCount()` at baseline. Otherwise long-lived
 *     JS handles passed through optional-typed params would leak OCCT
 *     heap on the C++ side.
 *
 * Target classes:
 *   - U3 hammer: `BRepAlgoAPI_Fuse.Build(progress)` with a fresh
 *     Message_ProgressRange each call. Message_ProgressRange is a
 *     small class-typed value passed by-reference; under the post-
 *     migration emission its `optional_override` lambda will copy the
 *     JS-side wrapper into a wire-side temporary, move into the
 *     `std::optional<Message_ProgressRange>` slot, then destroy both
 *     on lambda exit. We hammer 200x (smoke-grade; the PoC's 1000x
 *     hammer takes ~5s in the PoC, 200x keeps smoke runtime acceptable)
 *     and assert no measurable heap drift via `process.memoryUsage`.
 *     This test PASSES TODAY against the standard class-wire path; it
 *     is forward-looking — a post-migration regression in
 *     `EmValOptionalType.toWireType` would surface here as memory
 *     growth.
 *
 *   - U4 refcount: validates `std::optional<opencascade::handle<T>>`
 *     wire path correctness via `GetRefCount()`. STATUS: forward-
 *     looking placeholder — no current OCJS binding emits
 *     `std::optional<opencascade::handle<T>>` as a parameter type
 *     (today all handle parameters are bare `Handle<T>`). The plain
 *     `opencascade::handle<T>` wire path through e.g.
 *     `BRepBuilderAPI_MakeEdge(handle<Geom_Curve>)` does NOT return
 *     refcount to baseline because the resulting BRep topology
 *     retains references to the curve — that test would measure
 *     OCCT ownership, not the optional-wrapped wire path. The U4
 *     test activates once bindgen migrates a method with an
 *     `optional<handle<T>>` parameter shape — see
 *     `docs/research/ocjs-optional-overload-resolution-blueprint.md`
 *     "Migration Sequence" Steps 3-4.
 *
 * Pre-migration state: U3 hammer passes; U4 refcount skipped.
 * Post-migration state: both pass. Activation of U4 follows the first
 * optional-wrapped-handle param emission in bindgen.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: std::optional<T> lifetime & refcount safety', () => {
  beforeAll(async () => { await initOC(); });

  describe('U3 — class-typed std::optional<T> hammer (Message_ProgressRange via BRepAlgoAPI_Fuse.Build)', () => {
    it('200x Build(progress) with fresh ProgressRange each call leaves heap bounded', () => {
      const oc = getOC();
      const HAMMER = 200;

      const warmups = 5;
      for (let i = 0; i < warmups; i++) {
        using a = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
        using b = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
        using ashape = a.Shape();
        using bshape = b.Shape();
        using fuse = new oc.BRepAlgoAPI_Fuse(ashape, bshape);
        using progress = new oc.Message_ProgressRange();
        fuse.Build(progress);
      }
      if (typeof globalThis.gc === 'function') globalThis.gc();
      const heapBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < HAMMER; i++) {
        using a = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
        using b = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
        using ashape = a.Shape();
        using bshape = b.Shape();
        using fuse = new oc.BRepAlgoAPI_Fuse(ashape, bshape);
        using progress = new oc.Message_ProgressRange();
        fuse.Build(progress);
        expect(fuse.IsDone()).toBe(true);
      }
      if (typeof globalThis.gc === 'function') globalThis.gc();
      const heapAfter = process.memoryUsage().heapUsed;

      // Heap drift budget: 8 MB. The hammer creates 200 fresh boxes + shapes
      // + fuses each iteration; some JS-side heap churn is expected. The
      // assertion is meant to catch ORDER-OF-MAGNITUDE regression (true
      // leak) not noise. The PoC's U3 zero-leak result was measured on
      // raw counters with no JS overhead.
      const driftBytes = heapAfter - heapBefore;
      expect(driftBytes).toBeLessThan(8 * 1024 * 1024);
    });
  });

  describe('U4 — handle refcount stability through optional-wrapped wire path', () => {
    const OPTIONAL_HANDLE_PARAM_AVAILABLE = false;

    it('GetRefCount is exposed on Standard_Transient-derived handles (precondition for U4)', () => {
      const oc = getOC();
      using gpPnt = new oc.gp_Pnt();
      using gpDir = new oc.gp_Dir(1, 0, 0);
      using ax1 = new oc.gp_Ax1(gpPnt, gpDir);
      using line = new oc.Geom_Line(ax1);
      expect(typeof line.GetRefCount).toBe('function');
      expect(line.GetRefCount()).toBeGreaterThanOrEqual(1);
    });

    it.skipIf(!OPTIONAL_HANDLE_PARAM_AVAILABLE)(
      'POST-MIGRATION ACTIVATION — 500x optional<handle<T>> call sweep returns refcount to baseline',
      () => {
        // Activate when bindgen migrates a method with an
        // `optional<handle<T>>` parameter shape. Pattern:
        //
        //   const oc = getOC();
        //   using handle = new oc.SomeStandardTransient(...);
        //   const baseline = handle.GetRefCount();
        //
        //   for (let i = 0; i < 100; i++) {
        //     oc.MigratedClass.methodWithOptionalHandle(input, handle);
        //   }
        //   for (let i = 0; i < 100; i++) {
        //     oc.MigratedClass.methodWithOptionalHandle(input, null);
        //   }
        //   for (let i = 0; i < 100; i++) {
        //     oc.MigratedClass.methodWithOptionalHandle(input, undefined);
        //   }
        //   for (let i = 0; i < 100; i++) {
        //     oc.MigratedClass.methodWithOptionalHandle(input);
        //   }
        //
        //   expect(handle.GetRefCount()).toBe(baseline);
        //
        // Activation-gate premise pin: no production method exposes an
        // `optional<handle<T>>` parameter yet. Flipping
        // OPTIONAL_HANDLE_PARAM_AVAILABLE un-skips this and fails here,
        // forcing the 500x refcount-sweep body above to be written.
        expect(OPTIONAL_HANDLE_PARAM_AVAILABLE).toBe(false);
      },
    );
  });
});

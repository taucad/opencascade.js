/**
 * Smoke test: static-method (`.class_function`) dispatch with trailing-default
 * argument omission and explicit null/undefined (PoC T2).
 *
 * Pins the contract validated by
 * `repos/opencascade.js/experiments/poc-occt-integration/t1-t4.test.mjs`
 * for the `StaticOptProbe.probe` synthetic class. Static methods go through
 * the same `$ensureOverloadTable` machinery as instance methods, so the
 * libembind v2 arity-pad hunks must fire identically on `.class_function`
 * registrations.
 *
 * Target: `BRepLib::BuildCurve3d(Edge, Tolerance = 1e-5, Continuity = GeomAbs_C1,
 *   MaxDegree = 14, MaxSegment = 0)` — a static method with FOUR trailing
 * primitive defaults. Today's .d.ts renders all four as `?:` optionals, so
 * the smoke target is the runtime DISPATCH behaviour at each arity.
 *
 * Pre-migration state (fan-out + libembind v1):
 *   - (1-arg) `BuildCurve3d(edge)` PASSES via the existing fan-out (one
 *     truncation lambda registered per defaulted arity).
 *   - (5-arg) full-arity PASSES via the unchanged full-arity binding.
 *   - Intermediate arities (2/3/4-arg) PASS via fan-out truncations.
 *   - Passing `undefined` for a numeric default silently coerces to 0
 *     today (the PoC R5 / TR-RBV note: embind's optional_override is
 *     permissive about JS undefined for primitives), which means the
 *     1-arg test below may misbehave silently — the assertion is on
 *     return-value-non-throw, not on correctness of the result, so this
 *     test will flip cleanly post-migration even though the pre-migration
 *     1-arg call also "succeeds".
 *
 * Post-migration state (libembind v2 + bindgen `std::optional` emission):
 *   - One lambda taking `std::optional<double>` etc. for each default.
 *   - Omitted args resolve via arity-pad → nullopt → `.value_or(<C++ src
 *     default expression>)` inside the lambda body. The OCCT source
 *     defaults (Tolerance=1.e-5, MaxDegree=14, etc.) reach the OCCT call.
 *
 * This file is a regression pin against the libembind dispatcher's
 * handling of `.class_function` arity-pad. Today's pre-migration suite
 * SHOULD pass these assertions because the existing fan-out already
 * registers all 5 arities (1/2/3/4/5) as separate truncation lambdas.
 * Post-migration the suite still passes (single std::optional-wrapped
 * lambda, dispatched via arity-pad). The DIFFERENCE is observable only
 * in JS-glue bytes and in the libembind patch line count, not in this
 * test's behaviour — which is exactly the desired property: the
 * dispatcher swap must be transparent at the JS surface.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: static method dispatch with trailing-default omission', () => {
  beforeAll(async () => { await initOC(); });

  /**
   * Build a single edge from two points so BuildCurve3d has something to
   * recompute the 3D curve representation for. The edge already has a 3D
   * curve from BRepBuilderAPI_MakeEdge, so BuildCurve3d is a no-op that
   * returns `true`; the value of the test is exercising the dispatcher,
   * not the geometric outcome.
   */
  const makeEdge = () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt(0, 0, 0);
    using p2 = new oc.gp_Pnt(10, 0, 0);
    using maker = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
    return maker.Edge();
  };

  describe('BRepLib.BuildCurve3d(Edge, Tolerance?, Continuity?, MaxDegree?, MaxSegment?)', () => {
    it('arity-1: BuildCurve3d(edge) — all four trailing defaults omitted', () => {
      const oc = getOC();
      using edge = makeEdge();
      const result = oc.BRepLib.BuildCurve3d(edge);
      expect(typeof result).toBe('boolean');
    });

    it('arity-2: BuildCurve3d(edge, 1e-5)', () => {
      const oc = getOC();
      using edge = makeEdge();
      const result = oc.BRepLib.BuildCurve3d(edge, 1e-5);
      expect(typeof result).toBe('boolean');
    });

    it('arity-3: BuildCurve3d(edge, 1e-5, GeomAbs_C1)', () => {
      const oc = getOC();
      using edge = makeEdge();
      const result = oc.BRepLib.BuildCurve3d(edge, 1e-5, oc.GeomAbs_Shape.GeomAbs_C1);
      expect(typeof result).toBe('boolean');
    });

    it('arity-4: BuildCurve3d(edge, 1e-5, GeomAbs_C1, 14)', () => {
      const oc = getOC();
      using edge = makeEdge();
      const result = oc.BRepLib.BuildCurve3d(edge, 1e-5, oc.GeomAbs_Shape.GeomAbs_C1, 14);
      expect(typeof result).toBe('boolean');
    });

    it('arity-5: BuildCurve3d(edge, 1e-5, GeomAbs_C1, 14, 0) — full arity', () => {
      const oc = getOC();
      using edge = makeEdge();
      const result = oc.BRepLib.BuildCurve3d(edge, 1e-5, oc.GeomAbs_Shape.GeomAbs_C1, 14, 0);
      expect(typeof result).toBe('boolean');
    });

    it('explicit undefined for trailing primitive: BuildCurve3d(edge, undefined, undefined, undefined, undefined)', () => {
      const oc = getOC();
      using edge = makeEdge();
      // The static `BRepLib.BuildCurve3d` binding declares all four trailing
      // defaults as optional params
      // `(E, Tolerance?, Continuity?, MaxDegree?, MaxSegment?)`, so the
      // explicit-undefined call shape is type-valid and routes through the
      // runtime fan-out to the OCCT default arguments.
      const result = oc.BRepLib.BuildCurve3d(edge, undefined, undefined, undefined, undefined);
      expect(typeof result).toBe('boolean');
    });
  });
});

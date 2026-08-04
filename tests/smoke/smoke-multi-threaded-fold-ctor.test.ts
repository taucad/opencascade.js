/**
 * Smoke test: multi-threaded constructor-fold registration.
 *
 * Regression pin for the pthread-only duplicate same-arity `emscripten::val`
 * constructor registration crash fixed in
 * `src/ocjs_bindgen/codegen/embind/constructor.py` (the `forbidden_arities`
 * precondition + fold mechanism: `_merged_default_aware_tree`,
 * `_primary_vs_fallback_guard`, `_emit_primary_chain_with_fallback`,
 * `_emit_merged_arity_dispatch`).
 *
 * The defect: when a sub-2a (cross-arity) or sub-2b (sibling-aliasing)
 * conflict pair's LARGER arity already hosts a multi-ctor per-arity group,
 * the old code emitted TWO `(emscripten::val …)` lambda registrations at the
 * same arity. Embind rejects duplicate same-arity constructor registrations
 * ("Cannot register multiple constructors with identical number of
 * parameters"). The fix folds the smaller ctor into the larger arity's
 * merged dispatch so exactly ONE val-ctor registration is emitted per arity.
 *
 * Why this must run on the MULTI build: the single-threaded binary compiles
 * with `-sEVAL_CTORS=2` (`build-configs/full.yml`), so the embind
 * registration global ctors are evaluated at BUILD time and the duplicate is
 * silently elided. The multi-threaded binary DROPS `-sEVAL_CTORS=2`
 * (`build-configs/full_multi.yml`: "ctor evaluation order is
 * non-deterministic under pthread workers") and pre-spawns a worker per CPU
 * via `-sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency`. The embind class
 * registrations therefore run at RUNTIME during module instantiation, so a
 * regressed duplicate registration throws a `BindingError` during
 * `initOCMulti()` — on the main module init AND in every pre-spawned pthread
 * worker that re-runs the registration. The single build cannot observe this.
 *
 * Target fold-path class: `GeomAPI_PointsToBSpline`. Per the bindgen fold
 * diagnostics captured during regeneration, this class folds a sub-2a pair
 * into its arity-6 per-arity dispatch (the arity-6 bucket hosts ≥2
 * full-arity ctors — the `(Points, ParType, …)` and `(Points, Parameters,
 * …)` variants — so the smaller `(Points, DegMin?, DegMax?, Continuity?,
 * Tol3D?)` ctor is relocated as the merged-dispatch fallback rather than
 * emitting a colliding standalone coordinator). The class is also cheap to
 * construct (a small `NCollection_Array1_gp_Pnt`) and yields an observable
 * result (`IsDone()` + a real `Geom_BSplineCurve`).
 *
 * Harness note (pthread context): Node hosts emscripten pthread workers
 * directly (SharedArrayBuffer is available without cross-origin isolation),
 * which is why `dist/opencascade_full_multi.*` boots and `OSD_ThreadPool`
 * reports > 1 worker under vitest. The strongest assertion the harness
 * supports is therefore: (1) the MULTI module initializes (runtime embind
 * registration of every folded class succeeds on the main module and the
 * pre-spawned workers), (2) the fold-path class constructs across multiple
 * registered arities, and (3) it still constructs after an explicit thread
 * pool spin-up that forces OCCT worker activity. We cannot drive JS-level
 * construction from inside a pthread worker, but the duplicate-registration
 * defect manifests at worker *init* (registration), which init + pool
 * spin-up exercises.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOCMulti, getOCMulti, multiWasmExists } from './helpers.js';

const sabAvailable = typeof SharedArrayBuffer !== 'undefined';

function buildPoints(oc: ReturnType<typeof getOCMulti>): InstanceType<ReturnType<typeof getOCMulti>['NCollection_Array1_gp_Pnt']> {
  const points = new oc.NCollection_Array1_gp_Pnt(1, 5);
  const coords: readonly [number, number, number][] = [
    [0, 0, 0],
    [1, 2, 0],
    [2, -1, 0],
    [3, 3, 0],
    [4, 0, 0],
  ];
  for (let i = 0; i < coords.length; i++) {
    using pt = new oc.gp_Pnt(coords[i]![0], coords[i]![1], coords[i]![2]);
    points.SetValue(i + 1, pt);
  }
  return points;
}

describe.skipIf(!multiWasmExists)('Smoke: multi-threaded fold-path ctor registration', () => {
  beforeAll(async () => {
    // Module init runs the runtime embind registration (EVAL_CTORS dropped on
    // the MT build). A regressed duplicate same-arity val-ctor registration
    // for a fold-path class would throw here.
    await initOCMulti();
  });

  it('the multi module initializes — runtime embind registration of folded ctors succeeds', () => {
    const oc = getOCMulti();
    expect(typeof oc.GeomAPI_PointsToBSpline).toBe('function');
  });

  it('constructs GeomAPI_PointsToBSpline via the folded smaller ctor (Points only)', () => {
    const oc = getOCMulti();
    using points = buildPoints(oc);
    using approx = new oc.GeomAPI_PointsToBSpline(points);
    expect(approx.IsDone()).toBe(true);
    // Curve() returns the dereferenced Geom_BSplineCurve; a real built curve
    // reports a positive degree.
    using curve = approx.Curve();
    expect(curve.Degree()).toBeGreaterThanOrEqual(1);
  });

  it('constructs GeomAPI_PointsToBSpline via the merged same-arity primary chain (Points, DegMin, DegMax, Continuity, Tol3D)', () => {
    const oc = getOCMulti();
    using points = buildPoints(oc);
    using approx = new oc.GeomAPI_PointsToBSpline(points, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, 1.0e-3);
    expect(approx.IsDone()).toBe(true);
    using curve = approx.Curve();
    expect(curve.Degree()).toBeGreaterThanOrEqual(3);
  });

  it.skipIf(!sabAvailable)(
    'fold-path ctor still constructs after an explicit pthread pool spin-up',
    () => {
      const oc = getOCMulti();
      using pool = oc.OSD_ThreadPool.DefaultPool(-1);
      expect(pool.NbThreads()).toBeGreaterThan(1);

      using points = buildPoints(oc);
      using approx = new oc.GeomAPI_PointsToBSpline(points);
      expect(approx.IsDone()).toBe(true);
      using curve = approx.Curve();
      expect(curve.Degree()).toBeGreaterThanOrEqual(1);
    },
    60_000,
  );
});

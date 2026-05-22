/**
 * Smoke: ExtremaPC_Circle Point-Curve extrema computation.
 *
 * Exercises `Perform()` end-to-end against the mechanically-bound
 * `ExtremaPC::Result` / `ExtremaPC::ExtremumResult` namespace-scoped types
 * (post-R7: namespace-aware codegen + nested-class-template specialization
 * support; see `src/TuInfo.py`, `src/bindings.py::getClassJsPublicName`),
 * and keeps `Value` / `IsBounded` as supplementary coverage.
 *
 * Result / ExtremumResult / SearchMode are now sourced directly from the
 * emitted `.d.ts` — the previously hand-rolled local interfaces drifted
 * (e.g. `Status: number` while the codegen emits the embind enum
 * `ExtremaPC_Status` as the string spelling), producing TS2352 narrowing
 * errors during `vitest --typecheck`. The bindgen-emitted
 * `NCollection_DynamicArray_ExtremaPC_ExtremumResult.Value()` still returns
 * `unknown` (NCollection template-arg resolution residual), so callsites
 * narrow that single result to `ExtremaPC_ExtremumResult` at the use site.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import type {
  ExtremaPC_ExtremumResult,
  ExtremaPC_SearchMode,
} from '../../build-configs/opencascade_full.js';

describe.skipIf(!wasmExists)('Smoke: ExtremaPC circle', () => {
  beforeAll(async () => {
    await initOC();
  });

  it('Value samples the circle; full circle is unbounded in parameter', () => {
    const oc = getOC();
    using gpPnt = new oc.gp_Pnt(0, 0, 0);
    using gpDir = new oc.gp_Dir(0, 0, 1);
    using ax = new oc.gp_Ax2(gpPnt, gpDir);
    using circ = new oc.gp_Circ(ax, 5);
    using ex = new oc.ExtremaPC_Circle(circ);

    expect(ex.IsBounded()).toBe(false);

    using at0 = ex.Value(0);
    expect(at0.X()).toBeCloseTo(5, 5);
    expect(at0.Y()).toBeCloseTo(0, 5);
    expect(at0.Z()).toBeCloseTo(0, 5);

    using atPi = ex.Value(Math.PI);
    expect(atPi.X()).toBeCloseTo(-5, 5);
    expect(atPi.Y()).toBeCloseTo(0, 5);
  });

  it('Perform finds finite min/max extrema for an off-axis query point', () => {
    const oc = getOC();
    using gpPnt2 = new oc.gp_Pnt(0, 0, 0);
    using gpDir2 = new oc.gp_Dir(0, 0, 1);
    using ax = new oc.gp_Ax2(gpPnt2, gpDir2);
    using circ = new oc.gp_Circ(ax, 5);
    using ex = new oc.ExtremaPC_Circle(circ);

    using queryPoint = new oc.gp_Pnt(10, 0, 0);
    const tol = 1e-7;
    const searchMode: ExtremaPC_SearchMode = 'MinMax';
    using res = ex.Perform(queryPoint, tol, searchMode);

    expect(res.IsDone()).toBe(true);
    expect(res.IsInfinite()).toBe(false);
    const nb = res.NbExt();
    expect(nb).toBeGreaterThanOrEqual(2);

    // Min distance to the circle is |10 - 5| = 5; max is |10 + 5| = 15.
    expect(Math.sqrt(res.MinSquareDistance())).toBeCloseTo(5, 4);
    expect(Math.sqrt(res.MaxSquareDistance())).toBeCloseTo(15, 4);

    const minExt = res.Extrema.Value(res.MinIndex()) as ExtremaPC_ExtremumResult;
    expect(minExt.IsMinimum).toBe(true);
    const minPt = minExt.Point;
    expect(minPt.X()).toBeCloseTo(5, 4);
    expect(minPt.Y()).toBeCloseTo(0, 4);
    expect(minPt.Z()).toBeCloseTo(0, 4);

    const maxExt = res.Extrema.Value(res.MaxIndex()) as ExtremaPC_ExtremumResult;
    expect(maxExt.IsMinimum).toBe(false);
    const maxPt = maxExt.Point;
    expect(maxPt.X()).toBeCloseTo(-5, 4);
    expect(maxPt.Y()).toBeCloseTo(0, 4);
  });

  it('Perform reports infinite solutions for a point at the circle centre', () => {
    const oc = getOC();
    using gpPnt3 = new oc.gp_Pnt(0, 0, 0);
    using gpDir3 = new oc.gp_Dir(0, 0, 1);
    using ax = new oc.gp_Ax2(gpPnt3, gpDir3);
    using circ = new oc.gp_Circ(ax, 5);
    using ex = new oc.ExtremaPC_Circle(circ);

    using queryPoint = new oc.gp_Pnt(0, 0, 0);
    const searchMode: ExtremaPC_SearchMode = 'MinMax';
    using res = ex.Perform(queryPoint, 1e-7, searchMode);

    expect(res.IsDone()).toBe(false);
    expect(res.IsInfinite()).toBe(true);
    expect(res.InfiniteSquareDistance).toBeCloseTo(25, 4);
  });
});

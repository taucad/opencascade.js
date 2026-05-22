// Pattern 1 — Input loops.
// Ported from replicad/packages/replicad/src/shapeHelpers.ts (makeBSplineApproximation).
// Replaces replicad's `localGC` plumbing with ES2026 `using` declarations.
//
// This is the canonical "naive" baseline: build an NCollection_Array1<gp_Pnt> in
// JavaScript and SetValue() each element through embind.
import { asPnt } from './setup.mjs';

/**
 * Build a B-spline curve approximation through the supplied 3D points.
 * Returns the resulting OCCT Edge handle (caller must dispose).
 */
export function makeBSplineApproximation(oc, points, opts = {}) {
  const {
    tolerance = 1e-3,
    smoothing = null,
    degMax = 6,
    degMin = 1,
  } = opts;

  using pnts = new oc.NCollection_Array1_gp_Pnt(1, points.length);

  // Per-element SetValue: this is the Pattern 1 hot loop we're measuring.
  for (let i = 0; i < points.length; i++) {
    using p = asPnt(oc, points[i]);
    pnts.SetValue(i + 1, p);
  }

  let splineBuilder;
  if (smoothing) {
    splineBuilder = new oc.GeomAPI_PointsToBSpline(
      pnts,
      smoothing[0],
      smoothing[1],
      smoothing[2],
      degMax,
      oc.GeomAbs_Shape.GeomAbs_C2,
      tolerance,
    );
  } else {
    splineBuilder = new oc.GeomAPI_PointsToBSpline(
      pnts,
      degMin,
      degMax,
      oc.GeomAbs_Shape.GeomAbs_C2,
      tolerance,
    );
  }

  try {
    if (!splineBuilder.IsDone()) throw new Error('B-spline approximation failed');
    using splineGeom = splineBuilder.Curve();
    using maker = new oc.BRepBuilderAPI_MakeEdge(splineGeom);
    return maker.Edge();
  } finally {
    splineBuilder.delete();
  }
}

/**
 * Pattern 1 (Strategy D variant): build the same B-spline by passing the
 * point array as a flat Float64Array buffer through a Strategy-D adapter.
 * The C++ side reconstructs the NCollection_Array1<gp_Pnt> in one shot,
 * eliminating the per-element SetValue cost.
 */
export function makeBSplineApproximationStrategyD(oc, points, opts = {}) {
  const {
    tolerance = 1e-3,
    degMax = 6,
    degMin = 1,
  } = opts;

  // Flatten + stage into wasm linear memory: one malloc + one HEAPF64.set,
  // then a single C++ adapter call that reconstructs the OCCT array in C++.
  // This is the canonical Strategy D ingress pattern.
  const n = points.length;
  const bytes = n * 3 * 8;
  const ptr = oc._malloc(bytes);
  const offset = ptr >>> 3;
  const heap = oc.HEAPF64;
  for (let i = 0; i < n; i++) {
    heap[offset + i * 3 + 0] = points[i][0];
    heap[offset + i * 3 + 1] = points[i][1];
    heap[offset + i * 3 + 2] = points[i][2];
  }
  try {
    return oc.ReplicadAdapters.makeBSplineEdgeFromCoords(ptr, n, degMin, degMax, tolerance);
  } finally {
    oc._free(ptr);
  }
}

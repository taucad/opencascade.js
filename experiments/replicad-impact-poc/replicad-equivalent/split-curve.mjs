// Pattern 2 — Pass-through (the regression-risk hot path).
// Ported from replicad/packages/replicad/src/lib2d/Curve2D.ts (splitAt BSPLINE branch).

/**
 * STATUS QUO — direct OCCT NCollection handle pass-through. The adapter is
 * not involved on the read side; only the rebuild constructor.
 */
export function splitBSplineCurveStatusQuo(oc, sourceBSpline, first, last, precision = 1e-9) {
  using poles = sourceBSpline.Poles();
  using knots = sourceBSpline.Knots();
  using mults = sourceBSpline.Multiplicities();
  const degree = sourceBSpline.Degree();
  const isPeriodic = sourceBSpline.IsPeriodic();
  const copy = new oc.Geom2d_BSplineCurve(poles, knots, mults, degree, isPeriodic);
  copy.Segment(first, last, precision);
  return copy;
}

/**
 * NAIVE Strategy D — materialize Poles/Knots/Multiplicities into JS typed
 * arrays, re-stage them into wasm linear memory, rebuild via the adapter.
 * Designed to demonstrate the worst-case regression for the pass-through
 * hot path.
 */
export function splitBSplineCurveNaiveD(oc, sourceBSpline, first, last, precision = 1e-9) {
  using polesEnv = oc.ReplicadAdapters.bsplinePoles2dAsArray(sourceBSpline);
  using knotsEnv = oc.ReplicadAdapters.bsplineKnots2dAsArray(sourceBSpline);
  using multsEnv = oc.ReplicadAdapters.bsplineMults2dAsArray(sourceBSpline);

  // Take views and copy to JS arrays — this is the deliberate regression.
  const polesView = oc.HEAPF64.subarray(polesEnv.getPtr() / 8, polesEnv.getPtr() / 8 + polesEnv.getSize());
  const knotsView = oc.HEAPF64.subarray(knotsEnv.getPtr() / 8, knotsEnv.getPtr() / 8 + knotsEnv.getSize());
  const multsView = oc.HEAP32.subarray(multsEnv.getPtr() / 4, multsEnv.getPtr() / 4 + multsEnv.getSize());

  // Materialize into fresh JS-owned typed arrays (the actual cost of
  // round-tripping through JS).
  const polesJS = new Float64Array(polesView);
  const knotsJS = new Float64Array(knotsView);
  const multsJS = new Int32Array(multsView);

  // Re-stage into wasm linear memory for the rebuild.
  const polesPtr = oc._malloc(polesJS.length * 8);
  oc.HEAPF64.set(polesJS, polesPtr / 8);
  const knotsPtr = oc._malloc(knotsJS.length * 8);
  oc.HEAPF64.set(knotsJS, knotsPtr / 8);
  const multsPtr = oc._malloc(multsJS.length * 4);
  oc.HEAP32.set(multsJS, multsPtr / 4);

  try {
    return oc.ReplicadAdapters.makeBSpline2dFromArrays(
      polesPtr, polesJS.length,
      knotsPtr, knotsJS.length,
      multsPtr, multsJS.length,
      sourceBSpline.Degree(), sourceBSpline.IsPeriodic(),
      first, last, precision,
    );
  } finally {
    oc._free(polesPtr);
    oc._free(knotsPtr);
    oc._free(multsPtr);
  }
}

/**
 * SPLIT-API Strategy D — single adapter call that performs the entire
 * pass-through copy in C++. No NCollection ever surfaces to JS.
 */
export function splitBSplineCurveSplitApiD(oc, sourceBSpline, first, last, precision = 1e-9) {
  return oc.ReplicadAdapters.splitBSpline2dViaHandles(sourceBSpline, first, last, precision);
}

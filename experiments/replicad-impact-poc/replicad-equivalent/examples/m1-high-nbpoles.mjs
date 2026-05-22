// M1 — High-NbPoles synthetic 2D BSpline for Pattern 2 (pass-through) sweep.
//
// Purpose: validate where naive-D (materialize Poles/Knots/Multiplicities into
// JS) crosses over from "negligible regression" to "meaningful regression"
// vs. status quo, and confirm split-API-D recovers status-quo performance
// across the same NbPoles axis.
//
// Build pipeline:
//   1. Sample N points on a smoothly-varying 2D curve (a perturbed circle).
//   2. Geom2dAPI_Interpolate -> Geom2d_BSplineCurve (NbPoles ≈ N + 2).
//   3. Apply a `.Segment(first, last)` operation using the chosen strategy:
//        A          — status quo: source.Poles/Knots/Multiplicities + new BSpline ctor
//        naive-D    — bsplinePoles2dAsArray + bsplineMults2dAsArray + makeBSpline2dFromArrays
//        split-API-D— splitBSpline2dViaHandles (single C++ call)
//
// The "shape" returned is the segmented Geom2d_BSplineCurve. We surface a
// minimal `meshSurrogate` (the curve's NbPoles + the bbox of its sampled
// points) so the bench harness can hash it for parity, and so the result
// has the same "buildMs + parityHash" shape as other M-models.
import {
  splitBSplineCurveStatusQuo,
  splitBSplineCurveNaiveD,
  splitBSplineCurveSplitApiD,
} from '../split-curve.mjs';
import { interpolatePoints2d } from '../helpers.mjs';

export const defaultParams = {
  nbInputPoints: 100,  // controls NbPoles (≈ nbInputPoints + 2 non-periodic)
  segmentFirst: 0.1,   // parameter at which to start the .Segment range
  segmentLast: 0.9,    // parameter at which to end the .Segment range
  perturbAmplitude: 0.3,
  perturbFrequency: 7,
  radius: 10,
};

/**
 * Build the source 2D BSpline curve from N points on a perturbed circle.
 * The perturbation prevents the interpolator from collapsing to a trivial
 * arc (which would make NbPoles much smaller than the input count).
 */
export function buildSourceCurve(oc, p = defaultParams) {
  const pts = new Array(p.nbInputPoints);
  for (let i = 0; i < p.nbInputPoints; i++) {
    const t = (2 * Math.PI * i) / (p.nbInputPoints - 1);
    const r = p.radius + p.perturbAmplitude * Math.sin(p.perturbFrequency * t);
    pts[i] = [r * Math.cos(t), r * Math.sin(t)];
  }
  return interpolatePoints2d(oc, pts, false, 1e-7);
}

/**
 * Full pipeline: build source curve + apply split strategy + return a
 * mesh-surrogate object suitable for parity hashing in the bench harness.
 *
 * `strategy` ∈ {'A', 'naive-D', 'split-API-D'}.
 */
export function runM1HighNbPoles(oc, { strategy = 'A', params = defaultParams } = {}) {
  using source = buildSourceCurve(oc, params);
  const nbPolesSrc = source.NbPoles();

  let segmented;
  switch (strategy) {
    case 'A':
      segmented = splitBSplineCurveStatusQuo(oc, source, params.segmentFirst, params.segmentLast);
      break;
    case 'naive-D':
      segmented = splitBSplineCurveNaiveD(oc, source, params.segmentFirst, params.segmentLast);
      break;
    case 'split-API-D':
      segmented = splitBSplineCurveSplitApiD(oc, source, params.segmentFirst, params.segmentLast);
      break;
    default:
      throw new Error(`unknown strategy: ${strategy}`);
  }

  using seg = segmented;
  const nbPolesSeg = seg.NbPoles();
  const degree = seg.Degree();
  // Surrogate: sample the curve at 16 parametric points to give the bench
  // harness something deterministic to hash for parity.
  const fmin = seg.FirstParameter();
  const fmax = seg.LastParameter();
  const samples = new Float32Array(16 * 2);
  for (let i = 0; i < 16; i++) {
    const t = fmin + ((fmax - fmin) * i) / 15;
    using p = seg.Value(t);
    samples[i * 2 + 0] = p.X();
    samples[i * 2 + 1] = p.Y();
  }
  return {
    vertices: samples,
    triangles: new Uint32Array(0),
    normals: new Float32Array(0),
    faceGroups: [],
    meta: { nbPolesSrc, nbPolesSeg, degree },
  };
}

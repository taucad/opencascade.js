// Pattern 2 — Pass-through: Geom2d_BSplineCurve.{Poles,Knots,Multiplicities}
// flowing back into a fresh Geom2d_BSplineCurve constructor.
//
// The user explicitly required *both* variants:
//   - Naive Strategy D: materializes Poles/Knots/Mults to JS arrays + flushes back.
//                       Empirical regression baseline.
//   - Split-API D:      keeps the pass-through in C++ (one call, zero JS arrays).
//                       Empirical mitigation that should match status quo.
import { loadOC } from '../../replicad-equivalent/setup.mjs';
import {
  splitBSplineCurveStatusQuo,
  splitBSplineCurveNaiveD,
  splitBSplineCurveSplitApiD,
} from '../../replicad-equivalent/split-curve.mjs';
import { bench, printResult, verdict } from '../harness.mjs';

const oc = await loadOC();

function buildSourceBSpline(npts) {
  using array = new oc.NCollection_Array1_gp_Pnt2d(1, npts);
  for (let i = 0; i < npts; i++) {
    const t = (i / (npts - 1)) * 2 * Math.PI;
    using p = new oc.gp_Pnt2d(Math.cos(t) * 50, Math.sin(t) * 50);
    array.SetValue(i + 1, p);
  }
  using builder = new oc.Geom2dAPI_PointsToBSpline(array, 1, 6, oc.GeomAbs_Shape.GeomAbs_C2, 0.001);
  return builder.Curve(); // caller owns
}

const SIZES = [32, 128, 512, 2048];
const ITERATIONS = 50;

const allResults = [];

for (const n of SIZES) {
  using src = buildSourceBSpline(n);
  const first = src.FirstParameter() + 0.05 * (src.LastParameter() - src.FirstParameter());
  const last = src.FirstParameter() + 0.95 * (src.LastParameter() - src.FirstParameter());

  console.log(`\n=== Pattern 2 — split BSpline curve of ${n} input pts (NbPoles=${src.NbPoles()}) ===`);

  const a = await bench('Strategy A (status quo)', oc, ITERATIONS, () => {
    using copy = splitBSplineCurveStatusQuo(oc, src, first, last, 1e-9);
    return copy;
  });
  printResult(a);

  const naive = await bench('Naive D (regression!)', oc, ITERATIONS, () => {
    using copy = splitBSplineCurveNaiveD(oc, src, first, last, 1e-9);
    return copy;
  });
  printResult(naive);

  const split = await bench('Split-API D (mitigation)', oc, ITERATIONS, () => {
    using copy = splitBSplineCurveSplitApiD(oc, src, first, last, 1e-9);
    return copy;
  });
  printResult(split);

  const vNaive = verdict('A→naiveD', a, naive);
  const vSplit = verdict('A→split-API D', a, split);
  console.log(`  → ${vNaive.label}: ${vNaive.changePct} (${vNaive.assessment})`);
  console.log(`  → ${vSplit.label}: ${vSplit.changePct} (${vSplit.assessment})`);

  allResults.push({
    pattern: 'P2', n, nbPoles: src.NbPoles(),
    statusQuo: a, naiveD: naive, splitApiD: split,
    verdicts: { naive: vNaive, split: vSplit },
  });
}

export default allResults;

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nDONE — Pattern 2 micro-bench complete.');
}

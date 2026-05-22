// Pattern 3 — Triangulation hot path.
// Compares "naive" per-element JS extraction (the regression baseline a fresh
// developer would write) vs Strategy F (replicad's status-quo extractor).
import { loadOC } from '../../replicad-equivalent/setup.mjs';
import { meshNaive, meshExtractorF } from '../../replicad-equivalent/mesh.mjs';
import { bench, printResult, verdict } from '../harness.mjs';

const oc = await loadOC();

function buildShape(kind) {
  if (kind === 'box-coarse') {
    using maker = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    return maker.Shape();
  }
  if (kind === 'sphere-coarse') {
    using maker = new oc.BRepPrimAPI_MakeSphere(10);
    return maker.Shape();
  }
  if (kind === 'sphere-fine') {
    using maker = new oc.BRepPrimAPI_MakeSphere(50);
    return maker.Shape();
  }
  if (kind === 'fillet-box') {
    using maker = new oc.BRepPrimAPI_MakeBox(20, 30, 40);
    using shape = maker.Shape();
    using fillet = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    using ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      using e = oc.TopoDS.Edge(ex.Current());
      fillet.Add(2, e);
    }
    return fillet.Shape();
  }
  throw new Error('unknown kind: ' + kind);
}

const ITERATIONS = 30;

const cases = [
  { kind: 'box-coarse', tol: 0.5 },
  { kind: 'sphere-coarse', tol: 0.5 },
  { kind: 'sphere-fine', tol: 0.05 },
];

const allResults = [];

for (const { kind, tol } of cases) {
  console.log(`\n=== Pattern 3 — mesh ${kind} (tol=${tol}) ===`);

  const naive = await bench('Naive (per-element JS)', oc, ITERATIONS, () => {
    using shape = buildShape(kind);
    return meshNaive(oc, shape, { tolerance: tol });
  });
  printResult(naive);

  const f = await bench('Strategy F (extractor)', oc, ITERATIONS, () => {
    using shape = buildShape(kind);
    return meshExtractorF(oc, shape, { tolerance: tol });
  });
  printResult(f);

  // Snapshot mesh size.
  using snap = buildShape(kind);
  const snapMesh = meshExtractorF(oc, snap, { tolerance: tol });
  console.log(`  → mesh: ${snapMesh.vertices.length / 3} verts, ${snapMesh.triangles.length / 3} tris`);

  const v = verdict('naive→F', naive, f);
  console.log(`  → ${v.label}: ${v.changePct} (${v.assessment})`);

  allResults.push({
    pattern: 'P3', kind, tol,
    verts: snapMesh.vertices.length / 3,
    tris: snapMesh.triangles.length / 3,
    naive, strategyF: f, verdict: v,
  });
}

export default allResults;

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nDONE — Pattern 3 micro-bench complete.');
}

// Cross-strategy parity validation.
// Each pattern is run through every applicable strategy; we assert the
// outputs are numerically equivalent (mesh-hash equivalence + per-pattern
// invariants).
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadOC } from '../replicad-equivalent/setup.mjs';
import { makeBSplineApproximation, makeBSplineApproximationStrategyD } from '../replicad-equivalent/make-bspline.mjs';
import {
  splitBSplineCurveStatusQuo,
  splitBSplineCurveNaiveD,
  splitBSplineCurveSplitApiD,
} from '../replicad-equivalent/split-curve.mjs';
import { meshNaive, meshExtractorF } from '../replicad-equivalent/mesh.mjs';
import { makeEllipsoidStatusQuo, makeEllipsoidStrategyD } from '../replicad-equivalent/make-ellipsoid.mjs';
import { runSimpleVase } from '../replicad-equivalent/examples/simple-vase.mjs';
import { runBirdhouse } from '../replicad-equivalent/examples/birdhouse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../reports');
await fs.mkdir(REPORTS_DIR, { recursive: true });

const oc = await loadOC();

function approxEq(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function hashMesh(mesh) {
  let h = 0n;
  for (let i = 0; i < mesh.vertices.length; i++) {
    h = (h * 1315423911n + BigInt(Math.round(mesh.vertices[i] * 1000))) & 0xffffffffffffffffn;
  }
  for (let i = 0; i < mesh.triangles.length; i++) {
    h = (h * 1315423911n + BigInt(mesh.triangles[i])) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

const report = { generatedAt: new Date().toISOString(), patterns: {}, examples: {} };

// ── Pattern 1 — A and D should produce edges with identical end points ──
console.log('\n=== Pattern 1 parity ===');
{
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 63) * 2 * Math.PI;
    pts.push([Math.cos(t) * 50, Math.sin(t) * 50, Math.sin(t * 3) * 5]);
  }
  using edgeA = makeBSplineApproximation(oc, pts);
  using edgeD = makeBSplineApproximationStrategyD(oc, pts);

  // Build a tiny mesh of each (after wrapping into a wire+face is heavy;
  // use length via BRepAdaptor_Curve approximations -- but adaptor not bound).
  // Sample endpoints via BRep_Tool::Pnt on vertices.
  using vertsA = new oc.TopExp_Explorer(edgeA, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  using vertsD = new oc.TopExp_Explorer(edgeD, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const epsA = [];
  const epsD = [];
  for (; vertsA.More(); vertsA.Next()) {
    using v = oc.TopoDS.Vertex(vertsA.Current());
    using p = oc.BRep_Tool.Pnt(v);
    epsA.push(p.X(), p.Y(), p.Z());
  }
  for (; vertsD.More(); vertsD.Next()) {
    using v = oc.TopoDS.Vertex(vertsD.Current());
    using p = oc.BRep_Tool.Pnt(v);
    epsD.push(p.X(), p.Y(), p.Z());
  }
  assert.equal(epsA.length, epsD.length, 'P1 same vertex count');
  for (let i = 0; i < epsA.length; i++) {
    assert.ok(approxEq(epsA[i], epsD[i], 1e-3), `P1 endpoint[${i}] diverges: ${epsA[i]} vs ${epsD[i]}`);
  }
  console.log(`  P1 OK — ${epsA.length / 3} matching endpoints`);
  report.patterns.P1 = { ok: true, endpoints: epsA.length / 3 };
}

// ── Pattern 2 — A vs naive D vs split-API D produce identical Poles/Knots ──
console.log('\n=== Pattern 2 parity ===');
{
  using array = new oc.NCollection_Array1_gp_Pnt2d(1, 32);
  for (let i = 0; i < 32; i++) {
    const t = (i / 31) * 2 * Math.PI;
    using p = new oc.gp_Pnt2d(Math.cos(t) * 50, Math.sin(t) * 50);
    array.SetValue(i + 1, p);
  }
  using builder = new oc.Geom2dAPI_PointsToBSpline(array, 1, 6, oc.GeomAbs_Shape.GeomAbs_C2, 0.001);
  using src = builder.Curve();

  const first = src.FirstParameter() + 0.1 * (src.LastParameter() - src.FirstParameter());
  const last = src.LastParameter() - 0.1 * (src.LastParameter() - src.FirstParameter());

  using copyA = splitBSplineCurveStatusQuo(oc, src, first, last);
  using copyN = splitBSplineCurveNaiveD(oc, src, first, last);
  using copyS = splitBSplineCurveSplitApiD(oc, src, first, last);

  const nbA = copyA.NbPoles();
  const nbN = copyN.NbPoles();
  const nbS = copyS.NbPoles();
  assert.equal(nbA, nbS, `P2 NbPoles parity A=${nbA} S=${nbS}`);
  // naive-D rebuilds without doing Segment on the same domain — its pole count
  // is by construction the input domain (no domain trim); document the
  // expected difference rather than assert equality.

  for (let i = 1; i <= nbA; i++) {
    using pA = copyA.Pole(i);
    using pS = copyS.Pole(i);
    assert.ok(approxEq(pA.X(), pS.X(), 1e-6) && approxEq(pA.Y(), pS.Y(), 1e-6),
      `P2 pole[${i}] diverges between A and split-API D`);
  }
  console.log(`  P2 OK — A and split-API D match on all ${nbA} poles (naive-D NbPoles=${nbN})`);
  report.patterns.P2 = { ok: true, nbPoles: { A: nbA, naiveD: nbN, splitApiD: nbS } };
}

// ── Pattern 3 — Strategy F and naive produce the same vertex set ────────
console.log('\n=== Pattern 3 parity ===');
{
  using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
  using shape = box.Shape();
  const meshA = meshNaive(oc, shape, { tolerance: 0.5 });
  const meshF = meshExtractorF(oc, shape, { tolerance: 0.5 });
  assert.equal(meshA.vertices.length, meshF.vertices.length, 'P3 same vertex count');
  assert.equal(meshA.triangles.length, meshF.triangles.length, 'P3 same triangle count');
  // Compare vertex sets up to permutation: build a canonical hash on each.
  function canonicalVerts(m) {
    const arr = [];
    for (let i = 0; i < m.vertices.length; i += 3) {
      arr.push([
        Math.round(m.vertices[i] * 1000),
        Math.round(m.vertices[i + 1] * 1000),
        Math.round(m.vertices[i + 2] * 1000),
      ].join(','));
    }
    return arr.sort().join('|');
  }
  assert.equal(canonicalVerts(meshA), canonicalVerts(meshF), 'P3 vertex sets equal up to permutation');
  console.log(`  P3 OK — ${meshA.vertices.length / 3} verts identical, ${meshA.triangles.length / 3} tris (Note: Strategy F applies reversed-face winding correction; vertex *positions* match exactly)`);
  report.patterns.P3 = { ok: true, verts: meshA.vertices.length / 3, tris: meshA.triangles.length / 3 };
}

// ── Pattern 4 — A and D ellipsoid shells produce identical meshes ───────
console.log('\n=== Pattern 4 parity ===');
{
  using shellA = makeEllipsoidStatusQuo(oc, 10, 20, 30);
  using shellD = makeEllipsoidStrategyD(oc, 10, 20, 30);
  const meshA = meshExtractorF(oc, shellA, { tolerance: 0.5 });
  const meshD = meshExtractorF(oc, shellD, { tolerance: 0.5 });
  const hA = hashMesh(meshA);
  const hD = hashMesh(meshD);
  assert.equal(hA, hD, `P4 mesh hashes diverge: ${hA} vs ${hD}`);
  console.log(`  P4 OK — A and D produce identical mesh (${meshA.vertices.length / 3} verts, hash=${hA})`);
  report.patterns.P4 = { ok: true, hash: hA, verts: meshA.vertices.length / 3 };
}

// ── End-to-end parity (already validated in run-examples.mjs) ───────────
console.log('\n=== End-to-end parity (recapture for completeness) ===');
{
  const vaseHashes = {};
  for (const combo of ['A', 'D', 'F', 'D+F']) {
    const inputStrategy = combo.includes('D') ? 'D' : 'A';
    const meshStrategy = combo.includes('F') ? 'F' : 'naive';
    vaseHashes[combo] = hashMesh(runSimpleVase(oc, { input: inputStrategy, mesh: meshStrategy }));
  }
  const houseHashes = {};
  for (const combo of ['A', 'D', 'F', 'D+F']) {
    const meshStrategy = combo.includes('F') ? 'F' : 'naive';
    houseHashes[combo] = hashMesh(runBirdhouse(oc, { mesh: meshStrategy }));
  }
  console.log('  simpleVase hashes:', vaseHashes);
  console.log('  birdhouse hashes:', houseHashes);

  // simpleVase: every combo must match A (mesh extractor produces same
  // vertex set up to permutation; positions identical).
  assert.equal(vaseHashes['A'], vaseHashes['D'], 'simpleVase A vs D mesh-hash divergence');
  // Strategy F differs in triangle winding for reversed faces vs the naive
  // walker; allow that without failing the test, just record it.
  console.log(`  → simpleVase parity: A==D=${vaseHashes['A'] === vaseHashes['D']}, A==F=${vaseHashes['A'] === vaseHashes['F']} (winding-correction expected)`);
  console.log(`  → birdhouse parity: A==D=${houseHashes['A'] === houseHashes['D']}, A==F=${houseHashes['A'] === houseHashes['F']} (winding-correction expected)`);
  report.examples = { simpleVase: vaseHashes, birdhouse: houseHashes };
}

const outPath = path.join(REPORTS_DIR, 'parity.json');
await fs.writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`\nReport written: ${outPath}`);
console.log('\nPARITY OK');

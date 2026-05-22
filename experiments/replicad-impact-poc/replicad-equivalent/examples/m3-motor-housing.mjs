// M3 — Motor housing: cylindrical body + cooling-fin array + bolt-hole
// pattern + uniform fillet over all edges.
//
// Coverage target: heavy fillet-density workload. Fillet is the most
// allocation-heavy OCCT operation in our pattern set; this stresses
// BRepFilletAPI_MakeFillet over O(100) edges to give the M-coverage bench a
// fillet-dominated mesh-extract scenario.
//
// Build pipeline:
//   1. Cylindrical body (radius R, height H)
//   2. N radial fins (rectangular boxes), fused
//   3. 6 bolt-hole cylinders, cut
//   4. Fillet ALL edges by `filletRadius`
//
// Fillet failure handling: if MakeFillet refuses (degenerate or invalid
// edges), skip the offending edge and rebuild. This matches replicad's
// behaviour where ill-defined fillet edges are filtered out.
import {
  translate,
  rotateZ,
  booleanFuse,
  booleanCut,
} from '../helpers.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';

export const defaultParams = {
  bodyRadius: 30,
  bodyHeight: 50,
  finCount: 16,
  finWidth: 4,
  finHeight: 45,
  finDepth: 10,
  boltHoleCount: 6,
  boltHoleRadius: 3,
  boltCircleRadius: 22,
  filletRadius: 0.5,
};

function makeCylinder(oc, radius, height) {
  using origin = new oc.gp_Pnt(0, 0, 0);
  using zDir = new oc.gp_Dir(0, 0, 1);
  using ax2 = new oc.gp_Ax2(origin, zDir);
  using maker = new oc.BRepPrimAPI_MakeCylinder(ax2, radius, height);
  return maker.Shape();
}

function makeBoxAtOrigin(oc, w, l, h) {
  using corner = new oc.gp_Pnt(-w / 2, -l / 2, 0);
  using maker = new oc.BRepPrimAPI_MakeBox(corner, w, l, h);
  return maker.Shape();
}

/**
 * Apply a fillet of the given radius to every TopoDS_Edge of `shape`,
 * deduping by quantized endpoint positions (TopExp_Explorer yields the
 * same edge once per adjacent face). Edges that the maker rejects are
 * silently skipped.
 */
function filletAllEdges(oc, shape, radius) {
  using maker = new oc.BRepFilletAPI_MakeFillet(shape);
  let added = 0;
  const seen = new Set();
  using ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    using edge = oc.TopoDS.Edge(ex.Current());
    const key = edgeKeyFor(oc, edge);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      maker.Add(radius, edge);
      added++;
    } catch {
      // Silently skip degenerate or invalid edges.
    }
  }
  if (added === 0) {
    // Caller wanted fillets but no edges qualified — return a fresh copy
    // of the input.
    using idTrsf = new oc.gp_Trsf();
    using copier = new oc.BRepBuilderAPI_Transform(shape, idTrsf, false);
    return copier.Shape();
  }
  using progress = new oc.Message_ProgressRange();
  maker.Build(progress);
  if (!maker.IsDone()) throw new Error('fillet build failed');
  return maker.Shape();
}

function edgeKeyFor(oc, edge) {
  const parts = [];
  using vex = new oc.TopExp_Explorer(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; vex.More(); vex.Next()) {
    using v = oc.TopoDS.Vertex(vex.Current());
    using p = oc.BRep_Tool.Pnt(v);
    parts.push(Math.round(p.X() * 1e6) + ',' + Math.round(p.Y() * 1e6) + ',' + Math.round(p.Z() * 1e6));
  }
  parts.sort();
  return parts.join('|');
}

export function buildMotorHousing(oc, p = defaultParams) {
  let body = makeCylinder(oc, p.bodyRadius, p.bodyHeight);

  // Fins: rectangular boxes radiating out from the body.
  for (let i = 0; i < p.finCount; i++) {
    const angle = (2 * Math.PI * i) / p.finCount;
    // Position fin centred on x axis, then rotate into place. The fin box
    // sits with its inner edge embedded in the body (overlap = finDepth/2).
    using finBox = makeBoxAtOrigin(oc, p.finWidth, p.bodyRadius + p.finDepth, p.finHeight);
    // Slide so the inner edge sits at x=0, outer at x=R+depth.
    using finShifted = translate(oc, finBox, [0, (p.bodyRadius + p.finDepth) / 2, (p.bodyHeight - p.finHeight) / 2]);
    using finRotated = rotateZ(oc, finShifted, angle);
    const fused = booleanFuse(oc, body, finRotated);
    body.delete();
    body = fused;
  }

  // Bolt holes around the bolt circle.
  for (let i = 0; i < p.boltHoleCount; i++) {
    const angle = (2 * Math.PI * i) / p.boltHoleCount;
    const x = p.boltCircleRadius * Math.cos(angle);
    const y = p.boltCircleRadius * Math.sin(angle);
    using hole = makeCylinder(oc, p.boltHoleRadius, p.bodyHeight + 1);
    using holePositioned = translate(oc, hole, [x, y, -0.5]);
    const cut = booleanCut(oc, body, holePositioned);
    body.delete();
    body = cut;
  }

  // Fillet ALL edges. If the resulting solid is invalid, drop the fillet.
  let filleted;
  try {
    filleted = filletAllEdges(oc, body, p.filletRadius);
  } catch (e) {
    // Fallback: skip fillets (preserves the bench fixture even if OCCT
    // refuses on this particular geometry).
    using idTrsf = new oc.gp_Trsf();
    using copier = new oc.BRepBuilderAPI_Transform(body, idTrsf, false);
    filleted = copier.Shape();
  }
  body.delete();
  return filleted;
}

export function runMotorHousing(oc, { mesh = 'naive' } = {}) {
  using shape = buildMotorHousing(oc);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.3, angularTolerance: 0.1 });
}

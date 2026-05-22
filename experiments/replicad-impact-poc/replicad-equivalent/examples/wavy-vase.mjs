// wavy-vase — parametric polysided vase with twist + bottom fillet + bored hole.
// Port of libs/tau-examples/src/kernels/replicad/wavy-vase/main.ts.
//
// Build pipeline:
//   1. Build a "polysides" 2D profile in the XY plane at z=0:
//        12 polygon corners alternating with 12 inward arcs (concave sides),
//        producing 24 edges total. Replicad's `drawPolysides(radius, n, -sideRadius)`
//        with sideRadius < 0 = inward bulge.
//   2. Make a planar face.
//   3. Twist-extrude (BRepOffsetAPI_ThruSections, same as gear).
//   4. Fillet the bottom rim (all edges in z=0).
//   5. Cut a cylindrical hole through the top (hole-mode = 1, the default).
//   6. Mesh.
//
// Deviation notes:
//   - Replicad's `extrusionProfile = { profile: 's-curve', endFactor }` is a
//     pipe-along-helical-axis with a non-linear cross-section schedule;
//     reproducing it requires BRepOffsetAPI_MakePipeShell with a helical spine
//     (not bound here). The PoC uses a PLAIN linear prism extrude — no twist —
//     which:
//       a) preserves the heavy polysides + bottom-fillet + hole-cut workload
//          (the bench is dominated by 12 arc edges + fillet on 12 edges +
//          boolean cut), and
//       b) avoids BRepFilletAPI_MakeFillet failing on the BSpline lateral
//          surfaces that BRepOffsetAPI_ThruSections (the only twist primitive
//          available in this binding subset) produces. ThruSections + Fillet
//          is empirically incompatible for arbitrary polysides geometry.
//   - The shell-mode (`holeMode = 2`) branch uses BRepOffsetAPI_MakeThickSolid
//     which isn't bound; we restrict to hole-mode = 1 (default).
import {
  makeLine,
  makeThreePointArc,
  assembleWire,
  makeFace,
  extrudeLinear,
  filletAtZ,
  booleanCut,
} from '../helpers.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';

export const defaultParams = {
  height: 150,
  radius: 40,
  sidesCount: 12,
  sideRadius: -2,    // negative = inward bulge (concave sides)
  sideTwist: 6,
  endFactor: 1.5,
  topFillet: 0,
  bottomFillet: 5,
  holeMode: 1,
  wallThickness: 2,
};

/**
 * Inner radius of the polysided polygon, mirroring replicad's
 * polysideInnerRadius(radius, n, sideRadius).
 *
 * Replicad's drawPolysides constructs n vertices on a circle of `radius`
 * separated by angle 2π/n, joined by arcs that bulge inward by `sideRadius`
 * (negative value here = concave). The inner radius is the smallest distance
 * from the origin to any point on those arcs — the midpoint of each side.
 */
function polysideInnerRadius(radius, n, sideRadius) {
  const halfChord = radius * Math.sin(Math.PI / n);
  const halfAngle = Math.PI / n;
  const chordMid = radius * Math.cos(halfAngle);
  // For sideRadius < 0 (inward bulge), the midpoint of each arc sits at
  // chordMid - |sideRadius| ... but actually replicad uses a sagitta-style
  // construction. For our defaults (r=40, n=12, sr=-2) the inner radius
  // approximation chordMid - 2 = 36.6 is close enough for the bench hole.
  void halfChord;
  return chordMid - Math.abs(sideRadius);
}

/**
 * Build the polysided 2D profile as a closed TopoDS_Wire.
 * 12 vertices on the outer circle alternating with 12 arcs through midpoints
 * pushed inward by |sideRadius|.
 */
function buildPolysidesWire(oc, radius, n, sideRadius) {
  const vertices = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    vertices.push([radius * Math.cos(a), radius * Math.sin(a), 0]);
  }

  const edges = [];
  for (let i = 0; i < n; i++) {
    const v0 = vertices[i];
    const v1 = vertices[(i + 1) % n];
    if (Math.abs(sideRadius) < 1e-9) {
      edges.push(makeLine(oc, v0, v1));
    } else {
      // Midpoint of the chord, pushed inward by |sideRadius| (radial direction).
      const mx = (v0[0] + v1[0]) / 2;
      const my = (v0[1] + v1[1]) / 2;
      const len = Math.hypot(mx, my);
      const ux = mx / len, uy = my / len;
      const push = sideRadius; // negative pushes the midpoint TOWARDS origin
      const mid = [mx + ux * push, my + uy * push, 0];
      edges.push(makeThreePointArc(oc, v0, mid, v1));
    }
  }

  try {
    return assembleWire(oc, edges);
  } finally {
    for (const e of edges) e.delete();
  }
}

export function buildWavyVaseSolid(oc, p = defaultParams) {
  using profileWire = buildPolysidesWire(oc, p.radius, p.sidesCount, p.sideRadius);
  using profileFace = makeFace(oc, profileWire);
  using extruded = extrudeLinear(oc, profileFace, p.height);

  // Bottom fillet (rim at z=0). Filleting plain-prism polysides edges is
  // well-defined; OCCT generates clean tangent surfaces here.
  let filleted = extruded;
  let needDispose = false;
  if (p.bottomFillet > 0) {
    filleted = filletAtZ(oc, extruded, 0, p.bottomFillet, 'fillet');
    needDispose = true;
  }

  try {
    if (p.holeMode === 1) {
      const innerR = polysideInnerRadius(p.radius, p.sidesCount, p.sideRadius) - p.wallThickness;
      const holeHeight = p.height - p.wallThickness;
      using holeOrigin = new oc.gp_Pnt(0, 0, p.wallThickness);
      using holeDir = new oc.gp_Dir(0, 0, 1);
      using holeAxis = new oc.gp_Ax2(holeOrigin, holeDir);
      using holeMaker = new oc.BRepPrimAPI_MakeCylinder(holeAxis, innerR, holeHeight);
      using hole = holeMaker.Shape();
      return booleanCut(oc, filleted, hole);
    }
    using idTrsf = new oc.gp_Trsf();
    using copier = new oc.BRepBuilderAPI_Transform(filleted, idTrsf, false);
    return copier.Shape();
  } finally {
    if (needDispose) filleted.delete();
  }
}

/**
 * Full pipeline: build the solid + mesh it.
 */
export function runWavyVase(oc, { mesh = 'naive' } = {}) {
  using shape = buildWavyVaseSolid(oc);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.5, angularTolerance: 0.1 });
}

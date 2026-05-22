// helical-gear — involute spur/helical gear with bore + keyway + chamfers.
// Port of libs/tau-examples/src/kernels/replicad/helical-gear/main.ts.
//
// Build pipeline:
//   1. Compute analytical involute + root-fillet geometry (pure JS math).
//   2. Build a TopoDS_Wire of `6 * toothCount` edges:
//        - 4 Bezier curves per tooth (2 fillets, 2 involute flanks)
//        - 2 three-point arcs per tooth (tooth-tip, between-teeth root)
//        At default toothCount=24 this is 144 edges. Heavy Pattern 1/2 fixture.
//   3. Make a face, twist-extrude (BRepOffsetAPI_ThruSections between base
//      wire and rotated/translated top wire).
//   4. Cut a cylindrical bore.
//   5. Cut a rectangular keyway slot (extruded box).
//   6. Chamfer the bore circular edges on the top + bottom faces.
//   7. (Tooth-tip chamfer is OMITTED — replicad's plane-filtered edge picker
//       requires midpoint sampling along arbitrary curves; the PoC keeps this
//       simple and documents the omission. Bore chamfer preserves the
//       chamfer-heavy cost characteristic for the benchmark.)
//   8. Mesh.
//
// Deviation note: replicad's `gearSketch.extrude(faceWidth, { twistAngle, origin })`
// uses a Pipe sweep along a helical path internally; the PoC uses
// BRepOffsetAPI_ThruSections between a base wire and a rotated/translated top
// wire, which is the same geometric idea (two compatible profiles → ruled or
// approximated lateral surface) but a different OCCT primitive. The resulting
// solid is functionally a twisted helical gear; the mesh is comparable.
import {
  makeThreePointArc,
  makeBezierCurve,
  assembleWire,
  makeFace,
  extrudeTwist,
  translateZ,
  booleanCut,
  filletAtZ,
} from '../helpers.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';

export const defaultParams = {
  toothCount: 24,
  module: 2,
  pressureAngle: 20,
  faceWidth: 18,
  helixAngle: 25,
  helixHand: 'right',
  boreDiameter: 14,
  keywayWidth: 5,
  keywayDepth: 3,
  dedendumFactor: 1.25,
  involuteBezierTension: 0.42,
  rootFilletTension: 0.4,
  boreChamfer: 0.6,
  toothChamfer: 0.6,
};

const involute = (angle) => Math.tan(angle) - angle;
const polarPoint = (radius, angle) => [
  radius * Math.cos(angle),
  radius * Math.sin(angle),
  0,
];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const unit = (a) => {
  const L = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / L, a[1] / L, a[2] / L];
};

/**
 * Build the involute wire in the XY plane at z=0. Returns a TopoDS_Wire.
 * Mirrors buildInvoluteGearWire() in main.ts.
 */
function buildInvoluteGearWire(oc, p) {
  const pressureAngle = (p.pressureAngle * Math.PI) / 180;
  const toothPeriod = (2 * Math.PI) / p.toothCount;
  const pitchRadius = (p.module * p.toothCount) / 2;
  const baseRadius = pitchRadius * Math.cos(pressureAngle);
  const outerRadius = pitchRadius + p.module;
  const rootRadius = pitchRadius - p.dedendumFactor * p.module;
  const flankStartRadius = Math.max(baseRadius, rootRadius);
  const pitchHalfToothAngle = Math.PI / (2 * p.toothCount);
  const pitchInvolute = involute(pressureAngle);

  const halfToothAngleAt = (radius) => {
    const rollAngle = Math.acos(baseRadius / radius);
    return pitchHalfToothAngle + pitchInvolute - involute(rollAngle);
  };

  const involutePoint = (side, centerAngle, radius) =>
    polarPoint(radius, centerAngle + side * halfToothAngleAt(radius));

  const involuteTangent = (side, centerAngle, radius) => {
    const flankAngle = centerAngle + side * halfToothAngleAt(radius);
    const rollAngle = Math.acos(baseRadius / radius);
    const dThetaDr = (-side * Math.sin(rollAngle)) / baseRadius;
    return unit([
      Math.cos(flankAngle) - radius * Math.sin(flankAngle) * dThetaDr,
      Math.sin(flankAngle) + radius * Math.cos(flankAngle) * dThetaDr,
      0,
    ]);
  };

  const involuteBezier = (side, centerAngle, startRadius, endRadius) => {
    const startPoint = involutePoint(side, centerAngle, startRadius);
    const endPoint = involutePoint(side, centerAngle, endRadius);
    const chord = distance(startPoint, endPoint);
    const startTangent = involuteTangent(side, centerAngle, startRadius);
    const endTangent = involuteTangent(side, centerAngle, endRadius);
    const pathSign = Math.sign(endRadius - startRadius) || 1;
    const handleLength = chord * p.involuteBezierTension;
    return makeBezierCurve(oc, [
      startPoint,
      add(startPoint, scale(startTangent, handleLength * pathSign)),
      subtract(endPoint, scale(endTangent, handleLength * pathSign)),
      endPoint,
    ]);
  };

  const startHalfAngle = halfToothAngleAt(flankStartRadius);
  const clearanceAngle = (flankStartRadius - rootRadius) / rootRadius;
  const rootHalfAngle = startHalfAngle + Math.min(
    (toothPeriod / 2 - startHalfAngle) * 0.65,
    Math.max(0.006, clearanceAngle),
  );

  const filletBezier = (side, centerAngle) => {
    const flankPoint = involutePoint(side, centerAngle, flankStartRadius);
    const flankTangentUp = involuteTangent(side, centerAngle, flankStartRadius);
    const rootAngle = centerAngle + side * rootHalfAngle;
    const rootPoint = polarPoint(rootRadius, rootAngle);
    const rootTangentCCW = [-Math.sin(rootAngle), Math.cos(rootAngle), 0];
    const chord = distance(rootPoint, flankPoint);
    const h = chord * p.rootFilletTension;
    if (side === -1) {
      return makeBezierCurve(oc, [
        rootPoint,
        add(rootPoint, scale(rootTangentCCW, h)),
        subtract(flankPoint, scale(flankTangentUp, h)),
        flankPoint,
      ]);
    }
    const flankTangentDown = scale(flankTangentUp, -1);
    return makeBezierCurve(oc, [
      flankPoint,
      add(flankPoint, scale(flankTangentDown, h)),
      subtract(rootPoint, scale(rootTangentCCW, h)),
      rootPoint,
    ]);
  };

  const edges = [];
  const firstRootLeft = polarPoint(rootRadius, -rootHalfAngle);

  for (let toothIndex = 0; toothIndex < p.toothCount; toothIndex += 1) {
    const centerAngle = toothIndex * toothPeriod;
    const nextCenterAngle = (toothIndex + 1) * toothPeriod;
    const outerLeft = involutePoint(-1, centerAngle, outerRadius);
    const outerRight = involutePoint(1, centerAngle, outerRadius);
    const rootRight = polarPoint(rootRadius, centerAngle + rootHalfAngle);
    const nextRootLeft =
      toothIndex === p.toothCount - 1
        ? firstRootLeft
        : polarPoint(rootRadius, nextCenterAngle - rootHalfAngle);

    edges.push(filletBezier(-1, centerAngle));
    edges.push(involuteBezier(-1, centerAngle, flankStartRadius, outerRadius));
    edges.push(makeThreePointArc(oc, outerLeft, polarPoint(outerRadius, centerAngle), outerRight));
    edges.push(involuteBezier(1, centerAngle, outerRadius, flankStartRadius));
    edges.push(filletBezier(1, centerAngle));
    edges.push(makeThreePointArc(oc, rootRight, polarPoint(rootRadius, centerAngle + toothPeriod / 2), nextRootLeft));
  }

  try {
    return assembleWire(oc, edges);
  } finally {
    for (const e of edges) e.delete();
  }
}

/**
 * Build the helical-gear solid. Returns a TopoDS_Shape that the caller owns.
 */
export function buildHelicalGearSolid(oc, p = defaultParams) {
  const pitchRadius = (p.module * p.toothCount) / 2;
  const helixTwist =
    ((p.faceWidth * Math.tan((p.helixAngle * Math.PI) / 180)) / pitchRadius) *
    (p.helixHand === 'right' ? 1 : -1);

  using gearWire = buildInvoluteGearWire(oc, p);
  using extruded = extrudeTwist(oc, gearWire, p.faceWidth, helixTwist);
  using gear = translateZ(oc, extruded, -p.faceWidth / 2);

  // Bore — oversized cylinder centred on Z axis, through the gear height.
  const boreOverhang = 1;
  const boreHeight = p.faceWidth + 2 * boreOverhang;
  using boreOrigin = new oc.gp_Pnt(0, 0, -p.faceWidth / 2 - boreOverhang);
  using boreDir = new oc.gp_Dir(0, 0, 1);
  using boreAxis = new oc.gp_Ax2(boreOrigin, boreDir);
  using boreMaker = new oc.BRepPrimAPI_MakeCylinder(boreAxis, p.boreDiameter / 2, boreHeight);
  using bore = boreMaker.Shape();
  using gearWithBore = booleanCut(oc, gear, bore);

  // Keyway slot — a thin rectangular prism extending radially from the bore wall.
  const boreRadius = p.boreDiameter / 2;
  const slotOverlap = 0.5;
  const slotInnerY = boreRadius - slotOverlap;
  const slotOuterY = boreRadius + p.keywayDepth;
  const slotHeight = slotOuterY - slotInnerY;
  using slotBox = new oc.BRepPrimAPI_MakeBox(p.keywayWidth, slotHeight, boreHeight);
  using slotShape = slotBox.Shape();
  // Position slot: x-centred, +Y from boreInner, lifted to z = -faceWidth/2 - overhang
  using slotTrsf = new oc.gp_Trsf();
  using slotVec = new oc.gp_Vec(-p.keywayWidth / 2, slotInnerY, -p.faceWidth / 2 - boreOverhang);
  slotTrsf.SetTranslation(slotVec);
  using slotXformer = new oc.BRepBuilderAPI_Transform(slotShape, slotTrsf, false);
  using slot = slotXformer.Shape();
  using gearWithSlot = booleanCut(oc, gearWithBore, slot);

  // Bore chamfer on the top + bottom face (skipping tooth-tip chamfer; see file header)
  const halfH = p.faceWidth / 2;
  if (p.boreChamfer > 0) {
    using chamferedTop = filletAtZ(oc, gearWithSlot, halfH, p.boreChamfer, 'chamfer');
    // Bottom-face chamfer returned inline so the chamferedTop `using` disposes
    // only AFTER the final shape handle is created.
    return filletAtZ(oc, chamferedTop, -halfH, p.boreChamfer, 'chamfer');
  }
  // No chamfer: still need a fresh handle that survives gearWithSlot disposal.
  // Use a no-op transform with identity Trsf to create a copy.
  using idTrsf = new oc.gp_Trsf();
  using copier = new oc.BRepBuilderAPI_Transform(gearWithSlot, idTrsf, false);
  return copier.Shape();
}

/**
 * Full pipeline: build the solid + mesh it.
 * Strategy axis here is just mesh extraction (naive vs F).
 */
export function runHelicalGear(oc, { mesh = 'naive' } = {}) {
  using shape = buildHelicalGearSolid(oc);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.1, angularTolerance: 0.1 });
}

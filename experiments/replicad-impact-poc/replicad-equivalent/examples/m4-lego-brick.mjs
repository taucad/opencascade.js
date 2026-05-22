// M4 — Parametric LEGO brick.
// Faithful port of libs/tau-examples/src/kernels/replicad/lego/main.ts to
// direct OCCT calls (no replicad). Primitives + booleans only — the control
// case that exercises no NCollection on the build path.
//
// Build pipeline:
//   1. drawRectangle(W,L).extrude(H) -> body box (BRepPrimAPI_MakeBox)
//   2. For each stud position, drawCircle(r).extrude(h) -> cylinder, translate, fuse
//   3. drawRectangle(W',L').extrude(H') -> hollow box, cut from body
//   4. For each tube position, outer/inner cylinders cut, translate, fuse
import {
  translate,
  booleanFuse,
  booleanCut,
} from '../helpers.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';

export const defaultParams = {
  width: 2,
  length: 4,
  height: 1,
  studDiameter: 4.8,
  studHeight: 1.8,
  wallThickness: 1.5,
  baseThickness: 1.2,
  tubeOuterDiameter: 6.5,
  tubeInnerDiameter: 4.8,
  tubeHeight: 8 - 1.2,
  unit: 8,
  enableTubes: true,
};

function makeBox(oc, w, l, h) {
  // BRepPrimAPI_MakeBox places the box with its corner at the origin; we
  // want it centred on x/y like replicad's drawRectangle().sketchOnPlane().
  using corner = new oc.gp_Pnt(-w / 2, -l / 2, 0);
  using maker = new oc.BRepPrimAPI_MakeBox(corner, w, l, h);
  return maker.Shape();
}

function makeCylinderAtOrigin(oc, radius, height) {
  using origin = new oc.gp_Pnt(0, 0, 0);
  using zDir = new oc.gp_Dir(0, 0, 1);
  using ax2 = new oc.gp_Ax2(origin, zDir);
  using maker = new oc.BRepPrimAPI_MakeCylinder(ax2, radius, height);
  return maker.Shape();
}

function calculateTubePositions(width, length) {
  const positions = [];
  if (width === 1) return positions;
  for (let x = 0; x < width - 1; x++) {
    for (let y = 0; y < length - 1; y++) {
      const xPos = x - (width - 2) / 2;
      const yPos = y - (length - 2) / 2;
      positions.push([xPos, yPos]);
    }
  }
  return positions;
}

export function buildLegoBrick(oc, p = defaultParams) {
  const totalWidth = p.width * p.unit;
  const totalLength = p.length * p.unit;
  const totalHeight = p.height * p.unit;

  let brick = makeBox(oc, totalWidth, totalLength, totalHeight);

  for (let x = 0; x < p.width; x++) {
    for (let y = 0; y < p.length; y++) {
      const xPos = (x - (p.width - 1) / 2) * p.unit;
      const yPos = (y - (p.length - 1) / 2) * p.unit;
      using stud = makeCylinderAtOrigin(oc, p.studDiameter / 2, p.studHeight);
      using studMoved = translate(oc, stud, [xPos, yPos, totalHeight]);
      const fused = booleanFuse(oc, brick, studMoved);
      brick.delete();
      brick = fused;
    }
  }

  const hollowWidth = totalWidth - 2 * p.wallThickness;
  const hollowLength = totalLength - 2 * p.wallThickness;
  const hollowHeight = totalHeight - p.baseThickness;
  using bottomHollow = makeBox(oc, hollowWidth, hollowLength, hollowHeight);
  {
    const cut = booleanCut(oc, brick, bottomHollow);
    brick.delete();
    brick = cut;
  }

  if (p.enableTubes) {
    const tubePositions = calculateTubePositions(p.width, p.length);
    for (const [tx, ty] of tubePositions) {
      const xPos = tx * p.unit;
      const yPos = ty * p.unit;
      using outer = makeCylinderAtOrigin(oc, p.tubeOuterDiameter / 2, p.tubeHeight);
      using inner = makeCylinderAtOrigin(oc, p.tubeInnerDiameter / 2, p.tubeHeight);
      using tubeRaw = booleanCut(oc, outer, inner);
      using tubeMoved = translate(oc, tubeRaw, [xPos, yPos, 0]);
      const fused = booleanFuse(oc, brick, tubeMoved);
      brick.delete();
      brick = fused;
    }
  }

  return brick;
}

export function runLegoBrick(oc, { mesh = 'naive' } = {}) {
  using shape = buildLegoBrick(oc);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.1, angularTolerance: 0.1 });
}

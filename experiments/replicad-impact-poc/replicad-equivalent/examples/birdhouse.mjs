// birdhouse — replicad's "house with a circular entrance hole" demo.
// Box body + cylindrical hole through one face + sphere cap fused on top.
// Exercises BRepAlgo boolean ops + mesh extraction.
import { meshNaive, meshExtractorF } from '../mesh.mjs';

/**
 * Build the birdhouse compound solid.
 * Strategy here is purely about the mesh strategy; the build itself is OCCT
 * boolean ops that don't surface NCollection on the JS side.
 */
export function buildBirdhouseSolid(oc) {
  // 1. Box body: 40 x 30 x 50
  using boxMaker = new oc.BRepPrimAPI_MakeBox(40, 30, 50);
  using box = boxMaker.Shape();

  // 2. Cylindrical hole — through the front face, centred.
  using axisOrigin = new oc.gp_Pnt(20, 15, 25);
  using axisDir = new oc.gp_Dir(0, 1, 0);
  using cylAxis = new oc.gp_Ax2(axisOrigin, axisDir);
  using cylMaker = new oc.BRepPrimAPI_MakeCylinder(cylAxis, 6, 60);
  using cyl = cylMaker.Shape();

  using progress = new oc.Message_ProgressRange();
  using cutMaker = new oc.BRepAlgoAPI_Cut(box, cyl, progress);
  using cutShape = cutMaker.Shape();

  // 3. Spherical roof on top.
  using roofCenter = new oc.gp_Pnt(20, 15, 50);
  using roofAxis = new oc.gp_Ax2(roofCenter, axisDir);
  using sphereMaker = new oc.BRepPrimAPI_MakeSphere(roofAxis, 12);
  using sphere = sphereMaker.Shape();

  using progress2 = new oc.Message_ProgressRange();
  using fuseMaker = new oc.BRepAlgoAPI_Fuse(cutShape, sphere, progress2);
  return fuseMaker.Shape();
}

export function runBirdhouse(oc, { mesh = 'naive' } = {}) {
  using shape = buildBirdhouseSolid(oc);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.3, angularTolerance: 0.1 });
}

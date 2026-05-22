// simpleVase — replicad's canonical "revolve a profile to make a vase" example,
// reproduced inline using only the ported hot-path helpers + minimal OCCT calls.
// Exercises Pattern 1 (B-spline approximation through profile points) plus the
// revolve + meshing pipeline.
import {
  makeBSplineApproximation,
  makeBSplineApproximationStrategyD,
} from '../make-bspline.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';

// Profile points define a vase silhouette in the XZ plane.
function vaseProfile() {
  const pts = [];
  const h = 100;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = t * h;
    // Bell-shape vase: wide bottom, narrow waist, flaring top.
    const r = 15 + 18 * Math.sin(t * Math.PI) + 4 * Math.sin(t * Math.PI * 3);
    pts.push([r, 0, z]);
  }
  return pts;
}

/**
 * Build a vase Solid via revolution.
 * @param oc       embind module
 * @param strategy 'A' (status quo) | 'D' (BSpline via Strategy D)
 */
export function buildVaseSolid(oc, strategy = 'A') {
  const profile = vaseProfile();
  const bsplineFn = strategy === 'D' ? makeBSplineApproximationStrategyD : makeBSplineApproximation;

  using profileEdge = bsplineFn(oc, profile, { tolerance: 0.1, degMax: 5 });

  // Need to close the wire: add a vertical edge from top back to bottom on
  // the axis, plus two horizontal edges connecting to the axis.
  using axisStart = new oc.gp_Pnt(0, 0, 0);
  using axisEnd = new oc.gp_Pnt(0, 0, 100);
  using profileTop = new oc.gp_Pnt(profile[profile.length - 1][0], 0, profile[profile.length - 1][2]);
  using profileBot = new oc.gp_Pnt(profile[0][0], 0, profile[0][2]);

  using topMaker = new oc.BRepBuilderAPI_MakeEdge(profileTop, axisEnd);
  using axisMaker = new oc.BRepBuilderAPI_MakeEdge(axisEnd, axisStart);
  using botMaker = new oc.BRepBuilderAPI_MakeEdge(axisStart, profileBot);

  using wireMaker = new oc.BRepBuilderAPI_MakeWire();
  wireMaker.Add(profileEdge);
  wireMaker.Add(topMaker.Edge());
  wireMaker.Add(axisMaker.Edge());
  wireMaker.Add(botMaker.Edge());
  using progress = new oc.Message_ProgressRange();
  wireMaker.Build(progress);
  using wire = wireMaker.Wire();

  using faceMaker = new oc.BRepBuilderAPI_MakeFace(wire, false);
  using face = faceMaker.Face();

  using axisPnt = new oc.gp_Pnt(0, 0, 0);
  using axisDir = new oc.gp_Dir(0, 0, 1);
  using axis = new oc.gp_Ax1(axisPnt, axisDir);

  using revol = new oc.BRepPrimAPI_MakeRevol(face, axis, 2 * Math.PI, false);
  return revol.Shape();
}

/**
 * Full simpleVase pipeline: build the solid + mesh it.
 * Strategy combos: { input: 'A'|'D', mesh: 'naive'|'F' }.
 */
export function runSimpleVase(oc, { input = 'A', mesh = 'naive' } = {}) {
  using shape = buildVaseSolid(oc, input);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.5, angularTolerance: 0.1 });
}

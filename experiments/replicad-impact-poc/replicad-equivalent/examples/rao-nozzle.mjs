// rao-nozzle — Rao parabolic-bell rocket-nozzle.
// Faithful port of libs/tau-examples/src/kernels/replicad/rao-nozzle/main.ts.
//
// Build pipeline:
//   1. Compute the analytical inner + outer wall control points (pure JS math)
//   2. Build a closed 2D wire in the XZ plane from:
//        - 4 line segments (chamber, 45° cone start, two outer-wall closures)
//        - 4 three-point arcs (convergent/divergent throat arcs × 2 walls)
//        - 2 quadratic Bezier curves (inner/outer bell)
//   3. Make a planar face from the wire
//   4. Revolve 2π around the X axis
//   5. Mesh
//
// No B-spline-approximation calls, no booleans, no fillets/chamfers — this is
// the cleanest "lots of edge construction + revolve + mesh" workload in the set.
import {
  makeLine,
  makeThreePointArc,
  makeBezierCurve,
  assembleWire,
  makeFace,
  revolveFull,
} from '../helpers.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';

export const defaultParams = {
  thrust_kN: 10,
  chamberPressure_MPa: 10,
  expansionRatio: 40,
  bellFraction: 0.8,
  wallThickness: 2,
  theta_n: 32,
  theta_e: 8,
};

/**
 * Mirrors generateRaoNozzle() — derives the wall geometry from analytical
 * Rao-method sizing then builds an OCCT solid of revolution.
 */
export function buildRaoNozzleSolid(oc, parameters = defaultParams) {
  const F = parameters.thrust_kN * 1000;
  const Pc = parameters.chamberPressure_MPa * 1_000_000;
  const Cf = 1.5;
  const At = F / (Pc * Cf);
  const Rt_m = Math.sqrt(At / Math.PI);
  const Rt = Rt_m * 1000;

  const th_n = (parameters.theta_n * Math.PI) / 180;
  const th_e = (parameters.theta_e * Math.PI) / 180;
  const t = parameters.wallThickness;

  // --- Convergent ---
  const Rc_arc = 1.5 * Rt;
  const x_ca = -Rc_arc * Math.sin((45 * Math.PI) / 180);
  const y_ca = Rt + Rc_arc * (1 - Math.cos((45 * Math.PI) / 180));
  const x_mid_ca = -Rc_arc * Math.sin((22.5 * Math.PI) / 180);
  const y_mid_ca = Rt + Rc_arc * (1 - Math.cos((22.5 * Math.PI) / 180));
  const Rc = 3 * Rt;
  const x_c = x_ca - (Rc - y_ca);
  const chamberLength = Rc;
  const x_start = x_c - chamberLength;

  // --- Divergent ---
  const R_arc = 0.382 * Rt;
  const x_n = R_arc * Math.sin(th_n);
  const y_n = Rt + R_arc * (1 - Math.cos(th_n));
  const x_mid_n = R_arc * Math.sin(th_n / 2);
  const y_mid_n = Rt + R_arc * (1 - Math.cos(th_n / 2));

  const Re = Rt * Math.sqrt(parameters.expansionRatio);
  const Lf = (Re - Rt) / Math.tan((15 * Math.PI) / 180);
  const L = parameters.bellFraction * Lf;
  const x_e = L;
  const y_e = Re;

  const m1 = Math.tan(th_n);
  const m2 = Math.tan(th_e);
  const x_c_bez = (y_e - y_n + m1 * x_n - m2 * x_e) / (m1 - m2);
  const y_c_bez = m1 * (x_c_bez - x_n) + y_n;

  // --- Profile in XZ plane: original replicad draws (x, y) in 2D then
  // sketchOnPlane('XY').revolve([1,0,0]). To revolve around the X axis we
  // place the profile in the XZ plane (y=0) with the "y" of the 2D profile
  // becoming the Z coordinate, then revolve around X.
  const Z = (xy) => [xy[0], 0, xy[1]];

  // Inner wall (forward)
  using e1 = makeLine(oc, Z([x_start, Rc]), Z([x_c, Rc]));
  using e2 = makeLine(oc, Z([x_c, Rc]), Z([x_ca, y_ca]));
  using e3 = makeThreePointArc(oc, Z([x_ca, y_ca]), Z([x_mid_ca, y_mid_ca]), Z([0, Rt]));
  using e4 = makeThreePointArc(oc, Z([0, Rt]), Z([x_mid_n, y_mid_n]), Z([x_n, y_n]));
  using e5 = makeBezierCurve(oc, [Z([x_n, y_n]), Z([x_c_bez, y_c_bez]), Z([x_e, y_e])]);
  // Bridge: inner exit -> outer exit (vertical seg of thickness t)
  using e6 = makeLine(oc, Z([x_e, y_e]), Z([x_e, y_e + t]));
  // Outer wall (reverse)
  using e7 = makeBezierCurve(oc, [Z([x_e, y_e + t]), Z([x_c_bez, y_c_bez + t]), Z([x_n, y_n + t])]);
  using e8 = makeThreePointArc(oc, Z([x_n, y_n + t]), Z([x_mid_n, y_mid_n + t]), Z([0, Rt + t]));
  using e9 = makeThreePointArc(oc, Z([0, Rt + t]), Z([x_mid_ca, y_mid_ca + t]), Z([x_ca, y_ca + t]));
  using e10 = makeLine(oc, Z([x_ca, y_ca + t]), Z([x_c, Rc + t]));
  using e11 = makeLine(oc, Z([x_c, Rc + t]), Z([x_start, Rc + t]));
  // Closing edge: outer back -> inner front
  using e12 = makeLine(oc, Z([x_start, Rc + t]), Z([x_start, Rc]));

  using wire = assembleWire(oc, [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12]);
  using face = makeFace(oc, wire);

  // Revolve around X axis
  using origin = new oc.gp_Pnt(0, 0, 0);
  using xDir = new oc.gp_Dir(1, 0, 0);
  using axis = new oc.gp_Ax1(origin, xDir);
  return revolveFull(oc, face, axis);
}

/**
 * Full pipeline: build the solid + mesh it.
 * Strategy axis here is just mesh extraction (naive vs Strategy F); the build
 * itself uses direct Geom_BezierCurve / GC_MakeArcOfCircle constructors, so
 * Strategy D (Pattern 1) doesn't naturally apply.
 */
export function runRaoNozzle(oc, { mesh = 'naive' } = {}) {
  using shape = buildRaoNozzleSolid(oc);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.3, angularTolerance: 0.1 });
}

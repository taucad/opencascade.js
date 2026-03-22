/**
 * Smoke test: Intersection segment parameter validity.
 *
 * Replicates the pattern from the gridfinity-box model where 2D curve
 * intersections produce segments. Verifies that Segment() returns curves
 * with finite parameter ranges (not RealFirst/RealLast sentinels like ±2e+100).
 *
 * This test isolates the issue from the replicad layer to determine if the
 * problem is in opencascade.js bindings or in replicad's usage.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Intersection segment parameters', () => {
  beforeAll(async () => { await initOC(); });

  it('should return RealFirst/RealLast for collinear infinite lines (OCCT behavior)', () => {
    const oc = getOC();

    const p1 = new oc.gp_Pnt2d(0, 0);
    const d1 = new oc.gp_Dir2d(1, 0);
    const ax1 = new oc.gp_Ax2d(p1, d1);
    const line1 = new oc.Geom2d_Line(ax1);

    const p2 = new oc.gp_Pnt2d(0, 0);
    const d2 = new oc.gp_Dir2d(1, 0);
    const ax2 = new oc.gp_Ax2d(p2, d2);
    const line2 = new oc.Geom2d_Line(ax2);

    const intersector = new oc.Geom2dAPI_InterCurveCurve(line1, line2, 1e-9);
    const nSeg = intersector.NbSegments();

    expect(nSeg).toBe(1);

    const { Curve1, Curve2 } = intersector.Segment(1);

    const fp1 = Curve1.FirstParameter();
    const lp1 = Curve1.LastParameter();
    const fp2 = Curve2.FirstParameter();
    const lp2 = Curve2.LastParameter();

    console.log(`Infinite collinear lines: C1[${fp1}, ${lp1}], C2[${fp2}, ${lp2}]`);

    // OCCT returns RealFirst (-2e+100) / RealLast (2e+100) for infinite overlap
    expect(fp1).toBeLessThan(-1e50);
    expect(lp1).toBeGreaterThan(1e50);

    // Evaluating at these infinite params produces points at ±infinity
    const pt = new oc.gp_Pnt2d();
    Curve1.D0(fp1, pt);
    console.log(`Value at FirstParam: (${pt.X()}, ${pt.Y()})`);
    expect(Math.abs(pt.X())).toBeGreaterThan(1e50);

    pt.delete();
    Curve1.delete();
    Curve2.delete();

    intersector.delete();
    line2.delete(); ax2.delete(); d2.delete(); p2.delete();
    line1.delete(); ax1.delete(); d1.delete(); p1.delete();
  });

  it('should return trimmed segments when a line overlaps part of a trimmed curve', () => {
    const oc = getOC();

    const origin = new oc.gp_Pnt2d(0, 0);
    const dir = new oc.gp_Dir2d(0, 1);
    const ax = new oc.gp_Ax2d(origin, dir);
    const fullLine = new oc.Geom2d_Line(ax);

    const trimmed = new oc.Geom2d_TrimmedCurve(fullLine, -4.15, 4.4, true, true);

    const p2 = new oc.gp_Pnt2d(0, -10);
    const d2 = new oc.gp_Dir2d(0, 1);
    const ax2 = new oc.gp_Ax2d(p2, d2);
    const line2 = new oc.Geom2d_Line(ax2);

    const intersector = new oc.Geom2dAPI_InterCurveCurve(trimmed, line2, 1e-9);
    const nSeg = intersector.NbSegments();
    const nPts = intersector.NbPoints();

    console.log(`Trimmed vs Line: ${nSeg} segments, ${nPts} points`);

    if (nSeg > 0) {
      const { Curve1, Curve2 } = intersector.Segment(1);

      const fp1 = Curve1.FirstParameter();
      const lp1 = Curve1.LastParameter();

      console.log(`Segment Curve1: FirstParam=${fp1}, LastParam=${lp1}`);

      expect(Math.abs(fp1)).toBeLessThan(1e50);
      expect(Math.abs(lp1)).toBeLessThan(1e50);
      expect(lp1).toBeGreaterThan(fp1);

      const startPt = new oc.gp_Pnt2d();
      Curve1.D0(fp1, startPt);
      console.log(`Segment start: (${startPt.X()}, ${startPt.Y()})`);
      expect(Math.abs(startPt.X())).toBeLessThan(1e50);
      expect(Math.abs(startPt.Y())).toBeLessThan(1e50);

      startPt.delete();
      Curve1.delete();
      Curve2.delete();
    }

    intersector.delete();
    line2.delete(); ax2.delete(); d2.delete(); p2.delete();
    trimmed.delete(); fullLine.delete(); ax.delete(); dir.delete(); origin.delete();
  });

  it('should replicate gridfinity pattern: polygon intersect with rounded rect edges', () => {
    const oc = getOC();

    const SOCKET_SMALL_TAPER = 0.8;
    const SOCKET_BIG_TAPER = 2.4;
    const SOCKET_VERTICAL_PART = 5 - SOCKET_SMALL_TAPER - SOCKET_BIG_TAPER;
    const SOCKET_TAPER_WIDTH = SOCKET_SMALL_TAPER + SOCKET_BIG_TAPER;
    const AXIS_CLEARANCE = (0.5 * Math.sqrt(2)) / 4;

    const mkPt = (x: number, y: number) => new oc.gp_Pnt2d(x, y);
    const mkLine = (x1: number, y1: number, x2: number, y2: number) => {
      const p1 = mkPt(x1, y1);
      const p2 = mkPt(x2, y2);
      const edge = new oc.BRepBuilderAPI_MakeEdge2d(p1, p2).Edge();
      p1.delete(); p2.delete();
      return edge;
    };

    const xStart = -SOCKET_TAPER_WIDTH + AXIS_CLEARANCE;
    const yStart = -AXIS_CLEARANCE;
    const segments = [
      [xStart, yStart, xStart + SOCKET_SMALL_TAPER, yStart + SOCKET_SMALL_TAPER],
      [xStart + SOCKET_SMALL_TAPER, yStart + SOCKET_SMALL_TAPER,
       xStart + SOCKET_SMALL_TAPER, yStart + SOCKET_SMALL_TAPER + SOCKET_VERTICAL_PART],
    ] as const;

    const rectLine1P1 = mkPt(-5, -5);
    const rectLine1P2 = mkPt(-5, 5);
    const rectDir = new oc.gp_Dir2d(0, 1);
    const rectAx = new oc.gp_Ax2d(rectLine1P1, rectDir);
    const rectEdgeCurve = new oc.Geom2d_Line(rectAx);

    for (const [x1, y1, x2, y2] of segments) {
      const segP1 = mkPt(x1, y1);
      const segP2 = mkPt(x2, y2);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const segDir = new oc.gp_Dir2d(dx / len, dy / len);
      const segAx = new oc.gp_Ax2d(segP1, segDir);
      const segCurve = new oc.Geom2d_Line(segAx);

      const intersector = new oc.Geom2dAPI_InterCurveCurve(segCurve, rectEdgeCurve, 1e-9);
      const nSeg = intersector.NbSegments();
      const nPts = intersector.NbPoints();
      console.log(`Segment [${x1.toFixed(2)},${y1.toFixed(2)}]->[${x2.toFixed(2)},${y2.toFixed(2)}] vs rect edge: ${nSeg} segments, ${nPts} points`);

      if (nSeg > 0) {
        for (let i = 1; i <= nSeg; i++) {
          const { Curve1, Curve2 } = intersector.Segment(i);
          const fp = Curve1.FirstParameter();
          const lp = Curve1.LastParameter();
          console.log(`  Segment ${i} Curve1: FirstParam=${fp}, LastParam=${lp}`);

          expect(Math.abs(fp)).toBeLessThan(1e50);
          expect(Math.abs(lp)).toBeLessThan(1e50);

          Curve1.delete();
          Curve2.delete();
        }
      }

      intersector.delete();
      segCurve.delete(); segAx.delete(); segDir.delete();
      segP2.delete(); segP1.delete();
    }

    rectEdgeCurve.delete(); rectAx.delete(); rectDir.delete();
    rectLine1P2.delete(); rectLine1P1.delete();
  });

  it('should produce valid points from Segment curve Value() calls', () => {
    const oc = getOC();

    const center = new oc.gp_Pnt2d(0, 0);
    const dir = new oc.gp_Dir2d(1, 0);
    const ax = new oc.gp_Ax2d(center, dir);
    const circle = new oc.Geom2d_Circle(ax, 5.0, true);

    const lp = new oc.gp_Pnt2d(0, 0);
    const ld = new oc.gp_Dir2d(1, 1);
    const lax = new oc.gp_Ax2d(lp, ld);
    const line = new oc.Geom2d_Line(lax);

    const intersector = new oc.Geom2dAPI_InterCurveCurve(circle, line, 1e-9);
    const nSeg = intersector.NbSegments();
    const nPts = intersector.NbPoints();

    console.log(`Circle vs diagonal line: ${nSeg} segments, ${nPts} points`);

    if (nSeg > 0) {
      const { Curve1, Curve2 } = intersector.Segment(1);

      const fp = Curve1.FirstParameter();
      const lastP = Curve1.LastParameter();
      console.log(`FirstParam=${fp}, LastParam=${lastP}`);

      expect(Math.abs(fp)).toBeLessThan(1e50);
      expect(Math.abs(lastP)).toBeLessThan(1e50);

      const pt = new oc.gp_Pnt2d();
      Curve1.D0(fp, pt);
      const x = pt.X();
      const y = pt.Y();
      console.log(`Start point: (${x}, ${y})`);

      expect(Math.abs(x)).toBeLessThan(100);
      expect(Math.abs(y)).toBeLessThan(100);

      pt.delete();
      Curve1.delete();
      Curve2.delete();
    }

    intersector.delete();
    line.delete(); lax.delete(); ld.delete(); lp.delete();
    circle.delete(); ax.delete(); dir.delete(); center.delete();
  });

  it('should handle collinear overlapping trimmed curves (gridfinity pattern)', () => {
    const oc = getOC();

    const p1 = new oc.gp_Pnt2d(0, 0);
    const d1 = new oc.gp_Dir2d(0, 1);
    const ax1 = new oc.gp_Ax2d(p1, d1);
    const fullLine1 = new oc.Geom2d_Line(ax1);
    const seg1 = new oc.Geom2d_TrimmedCurve(fullLine1, -4.15, 4.4, true, true);

    const p2 = new oc.gp_Pnt2d(0, 0);
    const d2 = new oc.gp_Dir2d(0, 1);
    const ax2 = new oc.gp_Ax2d(p2, d2);
    const fullLine2 = new oc.Geom2d_Line(ax2);
    const seg2 = new oc.Geom2d_TrimmedCurve(fullLine2, -3.0, 3.0, true, true);

    const intersector = new oc.Geom2dAPI_InterCurveCurve(seg1, seg2, 1e-9);
    const nSeg = intersector.NbSegments();
    const nPts = intersector.NbPoints();

    console.log(`Overlapping trimmed lines: ${nSeg} segments, ${nPts} points`);

    for (let i = 1; i <= nSeg; i++) {
      const { Curve1, Curve2 } = intersector.Segment(i);

      const fp1 = Curve1.FirstParameter();
      const lp1 = Curve1.LastParameter();
      const fp2 = Curve2.FirstParameter();
      const lp2 = Curve2.LastParameter();

      console.log(`  Segment ${i}: C1[${fp1}, ${lp1}], C2[${fp2}, ${lp2}]`);

      expect(Math.abs(fp1)).toBeLessThan(1e50);
      expect(Math.abs(lp1)).toBeLessThan(1e50);
      expect(Math.abs(fp2)).toBeLessThan(1e50);
      expect(Math.abs(lp2)).toBeLessThan(1e50);

      const pt = new oc.gp_Pnt2d();
      Curve1.D0(fp1, pt);
      console.log(`  Start point: (${pt.X()}, ${pt.Y()})`);
      expect(Math.abs(pt.X())).toBeLessThan(100);
      expect(Math.abs(pt.Y())).toBeLessThan(100);

      pt.delete();
      Curve1.delete();
      Curve2.delete();
    }

    intersector.delete();
    seg2.delete(); fullLine2.delete(); ax2.delete(); d2.delete(); p2.delete();
    seg1.delete(); fullLine1.delete(); ax1.delete(); d1.delete(); p1.delete();
  });

  it('should return finite segment endpoints for gridfinity-exact vertical overlap at x=0', () => {
    const oc = getOC();

    const origin = new oc.gp_Pnt2d(0, 0);
    const vDir = new oc.gp_Dir2d(0, 1);
    const ax = new oc.gp_Ax2d(origin, vDir);
    const baseLine = new oc.Geom2d_Line(ax);

    const topEdge = new oc.Geom2d_TrimmedCurve(baseLine, -4.15, 4.4, true, true);

    const origin2 = new oc.gp_Pnt2d(0, 0);
    const ax2 = new oc.gp_Ax2d(origin2, vDir);
    const baseLine2 = new oc.Geom2d_Line(ax2);
    const cutEdge = new oc.Geom2d_TrimmedCurve(baseLine2, -10, 0, true, true);

    const intersector = new oc.Geom2dAPI_InterCurveCurve(topEdge, cutEdge, 1e-9);
    const nSeg = intersector.NbSegments();

    expect(nSeg).toBeGreaterThan(0);

    const { Curve1, Curve2 } = intersector.Segment(1);

    const fp = Curve1.FirstParameter();
    const lp = Curve1.LastParameter();
    expect(Math.abs(fp)).toBeLessThan(100);
    expect(Math.abs(lp)).toBeLessThan(100);

    const startPt = new oc.gp_Pnt2d();
    Curve1.D0(fp, startPt);
    const endPt = new oc.gp_Pnt2d();
    Curve1.D0(lp, endPt);

    expect(Math.abs(startPt.X())).toBeLessThan(100);
    expect(Math.abs(startPt.Y())).toBeLessThan(100);
    expect(Math.abs(endPt.X())).toBeLessThan(100);
    expect(Math.abs(endPt.Y())).toBeLessThan(100);

    const fp2 = Curve2.FirstParameter();
    const lp2 = Curve2.LastParameter();
    expect(Math.abs(fp2)).toBeLessThan(100);
    expect(Math.abs(lp2)).toBeLessThan(100);

    console.log(`Gridfinity vertical overlap: C1[${fp}, ${lp}], C2[${fp2}, ${lp2}]`);
    console.log(`  C1 start=(${startPt.X()}, ${startPt.Y()}), end=(${endPt.X()}, ${endPt.Y()})`);

    startPt.delete();
    endPt.delete();
    Curve1.delete();
    Curve2.delete();
    intersector.delete();
    cutEdge.delete(); baseLine2.delete(); ax2.delete(); origin2.delete();
    topEdge.delete(); baseLine.delete(); ax.delete(); vDir.delete(); origin.delete();
  });

  it('should produce finite endpoints even after intersector is deleted', () => {
    const oc = getOC();

    const origin = new oc.gp_Pnt2d(0, 0);
    const dir = new oc.gp_Dir2d(0, 1);
    const ax = new oc.gp_Ax2d(origin, dir);
    const line1 = new oc.Geom2d_Line(ax);
    const seg1 = new oc.Geom2d_TrimmedCurve(line1, -4.15, 4.4, true, true);

    const origin2 = new oc.gp_Pnt2d(0, 0);
    const ax2 = new oc.gp_Ax2d(origin2, dir);
    const line2 = new oc.Geom2d_Line(ax2);
    const seg2 = new oc.Geom2d_TrimmedCurve(line2, -3.0, 3.0, true, true);

    let Curve1: ReturnType<typeof intersector.Segment>['Curve1'];
    let Curve2: ReturnType<typeof intersector.Segment>['Curve2'];

    const intersector = new oc.Geom2dAPI_InterCurveCurve(seg1, seg2, 1e-9);
    ({ Curve1, Curve2 } = intersector.Segment(1));
    intersector.delete();

    const fp = Curve1.FirstParameter();
    const lp = Curve1.LastParameter();
    expect(Math.abs(fp)).toBeLessThan(100);
    expect(Math.abs(lp)).toBeLessThan(100);

    const pt = new oc.gp_Pnt2d();
    Curve1.D0(fp, pt);
    expect(Math.abs(pt.X())).toBeLessThan(100);
    expect(Math.abs(pt.Y())).toBeLessThan(100);

    console.log(`After intersector deleted: C1[${fp}, ${lp}], point=(${pt.X()}, ${pt.Y()})`);

    pt.delete();
    Curve1.delete();
    Curve2.delete();
    seg2.delete(); line2.delete(); ax2.delete(); origin2.delete();
    seg1.delete(); line1.delete(); ax.delete(); dir.delete(); origin.delete();
  });
});

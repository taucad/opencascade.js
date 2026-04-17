/**
 * Smoke tests: FairCurve computation via auto-generated instance method bindings.
 *
 * Validates that FairCurve_Batten and FairCurve_MinimalVariation produce
 * valid BSpline curves with correct geometric properties. The Compute
 * method uses auto-generated return-by-value with enum output param
 * stripping — the FairCurve_AnalysisCode& param is stripped from the
 * JS signature and returned as a property of the result struct.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

/* eslint-disable @typescript-eslint/naming-convention -- OpenCASCADE C++ API naming */
describe.skipIf(!wasmExists)('Smoke: Fair curves', () => {
  beforeAll(async () => { await initOC(); });

  describe('FairCurve_Batten', () => {
    it('should produce a valid BSpline curve between two constraint points', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 5);
      using batten = new oc.FairCurve_Batten(p1, p2, 2.0, 1);

      const result = batten.Compute(50, 1e-3);

      expect(result.result).toBe(true);

      const curve = batten.Curve();
      expect(curve.Degree()).toBeGreaterThanOrEqual(2);
      expect(curve.NbPoles()).toBeGreaterThanOrEqual(2);
      expect(curve.NbKnots()).toBeGreaterThanOrEqual(2);
      expect(curve.LastParameter()).toBeGreaterThan(curve.FirstParameter());
    });

    it('should return a valid FairCurve_AnalysisCode in the result struct', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 0);
      using batten = new oc.FairCurve_Batten(p1, p2, 3.0);
      batten.SetConstraintOrder1(2);
      batten.SetConstraintOrder2(2);
      batten.SetAngle1(0.5);
      batten.SetAngle2(-0.5);

      const result = batten.Compute(50, 1e-3);

      expect(result.result).toBe(true);
      expect(result.Code).toBe(oc.FairCurve_AnalysisCode.FairCurve_OK);
    });

    it('should produce a curve whose endpoints match the constraint points', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 5);
      using batten = new oc.FairCurve_Batten(p1, p2, 2.0, 1);

      batten.Compute(50, 1e-3);

      const curve = batten.Curve();
      using startPt = new oc.gp_Pnt2d(0, 0);
      using endPt = new oc.gp_Pnt2d(0, 0);
      curve.D0(curve.FirstParameter(), startPt);
      curve.D0(curve.LastParameter(), endPt);

      expect(startPt.X()).toBeCloseTo(0, 1);
      expect(startPt.Y()).toBeCloseTo(0, 1);
      expect(endPt.X()).toBeCloseTo(10, 1);
      expect(endPt.Y()).toBeCloseTo(5, 1);
    });

  });

  describe('FairCurve_MinimalVariation', () => {
    it('should produce a valid BSpline curve between two constraint points', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 5);
      using mv = new oc.FairCurve_MinimalVariation(p1, p2, 2.0, 1);

      const result = mv.Compute(50, 1e-3);

      expect(result.result).toBe(true);

      const curve = mv.Curve();
      expect(curve.Degree()).toBeGreaterThanOrEqual(2);
      expect(curve.NbPoles()).toBeGreaterThanOrEqual(2);
      expect(curve.NbKnots()).toBeGreaterThanOrEqual(2);
      expect(curve.LastParameter()).toBeGreaterThan(curve.FirstParameter());
    });

    it('should return a valid FairCurve_AnalysisCode in the result struct', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 0);
      using mv = new oc.FairCurve_MinimalVariation(p1, p2, 3.0);
      mv.SetConstraintOrder1(2);
      mv.SetConstraintOrder2(2);
      mv.SetAngle1(0.5);
      mv.SetAngle2(-0.5);

      const result = mv.Compute(100, 1e-6);

      expect(result.result).toBe(true);
      expect(result.Code).toBe(oc.FairCurve_AnalysisCode.FairCurve_OK);
    });

    it('should produce a curve whose endpoints match the constraint points', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 5);
      using mv = new oc.FairCurve_MinimalVariation(p1, p2, 2.0, 1);

      mv.Compute(50, 1e-3);

      const curve = mv.Curve();
      using startPt = new oc.gp_Pnt2d(0, 0);
      using endPt = new oc.gp_Pnt2d(0, 0);
      curve.D0(curve.FirstParameter(), startPt);
      curve.D0(curve.LastParameter(), endPt);

      expect(startPt.X()).toBeCloseTo(0, 1);
      expect(startPt.Y()).toBeCloseTo(0, 1);
      expect(endPt.X()).toBeCloseTo(10, 1);
      expect(endPt.Y()).toBeCloseTo(5, 1);
    });

    it('should invoke the overridden Compute via virtual dispatch', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 5);
      using mv = new oc.FairCurve_MinimalVariation(p1, p2, 2.0, 1);
      mv.SetPhysicalRatio(0.5);

      const result = mv.Compute(50, 1e-3);

      expect(result.result).toBe(true);
      const curve = mv.Curve();
      expect(curve.NbPoles()).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Batten vs MinimalVariation', () => {
    it('should produce geometrically different curves for non-trivial constraints', () => {
      const oc = getOC();
      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 0);

      using batten = new oc.FairCurve_Batten(p1, p2, 3.0);
      batten.SetConstraintOrder1(2);
      batten.SetConstraintOrder2(2);
      batten.SetAngle1(0.5);
      batten.SetAngle2(-0.5);
      batten.Compute(50, 1e-3);
      const battenCurve = batten.Curve();

      using mv = new oc.FairCurve_MinimalVariation(p1, p2, 3.0);
      mv.SetConstraintOrder1(2);
      mv.SetConstraintOrder2(2);
      mv.SetAngle1(0.5);
      mv.SetAngle2(-0.5);
      mv.Compute(100, 1e-6);
      const mvCurve = mv.Curve();

      using battenMidPt = new oc.gp_Pnt2d(0, 0);
      using mvMidPt = new oc.gp_Pnt2d(0, 0);
      const bMidParam = (battenCurve.FirstParameter() + battenCurve.LastParameter()) / 2;
      const mvMidParam = (mvCurve.FirstParameter() + mvCurve.LastParameter()) / 2;
      battenCurve.D0(bMidParam, battenMidPt);
      mvCurve.D0(mvMidParam, mvMidPt);

      const yDifference = Math.abs(battenMidPt.Y() - mvMidPt.Y());
      expect(yDifference).toBeGreaterThan(0.01);
    });
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

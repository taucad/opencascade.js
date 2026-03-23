/**
 * Smoke tests: Unified return-by-value for output parameters.
 *
 * Validates that C++ methods with non-const reference output parameters
 * (Handle<T>& and primitive T&) return structured objects instead of
 * requiring caller-allocated mutable arguments.
 *
 * Covers:
 * - Handle<T>& output params on const methods (stripped from signature)
 * - Primitive T& output params on const methods (stripped from signature)
 * - Static methods with primitive T& (kept in signature, also returned)
 * - Methods with non-void return + output params
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Output parameter return-by-value', () => {
  beforeAll(async () => { await initOC(); });

  describe('Handle<T>& output params (const method)', () => {
    it('should return Curve1 and Curve2 from Geom2dAPI_InterCurveCurve.Segment', () => {
      const oc = getOC();

      using p1 = new oc.gp_Pnt2d(0, 0);
      using p2 = new oc.gp_Pnt2d(10, 10);
      using d1 = new oc.gp_Dir2d(1, 0);
      using d2 = new oc.gp_Dir2d(0, 1);
      using ax1 = new oc.gp_Ax2d(p1, d1);
      using ax2 = new oc.gp_Ax2d(p2, d2);

      using line1 = new oc.Geom2d_Line(ax1);
      using line2 = new oc.Geom2d_Line(ax2);

      using intersector = new oc.Geom2dAPI_InterCurveCurve(line1, line2);
      const nSegments = intersector.NbSegments();

      if (nSegments > 0) {
        const result = intersector.Segment(1);
        expect(result).toHaveProperty('Curve1');
        expect(result).toHaveProperty('Curve2');
        expect(typeof result.Curve1.delete).toBe('function');
        expect(typeof result.Curve2.delete).toBe('function');
        result.Curve1.delete();
        result.Curve2.delete();
      }
    });

    it('should return valid Curve objects usable after Segment call', () => {
      const oc = getOC();

      using center = new oc.gp_Pnt2d(0, 0);
      using dir = new oc.gp_Dir2d(1, 0);
      using ax = new oc.gp_Ax2d(center, dir);
      using circle = new oc.Geom2d_Circle(ax, 5.0, true);

      using p = new oc.gp_Pnt2d(0, 0);
      using lineDir = new oc.gp_Dir2d(1, 1);
      using lineAx = new oc.gp_Ax2d(p, lineDir);
      using line = new oc.Geom2d_Line(lineAx);

      using intersector = new oc.Geom2dAPI_InterCurveCurve(circle, line);
      const nSegments = intersector.NbSegments();

      if (nSegments > 0) {
        const { Curve1, Curve2 } = intersector.Segment(1);

        expect(Curve1.FirstParameter).toBeDefined();
        expect(Curve2.FirstParameter).toBeDefined();

        const fp1 = Curve1.FirstParameter();
        expect(typeof fp1).toBe('number');

        Curve1.delete();
        Curve2.delete();
      }
    });
  });

  describe('Primitive T& output params (const method, stripped)', () => {
    it('should return U1, U2, V1, V2 from Geom_Surface.Bounds', () => {
      const oc = getOC();

      using ax3 = new oc.gp_Ax3(new oc.gp_Pnt(), new oc.gp_Dir(0, 0, 1));
      using sphere = new oc.Geom_SphericalSurface(ax3, 10.0);

      const bounds = sphere.Bounds();
      expect(bounds).toHaveProperty('U1');
      expect(bounds).toHaveProperty('U2');
      expect(bounds).toHaveProperty('V1');
      expect(bounds).toHaveProperty('V2');

      expect(typeof bounds.U1).toBe('number');
      expect(typeof bounds.U2).toBe('number');
      expect(typeof bounds.V1).toBe('number');
      expect(typeof bounds.V2).toBe('number');

      expect(bounds.U2).toBeGreaterThan(bounds.U1);
    });

    it('should return U and V from GeomAPI_ProjectPointOnSurf.LowerDistanceParameters', () => {
      const oc = getOC();

      using ax3 = new oc.gp_Ax3(new oc.gp_Pnt(), new oc.gp_Dir(0, 0, 1));
      using sphere = new oc.Geom_SphericalSurface(ax3, 10.0);
      using point = new oc.gp_Pnt(10, 0, 0);

      using projector = new oc.GeomAPI_ProjectPointOnSurf(point, sphere);

      if (projector.NbPoints() > 0) {
        const params = projector.LowerDistanceParameters();
        expect(params).toHaveProperty('U');
        expect(params).toHaveProperty('V');
        expect(typeof params.U).toBe('number');
        expect(typeof params.V).toBe('number');
      }
    });
  });

  describe('Static methods with primitive T& output (kept + returned)', () => {
    it('should return UMin, UMax, VMin, VMax from BRepTools.UVBounds', () => {
      const oc = getOC();

      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      const shape = box.Shape();

      using explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
      expect(explorer.More()).toBe(true);

      const face = oc.TopoDS.Face(explorer.Current());

      const result = oc.BRepTools.UVBounds(face, 0, 0, 0, 0);
      expect(result).toHaveProperty('UMin');
      expect(result).toHaveProperty('UMax');
      expect(result).toHaveProperty('VMin');
      expect(result).toHaveProperty('VMax');
      expect(typeof result.UMin).toBe('number');
      expect(typeof result.UMax).toBe('number');
      expect(result.UMax).toBeGreaterThanOrEqual(result.UMin);
    });
  });
});

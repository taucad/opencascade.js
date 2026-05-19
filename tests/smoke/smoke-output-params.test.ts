/**
 * Smoke tests: Unified return-by-value for output parameters.
 *
 * Validates that C++ methods with non-const reference output parameters
 * return structured objects instead of requiring caller-allocated mutable
 * arguments. See `docs/research/ocjs-rbv-test-corpus-contract-drift.md`
 * for the S0/S1/S2 return-shape contract (Handle outputs use Approach G elision).
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
        using result = intersector.Segment(1);
        expect(result).toEqual(expect.objectContaining({
          Curve1: expect.anything(),
          Curve2: expect.anything(),
        }));
        expect(typeof result.Curve1.delete).toBe('function');
        expect(typeof result.Curve2.delete).toBe('function');
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
        using disposable = intersector.Segment(1);
        const { Curve1, Curve2 } = disposable;

        expect(typeof Curve1.FirstParameter).toBe('function');
        expect(typeof Curve2.FirstParameter).toBe('function');

        const fp1 = Curve1.FirstParameter();
        expect(typeof fp1).toBe('number');
      }
    });
  });

  describe('Primitive T& output params (const method, stripped)', () => {
    it('should return U1, U2, V1, V2 from Geom_Surface.Bounds', () => {
      const oc = getOC();

      using gpPnt = new oc.gp_Pnt();
      using gpDir = new oc.gp_Dir(0, 0, 1);
      using ax3 = new oc.gp_Ax3(gpPnt, gpDir);
      using sphere = new oc.Geom_SphericalSurface(ax3, 10.0);

      const bounds = sphere.Bounds(0, 0, 0, 0);
      expect(bounds).toEqual(expect.objectContaining({
        U1: expect.any(Number),
        U2: expect.any(Number),
        V1: expect.any(Number),
        V2: expect.any(Number),
      }));
      expect(bounds.U2).toBeGreaterThan(bounds.U1);
    });

    it('should return U and V from GeomAPI_ProjectPointOnSurf.LowerDistanceParameters', () => {
      const oc = getOC();

      using gpPnt2 = new oc.gp_Pnt();
      using gpDir2 = new oc.gp_Dir(0, 0, 1);
      using ax3 = new oc.gp_Ax3(gpPnt2, gpDir2);
      using sphere = new oc.Geom_SphericalSurface(ax3, 10.0);
      using point = new oc.gp_Pnt(10, 0, 0);

      using projector = new oc.GeomAPI_ProjectPointOnSurf(point, sphere);
      expect(projector.NbPoints()).toBeGreaterThan(0);

      const params = projector.LowerDistanceParameters(0, 0);
      expect(params).toEqual(expect.objectContaining({
        U: expect.any(Number),
        V: expect.any(Number),
      }));
    });
  });

  describe('Static methods with primitive T& output (stripped + returned)', () => {
    it('should return UMin, UMax, VMin, VMax from BRepTools.UVBounds', () => {
      const oc = getOC();

      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using shape = box.Shape();

      using explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
      expect(explorer.More()).toBe(true);

      using explorerCurrent = explorer.Current();
      using face = oc.TopoDS.Face(explorerCurrent);

      const result = oc.BRepTools.UVBounds(face, 0, 0, 0, 0);
      expect(result).toEqual(expect.objectContaining({
        UMin: expect.any(Number),
        UMax: expect.any(Number),
        VMin: expect.any(Number),
        VMax: expect.any(Number),
      }));
      expect(result.UMax).toBeGreaterThanOrEqual(result.UMin);
    });
  });
});

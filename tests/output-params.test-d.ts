/**
 * Type-level tests for unified return-by-value output parameters.
 *
 * Validates that TypeScript declarations correctly reflect the new approach:
 * - Handle<T>& output params on const methods are stripped and returned in object
 * - Primitive T& output params on const methods are stripped and returned in object
 * - Primitive T& on static/non-const methods are kept in signature AND returned
 * - Non-void return methods include original return as `result` in return object
 */
import { expectTypeOf, it, describe } from 'vitest';
import type {
  Geom2dAPI_InterCurveCurve,
  Geom2d_Curve,
  GeomAPI_ProjectPointOnSurf,
  Geom_Surface,
  Bnd_Box,
  BRepTools,
  TopoDS_Face,
} from '../build-configs/opencascade_full';

describe('Handle<T>& output params (const method — stripped)', () => {
  it('should return object with Curve1 and Curve2 from Segment', () => {
    type SegmentReturn = ReturnType<Geom2dAPI_InterCurveCurve['Segment']>;

    expectTypeOf<SegmentReturn>().toHaveProperty('Curve1');
    expectTypeOf<SegmentReturn>().toHaveProperty('Curve2');

    expectTypeOf<SegmentReturn['Curve1']>().toMatchTypeOf<Geom2d_Curve>();
    expectTypeOf<SegmentReturn['Curve2']>().toMatchTypeOf<Geom2d_Curve>();
  });

  it('should accept only Index parameter for Segment', () => {
    expectTypeOf<Geom2dAPI_InterCurveCurve['Segment']>()
      .parameters.toEqualTypeOf<[Index: number]>();
  });

  it('should not return void from Segment', () => {
    expectTypeOf<ReturnType<Geom2dAPI_InterCurveCurve['Segment']>>().not.toBeVoid();
  });
});

describe('Primitive T& output params (const method — stripped)', () => {
  it('should return object with U1, U2, V1, V2 from Geom_Surface.Bounds', () => {
    type BoundsReturn = ReturnType<Geom_Surface['Bounds']>;

    expectTypeOf<BoundsReturn>().toHaveProperty('U1');
    expectTypeOf<BoundsReturn>().toHaveProperty('U2');
    expectTypeOf<BoundsReturn>().toHaveProperty('V1');
    expectTypeOf<BoundsReturn>().toHaveProperty('V2');
  });

  it('should accept no parameters for Bounds (all stripped)', () => {
    expectTypeOf<Geom_Surface['Bounds']>().parameters.toEqualTypeOf<[]>();
  });

  it('should return object with U, V from GeomAPI_ProjectPointOnSurf.LowerDistanceParameters', () => {
    type LDPReturn = ReturnType<GeomAPI_ProjectPointOnSurf['LowerDistanceParameters']>;

    expectTypeOf<LDPReturn>().toHaveProperty('U');
    expectTypeOf<LDPReturn>().toHaveProperty('V');
  });

  it('should accept no parameters for LowerDistanceParameters (all stripped)', () => {
    expectTypeOf<GeomAPI_ProjectPointOnSurf['LowerDistanceParameters']>()
      .parameters.toEqualTypeOf<[]>();
  });
});

describe('Static/non-const primitive T& (kept in signature AND returned)', () => {
  it('should return object with UMin, UMax, VMin, VMax from BRepTools.UVBounds', () => {
    type UVBoundsReturn = ReturnType<(typeof BRepTools)['UVBounds']>;

    expectTypeOf<UVBoundsReturn>().toHaveProperty('UMin');
    expectTypeOf<UVBoundsReturn>().toHaveProperty('UMax');
    expectTypeOf<UVBoundsReturn>().toHaveProperty('VMin');
    expectTypeOf<UVBoundsReturn>().toHaveProperty('VMax');
  });

  it('should keep F and output params in UVBounds signature (first overload)', () => {
    type UVBoundsOverloads = (typeof BRepTools)['UVBounds'];
    type FirstOverload = Extract<UVBoundsOverloads, (F: TopoDS_Face, UMin: number, UMax: number, VMin: number, VMax: number) => unknown>;
    expectTypeOf<FirstOverload>().not.toBeNever();
  });

  it('should not return void from UVBounds', () => {
    expectTypeOf<ReturnType<(typeof BRepTools)['UVBounds']>>().not.toBeVoid();
  });
});

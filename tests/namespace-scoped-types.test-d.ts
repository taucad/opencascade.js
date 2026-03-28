/**
 * Type-level tests for namespace-scoped forward declaration resolution.
 *
 * Types like Geom_EvalRepSurfaceDesc::Base are forward-declared inside
 * namespaces. After extending _resolve_nested_type for NAMESPACE parents,
 * these should resolve to concrete opaque interface types.
 */
import { expectTypeOf, it, describe } from 'vitest';
import type {
  GeomAdaptor_Surface_ExtrusionData,
  GeomAdaptor_Surface_RevolutionData,
  GeomAdaptor_Surface_OffsetData,
  GeomAdaptor_Surface_BezierData,
  GeomAdaptor_Surface_BSplineData,
} from '../build-configs/opencascade_full';

describe('Namespace-scoped type resolution in GeomAdaptor_Surface data types', () => {
  it('GeomAdaptor_Surface_ExtrusionData.EvalRep should not be any', () => {
    expectTypeOf<GeomAdaptor_Surface_ExtrusionData['EvalRep']>().not.toBeAny();
  });

  it('GeomAdaptor_Surface_RevolutionData.EvalRep should not be any', () => {
    expectTypeOf<GeomAdaptor_Surface_RevolutionData['EvalRep']>().not.toBeAny();
  });

  it('GeomAdaptor_Surface_OffsetData.EvalRep should not be any', () => {
    expectTypeOf<GeomAdaptor_Surface_OffsetData['EvalRep']>().not.toBeAny();
  });

  it('GeomAdaptor_Surface_BezierData.EvalRep should not be any', () => {
    expectTypeOf<GeomAdaptor_Surface_BezierData['EvalRep']>().not.toBeAny();
  });

  it('GeomAdaptor_Surface_BSplineData.EvalRep should not be any', () => {
    expectTypeOf<GeomAdaptor_Surface_BSplineData['EvalRep']>().not.toBeAny();
  });
});

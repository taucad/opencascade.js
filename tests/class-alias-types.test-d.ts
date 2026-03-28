/**
 * Type-level tests for class-scoped using-alias resolution.
 *
 * Class member using-aliases like XSAlgo_ShapeProcessor::ParameterMap
 * canonicalize to template types (e.g., NCollection_DataMap<...>).
 * Fix 2's AST-based template arg resolution handles these automatically.
 *
 * Known limitations:
 * - ParameterMap resolves to NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString
 *   which is auto-discovered but not bound (no Embind class_ binding), so TS sees it as `any`.
 * - OperationsFlags resolves to std::bitset<18> which has no STL mapping.
 *
 * Once NCollection_DataMap<AsciiString,AsciiString> is added to the build config
 * and std::bitset gets an STL handler, these assertions can be upgraded to .not.toBeAny().
 */
import { expectTypeOf, it, describe } from 'vitest';
import type {
  IGESControl_Writer,
  STEPCAFControl_Writer,
  XSControl_Reader,
} from '../build-configs/opencascade_full';

describe('Class-scoped using-alias resolution in data exchange classes', () => {
  it('IGESControl_Writer.GetShapeFixParameters() resolves to a concrete type name (unbound NCollection)', () => {
    expectTypeOf<IGESControl_Writer['GetShapeFixParameters']>().returns.toBeAny();
  });

  it('IGESControl_Writer.SetShapeProcessFlags() param is std::bitset<18> (no STL handler)', () => {
    expectTypeOf<Parameters<IGESControl_Writer['SetShapeProcessFlags']>[0]>().toBeAny();
  });

  it('IGESControl_Writer.GetShapeProcessFlags() returns std::bitset<18> (no STL handler)', () => {
    expectTypeOf<IGESControl_Writer['GetShapeProcessFlags']>().returns.toBeAny();
  });

  it('STEPCAFControl_Writer.GetShapeFixParameters() resolves to a concrete type name (unbound NCollection)', () => {
    expectTypeOf<STEPCAFControl_Writer['GetShapeFixParameters']>().returns.toBeAny();
  });

  it('XSControl_Reader.GetShapeFixParameters() resolves to a concrete type name (unbound NCollection)', () => {
    expectTypeOf<XSControl_Reader['GetShapeFixParameters']>().returns.toBeAny();
  });
});

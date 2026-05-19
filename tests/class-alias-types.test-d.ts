/**
 * Type-level tests for class-scoped using-alias resolution.
 *
 * Class member using-aliases like XSAlgo_ShapeProcessor::ParameterMap
 * canonicalize to template types (e.g., NCollection_DataMap<...>).
 * Fix 2's AST-based template arg resolution handles these automatically.
 *
 * Behaviour after audit R8.1's regen pass:
 * - ParameterMap resolves to
 *   NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString. The
 *   underlying class is now auto-discovered AND bound (the alias was upgraded
 *   from a structural fallback to a real Embind class during R5 + R8.1 work),
 *   so accessors return the concrete class rather than `unknown`. The original
 *   assertions targeted the pre-binding `unknown` shape; they have been
 *   tightened to assert the concrete class now that it is exported.
 * - OperationsFlags resolves to std::bitset<18> which has no STL mapping and
 *   stays as `any` until a dedicated STL handler is added.
 */
import { expectTypeOf, it, describe } from 'vitest';
import type {
  IGESControl_Writer,
  NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString,
  STEPCAFControl_Writer,
  XSControl_Reader,
} from '../build-configs/opencascade_full';

describe('Class-scoped using-alias resolution in data exchange classes', () => {
  it('IGESControl_Writer.GetShapeFixParameters() returns concrete DataMap class (R8.1 unblocked)', () => {
    expectTypeOf<IGESControl_Writer['GetShapeFixParameters']>()
      .returns.toEqualTypeOf<NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString>();
  });

  it('IGESControl_Writer.SetShapeProcessFlags() param is std::bitset<18> (no STL handler)', () => {
    expectTypeOf<Parameters<IGESControl_Writer['SetShapeProcessFlags']>[0]>().toBeAny();
  });

  it('IGESControl_Writer.GetShapeProcessFlags() returns std::bitset<18> (no STL handler)', () => {
    expectTypeOf<IGESControl_Writer['GetShapeProcessFlags']>().returns.toBeAny();
  });

  it('STEPCAFControl_Writer.GetShapeFixParameters() returns concrete DataMap class (R8.1 unblocked)', () => {
    expectTypeOf<STEPCAFControl_Writer['GetShapeFixParameters']>()
      .returns.toEqualTypeOf<NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString>();
  });

  it('XSControl_Reader.GetShapeFixParameters() returns concrete DataMap class (R8.1 unblocked)', () => {
    expectTypeOf<XSControl_Reader['GetShapeFixParameters']>()
      .returns.toEqualTypeOf<NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString>();
  });
});

/**
 * Type-level tests for class-scoped using-alias resolution.
 *
 * Class member using-aliases like XSAlgo_ShapeProcessor::ParameterMap
 * canonicalize to template types (e.g., NCollection_DataMap<...>).
 * Fix 2's AST-based template arg resolution handles these automatically.
 *
 * Behaviour after the codegen post-pass:
 * - ParameterMap resolves to NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString.
 *   That alias is auto-discovered but not actually bound (no Embind class_), so the
 *   build-time `_replace_undeclared_with_unknown` post-pass rewrites the reference to
 *   the structural fallback `unknown` (no value at runtime, sound at type-level).
 * - OperationsFlags resolves to std::bitset<18> which has no STL mapping and
 *   stays as `any` until a dedicated STL handler is added.
 *
 * Once NCollection_DataMap<AsciiString,AsciiString> is added to the build config
 * the parameter assertions can be tightened to `.not.toBeAny().not.toBeUnknown()`.
 */
import { expectTypeOf, it, describe } from 'vitest';
import type {
  IGESControl_Writer,
  STEPCAFControl_Writer,
  XSControl_Reader,
} from '../build-configs/opencascade_full';

describe('Class-scoped using-alias resolution in data exchange classes', () => {
  it('IGESControl_Writer.GetShapeFixParameters() resolves to `unknown` (unbound NCollection)', () => {
    expectTypeOf<IGESControl_Writer['GetShapeFixParameters']>().returns.toBeUnknown();
  });

  it('IGESControl_Writer.SetShapeProcessFlags() param is std::bitset<18> (no STL handler)', () => {
    expectTypeOf<Parameters<IGESControl_Writer['SetShapeProcessFlags']>[0]>().toBeAny();
  });

  it('IGESControl_Writer.GetShapeProcessFlags() returns std::bitset<18> (no STL handler)', () => {
    expectTypeOf<IGESControl_Writer['GetShapeProcessFlags']>().returns.toBeAny();
  });

  it('STEPCAFControl_Writer.GetShapeFixParameters() resolves to `unknown` (unbound NCollection)', () => {
    expectTypeOf<STEPCAFControl_Writer['GetShapeFixParameters']>().returns.toBeUnknown();
  });

  it('XSControl_Reader.GetShapeFixParameters() resolves to `unknown` (unbound NCollection)', () => {
    expectTypeOf<XSControl_Reader['GetShapeFixParameters']>().returns.toBeUnknown();
  });
});

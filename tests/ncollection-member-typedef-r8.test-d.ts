/**
 * Type-level tests for NCollection member-typedef peel.
 *
 * NCollection container accessors (`Append`, `Value`, `First`, `Last`,
 * `ChangeFirst`, `ChangeLast`, `ChangeValue`, `SetValue`, `Appended`) were
 * emitted with return type `unknown` when the underlying member typedef
 * (`reference`, `const_reference`, `value_type`) is a template-parameter
 * reference. The member-typedef peel strategy resolves the underlying type
 * one level so canonical-template-key substitution can fire.
 *
 * What these tests prove:
 *   * For instantiations where member-typedef peel was the **decisive** strategy
 *     (typed-id element types like `BRepGraph_OccurrenceId`,
 *     `BRepGraph_SolidId`, `BRepGraph_WireId`), the accessor return
 *     types are now the concrete element class — never `unknown`.
 *   * For pre-existing pass-through cases (`BOPDS_Curve` instantiation)
 *     the accessor types remain concrete, so R8 introduced no
 *     regression.
 *
 * If R8 ever regresses, every `expectTypeOf` in this file will fail at
 * `tsc --noEmit` time with a clear "Type X is not assignable to type Y"
 * message, naming the impacted accessor.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BOPDS_Curve,
  BRepGraph_OccurrenceId,
  BRepGraph_SolidId,
  BRepGraph_WireId,
  NCollection_DynamicArray_BOPDS_Curve,
  NCollection_DynamicArray_BRepGraph_NodeId_Typed_BRepGraph_NodeId_Kind_Occurrence as DynamicArrayOccurrenceId,
  NCollection_DynamicArray_BRepGraph_NodeId_Typed_BRepGraph_NodeId_Kind_Solid as DynamicArraySolidId,
} from '../build-configs/opencascade_full';

describe('R8 — typed-id DynamicArray accessors return concrete element type', () => {
  it('DynamicArray<BRepGraph_OccurrenceId>.Value() returns BRepGraph_OccurrenceId (was unknown)', () => {
    expectTypeOf<DynamicArrayOccurrenceId['Value']>().returns.toEqualTypeOf<BRepGraph_OccurrenceId>();
  });

  it('DynamicArray<BRepGraph_OccurrenceId>.First() returns BRepGraph_OccurrenceId (was unknown)', () => {
    expectTypeOf<DynamicArrayOccurrenceId['First']>().returns.toEqualTypeOf<BRepGraph_OccurrenceId>();
  });

  it('DynamicArray<BRepGraph_OccurrenceId>.ChangeValue() returns BRepGraph_OccurrenceId (was unknown)', () => {
    expectTypeOf<DynamicArrayOccurrenceId['ChangeValue']>().returns.toEqualTypeOf<BRepGraph_OccurrenceId>();
  });

  it('DynamicArray<BRepGraph_OccurrenceId>.Append() returns BRepGraph_OccurrenceId (was unknown)', () => {
    expectTypeOf<DynamicArrayOccurrenceId['Append']>().returns.toEqualTypeOf<BRepGraph_OccurrenceId>();
  });

  it('DynamicArray<BRepGraph_OccurrenceId>.Appended() returns BRepGraph_OccurrenceId (was unknown)', () => {
    expectTypeOf<DynamicArrayOccurrenceId['Appended']>().returns.toEqualTypeOf<BRepGraph_OccurrenceId>();
  });

  it('DynamicArray<BRepGraph_OccurrenceId>.SetValue() returns BRepGraph_OccurrenceId (was unknown)', () => {
    expectTypeOf<DynamicArrayOccurrenceId['SetValue']>().returns.toEqualTypeOf<BRepGraph_OccurrenceId>();
  });

  it('No accessor on DynamicArray<BRepGraph_OccurrenceId> resolves to unknown', () => {
    // `toEqualTypeOf<unknown>` is the exact-shape check for the failing
    // pre-R8 state. The `.not.` negation passes only when the return type
    // is strictly more specific than `unknown` — i.e. R8 substituted.
    expectTypeOf<DynamicArrayOccurrenceId['Value']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArrayOccurrenceId['First']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArrayOccurrenceId['Last']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArrayOccurrenceId['ChangeFirst']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArrayOccurrenceId['ChangeLast']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArrayOccurrenceId['Append']>().returns.not.toEqualTypeOf<unknown>();
  });
});

describe('R8 — second typed-id instantiation (Solid) shows R8 generalises', () => {
  it('DynamicArray<BRepGraph_SolidId>.Value() returns BRepGraph_SolidId', () => {
    expectTypeOf<DynamicArraySolidId['Value']>().returns.toEqualTypeOf<BRepGraph_SolidId>();
  });

  it('DynamicArray<BRepGraph_SolidId>.ChangeFirst() returns BRepGraph_SolidId', () => {
    expectTypeOf<DynamicArraySolidId['ChangeFirst']>().returns.toEqualTypeOf<BRepGraph_SolidId>();
  });

  it('DynamicArray<BRepGraph_SolidId> accessors are never unknown', () => {
    expectTypeOf<DynamicArraySolidId['Last']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArraySolidId['ChangeLast']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArraySolidId['Appended']>().returns.not.toEqualTypeOf<unknown>();
  });
});

describe('R8 — pre-existing pass-through cases stay clean (no regression)', () => {
  // `NCollection_DynamicArray<BOPDS_Curve>` was already typed correctly by
  // the R2/R5 path before R8 landed (visible in the audit V2 baseline scan).
  // These assertions guard against R8 accidentally clobbering paths that
  // didn't need it.
  it('DynamicArray<BOPDS_Curve>.Value() still returns BOPDS_Curve', () => {
    expectTypeOf<NCollection_DynamicArray_BOPDS_Curve['Value']>().returns.toEqualTypeOf<BOPDS_Curve>();
  });

  it('DynamicArray<BOPDS_Curve>.Append() still returns BOPDS_Curve', () => {
    expectTypeOf<NCollection_DynamicArray_BOPDS_Curve['Append']>().returns.toEqualTypeOf<BOPDS_Curve>();
  });

  it('DynamicArray<BOPDS_Curve> accessors are never unknown', () => {
    expectTypeOf<NCollection_DynamicArray_BOPDS_Curve['First']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_DynamicArray_BOPDS_Curve['Last']>().returns.not.toEqualTypeOf<unknown>();
  });
});

describe('R8 — third typed-id instantiation (Wire) cross-checks the diff sample', () => {
  // `BRepGraph_WireId` was one of the concrete contributors verified in
  // `diff /tmp/opencascade_full_R8_DISABLED.d.ts dist/opencascade_full.d.ts`
  // during step-7 measurement. Lock the result in via a type assertion so
  // future generator changes can't silently regress it. The exported class
  // for `NCollection_DynamicArray<BRepGraph_NodeId_Typed<…Kind_Wire>>` uses
  // the full Typed-spelling because the audit's discovered template typedef
  // is the typed-id wrapper, not `BRepGraph_WireId` directly.
  type DynamicArrayWire =
    import('../build-configs/opencascade_full').NCollection_DynamicArray_BRepGraph_NodeId_Typed_BRepGraph_NodeId_Kind_Wire;

  it('DynamicArray<…Kind_Wire>.Value() returns BRepGraph_WireId (was unknown)', () => {
    expectTypeOf<DynamicArrayWire['Value']>().returns.toEqualTypeOf<BRepGraph_WireId>();
  });

  it('DynamicArray<…Kind_Wire>.First() returns BRepGraph_WireId (was unknown)', () => {
    expectTypeOf<DynamicArrayWire['First']>().returns.toEqualTypeOf<BRepGraph_WireId>();
  });

  it('DynamicArray<…Kind_Wire> accessors are never unknown', () => {
    expectTypeOf<DynamicArrayWire['Append']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<DynamicArrayWire['SetValue']>().returns.not.toEqualTypeOf<unknown>();
  });
});

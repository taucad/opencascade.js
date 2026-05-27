/**
 * Type-level tests for Handle-aware substituted-typedef peel.
 *
 * The member-typedef peel correctly resolves accessor return types for
 * *plain* element classes (typed-ids like `BRepGraph_OccurrenceId`, simple
 * classes like `BOPDS_Curve`), but accessors on **Handle-wrapped** element
 * types collapsed to `unknown`.
 *
 * Root cause: after template-arg substitution rewrites
 *   `TheItemType` to `opencascade::handle<X>`, the resolver pipeline
 *   produced a substituted string that no downstream strategy recognised
 *   as a known TS export — neither the simple-name check (the string
 *   contains `<`) nor the qualified-member walker (no `opencascade`
 *   class in `tuInfo.classDict`) could map it back to `X`.
 *
 *   R8.1 closes the gap by regex-matching the three syntactic shapes
 *   OCCT emits — `opencascade::handle<X>`, `occ::handle<X>`, and the
 *   `DEFINE_STANDARD_HANDLE`-generated `Handle_X` typedef — at the
 *   string level inside `resolveWithCanonicalFallback`, and returning
 *   the inner `X` whenever it is a known TS export.
 *
 * What these tests prove:
 *   * For three V2 Appendix A handle-wrapped NCollection
 *     instantiations (`NCollection_Array1<Handle<Geom_Curve>>`,
 *     `NCollection_Sequence<Handle<TDF_Attribute>>`,
 *     `NCollection_Array1<Handle<StepBasic_Approval>>`), every accessor
 *     return type is now the inner Handle-wrapped class — never
 *     `unknown`.
 *   * The change is symmetric across `Array1` and `Sequence` carriers,
 *     proving R8.1 fires uniformly for every NCollection family rather
 *     than being container-specific.
 *
 * If R8.1 ever regresses, every `expectTypeOf` in this file fails at
 * `tsc --noEmit` time with a clear "Type X is not assignable to type Y"
 * message naming the impacted accessor.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  Geom_Curve,
  NCollection_Array1_handle_Geom_Curve,
  NCollection_Array1_handle_StepBasic_Approval,
  NCollection_Sequence_handle_TDF_Attribute,
  StepBasic_Approval,
  TDF_Attribute,
} from '../dist/opencascade_full';

describe('R8.1 — NCollection_Array1<Handle<Geom_Curve>> accessors return Geom_Curve', () => {
  it('Value() returns Geom_Curve (was unknown)', () => {
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['Value']>().returns.toEqualTypeOf<Geom_Curve>();
  });

  it('First() returns Geom_Curve (was unknown)', () => {
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['First']>().returns.toEqualTypeOf<Geom_Curve>();
  });

  it('ChangeValue() returns Geom_Curve (was unknown)', () => {
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['ChangeValue']>().returns.toEqualTypeOf<Geom_Curve>();
  });

  it('At() returns Geom_Curve (was unknown)', () => {
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['At']>().returns.toEqualTypeOf<Geom_Curve>();
  });

  it('No accessor on NCollection_Array1<Handle<Geom_Curve>> resolves to unknown', () => {
    // `toEqualTypeOf<unknown>` is the exact-shape check for the failing
    // pre-R8.1 state. The `.not.` negation passes only when the return
    // type is strictly more specific than `unknown` — i.e. R8.1
    // peeled the handle.
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['Value']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['First']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['Last']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['ChangeFirst']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['ChangeLast']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Array1_handle_Geom_Curve['ChangeAt']>().returns.not.toEqualTypeOf<unknown>();
  });
});

describe('R8.1 — NCollection_Sequence<Handle<TDF_Attribute>> proves Sequence carriers also work', () => {
  // The Sequence family uses a different internal representation than
  // Array1 (linked list rather than contiguous buffer) but shares the
  // member-typedef machinery R8 + R8.1 fix. Locking Sequence-side
  // accessors guards against R8.1 silently regressing on non-Array1
  // containers.
  it('Value(theIndex) returns TDF_Attribute (was unknown)', () => {
    expectTypeOf<NCollection_Sequence_handle_TDF_Attribute['Value']>().returns.toEqualTypeOf<TDF_Attribute>();
  });

  it('First() returns TDF_Attribute (was unknown)', () => {
    expectTypeOf<NCollection_Sequence_handle_TDF_Attribute['First']>().returns.toEqualTypeOf<TDF_Attribute>();
  });

  it('ChangeValue() returns TDF_Attribute (was unknown)', () => {
    expectTypeOf<NCollection_Sequence_handle_TDF_Attribute['ChangeValue']>().returns.toEqualTypeOf<TDF_Attribute>();
  });

  it('Sequence<Handle<TDF_Attribute>> accessors are never unknown', () => {
    expectTypeOf<NCollection_Sequence_handle_TDF_Attribute['Last']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Sequence_handle_TDF_Attribute['ChangeFirst']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Sequence_handle_TDF_Attribute['ChangeLast']>().returns.not.toEqualTypeOf<unknown>();
  });
});

describe('R8.1 — NCollection_Array1<Handle<StepBasic_Approval>> cross-checks STEP/DataExchange surface', () => {
  // `StepBasic_Approval` was one of the V2 Appendix A residual targets
  // explicitly called out as a handle-wrapped instantiation whose
  // accessors leaked `unknown`. Picking a STEP/DataExchange class also
  // verifies R8.1 fires uniformly across kernel modules (geometry,
  // document framework, exchange) rather than being scoped to one
  // include subtree.
  it('Value(theIndex) returns StepBasic_Approval (was unknown)', () => {
    expectTypeOf<NCollection_Array1_handle_StepBasic_Approval['Value']>().returns.toEqualTypeOf<StepBasic_Approval>();
  });

  it('First() returns StepBasic_Approval (was unknown)', () => {
    expectTypeOf<NCollection_Array1_handle_StepBasic_Approval['First']>().returns.toEqualTypeOf<StepBasic_Approval>();
  });

  it('NCollection_Array1<Handle<StepBasic_Approval>> accessors are never unknown', () => {
    expectTypeOf<NCollection_Array1_handle_StepBasic_Approval['ChangeValue']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Array1_handle_StepBasic_Approval['ChangeAt']>().returns.not.toEqualTypeOf<unknown>();
    expectTypeOf<NCollection_Array1_handle_StepBasic_Approval['Last']>().returns.not.toEqualTypeOf<unknown>();
  });
});

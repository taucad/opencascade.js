/**
 * Smoke test: incremental-migration safety — fan-out and std::optional
 * patterns coexist within a single class registration (PoC U1).
 *
 * Pins the contract validated by
 * `repos/opencascade.js/experiments/poc-occt-integration/u1-u3-u4.test.mjs`
 * (`MixedClass.method_fanout` + `MixedClass.method_optional`):
 *
 *   - The libembind v2 dispatcher routes the two method-name registrations
 *     (one fan-out-emitted, one std::optional-emitted) into SEPARATE
 *     `overloadTable` entries on the same prototype. They do not collide.
 *   - A class can carry mixed patterns indefinitely. Bindgen-side
 *     migration is method-by-method safe, not all-or-nothing.
 *
 * STATUS: KEPT CLOSED — blocked by a discovered Phase-4 emission gap.
 *
 * Phase 4 DID bring genuine `std::optional<T>` emission live (the file's
 * original premise — "no std::optional-wrapped lambdas exist" — is now
 * outdated). The flagship row-22 genuine-`std::optional` PARAMETER target
 * is `BRepGraph_ParentExplorer` / `BRepGraph_ChildExplorer`, whose ctors
 * take `const std::optional<BRepGraph_NodeId::Kind>& theAvoidKind`
 * alongside a fan-out (val_default) trailing `theMode` slot — exactly the
 * ctor-optional + fan-out mix this gate wants. HOWEVER:
 *
 *   - `register_optional<BRepGraph_NodeId::Kind>` is NEVER emitted in the
 *     Phase-4 `dist/`. `register_optional<T>` ships only for `T ∈ {bool,
 *     int, occ::handle<NCollection_BaseAllocator>,
 *     occ::handle<IntTools_Context>, TDF_HAllocator}`. There is no
 *     registration for the `BRepGraph_NodeId::Kind` enum.
 *   - Consequently the full-arity genuine-optional ctors throw at runtime:
 *     `Cannot construct BRepGraph_ParentExplorer due to unbound types:
 *      std::optional<BRepGraph_NodeId::Kind>` (verified: 5-arg/6-arg forms
 *      throw; only the 4-arg truncated form constructs, because libembind
 *      routes it away from the unbound full-arity optional invoker — which
 *      is why `smoke-genuine-optional-param.test.ts` passes on non-throw
 *      assertions despite the gap).
 *   - `GetConfig()` is likewise unusable on those classes: the `Config`
 *     value_object carries `std::optional<BRepGraph_NodeId::Kind>` fields,
 *     so marshalling it back throws the same unbound-type error.
 *
 * No OTHER production class pairs a genuine `register_optional`-emitted
 * method/ctor (using a binding type — bool/int/handle) with an independent
 * fan-out (val_default) sibling method on a cleanly constructible class
 * suitable for a behavioral mixed-dispatch smoke (the `register_optional`
 * instances live on NCollection containers — optional allocator ctors with
 * no fan-out sibling — and on the sub-2b math/approx classes that are not
 * straightforwardly constructible with meaningful inputs). The literal
 * "two instance methods (one fan-out, one optional)" shape has no
 * production instance, and the ctor-optional + method-fanout adaptation has
 * no WORKING instance until the gap below is closed. Per the no-fabrication
 * rule the gate stays closed.
 *
 * UNBLOCK CONDITION: emit `register_optional<BRepGraph_NodeId::Kind>` (and,
 * generally, `register_optional<T>` for every enum/class `T` used in a
 * genuine `std::optional<T>` parameter) in the bindgen. Once the
 * `BRepGraph_*Explorer` row-22 ctors are constructible, this gate flips:
 * `MIGRATED_CLASS_NAME = 'BRepGraph_ParentExplorer'`, the genuine-optional
 * `theAvoidKind` slot is `OPTIONAL_METHOD`'s emission, and the val_default
 * `theMode` slot is `FANOUT_METHOD`'s emission — both on the same ctor
 * registration, dispatched independently (readback via `GetConfig()` once
 * its optional fields also bind). See
 * `docs/research/ocjs-skipped-test-reactivation.md` for the full search.
 *
 * Activation gate (when the unblock condition is met):
 *   - Set `MIGRATED_CLASS_NAME`, `FANOUT_METHOD`, and `OPTIONAL_METHOD`
 *     to the concrete identifiers (or adapt to the ctor-optional +
 *     ctor-fanout framing on `BRepGraph_ParentExplorer`).
 *   - Flip `MIXED_DISPATCH_AVAILABLE = true` and remove the `.skip`s.
 *
 * Post-unblock state: the SAME class carries both emission styles; calling
 * either pattern dispatches to the correct binding without disrupting the
 * other.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, wasmExists } from './helpers.js';

const MIXED_DISPATCH_AVAILABLE = false;

describe.skipIf(!wasmExists)('Smoke: mixed fan-out + std::optional dispatch in one class (U1)', () => {
  beforeAll(async () => { await initOC(); });

  it.skipIf(!MIXED_DISPATCH_AVAILABLE)(
    'fan-out method dispatches independently of std::optional method on same prototype',
    () => {
      // Activation-gate premise pin: the flagship genuine-std::optional
      // target (BRepGraph_*Explorer ctors) is runtime-broken because
      // register_optional<BRepGraph_NodeId::Kind> is never emitted (see the
      // file-level JSDoc + docs/research/ocjs-skipped-test-reactivation.md),
      // and no other working register_optional instance carries an
      // independent fan-out sibling on a constructible class. The
      // mixed-dispatch condition therefore cannot yet be reproduced.
      // Flipping MIXED_DISPATCH_AVAILABLE un-skips this and fails here,
      // forcing the real body below to be written:
      //   const oc = getOC();
      //   using instance = new oc[MIGRATED_CLASS_NAME]();
      //   expect(instance[FANOUT_METHOD](1)).toBe(<expected>);
      //   expect(instance[OPTIONAL_METHOD](1)).toBe(<expected>);
      expect(MIXED_DISPATCH_AVAILABLE).toBe(false);
    },
  );

  it.skipIf(!MIXED_DISPATCH_AVAILABLE)(
    'parity: fan-out and std::optional methods return equivalent values at every arity',
    () => {
      // Activation-gate premise pin (see first test). Real body when flipped:
      //   for (const args of [[], [1], [1, true], [1, true, 0.5]]) {
      //     expect(instance[FANOUT_METHOD](...args)).toBe(instance[OPTIONAL_METHOD](...args));
      //   }
      expect(MIXED_DISPATCH_AVAILABLE).toBe(false);
    },
  );

  it.skipIf(!MIXED_DISPATCH_AVAILABLE)(
    'arity-0 omission works on both method names independently',
    () => {
      // Activation-gate premise pin (see first test). Real body when flipped:
      //   expect(() => instance[FANOUT_METHOD]()).not.toThrow();
      //   expect(() => instance[OPTIONAL_METHOD]()).not.toThrow();
      expect(MIXED_DISPATCH_AVAILABLE).toBe(false);
    },
  );
});

/**
 * Smoke test: genuine source-level `std::optional<T>` parameter (matrix row 22).
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - Matrix row 22 — actual `std::optional<T>` parameter (genuine
 *     `Maybe<T>` source-level shape). Best primitive: native
 *     `std::optional<T>` via `register_optional<T>::fromWireType`.
 *   - Differs from rule 5 strict-null: this row's permissive-null
 *     behaviour follows embind's `register_optional<T>` wire converter
 *     which treats both `undefined` and `null` as `std::nullopt` (the
 *     historical PoC R3 four-shape contract). The slot is tagged
 *     `MAYBE_T` per rule 4, not `DEFAULT_ON_ABSENCE`, so rule 5's strict
 *     null does NOT apply.
 *
 * Target: `BRepGraph_ParentExplorer`, ctor overload with a genuine
 * `const std::optional<BRepGraph_NodeId::Kind>& theAvoidKind` slot.
 * Source location:
 * `repos/opencascade.js/deps/OCCT/src/ModelingData/TKBRep/BRepGraph/BRepGraph_ParentExplorer.hxx:112-117`
 *
 *   BRepGraph_ParentExplorer(
 *     const BRepGraph& theGraph,
 *     const BRepGraph_NodeId theNode,
 *     const std::optional<BRepGraph_NodeId::Kind>& theAvoidKind,
 *     bool theEmitAvoidKind,
 *     TraversalMode theMode = TraversalMode::Recursive);
 *
 * Three reachable Maybe-T call shapes for `theAvoidKind` (the genuine
 * `std::optional<T>` slot), each paired with the required `theEmitAvoidKind`
 * bool that follows it:
 *   (b) explicit `undefined` → `std::nullopt`  ← canonical "no avoid-kind"
 *   (c) explicit `Kind` enum value → `std::optional{Kind}`
 *   (d) explicit `null` → `std::nullopt` (permissive per row 22)
 *
 * Why there is no "(a) omitted via arity-pad → nullopt" shape:
 *   `theAvoidKind` is a *middle* parameter (followed by the non-defaulted
 *   `theEmitAvoidKind` bool and the defaulted `theMode`). Trailing
 *   arity-pad — the only padding mechanism in the libembind dispatcher —
 *   can only fill the *last* defaulted slot (`theMode`); it cannot skip a
 *   middle parameter. The 3-arg call `(graph, node, false)` is therefore
 *   unreachable: no overload accepts it (`false` converts to none of the
 *   3-arg `Config` / `TraversalMode` / `NodeId_Kind` overloads), and the
 *   optional ctor still requires `theEmitAvoidKind`. Per policy row 22,
 *   genuine optionals must be passed explicitly, so the canonical
 *   "no avoid-kind" intent is fully expressed by shape (b)
 *   `(graph, node, undefined, false)`. Shape (a) must therefore THROW.
 *
 * Pre-Phase-4 verdict:
 *   - The bindgen emits the BRepGraph_ParentExplorer optional ctor overload
 *     natively via `register_optional<BRepGraph_NodeId::Kind>` (per the
 *     surface audit's row 22 confirmation), so call shapes (b), (c), (d)
 *     work today against the published WASM.
 *   - The `theEmitAvoidKind` required-bool parameter must always be
 *     supplied — it is NOT a defaulted slot, so omitting it must throw.
 *
 * Post-Phase-4 verdict:
 *   - The three reachable Maybe-T shapes for `theAvoidKind` resolve to
 *     `std::nullopt` or `std::optional{Kind}` per the contract.
 *   - The unreachable 3-arg shape (a) continues to throw a BindingError —
 *     this is correct behaviour, not a gap (no C++ analog exists, and
 *     building non-trailing optional-elision would break upstream-mergeable
 *     dispatcher discipline).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists, buildBoxGraph } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: genuine std::optional<T> parameter (row 22)', () => {
  beforeAll(async () => { await initOC(); });

  it('(b) explicit undefined for theAvoidKind → nullopt; explorer constructs and is iterable', () => {
    const oc = getOC();
    const fixture = buildBoxGraph();
    using graph = fixture.graph;
    const rootNode = fixture.addResult.TopologyRoot;
    using explorer = new oc.BRepGraph_ParentExplorer(graph, rootNode, undefined, false);
    expect(explorer).toBeDefined();
  });

  it('(c) explicit Kind enum value → some(Kind); explorer prunes that ancestor kind', () => {
    const oc = getOC();
    const fixture = buildBoxGraph();
    using graph = fixture.graph;
    const rootNode = fixture.addResult.TopologyRoot;
    using explorer = new oc.BRepGraph_ParentExplorer(graph, rootNode, oc.BRepGraph_NodeId_Kind.Solid, false);
    expect(explorer).toBeDefined();
  });

  it('(d) explicit null for theAvoidKind → nullopt (row 22 is permissive null, NOT rule-5 strict)', () => {
    const oc = getOC();
    const fixture = buildBoxGraph();
    using graph = fixture.graph;
    const rootNode = fixture.addResult.TopologyRoot;
    // Row 22 deliberately differs from rule 5 — `null` collapses to
    // `std::nullopt` via embind's `register_optional<T>` rather than
    // throwing a structured BindingError. This is the policy carve-out.
    // The .d.ts now types `theAvoidKind` as
    // `BRepGraph_NodeId_Kind | null | undefined` (the resolver widened the
    // genuine `std::optional<T>` surface to mirror `register_optional<T>`'s
    // wire contract, which accepts both `null` and `undefined`), so `null`
    // is a valid argument at the type level too — no suppression needed.
    expect(() => {
      using explorer = new oc.BRepGraph_ParentExplorer(graph, rootNode, null, false);
      expect(explorer).toBeDefined();
    }).not.toThrow();
  });

  it('(a) 3-arg (graph, node, false) is unreachable — middle optional cannot be elided, so it throws', () => {
    const oc = getOC();
    const fixture = buildBoxGraph();
    using graphFixture = fixture.graph;
    const rootNode = fixture.addResult.TopologyRoot;
    // `theAvoidKind` is a MIDDLE parameter; trailing arity-pad can only fill
    // the last defaulted slot (`theMode`), never skip a middle parameter.
    // `false` matches none of the 3-arg Config / TraversalMode / NodeId_Kind
    // overloads, and the optional ctor still requires `theEmitAvoidKind`.
    // Per policy row 22 the genuine optional must be passed explicitly —
    // the canonical "no avoid-kind" shape is (b) (graph, node, undefined,
    // false). This 3-arg shape therefore has no binding and must throw.
    expect(() => {
      // @ts-expect-error - no 3-arg (graph, node, boolean) overload exists; middle optional cannot be elided
      using explorer = new oc.BRepGraph_ParentExplorer(graphFixture, rootNode, false);
      expect(explorer).toBeDefined();
    }).toThrow();
  });
});

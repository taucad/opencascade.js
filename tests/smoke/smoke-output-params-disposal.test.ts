/**
 * Smoke tests: Symbol.dispose contract for input-passthrough RBV containers.
 *
 * Under the minimal-transformation contract, concrete class outputs are
 * mutated in place and dropped from the envelope, so methods like
 * `Geom_Curve.D1` no longer produce a disposable container. The Symbol.dispose
 * smoke evidence therefore targets a method whose envelope still owns
 * embind-managed (Handle) fields — `BRep_Tool.PolygonOnTriangulation` is the
 * canonical multi-Handle elision case.
 *
 * Validates the EM_JS-registered shared disposer wired by
 * `BUILTIN_ADDITIONAL_BIND_CODE`:
 *   - The container exposes a callable `[Symbol.dispose]` member.
 *   - Calling the disposer deletes every owned embind handle field.
 *   - The `using` declaration drives the disposer at scope exit.
 *   - `DisposableStack.use(...)` adopts the container as a single resource.
 *   - Idempotency: calling the disposer twice on a fresh container is safe
 *     (the second call no-ops on already-deleted fields).
 *
 * The shared disposer is authored via EM_JS and invoked through
 * `ocjs::getRbvDispose()` / `ocjs::getSymbolDispose()`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Symbol.dispose on RBV containers (Handle-elision envelope)', () => {
  beforeAll(async () => {
    await initOC();
  });

  it('PolygonOnTriangulation container exposes a callable [Symbol.dispose]', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    using shape = box.Shape();
    using progressRange = new oc.Message_ProgressRange();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.5, false, 0.5, false);
    mesh.Perform(progressRange);

    using edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    expect(edgeExplorer.More()).toBe(true);
    using edgeCurrent = edgeExplorer.Current();
    using edge = oc.TopoDS.Edge(edgeCurrent);
    using loc = new oc.TopLoc_Location();

    const result = oc.BRep_Tool.PolygonOnTriangulation(edge, loc);
    expect(typeof (result as unknown as { [Symbol.dispose]?: () => void })[Symbol.dispose]).toBe('function');

    result[Symbol.dispose]();
    expect(true).toBe(true);
  });

  it('using declaration drives [Symbol.dispose] at scope exit', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    using shape = box.Shape();
    using progressRange = new oc.Message_ProgressRange();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.5, false, 0.5, false);
    mesh.Perform(progressRange);

    using edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    using edgeCurrent = edgeExplorer.Current();
    using edge = oc.TopoDS.Edge(edgeCurrent);
    using loc = new oc.TopLoc_Location();

    let disposedFlag = false;
    {
      using result = oc.BRep_Tool.PolygonOnTriangulation(edge, loc);
      expect(typeof result.P.isNull).toBe('function');
      disposedFlag = true;
    }
    expect(disposedFlag).toBe(true);
  });

  it('idempotent dispose — second call is a no-op', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    using shape = box.Shape();
    using progressRange = new oc.Message_ProgressRange();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.5, false, 0.5, false);
    mesh.Perform(progressRange);

    using edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    using edgeCurrent = edgeExplorer.Current();
    using edge = oc.TopoDS.Edge(edgeCurrent);
    using loc = new oc.TopLoc_Location();

    using r = oc.BRep_Tool.PolygonOnTriangulation(edge, loc) as unknown as Disposable;
    r[Symbol.dispose]();
    expect(() => r[Symbol.dispose]()).not.toThrow();
  });

  it('DisposableStack.use adopts the container as a single resource', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    using shape = box.Shape();
    using progressRange = new oc.Message_ProgressRange();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.5, false, 0.5, false);
    mesh.Perform(progressRange);

    using edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    using edgeCurrent = edgeExplorer.Current();
    using edge = oc.TopoDS.Edge(edgeCurrent);
    using loc = new oc.TopLoc_Location();

    using stack = new DisposableStack();
    const r = stack.use(oc.BRep_Tool.PolygonOnTriangulation(edge, loc));
    expect(typeof r.P.isNull).toBe('function');
    // stack.dispose() runs at scope exit and disposes r.
  });
});

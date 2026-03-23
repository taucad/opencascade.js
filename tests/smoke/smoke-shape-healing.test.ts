import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Shape healing', () => {
  beforeAll(async () => { await initOC(); });

  it('should fix a valid shape without error with ShapeFix_Shape', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();

    using fixer = new oc.ShapeFix_Shape(shape);
    fixer.Perform(new oc.Message_ProgressRange());
    const fixed = fixer.Shape();
    expect(fixed.IsNull()).toBe(false);

    using explorer = new oc.TopExp_Explorer(
      fixed,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let faceCount = 0;
    while (explorer.More()) {
      faceCount++;
      explorer.Next();
    }
    expect(faceCount).toBe(6);
  });

  it('should fix a wire and preserve topology with ShapeFix_Wire', () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt(0, 0, 0);
    using p2 = new oc.gp_Pnt(10, 0, 0);
    using p3 = new oc.gp_Pnt(10, 10, 0);

    const e1 = new oc.BRepBuilderAPI_MakeEdge(p1, p2).Edge();
    const e2 = new oc.BRepBuilderAPI_MakeEdge(p2, p3).Edge();

    using wireBuilder = new oc.BRepBuilderAPI_MakeWire();
    wireBuilder.Add(e1);
    wireBuilder.Add(e2);
    const wire = wireBuilder.Wire();

    const face = new oc.BRepBuilderAPI_MakeFace(wire, true).Face();
    using fixer = new oc.ShapeFix_Wire(wire, face, 1e-6);
    const result = fixer.Perform();
    expect(typeof result).toBe('boolean');

    const fixedWire = fixer.Wire();
    expect(fixedWire.IsNull()).toBe(false);

    using edgeExplorer = new oc.TopExp_Explorer(
      fixedWire,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let edgeCount = 0;
    while (edgeExplorer.More()) {
      edgeCount++;
      edgeExplorer.Next();
    }
    expect(edgeCount).toBe(2);
  });
});

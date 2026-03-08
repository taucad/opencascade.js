import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Shape healing', () => {
  it('ShapeFix_Shape fixes a valid shape without error', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const fixer = new oc.ShapeFix_Shape_1(shape);
    fixer.Perform(new oc.Message_ProgressRange_1());
    const fixed = fixer.Shape();
    expect(fixed.IsNull()).toBe(false);

    fixer.delete();
    box.delete();
  });

  it('ShapeFix_Wire fixes a wire', async () => {
    const oc = await getOC();
    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const p3 = new oc.gp_Pnt(10, 10, 0);

    const e1 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2).Edge();
    const e2 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3).Edge();

    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
    wireBuilder.Add_1(e1);
    wireBuilder.Add_1(e2);
    const wire = wireBuilder.Wire();

    const fixer = new oc.ShapeFix_Wire_2(wire, new oc.BRepBuilderAPI_MakeFace_15(wire, true).Face(), 1e-6);
    const result = fixer.Perform();
    expect(typeof result).toBe('boolean');

    fixer.delete();
    wireBuilder.delete();
    p1.delete();
    p2.delete();
    p3.delete();
  });
});

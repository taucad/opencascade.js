import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: XCAF document tools', () => {
  it('should create XCAF document with ShapeTool and ColorTool, add box and set color', async () => {
    const oc = await getOC();

    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.Main());

    expect(shapeTool).toBeTruthy();
    expect(colorTool).toBeTruthy();

    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const boxShape = box.Shape();

    const newShapeLabel = shapeTool.NewShape();
    shapeTool.SetShape(newShapeLabel, boxShape);

    const color = new oc.Quantity_Color_3(1, 0, 0, oc.Quantity_TypeOfColor.Quantity_TOC_RGB);
    colorTool.SetColor_5(boxShape, color, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen);

    const retrievedColor = new oc.Quantity_Color_1();
    const hasColor = colorTool.GetColor_7(boxShape, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen, retrievedColor);
    expect(hasColor).toBe(true);

    doc.delete();
    color.delete();
    retrievedColor.delete();
    box.delete();
  });
});

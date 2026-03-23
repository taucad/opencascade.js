import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: XCAF document tools', () => {
  beforeAll(async () => { await initOC(); });

  it('should create XCAF document with ShapeTool and ColorTool, add box and set color', () => {
    const oc = getOC();
    using doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString());
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.Main());

    expect(shapeTool).toBeTruthy();
    expect(colorTool).toBeTruthy();

    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const boxShape = box.Shape();

    const newShapeLabel = shapeTool.NewShape();
    shapeTool.SetShape(newShapeLabel, boxShape);

    using color = new oc.Quantity_Color(1, 0, 0, oc.Quantity_TypeOfColor.Quantity_TOC_RGB);
    colorTool.SetColor(boxShape, color, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen);

    using retrievedColor = new oc.Quantity_Color();
    const hasColor = colorTool.GetColor(boxShape, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen, retrievedColor);
    expect(hasColor).toBe(true);
  });
});

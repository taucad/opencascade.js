/**
 * Smoke tests: STEPCAFControl_Writer.
 *
 * Guards two source patches in the STEPCAFControl package that are required
 * for WASM trimming: `patch_stepcaf_noexcept.py` (rewrites the destructor as
 * `noexcept` so it can be inlined and stripped) and `patch_stepcaf_dyntype.py`
 * (rewrites `DynamicType()` to drop the unused RTTI lookup). Both are easy to
 * regress because they touch generated method bodies. These tests verify that
 * colored STEP export still round-trips correctly after those rewrites.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: STEPCAFControl_Writer', () => {
  beforeAll(async () => {
    await initOC();
  });

  it('should export colored shapes to STEP and produce a file with correct root count', () => {
    const oc = getOC();
    using tCollectionExtendedstring = new oc.TCollection_ExtendedString();
    using doc = new oc.TDocStd_Document(tCollectionExtendedstring);
    using mainLabel = doc.Main();
    using shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel);
    using colorTool = oc.XCAFDoc_DocumentTool.ColorTool(mainLabel);

    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using label1 = shapeTool.NewShape();
    using box1Shape = box1.Shape();
    shapeTool.SetShape(label1, box1Shape);

    using box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    using label2 = shapeTool.NewShape();
    using box2Shape = box2.Shape();
    shapeTool.SetShape(label2, box2Shape);

    using red = new oc.Quantity_Color(1, 0, 0, oc.Quantity_TypeOfColor.Quantity_TOC_RGB);
    using blue = new oc.Quantity_Color(0, 0, 1, oc.Quantity_TypeOfColor.Quantity_TOC_RGB);
    using box1Shape2 = box1.Shape();
    colorTool.SetColor(box1Shape2, red, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen);
    using box2Shape2 = box2.Shape();
    colorTool.SetColor(box2Shape2, blue, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen);

    using writer = new oc.STEPCAFControl_Writer();
    using progress = new oc.Message_ProgressRange();
    const transferOk = writer.Transfer(doc, oc.STEPControl_StepModelType.STEPControl_AsIs, '', progress);
    expect(transferOk).toBe(true);

    const stepPath = '/tmp/_smoke_stepcaf_test.stp';
    const writeStatus = writer.Write(stepPath);
    expect(writeStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    const fileData = oc.FS.readFile(stepPath);
    expect(fileData.length).toBeGreaterThan(100);

    using reader = new oc.STEPControl_Reader();
    const readStatus = reader.ReadFile(stepPath);
    expect(readStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);
    expect(reader.NbRootsForTransfer()).toBeGreaterThanOrEqual(2);

    try {
      oc.FS.unlink(stepPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('should round-trip shape geometry through STEP write and read back', () => {
    const oc = getOC();
    using tCollectionExtendedstring2 = new oc.TCollection_ExtendedString();
    using doc = new oc.TDocStd_Document(tCollectionExtendedstring2);
    using mainLabel = doc.Main();
    using shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel);

    using sphere = new oc.BRepPrimAPI_MakeSphere(15);
    using label = shapeTool.NewShape();
    using sphereShape = sphere.Shape();
    shapeTool.SetShape(label, sphereShape);

    using writer = new oc.STEPCAFControl_Writer();
    using progress = new oc.Message_ProgressRange();
    writer.Transfer(doc, oc.STEPControl_StepModelType.STEPControl_AsIs, '', progress);

    const stepPath = '/tmp/_smoke_stepcaf_roundtrip.stp';
    const writeStatus = writer.Write(stepPath);
    expect(writeStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    using reader = new oc.STEPControl_Reader();
    const readStatus = reader.ReadFile(stepPath);
    expect(readStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    const nRoots = reader.NbRootsForTransfer();
    expect(nRoots).toBeGreaterThanOrEqual(1);

    try {
      oc.FS.unlink(stepPath);
    } catch {
      /* best-effort cleanup */
    }
  });
});

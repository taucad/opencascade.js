import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: RWGltf_CafWriter GLB export', () => {
  beforeAll(async () => { await initOC(); });

  it('should export box to GLB via XCAF document', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const newShape = shapeTool.NewShape();
    shapeTool.SetShape(newShape, shape);
    new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.1, false);

    const glbPath = '/test.glb';
    const cafWriter = new oc.RWGltf_CafWriter(
      new oc.TCollection_AsciiString_3(glbPath),
      true,
    );
    cafWriter.Perform(doc, new oc.TColStd_IndexedDataMapOfStringString(), new oc.Message_ProgressRange());

    const stat = oc.FS.stat(glbPath);
    expect(stat.size).toBeGreaterThan(0);

    cafWriter.delete();
    doc.delete();
    box.delete();
  });
});

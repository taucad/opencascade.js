import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: RWGltf_CafWriter GLB export', () => {
  it('exports box to GLB via XCAF document', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).get();
    const newShape = shapeTool.NewShape();
    shapeTool.SetShape(newShape, shape);
    new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.1, false);

    const glbPath = '/test.glb';
    const cafWriter = new oc.RWGltf_CafWriter(
      new oc.TCollection_AsciiString_2(glbPath),
      true,
    );
    cafWriter.Perform_2(
      new oc.Handle_TDocStd_Document_2(doc),
      new oc.TColStd_IndexedDataMapOfStringString_1(),
      new oc.Message_ProgressRange_1(),
    );

    const stat = oc.FS.stat(glbPath);
    expect(stat).toBeTruthy();
    expect(stat.size).toBeGreaterThan(0);

    cafWriter.delete();
    doc.delete();
    box.delete();
  });
});

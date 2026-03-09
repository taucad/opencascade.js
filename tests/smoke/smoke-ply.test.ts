import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: RWPly_CafWriter PLY export', () => {
  it('should export box to PLY via XCAF document with correct geometry', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const newShape = shapeTool.NewShape();
    shapeTool.SetShape(newShape, shape);
    new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.1, false);

    const plyPath = '/test.ply';
    const cafWriter = new oc.RWPly_CafWriter(
      new oc.TCollection_AsciiString_3(plyPath),
    );
    cafWriter.Perform(
      doc,
      new oc.TColStd_IndexedDataMapOfStringString(),
      new oc.Message_ProgressRange(),
    );

    const fileData = oc.FS.readFile(plyPath, { encoding: 'utf8' }) as string;
    expect(fileData.length).toBeGreaterThan(100);

    const vertexMatch = fileData.match(/element vertex (\d+)/);
    const faceMatch = fileData.match(/element face (\d+)/);

    expect(vertexMatch).toBeTruthy();
    expect(faceMatch).toBeTruthy();

    const vertexCount = Number.parseInt(vertexMatch![1]!, 10);
    const faceCount = Number.parseInt(faceMatch![1]!, 10);

    expect(vertexCount).toBeGreaterThanOrEqual(8);
    expect(faceCount).toBeGreaterThanOrEqual(12);

    oc.FS.unlink(plyPath);
    cafWriter.delete();
    doc.delete();
    box.delete();
  });
});

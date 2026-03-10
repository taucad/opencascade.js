import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: RWObj_CafWriter OBJ export', () => {
  it('should export box to OBJ via XCAF document with correct geometry', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString_1());
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const newShape = shapeTool.NewShape();
    shapeTool.SetShape(newShape, shape);
    new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.1, false);

    const objPath = '/test.obj';
    const cafWriter = new oc.RWObj_CafWriter(new oc.TCollection_AsciiString_3(objPath));
    cafWriter.Perform(doc, new oc.TColStd_IndexedDataMapOfStringString(), new oc.Message_ProgressRange());

    const fileData = oc.FS.readFile(objPath, { encoding: 'utf8' }) as string;
    expect(fileData.length).toBeGreaterThan(100);

    const lines = fileData.split('\n');
    const vertexCount = lines.filter((l: string) => l.startsWith('v ')).length;
    const faceCount = lines.filter((l: string) => l.startsWith('f ')).length;

    expect(vertexCount).toBeGreaterThanOrEqual(8);
    expect(faceCount).toBeGreaterThanOrEqual(12);

    oc.FS.unlink(objPath);
    cafWriter.delete();
    doc.delete();
    box.delete();
  });
});

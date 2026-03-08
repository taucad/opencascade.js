import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: IGESControl Writer and Reader', () => {
  it('writes box to IGES and reads back with shape verification', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const igesPath = '/test.igs';
    const writer = new oc.IGESControl_Writer_1();
    const addOk = writer.AddShape(shape, new oc.Message_ProgressRange());
    expect(addOk).toBe(true);

    writer.ComputeModel();
    writer.Write_2(igesPath, false);

    const fileData = oc.FS.readFile(igesPath);
    expect(fileData.byteLength ?? fileData.length).toBeGreaterThan(500);

    const reader = new oc.IGESControl_Reader();
    const readResult = reader.ReadFile(igesPath);
    expect(readResult.value).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone.value);

    reader.TransferRoots(new oc.Message_ProgressRange());
    const nbShapes = reader.NbShapes();
    expect(nbShapes).toBeGreaterThan(0);

    const readShape = reader.OneShape();
    expect(readShape.IsNull()).toBe(false);

    oc.FS.unlink(igesPath);
    reader.delete();
    writer.delete();
    box.delete();
  });
});

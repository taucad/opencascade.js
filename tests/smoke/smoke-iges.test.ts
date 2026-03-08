import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: IGESControl Writer and Reader', () => {
  it('writes box to IGES and reads back', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const igesPath = '/test.igs';
    const writer = new oc.IGESControl_Writer_1();
    writer.AddShape(shape);
    writer.Write(igesPath);

    const reader = new oc.IGESControl_Reader_1();
    const readResult = reader.ReadFile(igesPath);
    expect(readResult).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    const nbShapes = reader.NbShapes();
    expect(nbShapes).toBeGreaterThan(0);

    writer.delete();
    reader.delete();
    box.delete();
  });
});

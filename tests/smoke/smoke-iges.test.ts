import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: IGESControl Writer and Reader', () => {
  beforeAll(async () => { await initOC(); });

  it('should write box to IGES and read back with shape verification', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();

    const igesPath = '/test.igs';
    const writer = new oc.IGESControl_Writer();
    const addOk = writer.AddShape(shape, new oc.Message_ProgressRange());
    expect(addOk).toBe(true);

    writer.ComputeModel();
    writer.Write(igesPath, false);

    const fileData = oc.FS.readFile(igesPath);
    expect(fileData.byteLength ?? fileData.length).toBeGreaterThan(500);

    const reader = new oc.IGESControl_Reader();
    const readResult = reader.ReadFile(igesPath);
    expect(readResult).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    reader.TransferRoots(new oc.Message_ProgressRange());
    const nbShapes = reader.NbShapes();
    expect(nbShapes).toBe(1);

    const readShape = reader.OneShape();
    expect(readShape.IsNull()).toBe(false);

    oc.FS.unlink(igesPath);
    reader.delete();
    writer.delete();
    box.delete();
  });
});

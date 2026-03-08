import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Data exchange (STEP, STL)', () => {
  it('writes box to STEP via FS, reads back, verifies shape count', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const stepPath = '/test.stp';
    const writer = new oc.STEPControl_Writer_1();
    const transferStatus = writer.Transfer(
      shape,
      oc.STEPControl_AsIs,
      false,
      new oc.Message_ProgressRange_1()
    );
    expect(transferStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    const writeStatus = writer.Write(stepPath);
    expect(writeStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    const reader = new oc.STEPControl_Reader_1();
    const readResult = reader.ReadFile(stepPath);
    expect(readResult).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    reader.TransferRoots(new oc.Message_ProgressRange_1());
    const readShape = reader.OneShape();
    expect(readShape).toBeTruthy();
    expect(readShape.IsNull()).toBe(false);

    const nbShapes = reader.NbShapes();
    expect(nbShapes).toBeGreaterThan(0);

    oc.FS.unlink(stepPath);
    writer.delete();
    reader.delete();
    box.delete();
  });

  it('meshes shape with BRepMesh_IncrementalMesh and writes STL via FS', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const shape = box.Shape();

    const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
    mesh.Perform(new oc.Message_ProgressRange_1());

    const stlPath = '/test.stl';
    const stlWriter = new oc.StlAPI_Writer();
    stlWriter.ASCIIMode = false;
    const stlSuccess = stlWriter.Write(
      shape,
      stlPath,
      new oc.Message_ProgressRange_1()
    );
    expect(stlSuccess).toBe(true);

    const fileData = oc.FS.readFile(stlPath);
    expect(fileData).toBeTruthy();
    expect(fileData.byteLength ?? fileData.length).toBeGreaterThan(0);

    oc.FS.unlink(stlPath);
    mesh.delete();
    stlWriter.delete();
    box.delete();
  });
});

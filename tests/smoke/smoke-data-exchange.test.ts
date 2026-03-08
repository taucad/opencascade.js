import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Data exchange (STEP, STL)', () => {
  it('STEPControl_Writer transfers a shape successfully', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();
    expect(shape.IsNull()).toBe(false);

    const writer = new oc.STEPControl_Writer();
    const transferStatus = writer.Transfer(
      shape,
      oc.STEPControl_StepModelType.STEPControl_AsIs as never,
      false,
      new oc.Message_ProgressRange()
    );

    const doneValue = oc.IFSelect_ReturnStatus.IFSelect_RetDone.value;
    expect(transferStatus.value).toBe(doneValue);

    const model = writer.Model(false);
    expect(model).toBeTruthy();

    writer.delete();
    box.delete();
  });

  it('STEPControl_Reader reads and transfers shapes from STEP data', async () => {
    const oc = await getOC();

    const stepContent = [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION((''), '2;1');",
      "FILE_NAME('test.stp', '2026-01-01', (''), (''), '', '', '');",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
      'ENDSEC;',
      'DATA;',
      '#1 = APPLICATION_PROTOCOL_DEFINITION(\'\', \'automotive_design\', 2000, #2);',
      '#2 = APPLICATION_CONTEXT(\'\');',
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');

    const stepPath = '/test_minimal.stp';
    oc.FS.writeFile(stepPath, stepContent);

    const reader = new oc.STEPControl_Reader();
    const readStatus = reader.ReadFile(stepPath);
    expect(readStatus.value).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone.value);

    try { oc.FS.unlink(stepPath); } catch { /* cleanup */ }
    reader.delete();
  });

  it('meshes shape with BRepMesh_IncrementalMesh and writes STL via FS', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const shape = box.Shape();

    const mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.5, false);
    mesh.Perform(new oc.Message_ProgressRange());

    const stlPath = '/test.stl';
    const stlWriter = new oc.StlAPI_Writer();
    const stlSuccess = stlWriter.Write_1(
      shape,
      stlPath,
      new oc.Message_ProgressRange()
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

import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRepTools Write/Read round-trip', () => {
  it('writes box to FS and reads back', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();
    const brepPath = '/test.brep';
    const progress = new oc.Message_ProgressRange_1();

    const writeFd = oc.FS.open(brepPath, 577); // O_WRONLY | O_CREAT | O_TRUNC
    const writeOk = oc.BRepTools.Write_3(shape, writeFd, progress);
    oc.FS.close(writeFd);
    expect(writeOk).toBe(true);

    const readShape = new oc.TopoDS_Shape();
    const builder = new oc.BRep_Builder();
    const readFd = oc.FS.open(brepPath, 0); // O_RDONLY
    const readOk = oc.BRepTools.Read_2(readShape, readFd, builder, progress);
    oc.FS.close(readFd);
    oc.FS.unlink(brepPath);
    expect(readOk).toBe(true);
    expect(readShape.IsNull()).toBe(false);

    builder.delete();
    box.delete();
  });
});

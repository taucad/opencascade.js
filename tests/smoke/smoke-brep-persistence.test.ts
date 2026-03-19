import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRepTools Write/Read round-trip', () => {
  beforeAll(async () => { await initOC(); });

  it('should write box to FS and read back', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();
    const brepPath = '/test.brep';
    const progress = new oc.Message_ProgressRange();

    const writeOk = oc.BRepTools.Write(shape, brepPath, progress);
    expect(writeOk).toBe(true);

    const readShape = new oc.TopoDS_Shape();
    const builder = new oc.BRep_Builder();
    const readOk = oc.BRepTools.Read(readShape, brepPath, builder, progress);
    oc.FS.unlink(brepPath);
    expect(readOk).toBe(true);
    expect(readShape.IsNull()).toBe(false);

    builder.delete();
    box.delete();
  });
});

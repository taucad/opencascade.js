/**
 * Smoke: import an IGES file from the Emscripten virtual filesystem.
 *
 * Modern port of the legacy `test/patches.test.ts` "can read .iges files
 * (make sure that getpwuid error is not thrown)" case. OCCT's IGES reader
 * resolves the current user via `getpwuid` while stamping transfer metadata;
 * under Emscripten that libc call can abort unless the OCCT source patches
 * are applied. Importing a real on-disk IGES fixture through `FS.createDataFile`
 * exercises that path end-to-end.
 *
 * The fixture (`data/cone.iges`) is the original upstream `test/data/cone.iges`
 * asset, restored from git history. Distinct from `smoke-iges.test.ts`, which
 * round-trips a box the test itself writes; this one parses an externally
 * authored IGES payload staged into the Emscripten FS via `FS.writeFile`
 * (the legacy `FS.createDataFile` helper is typed but not exported at runtime
 * by the full build's `EXPORTED_RUNTIME_METHODS` set).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

const CONE_IGES = path.join(import.meta.dirname, 'data', 'cone.iges');

describe.skipIf(!wasmExists)('Smoke: IGES file import (getpwuid patch canary)', () => {
  beforeAll(async () => { await initOC(); });

  it('reads an on-disk IGES file from the virtual FS and transfers roots', () => {
    const oc = getOC();
    const igesBytes = new Uint8Array(fs.readFileSync(CONE_IGES));

    oc.FS.writeFile('/cone.iges', igesBytes);

    using reader = new oc.IGESControl_Reader();
    const readResult = reader.ReadFile('/cone.iges');
    expect(readResult).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    using progress = new oc.Message_ProgressRange();
    // This is the call that historically tripped the getpwuid abort.
    reader.TransferRoots(progress);

    expect(reader.NbShapes()).toBeGreaterThan(0);
    using shape = reader.OneShape();
    expect(shape.IsNull()).toBe(false);

    oc.FS.unlink('/cone.iges');
  });
});

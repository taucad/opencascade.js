// M6 — STEP file single-import.
//
// Coverage target: STEPControl_Reader + TransferRoots + OneShape pipeline,
// followed by a single mesh extraction of the WHOLE compound. Pairs with
// M7 (multi-component) — M6 stresses the "one shape, large face count"
// scenario, M7 stresses the "many small shapes, iterate-and-mesh" scenario.
//
// The STEP file (MAIN ASSEMBLY.step) is a real-world AP242 PMI assembly
// with 21 sub-solids. M6 meshes it as a single TopoDS_Compound.
//
// Bench harness consideration: the file write to the wasm virtual FS is
// idempotent (writeFile overwrites). The harness should call
// `prewarmStepFile(oc)` ONCE before benchmarking so per-iteration cost
// excludes file I/O — the bench is about build + mesh, not disk I/O.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  writeStepBytesToWasm,
  loadStepShape,
} from '../helpers.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STEP_FS_PATH = '/tmp/main-assembly.step';
const STEP_HOST_PATH = path.resolve(__dirname, '../../assets/main-assembly.step');

let _prewarmed = false;

/**
 * Ensure the STEP file is staged into the wasm virtual FS. Safe to call
 * repeatedly — short-circuits after the first invocation.
 */
export function prewarmStepFile(oc) {
  if (_prewarmed) return;
  const bytes = readFileSync(STEP_HOST_PATH);
  writeStepBytesToWasm(oc, STEP_FS_PATH, bytes);
  _prewarmed = true;
}

export function buildStepCompound(oc) {
  prewarmStepFile(oc);
  return loadStepShape(oc, STEP_FS_PATH);
}

export function runStepSingle(oc, { mesh = 'naive' } = {}) {
  using shape = buildStepCompound(oc);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;
  return meshFn(oc, shape, { tolerance: 0.5, angularTolerance: 0.3 });
}

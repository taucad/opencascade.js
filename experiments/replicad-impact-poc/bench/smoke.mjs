// Phase 1 smoke test: load the custom OCJS subset and exercise BRepPrimAPI_MakeBox.
// Validates the binding YAML produced a working WASM with the expected OCCT surface.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = path.resolve(__dirname, '../build-config/dist/replicad_surface.js');

const { default: createReplicadSurface } = await import(moduleUrl);
const oc = await createReplicadSurface();

// 1. ReplicadAdapters façade smoke
assert.equal(oc.ReplicadAdapters.hello(), 42, 'ReplicadAdapters.hello() should return 42');

// 2. BRepPrimAPI_MakeBox: 10x20x30 box
const box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
const shape = box.Shape();
assert.ok(shape, 'box shape should exist');

// 3. Walk faces with TopExp_Explorer; expect 6
const explorer = new oc.TopExp_Explorer(
  shape,
  oc.TopAbs_ShapeEnum.TopAbs_FACE,
  oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
);
let faceCount = 0;
for (; explorer.More(); explorer.Next()) faceCount++;
assert.equal(faceCount, 6, 'box should have 6 faces');

console.log(`SMOKE OK: ReplicadAdapters.hello=42, MakeBox produced ${faceCount} faces`);

explorer.delete?.();
shape.delete?.();
box.delete?.();

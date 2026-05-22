// Module loader for the custom replicad-surface OCJS subset.
// Exposes a single `loadOC()` function that returns the embind module.
// Kept tiny so all benches load the WASM through the same path.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = path.resolve(__dirname, '../build-config/dist/replicad_surface.js');

let cached;

export async function loadOC() {
  if (cached) return cached;
  const { default: createReplicadSurface } = await import(moduleUrl);
  cached = await createReplicadSurface();
  return cached;
}

export function asPnt(oc, [x, y, z]) {
  return new oc.gp_Pnt(x, y, z);
}

export function asPnt2d(oc, [x, y]) {
  return new oc.gp_Pnt2d(x, y);
}

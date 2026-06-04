#!/usr/bin/env node
/**
 * JS smoke test for docker-e2e-validate.sh Phase 6.
 *
 * Loads Emscripten MODULARIZE + EXPORT_ES6 output via dynamic import()
 * (required for pthread builds — require() hits ERR_REQUIRE_ASYNC_MODULE).
 * Mirrors tests/docker/docker-helpers.ts loadModule().
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const jsPath = process.argv[2];
if (!jsPath) {
  console.error('usage: docker-js-smoke.mjs <path/to/artifact.js>');
  process.exit(2);
}

const absJs = path.resolve(jsPath);
const outDir = path.dirname(absJs);

try {
  const mod = await import(pathToFileURL(absJs).href);
  const init = mod.default ?? mod;
  const oc = await init({
    locateFile: (file) => path.join(outDir, file),
  });
  if (!oc) throw new Error('module init returned falsy');

  const p = new oc.gp_Pnt(1, 2, 3);
  if (p.X() !== 1 || p.Y() !== 2 || p.Z() !== 3) {
    throw new Error(`gp_Pnt round-trip failed: (${p.X()}, ${p.Y()}, ${p.Z()})`);
  }
  const q = new oc.gp_Pnt(4, 5, 6);
  const edge = new oc.BRepBuilderAPI_MakeEdge(p, q);
  if (!edge.IsDone()) {
    throw new Error('BRepBuilderAPI_MakeEdge.IsDone() returned false');
  }
  edge.delete();
  p.delete();
  q.delete();

  oc.PThread?.terminateAllThreads?.();

  console.log('  PASS: gp_Pnt + BRepBuilderAPI_MakeEdge round-trip succeeded.');
} catch (err) {
  console.error('  FAIL:', err?.stack || err);
  process.exit(1);
}

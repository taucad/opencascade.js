#!/usr/bin/env node
/**
 * Generate the OCJS API documentation data feed consumed by `docs-site/`.
 *
 * Pipeline:
 *   1. Walk `build/bindings/<Module>/<Toolkit>/<Package>/<Class>.hxx/<Class>.d.ts.json`.
 *      Each file holds the literal TS declaration text plus `kind`,
 *      `exports`, and `ancestors` (inheritance chain).
 *   2. Cross-reference `dist/opencascade_full.build-manifest.json` to surface
 *      compiled-but-undocumented symbols (typically NCollection auto-discovered
 *      template instantiations baked into the consolidated `.d.ts`).
 *   3. Parse the TS text with a focused parser tuned to the uniform OCJS-bound
 *      shape (constructors, static methods, instance methods, properties,
 *      JSDoc block comments).
 *   4. Emit:
 *        - `docs-site/data/index.json`  — full Module / Toolkit / Package
 *          hierarchy + WASM-size + a flat search index.
 *        - `docs-site/data/<Module>__<Toolkit>__<Package>.json` — parsed class
 *          cards (one per bound class).
 *
 * Run:   pnpm nx run ocjs:docs
 * Or:    node scripts/generate-docs.mjs
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseDeclaration } from './lib/dts-parser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BINDINGS_DIR = path.join(ROOT, 'build', 'bindings');
const MANIFEST_PATH = path.join(ROOT, 'dist', 'opencascade_full.build-manifest.json');
const DTS_PATH = path.join(ROOT, 'dist', 'opencascade_full.d.ts');
const OUTPUT_DIR = path.join(ROOT, 'docs-site', 'data');
const PROJECT_NAME = '@taucad/opencascade.js';

const SYNTHETIC_MODULE = 'Synthetic';
const SYNTHETIC_TOOLKIT = 'NCollectionAuto';
const SYNTHETIC_PACKAGE = 'Generated';

const SHARD_DELIM = '__';

const TOOLKIT_HEADLINES = {
  TKernel: 'Foundation runtime, OS abstraction, memory, messages, type system.',
  TKMath: 'Numerics, gp_* geometry primitives, Bnd boxes, Poly meshes.',
  TKBRep: 'Boundary representation core (TopoDS, BRep, BRepLProp).',
  TKG2d: '2D geometry (Geom2d_*, Adaptor2d_*).',
  TKG3d: '3D geometry (Geom_*, Adaptor3d_*, TopoDS_*).',
  TKGeomBase: 'Geometric base algorithms (GeomAPI, GeomLProp, GeomLib, ProjLib).',
  TKGeomAlgo: 'Geometry algorithms (GeomFill, GeomConvert, GeomPlate, IntCurve).',
  TKTopAlgo: 'Topology algorithms (BRepClass, BRepCheck, BRepGProp, BRepExtrema).',
  TKBO: 'Boolean operations (BRepAlgoAPI, BOPAlgo, BOPTools, BOPDS).',
  TKBool: 'Legacy boolean engine (TopOpe* — see exclusion notes).',
  TKPrim: 'Primitive shape builders (BRepPrim, BRepPrimAPI).',
  TKFillet: 'Fillets, chamfers, blending (BRepFilletAPI, ChFi3d, BlendFunc).',
  TKOffset: 'Offset and draft (BRepOffsetAPI, BiTgte, Draft).',
  TKHLR: 'Hidden line removal (HLRAlgo, HLRBRep, HLRTopoBRep).',
  TKMesh: 'Surface meshing (BRepMesh, IMeshTools).',
  TKXMesh: 'Extended meshing (BRepGProp, MeshVS adapters).',
  TKShHealing: 'Shape repair and healing (ShapeAnalysis, ShapeBuild, ShapeFix, ShapeUpgrade).',
  TKCAF: 'Standard CAF document framework.',
  TKLCAF: 'Lightweight CAF (TDF, TDocStd, TDataStd, TNaming, TFunction).',
  TKCDF: 'Cascade Document Framework (CDF, CDM, PCDM, LDOM).',
  TKVCAF: 'Visual CAF (selection, presentation).',
  TKXCAF: 'XCAF assemblies, colours, materials, metadata.',
  TKDE: 'Data Exchange Wrapper core.',
  TKDECascade: 'Native OCCT format reader/writer.',
  TKDEGLTF: 'glTF 2.0 reader/writer.',
  TKDEIGES: 'IGES reader/writer.',
  TKDEOBJ: 'Wavefront OBJ reader/writer.',
  TKDEPLY: 'Stanford PLY reader.',
  TKDESTEP: 'STEP reader/writer (AP203, AP214, AP242 GDT, kinematics).',
  TKDESTL: 'STL reader/writer.',
  TKDEVRML: 'VRML reader/writer.',
};

const MODULE_HEADLINES = {
  FoundationClasses: 'Runtime primitives: gp_*, Standard_*, NCollection, OS abstraction.',
  ModelingData: 'Geometric and topological data structures (Geom, BRep, TopoDS).',
  ModelingAlgorithms:
    'Constructive algorithms: BRepBuilderAPI, BRepPrimAPI, BRepAlgoAPI, BRepFilletAPI, BRepOffsetAPI.',
  DataExchange: 'STEP, IGES, glTF, OBJ, STL, VRML readers/writers and XCAF integration.',
  ApplicationFramework: 'OCAF document framework: TDF/TDocStd/XCAF (assemblies, attributes, naming).',
  [SYNTHETIC_MODULE]:
    'Auto-discovered NCollection template instantiations and OCJS custom bindings (sourced from myMain.h).',
};

async function listBindingFiles() {
  const out = [];
  const stack = [BINDINGS_DIR];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.d.ts.json')) {
        out.push(full);
      }
    }
  }
  return out;
}

function classifyPath(absPath) {
  // Expected pattern:
  //   .../build/bindings/<Module>/<Toolkit>/<Package>/<Class>.hxx/<Class>.d.ts.json
  // Synthetic NCollection bucket:
  //   .../build/bindings/myMain.h/<Class>.d.ts.json
  const rel = path.relative(BINDINGS_DIR, absPath);
  const segments = rel.split(path.sep);
  if (segments[0] === 'myMain.h' || segments.length < 4) {
    return {
      module: SYNTHETIC_MODULE,
      toolkit: SYNTHETIC_TOOLKIT,
      package: SYNTHETIC_PACKAGE,
    };
  }
  return {
    module: segments[0],
    toolkit: segments[1],
    package: segments[2],
  };
}

async function readManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[ocjs-docs] manifest unavailable (${MANIFEST_PATH}): ${err.message}`);
    return null;
  }
}

async function readDtsSizeBytes() {
  try {
    const stat = await fs.stat(DTS_PATH);
    return stat.size;
  } catch {
    return null;
  }
}

function shardKey({ module: m, toolkit, package: pkg }) {
  return `${m}${SHARD_DELIM}${toolkit}${SHARD_DELIM}${pkg}`;
}

function emptyIndexNode() {
  return new Map();
}

function ensurePath(modules, classify) {
  if (!modules.has(classify.module)) {
    modules.set(classify.module, {
      name: classify.module,
      headline: MODULE_HEADLINES[classify.module] ?? '',
      toolkits: emptyIndexNode(),
    });
  }
  const moduleNode = modules.get(classify.module);
  if (!moduleNode.toolkits.has(classify.toolkit)) {
    moduleNode.toolkits.set(classify.toolkit, {
      name: classify.toolkit,
      headline: TOOLKIT_HEADLINES[classify.toolkit] ?? '',
      packages: emptyIndexNode(),
    });
  }
  const toolkitNode = moduleNode.toolkits.get(classify.toolkit);
  if (!toolkitNode.packages.has(classify.package)) {
    toolkitNode.packages.set(classify.package, {
      name: classify.package,
      shard: `${shardKey(classify)}.json`,
      classes: [],
    });
  }
  return toolkitNode.packages.get(classify.package);
}

function summarizeClass(parsed) {
  // Index-time fields (cheap, sidebar-ready).
  return {
    name: parsed.name,
    kind: parsed.kind,
    extends: parsed.extends ?? [],
    summary: parsed.summary ?? '',
    members: {
      constructors: parsed.constructors.length,
      staticMethods: parsed.staticMethods.length,
      instanceMethods: parsed.instanceMethods.length,
      properties: parsed.properties.length,
    },
  };
}

/**
 * Stable DOM id for overload rows — must mirror `memberAnchorId` in the
 * Fumadocs-powered API viewer that consumes the generated search index.
 *
 * Slots: ctor | static | inst | prop
 */
function memberSearchAnchor(className, kindSlot, overloadIndex) {
  return `${className}__${kindSlot}__${overloadIndex}`;
}

function buildSearchEntries(classify, parsed) {
  const entries = [];
  const ownerPath = `${classify.module}/${classify.toolkit}/${classify.package}`;
  entries.push({
    n: parsed.name,
    k: 'class',
    p: ownerPath,
    s: shardKey(classify),
    a: parsed.name,
    q: parsed.name.toLowerCase(),
  });
  /** Slot anchor ids match `memberAnchorId(cls.name, kind, i)` consumed by the API page renderer. */
  let sIdx = 0;
  for (const m of parsed.staticMethods) {
    if (!m?.name) continue;
    const memberName = `${parsed.name}.${m.name}`;
    entries.push({
      n: memberName,
      k: 'static',
      p: ownerPath,
      s: shardKey(classify),
      a: memberSearchAnchor(parsed.name, 'static', sIdx),
      q: memberName.toLowerCase(),
    });
    sIdx++;
  }
  let iIdx = 0;
  for (const m of parsed.instanceMethods) {
    if (!m?.name) continue;
    const memberName = `${parsed.name}.${m.name}`;
    entries.push({
      n: memberName,
      k: 'method',
      p: ownerPath,
      s: shardKey(classify),
      a: memberSearchAnchor(parsed.name, 'inst', iIdx),
      q: memberName.toLowerCase(),
    });
    iIdx++;
  }
  let pIdx = 0;
  for (const m of parsed.properties) {
    if (!m?.name) continue;
    const memberName = `${parsed.name}.${m.name}`;
    entries.push({
      n: memberName,
      k: 'property',
      p: ownerPath,
      s: shardKey(classify),
      a: memberSearchAnchor(parsed.name, 'prop', pIdx),
      q: memberName.toLowerCase(),
    });
    pIdx++;
  }
  return entries;
}

function indexToOrderedJson(modules) {
  const arr = [];
  for (const [, mNode] of modules) {
    const toolkits = [];
    let mCount = 0;
    for (const [, tNode] of mNode.toolkits) {
      const packages = [];
      let tCount = 0;
      for (const [, pNode] of tNode.packages) {
        pNode.classes.sort((a, b) => a.name.localeCompare(b.name));
        packages.push(pNode);
        tCount += pNode.classes.length;
      }
      packages.sort((a, b) => a.name.localeCompare(b.name));
      toolkits.push({
        name: tNode.name,
        headline: tNode.headline,
        classCount: tCount,
        packages,
      });
      mCount += tCount;
    }
    toolkits.sort((a, b) => a.name.localeCompare(b.name));
    arr.push({
      name: mNode.name,
      headline: mNode.headline,
      classCount: mCount,
      toolkitCount: toolkits.length,
      toolkits,
    });
  }
  // Stable, user-friendly module order.
  const ORDER = [
    'FoundationClasses',
    'ModelingData',
    'ModelingAlgorithms',
    'DataExchange',
    'ApplicationFramework',
    SYNTHETIC_MODULE,
  ];
  arr.sort((a, b) => {
    const ai = ORDER.indexOf(a.name);
    const bi = ORDER.indexOf(b.name);
    const aix = ai === -1 ? ORDER.length : ai;
    const bix = bi === -1 ? ORDER.length : bi;
    if (aix !== bix) return aix - bix;
    return a.name.localeCompare(b.name);
  });
  return arr;
}

async function emitJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data));
}

async function main() {
  const t0 = Date.now();
  const manifest = await readManifest();
  const dtsBytes = await readDtsSizeBytes();

  console.log(`[ocjs-docs] Scanning ${path.relative(ROOT, BINDINGS_DIR)}…`);
  const files = await listBindingFiles();
  console.log(`[ocjs-docs] Found ${files.length} .d.ts.json files.`);

  const modules = emptyIndexNode();
  const shardClasses = new Map(); // shardKey -> [parsed]
  const searchIndex = [];
  let parseErrors = 0;

  for (const file of files) {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      parseErrors++;
      continue;
    }
    if (!raw.trim()) {
      parseErrors++;
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      parseErrors++;
      continue;
    }
    const dtsText = payload['.d.ts'];
    if (typeof dtsText !== 'string' || !dtsText.trim()) continue;
    const classify = classifyPath(file);
    const parsed = parseDeclaration({
      text: dtsText,
      kind: payload.kind,
      exports: payload.exports ?? [],
      ancestors: payload.ancestors ?? {},
    });
    if (!parsed) continue;

    const pkgNode = ensurePath(modules, classify);
    pkgNode.classes.push(summarizeClass(parsed));

    const key = shardKey(classify);
    if (!shardClasses.has(key)) shardClasses.set(key, []);
    shardClasses.get(key).push(parsed);

    for (const e of buildSearchEntries(classify, parsed)) {
      searchIndex.push(e);
    }
  }

  searchIndex.sort((a, b) => a.q.localeCompare(b.q));

  const orderedModules = indexToOrderedJson(modules);
  const totalClasses = orderedModules.reduce((acc, m) => acc + m.classCount, 0);
  const totalToolkits = orderedModules.reduce((acc, m) => acc + m.toolkitCount, 0);
  const totalPackages = orderedModules.reduce(
    (acc, m) => acc + m.toolkits.reduce((tk, t) => tk + t.packages.length, 0),
    0,
  );

  // Manifest "extras" represent NCollection auto-discovered template
  // instantiations that DON'T have a separate .d.ts.json (they're folded into
  // the consolidated dist/.d.ts). Surface their count for the welcome page.
  const compiledTotal =
    typeof manifest?.symbols?.compiled === 'number' ? manifest.symbols.compiled : null;
  const requestedTotal = Array.isArray(manifest?.symbols?.requested)
    ? manifest.symbols.requested.length
    : null;
  const ncollectionExtras =
    compiledTotal != null && requestedTotal != null ? compiledTotal - requestedTotal : null;

  const index = {
    schema: 2,
    project: PROJECT_NAME,
    generatedAt: new Date().toISOString(),
    manifest: manifest
      ? {
          wasm_bytes: manifest.outputs?.[0]?.wasm_size ?? null,
          dts_bytes: dtsBytes,
          js_bytes: manifest.outputs?.[0]?.js_size ?? null,
          validation_passed: manifest.validation_passed === true,
          requested: requestedTotal,
          compiled: compiledTotal,
          ncollection_auto: ncollectionExtras,
          occt_yaml: manifest.yaml_config ?? null,
          built_at: manifest.timestamp ?? null,
        }
      : null,
    totals: {
      modules: orderedModules.length,
      toolkits: totalToolkits,
      packages: totalPackages,
      classes: totalClasses,
      searchEntries: searchIndex.length,
      parseSkipped: parseErrors,
    },
    quickLinks: [
      { name: 'gp_Pnt', kind: 'class', p: 'FoundationClasses/TKMath/gp', s: shardLookup(modules, 'FoundationClasses', 'TKMath', 'gp') },
      { name: 'TopoDS_Shape', kind: 'class', p: 'ModelingData/TKBRep/TopoDS', s: shardLookup(modules, 'ModelingData', 'TKBRep', 'TopoDS') },
      { name: 'BRep_Tool', kind: 'class', p: 'ModelingData/TKBRep/BRep', s: shardLookup(modules, 'ModelingData', 'TKBRep', 'BRep') },
      { name: 'BRepBuilderAPI_MakeShape', kind: 'class', p: 'ModelingAlgorithms/TKTopAlgo/BRepBuilderAPI', s: shardLookup(modules, 'ModelingAlgorithms', 'TKTopAlgo', 'BRepBuilderAPI') },
      { name: 'BRepPrimAPI_MakeBox', kind: 'class', p: 'ModelingAlgorithms/TKPrim/BRepPrimAPI', s: shardLookup(modules, 'ModelingAlgorithms', 'TKPrim', 'BRepPrimAPI') },
      { name: 'BRepAlgoAPI_Fuse', kind: 'class', p: 'ModelingAlgorithms/TKBO/BRepAlgoAPI', s: shardLookup(modules, 'ModelingAlgorithms', 'TKBO', 'BRepAlgoAPI') },
      { name: 'GeomAPI_Interpolate', kind: 'class', p: 'ModelingAlgorithms/TKGeomBase/GeomAPI', s: shardLookup(modules, 'ModelingAlgorithms', 'TKGeomBase', 'GeomAPI') },
      { name: 'STEPControl_Reader', kind: 'class', p: 'DataExchange/TKDESTEP/STEPControl', s: shardLookup(modules, 'DataExchange', 'TKDESTEP', 'STEPControl') },
    ].filter((q) => q.s),
    modules: orderedModules,
    searchIndex,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  // Wipe stale shards so deletions in build/bindings are reflected.
  const existing = await fs.readdir(OUTPUT_DIR).catch(() => []);
  await Promise.all(
    existing
      .filter((f) => f.endsWith('.json'))
      .map((f) => fs.unlink(path.join(OUTPUT_DIR, f)).catch(() => {})),
  );

  await emitJson(path.join(OUTPUT_DIR, 'index.json'), index);

  for (const [key, classes] of shardClasses) {
    classes.sort((a, b) => a.name.localeCompare(b.name));
    await emitJson(path.join(OUTPUT_DIR, `${key}.json`), {
      schema: 2,
      shard: key,
      generatedAt: index.generatedAt,
      classes,
    });
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[ocjs-docs] Emitted ${shardClasses.size} package shards + index.json` +
      ` — ${totalClasses} classes across ${totalPackages} packages` +
      ` (${elapsed}s, ${parseErrors} skipped).`,
  );
}

function shardLookup(modules, mName, tName, pName) {
  const m = modules.get(mName);
  if (!m) return null;
  const t = m.toolkits.get(tName);
  if (!t) return null;
  const p = t.packages.get(pName);
  if (!p) return null;
  return p.shard;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

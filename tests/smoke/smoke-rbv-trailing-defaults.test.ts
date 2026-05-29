/**
 * Smoke test: TR-RBV (return-by-value-wrapper trailing-default gate).
 *
 * Pins the defect catalogued at
 * `docs/research/ocjs-bindgen-libembind-outstanding-issues-catalog.md`
 * Finding 1 row TR-RBV. Concrete target identified by Phase 0 pre-scan:
 * `BRepGraph_Transform::Perform(graph, trsf, copyGeom = true, copyMesh = false)`
 * (`repos/opencascade.js/deps/OCCT/src/ModelingData/TKBRep/BRepGraph/BRepGraph_Transform.hxx:69-72`).
 *
 * Why a codegen-emission test instead of a runtime call:
 *
 * The TR-RBV emit path uses `optional_override([...](...) -> emscripten::val {...})`
 * for the RBV envelope (see
 * `src/ocjs_bindgen/codegen/bindings.py:1645-1678`). embind's
 * `optional_override` lambda registration is permissive about missing
 * JS arguments — they are passed through as `undefined` which silently
 * coerces to the C++ ABI default for primitives (`false` for `bool`,
 * `0` for numeric, `null` for class pointers). This means TR-RBV does
 * NOT throw an arity error at the JS boundary — instead it silently
 * applies the WRONG defaults (the JS-undefined-coerced ones, not the
 * C++ source defaults). For `BRepGraph_Transform::Perform`, a 2-arg
 * call `Perform(graph, trsf)` succeeds today but executes as if
 * `copyGeom = false, copyMesh = false` instead of the C++-source
 * `copyGeom = true, copyMesh = false`.
 *
 * Pinning the silent-semantic defect via end-to-end behavioural diff
 * is fragile (depends on whether BRepGraph's shallow vs deep copy is
 * externally observable through accessor methods, which it largely
 * isn't). The deterministic regression pin is therefore at the
 * codegen-emission layer: today the compiled binding emits ONE
 * `.class_function("Perform"` entry (the full-arity 4-arg envelope);
 * after the TR-RBV fix lands the bindgen will emit THREE entries
 * (arity 4 plus the two trailing-default truncations).
 *
 * Expected outcome today: ONE class_function emission → test fails
 * (asserting >= 3, the post-fix count). Expected outcome after the
 * bindgen TR-RBV fix lands: THREE class_function emissions → test
 * passes. This test will flip from failing to passing when the fix
 * is shipped.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists, buildBoxGraph } from './helpers.js';

const BINDING_CPP = path.resolve(
  import.meta.dirname,
  '../../build/bindings/ModelingData/TKBRep/BRepGraph/BRepGraph_Transform.hxx/BRepGraph_Transform.cpp',
);
const bindingExists = fs.existsSync(BINDING_CPP);

describe.skipIf(!wasmExists)('Smoke: TR-RBV return-by-value-wrapper trailing-default gate', () => {
  beforeAll(async () => { await initOC(); });

  describe('BRepGraph_Transform.Perform(graph, trsf, copyGeom = true, copyMesh = false)', () => {
    it('counterfactual: 4-arg full-arity call returns a BRepGraph (proves binding is sound)', () => {
      const oc = getOC();
      using inputGraph = buildBoxGraph().graph;
      using trsf = new oc.gp_Trsf();
      using vec = new oc.gp_Vec(10, 0, 0);
      trsf.SetTranslation(vec);
      using result = oc.BRepGraph_Transform.Perform(inputGraph, trsf, true, false);
      expect(result).toBeDefined();
      expect(result.constructor.name).toBe('BRepGraph');
    });

    it.skipIf(!bindingExists)(
      'TR-RBV defect: compiled binding should emit truncation lambdas for each trailing default but only emits the full-arity envelope today',
      () => {
        // The C++ source declares two trailing defaults:
        //   `bool copyGeom = true, bool copyMesh = false`.
        // After the TR-RBV fix, the bindgen will fan out one
        // truncation per default → 1 + 2 = 3 `.class_function("Perform"` entries.
        const cpp = fs.readFileSync(BINDING_CPP, 'utf8');
        const performEntries = cpp.match(/\.class_function\("Perform"/g) ?? [];
        expect(performEntries.length).toBeGreaterThanOrEqual(3);
      },
    );
  });
});

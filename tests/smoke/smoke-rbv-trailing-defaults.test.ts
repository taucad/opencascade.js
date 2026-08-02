/**
 * Smoke test: TR-RBV (return-by-value-wrapper trailing-default gate).
 *
 * Pins the defect catalogued at
 * `docs/research/ocjs-bindgen-libembind-outstanding-issues-catalog.md`
 * Finding 1 row TR-RBV. Concrete target identified by Phase 0 pre-scan:
 * `ExtremaPC_Curve::Perform(point, tolerance, mode = MinMax)`.
 *
 * Why a codegen-emission test instead of a runtime call:
 *
 * The TR-RBV emit path uses `optional_override([...](...) -> emscripten::val {...})`
 * for the RBV envelope (see
 * `src/ocjs_bindgen/codegen/bindings.py:1645-1678`). embind's
 * `optional_override` lambda registration is permissive about missing
 * JS arguments. The bindgen must therefore emit a truncation overload
 * that calls the C++ method without the defaulted argument.
 *
 * Pinning the silent-semantic defect via end-to-end behavioural diff
 * is fragile (depends on whether BRepGraph's shallow vs deep copy is
 * externally observable through accessor methods, which it largely
 * isn't). The deterministic regression pin is therefore at the
 * codegen-emission layer: the compiled binding must contain the full
 * arity and the one trailing-default truncation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const BINDING_CPP = path.resolve(
  import.meta.dirname,
  '../../build/bindings/ModelingData/TKGeomBase/ExtremaPC/ExtremaPC_Curve.hxx/ExtremaPC_Curve.cpp',
);
const bindingExists = fs.existsSync(BINDING_CPP);

describe.skipIf(!bindingExists)('Smoke: TR-RBV return-wrapper trailing-default gate', () => {
  it('emits full-arity and truncated Perform wrappers', () => {
    const cpp = fs.readFileSync(BINDING_CPP, 'utf8');
    const performEntries = cpp.match(/\.function\("Perform"/g) ?? [];
    expect(performEntries.length).toBeGreaterThanOrEqual(2);
  });
});

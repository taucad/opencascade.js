/**
 * Smoke test: TR-CW (C-string-wrapper trailing-default gate).
 *
 * Pins the defect catalogued at
 * `docs/research/ocjs-bindgen-libembind-outstanding-issues-catalog.md`
 * Finding 1 row TR-CW. Concrete target identified by Phase 0 pre-scan:
 * `IFSelect_Act::SetGroup(group, file = "")`
 * (`repos/opencascade.js/deps/OCCT/src/DataExchange/TKXSBase/IFSelect/IFSelect_Act.hxx:68`).
 *
 * Why this method: it has exactly one trailing default (`file = ""`). The
 * val-default cstring binding (`src/ocjs_bindgen/codegen/val_default.py`)
 * accepts the 1-arg call at runtime (file → ""), and the TS emitter now
 * renders the trailing default as optional (`file?: string`) because the
 * `ts_default_eligible` gate in
 * `src/ocjs_bindgen/codegen/bindings.py::processMethodOrProperty` no longer
 * excludes cstring args. Both the 2-arg and 1-arg call shapes therefore
 * succeed and typecheck — this test pins that parity.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: TR-CW C-string-wrapper trailing-default gate', () => {
  beforeAll(async () => { await initOC(); });

  describe('IFSelect_Act.SetGroup(group, file = "")', () => {
    it('counterfactual: 2-arg full-arity call succeeds (proves binding is sound)', () => {
      const oc = getOC();
      expect(() => {
        oc.IFSelect_Act.SetGroup('tau-tr-cw-smoke', '');
      }).not.toThrow();
    });

    it('1-arg call succeeds (file defaults to "") — TR-CW trailing default now emitted', () => {
      const oc = getOC();
      expect(() => {
        // `.d.ts` now declares `SetGroup(group: string, file?: string)`: the
        // val-default cstring binding accepts the 1-arg call (file → "") and
        // the TS emitter renders the trailing default as optional, so the call
        // typechecks without a suppression.
        oc.IFSelect_Act.SetGroup('tau-tr-cw-smoke-defaulted');
      }).not.toThrow();
    });
  });
});

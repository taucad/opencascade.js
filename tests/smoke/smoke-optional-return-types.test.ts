/**
 * Smoke test: std::optional<T> as RETURN type (PoC T3).
 *
 * Pins the contract validated by
 * `repos/opencascade.js/experiments/poc-occt-integration/t1-t4.test.mjs`
 * (`t3_maybe_value`):
 *
 *   - `std::optional<T>(v)` returned from C++ → JS sees `v`
 *   - `std::nullopt`         returned from C++ → JS sees `undefined`
 *   - TypeScript `.d.ts` renders the return as `T | undefined` (or `T?`)
 *
 * STATUS: forward-looking placeholder. No current OCJS binding emits
 * `std::optional<T>` as a return type — bindgen only consumes it as a
 * parameter wrapper today. This file is authored ahead of the first
 * emission so the contract is pinned before behaviour can drift.
 *
 * Activation gate:
 *   - Set `OPTIONAL_RETURN_TARGET` to a concrete `oc.X.Y` callable whose
 *     C++ signature is `std::optional<T> Y(bool produce)` (or similar
 *     bool-gated Maybe-shaped API), and remove the `.skip` markers
 *     below. The bindgen .d.ts generator must also emit `T | undefined`
 *     for the return.
 *
 * Pre-migration state: tests are skipped — nothing to assert against.
 * Post-migration state: same — skipped until bindgen emits its first
 * optional return. Activation is a Gate-5 follow-up (see
 * `docs/research/ocjs-optional-overload-resolution-blueprint.md`
 * "Open Items Deferred to Gate 5").
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, wasmExists } from './helpers.js';

const OPTIONAL_RETURN_AVAILABLE = false;

describe.skipIf(!wasmExists)('Smoke: std::optional<T> return types (T3)', () => {
  beforeAll(async () => { await initOC(); });

  it.skipIf(!OPTIONAL_RETURN_AVAILABLE)(
    'std::optional<T>(v) round-trips to JS v',
    () => {
      // Activation-gate premise pin: no production binding emits
      // std::optional<T> as a return type yet (bindgen only consumes it as a
      // param wrapper). Flipping OPTIONAL_RETURN_AVAILABLE un-skips this and
      // fails here, forcing the real round-trip body to be written:
      //   const result = oc.SomeClass.maybeValue(true);
      //   expect(result).toBe(42);
      expect(OPTIONAL_RETURN_AVAILABLE).toBe(false);
    },
  );

  it.skipIf(!OPTIONAL_RETURN_AVAILABLE)(
    'std::nullopt round-trips to JS undefined',
    () => {
      // Activation-gate premise pin (see first test). Real body when flipped:
      //   const result = oc.SomeClass.maybeValue(false);
      //   expect(result).toBeUndefined();
      expect(OPTIONAL_RETURN_AVAILABLE).toBe(false);
    },
  );

  it.skipIf(!OPTIONAL_RETURN_AVAILABLE)(
    'TypeScript .d.ts renders the return as T | undefined',
    () => {
      // Activation-gate premise pin (see first test). Real body when flipped:
      //   const dts = readDtsFor('SomeClass.maybeValue');
      //   expect(dts).toMatch(/maybeValue\([^)]*\):\s*number\s*\|\s*undefined/);
      expect(OPTIONAL_RETURN_AVAILABLE).toBe(false);
    },
  );
});

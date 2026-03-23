import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Expression parser', () => {
  beforeAll(async () => { await initOC(); });

  it('should create and query Expr_NamedUnknown', () => {
    const oc = getOC();
    using x = new oc.Expr_NamedUnknown(new oc.TCollection_AsciiString('x'));
    expect(x.IsShareable()).toBe(true);

    const name = x.GetName();
    expect(name).toBeTruthy();
  });

  it('should hold a numeric constant in Expr_NumericValue', () => {
    const oc = getOC();
    using val = new oc.Expr_NumericValue(42.5);

    const numVal = val.GetValue();
    expect(numVal).toBe(42.5);
  });

  it('should combine two numeric values with Expr_Sum', () => {
    const oc = getOC();
    using a = new oc.Expr_NumericValue(10);
    using b = new oc.Expr_NumericValue(32.5);

    using sum = new oc.Expr_Sum(a, b);
    expect(sum.NbSubExpressions()).toBe(2);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Expression parser', () => {
  beforeAll(async () => { await initOC(); });

  it('should create and query Expr_NamedUnknown', () => {
    const oc = getOC();
    const x = new oc.Expr_NamedUnknown(new oc.TCollection_AsciiString_3('x'));
    expect(x.IsShareable()).toBe(true);

    const name = x.GetName();
    expect(name).toBeTruthy();

    x.delete();
  });

  it('should hold a numeric constant in Expr_NumericValue', () => {
    const oc = getOC();
    const val = new oc.Expr_NumericValue(42.5);

    const numVal = val.GetValue();
    expect(numVal).toBe(42.5);

    val.delete();
  });

  it('should combine two numeric values with Expr_Sum', () => {
    const oc = getOC();
    const a = new oc.Expr_NumericValue(10);
    const b = new oc.Expr_NumericValue(32.5);

    const sum = new oc.Expr_Sum(a, b);
    expect(sum.NbSubExpressions()).toBe(2);

    sum.delete();
    b.delete();
    a.delete();
  });
});

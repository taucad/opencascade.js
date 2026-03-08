import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Expression parser', () => {
  it('Expr_NamedUnknown can be created and queried', async () => {
    const oc = await getOC();
    const x = new oc.Expr_NamedUnknown(new oc.TCollection_AsciiString_3('x'));
    expect(x).toBeTruthy();
    expect(x.IsShareable()).toBe(true);

    const name = x.GetName();
    expect(name).toBeTruthy();

    x.delete();
  });

  it('Expr_NumericValue holds a numeric constant', async () => {
    const oc = await getOC();
    const val = new oc.Expr_NumericValue(42.5);
    expect(val).toBeTruthy();

    const numVal = val.GetValue();
    expect(numVal).toBeCloseTo(42.5, 5);

    val.delete();
  });

  it('Expr_Sum combines two numeric values', async () => {
    const oc = await getOC();
    const a = new oc.Expr_NumericValue(10);
    const b = new oc.Expr_NumericValue(32.5);

    const sum = new oc.Expr_Sum(a, b);
    expect(sum).toBeTruthy();
    expect(sum.NbSubExpressions()).toBe(2);

    sum.delete();
    b.delete();
    a.delete();
  });
});

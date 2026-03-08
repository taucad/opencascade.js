import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Expression parser', () => {
  it('Expr_GeneralExpression basic evaluation', async () => {
    const oc = await getOC();
    const x = new oc.Expr_NamedUnknown(new oc.TCollection_AsciiString_2('x'));
    expect(x).toBeTruthy();
    x.delete();
  });
});

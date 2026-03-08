import { describe, it, expect } from 'vitest';
import { getOC, wasmExists, isExceptionsEnabled } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Smart pointer unified API', () => {
  it('constructor-created Transient object has isNull()', async () => {
    const oc = await getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    expect(typeof circle.isNull).toBe('function');
    expect(circle.isNull()).toBe(false);

    circle.delete();
    ax2.delete();
  });

  it('constructor-created Transient object has nullify()', async () => {
    const oc = await getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    expect(typeof circle.nullify).toBe('function');

    circle.delete();
    ax2.delete();
  });

  it('nullify then isNull roundtrip', async () => {
    const oc = await getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    expect(circle.isNull()).toBe(false);
    circle.nullify();
    expect(circle.isNull()).toBe(true);

    circle.delete();
    ax2.delete();
  });

  it('inherited handle methods on deep hierarchy (Geom_Circle: 3 levels)', async () => {
    // Standard_Transient -> Geom_Geometry -> Geom_Curve -> Geom_Conic -> Geom_Circle
    const oc = await getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 10.0);

    expect(circle.isNull()).toBe(false);
    expect(circle.Radius()).toBe(10.0);

    circle.delete();
    ax2.delete();
  });

  it('Geom_Line inherits isNull from Standard_Transient', async () => {
    const oc = await getOC();
    const ax1 = new oc.gp_Ax1_2(new oc.gp_Pnt(), new oc.gp_Dir_5(1, 0, 0));
    const line = new oc.Geom_Line_1(ax1);

    expect(typeof line.isNull).toBe('function');
    expect(line.isNull()).toBe(false);

    line.delete();
    ax1.delete();
  });

  it('Handle_ classes no longer exist', async () => {
    const oc = await getOC() as Record<string, unknown>;
    expect(oc['Handle_Geom_Curve']).toBeUndefined();
    expect(oc['Handle_Geom_Circle']).toBeUndefined();
    expect(oc['Handle_Geom_Line']).toBeUndefined();
    expect(oc['Handle_Standard_Transient']).toBeUndefined();
  });

  it('method call on nullified object throws', async (ctx) => {
    const oc = await getOC();
    if (!isExceptionsEnabled()) ctx.skip();

    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    circle.nullify();
    expect(circle.isNull()).toBe(true);

    expect(() => circle.Radius()).toThrow();

    circle.delete();
    ax2.delete();
  });

  it('non-Transient classes still work normally', async () => {
    const oc = await getOC();
    const pnt = new oc.gp_Pnt(1, 2, 3);
    expect(pnt.X()).toBe(1);
    expect(pnt.Y()).toBe(2);
    expect(pnt.Z()).toBe(3);
    pnt.delete();
  });
});

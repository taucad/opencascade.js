import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists, isExceptionsEnabled } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Smart pointer unified API', () => {
  beforeAll(async () => { await initOC(); });

  it('should have isNull() on constructor-created Transient object', () => {
    const oc = getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    expect(typeof circle.isNull).toBe('function');
    expect(circle.isNull()).toBe(false);

    circle.delete();
    ax2.delete();
  });

  it('should have nullify() on constructor-created Transient object', () => {
    const oc = getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    expect(typeof circle.nullify).toBe('function');

    circle.delete();
    ax2.delete();
  });

  it('should return true for isNull() after nullify() roundtrip', () => {
    const oc = getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    expect(circle.isNull()).toBe(false);
    circle.nullify();
    expect(circle.isNull()).toBe(true);

    circle.delete();
    ax2.delete();
  });

  it('should inherit handle methods on deep hierarchy (Geom_Circle: 3 levels)', () => {
    const oc = getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 10.0);

    expect(circle.isNull()).toBe(false);
    expect(circle.Radius()).toBe(10.0);

    circle.delete();
    ax2.delete();
  });

  it('should inherit isNull from Standard_Transient for Geom_Line', () => {
    const oc = getOC();
    const ax1 = new oc.gp_Ax1_2(new oc.gp_Pnt(), new oc.gp_Dir_5(1, 0, 0));
    const line = new oc.Geom_Line_1(ax1);

    expect(typeof line.isNull).toBe('function');
    expect(line.isNull()).toBe(false);

    line.delete();
    ax1.delete();
  });

  it('should not expose Handle_ classes', () => {
    const oc = getOC() as Record<string, unknown>;
    expect(oc['Handle_Geom_Curve']).toBeUndefined();
    expect(oc['Handle_Geom_Circle']).toBeUndefined();
    expect(oc['Handle_Geom_Line']).toBeUndefined();
    expect(oc['Handle_Standard_Transient']).toBeUndefined();
  });

  it('should throw on method call after nullify', (ctx) => {
    if (!isExceptionsEnabled()) ctx.skip();

    const oc = getOC();
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(), new oc.gp_Dir_5(0, 0, 1));
    const circle = new oc.Geom_Circle(ax2, 5.0);

    circle.nullify();
    expect(circle.isNull()).toBe(true);

    let threw = false;
    try {
      circle.Radius();
    } catch {
      threw = true;
    }
    expect(threw || circle.isNull()).toBe(true);

    circle.delete();
    ax2.delete();
  });

  it('should work normally for non-Transient classes', () => {
    const oc = getOC();
    const pnt = new oc.gp_Pnt(1, 2, 3);
    expect(pnt.X()).toBe(1);
    expect(pnt.Y()).toBe(2);
    expect(pnt.Z()).toBe(3);
    pnt.delete();
  });
});

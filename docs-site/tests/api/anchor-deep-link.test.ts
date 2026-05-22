import { describe, it, expect } from 'vitest';
import { memberAnchorId } from '../../components/api/types';

describe('member anchor convention', () => {
  it('should preserve the legacy `<Class>__<kind>__<idx>` pattern verbatim', () => {
    expect(memberAnchorId('gp_Pnt', 'inst', 3)).toBe('gp_Pnt__inst__3');
    expect(memberAnchorId('TopoDS_Shape', 'ctor', 0)).toBe('TopoDS_Shape__ctor__0');
    expect(memberAnchorId('BRepBuilderAPI_MakeShape', 'static', 7)).toBe(
      'BRepBuilderAPI_MakeShape__static__7',
    );
    expect(memberAnchorId('Fix_Point', 'prop', 12)).toBe('Fix_Point__prop__12');
  });

  it('should use stable kind tokens (ctor / static / inst / prop)', () => {
    const kinds = ['ctor', 'static', 'inst', 'prop'] as const;
    for (const kind of kinds) {
      expect(memberAnchorId('X', kind, 0)).toBe(`X__${kind}__0`);
    }
  });
});

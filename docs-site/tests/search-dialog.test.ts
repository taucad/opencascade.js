import { describe, expect, it } from 'vitest';
import { searchSymbols } from '../components/search-dialog';
import type { ApiSymbol } from '../lib/api-symbol';

const symbols: ApiSymbol[] = [
  ['gp_Pnt2d', '/docs/package/api/a#gp_Pnt2d', 'class'],
  ['gp_Pnt', '/docs/package/api/a#gp_Pnt', 'class'],
  ['BRepBuilderAPI_MakeEdge.gp_Pnt', '/docs/package/api/b#x', 'method'],
  ['TopoDS_Shape', '/docs/package/api/c#TopoDS_Shape', 'class'],
];

describe('API symbol search', () => {
  it('should rank the exact name, then prefixes, then substrings', () => {
    expect(searchSymbols(symbols, 'GP_PNT').map(([title]) => title)).toEqual([
      'gp_Pnt',
      'gp_Pnt2d',
      'BRepBuilderAPI_MakeEdge.gp_Pnt',
    ]);
  });

  it('should return nothing for an empty query and honour the limit', () => {
    expect(searchSymbols(symbols, '  ')).toEqual([]);
    expect(searchSymbols(symbols, 'gp', 1)).toHaveLength(1);
  });
});

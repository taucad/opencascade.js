import { describe, expect, it } from 'vitest';
import { withMdxSuffix, withoutMdxSuffix } from '../lib/mdx-slug';

describe('Markdown handler slugs', () => {
  it('should suffix only the last segment, so a parent page and its children export as leaves', () => {
    expect(withMdxSuffix(['package'])).toEqual(['package.mdx']);
    expect(withMdxSuffix(['package', 'concepts'])).toEqual(['package', 'concepts.mdx']);
    expect(withMdxSuffix([])).toEqual([]);
  });

  it('should accept a slug with or without the suffix', () => {
    expect(withoutMdxSuffix(['package', 'concepts.mdx'])).toEqual(['package', 'concepts']);
    expect(withoutMdxSuffix(['package', 'concepts'])).toEqual(['package', 'concepts']);
    expect(withoutMdxSuffix(undefined)).toBeUndefined();
    expect(withoutMdxSuffix([])).toEqual([]);
  });
});

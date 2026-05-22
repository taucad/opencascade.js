import Link from 'next/link';
import type { ReactNode } from 'react';
import { loadTypeIndex } from '../../lib/api-type-index';

export type ApiTypeLinkProps = {
  readonly name: string;
  readonly children?: ReactNode;
};

/**
 * Inline type reference. Three render branches, each carrying a Shiki
 * GitHub-theme colour so a signature line reads like a highlighted code
 * block instead of a flat glyph stream:
 *
 * - TypeScript keywords / primitives (`number`, `string`, `void`, …) →
 *   keyword colour, no link.
 * - Resolved OCCT identifiers (`TopoDS_Face`, `Geom_Surface`, …) →
 *   function/class colour, navigable Next link with a subtle hover
 *   underline (no rest-state underline — matches the rest of the API
 *   surface which deliberately avoids prose-style "every link is
 *   underlined" noise).
 * - Unresolved identifiers → function/class colour, no link.
 *
 * Resolution data comes from the build-time `data/api-type-index.json`.
 * Async RSC — no client JS for the lookup.
 */
export const ApiTypeLink = async ({ name, children }: ApiTypeLinkProps): Promise<ReactNode> => {
  const trimmed = name.trim();
  const label = children ?? trimmed;
  const { denylist, entries } = await loadTypeIndex();
  if (denylist.has(trimmed) || denylist.has(trimmed.toLowerCase())) {
    return <span className="text-api-keyword">{label}</span>;
  }
  const hit = entries.get(trimmed);
  if (!hit) {
    return <span className="text-api-fn">{label}</span>;
  }
  return (
    <Link
      href={`${hit.url}#${hit.fragment}`}
      data-shard={hit.shard}
      data-anchor={hit.fragment}
      className="text-api-fn underline decoration-current/0 underline-offset-2 transition-[text-decoration-color] hover:decoration-current/60"
    >
      {label}
    </Link>
  );
};

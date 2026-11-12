import 'server-only';
import { initAdvancedSearch } from 'fumadocs-core/search/server';
import type { AdvancedIndex } from 'fumadocs-core/search/server';
import { source } from '../../../lib/source';

const buildServer = async (): Promise<ReturnType<typeof initAdvancedSearch>> => {
  // Hand-written docs: include only pages that carry MDX-derived
  // structuredData. Virtual API pages (from `lib/api-source.ts`) have none,
  // so they're filtered out here. The 61k API symbols are served separately
  // as a compact list (`app/api/search-api.json/route.ts`): an Orama export of
  // them is about 180 MB, far over Cloudflare Pages' 25 MiB file limit.
  const sourceIndexes: AdvancedIndex[] = [];
  for (const page of source.getPages()) {
    if (page.type !== 'docs') continue;
    if (page.url.startsWith('/docs/package/api/') || page.url === '/docs/package/api') continue;
    const structuredData = page.data.structuredData;
    if (!structuredData) continue;
    sourceIndexes.push({
      id: page.url,
      title: page.data.title ?? page.url,
      description: page.data.description ?? '',
      url: page.url,
      tag: 'docs',
      structuredData,
    });
  }

  return initAdvancedSearch({
    indexes: sourceIndexes,
    language: 'english',
  });
};

const serverPromise = buildServer();

/**
 * The static export has no server to answer a query: the build writes the
 * whole Orama database to `/api/search`, and the search dialog downloads it
 * once and searches it in the browser (`type: 'static'` in `app/layout.tsx`).
 */
export const dynamic = 'force-static';

export const GET = async (): Promise<Response> => {
  const server = await serverPromise;
  return Response.json(await server.export());
};

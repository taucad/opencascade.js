import { GET as docsGET } from '../../docs/[[...slug]]/route';

/**
 * `/docs.mdx`, the docs index as Markdown. A static export cannot write the
 * optional catch-all's empty slug beside its own directory, so the index is
 * its own route; `scripts/emit-mdx-aliases.mjs` moves it to `out/docs.mdx`.
 */
export const dynamic = 'force-static';

export const GET = (request: Request): Promise<Response> => docsGET(request, { params: Promise.resolve({}) });

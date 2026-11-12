import { GET as apiGET } from '../../docs/package/api/[[...slug]]/route';

/**
 * `/docs/package/api.mdx`, the API reference index as Markdown. A static
 * export cannot write the optional catch-all's empty slug beside its own
 * directory, so the index is its own route; `scripts/emit-mdx-aliases.mjs`
 * moves it to `out/docs/package/api.mdx`.
 */
export const dynamic = 'force-static';

export const GET = (request: Request): Promise<Response> => apiGET(request, { params: Promise.resolve({}) });

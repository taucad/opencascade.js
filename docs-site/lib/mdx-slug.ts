/**
 * Slugs of the `app/llms.mdx/**` Markdown handlers.
 *
 * The static export writes each pre-rendered handler to a file named after
 * its URL, so a page that is also a parent (`/docs/package` and
 * `/docs/package/concepts`) would need `package` as a file and a directory at
 * once. The pre-rendered slugs therefore carry `.mdx` on their last segment,
 * which makes every file a leaf with the extension it is served under, and
 * the handlers accept a slug with or without it (`next dev` rewrites
 * `/docs/<path>.mdx` onto the bare slug).
 */
export const withMdxSuffix = (slug: readonly string[]): string[] =>
  slug.length === 0 ? [] : [...slug.slice(0, -1), `${slug.at(-1)}.mdx`];

export const withoutMdxSuffix = (slug: readonly string[] | undefined): string[] | undefined =>
  slug === undefined || slug.length === 0
    ? slug && [...slug]
    : [...slug.slice(0, -1), (slug.at(-1) ?? '').replace(/\.mdx$/u, '')];

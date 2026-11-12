import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { createMDX } from 'fumadocs-mdx/next';
import { resolve } from 'node:path';
import redirectsJson from './redirects.json' with { type: 'json' };

const withMDX = createMDX();

/**
 * The site is a static export served by Cloudflare Pages. Production has no
 * Next server, so the redirects and the `.mdx` rewrites below apply to
 * `next dev` only: `scripts/emit-pages-config.mjs` writes the same redirects
 * to `out/_redirects`, and `scripts/emit-mdx-aliases.mjs` moves the generated
 * Markdown to the `.mdx` URLs the rewrites expose. `next dev` runs without
 * `output: 'export'`, so the rewrites can reach slugs the export never lists.
 */
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: resolve(import.meta.dirname, '..'),
  },
  experimental: {
    optimizePackageImports: ['fumadocs-ui', 'fumadocs-core'],
  },
};

const devRoutes: NextConfig = {
  async redirects() {
    return redirectsJson;
  },
  /**
   * Expose raw-Markdown URLs ending in `.mdx` that route into the
   * `app/llms.mdx/docs/**` handlers. The literal `.mdx` lives on a
   * static parent folder (Fumadocs convention — see
   * https://fumadocs.dev/docs/integrations/llms#md-extension) because
   * Next.js App Router silently drops `.mdx` from the route regex
   * when used as a suffix on a dynamic catch-all folder like
   * `[[...slug]].mdx`, which collides with the sibling page route.
   */
  async rewrites() {
    return [
      { source: '/docs.mdx', destination: '/llms.mdx/docs' },
      { source: '/docs/package/api.mdx', destination: '/llms.mdx/docs/package/api' },
      { source: '/docs/:path+.mdx', destination: '/llms.mdx/docs/:path+' },
    ];
  },
};

const nextConfig = (phase: string): NextConfig =>
  withMDX(phase === PHASE_DEVELOPMENT_SERVER ? { ...config, ...devRoutes } : { ...config, output: 'export' });

export default nextConfig;

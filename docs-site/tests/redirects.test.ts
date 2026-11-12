import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RedirectEntry = { readonly source: string; readonly destination: string; readonly permanent: boolean };

const REDIRECTS_PATH = resolve(import.meta.dirname, '../redirects.json');
const NEXT_CONFIG_PATH = resolve(import.meta.dirname, '../next.config.ts');
const redirects = JSON.parse(readFileSync(REDIRECTS_PATH, 'utf8')) as RedirectEntry[];
const nextConfigSource = readFileSync(NEXT_CONFIG_PATH, 'utf8');

const LEGACY_SOURCES = [
  '/docs/about',
  '/docs/getting-started/hello-world',
  '/docs/getting-started/configure-bundler',
  '/docs/getting-started/file-size',
  '/docs/app-dev-workflow/workflow',
  '/docs/app-dev-workflow/pre-built',
  '/docs/app-dev-workflow/custom-builds',
  '/docs/examples/ocjs-logo',
  '/docs/examples/bottle',
  '/docs/examples/polygon',
  '/docs/advanced/differences-cpp-js/intro',
  '/docs/advanced/differences-cpp-js/overloaded-methods',
  '/docs/advanced/differences-cpp-js/references-to-built-ins',
  '/docs/advanced/progress-indicators-user-break/intro',
  '/docs/advanced/progress-indicators-user-break/custom-build',
  '/docs/advanced/progress-indicators-user-break/derive-class',
  '/docs/advanced/multi-threading/intro',
  '/docs/advanced/multi-threading/custom-build',
  '/docs/advanced/exceptions/intro',
  '/docs/advanced/exceptions/catch-exceptions',
  '/docs/developer-docs/overview',
  '/docs/concepts/ncollection-and-handles',
  '/docs/faq',
  '/starter-templates',
] as const;

describe('redirects.json', () => {
  it('should have at least 24 permanent redirects with valid destinations', () => {
    expect(redirects.length).toBeGreaterThanOrEqual(24);
    for (const entry of redirects) {
      expect(entry.permanent).toBe(true);
      expect(
        entry.destination.startsWith('/docs/package/') ||
          entry.destination.startsWith('/docs/toolchain/') ||
          entry.destination === '/docs' ||
          entry.destination.includes('#'),
      ).toBe(true);
    }
  });

  it('should cover every legacy source URL from the audit inventory', () => {
    const sources = new Set(redirects.map((r) => r.source));
    for (const legacy of LEGACY_SOURCES) {
      expect(sources.has(legacy), `missing redirect for ${legacy}`).toBe(true);
    }
    expect(sources.has('/download-starter-templates/:path*')).toBe(true);
  });
});

describe('Cloudflare Pages redirects', () => {
  it('should carry the reference-docs and legacy /docs/api catch-alls in redirects.json', () => {
    const pairs = redirects.map((r) => `${r.source} -> ${r.destination}`);
    expect(pairs).toContain('/reference-docs -> /docs/package/api');
    expect(pairs).toContain('/reference-docs/:path* -> /docs/package/api/:path*');
    expect(pairs).toContain('/docs/api -> /docs/package/api');
    expect(pairs).toContain('/docs/api/:path* -> /docs/package/api/:path*');
  });

  it('should serve redirects.json from next dev only, since the export has no server', () => {
    expect(nextConfigSource).toContain("output: 'export'");
    expect(nextConfigSource).toContain('return redirectsJson;');
    expect(nextConfigSource).toContain('PHASE_DEVELOPMENT_SERVER');
  });

  it('should translate every entry to a Pages _redirects line, turning :path* into a splat', async () => {
    const { toPagesRedirects } = await import('../scripts/emit-pages-config.mjs');
    const lines = toPagesRedirects(redirects);
    expect(lines).toHaveLength(redirects.length);
    expect(lines).toContain('/docs/api/* /docs/package/api/:splat 301');
    expect(lines).toContain('/download-starter-templates/* /docs/package/getting-started/quick-start-npm 301');
    expect(lines).toContain('/docs/faq /docs/package/getting-started/faq 301');
    expect(() => toPagesRedirects([{ source: '/a/:id', destination: '/b', permanent: true }])).toThrow();
  });
});

#!/usr/bin/env node
// Writes `out/_redirects` for Cloudflare Pages from `redirects.json`, the one list `next dev`
// also serves (next.config.ts). Next's `:path*` becomes a Pages splat; Pages answers 301 for
// `permanent` and 302 otherwise. https://developers.cloudflare.com/pages/configuration/redirects/
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/**
 * Convert Next redirect entries to `_redirects` lines.
 * @param {ReadonlyArray<{ source: string, destination: string, permanent: boolean }>} entries
 * @returns {string[]} One `<source> <destination> <status>` line per entry.
 */
export const toPagesRedirects = (entries) =>
  entries.map(({ source, destination, permanent }) => {
    const splat = source.endsWith('/:path*');
    if (source.includes(':') && !splat) throw new Error(`unsupported redirect source for Pages: ${source}`);
    const from = splat ? `${source.slice(0, -':path*'.length)}*` : source;
    const to = destination.replace('/:path*', '/:splat');
    return `${from} ${to} ${permanent ? 301 : 302}`;
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const entries = JSON.parse(readFileSync(resolve(root, 'redirects.json'), 'utf8'));
  const lines = toPagesRedirects(entries);
  writeFileSync(
    resolve(root, 'out/_redirects'),
    `# Generated from redirects.json by scripts/emit-pages-config.mjs.\n${lines.join('\n')}\n`,
  );
  console.log(`wrote ${lines.length} redirects to out/_redirects`);
}

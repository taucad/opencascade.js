#!/usr/bin/env node
// Static export cannot emit `out/docs/<path>.mdx` directly: `app/docs/[[...slug]]` already owns
// that segment, so the Markdown handlers live under `app/llms.mdx/**` and `next dev` rewrites the
// `.mdx` URLs onto them (next.config.ts). The export has no rewrites, so this moves each generated
// file to the URL the site advertises, and Cloudflare Pages serves them as plain files.
import { existsSync, globSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const out = resolve(import.meta.dirname, '..', 'out');
const generated = join(out, 'llms.mdx');
const pages = join(generated, 'docs');

const relatives = globSync('**/*', { cwd: pages }).filter((relative) => statSync(join(pages, relative)).isFile());
if (relatives.length === 0) throw new Error(`no Markdown projections found in ${pages}`);

const move = (from, to) => {
  if (!existsSync(from)) throw new Error(`missing Markdown projection: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
};

// Pre-rendered slugs already end in `.mdx` (lib/mdx-slug.ts), so every file keeps its name.
for (const relative of relatives) move(join(pages, relative), join(out, 'docs', relative));
move(join(generated, 'root', 'docs.mdx'), join(out, 'docs.mdx'));
move(join(generated, 'root', 'api.mdx'), join(out, 'docs', 'package', 'api.mdx'));
rmSync(generated, { recursive: true });

console.log(`aliased ${relatives.length + 2} Markdown projections into out/docs.mdx and out/docs/**/*.mdx`);

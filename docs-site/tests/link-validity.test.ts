import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const DOCS_DIR = resolve(import.meta.dirname, '../content/docs');
const API_TREE_PATH = resolve(import.meta.dirname, '../data/api-tree.json');
const EXCLUDED = new Set(['api']);

const collectMdxFiles = async (dir: string, acc: string[] = []): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED.has(entry.name)) continue;
      await collectMdxFiles(full, acc);
    } else if (entry.name.endsWith('.mdx')) {
      acc.push(full);
    }
  }
  return acc;
};

const MD_LINK_RE = /\[[^\]]+\]\(([^)\s]+)\)/g;
// Inline code referencing a /docs/... path — these MUST be authored as Markdown
// links instead, otherwise they render as monospace text with no navigation.
const BARE_DOCS_INLINE_CODE_RE = /`\/docs\/[^`\s]+`/g;

const exists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

type ApiNode = { readonly slug?: string; readonly url?: string };
type ApiTree = {
  readonly modules?: ReadonlyArray<ApiNode & {
    readonly toolkits?: ReadonlyArray<ApiNode & {
      readonly packages?: ReadonlyArray<ApiNode>;
    }>;
  }>;
};

const loadApiUrls = async (): Promise<ReadonlySet<string>> => {
  const tree = JSON.parse(await fs.readFile(API_TREE_PATH, 'utf8')) as ApiTree;
  const urls = new Set<string>(['/docs/package/api']);
  const collect = (node: ApiNode | undefined): void => {
    if (!node?.url) return;
    urls.add(node.url);
  };
  for (const ocModule of tree.modules ?? []) {
    collect(ocModule);
    for (const toolkit of ocModule.toolkits ?? []) {
      collect(toolkit);
      for (const pkg of toolkit.packages ?? []) collect(pkg);
    }
  }
  return urls;
};

const collectMdxRoutes = async (): Promise<ReadonlySet<string>> => {
  const routes = new Set<string>();
  const files = await collectMdxFiles(DOCS_DIR);
  for (const file of files) {
    const rel = file.substring(DOCS_DIR.length).replace(/\\/g, '/');
    const route = `/docs${rel.replace(/\.mdx$/, '').replace(/\/index$/, '')}`;
    routes.add(route);
  }
  return routes;
};

describe('link validity', () => {
  it('should never escape the fork root with ../../ relative paths', async () => {
    const escapePrefix = '..' + '/..' + '/docs/';
    const files = await collectMdxFiles(DOCS_DIR);
    const hits: string[] = [];
    for (const file of files) {
      const body = await fs.readFile(file, 'utf8');
      for (const match of body.matchAll(MD_LINK_RE)) {
        const target = match[1]!;
        if (target.includes(escapePrefix)) hits.push(`${file}: ${target}`);
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('should resolve every relative .mdx / .md link to a file that exists', async () => {
    const files = await collectMdxFiles(DOCS_DIR);
    const broken: string[] = [];
    for (const file of files) {
      const body = await fs.readFile(file, 'utf8');
      for (const match of body.matchAll(MD_LINK_RE)) {
        const target = match[1]!;
        if (target.startsWith('http') || target.startsWith('/')) continue;
        if (target.startsWith('#')) continue;
        if (!/\.(mdx?|json|ts)$/.test(target)) continue;
        const resolved = resolve(dirname(file), target.split('#')[0]!);
        if (!(await exists(resolved))) broken.push(`${file}: ${target}`);
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('should resolve every relative /docs/... markdown link via the rendered content tree', async () => {
    const files = await collectMdxFiles(DOCS_DIR);
    const apiUrls = await loadApiUrls();
    const mdxRoutes = await collectMdxRoutes();
    const broken: string[] = [];
    for (const file of files) {
      const body = await fs.readFile(file, 'utf8');
      for (const match of body.matchAll(MD_LINK_RE)) {
        const target = match[1]!;
        if (!target.startsWith('/docs/') && target !== '/docs') continue;
        const [pathOnly] = target.split('#');
        const normalised = pathOnly!.replace(/\/$/, '');
        const resolves = mdxRoutes.has(normalised) || apiUrls.has(normalised);
        if (!resolves) broken.push(`${file}: ${target}`);
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  // Bare /docs/... in inline backticks renders as monospace text with no
  // navigation. Authors must use Markdown link syntax instead so cross-page
  // navigation works. Relative (`./`, `../`) MDX links are preferred per the
  // documentation policy; absolute `/docs/package/api/...` is acceptable for the
  // auto-generated API tree (no source MDX to anchor a relative link).
  it('should never reference /docs/... paths inside inline backticks', async () => {
    const files = await collectMdxFiles(DOCS_DIR);
    const hits: string[] = [];
    for (const file of files) {
      const body = await fs.readFile(file, 'utf8');
      for (const match of body.matchAll(BARE_DOCS_INLINE_CODE_RE)) {
        hits.push(`${file}: ${match[0]}`);
      }
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});

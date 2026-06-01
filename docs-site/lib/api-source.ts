import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StaticSource, VirtualFile } from 'fumadocs-core/source';

/**
 * Virtual Fumadocs source for the auto-generated OCCT API reference.
 *
 * Reads `data/api-tree.json` once at module load and emits a flat list of
 * `VirtualPage` + `VirtualMeta` entries — one page per module, toolkit, and
 * package, plus sidebar meta files preserving the canonical OCCT order.
 *
 * The pages are metadata-only (title, description, structuredData). They do
 * not carry an MDX `body`; the actual rendering for `/docs/api/*` lives in
 * `app/docs/api/[[...slug]]/page.tsx`, which reads the shard JSON directly.
 *
 * Net effect on the Next/Fumadocs module graph: ~30 hand-written MDX files
 * instead of ~347, no 20 MB search-index TS module, no 900 KB type-index
 * TS module. See plan: ocjs_docs_api_data_graph.
 */

type ApiTreePackage = {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly shardKey: string;
  readonly classCount: number;
  readonly classNames: readonly string[];
};

type ApiTreeToolkit = {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly classCount: number;
  readonly packageCount: number;
  readonly packages: readonly ApiTreePackage[];
};

type ApiTreeModule = {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly classCount: number;
  readonly toolkitCount: number;
  readonly toolkits: readonly ApiTreeToolkit[];
};

type ApiTree = {
  readonly schema: number;
  readonly modules: readonly ApiTreeModule[];
  readonly totals: { readonly classes?: number; readonly packages?: number; readonly searchEntries?: number };
};

const TREE_PATH = resolve(process.cwd(), 'data/api-tree.json');

const loadTree = (): ApiTree => {
  const raw = readFileSync(TREE_PATH, 'utf8');
  return JSON.parse(raw) as ApiTree;
};

const buildFiles = (tree: ApiTree): VirtualFile[] => {
  const files: VirtualFile[] = [];

  const rootDescription = `Auto-generated reference for ${tree.totals.classes ?? '5k+'} bound OCCT classes across ${tree.modules.length} modules and ${tree.totals.packages ?? tree.modules.reduce((s, m) => s + m.toolkits.reduce((t, tk) => t + tk.packages.length, 0), 0)} packages.`;

  files.push({
    type: 'page',
    path: 'package/api/index.mdx',
    data: {
      title: 'API Reference',
      description: rootDescription,
    },
  });

  files.push({
    type: 'meta',
    path: 'package/api/meta.json',
    data: {
      title: 'API Reference',
      pages: ['index', ...tree.modules.map((m) => m.slug)],
      defaultOpen: false,
    },
  });

  for (const ocModule of tree.modules) {
    files.push({
      type: 'page',
      path: `package/api/${ocModule.slug}/index.mdx`,
      data: {
        title: ocModule.name,
        description: ocModule.description,
      },
    });
    files.push({
      type: 'meta',
      path: `package/api/${ocModule.slug}/meta.json`,
      data: {
        title: ocModule.name,
        pages: ['index', ...ocModule.toolkits.map((tk) => tk.slug)],
        defaultOpen: false,
      },
    });

    for (const toolkit of ocModule.toolkits) {
      files.push({
        type: 'page',
        path: `package/api/${ocModule.slug}/${toolkit.slug}/index.mdx`,
        data: {
          title: toolkit.name,
          description: toolkit.description,
        },
      });
      files.push({
        type: 'meta',
        path: `package/api/${ocModule.slug}/${toolkit.slug}/meta.json`,
        data: {
          title: toolkit.name,
          pages: ['index', ...toolkit.packages.map((pkg) => pkg.slug)],
          defaultOpen: false,
        },
      });

      for (const pkg of toolkit.packages) {
        files.push({
          type: 'page',
          path: `package/api/${ocModule.slug}/${toolkit.slug}/${pkg.slug}.mdx`,
          data: {
            title: pkg.name,
            description: pkg.description,
          },
        });
      }
    }
  }

  return files;
};

const tree = loadTree();

export const apiTree: ApiTree = tree;

export const apiSource: StaticSource = {
  files: buildFiles(tree),
};

import 'server-only';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiSymbol } from '../../../lib/api-symbol';

type ApiSearchEntry = {
  readonly title: string;
  readonly url: string;
  readonly tag: string;
};

const SEARCH_INDEX_PATH = resolve(process.cwd(), 'data/api-search-index.json');

/**
 * Every OCCT API symbol (class, method, static, property) as a compact list,
 * written once by the static export and searched in the browser by
 * `components/search-dialog.tsx`. The full `api-search-index.json` carries
 * structured contents that only repeat the title, so they are dropped.
 */
export const dynamic = 'force-static';

export const GET = async (): Promise<Response> => {
  let entries: readonly ApiSearchEntry[] = [];
  try {
    entries = JSON.parse(await fs.readFile(SEARCH_INDEX_PATH, 'utf8')) as readonly ApiSearchEntry[];
  } catch {
    entries = [];
  }
  const symbols: ApiSymbol[] = entries.map((entry) => [entry.title, entry.url, entry.tag]);
  return Response.json(symbols);
};

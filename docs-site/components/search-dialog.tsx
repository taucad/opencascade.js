'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDocsSearch } from 'fumadocs-core/search/client';
import type { SharedProps } from 'fumadocs-ui/components/dialog/search';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SearchItemType,
} from 'fumadocs-ui/components/dialog/search';
import type { ApiSymbol } from '../lib/api-symbol';

const API_RESULT_LIMIT = 20;

let symbolsPromise: Promise<readonly ApiSymbol[]> | undefined;

/** Fetch the API symbol list once per page load, on first use. */
const loadSymbols = (): Promise<readonly ApiSymbol[]> => {
  symbolsPromise ??= fetch('/api/search-api.json')
    .then(async (response) => (response.ok ? ((await response.json()) as ApiSymbol[]) : []))
    .catch(() => []);
  return symbolsPromise;
};

/**
 * Rank API symbols for a query: exact name first, then prefix, then substring
 * matches, each in index order. Case-insensitive.
 */
export const searchSymbols = (symbols: readonly ApiSymbol[], query: string, limit = API_RESULT_LIMIT): ApiSymbol[] => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const exact: ApiSymbol[] = [];
  const prefix: ApiSymbol[] = [];
  const substring: ApiSymbol[] = [];
  for (const symbol of symbols) {
    const title = symbol[0].toLowerCase();
    if (title === needle) exact.push(symbol);
    else if (title.startsWith(needle)) prefix.push(symbol);
    else if (substring.length < limit && title.includes(needle)) substring.push(symbol);
    if (exact.length >= limit) break;
  }
  return [...exact, ...prefix, ...substring].slice(0, limit);
};

/**
 * Static search for the exported site: the docs pages through Fumadocs'
 * Orama client (`/api/search`), and the OCCT API symbols through a compact
 * list (`/api/search-api.json`) matched by name in the browser.
 */
const StaticSearchDialog = (props: SharedProps): React.JSX.Element => {
  const { search, setSearch, query } = useDocsSearch({ type: 'static', from: '/api/search' });
  const [symbols, setSymbols] = useState<readonly ApiSymbol[]>([]);

  useEffect(() => {
    if (!props.open) return;
    let active = true;
    void loadSymbols().then((loaded) => {
      if (active) setSymbols(loaded);
    });
    return () => {
      active = false;
    };
  }, [props.open]);

  const items = useMemo((): SearchItemType[] | null => {
    const docs = query.data === 'empty' ? [] : (query.data ?? []);
    const api = searchSymbols(symbols, search).map(
      ([title, url, tag]): SearchItemType => ({ id: `api:${url}`, type: 'page', url, content: `${title} (${tag})` }),
    );
    return search.trim() === '' && docs.length === 0 ? null : [...docs, ...api];
  }, [query.data, search, symbols]);

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={items} />
      </SearchDialogContent>
    </SearchDialog>
  );
};

export default StaticSearchDialog;

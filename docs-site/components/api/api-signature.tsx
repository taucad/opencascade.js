import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { ApiTypeLink } from './api-type-link';
import type { ApiMethod, ApiParameter } from './types';

const IDENT_RE = /([A-Za-z_]\w*)/g;

/**
 * Splits a raw type string into linkified tokens. Identifiers run through
 * `ApiTypeLink` (which paints keywords red and types purple); everything
 * else (punctuation, generics, whitespace) is preserved verbatim and
 * tinted with the default text colour to match Shiki's GitHub theme.
 */
const renderTypeTokens = (raw: string): ReactNode[] => {
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const match of raw.matchAll(IDENT_RE)) {
    if (match.index === undefined) continue;
    if (match.index > cursor) {
      out.push(
        <span key={`t-${cursor}`} className="text-api-text">
          {raw.slice(cursor, match.index)}
        </span>,
      );
    }
    out.push(<ApiTypeLink key={`l-${match.index}`} name={match[1]!} />);
    cursor = match.index + match[0].length;
  }
  if (cursor < raw.length) {
    out.push(
      <span key={`t-${cursor}`} className="text-api-text">
        {raw.slice(cursor)}
      </span>,
    );
  }
  return out;
};

const renderParameter = (param: ApiParameter, idx: number): ReactNode => {
  const prefix = param.rest ? '...' : '';
  const opt = param.optional ? '?' : '';
  return (
    <span key={`p-${idx}-${param.name}`} className="whitespace-nowrap">
      {prefix ? <span className="text-api-keyword">{prefix}</span> : undefined}
      <span className="text-api-var">{param.name}</span>
      {opt ? <span className="text-api-keyword">{opt}</span> : undefined}
      <span className="text-api-keyword">: </span>
      {renderTypeTokens(param.type)}
    </span>
  );
};

export type ApiSignatureProps = {
  readonly method: ApiMethod;
};

/**
 * Overload-aware signature renderer. Every token (parameter names, return
 * types, punctuation) is painted with the Shiki GitHub theme palette so a
 * signature line scans like the highlighted code blocks elsewhere on the
 * site:
 *
 *   keyword        red       (`:`, `|`, `=>`, `?`, `...`, primitives)
 *   fn / class     purple    (OCCT class identifiers, member names)
 *   variable       blue      (parameter names)
 *   text           default   (punctuation, brackets, separators)
 */
export const ApiSignature = ({ method }: ApiSignatureProps): ReactNode => {
  const params = (method.parameters ?? []).map(renderParameter);
  const ret = method.returnType ?? 'void';
  return (
    <span className="font-mono text-sm">
      <span className="text-api-text">(</span>
      {params.map((node, idx) => (
        <Fragment key={`p-${idx}`}>
          {idx > 0 ? <span className="text-api-text">, </span> : undefined}
          {node}
        </Fragment>
      ))}
      <span className="text-api-text">)</span>
      <span className="text-api-keyword">: </span>
      {renderTypeTokens(ret)}
    </span>
  );
};

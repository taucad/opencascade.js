import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { ApiTypeLink } from './api-type-link';

export type ApiProseProps = {
  readonly text: string;
};

const LINK_RE = /\{@link\s+([^}|]+?)(?:\s*\|\s*`([^`]+)`)?\s*\}/g;

/**
 * Renders OCCT JSDoc prose with `{@link Target | Label}` references resolved
 * via `ApiTypeLink`. Cross-package navigation comes from the build-time
 * `nameToHit` map. Plain text passes through unchanged.
 */
export const ApiProse = ({ text }: ApiProseProps): ReactNode => {
  if (!text) return undefined;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINK_RE)) {
    if (match.index === undefined) continue;
    if (match.index > cursor) {
      parts.push(<Fragment key={`t-${cursor}`}>{text.slice(cursor, match.index)}</Fragment>);
    }
    const target = match[1]!.trim();
    const visible = (match[2] ?? target).trim();
    parts.push(
      <ApiTypeLink key={`l-${match.index}`} name={target}>
        {visible}
      </ApiTypeLink>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key={`t-${cursor}`}>{text.slice(cursor)}</Fragment>);
  }
  return <>{parts}</>;
};

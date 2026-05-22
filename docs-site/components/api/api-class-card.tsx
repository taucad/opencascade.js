import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { ApiSignature } from './api-signature';
import { ApiInheritanceChip } from './api-inheritance-chip';
import { ApiProse } from './api-prose';
import { ApiTypeLink } from './api-type-link';
import { parseComment, type ParsedComment } from './parse-comment';
import { memberAnchorId } from './types';
import type { ApiClass, ApiMethod, ApiProperty, MemberKind } from './types';

const IDENT_RE = /([A-Za-z_]\w*)/g;

/**
 * Same renderer as `ApiSignature.renderTypeTokens` but inlined so property
 * rows can linkify their type strings without depending on the signature
 * module. Punctuation gets the GitHub-theme default text colour; the
 * identifier itself runs through `ApiTypeLink` (which paints keywords red
 * and OCCT identifiers purple).
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

const isOverload = (arr: readonly ApiMethod[], i: number): boolean => {
  const name = arr[i]?.name;
  if (!name) return false;
  const before = i > 0 && arr[i - 1]?.name === name;
  const after = i < arr.length - 1 && arr[i + 1]?.name === name;
  return before || after;
};

const collectChain = (cls: ApiClass): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (t: string | undefined): void => {
    if (!t) return;
    const norm = t.trim();
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  };
  for (const t of cls.extends ?? []) push(t);
  const anc = cls.ancestors;
  if (Array.isArray(anc)) {
    for (const a of anc) push(typeof a === 'string' ? a : undefined);
  } else if (anc && typeof anc === 'object') {
    for (const key of Object.keys(anc)) push(key);
  }
  return out;
};

const MEMBER_NAME_CLASS = 'text-api-fn';

const DefList = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode => (
  <div className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
    <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fd-muted-foreground">
      {label}
    </div>
    <div>{children}</div>
  </div>
);

const ParametersList = ({
  parameters,
  parsed,
}: {
  readonly parameters: readonly ApiMethod['parameters'][number][];
  readonly parsed: ParsedComment;
}): ReactNode => {
  if (parameters.length === 0) return undefined;
  return (
    <DefList label={`Parameters (${parameters.length})`}>
      <ul className="space-y-1">
        {parameters.map((p) => {
          const description = parsed.params.get(p.name);
          return (
            <li key={p.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <code className="font-mono text-api-var">{p.name}</code>
              {description ? (
                <span className="text-fd-muted-foreground">
                  — <ApiProse text={description} />
                </span>
              ) : undefined}
            </li>
          );
        })}
      </ul>
    </DefList>
  );
};

const ReturnsBlock = ({
  returnType,
  text,
}: {
  readonly returnType: string;
  readonly text: string | null;
}): ReactNode => {
  if (!text && (returnType === 'void' || returnType === 'undefined')) return undefined;
  if (!text) return undefined;
  return (
    <DefList label="Returns">
      <span className="text-fd-muted-foreground">
        <ApiProse text={text} />
      </span>
    </DefList>
  );
};

const RemarksBlock = ({ text }: { readonly text: string | null }): ReactNode => {
  if (!text) return undefined;
  return (
    <DefList label="Remarks">
      <span className="text-fd-muted-foreground">
        <ApiProse text={text} />
      </span>
    </DefList>
  );
};

const SeeBlock = ({ items }: { readonly items: readonly string[] }): ReactNode => {
  if (items.length === 0) return undefined;
  return (
    <DefList label="See also">
      <ul className="space-y-0.5">
        {items.map((entry, idx) => (
          <li key={`see-${idx}`} className="text-fd-muted-foreground">
            <ApiProse text={entry} />
          </li>
        ))}
      </ul>
    </DefList>
  );
};

const DeprecatedBanner = ({ text }: { readonly text: string | null }): ReactNode => {
  if (text === null) return undefined;
  return (
    <div className="mt-2 flex items-baseline gap-2 rounded-md border border-amber-700/30 bg-amber-500/5 px-2.5 py-1.5 text-xs dark:border-amber-300/30">
      <span className="rounded bg-amber-700/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-300/15 dark:text-amber-200">
        Deprecated
      </span>
      {text ? (
        <span className="text-amber-900/80 dark:text-amber-100/80">
          <ApiProse text={text} />
        </span>
      ) : undefined}
    </div>
  );
};

const renderMemberRow = (
  className: string,
  kind: MemberKind,
  arr: readonly ApiMethod[],
  i: number,
): ReactNode => {
  const member = arr[i]!;
  const overload = isOverload(arr, i);
  const parsed = parseComment(member.comment);
  const isDeprecated = parsed.deprecated !== null;
  return (
    <li
      key={memberAnchorId(className, kind, i)}
      id={memberAnchorId(className, kind, i)}
      className={`scroll-mt-24 rounded-md border px-3 py-2.5 transition-colors hover:border-fd-border ${
        overload ? 'border-dashed border-fd-border/40' : 'border-fd-border/40'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 font-mono text-sm">
        <span
          className={`font-semibold ${MEMBER_NAME_CLASS} ${
            isDeprecated ? 'line-through decoration-amber-700/50 decoration-1' : ''
          }`}
        >
          {member.name}
        </span>
        <ApiSignature method={member} />
      </div>
      {parsed.description ? (
        <p className="mt-1.5 text-xs leading-relaxed text-fd-foreground/80">
          <ApiProse text={parsed.description} />
        </p>
      ) : undefined}
      <DeprecatedBanner text={parsed.deprecated} />
      <ParametersList parameters={member.parameters ?? []} parsed={parsed} />
      <ReturnsBlock returnType={member.returnType ?? 'void'} text={parsed.returns} />
      <RemarksBlock text={parsed.remarks} />
      <SeeBlock items={parsed.see} />
    </li>
  );
};

const renderPropertyRow = (
  className: string,
  arr: readonly ApiProperty[],
  i: number,
): ReactNode => {
  const prop = arr[i]!;
  const parsed = parseComment(prop.comment);
  const isDeprecated = parsed.deprecated !== null;
  return (
    <li
      key={memberAnchorId(className, 'prop', i)}
      id={memberAnchorId(className, 'prop', i)}
      className="scroll-mt-24 rounded-md border border-fd-border/40 px-3 py-2.5 transition-colors hover:border-fd-border"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm">
        <span
          className={`font-semibold ${MEMBER_NAME_CLASS} ${
            isDeprecated ? 'line-through decoration-amber-700/50 decoration-1' : ''
          }`}
        >
          {prop.name}
        </span>
        <span className="text-api-keyword">:</span>
        <span className="font-mono text-sm">{renderTypeTokens(prop.type)}</span>
        {prop.readonly ? (
          <span className="ml-1 rounded bg-fd-muted/50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-fd-muted-foreground">
            readonly
          </span>
        ) : undefined}
      </div>
      {parsed.description ? (
        <p className="mt-1.5 text-xs leading-relaxed text-fd-foreground/80">
          <ApiProse text={parsed.description} />
        </p>
      ) : undefined}
      <DeprecatedBanner text={parsed.deprecated} />
      <RemarksBlock text={parsed.remarks} />
      <SeeBlock items={parsed.see} />
    </li>
  );
};

const Section = ({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}): ReactNode => (
  <section className="mt-5">
    <h4 className="mb-2 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-fd-muted-foreground">
      <span>{title}</span>
      <span className="tabular-nums opacity-70">({count})</span>
    </h4>
    <ul className="space-y-2">{children}</ul>
  </section>
);

export type ApiClassCardProps = {
  readonly cls: ApiClass;
};

/**
 * Single OCCT class card. Composes signature/chip/prose components into
 * sections for constructors, static methods, instance methods, and
 * properties. Each member row now structures its JSDoc payload — the raw
 * comment is parsed (see `parse-comment.ts`) and laid out as a description
 * paragraph plus dedicated Parameters / Returns / Remarks / See-also
 * blocks, instead of dumping `@param ... @returns ...` text into a single
 * paragraph.
 *
 * Adjacent same-name members are flagged as connected overloads via dashed
 * borders. Anchor IDs follow the `<Class>__<kind>__<idx>` convention; see
 * `memberAnchorId` in `./types.ts`.
 *
 * Wrapped in `not-prose` so Tailwind Typography's `prose a` underline-all
 * rule doesn't bleed into the structured layout (member names, chips,
 * cross-reference links each have their own intentional styling).
 */
export const ApiClassCard = ({ cls }: ApiClassCardProps): ReactNode => {
  const chain = collectChain(cls);
  const classDoc = parseComment(cls.summary);
  return (
    <article
      id={cls.name}
      className="not-prose scroll-mt-24 rounded-xl border border-fd-border bg-fd-card p-5 shadow-sm"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-lg font-semibold tracking-tight text-api-fn">
          {cls.name}
        </h3>
        {chain.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {chain.map((t) => (
              <Fragment key={t}>
                <ApiInheritanceChip type={t} />
              </Fragment>
            ))}
          </div>
        ) : undefined}
      </header>

      {classDoc.description ? (
        <p className="mt-2.5 text-sm leading-relaxed text-fd-muted-foreground">
          <ApiProse text={classDoc.description} />
        </p>
      ) : undefined}

      {cls.constructors.length > 0 ? (
        <Section title="Constructors" count={cls.constructors.length}>
          {cls.constructors.map((_, i) => renderMemberRow(cls.name, 'ctor', cls.constructors, i))}
        </Section>
      ) : undefined}

      {cls.staticMethods.length > 0 ? (
        <Section title="Static methods" count={cls.staticMethods.length}>
          {cls.staticMethods.map((_, i) => renderMemberRow(cls.name, 'static', cls.staticMethods, i))}
        </Section>
      ) : undefined}

      {cls.instanceMethods.length > 0 ? (
        <Section title="Instance methods" count={cls.instanceMethods.length}>
          {cls.instanceMethods.map((_, i) => renderMemberRow(cls.name, 'inst', cls.instanceMethods, i))}
        </Section>
      ) : undefined}

      {cls.properties.length > 0 ? (
        <Section title="Properties" count={cls.properties.length}>
          {cls.properties.map((_, i) => renderPropertyRow(cls.name, cls.properties, i))}
        </Section>
      ) : undefined}
    </article>
  );
};

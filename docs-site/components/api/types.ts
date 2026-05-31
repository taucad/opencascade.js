export type ApiParameter = {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly rest: boolean;
};

export type ApiMethod = {
  readonly name: string;
  readonly signature: string;
  readonly parameters: readonly ApiParameter[];
  readonly returnType: string;
  readonly comment: string;
};

export type ApiProperty = {
  readonly name: string;
  readonly type: string;
  readonly comment: string;
  readonly readonly?: boolean;
};

export type ApiClass = {
  readonly name: string;
  readonly kind: 'class' | 'interface';
  readonly summary: string;
  readonly extends: readonly string[];
  readonly ancestors: readonly string[] | Record<string, unknown>;
  readonly constructors: readonly ApiMethod[];
  readonly staticMethods: readonly ApiMethod[];
  readonly instanceMethods: readonly ApiMethod[];
  readonly properties: readonly ApiProperty[];
};

export type ApiShard = {
  readonly schema: number;
  readonly shard: string;
  readonly generatedAt: string;
  readonly classes: readonly ApiClass[];
};

export type ApiManifest = {
  readonly wasm_bytes?: number;
  readonly validation_passed?: boolean;
  readonly requested?: number;
  readonly compiled?: number;
  readonly built_at?: string;
};

export type ApiIndexPackage = {
  readonly name: string;
  readonly shard: string;
  readonly classes: ReadonlyArray<{
    readonly name: string;
    readonly kind: string;
    readonly extends: readonly string[];
    readonly summary: string;
    readonly members: { readonly constructors: number; readonly staticMethods: number; readonly instanceMethods: number; readonly properties: number };
  }>;
};

export type ApiIndexToolkit = {
  readonly name: string;
  readonly headline: string;
  readonly classCount: number;
  readonly packages: readonly ApiIndexPackage[];
};

export type ApiIndexModule = {
  readonly name: string;
  readonly headline: string;
  readonly classCount: number;
  readonly toolkitCount: number;
  readonly toolkits: readonly ApiIndexToolkit[];
};

export type ApiIndex = {
  readonly schema: number;
  readonly manifest: ApiManifest;
  readonly totals: {
    readonly modules: number;
    readonly toolkits: number;
    readonly packages: number;
    readonly classes: number;
    readonly searchEntries: number;
  };
  readonly quickLinks: ReadonlyArray<{
    readonly name: string;
    readonly kind: string;
    readonly p: string;
    readonly s: string;
  }>;
  readonly modules: readonly ApiIndexModule[];
  readonly searchIndex: ReadonlyArray<{
    readonly n: string;
    readonly k: string;
    readonly p: string;
    readonly s: string;
    readonly a: string;
    readonly q: string;
  }>;
};

export type ApiSearchEntry = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly tag: string;
  readonly structured: { contents: ReadonlyArray<{ heading: string; content: string }> };
};

export type MemberKind = 'ctor' | 'static' | 'inst' | 'prop';

/**
 * Anchor token for a member. Constructors render under the literal
 * `Constructor` token (the upstream JSDoc names them `constructor`, but the
 * capitalised, kind-agnostic token reads better in a URL and avoids clashing
 * with the TypeScript keyword); every other member uses its real name.
 */
const anchorToken = (kind: MemberKind, name: string): string =>
  kind === 'ctor' ? 'Constructor' : name;

/**
 * Builds deterministic, human-readable anchor ids for every member of a class.
 *
 * Scheme: `<ClassName>-<MemberToken>`. The hyphen is the single level
 * separator as we descend from class to member, so the underscores inside
 * OCCT class names (`Message_Gravity`) and member/enum-value names
 * (`Message_Trace`) stay unambiguous — e.g. `Message_Gravity-Message_Trace`.
 *
 * Overloaded members (and multi-constructor classes) get a 0-indexed ordinal
 * appended directly to the token: `…-Clear0`, `…-Clear1`, `…-Constructor0`,
 * `…-Constructor1`. The ordinal is the member's position within its own
 * same-token group, counted in stable declaration order, so adding an
 * *unrelated* member never shifts an existing anchor. Members whose token is
 * unique in the class stay clean with no number (`…-GetAlerts`).
 *
 * The result is keyed by `<kind>:<index>` (the member's kind + array index)
 * so the caller can map each rendered row back to its anchor. Returned ids are
 * collision-free: distinct tokens differ by token, shared tokens differ by
 * ordinal.
 */
export const buildClassAnchorMap = (cls: ApiClass): ReadonlyMap<string, string> => {
  const entries: ReadonlyArray<{ readonly key: string; readonly token: string }> = [
    ...cls.constructors.map((_, i) => ({ key: `ctor:${i}`, token: anchorToken('ctor', 'constructor') })),
    ...cls.staticMethods.map((m, i) => ({ key: `static:${i}`, token: anchorToken('static', m.name) })),
    ...cls.instanceMethods.map((m, i) => ({ key: `inst:${i}`, token: anchorToken('inst', m.name) })),
    ...cls.properties.map((p, i) => ({ key: `prop:${i}`, token: anchorToken('prop', p.name) })),
  ];

  const totalByToken = new Map<string, number>();
  for (const entry of entries) {
    totalByToken.set(entry.token, (totalByToken.get(entry.token) ?? 0) + 1);
  }

  const ordinalByToken = new Map<string, number>();
  const anchors = new Map<string, string>();
  for (const entry of entries) {
    const ordinal = ordinalByToken.get(entry.token) ?? 0;
    ordinalByToken.set(entry.token, ordinal + 1);
    const needsOrdinal = (totalByToken.get(entry.token) ?? 1) > 1;
    anchors.set(entry.key, `${cls.name}-${entry.token}${needsOrdinal ? ordinal : ''}`);
  }
  return anchors;
};

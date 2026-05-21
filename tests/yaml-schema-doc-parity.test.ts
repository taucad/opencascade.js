/**
 * Fork-internal parity guard between the Cerberus build-config schema and the
 * YAML schema reference doc.
 *
 * `src/customBuildSchema.py` is the canonical Cerberus definition consumed by
 * `src/ocjs_bindgen/link/yaml_build.py` to validate consumer YAML configs.
 * `docs/reference/yaml-schema.md` is the human-facing documentation for the
 * same keys. When the schema grows a new key, the doc must grow alongside it
 * or consumers ship with an undocumented surface.
 *
 * This test extracts the top-level + `mainBuild.*` + `extraBuilds[].*` keys
 * from the Python AST and asserts that every key (and every key listed in the
 * explicit "must-be-documented" set the maintainers committed to) appears in
 * the reference doc.
 *
 * Fork-isolated: assertions live entirely inside `repos/opencascade.js/`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'src', 'customBuildSchema.py');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'reference', 'yaml-schema.md');

interface ExtractedKeys {
  top: string[];
  mainBuild: string[];
  extraBuilds: string[];
}

const extractSchemaKeys = (schemaPath: string): ExtractedKeys => {
  const script = [
    'import ast, json, sys',
    'src = open(sys.argv[1]).read()',
    'tree = ast.parse(src, mode="exec")',
    'if len(tree.body) != 1 or not isinstance(tree.body[0], ast.Expr):',
    '    raise SystemExit("schema file must be a single dict expression")',
    'root = tree.body[0].value',
    'if not isinstance(root, ast.Dict):',
    '    raise SystemExit("schema root must be an ast.Dict")',
    'def keys(d):',
    '    out = []',
    '    for k in d.keys:',
    '        if isinstance(k, ast.Constant) and isinstance(k.value, str):',
    '            out.append(k.value)',
    '    return out',
    'def nested(d, name):',
    '    for k, v in zip(d.keys, d.values):',
    '        if isinstance(k, ast.Constant) and k.value == name and isinstance(v, ast.Dict):',
    '            inner = None',
    '            for ik, iv in zip(v.keys, v.values):',
    '                if isinstance(ik, ast.Constant) and ik.value == "schema" and isinstance(iv, ast.Dict):',
    '                    inner = iv',
    '            return keys(inner) if inner is not None else []',
    '    return []',
    'top = keys(root)',
    'mainBuildKeys = nested(root, "mainBuild")',
    'extraBuildsKeys = []',
    'for k, v in zip(root.keys, root.values):',
    '    if isinstance(k, ast.Constant) and k.value == "extraBuilds" and isinstance(v, ast.Dict):',
    '        for ik, iv in zip(v.keys, v.values):',
    '            if isinstance(ik, ast.Constant) and ik.value == "schema" and isinstance(iv, ast.Dict):',
    '                extraBuildsKeys = keys(iv)',
    'print(json.dumps({"top": top, "mainBuild": mainBuildKeys, "extraBuilds": extraBuildsKeys}))',
  ].join('\n');
  const raw = execFileSync('python3', ['-c', script, schemaPath], { encoding: 'utf8' });
  return JSON.parse(raw.trim()) as ExtractedKeys;
};

const READ_DOC = (): string => fs.readFileSync(DOC_PATH, 'utf8');

// Maintainer-committed list (from the OCJS Production DX rollout): each of
// these names must appear by name in `yaml-schema.md`. A new key here is the
// canonical signal that the docs need a new section.
const REQUIRED_DOCUMENTED_KEYS = [
  'mainBuild',
  'extraBuilds',
  'additionalCppCode',
  'additionalCppFiles',
  'mainBuild.additionalBindCode',
  'mainBuild.allowedUndefinedSymbols',
  'generateTypescriptDefinitions',
] as const;

// Keys that have a dedicated H2/H3 heading in `yaml-schema.md`. Validates that
// the doc structure (not just inline mention) carries the high-traffic keys.
const REQUIRED_HEADING_KEYS = [
  'additionalCppCode',
  'additionalCppFiles',
  'mainBuild.additionalBindCode',
  'mainBuild.allowedUndefinedSymbols',
] as const;

describe('customBuildSchema.py ↔ docs/reference/yaml-schema.md parity', () => {
  it('extracts the canonical top-level, mainBuild, and extraBuilds keys from the Python AST', () => {
    const extracted = extractSchemaKeys(SCHEMA_PATH);
    expect(extracted.top.sort()).toEqual(
      [
        'additionalCppCode',
        'additionalCppFiles',
        'extraBuilds',
        'generateTypescriptDefinitions',
        'mainBuild',
      ].sort(),
    );
    expect(extracted.mainBuild.sort()).toEqual(
      ['additionalBindCode', 'allowedUndefinedSymbols', 'bindings', 'emccFlags', 'name'].sort(),
    );
    expect(extracted.extraBuilds.sort()).toEqual(
      [
        'additionalBindCode',
        'allowedUndefinedSymbols',
        'bindings',
        'emccFlags',
        'name',
      ].sort(),
    );
  });

  it.each(REQUIRED_DOCUMENTED_KEYS)(
    'documents the %s key in docs/reference/yaml-schema.md',
    (key) => {
      const doc = READ_DOC();
      expect(
        doc.includes(key),
        `Key "${key}" is in customBuildSchema.py but is not mentioned anywhere in docs/reference/yaml-schema.md. Add a section describing this key.`,
      ).toBe(true);
    },
  );

  it.each(REQUIRED_HEADING_KEYS)(
    'has a dedicated H2/H3 heading for the %s key in docs/reference/yaml-schema.md',
    (key) => {
      const doc = READ_DOC();
      const headingRe = new RegExp(
        `^#{2,3}\\s+${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`,
        'm',
      );
      expect(
        headingRe.test(doc),
        `Key "${key}" needs a dedicated "## ${key}" or "### ${key}" heading in docs/reference/yaml-schema.md but none was found.`,
      ).toBe(true);
    },
  );

  it('mentions every schema key (top + mainBuild + extraBuilds) in the doc', () => {
    const extracted = extractSchemaKeys(SCHEMA_PATH);
    const doc = READ_DOC();
    const missing: string[] = [];
    for (const key of extracted.top) {
      if (!doc.includes(key)) missing.push(key);
    }
    for (const key of extracted.mainBuild) {
      if (!doc.includes(key)) missing.push(`mainBuild.${key}`);
    }
    for (const key of extracted.extraBuilds) {
      if (!doc.includes(key)) missing.push(`extraBuilds[].${key}`);
    }
    expect(
      missing,
      `Schema keys not mentioned in docs/reference/yaml-schema.md: ${missing.join(', ')}`,
    ).toHaveLength(0);
  });
});

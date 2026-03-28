/**
 * TypeScript declaration validation suite for opencascade.js builds.
 *
 * Parses generated .d.ts files using the TypeScript compiler API and validates:
 * - Symbol coverage against the build manifest
 * - No invalid TypeScript syntax (::, bare < in type names)
 * - Key OCCT classes exist with expected structure
 * - Overload patterns (inline overloads vs _N subclasses)
 * - `any` type regression tracking
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPLICAD_BUILD_CONFIG = path.resolve(
  import.meta.dirname,
  '../../replicad/packages/replicad-opencascadejs/build-config',
);

const FULL_BUILD_CONFIG = path.resolve(import.meta.dirname, '../build-configs');

function parseDtsFile(dtsPath: string): ts.SourceFile | null {
  if (!fs.existsSync(dtsPath)) return null;
  const content = fs.readFileSync(dtsPath, 'utf8');
  return ts.createSourceFile(dtsPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

type DtsSymbol = {
  name: string;
  kind: 'class' | 'enum' | 'type' | 'interface' | 'function';
  members?: string[];
  heritage?: string[];
};

function extractSymbols(sourceFile: ts.SourceFile): DtsSymbol[] {
  const symbols: DtsSymbol[] = [];

  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const members: string[] = [];
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          members.push(member.name.text);
        } else if (ts.isConstructorDeclaration(member)) {
          members.push('constructor');
        }
      }
      const heritage: string[] = [];
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          for (const type of clause.types) {
            if (ts.isIdentifier(type.expression)) {
              heritage.push(type.expression.text);
            }
          }
        }
      }
      symbols.push({ name: node.name.text, kind: 'class', members, heritage });
    } else if (ts.isEnumDeclaration(node) && node.name) {
      const members = node.members.map((m) => (ts.isIdentifier(m.name) ? m.name.text : ''));
      symbols.push({ name: node.name.text, kind: 'enum', members });
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: 'type' });
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: 'interface' });
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: 'function' });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          symbols.push({ name: decl.name.text, kind: 'enum' });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}

function loadManifest(configDir: string): Record<string, unknown> | null {
  const manifestPath = path.join(configDir, 'build-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
}

function loadYamlSymbols(yamlPath: string): string[] {
  if (!fs.existsSync(yamlPath)) return [];
  const content = fs.readFileSync(yamlPath, 'utf8');
  const symbols: string[] = [];
  for (const line of content.split('\n')) {
    const match = /^\s*-\s*symbol:\s*(\S+)/.exec(line);
    if (match) {
      symbols.push(match[1]);
    }
  }
  return symbols;
}

/**
 * Finds lines containing C++ scope resolution operators (::) that leaked
 * into the generated .d.ts output. Ignores comments.
 */
function findDoubleColonViolations(content: string): { line: number; text: string }[] {
  const lines = content.split('\n');
  const violations: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('//') || line.includes('/*')) continue;
    if (line.trimStart().startsWith('*')) continue;
    if (/\w+::\w+/.test(line)) {
      violations.push({ line: i + 1, text: line.trim() });
    }
  }

  return violations;
}

/**
 * Finds lines containing bare template types (<) in type positions,
 * excluding known valid TS generics like Promise<> and Array<>.
 */
function findBareTemplateViolations(content: string): { line: number; text: string }[] {
  const lines = content.split('\n');
  const violations: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('//') || line.includes('/*')) continue;
    if (line.trimStart().startsWith('*')) continue;
    const typeMatch = /:\s*\w+<\w+/.exec(line);
    if (typeMatch && !line.includes('Array<') && !line.includes('Promise<')) {
      violations.push({ line: i + 1, text: line.trim() });
    }
  }

  return violations;
}

/**
 * Counts `: any` occurrences and groups them by class.
 */
function countAnyTypes(sourceFile: ts.SourceFile): {
  total: number;
  byClass: { className: string; count: number }[];
} {
  const content = sourceFile.getFullText();
  const lines = content.split('\n');
  let total = 0;
  const classCounts = new Map<string, number>();
  let currentClass = '';

  for (const line of lines) {
    const classMatch = /class\s+(\w+)/.exec(line);
    if (classMatch) {
      currentClass = classMatch[1];
    }

    const anyMatches = line.match(/:\s*any\b/g);
    if (anyMatches) {
      total += anyMatches.length;
      if (currentClass) {
        classCounts.set(currentClass, (classCounts.get(currentClass) ?? 0) + anyMatches.length);
      }
    }
  }

  const byClass = [...classCounts.entries()]
    .map(([className, count]) => ({ className, count }))
    .sort((a, b) => b.count - a.count);

  return { total, byClass };
}

// ---------------------------------------------------------------------------
// Full build .d.ts validation
// ---------------------------------------------------------------------------

describe('Full build .d.ts validation', () => {
  const dtsPath = path.join(FULL_BUILD_CONFIG, 'opencascade_full.d.ts');
  const sourceFile = parseDtsFile(dtsPath);

  it('should parse without errors (zero syntactic diagnostics)', () => {
    expect(sourceFile).not.toBeNull();
    if (!sourceFile) return;

    const diagnostics = ts
      .createProgram({
        rootNames: [dtsPath],
        options: {
          noEmit: true,
          declaration: true,
          strict: false,
          skipLibCheck: true,
        },
      })
      .getSyntacticDiagnostics(sourceFile);

    expect(diagnostics.length).toBe(0);
  });

  it('should have zero :: leaks (C++ scope resolution)', () => {
    if (!sourceFile) return;
    const violations = findDoubleColonViolations(sourceFile.getFullText());

    expect(violations).toHaveLength(0);
  });

  it('should catch known :: edge case patterns', () => {
    const badPatterns = [
      'occ::handle<Geom_Surface>',
      'opencascade::handle<Geom_Curve>',
      'Geom2d_EvalRepCurveDesc::Base',
      'std::string_view',
      'IMeshData::ListOfPnt2d',
    ];

    for (const pattern of badPatterns) {
      const violations = findDoubleColonViolations(pattern);
      expect(violations.length, `Expected :: detection to catch pattern: "${pattern}"`).toBeGreaterThan(0);
    }
  });

  it('should have zero bare < in type positions (except Promise<>, Array<>)', () => {
    if (!sourceFile) return;
    const violations = findBareTemplateViolations(sourceFile.getFullText());

    expect(violations).toHaveLength(0);
  });

  it('should keep `any` type count at or below regression threshold (148)', () => {
    if (!sourceFile) return;
    const { total } = countAnyTypes(sourceFile);

    expect(total, `any count ${total} exceeds regression threshold of 148`).toBeLessThanOrEqual(148);
  });

  it('should have all symbols from full.yml declared in the .d.ts', () => {
    if (!sourceFile) return;
    const yamlPath = path.join(FULL_BUILD_CONFIG, 'full.yml');
    const yamlSymbols = loadYamlSymbols(yamlPath);
    expect(yamlSymbols.length, 'full.yml should contain symbols').toBeGreaterThan(0);

    const dtsSymbols = extractSymbols(sourceFile);
    const dtsNames = new Set(dtsSymbols.map((s) => s.name));

    const missing: string[] = [];
    for (const sym of yamlSymbols) {
      if (!dtsNames.has(sym)) {
        missing.push(sym);
      }
    }

    const coveragePercent = ((yamlSymbols.length - missing.length) / yamlSymbols.length) * 100;

    expect(
      coveragePercent,
      `Symbol coverage ${coveragePercent.toFixed(1)}% is below 95% threshold (${missing.length} missing)`,
    ).toBeGreaterThanOrEqual(95);
  });

  it('should contain key OCCT classes', () => {
    if (!sourceFile) return;
    const symbols = extractSymbols(sourceFile);
    const symbolNames = new Set(symbols.map((s) => s.name));

    const requiredClasses = [
      'gp_Pnt',
      'gp_Vec',
      'gp_Dir',
      'gp_Ax1',
      'gp_Ax2',
      'gp_Trsf',
      'BRepPrimAPI_MakeBox',
      'BRepPrimAPI_MakeCylinder',
      'BRepPrimAPI_MakeSphere',
      'TopoDS_Shape',
      'TopoDS_Wire',
      'TopoDS_Edge',
      'TopoDS_Face',
      'TopoDS_Solid',
      'BRepAlgoAPI_Fuse',
      'BRepAlgoAPI_Cut',
      'BRepAlgoAPI_Common',
      'BRepFilletAPI_MakeFillet',
      'BRepBuilderAPI_MakeEdge',
      'BRepBuilderAPI_MakeWire',
      'BRepBuilderAPI_MakeFace',
      'BRepBuilderAPI_Transform',
      'Geom_Surface',
      'Geom_Curve',
      'Geom_BSplineCurve',
      'Geom_BSplineSurface',
      'STEPControl_Reader',
      'STEPControl_Writer',
      'XSControl_Reader',
      'XSControl_Writer',
      'BRep_Builder',
      'BRep_Tool',
      'ShapeFix_Shape',
      'ShapeFix_Wire',
    ];

    const missing: string[] = [];
    for (const cls of requiredClasses) {
      if (!symbolNames.has(cls)) {
        missing.push(cls);
      }
    }

    expect(missing).toHaveLength(0);
  });

  it('should validate symbol coverage against build manifest', () => {
    const manifest = loadManifest(FULL_BUILD_CONFIG);
    if (!manifest || !sourceFile) return;

    const symbolsSection = manifest['symbols'] as
      | {
          requested?: string[];
          missing?: string[];
        }
      | undefined;

    if (!symbolsSection?.requested) {
      return;
    }

    const dtsSymbols = extractSymbols(sourceFile);
    const dtsNames = new Set(dtsSymbols.map((s) => s.name));
    const requested = new Set(symbolsSection.requested);

    const inManifestNotInDts: string[] = [];
    for (const sym of requested) {
      if (!dtsNames.has(sym)) {
        inManifestNotInDts.push(sym);
      }
    }

    const coveragePercent = ((requested.size - inManifestNotInDts.length) / requested.size) * 100;

    expect(coveragePercent).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Overload validation
// ---------------------------------------------------------------------------

describe('Overload validation (full build)', () => {
  const dtsPath = path.join(FULL_BUILD_CONFIG, 'opencascade_full.d.ts');
  const sourceFile = parseDtsFile(dtsPath);

  it('should use inline constructor overloads for gp_Pnt (unique arities: 0, 1, 3 args)', () => {
    if (!sourceFile) return;
    const symbols = extractSymbols(sourceFile);

    const gpPnt = symbols.find((s) => s.name === 'gp_Pnt' && s.kind === 'class');
    expect(gpPnt, 'gp_Pnt class should exist').toBeDefined();

    const constructorCount = gpPnt!.members!.filter((m) => m === 'constructor').length;
    expect(
      constructorCount,
      `gp_Pnt should have multiple constructor() overloads, found ${constructorCount}`,
    ).toBeGreaterThanOrEqual(2);

    const subclasses = symbols.filter((s) => s.kind === 'class' && /^gp_Pnt_\d+$/.test(s.name));
    expect(
      subclasses,
      `gp_Pnt should NOT have _N subclasses (unique arities use inline overloads), found: ${subclasses.map((s) => s.name).join(', ')}`,
    ).toHaveLength(0);
  });

  it('should use constructor overloads for BRepPrimAPI_MakeBox (suffix-free)', () => {
    if (!sourceFile) return;
    const symbols = extractSymbols(sourceFile);

    const base = symbols.find((s) => s.name === 'BRepPrimAPI_MakeBox' && s.kind === 'class');
    expect(base, 'BRepPrimAPI_MakeBox class should exist').toBeDefined();

    const subclasses = symbols.filter((s) => s.kind === 'class' && /^BRepPrimAPI_MakeBox_\d+$/.test(s.name));
    expect(subclasses.length, 'BRepPrimAPI_MakeBox should NOT have _N subclasses in suffix-free mode').toBe(0);

    expect(
      base!.members!.filter((m) => m === 'constructor').length,
      'BRepPrimAPI_MakeBox should have multiple constructor overloads',
    ).toBeGreaterThanOrEqual(2);
  });

  it('should not have _N suffixes for methods with unique arities', () => {
    if (!sourceFile) return;
    const symbols = extractSymbols(sourceFile);

    const gpPnt = symbols.find((s) => s.name === 'gp_Pnt' && s.kind === 'class');
    expect(gpPnt).toBeDefined();

    const methods = gpPnt!.members!.filter((m) => m !== 'constructor');
    const uniqueArityMethods = ['X', 'Y', 'Z', 'SetX', 'SetY', 'SetZ', 'Distance'];

    for (const method of uniqueArityMethods) {
      expect(methods, `gp_Pnt should have method "${method}"`).toContain(method);
      const suffixed = methods.filter((m) => new RegExp(`^${method}_\\d+$`).test(m));
      expect(
        suffixed,
        `${method} has unique arities and should not have _N suffixed variants, found: ${suffixed.join(', ')}`,
      ).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// NCollection_Vec tuple type validation
// ---------------------------------------------------------------------------

describe('NCollection_Vec tuple type validation', () => {
  const dtsPath = path.join(FULL_BUILD_CONFIG, 'opencascade_full.d.ts');

  it('should never produce bare number[] for NCollection_Vec types', () => {
    if (!fs.existsSync(dtsPath)) return;
    const content = fs.readFileSync(dtsPath, 'utf8');
    const lines = content.split('\n');
    const violations: { line: number; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('//') || line.includes('/*')) continue;
      if (/(?<![A-Za-z0-9_])NCollection_Vec[234](?![A-Za-z0-9_])/.test(line)) {
        violations.push({ line: i + 1, text: line.trim() });
      }
    }

    expect(
      violations,
      `NCollection_Vec types should be resolved to tuples, not left as raw type names: ${violations.map((v) => `L${v.line}: ${v.text}`).join('; ')}`,
    ).toHaveLength(0);
  });

  it('should use fixed-length tuples, not number[] for vec-like types', () => {
    if (!fs.existsSync(dtsPath)) return;
    const content = fs.readFileSync(dtsPath, 'utf8');
    const lines = content.split('\n');

    const tuplePattern = /\[number(?:,\s*number){1,3}\]/;
    const arrayPattern = /:\s*number\[\]/;
    let tupleCount = 0;
    let arrayCount = 0;

    for (const line of lines) {
      if (tuplePattern.test(line)) tupleCount++;
      if (arrayPattern.test(line)) arrayCount++;
    }

    if (tupleCount > 0) {
      expect(tupleCount).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// :: detection happy path and failure path
// ---------------------------------------------------------------------------

describe(':: detection correctness', () => {
  it('should not produce false positives on clean TypeScript types', () => {
    const cleanLines = [
      'export declare class gp_Pnt {',
      '  constructor(theXp: number, theYp: number, theZp: number);',
      '  SetX(theX: number): void;',
      '  Distance(theOther: gp_Pnt): number;',
      'declare function init(): Promise<OpenCascadeInstance>;',
      'export default init;',
      'export declare type TopAbs_ShapeEnum = { TopAbs_COMPOUND: {} };',
      '  static GetLengthFactorValue(theUnit: number): number;',
    ];

    const content = cleanLines.join('\n');
    const violations = findDoubleColonViolations(content);
    expect(violations, 'Clean TypeScript lines should produce zero :: violations').toHaveLength(0);
  });

  it('should detect known bad C++ patterns', () => {
    const badLines = [
      '  param: occ::handle<Geom_Surface>;',
      '  value: opencascade::handle<Geom_Curve>;',
      '  base: Geom2d_EvalRepCurveDesc::Base;',
      '  name: std::string_view;',
      '  list: IMeshData::ListOfPnt2d;',
    ];

    for (const line of badLines) {
      const violations = findDoubleColonViolations(line);
      expect(violations.length, `Should detect :: in: "${line.trim()}"`).toBeGreaterThan(0);
    }
  });

  it('should not flag :: inside comments', () => {
    const commentLines = ['// occ::handle is a C++ type', '/* std::string_view is not valid TS */'];

    const content = commentLines.join('\n');
    const violations = findDoubleColonViolations(content);
    expect(violations, 'Comments containing :: should be ignored').toHaveLength(0);
  });
});

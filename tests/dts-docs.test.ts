/**
 * Documentation coverage tests for generated TypeScript declarations.
 *
 * Parses the generated .d.ts file and validates that JSDoc comments are
 * present for classes, methods, constructors, enums, and parameters.
 * Documentation is extracted from OCCT C++ headers via Doxygen XML pipeline.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FULL_DTS = path.resolve(
  import.meta.dirname,
  '../build-configs/opencascade_full.d.ts',
);

function parseDts(): ts.SourceFile | null {
  if (!fs.existsSync(FULL_DTS)) return null;
  const content = fs.readFileSync(FULL_DTS, 'utf8');
  return ts.createSourceFile(
    FULL_DTS,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function getJSDocText(node: ts.Node): string {
  const jsDocNodes = (node as any).jsDoc;
  if (!jsDocNodes || !Array.isArray(jsDocNodes)) return '';
  return jsDocNodes
    .map((jd: ts.JSDoc) => jd.getFullText())
    .join('\n');
}

function hasJSDoc(node: ts.Node): boolean {
  return getJSDocText(node).trim().length > 0;
}

function getJSDocComment(node: ts.Node): string {
  const jsDocNodes = (node as any).jsDoc;
  if (!jsDocNodes || !Array.isArray(jsDocNodes)) return '';
  return jsDocNodes
    .map((jd: ts.JSDoc) => (jd.comment ? (typeof jd.comment === 'string' ? jd.comment : '') : ''))
    .join('\n');
}

function findClass(
  sourceFile: ts.SourceFile,
  name: string,
): ts.ClassDeclaration | undefined {
  let found: ts.ClassDeclaration | undefined;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === name) {
      found = node;
    }
  });
  return found;
}

function findTypeAlias(
  sourceFile: ts.SourceFile,
  name: string,
): ts.TypeAliasDeclaration | undefined {
  let found: ts.TypeAliasDeclaration | undefined;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name?.text === name) {
      found = node;
    }
  });
  return found;
}

function findVariableStatement(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableStatement | undefined {
  let found: ts.VariableStatement | undefined;
  ts.forEachChild(sourceFile, (node) => {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === name,
      )
    ) {
      found = node;
    }
  });
  return found;
}

function findMethod(
  classDecl: ts.ClassDeclaration,
  methodName: string,
): ts.MethodDeclaration | undefined {
  for (const member of classDecl.members) {
    if (
      ts.isMethodDeclaration(member) &&
      member.name &&
      ts.isIdentifier(member.name) &&
      member.name.text === methodName
    ) {
      return member;
    }
  }
  return undefined;
}

function findAllMethods(
  classDecl: ts.ClassDeclaration,
  methodName: string,
): ts.MethodDeclaration[] {
  const results: ts.MethodDeclaration[] = [];
  for (const member of classDecl.members) {
    if (
      ts.isMethodDeclaration(member) &&
      member.name &&
      ts.isIdentifier(member.name) &&
      member.name.text === methodName
    ) {
      results.push(member);
    }
  }
  return results;
}

function findConstructor(
  classDecl: ts.ClassDeclaration,
): ts.ConstructorDeclaration | undefined {
  for (const member of classDecl.members) {
    if (ts.isConstructorDeclaration(member)) {
      return member;
    }
  }
  return undefined;
}

describe('JSDoc documentation coverage', () => {
  const sourceFile = parseDts();

  it.skipIf(!sourceFile)('should have a valid .d.ts file to test', () => {
    expect(sourceFile).not.toBeNull();
  });

  describe('Class-level JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have class-level JSDoc describing cartesian point for gp_Pnt',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const doc = getJSDocText(cls!);
        expect(doc).toContain('cartesian point');
      },
    );

    it.skipIf(!sourceFile)(
      'should have class-level JSDoc about parallelepiped for BRepPrimAPI_MakeBox',
      () => {
        const cls = findClass(sourceFile!, 'BRepPrimAPI_MakeBox');
        expect(cls).toBeDefined();
        const doc = getJSDocText(cls!);
        expect(doc).toContain('parallelepiped');
      },
    );

    it.skipIf(!sourceFile)(
      'should have class-level JSDoc about STEP files for STEPControl_Writer',
      () => {
        const cls = findClass(sourceFile!, 'STEPControl_Writer');
        expect(cls).toBeDefined();
        const doc = getJSDocText(cls!);
        expect(doc).toContain('STEP');
      },
    );

    it.skipIf(!sourceFile)('should have class-level JSDoc about vector for gp_Vec', () => {
      const cls = findClass(sourceFile!, 'gp_Vec');
      expect(cls).toBeDefined();
      const doc = getJSDocText(cls!);
      expect(doc.toLowerCase()).toContain('vector');
    });
  });

  describe('Method-level JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have method-level JSDoc about X coordinate for gp_Pnt.X',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const method = findMethod(cls!, 'X');
        expect(method).toBeDefined();
        const doc = getJSDocText(method!);
        expect(doc).toContain('X');
      },
    );

    it.skipIf(!sourceFile)(
      'should have method-level JSDoc about distance for gp_Pnt.Distance',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const method = findMethod(cls!, 'Distance');
        expect(method).toBeDefined();
        const doc = getJSDocText(method!);
        expect(doc.toLowerCase()).toContain('distance');
      },
    );

    it.skipIf(!sourceFile)(
      'should have method-level JSDoc about assigning X for gp_Pnt.SetX',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const method = findMethod(cls!, 'SetX');
        expect(method).toBeDefined();
        const doc = getJSDocText(method!);
        expect(doc).toContain('X');
      },
    );
  });

  describe('Constructor JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have constructor JSDoc for gp_Pnt',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const ctor = findConstructor(cls!);
        expect(ctor).toBeDefined();
        const doc = getJSDocText(ctor!);
        expect(doc).toContain('point');
      },
    );

    it.skipIf(!sourceFile)(
      'should have distinct constructor JSDoc for OSD_Disk overloaded constructors',
      () => {
        const disk = findClass(sourceFile!, 'OSD_Disk');
        expect(disk).toBeDefined();

        const ctors = disk!.members.filter(ts.isConstructorDeclaration);
        expect(ctors.length).toBeGreaterThanOrEqual(2);

        const docs = ctors.map((c) => getJSDocText(c));
        const nonEmpty = docs.filter((d) => d.length > 0);
        expect(nonEmpty.length).toBeGreaterThanOrEqual(2);

        expect(docs[0]).not.toEqual(docs[1]);
      },
    );
  });

  describe('Enum JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have JSDoc describing topological shapes for TopAbs_ShapeEnum',
      () => {
        const enumDecl = findVariableStatement(sourceFile!, 'TopAbs_ShapeEnum');
        expect(enumDecl).toBeDefined();
        const doc = getJSDocText(enumDecl!);
        expect(doc.toLowerCase()).toContain('topological');
      },
    );

    it.skipIf(!sourceFile)(
      'should have JSDoc describing orientation for TopAbs_Orientation',
      () => {
        const enumDecl = findVariableStatement(sourceFile!, 'TopAbs_Orientation');
        expect(enumDecl).toBeDefined();
        const doc = getJSDocText(enumDecl!);
        expect(doc.toLowerCase()).toContain('orientation');
      },
    );
  });

  describe('Enum member JSDoc', () => {
    function findEnumMemberProperty(
      sourceFile: ts.SourceFile,
      enumName: string,
      memberName: string,
    ): ts.PropertySignature | undefined {
      const varStmt = findVariableStatement(sourceFile, enumName);
      if (!varStmt) return undefined;
      const decl = varStmt.declarationList.declarations[0];
      if (!decl?.type || !ts.isTypeLiteralNode(decl.type)) return undefined;
      for (const member of decl.type.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name &&
          ts.isIdentifier(member.name) &&
          member.name.text === memberName
        ) {
          return member;
        }
      }
      return undefined;
    }

    it.skipIf(!sourceFile)(
      'should have JSDoc describing "8-bits reference" for BinTools_ObjectType_Reference8',
      () => {
        const prop = findEnumMemberProperty(
          sourceFile!,
          'BinTools_ObjectType',
          'BinTools_ObjectType_Reference8',
        );
        expect(prop).toBeDefined();
        const doc = getJSDocText(prop!);
        expect(doc).toContain('8-bits reference');
      },
    );

    it.skipIf(!sourceFile)(
      'should have JSDoc describing "64-bits reference" for BinTools_ObjectType_Reference64',
      () => {
        const prop = findEnumMemberProperty(
          sourceFile!,
          'BinTools_ObjectType',
          'BinTools_ObjectType_Reference64',
        );
        expect(prop).toBeDefined();
        const doc = getJSDocText(prop!);
        expect(doc).toContain('64-bits reference');
      },
    );

    it.skipIf(!sourceFile)(
      'should have no JSDoc for undocumented enum members',
      () => {
        const prop = findEnumMemberProperty(
          sourceFile!,
          'BinTools_ObjectType',
          'BinTools_ObjectType_Unknown',
        );
        expect(prop).toBeDefined();
        const doc = getJSDocText(prop!);
        expect(doc.trim()).toBe('');
      },
    );

    it.skipIf(!sourceFile)(
      'should have JSDoc on at least 250 enum members across all enums',
      () => {
        let membersWithDoc = 0;
        let totalMembers = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (!ts.isVariableStatement(node)) return;
          const decl = node.declarationList.declarations[0];
          if (!decl?.type || !ts.isTypeLiteralNode(decl.type)) return;
          for (const member of decl.type.members) {
            if (ts.isPropertySignature(member)) {
              totalMembers++;
              if (hasJSDoc(member)) membersWithDoc++;
            }
          }
        });
        expect(membersWithDoc).toBeGreaterThanOrEqual(250);
      },
    );
  });

  describe('No empty JSDoc blocks', () => {
    it.skipIf(!sourceFile)(
      'should contain no empty /** */ blocks in the .d.ts',
      () => {
        const content = fs.readFileSync(FULL_DTS, 'utf8');
        const emptyJSDocPattern = /\/\*\*\s*\*\//g;
        const matches = content.match(emptyJSDocPattern);
        expect(matches).toBeNull();
      },
    );
  });

  describe('Documentation coverage thresholds', () => {
    it.skipIf(!sourceFile)(
      'should have JSDoc on at least 60% of classes',
      () => {
        let totalClasses = 0;
        let documentedClasses = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (ts.isClassDeclaration(node) && node.name) {
            totalClasses++;
            if (hasJSDoc(node)) documentedClasses++;
          }
        });
        const ratio = documentedClasses / totalClasses;
        expect(ratio).toBeGreaterThanOrEqual(0.6);
      },
    );

    it.skipIf(!sourceFile)(
      'should have JSDoc on at least 40% of methods',
      () => {
        let totalMethods = 0;
        let documentedMethods = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (ts.isClassDeclaration(node)) {
            for (const member of node.members) {
              if (ts.isMethodDeclaration(member)) {
                totalMethods++;
                if (hasJSDoc(member)) documentedMethods++;
              }
            }
          }
        });
        const ratio = documentedMethods / totalMethods;
        expect(ratio).toBeGreaterThanOrEqual(0.4);
      },
    );
  });

  describe('Overloaded method JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have distinct JSDoc for UnitsMethods.DumpLengthUnit overloads (different arity)',
      () => {
        const cls = findClass(sourceFile!, 'UnitsMethods');
        expect(cls).toBeDefined();
        const overloads = findAllMethods(cls!, 'DumpLengthUnit');
        expect(overloads.length).toBe(2);
        const docs = overloads.map((m) => getJSDocText(m));
        expect(docs[0]).toContain('scale factor');
        expect(docs[1]).toContain('LengthUnit');
        expect(docs[0]).not.toEqual(docs[1]);
      },
    );

    it.skipIf(!sourceFile)(
      'should have distinct JSDoc for gp_Pnt.SetCoord overloads (different arity)',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const overloads = findAllMethods(cls!, 'SetCoord');
        expect(overloads.length).toBe(2);
        const docs = overloads.map((m) => getJSDocText(m));
        expect(docs[0]).not.toEqual(docs[1]);
      },
    );

    it.skipIf(!sourceFile)(
      'should have distinct JSDoc for BRep_Tool.Tolerance overloads (face/edge/vertex)',
      () => {
        const cls = findClass(sourceFile!, 'BRep_Tool');
        expect(cls).toBeDefined();
        const toleranceMethods = cls!.members.filter(
          (m) => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === 'Tolerance',
        );
        expect(toleranceMethods.length).toBeGreaterThanOrEqual(3);

        const docs = toleranceMethods.map((m) => getJSDocText(m));
        const nonEmpty = docs.filter((d) => d.length > 0);
        expect(nonEmpty.length).toBeGreaterThanOrEqual(3);

        expect(docs[0]).not.toEqual(docs[1]);
        expect(docs[1]).not.toEqual(docs[2]);
      },
    );

    it.skipIf(!sourceFile)(
      'should have distinct JSDoc for gp_Pnt.Mirrored overloads (point/axis/plane)',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const mirroredMethods = cls!.members.filter(
          (m) => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === 'Mirrored',
        );
        expect(mirroredMethods.length).toBeGreaterThanOrEqual(3);

        const docs = mirroredMethods.map((m) => getJSDocText(m));
        const nonEmpty = docs.filter((d) => d.length > 0);
        expect(nonEmpty.length).toBeGreaterThanOrEqual(3);

        expect(docs[0]).not.toEqual(docs[1]);
        expect(docs[0]).not.toEqual(docs[2]);
        expect(docs[1]).not.toEqual(docs[2]);
      },
    );

    it.skipIf(!sourceFile)(
      'should produce unique docs for overloaded methods with different param counts',
      () => {
        let distinctOverloads = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (!ts.isClassDeclaration(node) || !node.name) return;
          const methodsByName = new Map<string, ts.MethodDeclaration[]>();
          for (const member of node.members) {
            if (
              ts.isMethodDeclaration(member) &&
              member.name &&
              ts.isIdentifier(member.name)
            ) {
              const name = member.name.text;
              if (!methodsByName.has(name)) methodsByName.set(name, []);
              methodsByName.get(name)!.push(member);
            }
          }
          for (const [, methods] of methodsByName) {
            if (methods.length < 2) continue;
            const docs = methods.map((m) => getJSDocText(m));
            const uniqueDocs = new Set(docs.filter((d) => d.trim().length > 0));
            if (uniqueDocs.size > 1) distinctOverloads++;
          }
        });
        expect(distinctOverloads).toBeGreaterThan(0);
      },
    );

    it.skipIf(!sourceFile)(
      'should produce unique JSDoc for same-arity method overloads with distinct docs',
      () => {
        let sameArityDistinct = 0;
        let sameArityTotal = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (!ts.isClassDeclaration(node) || !node.name) return;
          const methodsByBaseName = new Map<string, ts.MethodDeclaration[]>();
          for (const member of node.members) {
            if (
              ts.isMethodDeclaration(member) &&
              member.name &&
              ts.isIdentifier(member.name)
            ) {
              const fullName = member.name.text;
              const baseName = fullName.replace(/_\d+$/, '');
              if (baseName === fullName) continue;
              if (!methodsByBaseName.has(baseName))
                methodsByBaseName.set(baseName, []);
              methodsByBaseName.get(baseName)!.push(member);
            }
          }
          for (const [, methods] of methodsByBaseName) {
            if (methods.length < 2) continue;
            const byArity = new Map<number, ts.MethodDeclaration[]>();
            for (const m of methods) {
              const arity = m.parameters.length;
              if (!byArity.has(arity)) byArity.set(arity, []);
              byArity.get(arity)!.push(m);
            }
            for (const [, group] of byArity) {
              if (group.length < 2) continue;
              sameArityTotal++;
              const docs = group.map((m) => getJSDocText(m));
              const uniqueDocs = new Set(
                docs.filter((d) => d.trim().length > 0),
              );
              if (uniqueDocs.size > 1) sameArityDistinct++;
            }
          }
        });
        expect(sameArityDistinct).toBeGreaterThan(5);
      },
    );
  });

  describe('@param tags', () => {
    it.skipIf(!sourceFile)(
      'should include @param tags in JSDoc for methods with documented params',
      () => {
        let methodsWithParams = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (ts.isClassDeclaration(node)) {
            for (const member of node.members) {
              if (ts.isMethodDeclaration(member)) {
                const doc = getJSDocText(member);
                if (doc.includes('@param')) {
                  methodsWithParams++;
                }
              }
            }
          }
        });
        expect(methodsWithParams).toBeGreaterThan(0);
      },
    );
  });

  describe('delete() JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have JSDoc about releasing the C++ object for gp_Pnt.delete()',
      () => {
        const cls = findClass(sourceFile!, 'gp_Pnt');
        expect(cls).toBeDefined();
        const del = findMethod(cls!, 'delete');
        expect(del).toBeDefined();
        const doc = getJSDocText(del!);
        expect(doc).toContain('C++ object');
      },
    );

    it.skipIf(!sourceFile)(
      'should have JSDoc on at least 90% of classes with delete()',
      () => {
        let withDoc = 0;
        let total = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (!ts.isClassDeclaration(node)) return;
          const del = findMethod(node, 'delete');
          if (!del) return;
          total++;
          if (hasJSDoc(del)) withDoc++;
        });
        const ratio = withDoc / total;
        expect(ratio).toBeGreaterThanOrEqual(0.9);
      },
    );
  });

  describe('Standard_Transient handle helpers JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have JSDoc about handle being null for Standard_Transient.isNull()',
      () => {
        const cls = findClass(sourceFile!, 'Standard_Transient');
        expect(cls).toBeDefined();
        const method = findMethod(cls!, 'isNull');
        expect(method).toBeDefined();
        const doc = getJSDocText(method!);
        expect(doc).toContain('handle');
        expect(doc).toContain('null');
      },
    );

    it.skipIf(!sourceFile)(
      'should have JSDoc about setting handle to null for Standard_Transient.nullify()',
      () => {
        const cls = findClass(sourceFile!, 'Standard_Transient');
        expect(cls).toBeDefined();
        const method = findMethod(cls!, 'nullify');
        expect(method).toBeDefined();
        const doc = getJSDocText(method!);
        expect(doc).toContain('handle');
        expect(doc).toContain('null');
      },
    );
  });

  describe('Nested enum JSDoc', () => {
    it.skipIf(!sourceFile)(
      'should have enum-level JSDoc for NCollection_IncAllocator_IBlockSizeLevel',
      () => {
        const enumDecl = findVariableStatement(
          sourceFile!,
          'NCollection_IncAllocator_IBlockSizeLevel',
        );
        expect(enumDecl).toBeDefined();
        const doc = getJSDocText(enumDecl!);
        expect(doc).toContain('block');
      },
    );

    it.skipIf(!sourceFile)(
      'should have enum-level JSDoc on at least 10 nested enums',
      () => {
        let nestedEnumsWithDoc = 0;
        let nestedEnumsTotal = 0;
        ts.forEachChild(sourceFile!, (node) => {
          if (!ts.isVariableStatement(node)) return;
          const decl = node.declarationList.declarations[0];
          if (!decl?.name || !ts.isIdentifier(decl.name)) return;
          if (!decl.type || !ts.isTypeLiteralNode(decl.type)) return;
          const name = decl.name.text;
          const parts = name.split('_');
          if (parts.length < 3) return;
          nestedEnumsTotal++;
          if (hasJSDoc(node)) nestedEnumsWithDoc++;
        });
        expect(nestedEnumsWithDoc).toBeGreaterThanOrEqual(10);
      },
    );
  });

  describe('Overload @param correctness', () => {
    function getJSDocParams(node: ts.Node): { name: string; description: string }[] {
      const doc = getJSDocText(node);
      const params: { name: string; description: string }[] = [];
      const paramRegex = /@param\s+(\S+)\s*(.*)/g;
      let match;
      while ((match = paramRegex.exec(doc)) !== null) {
        params.push({ name: match[1], description: match[2].trim() });
      }
      return params;
    }

    function findAllConstructors(
      classDecl: ts.ClassDeclaration,
    ): ts.ConstructorDeclaration[] {
      return classDecl.members.filter(ts.isConstructorDeclaration);
    }

    it.skipIf(!sourceFile)(
      'should not have @param tags on no-arg constructors (TColStd_HPackedMapOfInteger)',
      () => {
        const cls = findClass(sourceFile!, 'TColStd_HPackedMapOfInteger');
        expect(cls).toBeDefined();
        const ctors = findAllConstructors(cls!);
        const noArgCtor = ctors.find((c) => c.parameters.length === 0);
        expect(noArgCtor).toBeDefined();
        const params = getJSDocParams(noArgCtor!);
        expect(params).toHaveLength(0);
      },
    );

    it.skipIf(!sourceFile)(
      'should have matching @param name for TColStd_HPackedMapOfInteger(theOther) constructor',
      () => {
        const cls = findClass(sourceFile!, 'TColStd_HPackedMapOfInteger');
        expect(cls).toBeDefined();
        const ctors = findAllConstructors(cls!);
        const copyCtorCandidates = ctors.filter(
          (c) => c.parameters.length === 1 &&
            c.parameters[0].name &&
            ts.isIdentifier(c.parameters[0].name) &&
            c.parameters[0].name.text === 'theOther',
        );
        expect(copyCtorCandidates.length).toBeGreaterThanOrEqual(1);
        const copyCtor = copyCtorCandidates[0];
        const params = getJSDocParams(copyCtor);
        if (params.length > 0) {
          expect(params.some((p) => p.name === 'theOther')).toBe(true);
          expect(params.some((p) => p.name === 'theNbBuckets')).toBe(false);
        }
      },
    );

    it.skipIf(!sourceFile)(
      'should not have @param tags on default-expanded no-arg constructors (BRepTools_ShapeSet)',
      () => {
        const cls = findClass(sourceFile!, 'BRepTools_ShapeSet');
        if (!cls) return;
        const ctors = findAllConstructors(cls);
        const noArgCtor = ctors.find((c) => c.parameters.length === 0);
        if (!noArgCtor) return;
        const params = getJSDocParams(noArgCtor);
        expect(params).toHaveLength(0);
      },
    );

    it.skipIf(!sourceFile)(
      'should not have @param on any no-arg constructors across the whole .d.ts',
      () => {
        let violations = 0;
        let total = 0;
        const violationNames: string[] = [];
        ts.forEachChild(sourceFile!, (node) => {
          if (!ts.isClassDeclaration(node) || !node.name) return;
          const ctors = findAllConstructors(node);
          for (const ctor of ctors) {
            if (ctor.parameters.length !== 0) continue;
            total++;
            const params = getJSDocParams(ctor);
            if (params.length > 0) {
              violations++;
              if (violationNames.length < 10) {
                violationNames.push(node.name.text);
              }
            }
          }
        });
        expect(violations).toBe(0);
      },
    );

    it.skipIf(!sourceFile)(
      'should have @param names matching actual param names for methods with stripped output params',
      () => {
        const cls = findClass(sourceFile!, 'BRep_Tool');
        expect(cls).toBeDefined();
        const rangeMethods = findAllMethods(cls!, 'Range');
        expect(rangeMethods.length).toBeGreaterThanOrEqual(1);

        for (const m of rangeMethods) {
          const tsParamNames = m.parameters.map((p) =>
            ts.isIdentifier(p.name) ? p.name.text : '',
          );
          const docParams = getJSDocParams(m);
          for (const dp of docParams) {
            expect(tsParamNames).toContain(dp.name);
          }
        }
      },
    );
  });

  describe('Template typedef JSDoc fallback', () => {
    it.skipIf(!sourceFile)(
      'should have class-level JSDoc from base template for NCollection_* template typedefs',
      () => {
        let withDoc = 0;
        let total = 0;
        const ncollectionTypedefs = [
          'NCollection_Array1_TopoDS_Shape',
          'NCollection_List_TopoDS_Shape',
          'NCollection_Array1_double',
          'NCollection_Array1_int',
          'NCollection_Array1_gp_Pnt',
        ];
        for (const name of ncollectionTypedefs) {
          const cls = findClass(sourceFile!, name);
          if (!cls) continue;
          total++;
          if (hasJSDoc(cls)) withDoc++;
        }
        expect(withDoc).toBeGreaterThan(0);
      },
    );

    it.skipIf(!sourceFile)(
      'should inherit method JSDoc from NCollection_Array1 base template for NCollection_Array1_TopoDS_Shape',
      () => {
        const cls = findClass(
          sourceFile!,
          'NCollection_Array1_TopoDS_Shape',
        );
        expect(cls).toBeDefined();

        const init = findMethod(cls!, 'Init');
        expect(init).toBeDefined();
        expect(getJSDocText(init!)).toContain('Initialise');

        const size = findMethod(cls!, 'Size');
        expect(size).toBeDefined();
        expect(getJSDocText(size!)).toContain('Size');

        const length = findMethod(cls!, 'Length');
        expect(length).toBeDefined();
        expect(getJSDocText(length!).toLowerCase()).toContain('length');
      },
    );

    it.skipIf(!sourceFile)(
      'should have constructor JSDoc for template typedef subclasses with docs',
      () => {
        const cls5 = findClass(
          sourceFile!,
          'NCollection_Array1_TopoDS_Shape_5',
        );
        if (!cls5) return;
        const ctor = findConstructor(cls5);
        expect(ctor).toBeDefined();
        const doc = getJSDocText(ctor!);
        expect(doc).toContain('Copy');
      },
    );
  });
});

/**
 * Regression guards over the generated embind C++ output of bindings.py
 * AND the generated `dist/opencascade_full.d.ts` TS declaration.
 *
 * After input-passthrough RBV (Option B of the blueprint) the C++ side
 * expects:
 * - NO lambda body inside `optional_override([...]) -> *_Result { ... }` may
 *   contain `<type> <name> = 0;`, `<type> <name>{};`, or bare `Handle<T> <name>;`
 *   immediately before the underlying `self.<method>(...)` / `Class::method(...)`
 *   call — every output parameter is now a lambda input parameter forwarded
 *   into the C++ call.
 * - For methods that hold class/handle output fields, the lambda return type
 *   is `::emscripten::val` and the body invokes `::ocjs::getRbvDispose()` +
 *   `::ocjs::getSymbolDispose()` to attach Symbol.dispose to the container.
 * - The deprecated proxy-mutation pattern (raw `class_<...>.function("Name",
 *   &Klass::Method)` for methods with non-const class lvalue refs) is gone
 *   for any method the input-passthrough idiom now handles.
 *
 * After the input-passthrough RBV migration, the TS declaration expects:
 * - No method signature that returns the RBV value-object shape (`): { … };`)
 *   may declare its parameters with `?:`. The Embind runtime requires every
 *   slot; advertising optionality breaks arity at the wire and contradicts
 *   the Input-Passthrough RBV decision (callers supply the input value, the
 *   C++ method returns it back through the result container).
 *
 * The tests self-skip when their generated inputs are not present.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BINDINGS_DIR = path.resolve(import.meta.dirname, '../build/bindings');
const DIST_DTS_PATH = path.resolve(import.meta.dirname, '../dist/opencascade_full.d.ts');
const BUILD_CONFIGS_DTS_PATH = path.resolve(
  import.meta.dirname,
  '../build-configs/opencascade_full.d.ts',
);
const DTS_PATH = fs.existsSync(DIST_DTS_PATH) ? DIST_DTS_PATH : BUILD_CONFIGS_DTS_PATH;

function bindingsExist(): boolean {
  return fs.existsSync(BINDINGS_DIR) && fs.statSync(BINDINGS_DIR).isDirectory();
}

function walkBindingCpps(): string[] {
  const out: string[] = [];
  const stack: string[] = [BINDINGS_DIR];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && ent.name.endsWith('.cpp')) {
        out.push(full);
      }
    }
  }
  return out;
}

function readBindingFile(relCandidates: string[]): string | null {
  for (const rel of relCandidates) {
    const full = path.join(BINDINGS_DIR, rel);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
  }
  return null;
}

const lambdaBlockRe = /optional_override\(\[\][^{]*?-> *[\w:]+ *\{([\s\S]*?)\}\)/g;

describe.skipIf(!bindingsExist())('Generated bindings shape — input-passthrough RBV', () => {
  it('no lambda body default-initializes an output param before forwarding', () => {
    const files = walkBindingCpps();
    expect(files.length).toBeGreaterThan(0);

    // Patterns the legacy (pre-Option B) lambda body produced:
    //   double theX = 0;
    //   Handle<Geom_Curve> theCurve;
    //   TopAbs_Orientation theOri{};
    // followed by `self.<Method>(theX, ...)` or `Class::Method(theX, ...)`.
    // Under input-passthrough RBV every output param is a lambda input so
    // none of these forms should appear in any emitted result-struct lambda.
    const forbidden = [
      /\b(?:double|int|float|bool|Standard_(?:Real|Integer|Boolean|ShortReal))\s+\w+\s*=\s*0\s*;\s*\n\s*(?:auto\s+ret\s*=\s*)?(?:self\.|[\w:]+::)/m,
      /\bHandle<[^>]+>\s+\w+\s*;\s*\n\s*(?:auto\s+ret\s*=\s*)?(?:self\.|[\w:]+::)/m,
      /\bopencascade::handle<[^>]+>\s+\w+\s*;\s*\n\s*(?:auto\s+ret\s*=\s*)?(?:self\.|[\w:]+::)/m,
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // Restrict the scan to the bodies inside `optional_override([...]) -> *_Result { ... }`
      // so unrelated machinery (e.g. legitimate local temporaries in non-RBV
      // wrappers) doesn't trip the guard.
      let match: RegExpExecArray | null;
      const re = new RegExp(lambdaBlockRe.source, 'g');
      while ((match = re.exec(src)) !== null) {
        const body = match[1];
        if (!body) continue;
        for (const pattern of forbidden) {
          if (pattern.test(body)) {
            offenders.push(`${path.relative(BINDINGS_DIR, file)}: ${body.trim().slice(0, 200)}`);
            break;
          }
        }
      }
    }

    expect(offenders, `Found ${offenders.length} legacy default-init RBV lambdas; first 3:\n${offenders.slice(0, 3).join('\n---\n')}`).toHaveLength(0);
  });

  it('gp_Trsf.cpp: primitive in/out Transforms forwards caller-supplied X/Y/Z', () => {
    const src = readBindingFile(['FoundationClasses/TKMath/gp/gp_Trsf.hxx/gp_Trsf.cpp']);
    if (src === null) return;

    // The input-passthrough lambda must take theX/theY/theZ as parameters
    // and forward them; no `double theX = 0;` style default-init.
    const transformsBlock = /optional_override\(\[\]\(const gp_Trsf& self, double theX, double theY, double theZ\)/;
    expect(transformsBlock.test(src), 'gp_Trsf::Transforms lambda must take primitive output params by value').toBe(true);

    expect(
      /optional_override\(\[\]\(const gp_Trsf& self\)[^{]*\{[\s\S]*?double theX\s*=\s*0\s*;/m.test(src),
      'gp_Trsf::Transforms lambda must NOT default-init theX = 0 (historical zero-input bug)'
    ).toBe(false);
  });

  it('val::object()+dispose attachment present for at least one Handle-output RBV method', () => {
    // After minimal-transformation RBV: only Handle
    // outputs (and Handle / class C++ returns) drive the val::object + dispose
    // path. Concrete class outputs are mutated in place and do NOT touch the
    // envelope at all — they cannot satisfy this guard.
    const files = walkBindingCpps();
    let foundValObject = false;
    let foundDisposeAttach = false;
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (/::emscripten::val::object\(\)/.test(src)) foundValObject = true;
      if (/::ocjs::getRbvDispose\(\)/.test(src) && /::ocjs::getSymbolDispose\(\)/.test(src)) foundDisposeAttach = true;
      if (foundValObject && foundDisposeAttach) break;
    }
    expect(foundValObject, 'At least one binding must emit `::emscripten::val::object()` for disposable RBV containers').toBe(true);
    expect(foundDisposeAttach, 'At least one binding must wire `::ocjs::getRbvDispose()` + `::ocjs::getSymbolDispose()`').toBe(true);
  });

  it('class outputs forward via *val::as<T*>(allow_raw_pointers()) (R1 minimal transformation)', () => {
    // After R1 the class-output forwarding lane is the only mechanism that
    // preserves caller mutation. We use raw-pointer wire (`val::as<T*>()`)
    // + deref instead of `val::as<T&>()` because embind's reference wire
    // round-trips by value (BindingType<T&> degrades to BindingType<T>),
    // breaking in-place mutation. At least one binding must invoke the
    // `*<arg>.as<<ClassName>*>(emscripten::allow_raw_pointers())` pattern
    // inside a lambda body.
    const files = walkBindingCpps();
    const asPointerPattern =
      /\*\s*[A-Za-z_]\w*\.as<[A-Za-z_][\w:]*\s*\*>\(emscripten::allow_raw_pointers\(\)\)/;
    const offenders = files.filter((f) => asPointerPattern.test(fs.readFileSync(f, 'utf8')));
    expect(
      offenders.length,
      'No binding emits the `*val::as<T*>(allow_raw_pointers())` pointer-deref-passthrough pattern for class outputs',
    ).toBeGreaterThan(0);
  });
});

describe.skipIf(!fs.existsSync(DTS_PATH))('Generated .d.ts shape — Option C (no `?:` on RBV output-param inputs)', () => {
  const dts = fs.existsSync(DTS_PATH) ? fs.readFileSync(DTS_PATH, 'utf8') : '';

  // A signature emits the RBV value-object return when it ends with
  // `): { …; …; };` — the brace block is the structured `val::object()` /
  // `value_object` shape. Class-typed returns (`gp_Pnt`, `boolean`, `number`,
  // `unknown`, …) do NOT use this shape, so they are untouched by Option C.
  // The `m` flag scopes the match to a single line so we never straddle a
  // method declaration.
  const rbvSignatureWithOptional = /^\s+[A-Za-z_]\w*\([^)]*\?:[^)]*\):\s*\{[^}]*\};\s*$/gm;

  it('no method that returns an RBV value-object container marks any param `?:`', () => {
    const violators = Array.from(dts.matchAll(rbvSignatureWithOptional), (m: RegExpExecArray) => m[0].trim());
    expect(
      violators,
      `Found ${violators.length} RBV signatures with "?:" markers (Option C forbids these). First 5:\n${violators
        .slice(0, 5)
        .join('\n')}`,
    ).toHaveLength(0);
  });

  // Canonical method spot-checks: every primitive-RBV method should now
  // appear with required `:` slots in the .d.ts. These guard the foundational
  // OCCT methods called out in the F3 direction-tag audit.
  const canonicalSignatures: Array<[label: string, regex: RegExp]> = [
    // gp_Trsf::Transforms(double&,double&,double&) — `[in,out]`, untagged in OCCT
    [
      'gp_Trsf::Transforms(theX,theY,theZ) required',
      /\bTransforms\(theX: number, theY: number, theZ: number\): \{ theX: number; theY: number; theZ: number \};/,
    ],
    // Geom_Surface::Bounds(U1&,U2&,V1&,V2&) — pure `[out]`, untagged in OCCT
    [
      'Geom_Surface::Bounds(U1,U2,V1,V2) required',
      /\bBounds\(U1: number, U2: number, V1: number, V2: number\): \{ U1: number; U2: number; V1: number; V2: number \};/,
    ],
    // BRepTools / similar tessellation `Bounds(First,Last)` 1D variant
    [
      'Bounds(First,Last) required',
      /\bBounds\(First: number, Last: number\): \{ First: number; Last: number \};/,
    ],
    // BRep_Tool::Range(edge, First, Last) — pure `[out]`, untagged in OCCT
    [
      'BRep_Tool::Range(.., aFirst, aLast) required',
      /\bRange\(aFirst: number, aLast: number\): \{ aFirst: number; aLast: number \};/,
    ],
  ];

  for (const [label, regex] of canonicalSignatures) {
    it(`canonical RBV signature is required (no "?:"): ${label}`, () => {
      expect(regex.test(dts), `Expected /${regex.source}/ to match in ${path.basename(DTS_PATH)}`).toBe(true);
    });
  }

  // Inline RBV envelope return shape: `): { name: Type; … }` with the brace
  // block on a single line. Captures the body so we can scan its fields.
  const inlineEnvelopeRe = /\):\s*\{\s*([^}]+)\s*\}\s*;\s*$/gm;

  // OCCT concrete value classes that historically were mirrored into the
  // envelope by D1 (status quo). After R1 the bindgen mutates them in place
  // and drops them from the envelope; the dts must no longer surface them as
  // envelope fields. The list deliberately covers the highest-traffic
  // foundation classes touched by the smoke tests and the research doc's
  // canonical method enumeration; it is not exhaustive but is enough to
  // catch a class-output reintroduction by codegen drift.
  const FORBIDDEN_CLASS_ENVELOPE_FIELDS = [
    'gp_Pnt',
    'gp_Pnt2d',
    'gp_Vec',
    'gp_Vec2d',
    'gp_Pln',
    'gp_Lin',
    'gp_Dir',
    'gp_Ax1',
    'gp_Ax2',
    'gp_Ax3',
    'gp_XYZ',
    'gp_Trsf',
    'Bnd_Box',
    'Bnd_Box2d',
    'GProp_GProps',
    'Quantity_Color',
    'Quantity_ColorRGBA',
    'TopoDS_Shape',
    'TopoDS_Edge',
    'TopoDS_Face',
    'TopoDS_Vertex',
    'TopoDS_Wire',
    'TopoDS_Solid',
    'TopoDS_Compound',
    'TopoDS_Shell',
    'TopoDS_CompSolid',
    'TCollection_AsciiString',
    'TCollection_ExtendedString',
  ];

  it('no envelope mirrors a concrete class output as a non-return field (R1 regression guard)', () => {
    // R1 forbids echoing a class OUTPUT PARAMETER (mutated-in-place) inside
    // the envelope — those classes mutate the caller's argument in place, so
    // surfacing them again as an envelope field would be the misleading
    // "result mirrors thePlane" pattern the v3 redesign deleted.
    //
    // It does NOT forbid a C++ method whose native return type happens to be
    // one of these classes; that legitimately becomes `returnValue: <Class>`
    // inside a mixed envelope (R3/R4). Exclude the `returnValue` field from
    // the scan so we only flag class types appearing as *additional* envelope
    // members (which would indicate a regressed output-param echo).
    const violators: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = inlineEnvelopeRe.exec(dts)) !== null) {
      const body = match[1];
      if (!body) continue;
      const fields = body.split(';').map((s) => s.trim()).filter(Boolean);
      for (const field of fields) {
        const colon = field.indexOf(':');
        if (colon === -1) continue;
        const fieldName = field.slice(0, colon).trim();
        if (fieldName === 'returnValue') continue;
        const fieldType = field.slice(colon + 1).trim();
        if (FORBIDDEN_CLASS_ENVELOPE_FIELDS.includes(fieldType)) {
          violators.push(match[0].trim());
          break;
        }
      }
    }
    expect(
      violators,
      `Found ${violators.length} RBV envelopes that mirror a concrete class output param (R1 forbids this). First 5:\n${violators
        .slice(0, 5)
        .join('\n')}`,
    ).toHaveLength(0);
  });
});

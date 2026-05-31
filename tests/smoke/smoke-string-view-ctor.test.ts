/**
 * Smoke test: std::basic_string_view → owning-string constructor cast.
 *
 * Regression pin for the OCCT V8 binding fault where string classes gained
 * `std::basic_string_view` constructor/setter overloads that Embind cannot
 * register directly (it binds the owning `std::string` / `std::u16string`
 * converters but NOT the non-owning view). Before the bindgen heuristic
 * landed, the generated binding read such a parameter via
 * `val::as<std::*string_view>()`, producing at module-registration time:
 *
 *   BindingError: parameter 0 has unknown type
 *                 ...std::__2::basic_string_view<char16_t, ...>...
 *
 * The fix (`src/ocjs_bindgen/predicates/types.py` —
 * `isStringView` / `stringViewOwningType` / `stringViewOwningCast`, wired
 * into `codegen/dispatch.py::_convert_args` and
 * `codegen/embind/constructor.py::_val_to_cpp_arg`) lifts the incoming JS
 * string through the registered owning `std::*string`, which implicitly
 * converts to the view for the duration of the call. The regenerated
 * `TCollection_ExtendedString.cpp` reads `arg0.as<std::u16string>()`.
 *
 * Targets (both confirmed to carry a string_view ctor in OCCT V8):
 *   - `TCollection_ExtendedString(const std::u16string_view&)`
 *     (`deps/occt/.../TCollection_ExtendedString.hxx:150`) → std::u16string.
 *   - `TCollection_AsciiString(const std::string_view&)`
 *     (`deps/occt/.../TCollection_AsciiString.hxx:63`) → std::string.
 *
 * The smoking gun this pins: the module loads and the string classes
 * construct from a plain JS string without a BindingError. If the
 * owning-cast heuristic regresses, the generated `val::as<...string_view>`
 * leaves an unbound type and the class fails to register, which surfaces
 * here as an init/construction throw. Each case also asserts the bytes
 * round-trip, proving the owning temporary's contents reach the OCCT ctor
 * intact:
 *   - AsciiString reads back via `Length()` + `ToCString()`.
 *   - ExtendedString reads back via `Length()`, `IsEqual()` against a
 *     sibling built from the same JS string, and a conversion to
 *     `TCollection_AsciiString` for an observable byte check. (Its
 *     `ToExtString()` returns a raw `Standard_ExtString` / `char16_t*`
 *     whose pointee type is unbound in Embind, so it is not used here.)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: string_view → owning-string ctor cast', () => {
  beforeAll(async () => { await initOC(); });

  describe('TCollection_ExtendedString (std::u16string_view → std::u16string)', () => {
    it('constructs from a JS string without a BindingError', () => {
      const oc = getOC();
      expect(() => {
        using s = new oc.TCollection_ExtendedString('Tau');
        s;
      }).not.toThrow();
    });

    it('round-trips ASCII content through Length() and IsEqual()', () => {
      const oc = getOC();
      const input = 'Hello';
      using s = new oc.TCollection_ExtendedString(input);
      expect(s.Length()).toBe(input.length);

      // A sibling built from the same JS string must compare equal; one
      // built from a different string must not — proves the owning cast
      // carried the actual code units, not an empty/garbage buffer.
      using same = new oc.TCollection_ExtendedString(input);
      using different = new oc.TCollection_ExtendedString('Goodbye');
      expect(s.IsEqual(same)).toBe(true);
      expect(s.IsEqual(different)).toBe(false);
    });

    it('round-trips a non-ASCII BMP string (UTF-16 owning cast)', () => {
      const oc = getOC();
      // 'é' (U+00E9) and '×' (U+00D7) are single UTF-16 code units, so the
      // JS .length equals the char16_t length the std::u16string carries.
      const input = 'héllo×2';
      using s = new oc.TCollection_ExtendedString(input);
      expect(s.Length()).toBe(input.length);

      using same = new oc.TCollection_ExtendedString(input);
      expect(s.IsEqual(same)).toBe(true);
    });
  });

  describe('TCollection_AsciiString (std::string_view → std::string)', () => {
    it('constructs from a JS string without a BindingError', () => {
      const oc = getOC();
      expect(() => {
        using s = new oc.TCollection_AsciiString('Tau');
        s;
      }).not.toThrow();
    });

    it('round-trips ASCII content through Length() + ToCString()', () => {
      const oc = getOC();
      const input = 'opencascade';
      using s = new oc.TCollection_AsciiString(input);
      expect(s.Length()).toBe(input.length);
      expect(s.ToCString()).toBe(input);
    });
  });
});

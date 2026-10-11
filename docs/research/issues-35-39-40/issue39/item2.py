import clang.cindex as ci
stubs = "/home/user/opencascade.js/src/ocjs_bindgen/ast/parse_stubs"
for label, src in [
  ("emsdk-correct no-arg", "using namespace emscripten;\nEMSCRIPTEN_BINDINGS(x) { register_optional<double>(); }\n"),
  ("stub-shaped named", "using namespace emscripten;\nEMSCRIPTEN_BINDINGS(x) { register_optional<double>(\"OptD\"); }\n"),
]:
  tu = ci.Index.create().parse("b.cpp", ["-x","c++","-std=c++17","-nostdinc++","-D__EMSCRIPTEN__","-include","emscripten/bind.h","-I"+stubs], [["b.cpp", src]])
  errs = [str(d) for d in tu.diagnostics if d.severity >= ci.Diagnostic.Error]
  print(label, "errors:", errs)

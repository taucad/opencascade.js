"""Config-driven filter wrappers that monkey-patch the legacy filter modules.

Calling install(config) replaces the hardcoded filter functions in
filter/filterClasses.py, filter/filterMethodOrProperties.py, etc.
with config-driven versions. Semantic rules (AST-based checks) are preserved.
"""

import sys
import os
import clang.cindex

from ocjs_bindgen.config import BindgenConfig


def install(config: BindgenConfig):
    """Patch the legacy filter modules with config-driven filtering.

    Must be called before importing generateBindings / bindings / Common
    when possible (the python -m ocjs_bindgen entry point guarantees this).
    For late installation (e.g. generateBindings.py --config), also patches
    modules that have already bound the old filter functions.
    """

    filter_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if filter_dir not in sys.path:
        sys.path.insert(0, filter_dir)

    import filter.filterClasses as fc
    import filter.filterMethodOrProperties as fmp
    import filter.filterTypedefs as ft
    import filter.filterEnums as fe
    import filter.filterIncludeFiles as fi
    import filter.filterPackages as fp

    _orig_filterClass = fc.filterClass
    _orig_filterMethod = fmp.filterMethodOrProperty
    _orig_filterTypedef = ft.filterTypedef
    _orig_filterIncludeFile = fi.filterIncludeFile
    _orig_filterPackages = fp.filterPackages

    def config_filterClass(theClass, additionalInfo=None):
        if config.is_class_excluded(theClass.spelling):
            return False
        return _orig_filterClass(theClass, additionalInfo)

    def config_filterMethod(theClass, methodOrProperty):
        if config.is_method_excluded(theClass.spelling, methodOrProperty.spelling):
            return False
        return _orig_filterMethod(theClass, methodOrProperty)

    def config_filterTypedef(typedef, additionalInfo=None):
        if config.is_typedef_excluded(typedef.spelling):
            return False
        return _orig_filterTypedef(typedef, additionalInfo)

    def config_filterIncludeFile(filename):
        if config.is_header_excluded(filename):
            return False
        return _orig_filterIncludeFile(filename)

    def config_filterPackages(packageName):
        if config.is_package_excluded(packageName):
            return False
        return _orig_filterPackages(packageName)

    # Patch the filter modules
    fc.filterClass = config_filterClass
    fmp.filterMethodOrProperty = config_filterMethod
    ft.filterTypedef = config_filterTypedef
    fi.filterIncludeFile = config_filterIncludeFile
    fp.filterPackages = config_filterPackages

    # Patch modules that have already imported filter functions via
    # `from filter.X import Y` (creates a local binding that won't see
    # the module-level replacement above). Needed for late installation.
    if 'bindings' in sys.modules:
        sys.modules['bindings'].filterClass = config_filterClass
        sys.modules['bindings'].filterMethodOrProperty = config_filterMethod
    if 'TuInfo' in sys.modules:
        sys.modules['TuInfo'].filterTypedef = config_filterTypedef
    if 'Common' in sys.modules:
        sys.modules['Common'].filterIncludeFile = config_filterIncludeFile

    print(f"Bindgen filters installed from config: "
          f"{len(config.excluded_classes)} classes, "
          f"{len(config.excluded_class_prefixes)} class prefixes, "
          f"{len(config.excluded_methods)} class-method rules, "
          f"{len(config.excluded_global_methods)} global method rules, "
          f"{len(config.excluded_typedefs)} typedefs, "
          f"{len(config.excluded_headers)} headers, "
          f"{len(config.excluded_packages)} packages excluded",
          flush=True)

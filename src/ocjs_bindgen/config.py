"""Load and apply bindgen filter configuration from YAML."""

import os
import yaml
from typing import Dict, List, Set, Optional

_DEFAULT_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "bindgen-filters.yaml"
)

class BindgenConfig:
    """Holds parsed filter configuration for binding generation."""

    def __init__(self, config_path: Optional[str] = None):
        path = config_path or os.environ.get("OCJS_BINDGEN_CONFIG", _DEFAULT_CONFIG_PATH)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Bindgen config not found: {path}")

        raw = self._load_with_extends(path)
        exclude = raw.get("exclude", {})

        # Parse class exclusions into exact names and prefixes
        self.excluded_classes: Set[str] = set()
        self.excluded_class_prefixes: List[str] = []
        for item in exclude.get("classes", []):
            if isinstance(item, dict) and "prefix" in item:
                self.excluded_class_prefixes.append(item["prefix"])
            elif isinstance(item, str):
                self.excluded_classes.add(item)

        # Method exclusions: class -> set of method names (empty set = entire class)
        self.excluded_methods: Dict[str, Set[str]] = {}
        for cls, methods in exclude.get("methods", {}).items():
            self.excluded_methods[cls] = set(methods) if methods else set()

        # Typedef exclusions
        self.excluded_typedefs: Set[str] = set(exclude.get("typedefs", []))

        # Template typedef exclusions
        self.excluded_template_typedefs: Set[str] = set(exclude.get("template_typedefs", []))

        # Header exclusions
        self.excluded_headers: Set[str] = set(exclude.get("headers", []))

        # Global method exclusions (method name applies to all classes)
        self.excluded_global_methods: Set[str] = set(exclude.get("global_methods", []))

        # Package exclusions
        self.excluded_packages: Set[str] = set(exclude.get("packages", []))

        # Deprecated symbols
        deprecated = raw.get("deprecated", {})
        self.deprecated_include: bool = deprecated.get("include", True)
        self.deprecated_symbols: Set[str] = set(deprecated.get("symbols", []))

        if not self.deprecated_include:
            self.excluded_classes |= self.deprecated_symbols
            self.excluded_global_methods |= self.deprecated_symbols

    @staticmethod
    def _load_with_extends(path: str) -> dict:
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
        extends = raw.pop("extends", None)
        if extends:
            base_path = os.path.join(os.path.dirname(path), extends)
            if not os.path.exists(base_path):
                raise FileNotFoundError(f"Extended config not found: {base_path}")
            base = BindgenConfig._load_with_extends(base_path)
            BindgenConfig._deep_merge(base, raw)
            return base
        return raw

    @staticmethod
    def _deep_merge(base: dict, overlay: dict):
        """Recursively merge overlay into base, mutating base in place."""
        for key, val in overlay.items():
            if key in base and isinstance(base[key], dict) and isinstance(val, dict):
                BindgenConfig._deep_merge(base[key], val)
            else:
                base[key] = val

    def set_no_deprecated(self):
        """Exclude deprecated symbols regardless of YAML setting."""
        self.deprecated_include = False
        self.excluded_classes |= self.deprecated_symbols
        self.excluded_global_methods |= self.deprecated_symbols

    def is_class_excluded(self, name: str) -> bool:
        if name in self.excluded_classes:
            return True
        return any(name.startswith(p) for p in self.excluded_class_prefixes)

    def is_method_excluded(self, class_name: str, method_name: str) -> bool:
        if method_name in self.excluded_global_methods:
            return True
        if class_name not in self.excluded_methods:
            return False
        methods = self.excluded_methods[class_name]
        if not methods:
            return True  # empty set = entire class excluded
        return method_name in methods

    def is_typedef_excluded(self, name: str) -> bool:
        return name in self.excluded_typedefs

    def is_template_typedef_excluded(self, name: str) -> bool:
        return name in self.excluded_template_typedefs

    def is_header_excluded(self, filename: str) -> bool:
        return filename in self.excluded_headers

    def is_package_excluded(self, name: str) -> bool:
        return name in self.excluded_packages


# Singleton instance, loaded lazily
_config: Optional[BindgenConfig] = None

def get_config(config_path: Optional[str] = None) -> BindgenConfig:
    global _config
    if _config is None or config_path is not None:
        _config = BindgenConfig(config_path)
    return _config

"""TuInfo aggregator — caches the per-TU cursor collections used by every binder.

Phase 1 PR 1.2 of the OCJS Bindgen Modular Refactor extracted this class from
the monolithic `src/TuInfo.py`. Behaviour is preserved exactly: each field is
populated by the same generator function the legacy implementation called.

The class is intentionally a thin record — every collection is computed once
at construction so the binders can iterate without re-walking the cursor tree.
The split between `parse.py` (libclang TU build), `walker.py` (cursor tree
helpers), and `cursors.py` (TU-level aggregation) follows the dependency
boundary identified in the blueprint: `cursors.py` is the only consumer of
both `parse` and `walker`, mirroring how `TuInfo` was the only consumer of
the underlying functions in legacy code.
"""

from __future__ import annotations

from .parse import parse
from .walker import (
    allChildrenGenerator,
    classDict,
    enumGenerator,
    templateTypedefGenerator,
    typedefGenerator,
    underlyingDict,
    underlyingMultimap,
)


class TuInfo:
    """Aggregate of every cursor collection consumed by the binders."""

    def __init__(self, customCode: str):
        self.tu = parse(customCode)
        self.allChildren = allChildrenGenerator(self.tu)
        self.typedefs = typedefGenerator(self.tu)
        self.enums = enumGenerator(self.tu)
        self.templateTypedefs = templateTypedefGenerator(self.tu)
        self.classDict = classDict(self.tu)
        self.typedefUnderlyingDict = underlyingDict(self.typedefs, True)
        self.templateTypedefUnderlyingDict = underlyingDict(
            self.templateTypedefs, False
        )
        self.typedefUnderlyingMultimap = underlyingMultimap(self.typedefs, True)
        self.templateTypedefUnderlyingMultimap = underlyingMultimap(
            self.templateTypedefs, False
        )

"""Deterministic build timestamps shared by provenance producers."""

from __future__ import annotations

import os
from datetime import UTC, datetime


def build_datetime() -> datetime:
    raw = os.environ.get("SOURCE_DATE_EPOCH")
    if not raw:
        return datetime.now(UTC)
    if not raw.isdigit():
        raise ValueError("SOURCE_DATE_EPOCH must be a non-negative integer")
    return datetime.fromtimestamp(int(raw), UTC)

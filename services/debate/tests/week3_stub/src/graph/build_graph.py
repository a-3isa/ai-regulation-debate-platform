"""Persona storage location and the tag derivation the API re-uses.

`PERSONAS_DIR` is read from the environment here because the tests need it
inside a tmp_path; in the real Week 3 it is a module constant pointing at the
checkout.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

PERSONAS_DIR = Path(os.environ.get("STUB_PERSONAS_DIR", "/tmp/personas"))


def graph_config(*args: Any, **kwargs: Any) -> dict:  # pragma: no cover
    return {}


def load_personas(*args: Any, **kwargs: Any) -> dict:  # pragma: no cover
    return {}


def persona_stakeholder_tag(persona: Any) -> str:
    """The single highest-weighted affinity, or ValueError - Week 3's contract."""
    affinity = dict(getattr(getattr(persona, "retrieval", None), "affinity", {}) or {})
    if not affinity:
        raise ValueError("no affinity set")
    top = max(affinity.values())
    winners = [tag for tag, weight in affinity.items() if weight == top]
    if len(winners) != 1:
        raise ValueError("affinity is tied")
    return winners[0]

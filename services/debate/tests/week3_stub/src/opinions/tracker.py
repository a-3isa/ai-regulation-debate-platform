from __future__ import annotations

from typing import Any


def _noop(*args: Any, **kwargs: Any):  # pragma: no cover - never called
    return None


average_movement = _noop
discussion_converged = _noop
record_interactions = _noop
record_opinion = _noop
record_round_opinions = _noop
score_opinion_stance = _noop
seed_initial_opinions = _noop

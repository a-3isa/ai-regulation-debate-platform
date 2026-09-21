from __future__ import annotations

from typing import Any


def new_discussion_state(*args: Any, **kwargs: Any) -> dict:
    return {"messages": [], "opinions": {}, "retrieval_events": [], "rounds": []}

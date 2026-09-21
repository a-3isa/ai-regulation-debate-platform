from __future__ import annotations

import dataclasses
import uuid
from typing import Any


def new_discussion_id() -> str:
    return uuid.uuid4().hex[:12]


def save_discussion(*args: Any, **kwargs: Any) -> None:  # pragma: no cover
    return None


def _to_jsonable(obj: Any) -> Any:
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _to_jsonable(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    return obj

"""Application logging: one line per event, timestamped, with the id attached.

WHY THIS IS ITS OWN MODULE
Same reason as `app.saving`: `app.main` imports `app.runner`, which imports the
whole Week 3 tree at module scope, so nothing in main.py can be imported - let
alone unit-tested - without a Week 3 checkout on the path. Formatting is small
and worth testing on its own, so it lives here.

WHAT A LINE LOOKS LIKE
    2026-09-21 10:15:32 INFO  discussion_created run_id=abc123 rounds=5 topic="Should the AI Act ..."
    2026-09-21 10:16:03 INFO  analytics_requested run_id=abc123 round=2
    2026-09-21 10:16:07 ERROR analytics_failed run_id=abc123 reason="service unreachable"

Timestamp, level, event name, then `key=value` for the identifiers that make
the line worth keeping. Values containing spaces are quoted, so a line stays
greppable (`docker compose logs debate | grep run_id=abc123`) without needing a
parser, and long free text is truncated - a log line is a breadcrumb, not the
record. The record is the run's JSON on disk.

WHY NOT JSON LINES
Nothing here ships logs anywhere; they are read by a human running
`docker compose logs`, and by a reviewer checking that a sample request shows
up. `key=value` reads well in a terminal and greps the same as JSON does. If a
collector ever consumes these, swap the formatter here and nothing else moves.

ACCESS LOGS
`configure()` silences `uvicorn.access`, because the request middleware in
`app.main` logs the same requests with more in them (the run id, the duration,
the failures) in this format. One line per request, not two in two formats.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

#: Longest a single value may be before it is cut. Topics run to 300 characters
#: and error strings to whatever the provider felt like saying; neither belongs
#: in full on a line meant to be skimmed.
MAX_VALUE_CHARS = 120

LOG_FORMAT = "%(asctime)s %(levelname)-5s %(message)s"
LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"

#: Every logger in this service hangs off this name, so one line in `configure`
#: sets the level for all of them.
logger = logging.getLogger("debate")


def _render(value: Any) -> str:
    """One value, safe to put after an `=` on a line someone will grep."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "-"
    text = str(value).replace("\n", " ").replace("\r", " ").strip()
    if len(text) > MAX_VALUE_CHARS:
        text = text[: MAX_VALUE_CHARS - 1] + "…"
    if text == "":
        return '""'
    if any(c in text for c in ' "='):
        return '"' + text.replace('"', "'") + '"'
    return text


def format_event(event: str, **fields: Any) -> str:
    """`event key=value key=value`, in the order the caller wrote them."""
    if not fields:
        return event
    rendered = " ".join(f"{key}={_render(value)}" for key, value in fields.items())
    return f"{event} {rendered}"


def event(event_name: str, level: int = logging.INFO, **fields: Any) -> None:
    """Log one application event. Identifiers go in `fields`, not in the name."""
    logger.log(level, format_event(event_name, **fields))


def info(event_name: str, **fields: Any) -> None:
    event(event_name, logging.INFO, **fields)


def warning(event_name: str, **fields: Any) -> None:
    event(event_name, logging.WARNING, **fields)


def error(event_name: str, **fields: Any) -> None:
    event(event_name, logging.ERROR, **fields)


def configure(level: str | None = None) -> None:
    """Install the format on the root logger and align uvicorn's own loggers.

    Idempotent: importing this module twice, or a test calling it again, must
    not double every line.
    """
    resolved = (level or os.environ.get("LOG_LEVEL", "INFO")).upper()
    numeric = getattr(logging, resolved, logging.INFO)
    if not isinstance(numeric, int):
        numeric = logging.INFO

    root = logging.getLogger()
    handler = next(
        (h for h in root.handlers if getattr(h, "_debate_handler", False)), None
    )
    if handler is None:
        handler = logging.StreamHandler(sys.stdout)
        handler._debate_handler = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=LOG_DATEFMT))
    root.setLevel(numeric)
    logger.setLevel(numeric)

    # uvicorn installs its own handlers with its own format. Route its startup
    # and error lines through ours, and drop its access log: the request
    # middleware logs every request with the run id and the duration in it.
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
        uvicorn_logger.setLevel(numeric)
    access = logging.getLogger("uvicorn.access")
    access.handlers = []
    access.propagate = False

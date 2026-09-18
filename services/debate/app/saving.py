"""Coalescing writer for a run's on-disk record.

WHY THIS IS ITS OWN MODULE
`app.main` imports `app.runner`, which imports the whole Week 3 tree at module
scope, so nothing in main.py can be unit-tested without a Week 3 checkout on the
path. This class is fiddly enough to deserve tests - a timer, a lock and a
"has anything changed" flag - so it lives here, where a test can import it on
its own.
"""

from __future__ import annotations

import threading
import time
from typing import Callable, Optional


class SaveScheduler:
    """Coalesce a run's writes to at most one per *interval_seconds*.

    `Run.save()` serialises the entire record, including every event so far, so
    calling it on each event made a long debate quadratic in its own length -
    and did that work on the thread the user is waiting for.

    A request that arrives inside the window does not write; it schedules a
    single timer to write once the window closes, and any further requests
    before then are covered by that same pending write. So a burst of
    twenty events costs one write, the record is never more than a couple of
    seconds stale, and `flush()` exists for the moments where staleness is not
    acceptable: a terminal status, and process shutdown.
    """

    def __init__(self, write: Callable[[], None], interval_seconds: float):
        self._write = write
        self._interval = max(0.0, float(interval_seconds))
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._last_write = 0.0

    def request(self) -> None:
        now = time.monotonic()
        with self._lock:
            if self._timer is not None:
                # A write is already scheduled and will serialise the record as
                # it stands then, so this change is already covered.
                return
            due = self._last_write + self._interval
            if now >= due:
                self._last_write = now
                should_write_now = True
            else:
                self._timer = threading.Timer(due - now, self._on_timer)
                self._timer.daemon = True
                self._timer.start()
                should_write_now = False
        if should_write_now:
            self._write()

    def _on_timer(self) -> None:
        with self._lock:
            self._timer = None
            self._last_write = time.monotonic()
        self._write()

    def flush(self) -> None:
        """Write now, cancelling any pending timer. Used for terminal events."""
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._last_write = time.monotonic()
        self._write()

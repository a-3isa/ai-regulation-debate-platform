"""Tests for the coalescing writer.

Run from the service directory:  python -m pytest services/debate/tests -q

These are here because the thing being replaced - "write the whole record on
every event" - was obviously correct and quadratic, and the thing replacing it
is neither obviously correct nor obviously wrong. A timer, a lock, and a
last-write clock is exactly the kind of code that works on the happy path and
loses the final event.
"""

import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.saving import SaveScheduler  # noqa: E402


class Recorder:
    """Counts writes, thread-safely."""

    def __init__(self):
        self.count = 0
        self._lock = threading.Lock()

    def __call__(self):
        with self._lock:
            self.count += 1


def wait_until(predicate, timeout=2.0):
    """Poll rather than sleep a fixed amount, so the tests are not flaky."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def test_the_first_request_writes_immediately():
    """A run's first event must reach disk without waiting for a window."""
    recorder = Recorder()
    SaveScheduler(recorder, 0.2).request()
    assert recorder.count == 1


def test_a_burst_of_requests_costs_one_extra_write():
    """The whole point: 20 events in a round are not 20 serialisations."""
    recorder = Recorder()
    scheduler = SaveScheduler(recorder, 0.2)
    for _ in range(20):
        scheduler.request()
    assert recorder.count == 1, "requests inside the window must not each write"
    assert wait_until(lambda: recorder.count == 2), "the pending write never happened"
    time.sleep(0.25)
    assert recorder.count == 2, "the window must not keep firing"


def test_the_last_change_in_a_burst_is_not_lost():
    """The failure that would matter: a debate's final message never written."""
    written = []
    state = {"events": 0}
    scheduler = SaveScheduler(lambda: written.append(state["events"]), 0.15)

    scheduler.request()          # writes 0 immediately
    state["events"] = 1
    scheduler.request()          # schedules
    state["events"] = 2
    scheduler.request()          # covered by the same scheduled write

    assert wait_until(lambda: len(written) == 2)
    assert written[-1] == 2, "the scheduled write must serialise the LATEST state"


def test_flush_writes_now_and_cancels_the_pending_timer():
    recorder = Recorder()
    scheduler = SaveScheduler(recorder, 0.3)
    scheduler.request()   # immediate
    scheduler.request()   # schedules a write
    scheduler.flush()
    assert recorder.count == 2
    time.sleep(0.4)
    assert recorder.count == 2, "flush must cancel the timer, not race it"


def test_flush_alone_always_writes():
    """Terminal events call flush directly and must never be coalesced away."""
    recorder = Recorder()
    scheduler = SaveScheduler(recorder, 5.0)
    scheduler.flush()
    scheduler.flush()
    assert recorder.count == 2


def test_a_zero_interval_writes_every_time():
    """Setting DEBATE_SAVE_INTERVAL=0 restores the old write-always behaviour."""
    recorder = Recorder()
    scheduler = SaveScheduler(recorder, 0.0)
    for _ in range(5):
        scheduler.request()
    assert recorder.count == 5


def test_a_negative_interval_is_treated_as_zero():
    recorder = Recorder()
    SaveScheduler(recorder, -3.0).request()
    assert recorder.count == 1


def test_requests_from_many_threads_do_not_lose_the_final_state():
    """The debate thread and the analytics pool both append events."""
    state = {"events": 0}
    written = []
    lock = threading.Lock()

    def write():
        with lock:
            written.append(state["events"])

    scheduler = SaveScheduler(write, 0.05)

    def worker():
        for _ in range(20):
            with lock:
                state["events"] += 1
            scheduler.request()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    scheduler.flush()

    assert written, "nothing was written at all"
    assert written[-1] == 80, "the flush must capture every event appended"
    assert len(written) < 80, "coalescing did nothing"

"""Import `app.main` without a Week 3 checkout, a container or a network.

Three things have to be true before that import can succeed, and all three are
set here, before `app.main` is imported anywhere:

1. `WEEK3_ROOT` points at `week3_stub/`, so `app.runner`'s own path insertion
   finds a `src` package with the names it imports. See `week3_stub/src/__init__`
   for what that package is and is not.
2. Every directory the service writes to is a tmp_path, so a test run cannot
   touch `/data` or a real personas volume.
3. `ANALYTICS_URL` points nowhere reachable. Nothing here should reach the Week
   4 service; a test that accidentally does gets a connection error, not a
   silent dependency on a container being up.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
SERVICE_DIR = TESTS_DIR.parent

#: `app` itself.
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))


def pytest_configure(config):  # noqa: ARG001
    """Set the environment before any test module imports `app.main`."""
    scratch = Path(config.invocation_params.dir) / ".pytest-debate"
    personas = scratch / "personas"
    personas.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("WEEK3_ROOT", str(TESTS_DIR / "week3_stub"))
    os.environ.setdefault("STUB_PERSONAS_DIR", str(personas))
    os.environ.setdefault("PERSONA_DEFAULTS_DIR", str(scratch / "personas-defaults"))
    os.environ.setdefault("DEBATE_RUNS_DIR", str(scratch / "runs"))
    os.environ.setdefault("DEBATE_OUTPUT_DIR", str(scratch / "discussions"))
    os.environ.setdefault("ANALYTICS_URL", "http://analytics.invalid:8000")
    os.environ.setdefault("AGENT_LLM_STUB", "1")


@pytest.fixture()
def main():
    """The imported `app.main`, with its run registry empty for this test.

    The analytics pool is replaced each time because the app's shutdown handler
    shuts it down - correct for a process that starts and stops once, which is
    what production is, and wrong for a harness that starts the app per test.
    Without this, the second test to start a run gets "cannot schedule new
    futures after shutdown" from the pool the first test closed.
    """
    import concurrent.futures

    import app.main as main_module

    main_module._analytics_pool = concurrent.futures.ThreadPoolExecutor(
        max_workers=2, thread_name_prefix="analytics-test"
    )
    main_module.RUNS.clear()
    yield main_module
    main_module.RUNS.clear()
    main_module._analytics_pool.shutdown(wait=False, cancel_futures=True)


@pytest.fixture()
def client(main):
    """A TestClient that has completed startup, so the startup log has run."""
    from fastapi.testclient import TestClient

    with TestClient(main.app) as test_client:
        yield test_client

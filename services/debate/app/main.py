"""HTTP + SSE front door for the live debate platform.

    POST   /runs                 start a debate      {topic, num_rounds, strategy}
    GET    /runs                 list runs in this process
    GET    /runs/{id}            status + discussion + latest analytics
    GET    /runs/{id}/stream     Server-Sent Events, replayed from the start
    GET    /runs/{id}/report     Markdown report + analytics (final)
    GET    /runs/{id}/charts     both Week 4 charts as base64 PNGs (final)
    DELETE /runs/{id}            ask a running debate to stop after this turn
    GET    /health

WHY SSE AND NOT WEBSOCKETS
--------------------------
The stream is one-directional - the server narrates, the browser listens - and
SSE reconnects on its own, is plain HTTP (so it passes through Traefik with no
extra configuration), and needs no client library. `GET /runs/{id}/stream`
replays every event from the beginning before following the live tail, so a
browser that connects late, or reconnects, still renders the whole debate.

WHERE THE ANALYTICS COME FROM
-----------------------------
This service never computes a metric. After every round it POSTs the
in-progress discussion to the Week 4 analytics service
(`POST /inline/analytics`) and forwards the result as an `analytics` event, so
the numbers on screen are the same Week 4 code that produces the committed
reports - not a second implementation that could drift.

A debate runs in a worker thread because Week 3's turn logic is synchronous and
network-bound (LLM + retrieval calls). One thread per active run, capped by
DEBATE_MAX_CONCURRENT_RUNS.

WHAT GETS LOGGED
----------------
`app.logs` formats one timestamped line per event, with the run id on it:
startup, every request (method, path, status, duration), every debate created,
retrieved, cancelled, completed or failed, every analytics/report/chart call,
and every member edit. Failures log at ERROR, so `docker compose logs debate |
grep ERROR` is the whole triage story, and `grep run_id=abc123` is one debate
end to end. `LOG_LEVEL` sets the threshold. uvicorn's own access log is
silenced in `logs.configure`, because the middleware here logs the same
requests with more in them.

TWO THINGS THAT USED TO SIT IN THE DEBATE'S WAY
-----------------------------------------------
Both of these were latency the user waited through for no reason.

1. THE PER-ROUND ANALYTICS CALL BLOCKED THE NEXT ROUND. `on_round` is invoked
   from inside the debate loop, and it POSTed the whole discussion to the Week 4
   service and waited - up to its 120-second timeout - before round N+1 could
   start. Nothing in the debate depends on the answer: the analytics are for the
   dashboard, and they arrive on the stream whenever they are ready. So the call
   now happens on a small background pool and the loop returns immediately.

2. EVERY MESSAGE REWROTE THE WHOLE RUN. `save()` serialises the entire event
   log, and it ran on every persisted event - so a debate with N events did
   O(N^2) work in JSON, on the debate thread, growing as the debate went on. The
   writes are now coalesced by `_SaveScheduler`, which is the same durability
   guarantee (nothing is lost that was not already at risk) at a bounded cost,
   with terminal events still written synchronously.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import logs
from app.saving import SaveScheduler
from app.runner import (
    MAX_ROUNDS,
    PARALLEL_TURNS,
    SEED_CONCURRENCY,
    RunConfig,
    run_debate,
)
from app.personas import build_router as build_persona_router

try:  # Week 3's own JSON conversion, so a record from this service and one
    # from its CLI are byte-identical in shape.
    from src.persistence.store import _to_jsonable as to_jsonable  # type: ignore
except Exception:  # pragma: no cover - fallback if Week 3 renames it
    import dataclasses

    def to_jsonable(obj: Any) -> Any:
        if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
            return {k: to_jsonable(v) for k, v in dataclasses.asdict(obj).items()}
        if isinstance(obj, dict):
            return {k: to_jsonable(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [to_jsonable(v) for v in obj]
        return obj


ANALYTICS_URL = os.environ.get("ANALYTICS_URL", "http://analytics:8000").rstrip("/")
MAX_CONCURRENT_RUNS = int(os.environ.get("DEBATE_MAX_CONCURRENT_RUNS", "2"))

#: Shortest gap between two writes of the same run, in seconds. A debate emits
#: an event every few seconds at most, and each write serialises the whole event
#: log, so coalescing at this interval turns O(events^2) of JSON into a bounded
#: trickle. What is at stake if the process dies inside the window is at most
#: this many seconds of a record that was never a database in the first place.
SAVE_INTERVAL_SECONDS = float(os.environ.get("DEBATE_SAVE_INTERVAL", "2.0"))

#: Background workers for the per-round analytics call. Two runs can be in
#: flight (MAX_CONCURRENT_RUNS) and each wants at most one analytics request at
#: a time, so this only has to keep up with that.
_analytics_pool = concurrent.futures.ThreadPoolExecutor(
    max_workers=max(2, MAX_CONCURRENT_RUNS), thread_name_prefix="analytics"
)

#: Where every run's events and final state are written, so a restart of this
#: service does not silently erase debates. Must be a mounted volume.
RUNS_DIR = Path(os.environ.get("DEBATE_RUNS_DIR", "/data/runs"))

#: Statuses after which a run will never change again.
TERMINAL_STATUSES = ("completed", "converged", "failed", "cancelled", "interrupted")
_DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

logs.configure()

app = FastAPI(title="AI Regulation Debate Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.environ.get("DEBATE_CORS_ORIGINS", _DEFAULT_ORIGINS).split(",")
        if o.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# --- request logging -------------------------------------------------------
#
# One line per request, replacing uvicorn's access log (silenced in
# `logs.configure`) because this one carries the run id and the duration, and a
# failure logs at ERROR so `grep ERROR` finds it. A request that raises before
# a response exists is logged too - otherwise the only trace of the request
# that killed a worker would be the traceback, with no path and no id on it.


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    started = time.monotonic()
    # `run_id` is the identifier worth having on almost every line here, and the
    # router has not matched yet, so take it off the path.
    run_id = request.path_params.get("run_id") or _run_id_from_path(request.url.path)
    try:
        response = await call_next(request)
    except Exception as exc:  # noqa: BLE001 - log, then let the handler answer
        logs.error(
            "request_failed",
            method=request.method,
            path=request.url.path,
            run_id=run_id,
            duration_ms=round((time.monotonic() - started) * 1000),
            reason=str(exc),
        )
        raise
    logs.event(
        "request",
        logging.ERROR if response.status_code >= 500 else logging.INFO,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        run_id=run_id,
        duration_ms=round((time.monotonic() - started) * 1000),
    )
    return response


def _run_id_from_path(path: str) -> Optional[str]:
    """`/runs/abc123/stream` -> `abc123`; anything else -> None."""
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2 and parts[0] == "runs":
        return parts[1]
    return None


# --- run registry ----------------------------------------------------------


class Run:
    """One debate: its events, its state, and the thread running it.

    Events are kept in a list rather than a queue because every stream replays
    from event 0 - a browser that opens the page mid-debate, or reconnects
    after a dropped connection, must still see the whole thing.
    """

    def __init__(self, run_id: str, config: RunConfig):
        self.run_id = run_id
        self.config = config
        self.status = "pending"
        self.error: Optional[str] = None
        self.events: list[dict] = []
        self.state: dict = {}
        self.analytics: Optional[dict] = None
        #: Which round `analytics` came from, so a slow round cannot overwrite a
        #: later one that already came back.
        self.analytics_round: int = -1
        #: Per-round analytics calls still in flight, awaited before the final
        #: report so the last one cannot land after it.
        self.pending_analytics: list = []
        self.discussion_id: Optional[str] = None
        self.cancelled = threading.Event()
        # Set by the worker only after its LAST event is appended. The stream
        # must not close on `status` alone: the worker sets a terminal status
        # before it emits the final report/run_complete events, so a stream
        # watching `status` can hang up a beat too early and lose them.
        self.complete = threading.Event()
        self.lock = threading.Lock()
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.finished_at: Optional[str] = None
        self._saver = SaveScheduler(self.save, SAVE_INTERVAL_SECONDS)

    #: Event types after which the run is written to disk. Every message is
    #: included: a debate interrupted mid-round should still show what was said.
    PERSIST_ON = frozenset(
        {"run_started", "message", "opinion", "round_complete", "analytics",
         "report", "run_complete", "run_failed"}
    )

    #: ...and of those, the ones that must be on disk before the call returns.
    #: Everything else is coalesced by `_SaveScheduler`; these are the last
    #: events a run will ever emit, so there is no later write to fold them into.
    PERSIST_NOW = frozenset({"run_complete", "run_failed", "report"})

    def append(self, event_type: str, payload: dict) -> None:
        with self.lock:
            self.events.append(
                {
                    "seq": len(self.events),
                    "type": event_type,
                    "at": datetime.now(timezone.utc).isoformat(),
                    "data": payload,
                }
            )
        if event_type in self.PERSIST_NOW:
            self._saver.flush()
        elif event_type in self.PERSIST_ON:
            self._saver.request()

    # --- persistence ---------------------------------------------------------
    #
    # WHY THIS EXISTS
    # Runs used to live only in this process's memory. Recreating the container
    # during a deploy therefore killed any debate in progress AND erased it: the
    # browser kept retrying a stream for a run that no longer existed and sat on
    # "has the floor" indefinitely. A worker thread cannot survive a process
    # restart, but the record can - so every meaningful event writes the run to
    # disk, and startup restores it, marking an unfinished one `interrupted`
    # rather than letting it disappear.

    def to_record(self) -> dict:
        with self.lock:
            events = list(self.events)
        return {
            "run_id": self.run_id,
            "config": {
                "topic": self.config.topic,
                "num_rounds": self.config.num_rounds,
                "strategy": self.config.strategy,
                "proposition": self.config.proposition,
                "stop_on_convergence": self.config.stop_on_convergence,
            },
            "status": self.status,
            "error": self.error,
            "discussion_id": self.discussion_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "analytics": self.analytics,
            "state": self.state,
            "events": events,
        }

    def save(self) -> None:
        """Write the run atomically. A failed write never harms the debate."""
        try:
            RUNS_DIR.mkdir(parents=True, exist_ok=True)
            target = RUNS_DIR / f"{self.run_id}.json"
            temp = target.with_suffix(".json.tmp")
            temp.write_text(json.dumps(self.to_record()), encoding="utf-8")
            os.replace(temp, target)
        except Exception as exc:  # noqa: BLE001
            logs.error("run_not_persisted", run_id=self.run_id, reason=str(exc))

    @classmethod
    def from_record(cls, record: dict) -> "Run":
        cfg = record.get("config") or {}
        run = cls(
            record["run_id"],
            RunConfig(
                topic=cfg.get("topic", ""),
                num_rounds=cfg.get("num_rounds", 3),
                strategy=cfg.get("strategy", "ring"),
                proposition=cfg.get("proposition"),
                stop_on_convergence=cfg.get("stop_on_convergence", True),
            ),
        )
        run.status = record.get("status", "interrupted")
        run.error = record.get("error")
        run.discussion_id = record.get("discussion_id")
        run.started_at = record.get("started_at") or run.started_at
        run.finished_at = record.get("finished_at")
        run.analytics = record.get("analytics")
        run.state = record.get("state") or {}
        run.events = record.get("events") or []
        return run

    def events_after(self, seq: int) -> list[dict]:
        with self.lock:
            return self.events[seq:]

    def summary(self) -> dict:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "topic": self.config.topic,
            "num_rounds": self.config.num_rounds,
            "strategy": self.config.strategy,
            "discussion_id": self.discussion_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "event_count": len(self.events),
        }


RUNS: dict[str, Run] = {}


def _restore_runs() -> None:
    """Load every persisted run. One that was still going when the process
    stopped is marked `interrupted`, with the reason, so the UI shows a closed
    session instead of a speaker stuck on the floor forever."""
    if not RUNS_DIR.exists():
        return
    for path in sorted(RUNS_DIR.glob("*.json")):
        try:
            run = Run.from_record(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:  # noqa: BLE001 - one bad file must not block startup
            logs.error("run_restore_failed", file=path.name, reason=str(exc))
            continue
        if run.status not in TERMINAL_STATUSES:
            run.status = "interrupted"
            run.error = (
                "The debate service restarted while this session was in progress. "
                "Everything said up to that point is preserved; the session cannot resume."
            )
            run.finished_at = run.finished_at or datetime.now(timezone.utc).isoformat()
            run.events.append(
                {
                    "seq": len(run.events),
                    "type": "run_failed",
                    "at": run.finished_at,
                    "data": {"error": run.error, "status": "interrupted"},
                }
            )
            run.save()
            logs.warning("run_interrupted", run_id=run.run_id, events=len(run.events))
        run.complete.set()
        RUNS[run.run_id] = run
    logs.info("runs_restored", count=len(RUNS), dir=str(RUNS_DIR))


_restore_runs()


def _active_runs() -> int:
    return sum(1 for r in RUNS.values() if r.status in ("pending", "running"))


# Persona management. Writes are refused while a debate is running.
app.include_router(build_persona_router(lambda: _active_runs()))


def _get_run(run_id: str) -> Run:
    run = RUNS.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"No run {run_id}.")
    return run


# --- analytics service client ---------------------------------------------


def _post_analytics(path: str, discussion: dict, timeout: float = 120.0) -> dict:
    """POST a discussion to the Week 4 service and return its JSON."""
    response = httpx.post(f"{ANALYTICS_URL}{path}", json=discussion, timeout=timeout)
    if response.status_code == 422:
        # The record is not analysable yet (an early round can legitimately be
        # incomplete). Surface it as data, not as a crashed run.
        raise ValueError(response.json().get("detail", "discussion failed validation"))
    response.raise_for_status()
    return response.json()


def _worker(run: Run) -> None:
    """Run the debate to completion in this thread, recording every event."""
    run.status = "running"

    def emit(event_type: str, payload: dict) -> None:
        run.append(event_type, payload)

    def on_round(state: dict, round_number: int) -> None:
        """Ask Week 4 for this round's metrics WITHOUT making round N+1 wait.

        The debate does not read the answer - the analytics exist for the
        dashboard, and they reach it over the stream whenever they are ready.
        Called inline, this blocked the next round for as long as the analytics
        service took, up to a two-minute timeout, on every round.

        The discussion is serialised here, on the debate thread, deliberately:
        `state` keeps being mutated by the next round, so a background thread
        reading it later would serialise a moving target. `to_jsonable` is
        in-process work measured in milliseconds; the HTTP call it feeds is the
        part worth moving, and that is what gets handed to the pool.
        """
        discussion = to_jsonable(state)

        def work() -> None:
            logs.info("analytics_requested", run_id=run.run_id, round=round_number)
            try:
                analytics = _post_analytics("/inline/analytics", discussion)
            except ValueError as exc:
                logs.warning(
                    "analytics_rejected",
                    run_id=run.run_id,
                    round=round_number,
                    reason=str(exc),
                )
                run.append(
                    "analytics_unavailable",
                    {"round": round_number, "reason": str(exc)},
                )
                return
            except Exception as exc:  # noqa: BLE001 - analytics must not kill a debate
                logs.error(
                    "analytics_failed",
                    run_id=run.run_id,
                    round=round_number,
                    reason=str(exc),
                )
                run.append(
                    "analytics_unavailable",
                    {"round": round_number, "reason": f"analytics service unreachable: {exc}"},
                )
                return
            # Rounds are dispatched in order and each run has one worker, but a
            # slow round N could still land after N+1; keep the newest.
            with run.lock:
                if round_number >= run.analytics_round:
                    run.analytics = analytics
                    run.analytics_round = round_number
            run.append("analytics", {"round": round_number, "analytics": analytics})

        run.pending_analytics.append(_analytics_pool.submit(work))

    try:
        state = run_debate(run.config, emit, cancelled=run.cancelled, on_round=on_round)
        run.state = to_jsonable(state)
        run.discussion_id = run.state.get("discussion_id")
        run.status = run.state.get("status", "completed")
        run.save()

        # Let any round-level analytics still in flight finish first. They are
        # older than the final report, so if one landed after it the dashboard
        # would end up showing round 4's numbers next to the closing report.
        concurrent.futures.wait(run.pending_analytics, timeout=30.0)

        # Final pass: the report and charts are Week 4's, computed once at the
        # end from the finished record.
        try:
            report = _post_analytics("/inline/report", run.state, timeout=180.0)
            run.analytics = report.get("analytics", run.analytics)
            run.analytics_round = 10**6  # the final word; no round may replace it
            run.append(
                "report",
                {"markdown": report.get("markdown", ""), "analytics": run.analytics},
            )
        except Exception as exc:  # noqa: BLE001
            logs.error("report_failed", run_id=run.run_id, reason=str(exc))
            run.append("notice", {"message": f"final report unavailable: {exc}"})

        run.append("run_complete", {"status": run.status, "discussion_id": run.discussion_id})
        logs.info(
            "discussion_completed",
            run_id=run.run_id,
            status=run.status,
            discussion_id=run.discussion_id,
            events=len(run.events),
        )
    except Exception as exc:  # noqa: BLE001 - the run failed; say so on the stream
        run.status = "failed"
        run.error = str(exc)
        logs.error("discussion_failed", run_id=run.run_id, reason=str(exc))
        run.append("run_failed", {"error": str(exc)})
    finally:
        run.finished_at = datetime.now(timezone.utc).isoformat()
        run.save()
        run.complete.set()


# --- request models --------------------------------------------------------


class StartRunRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    num_rounds: int = Field(3, ge=1, le=MAX_ROUNDS)
    strategy: str = Field("ring", pattern="^(ring|mesh)$")
    proposition: Optional[str] = Field(None, max_length=500)
    stop_on_convergence: bool = True
    #: Member ids to seat. Omitted = every member on file.
    agents: Optional[list[str]] = Field(None, max_length=8)


# --- routes ----------------------------------------------------------------


@app.on_event("startup")
def _log_startup() -> None:
    """The one line that says what this process is, before any request."""
    logs.info(
        "application_started",
        version=app.version,
        analytics_url=ANALYTICS_URL,
        max_rounds=MAX_ROUNDS,
        max_concurrent_runs=MAX_CONCURRENT_RUNS,
        llm_model=os.environ.get("OPENROUTER_MODEL", "(unset)"),
        llm_stubbed=os.environ.get("AGENT_LLM_STUB", "0") == "1",
        runs_dir=str(RUNS_DIR),
    )


@app.on_event("shutdown")
def _flush_on_shutdown() -> None:
    """Write every run before the process goes, and stop the analytics pool.

    Saves are coalesced, so without this a redeploy could drop the last couple
    of seconds of a debate that was about to be marked interrupted anyway - but
    the events are what the UI replays, and losing them for no reason is worse
    than a slightly slower shutdown.
    """
    for run in list(RUNS.values()):
        try:
            run._saver.flush()
        except Exception as exc:  # noqa: BLE001 - shutdown must not raise
            logs.error("run_not_flushed", run_id=run.run_id, reason=str(exc))
    _analytics_pool.shutdown(wait=False, cancel_futures=True)


@app.get("/health")
def health():
    analytics_ok = False
    try:
        analytics_ok = httpx.get(f"{ANALYTICS_URL}/health", timeout=5.0).status_code == 200
    except Exception:  # noqa: BLE001 - reporting the dependency is the point
        analytics_ok = False
    return {
        "status": "ok",
        "analytics_reachable": analytics_ok,
        "active_runs": _active_runs(),
        "max_rounds": MAX_ROUNDS,
        # The latency-relevant configuration, so a deployment can be checked
        # without shelling into the container.
        "llm_model": os.environ.get("OPENROUTER_MODEL", "(unset)"),
        "seed_concurrency": SEED_CONCURRENCY,
        "parallel_turns": PARALLEL_TURNS,
    }


@app.post("/runs", status_code=202)
def start_run(request: StartRunRequest):
    """Start a debate and return immediately; follow it on /runs/{id}/stream."""
    if _active_runs() >= MAX_CONCURRENT_RUNS:
        raise HTTPException(
            status_code=429,
            detail=f"{MAX_CONCURRENT_RUNS} debates are already running; try again shortly.",
        )

    try:
        config = RunConfig(
            topic=request.topic,
            num_rounds=request.num_rounds,
            strategy=request.strategy,
            proposition=request.proposition,
            stop_on_convergence=request.stop_on_convergence,
            agents=request.agents,
        ).validated()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    run = Run(uuid.uuid4().hex[:12], config)
    RUNS[run.run_id] = run

    logs.info(
        "discussion_created",
        run_id=run.run_id,
        rounds=config.num_rounds,
        strategy=config.strategy,
        agents=len(config.agents) if config.agents else "all",
        topic=config.topic,
    )
    threading.Thread(target=_worker, args=(run,), daemon=True, name=f"debate-{run.run_id}").start()
    return {"run_id": run.run_id, "stream": f"/runs/{run.run_id}/stream", **run.summary()}


@app.get("/runs")
def list_runs():
    return {"runs": [r.summary() for r in RUNS.values()]}


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    run = _get_run(run_id)
    logs.info("discussion_retrieved", run_id=run_id, status=run.status, events=len(run.events))
    return {**run.summary(), "discussion": run.state or None, "analytics": run.analytics}


@app.delete("/runs/{run_id}")
def cancel_run(run_id: str):
    run = _get_run(run_id)
    run.cancelled.set()
    logs.info("discussion_cancel_requested", run_id=run_id, status=run.status)
    return {"run_id": run_id, "cancelling": run.status in ("pending", "running")}


@app.get("/runs/{run_id}/report")
def get_report(run_id: str):
    run = _get_run(run_id)
    if not run.state:
        raise HTTPException(status_code=409, detail="The debate has not finished yet.")
    logs.info("report_requested", run_id=run_id)
    try:
        return _post_analytics("/inline/report", run.state, timeout=180.0)
    except ValueError as exc:
        logs.warning("report_rejected", run_id=run_id, reason=str(exc))
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/runs/{run_id}/charts")
def get_charts(run_id: str):
    """Week 4's opinion trajectory and interaction graph, as base64 PNGs."""
    run = _get_run(run_id)
    if not run.state:
        raise HTTPException(status_code=409, detail="The debate has not finished yet.")
    logs.info("charts_requested", run_id=run_id)
    try:
        return _post_analytics("/inline/visualizations", run.state, timeout=180.0)
    except ValueError as exc:
        logs.warning("charts_rejected", run_id=run_id, reason=str(exc))
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/runs/{run_id}/discussion")
def get_discussion(run_id: str):
    """The raw Week 3 record, the same shape Week 4's CLI consumes."""
    run = _get_run(run_id)
    if not run.state:
        raise HTTPException(status_code=409, detail="The debate has not finished yet.")
    return run.state


@app.get("/runs/{run_id}/stream")
async def stream(run_id: str):
    """Server-Sent Events for one run, replayed from the beginning."""
    run = _get_run(run_id)
    logs.info("stream_opened", run_id=run_id, status=run.status, events=len(run.events))

    async def event_source():
        sent = 0
        idle = 0.0
        while True:
            pending = run.events_after(sent)
            if pending:
                idle = 0.0
                for event in pending:
                    sent = event["seq"] + 1
                    yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
            else:
                if run.complete.is_set():
                    # Everything buffered has been sent and nothing more is coming.
                    # Same envelope as every other event, so one parser handles all.
                    envelope = {
                        "seq": sent,
                        "type": "stream_end",
                        "at": datetime.now(timezone.utc).isoformat(),
                        "data": run.summary(),
                    }
                    yield f"event: stream_end\ndata: {json.dumps(envelope)}\n\n"
                    return
                await asyncio.sleep(0.4)
                idle += 0.4
                if idle >= 15.0:
                    idle = 0.0
                    # Keep intermediaries from closing an idle connection while
                    # an agent is waiting on a slow LLM call.
                    yield ": keep-alive\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx/Traefik: do not buffer the stream
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8100")))

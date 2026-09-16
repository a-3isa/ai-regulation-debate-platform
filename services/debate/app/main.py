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
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.runner import MAX_ROUNDS, RunConfig, run_debate

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
_DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"

app = FastAPI(title="AI Regulation Debate Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.environ.get("DEBATE_CORS_ORIGINS", _DEFAULT_ORIGINS).split(",")
        if o.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


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


def _active_runs() -> int:
    return sum(1 for r in RUNS.values() if r.status in ("pending", "running"))


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
        discussion = to_jsonable(state)
        try:
            analytics = _post_analytics("/inline/analytics", discussion)
        except ValueError as exc:
            run.append(
                "analytics_unavailable",
                {"round": round_number, "reason": str(exc)},
            )
            return
        except Exception as exc:  # noqa: BLE001 - analytics must not kill a debate
            run.append(
                "analytics_unavailable",
                {"round": round_number, "reason": f"analytics service unreachable: {exc}"},
            )
            return
        run.analytics = analytics
        run.append("analytics", {"round": round_number, "analytics": analytics})

    try:
        state = run_debate(run.config, emit, cancelled=run.cancelled, on_round=on_round)
        run.state = to_jsonable(state)
        run.discussion_id = run.state.get("discussion_id")
        run.status = run.state.get("status", "completed")

        # Final pass: the report and charts are Week 4's, computed once at the
        # end from the finished record.
        try:
            report = _post_analytics("/inline/report", run.state, timeout=180.0)
            run.analytics = report.get("analytics", run.analytics)
            run.append(
                "report",
                {"markdown": report.get("markdown", ""), "analytics": run.analytics},
            )
        except Exception as exc:  # noqa: BLE001
            run.append("notice", {"message": f"final report unavailable: {exc}"})

        run.append("run_complete", {"status": run.status, "discussion_id": run.discussion_id})
    except Exception as exc:  # noqa: BLE001 - the run failed; say so on the stream
        run.status = "failed"
        run.error = str(exc)
        run.append("run_failed", {"error": str(exc)})
    finally:
        run.finished_at = datetime.now(timezone.utc).isoformat()
        run.complete.set()


# --- request models --------------------------------------------------------


class StartRunRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=300)
    num_rounds: int = Field(3, ge=1, le=MAX_ROUNDS)
    strategy: str = Field("ring", pattern="^(ring|mesh)$")
    proposition: Optional[str] = Field(None, max_length=500)
    stop_on_convergence: bool = True


# --- routes ----------------------------------------------------------------


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
        ).validated()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    run = Run(uuid.uuid4().hex[:12], config)
    RUNS[run.run_id] = run

    threading.Thread(target=_worker, args=(run,), daemon=True, name=f"debate-{run.run_id}").start()
    return {"run_id": run.run_id, "stream": f"/runs/{run.run_id}/stream", **run.summary()}


@app.get("/runs")
def list_runs():
    return {"runs": [r.summary() for r in RUNS.values()]}


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    run = _get_run(run_id)
    return {**run.summary(), "discussion": run.state or None, "analytics": run.analytics}


@app.delete("/runs/{run_id}")
def cancel_run(run_id: str):
    run = _get_run(run_id)
    run.cancelled.set()
    return {"run_id": run_id, "cancelling": run.status in ("pending", "running")}


@app.get("/runs/{run_id}/report")
def get_report(run_id: str):
    run = _get_run(run_id)
    if not run.state:
        raise HTTPException(status_code=409, detail="The debate has not finished yet.")
    try:
        return _post_analytics("/inline/report", run.state, timeout=180.0)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/runs/{run_id}/charts")
def get_charts(run_id: str):
    """Week 4's opinion trajectory and interaction graph, as base64 PNGs."""
    run = _get_run(run_id)
    if not run.state:
        raise HTTPException(status_code=409, detail="The debate has not finished yet.")
    try:
        return _post_analytics("/inline/visualizations", run.state, timeout=180.0)
    except ValueError as exc:
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

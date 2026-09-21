"""The unified API's contract, checked without a container or a network.

These are the acceptance checks the Week 5 brief asks for at the API level: a
reviewer can start or retrieve a discussion, retrieve its history, retrieve its
analytics, get structured responses, and see failures clearly - plus `/health`
answering 200 and a sample request leaving a line in the log.

WHAT IS AND IS NOT UNDER TEST
The debate engine is Week 3's and the metrics are Week 4's; neither is
re-tested here and neither is reachable from here. `run_debate` and the
analytics client are patched, so what these tests exercise is exactly the layer
this repository owns: routing, status codes, persistence, the shape of each
response, and the log line each request produces.
"""

from __future__ import annotations

import logging

import pytest

#: A finished discussion with three rounds, one message per member per round -
#: the minimum the brief requires the UI to be able to display.
AGENTS = ("regulator", "industry", "civil_society")
ROUNDS = 3


def _sample_state(topic: str) -> dict:
    messages = [
        {
            "agent": agent,
            "round": round_number,
            "content": f"{agent} on {topic}, round {round_number}.",
            "used_retrieval": round_number == 0,
        }
        for round_number in range(ROUNDS)
        for agent in AGENTS
    ]
    return {
        "discussion_id": "disc-sample",
        "topic": topic,
        "status": "completed",
        "agents": list(AGENTS),
        "messages": messages,
        "retrieval_events": [{"agent": AGENTS[0], "query": topic, "hits": 3}],
        "config": {"num_rounds": ROUNDS, "strategy": "ring"},
    }


#: The five metrics the dashboard must surface, as Week 4 returns them.
SAMPLE_ANALYTICS = {
    "opinion_change": {agent: [0.0, 0.2, 0.4] for agent in AGENTS},
    "agreement": [{"round": r, "score": 0.5 + r / 10} for r in range(ROUNDS)],
    "influence": {agent: 0.3 for agent in AGENTS},
    "influence_detail": {agent: {"score": 0.3, "n": 4} for agent in AGENTS},
    "sentiment": [{"index": i, "score": 0.1} for i in range(len(AGENTS) * ROUNDS)],
    "interaction_graph": {AGENTS[0]: {AGENTS[1]: 2}},
}


@pytest.fixture()
def finished_run(main, client, monkeypatch):
    """Start a run whose engine and analytics are canned, and wait for it."""

    def fake_run_debate(config, emit, cancelled=None, on_round=None):  # noqa: ARG001
        state = _sample_state(config.topic)
        emit("run_started", {"topic": config.topic, "agents": list(AGENTS)})
        for round_number in range(ROUNDS):
            for agent in AGENTS:
                emit("message", {"agent": agent, "round": round_number})
            emit("round_complete", {"round": round_number, "converged": False})
            if on_round is not None:
                on_round(state, round_number)
        return state

    def fake_post_analytics(path, discussion, timeout=120.0):  # noqa: ARG001
        if path == "/inline/report":
            return {"markdown": "# Report\n", "analytics": SAMPLE_ANALYTICS}
        if path == "/inline/visualizations":
            return {"opinion_trajectory_png": "iVBOR", "interaction_graph_png": "iVBOR"}
        return SAMPLE_ANALYTICS

    monkeypatch.setattr(main, "run_debate", fake_run_debate)
    monkeypatch.setattr(main, "_post_analytics", fake_post_analytics)

    response = client.post("/runs", json={"topic": "Should the AI Act cover open models?",
                                          "num_rounds": ROUNDS})
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    assert main.RUNS[run_id].complete.wait(timeout=10), "the run never finished"
    return run_id


# --- health -----------------------------------------------------------------


def test_health_returns_200_and_a_status(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_reports_an_unreachable_analytics_service_instead_of_failing(client):
    # ANALYTICS_URL points nowhere in the test environment, which is the same
    # shape as the real failure: /health must still answer 200 and say so.
    assert client.get("/health").json()["analytics_reachable"] is False


# --- starting a discussion --------------------------------------------------


def test_start_run_is_accepted_and_returns_a_stream_url(main, client, monkeypatch):
    monkeypatch.setattr(main, "run_debate", lambda *a, **k: _sample_state("t"))
    monkeypatch.setattr(main, "_post_analytics", lambda *a, **k: SAMPLE_ANALYTICS)
    response = client.post("/runs", json={"topic": "t", "num_rounds": 3})
    assert response.status_code == 202
    body = response.json()
    assert body["run_id"]
    assert body["stream"] == f"/runs/{body['run_id']}/stream"


def test_an_empty_topic_is_refused_with_a_structured_error(client):
    response = client.post("/runs", json={"topic": "", "num_rounds": 3})
    assert response.status_code == 422
    assert response.json()["detail"]


def test_too_many_rounds_is_refused(client, main):
    response = client.post("/runs", json={"topic": "t", "num_rounds": main.MAX_ROUNDS + 1})
    assert response.status_code == 422


def test_the_concurrency_cap_is_reported_as_429(client, main, monkeypatch):
    monkeypatch.setattr(main, "MAX_CONCURRENT_RUNS", 0)
    response = client.post("/runs", json={"topic": "t", "num_rounds": 3})
    assert response.status_code == 429


# --- retrieving a discussion and its analytics ------------------------------


def test_a_finished_run_carries_its_discussion_and_its_analytics(client, finished_run):
    body = client.get(f"/runs/{finished_run}").json()
    assert body["status"] == "completed"
    assert body["discussion"]["messages"]
    assert set(body["analytics"]) >= {
        "opinion_change", "agreement", "influence", "sentiment", "interaction_graph"
    }


def test_the_discussion_holds_three_rounds_attributed_to_agents(client, finished_run):
    messages = client.get(f"/runs/{finished_run}/discussion").json()["messages"]
    rounds = {m["round"] for m in messages}
    assert len(rounds) >= 3, f"only {len(rounds)} rounds are retrievable"
    for agent in AGENTS:
        assert len([m for m in messages if m["agent"] == agent]) >= 3


def test_the_run_appears_in_the_history_listing(client, finished_run):
    runs = client.get("/runs").json()["runs"]
    assert [r for r in runs if r["run_id"] == finished_run]


def test_the_report_and_charts_come_from_week_4(client, finished_run):
    assert client.get(f"/runs/{finished_run}/report").json()["markdown"].startswith("# Report")
    charts = client.get(f"/runs/{finished_run}/charts").json()
    assert charts["opinion_trajectory_png"] and charts["interaction_graph_png"]


def test_the_stream_replays_every_event_from_the_beginning(client, finished_run):
    body = client.get(f"/runs/{finished_run}/stream").text
    assert "event: run_started" in body
    assert body.count("event: message") == len(AGENTS) * ROUNDS
    assert "event: stream_end" in body


def test_cancelling_a_finished_run_is_not_an_error(client, finished_run):
    body = client.delete(f"/runs/{finished_run}").json()
    assert body["run_id"] == finished_run
    assert body["cancelling"] is False


# --- failures are legible ---------------------------------------------------


@pytest.mark.parametrize(
    "path", ["/runs/nope", "/runs/nope/discussion", "/runs/nope/report",
             "/runs/nope/charts", "/runs/nope/stream"],
)
def test_an_unknown_run_is_404_everywhere(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert "nope" in response.json()["detail"]


def test_asking_for_a_report_before_the_debate_ends_is_409(client, main, monkeypatch):
    import threading

    gate = threading.Event()
    monkeypatch.setattr(main, "run_debate", lambda *a, **k: (gate.wait(5), _sample_state("t"))[1])
    monkeypatch.setattr(main, "_post_analytics", lambda *a, **k: SAMPLE_ANALYTICS)
    run_id = client.post("/runs", json={"topic": "t", "num_rounds": 3}).json()["run_id"]
    try:
        assert client.get(f"/runs/{run_id}/report").status_code == 409
        assert client.get(f"/runs/{run_id}/charts").status_code == 409
    finally:
        gate.set()
        main.RUNS[run_id].complete.wait(timeout=10)


def test_a_failed_engine_leaves_a_failed_run_with_its_reason(client, main, monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("the model refused")

    monkeypatch.setattr(main, "run_debate", explode)
    run_id = client.post("/runs", json={"topic": "t", "num_rounds": 3}).json()["run_id"]
    assert main.RUNS[run_id].complete.wait(timeout=10)
    body = client.get(f"/runs/{run_id}").json()
    assert body["status"] == "failed"
    assert "the model refused" in body["error"]


# --- the run survives a restart ---------------------------------------------


def test_a_persisted_run_is_restored_after_a_restart(client, main, finished_run):
    """The record on disk is what a redeployed container reads back."""
    main.RUNS.clear()
    main._restore_runs()
    assert finished_run in main.RUNS
    assert main.RUNS[finished_run].status == "completed"


# --- logging ----------------------------------------------------------------


def test_a_sample_request_leaves_a_log_entry(client, caplog):
    with caplog.at_level(logging.INFO, logger="debate"):
        client.get("/health")
    assert any(
        record.getMessage().startswith("request ") and "path=/health" in record.getMessage()
        and "status=200" in record.getMessage()
        for record in caplog.records
    ), caplog.text


def test_creating_and_retrieving_a_discussion_is_logged_with_its_id(
    client, main, monkeypatch, caplog
):
    monkeypatch.setattr(main, "run_debate", lambda *a, **k: _sample_state("t"))
    monkeypatch.setattr(main, "_post_analytics", lambda *a, **k: SAMPLE_ANALYTICS)
    with caplog.at_level(logging.INFO, logger="debate"):
        run_id = client.post("/runs", json={"topic": "t", "num_rounds": 3}).json()["run_id"]
        main.RUNS[run_id].complete.wait(timeout=10)
        client.get(f"/runs/{run_id}")
    logged = caplog.text
    assert f"discussion_created run_id={run_id}" in logged
    assert f"discussion_retrieved run_id={run_id}" in logged


def test_a_failure_is_logged_at_error(client, main, monkeypatch, caplog):
    def explode(*args, **kwargs):
        raise RuntimeError("the model refused")

    monkeypatch.setattr(main, "run_debate", explode)
    with caplog.at_level(logging.INFO, logger="debate"):
        run_id = client.post("/runs", json={"topic": "t", "num_rounds": 3}).json()["run_id"]
        main.RUNS[run_id].complete.wait(timeout=10)
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert any("discussion_failed" in r.getMessage() and run_id in r.getMessage()
               for r in errors), caplog.text

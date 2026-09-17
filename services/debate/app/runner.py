"""Drive a Week 3 discussion one turn at a time, emitting events as it goes.

WHY NOT `orchestrator.run_discussion()`
---------------------------------------
Week 3's entry point compiles a LangGraph and runs the whole discussion to
completion before returning anything. That is the right shape for a CLI run and
the wrong shape for a UI that shows the debate unfolding: nothing is observable
until every round has finished.

This module reuses the same Week 3 building blocks - `run_turn`,
`record_round_opinions`, `record_interactions`, `discussion_converged`,
`save_discussion` - in an explicit loop, so a caller gets a callback after every
message, every opinion snapshot and every round. The discussion record produced
is the same `DiscussionState` shape Week 4 consumes; nothing about it is
special-cased for the UI.

The loop deliberately mirrors `orchestrator._execute()`'s ordering, because the
Week 4 metrics depend on it: `current_round` is set *before* the agents speak,
snapshots for round N are recorded *after* every agent has spoken in round N,
and `record_interactions` runs after the snapshots exist so it can compare this
round against the last.

INITIAL OPINIONS
----------------
Week 3 seeds round 0 from Week 2's committed `initial_opinions.json`, which was
generated about one fixed topic. For a debate on a topic the user just typed,
that baseline is about the wrong question, so opinions are generated fresh for
the requested topic (`scripts/generate_initial_opinion.build_entry`, which
grounds each one in Week 1 retrieval). If that fails - no LLM key, Week 1
unreachable - the committed seed is used instead and the run says so in
`config.initial_opinions.source`, rather than silently starting from a baseline
about a different topic.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

WEEK3_ROOT = Path(os.environ.get("WEEK3_ROOT", "/week3")).resolve()
if str(WEEK3_ROOT) not in sys.path:
    sys.path.insert(0, str(WEEK3_ROOT))

# MUST come first: Week 3's config loads .env before any module reads an
# environment variable at import time. Same rule as its own entry points.
import src.config as week3_config  # noqa: E402,F401

from src.agents.agent_node import run_turn  # noqa: E402
from src.graph.build_graph import graph_config, load_personas, persona_stakeholder_tag  # noqa: E402
from src.opinions.tracker import (  # noqa: E402
    average_movement,
    discussion_converged,
    record_interactions,
    record_opinion,
    record_round_opinions,
    score_opinion_stance,
    seed_initial_opinions,
)
from src.orchestration.orchestrator import MIN_ROUNDS, default_proposition  # noqa: E402
from src.persistence.store import new_discussion_id, save_discussion  # noqa: E402
from src.schema import new_discussion_state  # noqa: E402

#: Where finished runs are written. Mounted as a volume in the container so a
#: restart does not lose them.
OUTPUT_DIR = Path(os.environ.get("DEBATE_OUTPUT_DIR", "/data/discussions"))

#: Hard ceiling on rounds a caller may request, so one request cannot spend an
#: unbounded number of LLM calls.
MAX_ROUNDS = int(os.environ.get("DEBATE_MAX_ROUNDS", "8"))


def _load_initial_opinion_builder():
    """Import `build_entry` from Week 3's scripts/ (not an importable package)."""
    path = WEEK3_ROOT / "scripts" / "generate_initial_opinion.py"
    spec = importlib.util.spec_from_file_location("week3_initial_opinion", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build_entry



def _weighted_adjacency(graph: dict) -> dict[str, dict[str, float]]:
    """The discussion graph as {sender: {recipient: weight}}.

    WHY NOT THE PLAIN ADJACENCY LIST
    Week 3's in-memory shape is `dict[str, list[str]]` and the real affinity
    weights live separately in the run config. Persisted that way, Week 4's
    `graph_loader.load_weighted_graph()` finds a list, falls back to its
    documented default of 1.0 for every edge, and the interaction graph draws
    every edge identically - throwing away the one thing that visualization is
    supposed to show. Writing the weights into `graph` itself is the shape
    Week 4 already reads, and validation accepts it (it requires a dict whose
    keys are agents, which this is).

    Recipient order is preserved from `build_adjacency()`, which sorts by
    descending weight - `routing.get_recipients()` does `list(adjacency[s])`,
    which yields dict keys in insertion order, so ordering survives.

    An edge with no recorded weight falls back to 1.0, the same default Week 4
    uses, rather than being dropped.
    """
    adjacency = graph.get("adjacency", {}) or {}
    weights = graph.get("weights", {}) or {}
    return {
        sender: {
            recipient: float(weights.get(sender, {}).get(recipient, 1.0))
            for recipient in recipients
        }
        for sender, recipients in adjacency.items()
    }


def _persona_cards(agents: list[str]) -> dict[str, dict]:
    """Who each agent actually is, for the UI to show a person rather than an id.

    Read from the Week 2 persona YAML that Week 3 vendors, so the name, role and
    stance shown on screen are the same ones the agent is prompted with - not a
    second description maintained in the frontend that could drift from it.
    A persona that cannot be loaded degrades to just its id.
    """
    try:
        personas = load_personas()
    except Exception:  # noqa: BLE001 - the UI can live without the detail
        return {persona_id: {"persona_id": persona_id} for persona_id in agents}

    cards: dict[str, dict] = {}
    for persona_id in agents:
        persona = personas.get(persona_id)
        if persona is None:
            cards[persona_id] = {"persona_id": persona_id}
            continue
        try:
            tag = persona_stakeholder_tag(persona)
        except Exception:  # noqa: BLE001
            tag = ""
        stance = getattr(persona, "stance", None)
        cards[persona_id] = {
            "persona_id": persona_id,
            "name": persona.name,
            "role": persona.role,
            "stakeholder_tag": tag,
            "core_position": getattr(stance, "core_position", "") or "",
            "open_to": list(getattr(stance, "open_to", []) or [])[:2],
            "priorities": list(getattr(persona, "priorities", []) or [])[:3],
        }
    return cards


@dataclass
class RunConfig:
    topic: str
    num_rounds: int = 3
    strategy: str = "ring"
    proposition: Optional[str] = None
    stop_on_convergence: bool = True
    #: Which members take part. None means every member currently on file.
    agents: Optional[list[str]] = None

    def validated(self) -> "RunConfig":
        topic = (self.topic or "").strip()
        if not topic:
            raise ValueError("topic must not be empty")
        if len(topic) > 300:
            raise ValueError("topic must be 300 characters or fewer")
        if self.strategy not in ("ring", "mesh"):
            raise ValueError("strategy must be 'ring' or 'mesh'")
        # Week 3 requires at least 3 rounds (its README section 10), and the
        # ceiling keeps one request from spending unbounded LLM credit.
        rounds = max(MIN_ROUNDS, min(MAX_ROUNDS, int(self.num_rounds)))
        agents = None
        if self.agents:
            # Keep the caller's order, drop duplicates.
            agents = list(dict.fromkeys(a.strip() for a in self.agents if a and a.strip()))
            if len(agents) < 2:
                raise ValueError("a debate needs at least 2 members")
        return RunConfig(
            topic=topic,
            num_rounds=rounds,
            strategy=self.strategy,
            proposition=(self.proposition or "").strip() or None,
            stop_on_convergence=self.stop_on_convergence,
            agents=agents,
        )


@dataclass
class DebateRun:
    """Everything the API layer needs to know about one run."""

    run_id: str
    config: RunConfig
    status: str = "pending"          # pending | running | completed | converged | failed
    state: dict = field(default_factory=dict)
    error: Optional[str] = None
    started_at: str = ""
    finished_at: str = ""


Emit = Callable[[str, dict], None]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seed_opinions(state: dict, cfg: RunConfig, proposition: str, emit: Emit) -> None:
    """Record every agent's round-0 position on the requested topic."""
    agents = state["agents"]
    generated = 0

    try:
        build_entry = _load_initial_opinion_builder()
    except Exception as exc:  # noqa: BLE001 - fall back to the committed seed
        build_entry = None
        emit("notice", {"message": f"initial-opinion generator unavailable: {exc}"})

    if build_entry is not None:
        for persona_id in agents:
            try:
                entry = build_entry(persona_id, cfg.topic)
                opinion = (entry or {}).get("opinion", "").strip()
                if not opinion:
                    raise ValueError("generator returned an empty opinion")
                record_opinion(
                    state,
                    persona_id,
                    "initial",
                    opinion,
                    stance_score=score_opinion_stance(opinion, proposition),
                )
                generated += 1
                emit(
                    "opinion",
                    {
                        "persona_id": persona_id,
                        "stage": "initial",
                        "round": 0,
                        "opinion_text": opinion,
                        "stance_score": state["opinions"][persona_id][-1].stance_score,
                    },
                )
            except Exception as exc:  # noqa: BLE001
                emit(
                    "notice",
                    {"message": f"could not generate an initial opinion for {persona_id}: {exc}"},
                )

    if generated == len(agents):
        state.setdefault("config", {}).setdefault("initial_opinions", {})["source"] = (
            "generated_for_this_topic"
        )
        _ensure_baseline_stances(state, emit)
        return

    # Partial or total failure: fall back to Week 2's committed seed for
    # whoever is still missing a round-0 snapshot, and say so in the record.
    missing = [a for a in agents if not state["opinions"].get(a)]
    if missing:
        seed_initial_opinions(state, proposition=proposition)
        state.setdefault("config", {}).setdefault("initial_opinions", {})["source"] = (
            "generated_for_this_topic" if generated else "week2_seed_fallback"
        )
        for persona_id in missing:
            snapshots = state["opinions"].get(persona_id) or []
            if snapshots:
                emit(
                    "opinion",
                    {
                        "persona_id": persona_id,
                        "stage": "initial",
                        "round": 0,
                        "opinion_text": snapshots[-1].opinion_text,
                        "stance_score": snapshots[-1].stance_score,
                        "note": "seeded from the Week 2 baseline (different topic)",
                    },
                )

    _ensure_baseline_stances(state, emit)


#: Recorded on the discussion when a round-0 stance had to be invented.
NEUTRAL_PLACEHOLDER = 0.0


def _ensure_baseline_stances(state: dict, emit: Emit) -> None:
    """Give every agent a numeric round-0 stance, or Week 4 cannot run at all.

    `score_opinion_stance()` returns None by design when the LLM is stubbed or
    the reply does not parse - it refuses to guess. That is right for the Week 3
    record, but it leaves `opinions[agent][0].stance_score` null, and Week 4's
    validation rejects the whole discussion (`missing_stance`), so a stubbed
    demo would show no analytics whatsoever.

    So the baseline falls back to a neutral placeholder, and the run says so
    twice: on `config.initial_opinions.stance_source`, which travels with the
    persisted record, and as a `notice` the UI shows the user. The placeholder
    is never presented as a measured position.
    """
    patched = [
        persona_id
        for persona_id in state.get("agents", [])
        for snapshots in [state["opinions"].get(persona_id) or []]
        if snapshots and snapshots[0].stance_score is None
    ]
    if not patched:
        state.setdefault("config", {}).setdefault("initial_opinions", {})["stance_source"] = "scored"
        return

    for persona_id in patched:
        state["opinions"][persona_id][0].stance_score = NEUTRAL_PLACEHOLDER
        emit(
            "opinion",
            {
                "persona_id": persona_id,
                "stage": "initial",
                "round": 0,
                "opinion_text": state["opinions"][persona_id][0].opinion_text,
                "stance_score": NEUTRAL_PLACEHOLDER,
                "note": "baseline stance could not be scored; neutral placeholder used",
            },
        )

    state.setdefault("config", {}).setdefault("initial_opinions", {})["stance_source"] = (
        "neutral_placeholder"
    )
    state["config"]["initial_opinions"]["placeholder_agents"] = patched
    emit(
        "notice",
        {
            "message": (
                f"Round-0 stance could not be scored for {', '.join(patched)} "
                f"(the LLM is stubbed or the scoring reply did not parse), so a neutral "
                f"{NEUTRAL_PLACEHOLDER} placeholder was used. Opinion-change figures "
                f"measured against round 0 are not meaningful for those agents."
            )
        },
    )


def run_debate(
    cfg: RunConfig,
    emit: Emit,
    cancelled: Optional[threading.Event] = None,
    on_round: Optional[Callable[[dict, int], None]] = None,
) -> dict:
    """Run a full debate, calling `emit(event_name, payload)` as it progresses.

    Events emitted:
      run_started    {discussion_id, topic, agents, graph, num_rounds, proposition}
      opinion        one agent's snapshot (round 0 and after every round)
      message        one agent message, as soon as its turn finishes
      retrieval      an agent pulled evidence from the Week 1 knowledge base
      round_complete {round, converged, average_movement}
      notice         a non-fatal problem worth showing the user
      run_complete   {status, discussion_id}
      run_failed     {error}

    `on_round(state, round_number)` is called once per completed round, after
    the snapshots and interactions for that round exist. The API layer uses it
    to ask the Week 4 service for analytics; this module never computes a
    metric itself, so it keeps exactly one job.

    Returns the final discussion state.
    """
    cfg = cfg.validated()

    # Always pass the member list explicitly. Week 3's graph_config(None) falls
    # back to DEFAULT_AGENTS, which is computed once at import - so a member
    # added through the persona API would silently never take part until the
    # service restarted.
    on_file = load_personas()
    if cfg.agents:
        unknown = [a for a in cfg.agents if a not in on_file]
        if unknown:
            raise ValueError(f"unknown member(s) {unknown}; available: {sorted(on_file)}")
        chosen = cfg.agents
    else:
        chosen = list(on_file)
    if len(chosen) < 2:
        raise ValueError("a debate needs at least 2 members on file")

    graph = graph_config(chosen, strategy=cfg.strategy)
    if not graph["strongly_connected"]:
        raise ValueError(f"agent graph is not strongly connected: {graph['adjacency']}")

    agents = list(graph.get("turn_order") or sorted(graph["adjacency"]))
    discussion_id = new_discussion_id()
    proposition = cfg.proposition or default_proposition(cfg.topic)

    state = new_discussion_state(
        discussion_id,
        cfg.topic,
        agents,
        _weighted_adjacency(graph),
        cfg.num_rounds,
        config={
            "proposition": proposition,
            "graph_strategy": "weighted_ring" if cfg.strategy == "ring" else "mesh",
            "graph_weights": graph.get("weights", {}),
            "turn_order": agents,
            "stakeholder_tags": graph.get("stakeholder_tags", {}),
            "llm_model": os.environ.get("OPENROUTER_MODEL", "(unset)"),
            "llm_stubbed": week3_config.llm_is_stubbed(),
            "retrieval_url": os.environ.get("WEEK1_RETRIEVAL_URL", ""),
            "retrieval_key_present": bool(os.environ.get("WEEK1_API_KEY", "").strip()),
            "started_at": _now(),
            "run_source": "live_debate_ui",
        },
    )

    emit(
        "run_started",
        {
            "discussion_id": discussion_id,
            "topic": cfg.topic,
            "proposition": proposition,
            "agents": agents,
            "personas": _persona_cards(agents),
            "graph": _weighted_adjacency(graph),
            "graph_weights": graph.get("weights", {}),
            "num_rounds": cfg.num_rounds,
            "llm_stubbed": week3_config.llm_is_stubbed(),
        },
    )

    _seed_opinions(state, cfg, proposition, emit)
    emit("round_complete", {"round": 0, "converged": False, "average_movement": None})

    for round_number in range(1, cfg.num_rounds + 1):
        if cancelled is not None and cancelled.is_set():
            state["status"] = "cancelled"
            break

        state["current_round"] = round_number
        emit("round_started", {"round": round_number})

        for persona_id in agents:
            if cancelled is not None and cancelled.is_set():
                break

            messages_before = len(state.get("messages", []))
            retrievals_before = len(state.get("retrieval_events", []))
            emit("turn_started", {"round": round_number, "persona_id": persona_id})

            try:
                state = run_turn(state, persona_id)
            except Exception as exc:  # noqa: BLE001 - one bad turn must not kill the run
                state.setdefault("failed_turns", []).append(
                    {"agent": persona_id, "round": round_number, "error": str(exc)}
                )
                emit("notice", {"message": f"{persona_id}'s turn failed: {exc}"})
                continue

            for event in state.get("retrieval_events", [])[retrievals_before:]:
                emit(
                    "retrieval",
                    {
                        "persona_id": event.persona_id,
                        "round": event.round,
                        "query": event.query,
                        "trigger": event.trigger,
                        "source": event.source,
                        "result_count": len(event.results or []),
                        "documents": [
                            {
                                "doc_id": hit.get("doc_id"),
                                "url": hit.get("url"),
                                "title": hit.get("title") or hit.get("doc_id"),
                            }
                            for hit in (event.results or [])[:5]
                        ],
                    },
                )

            for message in state.get("messages", [])[messages_before:]:
                emit(
                    "message",
                    {
                        "message_id": message.message_id,
                        "round": message.round,
                        "sender": message.sender,
                        "recipients": message.recipients,
                        "content": message.content,
                        "timestamp": message.timestamp,
                        "used_retrieval": message.used_retrieval,
                    },
                )

        record_round_opinions(state, round_number)
        record_interactions(state, round_number)

        for persona_id in agents:
            snapshots = state["opinions"].get(persona_id) or []
            if snapshots:
                latest = snapshots[-1]
                emit(
                    "opinion",
                    {
                        "persona_id": persona_id,
                        "stage": latest.stage,
                        "round": round_number,
                        "opinion_text": latest.opinion_text,
                        "stance_score": latest.stance_score,
                    },
                )

        if on_round is not None:
            try:
                on_round(state, round_number)
            except Exception as exc:  # noqa: BLE001 - analytics must not kill the debate
                emit("notice", {"message": f"round analytics unavailable: {exc}"})

        converged = (
            cfg.stop_on_convergence
            and round_number >= MIN_ROUNDS
            and round_number < cfg.num_rounds
            and discussion_converged(state)
        )
        emit(
            "round_complete",
            {
                "round": round_number,
                "converged": converged,
                "average_movement": average_movement(state),
            },
        )

        if converged:
            state["status"] = "converged"
            state.setdefault("config", {})["converged_at_round"] = round_number
            state["config"]["converged_avg_movement"] = round(average_movement(state) or 0.0, 4)
            break

    if state.get("status") not in ("converged", "cancelled"):
        state["status"] = "completed"
    state.setdefault("config", {})["finished_at"] = _now()

    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        saved_to = save_discussion(state, output_dir=OUTPUT_DIR)
        state["saved_to"] = str(saved_to)
    except Exception as exc:  # noqa: BLE001 - a failed save must not lose the run
        emit("notice", {"message": f"discussion not saved to disk: {exc}"})

    return state

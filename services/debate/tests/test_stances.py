"""Every round has to leave every agent a number.

Week 4 validates a discussion before it computes anything, and a single
`stance_score: null` fails the whole run with `missing_stance` - no metrics, no
report, for a debate that otherwise went perfectly. Three of the ten finished
runs on the deployment were rejected for exactly that: the agent spoke, but its
reply carried no `STANCE:` line, so Week 3 recorded the snapshot with no number
(it refuses to guess, which is right for its own record).

So the round boundary backfills: ask Week 3's own scorer where the written
opinion sits, and only if that cannot answer either, carry the agent's previous
stance forward. What was measured and what was filled in is recorded on
`config.stance_backfill` and said out loud in a notice.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import runner  # noqa: E402


def _snapshot(stage: str, stance, text: str = "a written position"):
    return SimpleNamespace(stage=stage, stance_score=stance, opinion_text=text)


def _state(*snapshots):
    return {
        "agents": ["eu_regulator"],
        "opinions": {"eu_regulator": list(snapshots)},
        "config": {},
    }


def _collect():
    events = []
    return events, lambda event_type, data: events.append((event_type, data))


def test_a_missing_stance_is_scored_from_the_opinion_that_was_written(monkeypatch):
    monkeypatch.setattr(runner, "score_opinion_stance", lambda text, proposition: 1.5)
    state = _state(_snapshot("initial", 0.5), _snapshot("round_1", None))
    events, emit = _collect()

    runner._ensure_round_stances(state, 1, "the proposition", emit)

    assert state["opinions"]["eu_regulator"][-1].stance_score == 1.5
    assert state["config"]["stance_backfill"] == [
        {"agent": "eu_regulator", "round": 1, "source": "scored"}
    ]
    assert any(kind == "notice" for kind, _ in events)


def test_an_unscorable_stance_carries_the_previous_one_forward(monkeypatch):
    monkeypatch.setattr(runner, "score_opinion_stance", lambda text, proposition: None)
    state = _state(_snapshot("initial", -1.5), _snapshot("round_1", None))
    events, emit = _collect()

    runner._ensure_round_stances(state, 1, "the proposition", emit)

    assert state["opinions"]["eu_regulator"][-1].stance_score == -1.5
    assert state["config"]["stance_backfill"] == [
        {"agent": "eu_regulator", "round": 1, "source": "carried_forward"}
    ]


def test_a_stance_the_agent_declared_is_left_alone(monkeypatch):
    def fail(*_args, **_kwargs):  # pragma: no cover - must not be reached
        raise AssertionError("an agent's own stance must not be re-scored")

    monkeypatch.setattr(runner, "score_opinion_stance", fail)
    state = _state(_snapshot("initial", 0.5), _snapshot("round_1", -2.0))
    events, emit = _collect()

    runner._ensure_round_stances(state, 1, "the proposition", emit)

    assert state["opinions"]["eu_regulator"][-1].stance_score == -2.0
    assert "stance_backfill" not in state["config"]
    assert events == []


def test_a_scoring_failure_does_not_kill_the_round(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("the provider answered 502")

    monkeypatch.setattr(runner, "score_opinion_stance", boom)
    state = _state(_snapshot("initial", 2.0), _snapshot("round_1", None))
    events, emit = _collect()

    runner._ensure_round_stances(state, 1, "the proposition", emit)

    assert state["opinions"]["eu_regulator"][-1].stance_score == 2.0


def test_with_no_earlier_number_at_all_the_placeholder_is_used_and_named(monkeypatch):
    monkeypatch.setattr(runner, "score_opinion_stance", lambda text, proposition: None)
    state = _state(_snapshot("round_1", None))
    events, emit = _collect()

    runner._ensure_round_stances(state, 1, "the proposition", emit)

    snapshot = state["opinions"]["eu_regulator"][-1]
    assert snapshot.stance_score == runner.NEUTRAL_PLACEHOLDER
    assert state["config"]["stance_backfill"][0]["source"] == "neutral_placeholder"


def test_the_backfill_runs_before_interactions_are_recorded():
    """The order is the fix, not the filling on its own.

    Week 4 validates twice over the same numbers: `missing_stance` on the
    snapshots, and `stance_delta_mismatch` on `interactions[...]`, where a delta
    of None sitting between two real stances fails on its own. `record_interactions`
    computes that delta from whatever the snapshots hold when it runs - so a
    stance filled in after it has already read them fixes nothing.

    Replaying a rejected run proved both halves: filling the stance alone still
    answered 422 (`stance_delta is None; the snapshots give 0.0`), and only once
    the deltas agreed did the same discussion come back 200 with a 6277-character
    report.
    """
    source = Path(runner.__file__).read_text(encoding="utf-8")
    backfill = source.index("_ensure_round_stances(state, round_number")
    interactions = source.index("record_interactions(state, round_number)")
    assert backfill < interactions

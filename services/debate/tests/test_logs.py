"""The log line's format.

A log line is only worth writing if it can be found again, so what is tested
here is the two things that make that true: the identifier survives verbatim
(`grep run_id=abc123` finds every line of one debate), and no value can break
the line into two or swallow the rest of it.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import logs  # noqa: E402


def test_an_event_with_no_fields_is_just_its_name():
    assert logs.format_event("application_started") == "application_started"


def test_fields_keep_the_order_they_were_written_in():
    line = logs.format_event("discussion_created", run_id="abc123", rounds=5)
    assert line == "discussion_created run_id=abc123 rounds=5"


def test_an_identifier_is_greppable_verbatim():
    assert "run_id=abc123" in logs.format_event("x", run_id="abc123", topic="a b")


def test_a_value_with_spaces_is_quoted():
    assert logs.format_event("x", topic="the AI Act") == 'x topic="the AI Act"'


def test_newlines_cannot_split_a_line_in_two():
    line = logs.format_event("analytics_failed", reason="connection lost\nretrying")
    assert "\n" not in line


def test_an_embedded_quote_cannot_unbalance_the_quoting():
    line = logs.format_event("x", reason='he said "no" to it')
    assert line.count('"') == 2


def test_a_long_value_is_truncated_rather_than_flooding_the_log():
    line = logs.format_event("x", topic="t" * 500)
    assert len(line) < 200
    assert line.endswith("…")


def test_booleans_and_none_read_as_words():
    assert logs.format_event("x", stubbed=True, id=None) == "x stubbed=true id=-"


def test_an_empty_value_is_visible_rather_than_a_dangling_equals():
    assert logs.format_event("x", topic="") == 'x topic=""'


def test_configure_is_idempotent_so_lines_are_never_doubled():
    logs.configure()
    before = len(logging.getLogger().handlers)
    logs.configure()
    assert len(logging.getLogger().handlers) == before


def test_configure_honours_the_requested_level():
    try:
        logs.configure("WARNING")
        assert logs.logger.level == logging.WARNING
    finally:
        logs.configure("INFO")


def test_an_unknown_level_falls_back_to_info_instead_of_crashing_startup():
    try:
        logs.configure("LOUD")
        assert logs.logger.level == logging.INFO
    finally:
        logs.configure("INFO")


def test_the_formatted_record_carries_a_timestamp_and_a_level(caplog):
    with caplog.at_level(logging.INFO, logger="debate"):
        logs.info("discussion_created", run_id="abc123")
    record = next(r for r in caplog.records if "discussion_created" in r.getMessage())
    assert record.levelname == "INFO"
    assert record.created > 0
    formatted = logging.Formatter(logs.LOG_FORMAT, datefmt=logs.LOG_DATEFMT).format(record)
    assert formatted.endswith("INFO  discussion_created run_id=abc123")
    # 2026-09-21 10:15:32
    assert len(formatted.split(" INFO")[0]) == 19

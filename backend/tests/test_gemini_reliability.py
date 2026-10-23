"""
Reliability tests for every backend function that asks Gemini to return JSON.

Why this file exists: generate_series() intermittently threw
"Expecting ',' delimiter" errors in production — Gemini occasionally embeds an
unescaped quote inside generated text (e.g. a punchy hook line), which breaks
manual bracket-finding + json.loads() at an unpredictable position. A single
successful manual test run proves nothing about this class of bug, since it's
non-deterministic. The fix (migrating to Gemini's structured response_schema
output) is verified here by actually calling the live API N times and
asserting every call produces valid, schema-conforming output — not by
reasoning about the fix in the abstract.

These tests call the real Gemini API (real cost, real latency) and are meant
to run before shipping a change to any of these functions, not on every save.
Skipped automatically if no API key is configured.
"""
import json
import uuid

import pytest

from app.daily import (
    _get_conn,
    assign_today_if_missing,
    chat_script,
    chat_series,
    generate_episode_script,
    generate_series,
    plan_series_episode,
)


def assert_reliable(fn, n: int, label: str) -> None:
    """Call fn() n times, print a line per attempt, and fail loudly with every
    captured error if even one attempt fails. A flaky AI-JSON function is a bug,
    not a maybe — this helper exists so "ran it once and it worked" is never
    mistaken for "this is reliable" again."""
    failures: list[str] = []
    for i in range(n):
        try:
            fn()
            print(f"  [{label}] run {i + 1}/{n}: OK")
        except Exception as exc:
            print(f"  [{label}] run {i + 1}/{n}: FAILED - {exc}")
            failures.append(f"run {i + 1}: {exc}")
    if failures:
        pytest.fail(f"{label}: {len(failures)}/{n} runs failed:\n" + "\n".join(failures))


def _delete_series(series_id: str) -> None:
    with _get_conn() as conn:
        conn.execute("DELETE FROM series_items WHERE series_id = ?", (series_id,))
        conn.execute("DELETE FROM series WHERE id = ?", (series_id,))


def _seed_series(day_count: int = 3) -> dict:
    """Insert a minimal series + items directly via SQL — no Gemini call, so
    fixture setup can't itself be the thing that's flaky."""
    series_id = str(uuid.uuid4())
    now = "2026-01-01T00:00:00+00:00"
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO series (id, name, day_count, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)",
            (series_id, "Test Series", day_count, now, now),
        )
        items = []
        for day in range(1, day_count + 1):
            item_id = str(uuid.uuid4())
            items.append({"id": item_id, "day_offset": day})
            conn.execute(
                "INSERT INTO series_items (id, series_id, day_offset, sub_topic, category, topic_angle, hook_idea) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (item_id, series_id, day, f"Test Sub-Topic {day}", "BUSINESS",
                 f"Test angle for day {day}", f"Test hook {day}"),
            )
    return {"series_id": series_id, "items": items}


def _seed_today_script() -> str:
    """Insert a minimal valid schema_version-2 script for today, without
    calling Gemini, so chat_script tests don't depend on script generation
    also being reliable."""
    assignment = assign_today_if_missing()
    date_ist = assignment["date_ist"]
    sections = []
    names = ["hook", "context", "evidence", "story_turn", "takeaway", "cta"]
    timings = [(0, 3), (3, 18), (18, 45), (45, 70), (70, 86), (86, 90)]
    for i, (name, (t0, t1)) in enumerate(zip(names, timings)):
        sections.append({
            "index": i, "name": name, "label": name.title(),
            "timing": {"start_s": t0, "end_s": t1},
            "shot_type": "b_roll" if name in ("context", "evidence", "story_turn", "takeaway") else "a_roll",
            "text": f"Test narration for {name}.", "plain_text": f"Test narration for {name}.",
            "word_count": 4, "cue_summary": [],
            "on_screen_text": "", "transition_after": "none",
            "b_roll_slot": name in ("context", "evidence", "story_turn", "takeaway"),
            "b_roll_prompt": "test prompt" if name in ("context", "evidence", "story_turn", "takeaway") else "",
            "proof_overlay": "",
        })
    payload = {
        "schema_version": 2, "topic": "Test Topic", "video_title": "Test Video",
        "tone": "energetic", "duration_sec": 90, "cta": "Follow for more",
        "disclaimer": "", "sections": sections, "total_word_count": 24,
    }
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO scripts (id, date_ist, topic_id, script_json, version, created_at) VALUES (?, ?, ?, ?, 1, ?)",
            (str(uuid.uuid4()), date_ist, assignment["topic_id"], json.dumps(payload), "2026-01-01T00:00:00+00:00"),
        )
    return date_ist


# ── generate_series — fixed with structured output, should be fully reliable ──

def test_generate_series_reliability(has_gemini_key):
    if not has_gemini_key:
        pytest.skip("GOOGLE_API_KEY not configured")

    created_ids: list[str] = []

    def _run():
        result = generate_series("Test theme: Indian logistics startups", day_count=5)
        assert len(result["items"]) == 5
        for item in result["items"]:
            assert item["sub_topic"] and item["topic_angle"] and item["hook_idea"]
        created_ids.append(result["id"])

    try:
        assert_reliable(_run, n=5, label="generate_series")
    finally:
        for sid in created_ids:
            _delete_series(sid)


# ── Canary coverage for functions still on manual JSON-bracket parsing ───────
# Lower N (cost-conscious) — these exist to catch a regression early, not to
# exhaustively prove reliability the way the series-generation test above does.
# If any of these starts failing, apply the same response_schema fix used for
# generate_series (see _SeriesItemSchema in app/daily.py).

def test_chat_script_reliability(has_gemini_key):
    if not has_gemini_key:
        pytest.skip("GOOGLE_API_KEY not configured")
    _seed_today_script()

    def _run():
        result = chat_script(message="Make the hook punchier.", history=[], scope="section")
        assert result["action"] in ("options", "propose", "redesign", "rejected", "reply")

    assert_reliable(_run, n=3, label="chat_script")


def test_chat_series_reliability(has_gemini_key):
    if not has_gemini_key:
        pytest.skip("GOOGLE_API_KEY not configured")
    seeded = _seed_series(day_count=3)

    def _run():
        result = chat_series(series_id=seeded["series_id"], message="Swap days 1 and 2.", history=[])
        assert result["action"] in ("update", "reply", "clarify", "rejected")

    try:
        assert_reliable(_run, n=3, label="chat_series")
    finally:
        _delete_series(seeded["series_id"])


def test_plan_series_episode_reliability(has_gemini_key):
    if not has_gemini_key:
        pytest.skip("GOOGLE_API_KEY not configured")
    seeded = _seed_series(day_count=1)

    def _run():
        result = plan_series_episode(series_id=seeded["series_id"], day_offset=1, message="", history=[])
        assert result["action"] in ("plan", "update", "reply", "clarify", "rejected")

    try:
        assert_reliable(_run, n=3, label="plan_series_episode")
    finally:
        _delete_series(seeded["series_id"])


def test_generate_episode_script_reliability(has_gemini_key):
    if not has_gemini_key:
        pytest.skip("GOOGLE_API_KEY not configured")
    seeded = _seed_series(day_count=1)
    plan = {
        "angle": "Test angle", "hook": "Test hook",
        "sections": {"hook": "x", "context": "x", "evidence": "x", "story_turn": "x", "takeaway": "x", "cta": "x"},
        "research_checklist": [], "saved_at": "2026-01-01T00:00:00+00:00",
    }
    with _get_conn() as conn:
        conn.execute(
            "UPDATE series_items SET plan_notes = ? WHERE series_id = ? AND day_offset = 1",
            (json.dumps(plan), seeded["series_id"]),
        )

    def _run():
        result = generate_episode_script(series_id=seeded["series_id"], day_offset=1)
        assert len(result["script"]["sections"]) == 6

    try:
        assert_reliable(_run, n=3, label="generate_episode_script")
    finally:
        _delete_series(seeded["series_id"])

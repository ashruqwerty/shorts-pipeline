import csv
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import anthropic as _anthropic_module
    _ANTHROPIC_AVAILABLE = True
except ImportError:
    _ANTHROPIC_AVAILABLE = False

from .config import DB_PATH, TOPIC_QUEUE_PATH, ensure_storage_tree

IST = timezone(timedelta(hours=5, minutes=30))
ALLOWED_STATUSES = {
    "assigned",
    "scripted",
    "recording",
    "uploaded",
    "ready_for_edit",
}


def _get_conn() -> sqlite3.Connection:
    ensure_storage_tree()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_ist() -> str:
    return datetime.now(IST).date().isoformat()


def _read_topics_from_csv(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    topics: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                day_index = int((row.get("day") or "0").strip())
            except ValueError:
                continue

            category = (row.get("category") or "").strip()
            topic_angle = (row.get("topic_angle") or "").strip()
            hook_idea = (row.get("hook_idea") or "").strip()
            if not category or not topic_angle:
                continue

            topics.append(
                {
                    "id": str(uuid.uuid4()),
                    "day_index": day_index,
                    "category": category,
                    "topic_angle": topic_angle,
                    "hook_idea": hook_idea,
                }
            )

    return topics


def init_daily_db() -> None:
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS topic_queue (
                id TEXT PRIMARY KEY,
                day_index INTEGER NOT NULL,
                category TEXT NOT NULL,
                topic_angle TEXT NOT NULL,
                hook_idea TEXT,
                enabled INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_assignment (
                date_ist TEXT PRIMARY KEY,
                topic_id TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(topic_id) REFERENCES topic_queue(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scripts (
                id TEXT PRIMARY KEY,
                date_ist TEXT NOT NULL,
                topic_id TEXT NOT NULL,
                script_json TEXT NOT NULL,
                version INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(topic_id) REFERENCES topic_queue(id)
            )
            """
        )

    seed_topic_queue_if_empty()


def seed_topic_queue_if_empty() -> None:
    with _get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) FROM topic_queue").fetchone()[0]
        if count > 0:
            return

    topics = _read_topics_from_csv(TOPIC_QUEUE_PATH)
    if not topics:
        return

    with _get_conn() as conn:
        conn.executemany(
            """
            INSERT INTO topic_queue (id, day_index, category, topic_angle, hook_idea, enabled)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            [
                (
                    topic["id"],
                    topic["day_index"],
                    topic["category"],
                    topic["topic_angle"],
                    topic["hook_idea"],
                )
                for topic in topics
            ],
        )


def _get_recent_topic_ids(limit: int = 7) -> list[str]:
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT topic_id
            FROM daily_assignment
            ORDER BY date_ist DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [row["topic_id"] for row in rows]


def _get_last_assigned_day_index() -> int | None:
    with _get_conn() as conn:
        row = conn.execute(
            """
            SELECT tq.day_index
            FROM daily_assignment da
            JOIN topic_queue tq ON tq.id = da.topic_id
            ORDER BY da.date_ist DESC
            LIMIT 1
            """
        ).fetchone()
    return int(row["day_index"]) if row else None


def _load_enabled_topics() -> list[dict[str, Any]]:
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, day_index, category, topic_angle, hook_idea
            FROM topic_queue
            WHERE enabled = 1
            ORDER BY day_index ASC, topic_angle ASC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def _pick_next_topic() -> dict[str, Any]:
    topics = _load_enabled_topics()
    if not topics:
        raise ValueError("No enabled topics found in queue")

    recent_topic_ids = set(_get_recent_topic_ids())
    last_day_index = _get_last_assigned_day_index()

    start_idx = 0
    if last_day_index is not None:
        for idx, topic in enumerate(topics):
            if topic["day_index"] > last_day_index:
                start_idx = idx
                break
        else:
            start_idx = 0

    ordered = topics[start_idx:] + topics[:start_idx]
    non_recent = [topic for topic in ordered if topic["id"] not in recent_topic_ids]
    if non_recent:
        return non_recent[0]
    return ordered[0]


def _get_assignment_by_date(date_ist: str) -> dict[str, Any] | None:
    with _get_conn() as conn:
        row = conn.execute(
            """
            SELECT da.date_ist, da.topic_id, da.status, da.created_at, da.updated_at,
                   tq.day_index, tq.category, tq.topic_angle, tq.hook_idea
            FROM daily_assignment da
            JOIN topic_queue tq ON tq.id = da.topic_id
            WHERE da.date_ist = ?
            """,
            (date_ist,),
        ).fetchone()
    return dict(row) if row else None


def assign_today_if_missing() -> dict[str, Any]:
    date_ist = _today_ist()
    existing = _get_assignment_by_date(date_ist)
    if existing:
        return existing

    topic = _pick_next_topic()
    now = _now_utc()

    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO daily_assignment (date_ist, topic_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (date_ist, topic["id"], "assigned", now, now),
        )

    assigned = _get_assignment_by_date(date_ist)
    if not assigned:
        raise RuntimeError("Failed to create daily assignment")
    return assigned


def _strip_cues(text: str) -> str:
    stripped = re.sub(r"\[[A-Z]+\]", "", text)
    return re.sub(r"\s+", " ", stripped).strip()


def _cue_summary(text: str) -> list[str]:
    seen: list[str] = []
    for m in re.finditer(r"\[([A-Z]+)\]", text):
        cue = m.group(1)
        if cue not in seen:
            seen.append(cue)
    return seen


def _make_section(
    index: int,
    name: str,
    label: str,
    start_s: int,
    end_s: int,
    shot_type: str,
    text: str,
    on_screen_text: str,
    transition_after: str,
    b_roll_slot: bool = False,
    b_roll_prompt: str = "",
    proof_overlay: str = "",
) -> dict[str, Any]:
    plain = _strip_cues(text)
    return {
        "index": index,
        "name": name,
        "label": label,
        "timing": {"start_s": start_s, "end_s": end_s},
        "shot_type": shot_type,
        "word_count": len(plain.split()) if plain.strip() else 0,
        "text": text,
        "plain_text": plain,
        "cue_summary": _cue_summary(text),
        "on_screen_text": on_screen_text,
        "transition_after": transition_after,
        "b_roll_slot": b_roll_slot,
        "b_roll_prompt": b_roll_prompt,
        "proof_overlay": proof_overlay,
    }


_LLM_SYSTEM_PROMPT = """\
You are a professional 90-second vertical short script writer for India-first business news.

Audience: India-first viewers interested in startups, markets, trade, geopolitics, and financial freedom.

## Voice-direction tokens
Embed these inline tokens in the narration text to guide the presenter's delivery. Use 2–5 cues per section.
Allowed tokens (ALL CAPS, in square brackets): [SLOW] [FAST] [NORMAL] [EMPHASIZE] [WHISPER] [LOUD] [HIGH] [LOW] [PAUSE] [BEAT] [BREATHE] [EXCITED] [SERIOUS]
Example: "[SLOW] This number shocked everyone. [PAUSE] [EMPHASIZE] It grew by 400 percent in one year."

## Script structure — 6 fixed sections
Write exactly these 6 sections in this order with these exact fixed timings:

index 0 — hook (0–3s, shot_type: a_roll)
  - One punchy attention-grabbing line. 3 seconds max. transition_after: flash_zoom

index 1 — context (3–18s, shot_type: a_roll)
  - What happened and why it matters. 15 seconds. transition_after: whip_pan
  - Include a proof_overlay with source name and approximate date.

index 2 — evidence (18–45s, shot_type: b_roll)
  - Numbers, data, timeline, key players. 27 seconds. transition_after: match_blur
  - Set b_roll_slot: true and provide a short cinematic b_roll_prompt.
  - Include a proof_overlay with source name and approximate date.

index 3 — story_turn (45–70s, shot_type: a_roll)
  - Hidden angle, who gains, who loses, surprising implication. 25 seconds. transition_after: slide_split

index 4 — takeaway (70–86s, shot_type: a_roll)
  - One actionable insight or decision for the viewer. 16 seconds. transition_after: quick_cut

index 5 — cta (86–90s, shot_type: a_roll)
  - Call to action: follow, subscribe, or engage. 4 seconds max. transition_after: none

## Output format
Return ONLY valid JSON — no markdown fences, no explanation, no commentary outside the JSON.
Do NOT include plain_text, word_count, cue_summary, or total_word_count fields — the server computes these.

Required schema:
{
  "schema_version": 2,
  "topic": "<string>",
  "video_title": "<string, max 58 chars>",
  "tone": "energetic",
  "duration_sec": 90,
  "cta": "<3-4 second CTA line>",
  "disclaimer": "<educational disclaimer if finance/investing topic, else empty string>",
  "sections": [
    {
      "index": <0-5>,
      "name": "<hook|context|evidence|story_turn|takeaway|cta>",
      "label": "<Hook|Context|Evidence|Story Turn|Takeaway|CTA>",
      "timing": {"start_s": <int>, "end_s": <int>},
      "shot_type": "<a_roll|b_roll>",
      "text": "<narration with inline [CUE] tokens>",
      "on_screen_text": "<bold title text shown on screen>",
      "transition_after": "<transition name>",
      "b_roll_slot": <true|false>,
      "b_roll_prompt": "<cinematic b-roll description, or empty string>",
      "proof_overlay": "<Source: Name, Date, or empty string>"
    }
  ]
}
"""

_CATEGORY_ADDONS: dict[str, str] = {
    "startup_funding": "Focus on: round size, investor names, founder backstory, business model, why now.",
    "old_business": "Focus on: origin year, turning point, near-failure moment, modern relevance.",
    "trade": "Focus on: exporter-importer countries, margin bottleneck, policy effect, winner/loser.",
    "geopolitics": "Focus on: event timeline, economic impact, supply-chain effect on India.",
    "supply_chain": "Focus on: one product and the hidden companies enabling each stage.",
    "export": "Focus on: region, export value, global demand, opportunity for entrepreneurs.",
    "financial_freedom": "Focus on: one principle, one numeric example, one actionable step within 24 hours.",
}


def _enrich_section(s: dict[str, Any]) -> dict[str, Any]:
    plain = _strip_cues(s["text"])
    return {
        **s,
        "plain_text": plain,
        "word_count": len(plain.split()) if plain.strip() else 0,
        "cue_summary": _cue_summary(s["text"]),
    }


def _call_llm_for_script(assignment: dict[str, Any]) -> dict[str, Any] | None:
    """Call Claude API to generate a v2 script. Returns None if unavailable or on any error."""
    if not _ANTHROPIC_AVAILABLE:
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
    if not api_key:
        return None

    topic = assignment["topic_angle"]
    category = assignment["category"]
    hook = assignment.get("hook_idea") or f"This {category.replace('_', ' ')} story changes everything."
    addon = _CATEGORY_ADDONS.get(category, "")

    user_message = (
        f"Topic: {topic}\n"
        f"Category: {category}\n"
        f"Hook idea: {hook}\n"
        + (f"Category guidance: {addon}\n" if addon else "")
        + "\nGenerate the complete script JSON now."
    )

    try:
        client = _anthropic_module.Anthropic(api_key=api_key)
        with client.messages.stream(
            model="claude-opus-5",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=_LLM_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            response = stream.get_final_message()

        text = next((b.text for b in response.content if b.type == "text"), "")

        # Extract outermost JSON object
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None

        raw = json.loads(text[start : end + 1])

        raw["sections"] = [_enrich_section(s) for s in raw.get("sections", [])]
        raw["total_word_count"] = sum(s["word_count"] for s in raw["sections"])
        raw["schema_version"] = 2

        from .schemas import ScriptV2
        ScriptV2(**raw)
        return raw

    except Exception:
        return None


def _build_script_payload(assignment: dict[str, Any]) -> dict[str, Any]:
    topic = assignment["topic_angle"]
    category = assignment["category"]
    hook = assignment.get("hook_idea") or f"This {category.replace('_', ' ')} story changes everything."

    sections = [
        _make_section(
            index=0, name="hook", label="Hook",
            start_s=0, end_s=3, shot_type="a_roll",
            text=f"[SLOW] {hook} [PAUSE] [EMPHASIZE] Here is why.",
            on_screen_text="Big update",
            transition_after="flash_zoom",
        ),
        _make_section(
            index=1, name="context", label="Context",
            start_s=3, end_s=18, shot_type="a_roll",
            text=(
                f"[NORMAL] Today we are breaking down [EMPHASIZE] {topic}. "
                "[SLOW] This is one of the most significant developments in Indian business right now. "
                "[FAST] And most people have completely missed it."
            ),
            on_screen_text="What happened and why it matters",
            transition_after="whip_pan",
            proof_overlay="Source and date card",
        ),
        _make_section(
            index=2, name="evidence", label="Evidence",
            start_s=18, end_s=45, shot_type="b_roll",
            text=(
                "[SERIOUS] The numbers tell a clear story. "
                "[SLOW] Look at the timeline, look at the data, look at who is involved. "
                "[EMPHASIZE] Every single indicator points in the same direction."
            ),
            on_screen_text="Evidence and numbers",
            transition_after="match_blur",
            b_roll_slot=True,
            b_roll_prompt=(
                "Vertical 9:16, energetic newsroom visuals, clean charts, "
                "high detail, no logo artifacts."
            ),
            proof_overlay="News clipping overlay",
        ),
        _make_section(
            index=3, name="story_turn", label="Story Turn",
            start_s=45, end_s=70, shot_type="a_roll",
            text=(
                "[BEAT] But [EMPHASIZE] here is the hidden angle. "
                "[SLOW] Who gains from this, and who loses? "
                "[SERIOUS] The answer will surprise you. "
                "[NORMAL] Because the real story is not what you read in the headlines."
            ),
            on_screen_text="Story turn and implications",
            transition_after="slide_split",
        ),
        _make_section(
            index=4, name="takeaway", label="Takeaway",
            start_s=70, end_s=86, shot_type="a_roll",
            text=(
                "[SLOW] One thing to act on right now. "
                "[EMPHASIZE] Pay attention to this space. "
                "[NORMAL] Because the decisions made in the next few months will define the next decade."
            ),
            on_screen_text="Actionable takeaway",
            transition_after="quick_cut",
        ),
        _make_section(
            index=5, name="cta", label="CTA",
            start_s=86, end_s=90, shot_type="a_roll",
            text="[FAST] Follow for daily high-signal business stories. [EXCITED] You will not regret it.",
            on_screen_text="Follow for more",
            transition_after="none",
        ),
    ]

    total_word_count = sum(s["word_count"] for s in sections)

    return {
        "schema_version": 2,
        "topic": topic,
        "video_title": f"{category.replace('_', ' ').title()}: {topic}",
        "tone": "energetic",
        "duration_sec": 90,
        "total_word_count": total_word_count,
        "cta": "Follow for daily high-signal stories.",
        "disclaimer": "For education only. Not financial advice.",
        "sections": sections,
    }


def _get_latest_script(date_ist: str) -> dict[str, Any] | None:
    with _get_conn() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM scripts
            WHERE date_ist = ?
            ORDER BY version DESC
            LIMIT 1
            """,
            (date_ist,),
        ).fetchone()
    return dict(row) if row else None


def generate_today_script(force_regenerate: bool = False) -> dict[str, Any]:
    assignment = assign_today_if_missing()
    date_ist = assignment["date_ist"]
    latest = _get_latest_script(date_ist)

    if latest and not force_regenerate:
        payload = json.loads(latest["script_json"])
        # Upgrade v1 scripts to v2 on first read after F001 deployment
        if payload.get("schema_version", 1) == 2:
            return {
                "date_ist": date_ist,
                "version": latest["version"],
                "created_at": latest["created_at"],
                "script": payload,
            }
        # v1 script found — fall through to regenerate as v2

    next_version = (latest["version"] + 1) if latest else 1
    payload = _call_llm_for_script(assignment) or _build_script_payload(assignment)
    script_id = str(uuid.uuid4())
    now = _now_utc()

    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO scripts (id, date_ist, topic_id, script_json, version, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                script_id,
                date_ist,
                assignment["topic_id"],
                json.dumps(payload),
                next_version,
                now,
            ),
        )
        conn.execute(
            """
            UPDATE daily_assignment
            SET status = ?, updated_at = ?
            WHERE date_ist = ?
            """,
            ("scripted", now, date_ist),
        )

    return {
        "date_ist": date_ist,
        "version": next_version,
        "created_at": now,
        "script": payload,
    }


def get_today_card() -> dict[str, Any]:
    assignment = assign_today_if_missing()
    script_bundle = generate_today_script(force_regenerate=False)

    script = script_bundle["script"]
    highlights = [
        "Hook in first 3 seconds",
        "Evidence with source-style proof overlay",
        "CTA capped to 3-4 seconds",
    ]

    return {
        "date_ist": assignment["date_ist"],
        "status": assignment["status"],
        "topic": {
            "category": assignment["category"],
            "angle": assignment["topic_angle"],
            "hook_idea": assignment.get("hook_idea") or "",
        },
        "overview": {
            "title": script["video_title"],
            "duration_sec": script["duration_sec"],
            "highlights": highlights,
        },
        "script_version": script_bundle["version"],
    }


def update_today_status(status: str) -> dict[str, Any]:
    if status not in ALLOWED_STATUSES:
        raise ValueError("Unsupported status")

    assignment = assign_today_if_missing()
    now = _now_utc()

    with _get_conn() as conn:
        conn.execute(
            """
            UPDATE daily_assignment
            SET status = ?, updated_at = ?
            WHERE date_ist = ?
            """,
            (status, now, assignment["date_ist"]),
        )

    updated = _get_assignment_by_date(assignment["date_ist"])
    if not updated:
        raise RuntimeError("Failed to update status")

    return {
        "date_ist": updated["date_ist"],
        "status": updated["status"],
        "updated_at": updated["updated_at"],
    }


def get_teleprompter_data() -> dict[str, Any]:
    script_bundle = generate_today_script(force_regenerate=False)
    return {
        "date_ist": script_bundle["date_ist"],
        "version": script_bundle["version"],
        "sections": script_bundle["script"]["sections"],
    }

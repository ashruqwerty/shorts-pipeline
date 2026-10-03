import concurrent.futures
import csv
import json
import logging
import os
import re
import sqlite3
import tempfile
import time
import uuid
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Suppress the Gemini SDK's AFC advisory log (it uses logging, not warnings)
logging.getLogger("google.genai.models").setLevel(logging.ERROR)

try:
    from google import genai as _genai_module
    _GENAI_AVAILABLE = True
except Exception as _genai_import_err:
    _GENAI_AVAILABLE = False
    print(f"[daily] google-genai import failed: {_genai_import_err}", flush=True)

from .config import DB_PATH, TOPIC_QUEUE_PATH, ensure_storage_tree


def _clean_llm_json(text: str) -> str:
    """Repair common LLM JSON defects: trailing commas, missing commas, comments, markdown fences."""
    # Strip markdown code fences (```json ... ``` or ``` ... ```)
    text = re.sub(r"```(?:json)?\s*", "", text)
    # Remove /* ... */ block comments
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    # Remove // line comments
    text = re.sub(r"//[^\n]*", "", text)
    # Remove trailing commas before } or ]
    text = re.sub(r",\s*([\]}])", r"\1", text)
    # Add missing commas between adjacent objects in an array: } ... {
    text = re.sub(r"}\s*\n(\s*){", r"},\n\1{", text)
    return text

_LLM_SYSTEM_PROMPT = """\
You are a professional 90-second vertical short script writer for India-first business news.

Audience: India-first viewers interested in startups, markets, trade, geopolitics, and financial freedom.

## Voice-direction tokens
Embed these inline tokens in the narration text to guide the presenter's delivery. Use 2-5 cues per section.
Allowed tokens (ALL CAPS, in square brackets): [SLOW] [FAST] [NORMAL] [EMPHASIZE] [WHISPER] [LOUD] [HIGH] [LOW] [PAUSE] [BEAT] [BREATHE] [EXCITED] [SERIOUS]
Example: "[SLOW] This number shocked everyone. [PAUSE] [EMPHASIZE] It grew by 400 percent in one year."

## Script structure — 6 fixed sections
Write exactly these 6 sections in this order with these exact fixed timings:

index 0 — hook (0-3s, shot_type: a_roll) — One punchy attention-grabbing line. transition_after: flash_zoom
index 1 — context (3-18s, shot_type: b_roll) — What happened and why it matters. 15 seconds. transition_after: whip_pan. Set b_roll_slot: true and provide b_roll_prompt. Include proof_overlay with source name and date.
index 2 — evidence (18-45s, shot_type: b_roll) — Numbers, data, timeline, key players. 27 seconds. transition_after: match_blur. Set b_roll_slot: true and provide b_roll_prompt. Include proof_overlay.
index 3 — story_turn (45-70s, shot_type: b_roll) — Hidden angle, who gains, who loses. 25 seconds. transition_after: slide_split. Set b_roll_slot: true and provide b_roll_prompt.
index 4 — takeaway (70-86s, shot_type: b_roll) — One actionable insight. 16 seconds. transition_after: quick_cut. Set b_roll_slot: true and provide b_roll_prompt.
index 5 — cta (86-90s, shot_type: a_roll) — Call to action. 4 seconds max. transition_after: none

## Output format
Return ONLY valid JSON — no markdown fences, no explanation.
Do NOT include plain_text, word_count, cue_summary, or total_word_count fields — the server computes these.

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
    "old_business_story": "Focus on: origin year, turning point, near-failure moment, modern relevance.",
    "trade_story": "Focus on: exporter-importer countries, margin bottleneck, policy effect, winner/loser.",
    "geopolitics": "Focus on: event timeline, economic impact, supply-chain effect on India.",
    "supply_chain_story": "Focus on: one product and the hidden companies enabling each stage.",
    "unknown_export": "Focus on: region, export value, global demand, opportunity for entrepreneurs.",
    "financial_freedom": "Focus on: one principle, one numeric example, one actionable step within 24 hours.",
}

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

    # Series tables
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS series (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            day_count INTEGER NOT NULL DEFAULT 10,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS series_items (
            id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL,
            day_offset INTEGER NOT NULL,
            sub_topic TEXT NOT NULL,
            category TEXT NOT NULL,
            topic_angle TEXT NOT NULL,
            hook_idea TEXT NOT NULL,
            FOREIGN KEY(series_id) REFERENCES series(id)
        )
        """
    )
    # Migrate daily_assignment to support series context
    for col, typedef in [("series_id", "TEXT"), ("series_day_offset", "INTEGER")]:
        try:
            conn.execute(f"ALTER TABLE daily_assignment ADD COLUMN {col} {typedef}")
        except Exception:
            pass
    # Migrate series_items to support plan_notes and script_draft
    for col in ["plan_notes TEXT", "script_draft TEXT"]:
        try:
            conn.execute(f"ALTER TABLE series_items ADD COLUMN {col}")
        except Exception:
            pass
    # Create daily_sessions table (pipeline tracking)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_sessions (
            date_ist TEXT PRIMARY KEY,
            pipeline_status TEXT,
            pipeline_progress TEXT,
            pipeline_output_path TEXT
        )
        """
    )
    # Migrate daily_sessions: add any missing pipeline columns
    for col in ["pipeline_status TEXT", "pipeline_progress TEXT", "pipeline_output_path TEXT", "pipeline_step TEXT"]:
        try:
            conn.execute(f"ALTER TABLE daily_sessions ADD COLUMN {col}")
        except Exception:
            pass

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
                   tq.day_index, tq.category, tq.topic_angle, tq.hook_idea,
                   da.series_id, da.series_day_offset,
                   s.name AS series_name, s.day_count AS series_day_count
            FROM daily_assignment da
            JOIN topic_queue tq ON tq.id = da.topic_id
            LEFT JOIN series s ON s.id = da.series_id
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


def _enrich_section(s: dict[str, Any]) -> dict[str, Any]:
    plain = _strip_cues(s["text"])
    return {
        **s,
        "plain_text": plain,
        "word_count": len(plain.split()) if plain.strip() else 0,
        "cue_summary": _cue_summary(s["text"]),
    }


def _call_llm_for_script(assignment: dict[str, Any]) -> dict[str, Any] | None:
    """Call Gemini API to generate a v2 script. Returns None if unavailable or on any error."""
    if not _GENAI_AVAILABLE:
        print("[LLM] google-genai not installed, using fallback")
        return None

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[LLM] GOOGLE_API_KEY not set, using fallback")
        return None

    topic = assignment["topic_angle"]
    category = assignment["category"]
    hook = assignment.get("hook_idea") or f"This {category.replace('_', ' ')} story changes everything."
    addon = _CATEGORY_ADDONS.get(category, "")

    existing_version = assignment.get("script_version", 0)
    variation_seed = os.urandom(4).hex()

    user_message = (
        f"Topic: {topic}\n"
        f"Category: {category}\n"
        f"Hook idea: {hook}\n"
        + (f"Category guidance: {addon}\n" if addon else "")
        + (f"Note: this is version {existing_version + 1} — use a fresh narrative angle, different hook phrasing, and new data examples from the previous draft. Seed: {variation_seed}\n" if existing_version > 0 else "")
        + "\nGenerate the complete script JSON now."
    )

    try:
        client = _genai_module.Client(api_key=api_key)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=user_message,
                config=_genai_module.types.GenerateContentConfig(
                    system_instruction=_LLM_SYSTEM_PROMPT,
                    max_output_tokens=4096,
                    temperature=1.2,
                ),
            )

        text = response.text or ""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            print("[LLM] no JSON found in response")
            return None

        raw = json.loads(_clean_llm_json(text[start : end + 1]))
        raw["sections"] = [_enrich_section(s) for s in raw.get("sections", [])]
        raw["total_word_count"] = sum(s["word_count"] for s in raw["sections"])
        raw["schema_version"] = 2
        print(f"[LLM] script generated OK, {len(raw['sections'])} sections")
        return raw

    except Exception as exc:
        print(f"[LLM] script generation failed: {exc}")
        return None


def _make_section(index: int, name: str, label: str, start_s: int, end_s: int,
                  shot_type: str, text: str, on_screen_text: str, transition_after: str,
                  b_roll_slot: bool = False, b_roll_prompt: str = "", proof_overlay: str = "") -> dict[str, Any]:
    plain = _strip_cues(text)
    return {
        "index": index, "name": name, "label": label,
        "timing": {"start_s": start_s, "end_s": end_s},
        "shot_type": shot_type,
        "text": text, "plain_text": plain,
        "word_count": len(plain.split()) if plain.strip() else 0,
        "cue_summary": _cue_summary(text),
        "on_screen_text": on_screen_text,
        "transition_after": transition_after,
        "b_roll_slot": b_roll_slot, "b_roll_prompt": b_roll_prompt, "proof_overlay": proof_overlay,
    }


def _build_script_payload(assignment: dict[str, Any]) -> dict[str, Any]:
    topic = assignment["topic_angle"]
    category = assignment["category"]
    hook = assignment.get("hook_idea") or f"This {category.replace('_', ' ')} story changes everything."

    sections = [
        _make_section(0, "hook", "Hook", 0, 3, "a_roll",
            f"[SLOW] {hook} [PAUSE] [EMPHASIZE] Here is why.",
            "Big update", "flash_zoom"),
        _make_section(1, "context", "Context", 3, 18, "b_roll",
            f"[NORMAL] Today we break down [EMPHASIZE] {topic}. [SLOW] This is one of the most significant developments in Indian business right now. [FAST] And most people have missed it.",
            "What happened and why it matters", "whip_pan", b_roll_slot=True,
            b_roll_prompt="Vertical 9:16, energetic newsroom visuals establishing the topic, high detail.",
            proof_overlay="Source and date card"),
        _make_section(2, "evidence", "Evidence", 18, 45, "b_roll",
            "[SERIOUS] The numbers tell a clear story. [SLOW] Look at the timeline, look at the data, look at who is involved. [EMPHASIZE] Every indicator points in the same direction.",
            "Evidence and numbers", "match_blur", b_roll_slot=True,
            b_roll_prompt="Vertical 9:16, energetic newsroom visuals, clean charts, high detail.",
            proof_overlay="News clipping overlay"),
        _make_section(3, "story_turn", "Story Turn", 45, 70, "b_roll",
            "[BEAT] But [EMPHASIZE] here is the hidden angle. [SLOW] Who gains from this, and who loses? [SERIOUS] The answer will surprise you. [NORMAL] The real story is not what you read in the headlines.",
            "Story turn and implications", "slide_split", b_roll_slot=True,
            b_roll_prompt="Vertical 9:16, cinematic visuals of the hidden angle, winners and losers."),
        _make_section(4, "takeaway", "Takeaway", 70, 86, "b_roll",
            "[SLOW] One thing to act on right now. [EMPHASIZE] Pay attention to this space. [NORMAL] The decisions made in the next few months will define the next decade.",
            "Actionable takeaway", "quick_cut", b_roll_slot=True,
            b_roll_prompt="Vertical 9:16, forward-looking visuals of the actionable takeaway."),
        _make_section(5, "cta", "CTA", 86, 90, "a_roll",
            "[FAST] Follow for daily high-signal business stories. [EXCITED] You will not regret it.",
            "Follow for more", "none"),
    ]

    return {
        "schema_version": 2,
        "topic": topic,
        "video_title": f"{category.replace('_', ' ').title()}: {topic}",
        "tone": "energetic",
        "duration_sec": 90,
        "total_word_count": sum(s["word_count"] for s in sections),
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


_BROLL_SECTION_NAMES = {"context", "evidence", "story_turn", "takeaway"}


def _enforce_shot_types(payload: dict[str, Any]) -> None:
    """Force shot_type/b_roll_slot deterministically by section name — the LLM's JSON
    is only prompted to use b_roll for these sections, not guaranteed to comply."""
    for s in payload.get("sections", []):
        is_broll = s.get("name") in _BROLL_SECTION_NAMES
        s["shot_type"] = "b_roll" if is_broll else "a_roll"
        s["b_roll_slot"] = is_broll
        if is_broll and not s.get("b_roll_prompt"):
            s["b_roll_prompt"] = f"Vertical 9:16 cinematic b-roll for: {s.get('label') or s.get('name', '')}"


def generate_today_script(force_regenerate: bool = False) -> dict[str, Any]:
    assignment = assign_today_if_missing()
    date_ist = assignment["date_ist"]
    latest = _get_latest_script(date_ist)

    if latest and not force_regenerate:
        payload = json.loads(latest["script_json"])
        _enforce_shot_types(payload)
        return {
            "date_ist": date_ist,
            "version": latest["version"],
            "created_at": latest["created_at"],
            "script": payload,
        }

    next_version = (latest["version"] + 1) if latest else 1
    payload = _call_llm_for_script(assignment) or _build_script_payload(assignment)
    _enforce_shot_types(payload)
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

    series_context = None
    if assignment.get("series_id"):
        series_context = {
            "series_id": assignment["series_id"],
            "name": assignment["series_name"],
            "day": assignment["series_day_offset"],
            "total": assignment["series_day_count"],
        }

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
        "series_context": series_context,
    }


def list_topics() -> list[dict[str, Any]]:
    """Return all enabled topics from the queue."""
    return _load_enabled_topics()


def reassign_today_topic(topic_id: str) -> dict[str, Any]:
    """Change today's assigned topic and clear any cached script so it regenerates."""
    date_ist = _today_ist()
    now = _now_utc()

    with _get_conn() as conn:
        # Verify topic exists
        row = conn.execute("SELECT id FROM topic_queue WHERE id = ? AND enabled = 1", (topic_id,)).fetchone()
        if not row:
            raise ValueError(f"Topic {topic_id} not found or disabled")

        existing = conn.execute("SELECT date_ist FROM daily_assignment WHERE date_ist = ?", (date_ist,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE daily_assignment SET topic_id = ?, status = 'assigned', updated_at = ? WHERE date_ist = ?",
                (topic_id, now, date_ist),
            )
        else:
            conn.execute(
                "INSERT INTO daily_assignment (date_ist, topic_id, status, created_at, updated_at) VALUES (?, ?, 'assigned', ?, ?)",
                (date_ist, topic_id, now, now),
            )
        # Delete cached scripts for today so the new topic generates fresh
        conn.execute(
            "DELETE FROM scripts WHERE date_ist = ?",
            (date_ist,),
        )

    return _get_assignment_by_date(date_ist)  # type: ignore[return-value]


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


# ---------------------------------------------------------------------------
# Script Director — conversational script editing
# ---------------------------------------------------------------------------

import secrets
import time as _time

_APPLY_TOKENS: dict[str, dict] = {}
_TOKEN_TTL = 600  # 10 minutes

_DIRECTOR_SYSTEM_PROMPT = """\
You are the Script Director — a specialist AI that edits short-form video scripts.

HARD RULE — SCOPE:
You ONLY edit the script below. Refuse ALL other requests.
For any off-topic request, return ONLY this JSON:
{"action":"rejected","reply":"I can only edit this script. Try: 'make the hook punchier', 'add data to evidence', 'rewrite the takeaway from an opportunity angle', or 'redesign the whole script'.","proposed_sections":null,"sections_changed":null,"clarifying_question":null}

CURRENT SCRIPT (JSON):
{current_script_json}

MODES — choose based on the user's intent:

MODE A — section-level (user targets 1-2 sections):
  Step 1 (first response to a section request): action = "options"
    - Write exactly 3 numbered alternatives (① ② ③) in the reply field as plain text
    - Each option is the FULL new text for that section (with voice cue tokens inline)
    - End reply with exactly 1 specific clarifying question
    - proposed_sections: null (no JSON yet — user picks first)
  Step 2 (user picks or refines an option): action = "propose"
    - Return the final section as proposed_sections array
    - End clarifying_question with a brief question about the result

MODE B — script-level (user asks to change multiple sections or the whole script):
  action = "redesign"
  - Apply the user's stated direction across ALL sections — do NOT randomly regenerate
  - proposed_sections: all section objects (or all changed ones if partial redesign)
  - End with a specific clarifying question
  - If user says "try again": rewrite same direction with different phrasing, examples, cue placement

RESPONSE FORMAT — return ONLY valid JSON, no markdown fences, nothing outside the JSON:
{
  "action": "options" | "propose" | "redesign" | "rejected" | "reply",
  "reply": "<full text response — numbered options or explanation>",
  "proposed_sections": null | [array of complete section objects for changed sections only],
  "sections_changed": null | [array of section index integers],
  "clarifying_question": "<specific follow-up question, or null>"
}

SECTION RULES:
- Return COMPLETE section objects with ALL fields
- Do NOT include: plain_text, word_count, cue_summary — server computes these
- Voice cue tokens (ALL CAPS, square brackets): [SLOW] [FAST] [NORMAL] [EMPHASIZE] [WHISPER] [LOUD] [HIGH] [LOW] [PAUSE] [BEAT] [BREATHE] [EXCITED] [SERIOUS]
- Use 2-5 cues per section
- Minimum 3 sections must remain if a section is deleted
- Required section fields: index, name, label, timing{start_s,end_s}, shot_type, text, on_screen_text, transition_after, b_roll_slot, b_roll_prompt, proof_overlay
"""


def _store_apply_token(proposed_sections: list, sections_changed: list, date_ist: str) -> str:
    token = "tok_" + secrets.token_hex(8)
    _APPLY_TOKENS[token] = {
        "proposed_sections": proposed_sections,
        "sections_changed": sections_changed,
        "date_ist": date_ist,
        "created_at": _time.time(),
    }
    expired = [k for k, v in _APPLY_TOKENS.items() if _time.time() - v["created_at"] > _TOKEN_TTL]
    for k in expired:
        del _APPLY_TOKENS[k]
    return token


def _consume_apply_token(token: str) -> dict | None:
    entry = _APPLY_TOKENS.pop(token, None)
    if entry and _time.time() - entry["created_at"] <= _TOKEN_TTL:
        return entry
    return None


def _merge_sections(base_sections: list, proposed_sections: list) -> list:
    by_index = {s["index"]: s for s in base_sections}
    for proposed in proposed_sections:
        by_index[proposed["index"]] = _enrich_section(proposed)
    return sorted(by_index.values(), key=lambda s: s["index"])


def chat_script(message: str, history: list[dict], scope: str) -> dict[str, Any]:
    """One turn of Script Director conversation. Returns response dict."""
    if not _GENAI_AVAILABLE:
        return {"action": "rejected", "reply": "AI not available. Check GOOGLE_API_KEY.", "proposed_sections": None, "apply_token": None, "sections_changed": None, "clarifying_question": None}

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {"action": "rejected", "reply": "AI not available. Check GOOGLE_API_KEY.", "proposed_sections": None, "apply_token": None, "sections_changed": None, "clarifying_question": None}

    assignment = assign_today_if_missing()
    date_ist = assignment["date_ist"]
    latest = _get_latest_script(date_ist)
    if not latest:
        return {"action": "rejected", "reply": "No script found for today. Generate a script first.", "proposed_sections": None, "apply_token": None, "sections_changed": None, "clarifying_question": None}

    current_script = json.loads(latest["script_json"])
    system_prompt = _DIRECTOR_SYSTEM_PROMPT.replace("{current_script_json}", json.dumps(current_script, ensure_ascii=False))

    # Build multi-turn contents list
    contents: list[dict] = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    try:
        client = _genai_module.Client(api_key=api_key)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=_genai_module.types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=8192,
                    temperature=1.1,
                ),
            )

        text = response.text or ""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON in response")

        raw = json.loads(_clean_llm_json(text[start: end + 1]))
        action = raw.get("action", "reply")
        proposed_sections = raw.get("proposed_sections")
        sections_changed = raw.get("sections_changed")

        apply_token = None
        if action in ("propose", "redesign") and proposed_sections:
            enriched = [_enrich_section(s) for s in proposed_sections]
            changed_indices = sections_changed or [s["index"] for s in enriched]
            apply_token = _store_apply_token(enriched, changed_indices, date_ist)
            proposed_sections = enriched

        return {
            "action": action,
            "reply": raw.get("reply", ""),
            "proposed_sections": proposed_sections,
            "apply_token": apply_token,
            "sections_changed": sections_changed,
            "clarifying_question": raw.get("clarifying_question"),
        }

    except Exception as exc:
        print(f"[Director] chat failed: {exc}")
        return {"action": "rejected", "reply": "Something went wrong — please try again.", "proposed_sections": None, "apply_token": None, "sections_changed": None, "clarifying_question": None}


def apply_script_proposal(token: str) -> dict[str, Any]:
    """Apply a stored proposal token and save as a new version."""
    entry = _consume_apply_token(token)
    if not entry:
        raise ValueError("Invalid or expired apply token.")

    date_ist = entry["date_ist"]
    latest = _get_latest_script(date_ist)
    if not latest:
        raise ValueError("No base script found for today.")

    base_script = json.loads(latest["script_json"])
    merged = _merge_sections(base_script.get("sections", []), entry["proposed_sections"])
    new_script = {**base_script, "sections": merged}
    _enforce_shot_types(new_script)
    new_version = latest["version"] + 1
    script_id = str(uuid.uuid4())
    now = _now_utc()

    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO scripts (id, date_ist, topic_id, script_json, version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (script_id, date_ist, latest["topic_id"], json.dumps(new_script), new_version, now),
        )

    return {"date_ist": date_ist, "version": new_version, "created_at": now, "script": new_script}


def revert_script_version(date_ist: str, to_version: int) -> dict[str, Any]:
    """Save an old version's content as a new version (undo)."""
    with _get_conn() as conn:
        old = conn.execute(
            "SELECT * FROM scripts WHERE date_ist = ? AND version = ?", (date_ist, to_version)
        ).fetchone()
    if not old:
        raise ValueError(f"Version {to_version} not found.")

    latest = _get_latest_script(date_ist)
    new_version = (latest["version"] + 1) if latest else 1
    script_id = str(uuid.uuid4())
    now = _now_utc()
    payload = json.loads(old["script_json"])
    _enforce_shot_types(payload)

    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO scripts (id, date_ist, topic_id, script_json, version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (script_id, date_ist, old["topic_id"], json.dumps(payload), new_version, now),
        )

    return {"date_ist": date_ist, "version": new_version, "created_at": now, "script": payload}


# ---------------------------------------------------------------------------
# Series Creator — plan a 10-day content series via chat
# ---------------------------------------------------------------------------

_SERIES_GENERATE_PROMPT = """\
You are a content series planner for a YouTube Shorts creator focused on India-first business, geopolitics, and finance news.

Given a master theme and a number of days, generate exactly that many distinct daily episode ideas.

Rules:
- Each episode must be standalone — watchable without context from the others
- Progressive depth: earlier episodes are more accessible, later ones go deeper
- No two episodes can cover the same specific angle, company, person, or event
- Category must be one of: BUSINESS, GEOPOLITICS, FINANCE, STARTUP, MARKETS, ECONOMY
- topic_angle is the specific argument or story the video tells — be concrete and opinionated
- hook_idea is the first one sentence that would stop someone scrolling — punchy and surprising
- sub_topic is the specific name: a brand, person, event, or concept (not the master theme)

Return ONLY valid JSON array, no markdown fences, no explanation:
[
  {
    "day_offset": 1,
    "sub_topic": "<specific brand / event / person name>",
    "category": "<category>",
    "topic_angle": "<specific angle — what the video actually argues>",
    "hook_idea": "<one punchy opening line>"
  }
]
"""

_SERIES_CHAT_PROMPT = """\
You are a series planning assistant for a YouTube Shorts creator.

HARD RULE — SCOPE:
You ONLY help plan and refine content series. Refuse all other requests.
For any off-topic request return ONLY this JSON:
{{"action":"rejected","reply":"I can only help plan this content series. Try: 'replace day 4 with Amul', 'make the geopolitics topics more dramatic', 'add a supply chain angle to day 7', or 'swap days 2 and 5'.","episodes":null,"episodes_changed":null,"clarifying_question":null}}

CURRENT SERIES: {series_name}
DAY COUNT: {day_count}

CURRENT EPISODES:
{episodes_json}

WHAT YOU CAN DO:
- Replace a specific episode with a different angle/company/event
- Swap two episodes
- Adjust tone/focus across multiple episodes
- Answer planning questions about the series arc

RESPONSE FORMAT — return ONLY valid JSON, no markdown fences:
{{
  "action": "update" | "reply" | "clarify" | "rejected",
  "reply": "<explanation of what changed or clarifying answer>",
  "episodes": null | [array of ALL {day_count} episodes with changes applied],
  "episodes_changed": null | [array of day_offset integers that changed],
  "clarifying_question": null | "<specific follow-up question>"
}}

RULES for "update" action:
- Return ALL episodes in episodes field (not just changed ones)
- day_offset values must run 1 through {day_count} consecutively
- Required fields per episode: day_offset, sub_topic, category, topic_angle, hook_idea
- Category must be one of: BUSINESS, GEOPOLITICS, FINANCE, STARTUP, MARKETS, ECONOMY
"""


def _get_series_items(series_id: str) -> list[dict[str, Any]]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM series_items WHERE series_id = ? ORDER BY day_offset ASC",
            (series_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _get_series(series_id: str) -> dict[str, Any] | None:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM series WHERE id = ?", (series_id,)).fetchone()
    if not row:
        return None
    series = dict(row)
    series["items"] = _get_series_items(series_id)
    return series


def _llm_client():
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not _GENAI_AVAILABLE or not api_key:
        return None, api_key
    return _genai_module.Client(api_key=api_key), api_key


def generate_series(theme: str, day_count: int = 10) -> dict[str, Any]:
    """Call Gemini to generate a series draft for a master theme."""
    client, _ = _llm_client()
    if not client:
        raise ValueError("AI not available. Check GOOGLE_API_KEY.")

    user_message = f"Master theme: {theme}\nNumber of episodes: {day_count}\n\nGenerate the series now."

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=user_message,
                config=_genai_module.types.GenerateContentConfig(
                    system_instruction=_SERIES_GENERATE_PROMPT,
                    max_output_tokens=4096,
                    temperature=1.1,
                ),
            )
        text = response.text or ""
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1:
            raise ValueError("No JSON array in response")
        items = json.loads(_clean_llm_json(text[start: end + 1]))
    except Exception as exc:
        print(f"[Series] generation failed: {exc}")
        raise ValueError(f"Series generation failed: {exc}") from exc

    now = _now_utc()
    series_id = str(uuid.uuid4())

    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO series (id, name, day_count, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)",
            (series_id, theme, day_count, now, now),
        )
        for item in items:
            conn.execute(
                "INSERT INTO series_items (id, series_id, day_offset, sub_topic, category, topic_angle, hook_idea) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), series_id, item["day_offset"], item["sub_topic"], item["category"], item["topic_angle"], item["hook_idea"]),
            )

    return _get_series(series_id)  # type: ignore[return-value]


def chat_series(series_id: str, message: str, history: list[dict]) -> dict[str, Any]:
    """One turn of Series planning chat. Returns response dict."""
    client, _ = _llm_client()
    if not client:
        return {"action": "rejected", "reply": "AI not available.", "episodes": None, "episodes_changed": None, "clarifying_question": None}

    series = _get_series(series_id)
    if not series:
        return {"action": "rejected", "reply": "Series not found.", "episodes": None, "episodes_changed": None, "clarifying_question": None}

    episodes_json = json.dumps(series["items"], ensure_ascii=False, indent=2)
    system_prompt = _SERIES_CHAT_PROMPT.format(
        series_name=series["name"],
        day_count=series["day_count"],
        episodes_json=episodes_json,
    )

    contents: list[dict] = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=_genai_module.types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=4096,
                    temperature=1.0,
                ),
            )
        text = response.text or ""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON in response")
        raw = json.loads(_clean_llm_json(text[start: end + 1]))
    except Exception as exc:
        print(f"[Series] chat failed: {exc}")
        return {"action": "rejected", "reply": "Something went wrong — please try again.", "episodes": None, "episodes_changed": None, "clarifying_question": None}

    action = raw.get("action", "reply")
    episodes = raw.get("episodes")
    episodes_changed = raw.get("episodes_changed")

    # If the model updated episodes, persist them to series_items
    if action == "update" and episodes:
        now = _now_utc()
        with _get_conn() as conn:
            conn.execute("DELETE FROM series_items WHERE series_id = ?", (series_id,))
            for item in episodes:
                conn.execute(
                    "INSERT INTO series_items (id, series_id, day_offset, sub_topic, category, topic_angle, hook_idea) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), series_id, item["day_offset"], item["sub_topic"], item["category"], item["topic_angle"], item["hook_idea"]),
                )
            conn.execute("UPDATE series SET updated_at = ? WHERE id = ?", (now, series_id))

    return {
        "action": action,
        "reply": raw.get("reply", ""),
        "episodes": episodes,
        "episodes_changed": episodes_changed,
        "clarifying_question": raw.get("clarifying_question"),
    }


def get_active_series() -> dict[str, Any] | None:
    """Return the most recently activated series, or None."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM series WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    return _get_series(row["id"])


_EPISODE_PLAN_PROMPT = """\
You are a script planning assistant for a YouTube Shorts creator focused on India-first business news.

Given a specific episode topic from a content series, you help plan what the 90-second script will cover.
You do NOT write the full script — you outline the narrative structure, key facts, and angles.

HARD RULE — SCOPE:
You ONLY help plan and refine this specific episode's script outline. Refuse all other requests.
For any off-topic request return ONLY:
{{"action":"rejected","reply":"I can only help plan this episode's script outline.","key_points":null,"updated_angle":null,"updated_hook":null,"plan":null}}

EPISODE:
Sub-topic: {sub_topic}
Category: {category}
Angle: {topic_angle}
Hook idea: {hook_idea}

WHAT YOU DO:
- On first message: give a full planning overview AND return a structured plan object
- On follow-up messages: refine the plan based on user feedback; return updated plan
- If the user changes the angle or hook, update them in the plan and in updated_angle/updated_hook
- For simple questions/replies that don't change the plan, use action "reply" and omit the plan

RESPONSE FORMAT — return ONLY valid JSON, no markdown fences:
{{
  "action": "plan" | "update" | "reply" | "rejected",
  "reply": "<full planning overview or refinement as readable text>",
  "key_points": ["<fact/data point to research>", ...] | null,
  "updated_angle": null | "<refined topic_angle string>",
  "updated_hook": null | "<refined hook_idea string>",
  "plan": null | {{
    "angle": "<episode angle — matches updated_angle if changed>",
    "hook": "<opening hook line for the 0-3s section>",
    "sections": {{
      "hook": "<what to say in the hook section 0-3s>",
      "context": "<what to cover in context 3-18s>",
      "evidence": "<numbers, data, key players for evidence 18-45s>",
      "story_turn": "<the pivot/revelation for story_turn 45-65s>",
      "takeaway": "<the lesson/message for takeaway 65-80s>",
      "cta": "<call-to-action line for cta 80-90s>"
    }},
    "research_checklist": ["<specific fact or stat to look up>", ...]
  }}
}}

IMPORTANT: plan must be a full object (not null) when action is "plan" or "update". Set plan to null for "reply" and "rejected".
"""


def plan_series_episode(series_id: str, day_offset: int, message: str, history: list[dict]) -> dict[str, Any]:
    """Plan or refine a specific series episode's script outline via chat."""
    client, _ = _llm_client()
    if not client:
        return {"action": "rejected", "reply": "AI not available. Check GOOGLE_API_KEY.", "key_points": None, "updated_angle": None, "updated_hook": None}

    series = _get_series(series_id)
    if not series:
        return {"action": "rejected", "reply": "Series not found.", "key_points": None, "updated_angle": None, "updated_hook": None}

    item = next((i for i in series["items"] if i["day_offset"] == day_offset), None)
    if not item:
        return {"action": "rejected", "reply": "Episode not found.", "key_points": None, "updated_angle": None, "updated_hook": None}

    system_prompt = _EPISODE_PLAN_PROMPT.format(
        sub_topic=item["sub_topic"],
        category=item["category"],
        topic_angle=item["topic_angle"],
        hook_idea=item["hook_idea"],
    )

    # On first call (empty history, empty message), auto-trigger the plan overview
    trigger = message.strip() or "Give me a planning overview for this episode — what should the script cover, what data to research, and how to angle the hook."

    contents: list[dict] = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    contents.append({"role": "user", "parts": [{"text": trigger}]})

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=_genai_module.types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=3000,
                    temperature=1.0,
                ),
            )
        text = response.text or ""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON in response")
        raw = json.loads(_clean_llm_json(text[start: end + 1]))
    except Exception as exc:
        print(f"[EpisodePlan] failed: {exc}")
        return {"action": "rejected", "reply": "Something went wrong — please try again.", "key_points": None, "updated_angle": None, "updated_hook": None}

    action = raw.get("action", "plan")
    updated_angle = raw.get("updated_angle")
    updated_hook = raw.get("updated_hook")
    plan = raw.get("plan") if action in ("plan", "update") else None

    # Persist any angle/hook updates back to series_items
    if (updated_angle or updated_hook) and action in ("plan", "update", "reply"):
        now = _now_utc()
        new_angle = updated_angle or item["topic_angle"]
        new_hook = updated_hook or item["hook_idea"]
        with _get_conn() as conn:
            conn.execute(
                "UPDATE series_items SET topic_angle = ?, hook_idea = ? WHERE series_id = ? AND day_offset = ?",
                (new_angle, new_hook, series_id, day_offset),
            )
            conn.execute("UPDATE series SET updated_at = ? WHERE id = ?", (now, series_id))

    return {
        "action": action,
        "reply": raw.get("reply", ""),
        "key_points": raw.get("key_points"),
        "updated_angle": updated_angle,
        "updated_hook": updated_hook,
        "plan": plan,
    }


def save_episode_plan(series_id: str, day_offset: int, plan: dict) -> dict[str, Any]:
    """Persist a structured episode plan to series_items.plan_notes."""
    series = _get_series(series_id)
    if not series:
        raise ValueError("Series not found")
    item = next((i for i in series["items"] if i["day_offset"] == day_offset), None)
    if not item:
        raise ValueError("Episode not found")

    now = _now_utc()
    plan["saved_at"] = now
    plan_json = json.dumps(plan)

    new_angle = plan.get("angle") or item["topic_angle"]
    new_hook = plan.get("hook") or item["hook_idea"]

    with _get_conn() as conn:
        conn.execute(
            "UPDATE series_items SET plan_notes = ?, topic_angle = ?, hook_idea = ? WHERE series_id = ? AND day_offset = ?",
            (plan_json, new_angle, new_hook, series_id, day_offset),
        )
        conn.execute("UPDATE series SET updated_at = ? WHERE id = ?", (now, series_id))

    return _get_series(series_id)  # type: ignore[return-value]


def generate_episode_script(series_id: str, day_offset: int) -> dict[str, Any]:
    """Generate a full 90-second script from a saved episode plan. Stores in series_items.script_draft."""
    client, _ = _llm_client()
    if not client:
        raise ValueError("AI not available. Check GOOGLE_API_KEY.")

    series = _get_series(series_id)
    if not series:
        raise ValueError("Series not found")

    item = next((i for i in series["items"] if i["day_offset"] == day_offset), None)
    if not item:
        raise ValueError("Episode not found")

    if not item.get("plan_notes"):
        raise ValueError("Apply a plan first before generating the script.")

    plan = json.loads(item["plan_notes"])
    category = item["category"]
    addon = _CATEGORY_ADDONS.get(category, "")
    sections = plan.get("sections", {})
    checklist = plan.get("research_checklist", [])

    user_message = (
        f"Topic: {plan.get('angle', item['topic_angle'])}\n"
        f"Category: {category}\n"
        f"Hook idea: {plan.get('hook', item['hook_idea'])}\n"
        + (f"Category guidance: {addon}\n" if addon else "")
        + "\nScript narrative plan — follow these section notes closely:\n"
        + f"- hook (0-3s): {sections.get('hook', '')}\n"
        + f"- context (3-18s): {sections.get('context', '')}\n"
        + f"- evidence (18-45s): {sections.get('evidence', '')}\n"
        + f"- story_turn (45-70s): {sections.get('story_turn', '')}\n"
        + f"- takeaway (70-86s): {sections.get('takeaway', '')}\n"
        + f"- cta (86-90s): {sections.get('cta', '')}\n"
    )
    if checklist:
        user_message += "\nResearch reference points (weave in where accurate and relevant):\n"
        for pt in checklist:
            user_message += f"- {pt}\n"
    user_message += "\nGenerate the complete script JSON now."

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=user_message,
                config=_genai_module.types.GenerateContentConfig(
                    system_instruction=_LLM_SYSTEM_PROMPT,
                    max_output_tokens=4096,
                    temperature=1.0,
                ),
            )
        text = response.text or ""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON in response")
        raw = json.loads(_clean_llm_json(text[start: end + 1]))
        raw["sections"] = [_enrich_section(s) for s in raw.get("sections", [])]
        raw["total_word_count"] = sum(s["word_count"] for s in raw["sections"])
        raw["schema_version"] = 2
    except Exception as exc:
        raise ValueError(f"Script generation failed: {exc}")

    script_json = json.dumps(raw)
    now = _now_utc()
    with _get_conn() as conn:
        conn.execute(
            "UPDATE series_items SET script_draft = ? WHERE series_id = ? AND day_offset = ?",
            (script_json, series_id, day_offset),
        )
        conn.execute("UPDATE series SET updated_at = ? WHERE id = ?", (now, series_id))

    return {"series_id": series_id, "day_offset": day_offset, "script": raw}


def activate_series(series_id: str) -> dict[str, Any]:
    """Queue a series into daily_assignment starting from tomorrow."""
    series = _get_series(series_id)
    if not series:
        raise ValueError("Series not found.")
    if not series["items"]:
        raise ValueError("Series has no episodes.")

    today_str = _today_ist()
    today_dt = datetime.strptime(today_str, "%Y-%m-%d")
    now = _now_utc()

    with _get_conn() as conn:
        # Deactivate any other active series
        conn.execute("UPDATE series SET status = 'superseded', updated_at = ? WHERE status = 'active'", (now,))

        for item in series["items"]:
            target_dt = today_dt + timedelta(days=item["day_offset"])
            target_date = target_dt.strftime("%Y-%m-%d")

            # Insert into topic_queue (high day_index to avoid conflicts with CSV topics)
            topic_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO topic_queue (id, day_index, category, topic_angle, hook_idea, enabled) VALUES (?, ?, ?, ?, ?, 1)",
                (topic_id, 9000 + item["day_offset"], item["category"], item["topic_angle"], item["hook_idea"]),
            )

            # Insert or replace the daily_assignment for that date
            conn.execute(
                """
                INSERT OR REPLACE INTO daily_assignment (date_ist, topic_id, status, created_at, updated_at, series_id, series_day_offset)
                VALUES (?, ?, 'assigned', ?, ?, ?, ?)
                """,
                (target_date, topic_id, now, now, series_id, item["day_offset"]),
            )

        conn.execute("UPDATE series SET status = 'active', updated_at = ? WHERE id = ?", (now, series_id))

    return _get_series(series_id)  # type: ignore[return-value]


# ── FFmpeg Editing Pipeline ────────────────────────────────────────────────────

import platform
import shutil
import subprocess
import tempfile
import threading

import requests as _requests

from .config import ASSET_DIRS, OUTPUTS_DIR, PEXELS_API_KEY, PIXABAY_API_KEY, YOUTUBE_DATA_API_KEY
from .storage import list_assets as _list_assets

# Single in-memory job slot (one pipeline at a time)
_PIPELINE_JOB: dict[str, Any] = {"status": None, "progress": "", "output_path": None, "date_ist": None}

# Visual bible cache: date_ist → {entity_key: {name, definition}}
_VISUAL_BIBLE_CACHE: dict[str, dict] = {}


def _srt_ts(secs: float) -> str:
    h = int(secs // 3600)
    m = int((secs % 3600) // 60)
    s = int(secs % 60)
    ms = int(round((secs % 1) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _pil_font(size: int, bold: bool = False, serif: bool = False):
    from PIL import ImageFont
    system = platform.system()
    candidates: list[str] = []
    if system == "Windows":
        if serif:
            candidates = ["C:/Windows/Fonts/times.ttf", "C:/Windows/Fonts/timesbd.ttf"]
        elif bold:
            candidates = ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"]
        else:
            candidates = ["C:/Windows/Fonts/arial.ttf"]
    elif system == "Darwin":
        candidates = ["/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]
    else:
        candidates = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _generate_newspaper_card(plain_text: str, output_path: str) -> str:
    """Pillow: aged newspaper cutout card PNG (860×220, RGBA)."""
    from PIL import Image, ImageDraw

    W, H = 860, 220
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cream = (248, 236, 202, 238)
    border_col = (120, 88, 28, 255)
    draw.rounded_rectangle([0, 0, W - 1, H - 1], radius=8, fill=cream)
    draw.rounded_rectangle([4, 4, W - 5, H - 5], radius=6, outline=border_col, width=2)
    draw.rounded_rectangle([8, 8, W - 9, H - 9], radius=4, outline=border_col, width=1)

    hdr_font = _pil_font(13, bold=True)
    body_font = _pil_font(18, serif=True)

    draw.text((18, 13), "■  EVIDENCE", font=hdr_font, fill=(110, 72, 18, 255))
    draw.line([18, 34, W - 18, 34], fill=border_col, width=1)

    # Word-wrap body text (max 3 lines, ~72 chars each)
    words = plain_text.split()
    lines: list[str] = []
    line: list[str] = []
    for word in words:
        if len(" ".join(line + [word])) > 72 and line:
            lines.append(" ".join(line))
            line = [word]
        else:
            line.append(word)
    if line:
        lines.append(" ".join(line))

    y = 44
    for ln in lines[:3]:
        draw.text((18, y), ln, font=body_font, fill=(28, 18, 8, 255))
        y += 28

    img.save(output_path, "PNG")
    return output_path


def _generate_captions_srt(a_roll_path: str, work_dir: str) -> str:
    """Run Whisper on the a-roll audio and write an SRT file."""
    try:
        import whisper as _whisper
    except ImportError as exc:
        raise RuntimeError("openai-whisper not installed. Run: pip install openai-whisper") from exc

    model = _whisper.load_model("tiny")
    result = model.transcribe(a_roll_path)

    lines: list[str] = []
    for i, seg in enumerate(result.get("segments", []), 1):
        lines.append(f"{i}\n{_srt_ts(seg['start'])} --> {_srt_ts(seg['end'])}\n{seg['text'].strip()}\n")

    srt_path = os.path.join(work_dir, "captions.srt")
    with open(srt_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return srt_path


def _load_latest_script_json(date_ist: str) -> dict[str, Any] | None:
    """Load the latest saved script for a date, with shot_type/b_roll_slot normalized.
    All pipeline/b-roll code paths must go through this (not a raw DB read) so a script
    saved before a shot_type policy change still gets today's rules applied on use."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT script_json FROM scripts WHERE date_ist = ? ORDER BY version DESC LIMIT 1",
            (date_ist,),
        ).fetchone()
    if not row:
        return None
    script = json.loads(row["script_json"])
    _enforce_shot_types(script)
    return script


def _resolve_pipeline_assets(date_ist: str) -> dict[str, Any]:
    """Return a_roll file path, b_roll map (section_idx→path), and sections list."""
    script = _load_latest_script_json(date_ist)
    if not script:
        raise ValueError(f"No script found for {date_ist}. Generate a script first.")

    sections: list[dict] = script.get("sections", [])

    # Find a-roll (most recent upload for this date, or just latest)
    all_a = _list_assets("a_roll")
    dated = [a for a in all_a if a.get("recording_date") == date_ist]
    a_roll = (dated or all_a or [None])[0]
    if not a_roll:
        raise ValueError("No a_roll video uploaded. Upload your recording first.")
    a_roll_path = a_roll["file_path"]
    if not Path(a_roll_path).exists():
        raise ValueError(f"a_roll file missing on disk: {a_roll_path}")

    # Find b-roll assets matched to b_roll sections
    b_roll_assets = _list_assets("b_roll_custom")
    b_roll_map: dict[int, str] = {}
    for sec in sections:
        if sec.get("shot_type") == "b_roll":
            sec_idx: int = sec["index"]
            match = next(
                (a for a in b_roll_assets if a.get("section_index") == sec_idx and Path(a["file_path"]).exists()),
                None,
            )
            if match:
                b_roll_map[sec_idx] = match["file_path"]

    return {"a_roll_path": a_roll_path, "b_roll_map": b_roll_map, "sections": sections}


BROLL_CLIP_MIN_S = 3.0
BROLL_CLIP_MAX_S = 24.0  # 3 Veo shots x 8s each — the multi-shot system's real ceiling


def _broll_clip_duration(section_dur: float) -> float:
    return max(BROLL_CLIP_MIN_S, min(section_dur, BROLL_CLIP_MAX_S))


# ── AI B-Roll (Imagen 3 + Gemini prompt builder) ──────────────────────────────

def _build_single_veo_prompt(section: dict, b_roll_prompt: str, narration: str, on_screen: str = "", visual_bible: dict | None = None) -> str:
    """Call Gemini to write one detailed Veo prompt. Fallback: return b_roll_prompt as-is."""
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key or not _GENAI_AVAILABLE:
        return b_roll_prompt

    section_label = section.get("label", section.get("name", ""))
    bible_section = _visual_bible_block(visual_bible or {})
    meta_prompt = f"""You are a cinematographer writing a Veo AI video generation prompt for a finance/business short-form vertical video.

Section: "{section_label}"
Narration the viewer hears: "{narration}"
Original visual concept: "{b_roll_prompt}"
{f'On-screen text: "{on_screen}"' if on_screen else ''}
{bible_section}
Write ONE complete Veo prompt (100-140 words, one paragraph) for an 8-second photorealistic cinematic 9:16 portrait clip.
Include: subject + action, camera movement + shot type, environment, lighting, colour grade, one texture detail.
Where entities from the Visual Consistency Guide appear, use their exact definitions in the prompt.
Real brands, people, products: all allowed. Portrait 9:16 framing.
Return ONLY the prompt text, no prefix or explanation."""

    try:
        client = _genai_module.Client(api_key=api_key)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=meta_prompt,
                config=_genai_module.types.GenerateContentConfig(
                    max_output_tokens=1200,
                    temperature=0.75,
                    automatic_function_calling=_genai_module.types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        text = (resp.text or "").strip()
        if len(text) > 40:
            return text
    except Exception as exc:
        print(f"[AI B-roll] Single prompt build failed: {exc}", flush=True)
    return b_roll_prompt


def _extract_narration(section: dict) -> str:
    raw = (
        section.get("plain_text") or section.get("text") or
        section.get("script") or section.get("voiceover") or section.get("content") or ""
    )
    if isinstance(raw, list):
        raw = " ".join(str(x) for x in raw)
    return re.sub(r'\[[A-Z ]+\]', '', str(raw)).strip()


def _build_veo_shots(section: dict, b_roll_prompt: str, total_duration_s: float, visual_bible: dict | None = None) -> list[dict]:
    """
    Ask Gemini to split the section narration into 2–3 directed Veo shots.
    Returns list of {moment, duration_s, prompt}.
    Falls back to a single generic shot on any failure.
    """
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key or not _GENAI_AVAILABLE:
        return [{"moment": "main shot", "duration_s": int(round(total_duration_s)), "prompt": b_roll_prompt}]

    section_label = section.get("label", section.get("name", ""))
    narration = _extract_narration(section)
    on_screen = section.get("on_screen_text", "")
    total_s = max(6, int(round(total_duration_s)))

    # Choose shot count: based on narration length (too-short narration → 1 shot; Veo max is 8s per clip)
    if len(narration) < 120:
        # Very short narration — not enough material to split meaningfully
        num_shots = 1
        shot_s = [min(8, total_s)]
    elif total_s <= 10:
        num_shots = 2
        shot_s = [min(8, total_s // 2), min(8, total_s - total_s // 2)]
    else:
        num_shots = 3
        base = min(8, total_s // 3)
        shot_s = [base, base, min(8, total_s - 2 * base)]

    if num_shots == 1:
        # Skip Gemini — just build a single-shot prompt using the old reliable path
        single = _build_single_veo_prompt(section, b_roll_prompt, narration, on_screen, visual_bible=visual_bible)
        return [{"moment": section_label or "main shot", "duration_s": shot_s[0], "prompt": single}]

    # Duration tags for the multi-shot prompt
    duration_tags = " / ".join(f"SHOT {i + 1} = {shot_s[i]}s" for i in range(num_shots))
    split_hint = f"Clip durations: {duration_tags} (Veo generates 8-second clips; FFmpeg will trim each to the target duration.)"

    meta_prompt = f"""You are an editorial director and senior cinematographer for a short-form finance/business documentary series optimised for vertical mobile screens.

CONTEXT — This b-roll plays while the narrator says:
Section role: "{section_label}"
Full narration: "{narration}"
Original visual concept note: "{b_roll_prompt}"
{f'On-screen text overlay: "{on_screen}"' if on_screen else ''}
Total b-roll duration: {total_s} seconds

YOUR TASK:
1. Read the narration carefully. Identify the 2 or 3 KEY VISUAL MOMENTS — distinct story beats (e.g. "the old era", "the disruption", "the comeback").
2. For EACH moment write one complete, fully-directed Veo video prompt.

{split_hint}

Each Veo prompt MUST cover ALL of these in one flowing paragraph:
- SUBJECT & ACTION: exactly what is shown and what is happening — name specific companies, brands, products, real locations, real people's roles (a cashier, a trader, an engineer) — be concrete not generic
- CAMERA: exact movement + shot type (slow dolly push-in / handheld tracking / low-angle wide / aerial descending / static extreme close-up)
- ENVIRONMENT: specific place, time of day, mood (a 1990s Mumbai kirana store at dusk / a gleaming modern supermarket mid-morning / a noisy stock exchange floor at opening bell)
- LIGHTING: quality and direction (warm golden rim light from a window / cold blue-white fluorescent overhead / dramatic side-lit from a phone screen)
- COLOR GRADE: cinematic look (warm honey tones with deep shadows / desaturated gritty documentary / punchy teal-orange)
- TEXTURE DETAIL: 1–2 tactile specifics that make it photorealistic (dust on old packaging / condensation on glass / peeling price stickers / ticker tape on the floor)

CRITICAL RULES:
- Prompts must be DIRECTLY tied to specific facts, companies, or events in the narration — not generic "business" imagery
- Faces, people (from behind or in silhouette or from afar), brand packaging, product labels: ALL ALLOWED — use them when they serve the story
- Vertical 9:16 portrait composition — subjects framed for a phone screen
- Each prompt: 100–140 words, one paragraph, no bullet points
- Return ONLY a valid JSON array. Absolutely no markdown fences, no explanation:

[
  {{
    "moment": "5–8 word label for this shot",
    "duration_s": <integer>,
    "prompt": "<complete Veo prompt paragraph>"
  }}
]"""

    # Single Gemini call: ask for all shots in a clearly-labeled section format that Gemini reliably follows
    bible_section = _visual_bible_block(visual_bible or {})
    combined_prompt = f"""You are an editorial director and senior cinematographer for a short-form finance/business documentary.

This b-roll sequence plays while the narrator says:
"{narration}"

Original visual concept note: "{b_roll_prompt}"
{bible_section}
Write {num_shots} separate Veo video prompts — one per clip.
Clip durations: {duration_tags} (Veo generates 8-second clips; FFmpeg will trim each to the target duration.)

Each clip must cover a DISTINCT visual story beat from the narration. Identify {num_shots} different moments, phases, or objects in the story and write one cinematic prompt for each.

For EACH clip write a 100–130 word cinematic paragraph covering:
- Subject and action (specific brands, products, real locations, people's roles — all allowed)
- Camera movement + shot type (slow dolly push-in / low-angle handheld / aerial crane / static macro close-up)
- Environment (specific place, time of day, atmosphere)
- Lighting (quality, direction, colour temperature)
- Colour grade (cinematic look e.g. warm honey / teal-orange / desaturated gritty)
- One tactile texture detail

Portrait 9:16 vertical framing for phone screens.
Where entities from the VISUAL CONSISTENCY GUIDE appear in a shot, embed their exact visual specifications into the prompt — do not rephrase or shorten them.

Format your response EXACTLY like this:

SHOT 1 — <5-8 word moment label>
<full cinematic prompt paragraph>

SHOT 2 — <5-8 word moment label>
<full cinematic prompt paragraph>

SHOT 3 — <5-8 word moment label>
<full cinematic prompt paragraph>

Only write the shots in the format above. No introduction, no explanation."""

    try:
        client = _genai_module.Client(api_key=api_key)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=combined_prompt,
                config=_genai_module.types.GenerateContentConfig(
                    max_output_tokens=8192,
                    temperature=0.75,
                    automatic_function_calling=_genai_module.types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        raw = (resp.text or "").strip()

        # Parse: split on "SHOT N — " headers
        shot_blocks = re.split(r'\nSHOT\s+\d+\s*[—–-]+\s*', "\n" + raw)
        shot_blocks = [b.strip() for b in shot_blocks if b.strip()]

        if len(shot_blocks) < 2:
            raise ValueError(f"Expected ≥2 shot blocks, got {len(shot_blocks)}: {raw[:200]}")

        parsed_shots: list[dict] = []
        for i, block in enumerate(shot_blocks[:num_shots]):
            # First line is the moment label, rest is the prompt
            blines = block.strip().splitlines()
            if len(blines) >= 2:
                moment = blines[0].strip().strip("—–-").strip()
                prompt_text = " ".join(l.strip() for l in blines[1:] if l.strip())
            else:
                moment = f"Shot {i + 1}"
                prompt_text = block.strip()
            parsed_shots.append({
                "moment": moment,
                "duration_s": shot_s[i] if i < len(shot_s) else 4,
                "prompt": prompt_text,
            })

        if not all(len(s["prompt"]) > 40 for s in parsed_shots):
            raise ValueError("One or more shots has a short/missing prompt")

        print(f"[AI B-roll] Shot plan: {len(parsed_shots)} shots, durations={[s['duration_s'] for s in parsed_shots]}", flush=True)
        return parsed_shots

    except Exception as exc:
        print(f"[AI B-roll] Multi-shot build failed ({exc}), falling back to single shot", flush=True)

    return [{"moment": "main shot", "duration_s": total_s, "prompt": b_roll_prompt}]


def _generate_single_veo_clip(
    prompt: str,
    target_duration_s: int,
    output_path: str,
    vertex_project: str,
    vertex_location: str,
    log_cb=None,
) -> bool:
    """Generate one 8-second Veo clip, trim to target_duration_s, normalize to 1080×1920. Returns True on success."""
    def _log(msg: str):
        print(f"[Veo] {msg}", flush=True)
        if log_cb:
            log_cb(msg)

    try:
        client = _genai_module.Client(vertexai=True, project=vertex_project, location=vertex_location)
        source = _genai_module.types.GenerateVideosSource(prompt=prompt)
        config = _genai_module.types.GenerateVideosConfig(
            number_of_videos=1, aspect_ratio="9:16", duration_seconds=8, generate_audio=False
        )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            operation = client.models.generate_videos(model="veo-3.1-generate-001", source=source, config=config)

        waited = 0
        while not operation.done:
            time.sleep(10)
            waited += 10
            operation = client.operations.get(operation)
            _log(f"Generating… ({waited}s)")
            if waited > 420:
                _log("Timeout after 7 min")
                return False

        result = operation.result
        if not result or not getattr(result, "generated_videos", None):
            _log("No videos returned")
            return False

        video = result.generated_videos[0].video

        # Get bytes — inline first, then GCS download
        video_bytes = None
        if getattr(video, "video_bytes", None):
            video_bytes = video.video_bytes
        elif getattr(video, "uri", None):
            _log("Fetching from GCS…")
            import google.auth, google.auth.transport.requests, requests as _reqs
            creds, _ = google.auth.default()
            creds.refresh(google.auth.transport.requests.Request())
            url = video.uri.replace("gs://", "https://storage.googleapis.com/")
            r = _reqs.get(url, headers={"Authorization": f"Bearer {creds.token}"}, timeout=60)
            r.raise_for_status()
            video_bytes = r.content

        if not video_bytes:
            _log("No video bytes")
            return False

        tmp_raw = os.path.join(tempfile.gettempdir(), f"veo_raw_{os.getpid()}_{os.path.basename(output_path)}")
        with open(tmp_raw, "wb") as f:
            f.write(video_bytes)

        # Normalize + trim: scale to 1080×1920, trim to target_duration_s, libx264
        ff = subprocess.run(
            [
                "ffmpeg", "-y", "-i", tmp_raw,
                "-t", str(target_duration_s),
                "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,"
                       "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-an", "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, text=True, timeout=120,
        )
        try:
            os.unlink(tmp_raw)
        except OSError:
            pass

        if ff.returncode != 0:
            _log(f"FFmpeg failed: {ff.stderr[-300:]}")
            return False

        size_kb = Path(output_path).stat().st_size // 1024
        _log(f"✓ {target_duration_s}s clip ready ({size_kb} KB)")
        return True

    except Exception as exc:
        _log(f"Failed: {exc}")
        return False


def _generate_ai_broll(
    section: dict,
    b_roll_prompt: str,
    duration_s: float,
    output_path: str,
    log_cb=None,
    visual_bible: dict | None = None,
) -> str | None:
    """
    Multi-shot AI b-roll pipeline:
    1. Gemini splits narration into 2–3 directed Veo shots (with visual bible injection)
    2. Shots are generated in parallel via Veo 3.1 on Vertex AI
    3. FFmpeg trims + normalises each clip, then concatenates them
    """
    def _log(msg: str):
        print(f"[AI B-roll] {msg}", flush=True)
        if log_cb:
            log_cb(msg)

    vertex_project = os.environ.get("VERTEX_PROJECT", "")
    vertex_location = os.environ.get("VERTEX_LOCATION", "us-central1")

    if not _GENAI_AVAILABLE:
        _log("google-genai not installed")
        return None
    if not vertex_project:
        _log("VERTEX_PROJECT not set")
        return None

    section_name = section.get("name", "")
    narration = _extract_narration(section)
    _log(f"Section: '{section_name}' | concept: '{b_roll_prompt[:80]}'")
    _log(f"Narration: '{narration}'")
    if visual_bible:
        _log(f"Visual bible: {len(visual_bible)} entities active")

    _log("Building multi-shot plan with Gemini…")
    shots = _build_veo_shots(section, b_roll_prompt, duration_s, visual_bible=visual_bible)

    _log(f"Shot plan: {len(shots)} clips")
    for i, s in enumerate(shots):
        _log(f"  Shot {i + 1} ({s['duration_s']}s) — {s['moment']}")
        _log(f"    Prompt: {s['prompt'][:120]}…")

    # Generate all shots in parallel
    sec_idx = section.get("index", 0)
    clip_paths = [
        os.path.join(tempfile.gettempdir(), f"veo_shot_{os.getpid()}_{sec_idx}_{i}.mp4")
        for i in range(len(shots))
    ]

    _log(f"Launching {len(shots)} Veo generation(s) in parallel…")
    success_flags: list[bool] = [False] * len(shots)

    def _gen_shot(i: int) -> bool:
        return _generate_single_veo_clip(
            prompt=shots[i]["prompt"],
            target_duration_s=int(shots[i]["duration_s"]),
            output_path=clip_paths[i],
            vertex_project=vertex_project,
            vertex_location=vertex_location,
            log_cb=lambda m, _i=i: _log(f"[shot {_i + 1}] {m}"),
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(shots)) as pool:
        futures = {pool.submit(_gen_shot, i): i for i in range(len(shots))}
        for future in concurrent.futures.as_completed(futures):
            idx = futures[future]
            success_flags[idx] = bool(future.result())
            _log(f"Shot {idx + 1} {'✓' if success_flags[idx] else '✗'}")

    successful_clips = [clip_paths[i] for i in range(len(shots)) if success_flags[i]]

    if not successful_clips:
        _log("All shots failed")
        return None

    if len(successful_clips) == 1:
        import shutil as _sh
        _sh.move(successful_clips[0], output_path)
        size_kb = Path(output_path).stat().st_size // 1024
        _log(f"✓ Single clip ready ({size_kb} KB)")
        return output_path

    # Concat all successful clips with FFmpeg (streams already uniform — fast copy)
    filelist = os.path.join(tempfile.gettempdir(), f"veo_concat_{os.getpid()}_{sec_idx}.txt")
    with open(filelist, "w") as fh:
        for cp in successful_clips:
            fh.write(f"file '{cp}'\n")

    ff = subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", filelist, "-c", "copy", output_path],
        capture_output=True, text=True, timeout=60,
    )
    try:
        os.unlink(filelist)
    except OSError:
        pass
    for cp in successful_clips:
        try:
            os.unlink(cp)
        except OSError:
            pass

    if ff.returncode != 0:
        _log(f"FFmpeg concat failed: {ff.stderr[-300:]}")
        return None

    size_kb = Path(output_path).stat().st_size // 1024
    _log(f"✓ {len(successful_clips)}-shot concat ready ({size_kb} KB)")
    return output_path


def _compute_visual_bible(date_ist: str, sections: list) -> dict:
    """One Gemini call on all narrations to extract every visual entity with a canonical description.
    Returns {entity_key: {name, definition}}. Cached in memory per date so subsequent calls are instant.
    """
    if date_ist in _VISUAL_BIBLE_CACHE:
        return _VISUAL_BIBLE_CACHE[date_ist]

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key or not _GENAI_AVAILABLE:
        return {}

    narration_lines = []
    for sec in sections:
        name = sec.get("name", "")
        narration = _extract_narration(sec)
        if narration:
            narration_lines.append(f"[{name}]: {narration}")

    if not narration_lines:
        return {}

    narrations_text = "\n".join(narration_lines)

    prompt = f"""You are a visual consistency director for an AI-generated short-form documentary video.

Today's script narration (all sections):

{narrations_text}

Your task: identify EVERY distinct visual entity that appears in this script that an AI video generator will render on screen. Include ALL of:
- People and roles (the exporter, the trader, the founder, the regulator — anyone mentioned)
- Companies and brands (Britannia, ITC, Reliance, SEBI, RBI, Mundra Port — any mentioned)
- Products and SKUs (Tiger biscuits packet, Parle-G wrapper, a shipping container — any mentioned)
- Locations and settings (Mundra Port terminal, kirana store, trading floor, factory floor — any mentioned)
- Key visual objects (INR/USD chart on screen, shipping manifest, ledger book, currency notes — any mentioned)

For EACH entity write ONE definitive 40-60 word visual specification, precise enough that an AI video generator renders it IDENTICALLY every time it appears.

Specify for people: gender, approximate age, build, skin tone, facial features, exact clothing (colours, fabric, cut), expression, posture.
Specify for brands/products: exact shape, colour, label text placement, material texture, surface finish, packaging context.
Specify for locations: architectural style, scale, lighting quality, colour palette, crowd density, key visual elements.
Specify for objects: shape, material, colour, condition (worn/new/digital/printed), typical usage context.

Return ONLY in this exact format — one entity per block, nothing else:

ENTITY: <snake_case_key>
NAME: <display name>
DEFINITION: <40-60 word visual specification on one line>
---
"""

    try:
        client = _genai_module.Client(api_key=api_key)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=_genai_module.types.GenerateContentConfig(
                    max_output_tokens=8192,
                    temperature=0.3,
                    automatic_function_calling=_genai_module.types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        raw = (resp.text or "").strip()

        bible: dict = {}
        for block in raw.split("---"):
            block = block.strip()
            if not block:
                continue
            entity_key = name_val = ""
            def_lines: list[str] = []
            in_def = False
            for line in block.splitlines():
                line = line.strip()
                if line.startswith("ENTITY:"):
                    entity_key = line[7:].strip()
                    in_def = False
                elif line.startswith("NAME:"):
                    name_val = line[5:].strip()
                    in_def = False
                elif line.startswith("DEFINITION:"):
                    def_lines.append(line[11:].strip())
                    in_def = True
                elif in_def and line:
                    def_lines.append(line)
            definition = " ".join(def_lines).strip()
            if entity_key and definition:
                bible[entity_key] = {"name": name_val or entity_key, "definition": definition}

        print(f"[Visual Bible] {len(bible)} entities: {list(bible.keys())}", flush=True)
        _VISUAL_BIBLE_CACHE[date_ist] = bible
        return bible

    except Exception as exc:
        print(f"[Visual Bible] Failed: {exc}", flush=True)
        _VISUAL_BIBLE_CACHE[date_ist] = {}
        return {}


def _visual_bible_block(visual_bible: dict) -> str:
    """Format a visual bible as a VISUAL CONSISTENCY GUIDE block for prompt injection."""
    if not visual_bible:
        return ""
    specs = "\n".join(f"• {v['name']}: {v['definition']}" for v in visual_bible.values())
    return (
        "\nVISUAL CONSISTENCY GUIDE — whenever any of these elements appear in a shot, "
        "use EXACTLY these descriptions word-for-word. Do not rephrase or vary:\n"
        + specs + "\n"
    )


def _yt_api_key() -> str:
    """Read YOUTUBE_DATA_API_KEY fresh from env each call so server restart is not required."""
    return os.environ.get("YOUTUBE_DATA_API_KEY") or YOUTUBE_DATA_API_KEY


def _yt_base_args() -> list[str]:
    """Return base yt-dlp args including Node.js runtime (for n-challenge) and cookies."""
    args = ["--js-runtimes", "node"]
    cookies_file = os.environ.get("YOUTUBE_COOKIES_FILE", "")
    if cookies_file:
        # Resolve relative path against the backend directory
        p = Path(cookies_file)
        if not p.is_absolute():
            p = Path(__file__).parent.parent / cookies_file
        if p.exists():
            args += ["--cookies", str(p)]
    return args


def _yt_short_query(prompt: str) -> str:
    """Extract a short YouTube-friendly search query from a verbose b-roll prompt."""
    # Take text up to first period or second comma, max 60 chars, strip cinematic lead-in words
    for sep in (".", ","):
        part = prompt.split(sep)[0].strip()
        if 15 <= len(part) <= 80:
            return part
    # Fallback: first 60 chars up to word boundary
    if len(prompt) <= 60:
        return prompt
    cut = prompt[:60].rsplit(" ", 1)[0]
    return cut


def _search_youtube(query: str, max_results: int = 5) -> list[str]:
    """Search YouTube Data API v3, return up to max_results video IDs."""
    key = _yt_api_key()
    if not key:
        raise ValueError("YOUTUBE_DATA_API_KEY not set")
    short_q = _yt_short_query(query) + " documentary footage"
    print(f"[B-roll] YT search query: '{short_q}'", flush=True)
    resp = _requests.get(
        "https://www.googleapis.com/youtube/v3/search",
        params={
            "part": "id",
            "q": short_q,
            "type": "video",
            "videoDuration": "medium",  # 4–20 min — eliminates Shorts and tiny clips
            "maxResults": max_results,
            "key": key,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return [item["id"]["videoId"] for item in resp.json().get("items", []) if "videoId" in item.get("id", {})]


def _get_video_transcript(video_id: str) -> list[dict] | None:
    """Return transcript segments [{text, start, duration}] for a YouTube video, or None."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        return YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US", "en-GB"])
    except Exception:
        pass
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        listings = YouTubeTranscriptApi.list_transcripts(video_id)
        return listings.find_generated_transcript(["en"]).fetch()
    except Exception:
        return None


def _find_best_clip_with_gemini(transcript: list[dict], b_roll_prompt: str, duration_s: float) -> dict:
    """Ask Gemini to find the best timestamp window in a transcript for the given b-roll requirement."""
    lines = []
    for seg in transcript[:200]:
        t_s = seg["start"]
        t_e = t_s + seg.get("duration", 2.0)
        lines.append(f"[{t_s:.1f}-{t_e:.1f}s] {seg['text'].strip()}")
    transcript_text = "\n".join(lines)
    total_dur = (transcript[-1]["start"] + transcript[-1].get("duration", 2.0)) if transcript else 60.0

    gemini_prompt = (
        f"You are selecting a b-roll video clip segment.\n\n"
        f"B-roll visual requirement: {b_roll_prompt}\n"
        f"Clip duration needed: {duration_s:.1f} seconds\n\n"
        f"Video transcript with timestamps:\n{transcript_text}\n\n"
        f"Find the single best {duration_s:.1f}-second window where the footage ON SCREEN "
        f"would best match the visual requirement. Consider what speakers say as a proxy for what is shown.\n"
        f"Pick a start time that is at least 5 seconds into the video.\n\n"
        f'Respond ONLY with valid JSON: {{"start_s": <float>, "end_s": <float>, "reason": "<one line>"}}'
    )

    try:
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if api_key and _GENAI_AVAILABLE:
            import warnings as _w
            client = _genai_module.Client(api_key=api_key)
            with _w.catch_warnings():
                _w.simplefilter("ignore")
                resp = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=gemini_prompt,
                    config=_genai_module.types.GenerateContentConfig(max_output_tokens=256, temperature=0.2),
                )
            text = resp.text or ""
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1:
                raw = json.loads(_clean_llm_json(text[start : end + 1]))
                s = float(raw.get("start_s", 5.0))
                e = float(raw.get("end_s", s + duration_s))
                if e - s < duration_s * 0.8:
                    e = s + duration_s
                return {"start_s": s, "end_s": e, "reason": raw.get("reason", "")}
    except Exception as exc:
        print(f"[B-roll] Gemini clip selection failed: {exc}", flush=True)

    # Fallback: use the beginning of the video
    return {"start_s": 0.0, "end_s": duration_s, "reason": "fallback: start of video"}


def _find_best_clip_with_gemini_vision(
    video_id: str, b_roll_prompt: str, duration_s: float, vid_dur: float
) -> dict:
    """Download full video at lowest quality, sample frames across entire duration,
    send to Gemini Vision to pick the best matching window."""
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key or not _GENAI_AVAILABLE:
        return {"start_s": 0.0, "end_s": duration_s, "reason": "no gemini key, using start"}
    if not shutil.which("ffmpeg"):
        return {"start_s": 0.0, "end_s": duration_s, "reason": "no ffmpeg for frames, using start"}

    import tempfile, warnings as _w

    yt_url = f"https://www.youtube.com/watch?v={video_id}"
    tmp_sample = os.path.join(tempfile.gettempdir(), f"broll_sample_{video_id}.mp4")
    frames_dir = os.path.join(tempfile.gettempdir(), f"broll_frames_{video_id}")

    try:
        # Download full video at lowest quality — 144p for a 10-min video is ~5 MB
        Path(tmp_sample).unlink(missing_ok=True)
        print(f"[B-roll] Downloading low-quality sample for vision analysis…", flush=True)
        dl = subprocess.run(
            [
                "yt-dlp",
                "-f", "worst[ext=mp4]/worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst",
                "--merge-output-format", "mp4",
                "--no-playlist", "--force-overwrites",
                *_yt_base_args(),
                "-o", tmp_sample, yt_url,
            ],
            capture_output=True, text=True, timeout=300,
        )
        if dl.returncode != 0 or not Path(tmp_sample).exists():
            print(f"[B-roll] Low-quality download failed: {dl.stderr[-200:]}", flush=True)
            return {"start_s": 0.0, "end_s": duration_s, "reason": "sample download failed, using start"}

        # Get actual duration of downloaded sample
        fp = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", tmp_sample],
            capture_output=True, text=True,
        )
        actual_dur = float(fp.stdout.strip()) if fp.stdout.strip() else vid_dur

        # Extract 20 frames spread evenly across the FULL video
        # e.g. 10-min video → 1 frame every 30s = 20 frames covering everything
        n_frames = 20
        interval = max(5.0, actual_dur / n_frames)
        import shutil as _sh
        _sh.rmtree(frames_dir, ignore_errors=True)
        os.makedirs(frames_dir, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_sample,
             "-vf", f"fps=1/{interval:.1f},scale=480:-1",
             os.path.join(frames_dir, "frame_%03d.jpg")],
            capture_output=True, timeout=60,
        )

        frame_files = sorted(Path(frames_dir).glob("frame_*.jpg"))
        if not frame_files:
            return {"start_s": 0.0, "end_s": duration_s, "reason": "no frames extracted, using start"}

        print(f"[B-roll] Sending {len(frame_files)} frames to Gemini Vision (video={actual_dur:.0f}s, interval={interval:.0f}s)…", flush=True)

        # Build contents: instruction + interleaved [timestamp label, image] pairs
        client = _genai_module.Client(api_key=api_key)
        contents: list = [
            f"You are a b-roll video clip selector. Your job has TWO steps:\n"
            f"STEP 1 — decide if this video contains footage that genuinely matches the requirement.\n"
            f"STEP 2 — if yes, find the best {duration_s:.0f}-second window; if no, say so.\n\n"
            f"B-roll requirement: {b_roll_prompt}\n\n"
            f"The frames below are sampled every {interval:.0f} seconds from a {actual_dur:.0f}-second video. "
            f"Each frame is labeled with its approximate timestamp.\n\n"
            f"IMPORTANT: Only select a window if at least one frame CLEARLY shows the required subject. "
            f"If the video is irrelevant (intro cards, unrelated footage, wrong subject), set 'match': false.\n\n"
            f'Respond ONLY with JSON:\n'
            f'  If matching: {{"match": true, "start_s": <float>, "end_s": <float>, "reason": "<one line>"}}\n'
            f'  If not matching: {{"match": false, "reason": "<why it does not match>"}}'
        ]
        for i, frame_path in enumerate(frame_files[:20]):
            ts = i * interval
            contents.append(f"\n[Frame at {ts:.0f}s]")
            contents.append(_genai_module.types.Part.from_bytes(
                data=frame_path.read_bytes(), mime_type="image/jpeg"
            ))

        with _w.catch_warnings():
            _w.simplefilter("ignore")
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=_genai_module.types.GenerateContentConfig(max_output_tokens=300, temperature=0.1),
            )

        text = resp.text or ""
        s_idx = text.find("{")
        e_idx = text.rfind("}")
        if s_idx != -1 and e_idx != -1:
            raw = json.loads(_clean_llm_json(text[s_idx: e_idx + 1]))
            if not raw.get("match", True):
                print(f"[B-roll] Vision rejected video: {raw.get('reason', '')}", flush=True)
                return None  # signal caller to try next video
            s = max(0.0, float(raw.get("start_s", 0.0)))
            e = float(raw.get("end_s", s + duration_s))
            if e - s < duration_s * 0.8:
                e = s + duration_s
            e = min(e, actual_dur - 0.5)
            print(f"[B-roll] Vision selected {s:.1f}s–{e:.1f}s: {raw.get('reason', '')}", flush=True)
            return {"start_s": s, "end_s": e, "reason": f"vision: {raw.get('reason', '')}"}

    except Exception as exc:
        print(f"[B-roll] Gemini Vision failed: {exc}", flush=True)
    finally:
        Path(tmp_sample).unlink(missing_ok=True)
        import shutil as _sh
        _sh.rmtree(frames_dir, ignore_errors=True)

    return {"start_s": 0.0, "end_s": duration_s, "reason": "vision fallback: using start"}


def _download_youtube_clip(video_id: str, start_s: float, end_s: float, output_path: str) -> str | None:
    """Download full video to a temp file with yt-dlp, then cut the exact segment with FFmpeg.
    Two-step approach is required because YouTube DASH CDN URLs are segment-indexed — FFmpeg
    cannot seek into them reliably."""
    if not shutil.which("yt-dlp") or not shutil.which("ffmpeg"):
        print("[B-roll] yt-dlp or ffmpeg not found", flush=True)
        return None

    yt_url = f"https://www.youtube.com/watch?v={video_id}"
    duration = end_s - start_s
    tmp_path = str(Path(output_path).with_suffix("")) + "_tmp_full.mp4"
    Path(output_path).unlink(missing_ok=True)
    Path(tmp_path).unlink(missing_ok=True)

    try:
        # Step 1: download full video with yt-dlp
        print(f"[B-roll] Downloading full video {video_id} to temp file…", flush=True)
        dl = subprocess.run(
            [
                "yt-dlp",
                "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
                "--merge-output-format", "mp4",
                "--no-playlist",
                "--force-overwrites",
                *_yt_base_args(),
                "-o", tmp_path,
                yt_url,
            ],
            capture_output=True, text=True, timeout=600,
        )
        print(f"[B-roll] yt-dlp rc={dl.returncode}", flush=True)
        if dl.returncode != 0 or not Path(tmp_path).exists():
            print(f"[B-roll] yt-dlp failed: {dl.stderr[-300:]}", flush=True)
            return None

        tmp_size = Path(tmp_path).stat().st_size
        print(f"[B-roll] Full video downloaded ({tmp_size // 1024} KB), cutting {start_s:.1f}s–{end_s:.1f}s…", flush=True)

        # Step 2: cut exact segment from local file with FFmpeg
        ff = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", f"{start_s:.3f}",
                "-t", f"{duration:.3f}",
                "-i", tmp_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, text=True, timeout=120,
        )
        print(f"[B-roll] FFmpeg rc={ff.returncode}", flush=True)
        if ff.returncode != 0:
            print(f"[B-roll] FFmpeg stderr: {ff.stderr[-300:]}", flush=True)

        p = Path(output_path)
        if p.exists() and p.stat().st_size > 10_000:
            return output_path

        size = p.stat().st_size if p.exists() else 0
        print(f"[B-roll] Output too small ({size} bytes)", flush=True)
        p.unlink(missing_ok=True)
        return None
    except Exception as exc:
        print(f"[B-roll] download_youtube_clip error: {exc}", flush=True)
        return None
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _get_video_duration(video_id: str) -> float | None:
    """Return video duration in seconds using yt-dlp --print duration. Returns None on failure."""
    try:
        r = subprocess.run(
            ["yt-dlp", "--no-playlist", "--print", "duration",
             *_yt_base_args(),
             f"https://www.youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode == 0 and r.stdout.strip():
            return float(r.stdout.strip())
    except Exception:
        pass
    return None


def _fetch_broll_youtube(
    prompt: str,
    duration_s: float,
    output_path: str,
    log_cb=None,
) -> str | None:
    """Search YouTube for a b-roll clip matching prompt, identify the best segment with Gemini, download it.
    log_cb: optional callable(str) called for each status line in addition to print().
    """
    def _log(msg: str) -> None:
        print(f"[B-roll] {msg}", flush=True)
        if log_cb:
            log_cb(msg)

    if not _yt_api_key():
        _log("YOUTUBE_DATA_API_KEY not set — add it to backend/.env")
        return None

    try:
        video_ids = _search_youtube(prompt)
        _log(f"Search returned {len(video_ids)} video(s)")
    except Exception as exc:
        _log(f"YouTube search failed: {exc}")
        return None

    if not video_ids:
        _log(f"No YouTube results for: {prompt[:60]}")
        return None

    for video_id in video_ids:
        _log(f"Trying video {video_id}")

        # Skip videos shorter than what we need
        vid_dur = _get_video_duration(video_id)
        if vid_dur is not None and vid_dur < duration_s + 3:
            _log(f"  Skipping — video only {vid_dur:.0f}s (need >{duration_s+3:.0f}s)")
            continue

        transcript = _get_video_transcript(video_id)
        if transcript:
            _log(f"  Transcript: {len(transcript)} segments — asking Gemini for best clip")
            clip_info = _find_best_clip_with_gemini(transcript, prompt, duration_s)
        else:
            _log(f"  No transcript — using Gemini Vision on video frames")
            clip_info = _find_best_clip_with_gemini_vision(video_id, prompt, duration_s, vid_dur or 60.0)

        if clip_info is None:
            _log(f"  Vision rejected video — no matching footage, trying next")
            continue

        s, e = clip_info["start_s"], clip_info["end_s"]
        # Guard: don't start past the end of the video
        if vid_dur and s + duration_s > vid_dur:
            s = max(0.0, vid_dur - duration_s - 1)
            e = s + duration_s
        _log(f"  Clip {s:.1f}s–{e:.1f}s ({clip_info['reason']})")
        _log(f"  Downloading via yt-dlp…")
        path = _download_youtube_clip(video_id, s, e, output_path)
        if path:
            _log(f"✓ Saved → {Path(path).name}")
            return path
        _log(f"  ✗ Download failed, trying next video")

    _log(f"All {len(video_ids)} video(s) failed for: {prompt[:60]}")
    return None


def _probe_duration(path: str) -> float:
    """Return a media file's duration in seconds via ffprobe, or 0.0 on failure."""
    try:
        fp = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=30,
        )
        return float(fp.stdout.strip()) if fp.stdout.strip() else 0.0
    except Exception:
        return 0.0


def _build_ffmpeg_cmd(
    a_roll_path: str,
    b_roll_map: dict[int, str],
    sections: list[dict],
    srt_path: str,
    newspaper_png: str | None,
    output_path: str,
    total_s: float = 0.0,
) -> list[str]:
    CW, CH = 1080, 1920

    # Scale any 16:9 clip to fill 9:16 canvas — zoom-fill then center-crop
    FILL = (
        f"scale={CW}:{CH}:force_original_aspect_ratio=increase,"
        f"crop={CW}:{CH}"
    )

    # ── Inputs ────────────────────────────────────────────────────────────────
    inputs: list[str] = ["-i", a_roll_path]
    broll_inp: dict[int, int] = {}  # section_index → ffmpeg input index
    for sec_idx in sorted(b_roll_map):
        inputs += ["-i", b_roll_map[sec_idx]]
        broll_inp[sec_idx] = len(broll_inp) + 1

    np_idx: int | None = None
    if newspaper_png:
        inputs += ["-loop", "1", "-i", newspaper_png]
        np_idx = len(broll_inp) + 1

    # ── Filter graph ──────────────────────────────────────────────────────────
    fc: list[str] = []

    # A-roll → full-screen 9:16 (zoom-fill + crop)
    fc.append(f"[0:v]{FILL}[aroll]")

    # Each b-roll → full-screen 9:16
    for sec_idx, i_idx in broll_inp.items():
        fc.append(f"[{i_idx}:v]{FILL}[br{sec_idx}]")

    # Build video timeline: a-roll is base; b-roll clips overlay during their sections
    vid = "aroll"
    for k, sec_idx in enumerate(sorted(broll_inp)):
        sec = next((s for s in sections if s.get("index") == sec_idx), None)
        if not sec:
            continue
        t0, t1 = sec["timing"]["start_s"], sec["timing"]["end_s"]
        # Clamp the overlay window to how much b-roll footage actually exists, so the
        # clip plays through once and then reverts to a-roll instead of freezing on
        # its last frame for the remainder of the section.
        clip_dur = _probe_duration(b_roll_map[sec_idx])
        t1_eff = min(t1, t0 + clip_dur) if clip_dur > 0 else t1
        # Delay the b-roll stream's own timeline so frame 0 lands at t0 — overlay
        # otherwise plays both inputs from absolute time 0, desyncing short clips.
        delayed = f"br{sec_idx}d"
        fc.append(f"[br{sec_idx}]setpts=PTS+{t0}/TB[{delayed}]")
        nxt = f"bv{k}"
        fc.append(
            f"[{vid}][{delayed}]overlay=0:0:enable='between(t,{t0},{t1_eff})'[{nxt}]"
        )
        vid = nxt

    # Newspaper card overlay — evidence section only
    # Screen zones:  captions  = bottom 20 %  → y > 1536
    #                newspaper = 57–69 %      → y 1090–1310  (safe gap above captions)
    if np_idx is not None:
        ev = next((s for s in sections if s.get("name") == "evidence"), None)
        if ev:
            t0, t1 = ev["timing"]["start_s"], ev["timing"]["end_s"]
            NW, NH = 860, 220
            NX = (CW - NW) // 2   # 110 — centered
            NY = 1090              # top edge at 57 % of 1920
            fc.append(f"[{np_idx}:v]scale={NW}:{NH}[nps]")
            nxt = f"{vid}_np"
            fc.append(
                f"[{vid}][nps]overlay={NX}:{NY}:enable='between(t,{t0},{t1})'[{nxt}]"
            )
            vid = nxt

    # Captions — plain white text, transparent background, no outline, bottom of frame
    # Colour format: ASS &HAABBGGRR
    #   PrimaryColour &H00FFFFFF = white text
    srt_esc = srt_path.replace("\\", "/")
    if len(srt_esc) >= 2 and srt_esc[1] == ":":
        srt_esc = srt_esc[0] + "\\:" + srt_esc[2:]
    style = (
        "FontSize=8,PrimaryColour=&H00FFFFFF,"
        "BorderStyle=1,Outline=0,Shadow=0,"
        "Alignment=2,MarginV=15,Bold=0"
    )
    fc.append(f"[{vid}]subtitles='{srt_esc}':force_style='{style}'[vout]")

    return (
        ["ffmpeg", "-y"]
        + inputs
        + [
            "-filter_complex", ";\n".join(fc),
            "-map", "[vout]",
            "-map", "0:a",
            "-c:v", "libx264", "-crf", "23", "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "128k",
            "-r", "30",
            "-pix_fmt", "yuv420p",
            *(["-t", str(round(total_s, 3))] if total_s > 0 else []),
            output_path,
        ]
    )


def _run_pipeline(date_ist: str) -> None:
    """Orchestrate all pipeline stages. Runs in a background thread."""
    import datetime
    import re

    def _update(progress: str, status: str = "running", step: str = "") -> None:
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        log_line = f"[{ts}] {progress}"
        print(f"[Pipeline] {log_line}", flush=True)
        logs = list(_PIPELINE_JOB.get("logs", []))
        logs.append(log_line)
        updates: dict = {"status": status, "progress": progress, "logs": logs}
        if step:
            updates["step"] = step
        _PIPELINE_JOB.update(updates)
        try:
            with _get_conn() as conn:
                conn.execute(
                    "INSERT INTO daily_sessions (date_ist, pipeline_status, pipeline_progress, pipeline_step) VALUES (?, ?, ?, ?)"
                    " ON CONFLICT(date_ist) DO UPDATE SET pipeline_status=excluded.pipeline_status,"
                    " pipeline_progress=excluded.pipeline_progress, pipeline_step=excluded.pipeline_step",
                    (date_ist, status, progress, _PIPELINE_JOB.get("step")),
                )
        except Exception:
            pass

    try:
        if not shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg not found in PATH. Install FFmpeg and ensure it is on PATH.")

        _update("Resolving assets…", step="assets")
        assets = _resolve_pipeline_assets(date_ist)
        a_roll_path: str = assets["a_roll_path"]
        b_roll_map: dict[int, str] = assets["b_roll_map"]
        sections: list[dict] = assets["sections"]
        _update(f"Assets ready — a-roll: {Path(a_roll_path).name}, b-roll clips: {len(b_roll_map)}", step="assets")

        work_dir = tempfile.mkdtemp(prefix="pipeline_")
        try:
            # Auto-source b-roll from YouTube for any b-roll section without a manual upload
            # Exclude hook and cta explicitly even if they were marked b_roll in the script
            b_roll_sections = [s for s in sections if s.get("shot_type") == "b_roll" and s.get("name") not in ("hook", "cta")]
            missing = [s for s in b_roll_sections if s.get("index") not in b_roll_map]
            if missing:
                _update(f"Computing visual entity bible for consistent Veo rendering…", step="assets")
                visual_bible = _compute_visual_bible(date_ist, sections)
                _update(f"Visual bible ready — {len(visual_bible)} entities defined", step="assets")

                _update(f"Generating AI b-roll for {len(missing)} section(s)…", step="assets")
                for sec in missing:
                    sec_idx = sec.get("index")
                    prompt = (sec.get("b_roll_prompt") or sec.get("label") or sec.get("name") or "business news footage")
                    duration_s = _broll_clip_duration(sec["timing"]["end_s"] - sec["timing"]["start_s"])
                    auto_path = os.path.join(work_dir, f"auto_broll_{sec_idx}.mp4")
                    found = _generate_ai_broll(sec, prompt, duration_s, auto_path, log_cb=lambda m: _update(m, step="assets"), visual_bible=visual_bible)
                    if found:
                        b_roll_map[sec_idx] = found
                        _update(f"  ✓ AI b-roll generated for '{sec.get('name')}'", step="assets")
                    else:
                        _update(f"  ✗ AI b-roll failed for '{sec.get('name')}' — using a-roll", step="assets")

            _update("Transcribing audio with Whisper (this takes a few minutes on CPU)…", step="whisper")
            srt_path = _generate_captions_srt(a_roll_path, work_dir)
            _update(f"Whisper done → {Path(srt_path).name}", step="whisper")

            # Newspaper card overlay disabled — popped on screen as an unwanted artifact.
            newspaper_png: str | None = None

            # Total duration — must match the actual a-roll recording, not the scripted
            # section timings. The script's timings are a recording guide; if you talk
            # longer or shorter than planned, trimming to the scripted total cuts off
            # real content (e.g. the CTA).
            scripted_total = max((s["timing"]["end_s"] for s in sections), default=90.0)
            a_roll_dur = _probe_duration(a_roll_path)
            total_s = a_roll_dur if a_roll_dur > 0 else scripted_total
            if a_roll_dur > 0 and abs(a_roll_dur - scripted_total) > 1.0:
                _update(
                    f"Recording is {a_roll_dur:.1f}s vs {scripted_total:.1f}s scripted — using actual length",
                    step="ffmpeg",
                )

            output_path = str(OUTPUTS_DIR / f"{date_ist}_final_edit.mp4")
            cmd = _build_ffmpeg_cmd(a_roll_path, b_roll_map, sections, srt_path, newspaper_png, output_path, total_s=total_s)
            _update(f"Starting FFmpeg… output: {Path(output_path).name}", step="ffmpeg")
            print(f"[Pipeline] FFmpeg cmd: {' '.join(cmd[:8])}…", flush=True)
            time_re = re.compile(r"time=(\d{2}):(\d{2}):(\d{2}\.\d+)")

            proc = subprocess.Popen(
                cmd,
                stderr=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            stderr_buf: list[str] = []
            for line in proc.stderr:  # type: ignore[union-attr]
                line = line.rstrip()
                if line:
                    stderr_buf.append(line)
                    if any(k in line for k in ("frame=", "fps=", "time=", "bitrate=", "Error", "error")):
                        print(f"[FFmpeg] {line}", flush=True)
                m = time_re.search(line)
                if m and total_s > 0:
                    h, mn, s_val = int(m.group(1)), int(m.group(2)), float(m.group(3))
                    cur_s = h * 3600 + mn * 60 + s_val
                    pct = min(cur_s / total_s, 1.0)
                    _PIPELINE_JOB["ffmpeg_pct"] = round(pct, 3)
                    _update(f"FFmpeg encoding… {int(pct * 100)}%", step="ffmpeg")

            proc.wait()
            if proc.returncode != 0:
                raise RuntimeError(f"FFmpeg error:\n" + "\n".join(stderr_buf[-30:]))

            _update("FFmpeg complete ✓", step="ffmpeg")

        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

        _PIPELINE_JOB.update({"status": "done", "progress": "Complete ✓", "step": "done", "ffmpeg_pct": 1.0, "output_path": output_path})
        logs = list(_PIPELINE_JOB.get("logs", []))
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        logs.append(f"[{ts}] Pipeline finished → {Path(output_path).name}")
        _PIPELINE_JOB["logs"] = logs
        print(f"[Pipeline] Done → {output_path}", flush=True)
        with _get_conn() as conn:
            conn.execute(
                "INSERT INTO daily_sessions (date_ist, pipeline_status, pipeline_progress, pipeline_output_path)"
                " VALUES (?, 'done', 'Complete ✓', ?)"
                " ON CONFLICT(date_ist) DO UPDATE SET pipeline_status='done',"
                " pipeline_progress='Complete ✓', pipeline_output_path=excluded.pipeline_output_path",
                (date_ist, output_path),
            )

    except Exception as exc:
        err = str(exc)
        _PIPELINE_JOB.update({"status": "failed", "progress": err})
        logs = list(_PIPELINE_JOB.get("logs", []))
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        logs.append(f"[{ts}] FAILED: {err[:200]}")
        _PIPELINE_JOB["logs"] = logs
        print(f"[Pipeline] FAILED: {err}", flush=True)
        try:
            with _get_conn() as conn:
                conn.execute(
                    "UPDATE daily_sessions SET pipeline_status='failed', pipeline_progress=? WHERE date_ist=?",
                    (err, date_ist),
                )
        except Exception:
            pass


def trigger_pipeline(date_ist: str) -> dict[str, Any]:
    """Start the pipeline in a background thread. Only one job at a time."""
    if _PIPELINE_JOB.get("status") == "running":
        return dict(_PIPELINE_JOB)
    _PIPELINE_JOB.update({"status": "running", "progress": "Starting…", "output_path": None, "date_ist": date_ist, "step": "assets", "logs": [], "ffmpeg_pct": None})
    t = threading.Thread(target=_run_pipeline, args=(date_ist,), daemon=True)
    t.start()
    return dict(_PIPELINE_JOB)


_BROLL_TEST_JOB: dict[str, Any] = {"status": None, "results": [], "logs": [], "date_ist": None}


def _run_broll_test(date_ist: str) -> None:
    """Background thread: generate YouTube b-roll for every b_roll section in today's script."""
    import datetime

    def _tlog(msg: str) -> None:
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}"
        print(f"[BRoll Test] {line}", flush=True)
        _BROLL_TEST_JOB["logs"] = list(_BROLL_TEST_JOB.get("logs", [])) + [line]

    try:
        _BROLL_TEST_JOB["status"] = "running"
        script = _load_latest_script_json(date_ist)
        if not script:
            raise ValueError("No script found for today. Generate a script first.")

        all_sections = script.get("sections", [])
        # Exclude hook and cta — they are always a-roll; filter by both shot_type and name for safety
        b_sections = [
            s for s in all_sections
            if s.get("shot_type") == "b_roll" and s.get("name") not in ("hook", "cta")
        ][:1]
        _tlog(f"Testing with 1 b-roll section (of {len([s for s in all_sections if s.get('shot_type') == 'b_roll' and s.get('name') not in ('hook', 'cta')])} eligible)")

        _tlog("Computing visual entity bible for consistent Veo rendering…")
        visual_bible = _compute_visual_bible(date_ist, all_sections)
        _tlog(f"Visual bible ready — {len(visual_bible)} entities: {list(visual_bible.keys())}")

        out_dir = ASSET_DIRS["b_roll_ai"]
        results: list[dict] = []

        for sec in b_sections:
            sec_idx = sec["index"]
            name = sec.get("name", f"section_{sec_idx}")
            prompt = sec.get("b_roll_prompt") or sec.get("label") or name or "business news footage"
            duration_s = _broll_clip_duration(sec["timing"]["end_s"] - sec["timing"]["start_s"])
            output_path = str(out_dir / f"test_{date_ist}_s{sec_idx}.mp4")

            _tlog(f"Section {sec_idx} ({name}): generating AI b-roll for '{prompt[:50]}'")
            try:
                path = _generate_ai_broll(sec, prompt, duration_s, output_path, log_cb=_tlog, visual_bible=visual_bible)
                if path:
                    _tlog(f"  ✓ saved → {Path(path).name}")
                    results.append({
                        "section_index": sec_idx, "section_name": name,
                        "prompt": prompt, "duration_s": duration_s,
                        "success": True, "file_path": path, "file_name": Path(path).name, "error": None,
                    })
                else:
                    _tlog(f"  ✗ no clip found")
                    results.append({
                        "section_index": sec_idx, "section_name": name,
                        "prompt": prompt, "duration_s": duration_s,
                        "success": False, "file_path": None, "file_name": None, "error": "No suitable clip found",
                    })
            except Exception as exc:
                _tlog(f"  ✗ error: {exc}")
                results.append({
                    "section_index": sec_idx, "section_name": name,
                    "prompt": prompt, "duration_s": duration_s,
                    "success": False, "file_path": None, "file_name": None, "error": str(exc)[:200],
                })

        _BROLL_TEST_JOB.update({"status": "done", "results": results})
        _tlog(f"Test complete — {sum(1 for r in results if r['success'])}/{len(results)} clips found")

    except Exception as exc:
        _BROLL_TEST_JOB.update({"status": "failed", "results": []})
        _BROLL_TEST_JOB["logs"] = list(_BROLL_TEST_JOB.get("logs", [])) + [f"FAILED: {exc}"]
        print(f"[BRoll Test] FAILED: {exc}", flush=True)


def start_broll_test(date_ist: str) -> dict[str, Any]:
    """Start the b-roll test in a background thread. Returns current job state."""
    if _BROLL_TEST_JOB.get("status") == "running":
        return dict(_BROLL_TEST_JOB)
    _BROLL_TEST_JOB.update({"status": "running", "results": [], "logs": [], "date_ist": date_ist})
    t = threading.Thread(target=_run_broll_test, args=(date_ist,), daemon=True)
    t.start()
    return dict(_BROLL_TEST_JOB)


def get_broll_test_status() -> dict[str, Any]:
    """Return current b-roll test job state."""
    return dict(_BROLL_TEST_JOB)


def preview_veo_prompt(date_ist: str, section_index: int) -> dict[str, Any]:
    """Return the multi-shot Veo plan for a section with visual bible injection (no video generated)."""
    script = _load_latest_script_json(date_ist)
    if not script:
        return {"error": "No script found for today"}
    all_sections = script.get("sections", [])
    sec = next((s for s in all_sections if s.get("index") == section_index), None)
    if not sec:
        return {"error": f"Section {section_index} not found"}

    b_roll_prompt = sec.get("b_roll_prompt") or sec.get("label") or sec.get("name") or "footage"
    clean_narration = _extract_narration(sec)

    timing = sec.get("timing", {})
    start_s = float(timing.get("start_s", 0))
    end_s = float(timing.get("end_s", 8))
    duration_s = max(6.0, end_s - start_s)

    # Compute visual bible so the preview reflects exactly what Veo would receive
    visual_bible = _compute_visual_bible(date_ist, all_sections)
    shots = _build_veo_shots(sec, b_roll_prompt, duration_s, visual_bible=visual_bible)

    return {
        "section_index": section_index,
        "section_name": sec.get("name", ""),
        "section_label": sec.get("label", sec.get("name", "")),
        "narration": clean_narration,
        "b_roll_concept": b_roll_prompt,
        "total_duration_s": duration_s,
        "visual_bible": visual_bible,
        "shots": shots,
    }


def preview_all_veo_prompts(date_ist: str) -> dict[str, Any]:
    """Return visual bible + shot plans for every b-roll section. Zero Veo cost — Gemini only."""
    script = _load_latest_script_json(date_ist)
    if not script:
        return {"error": "No script found for today"}

    all_sections = script.get("sections", [])

    b_roll_sections = [
        s for s in all_sections
        if s.get("shot_type") == "b_roll" and s.get("name") not in ("hook", "cta")
    ]
    if not b_roll_sections:
        return {"error": "No b-roll sections found in today's script"}

    # One Gemini call for the bible — cached, so subsequent sections are instant
    visual_bible = _compute_visual_bible(date_ist, all_sections)

    section_plans = []
    for sec in b_roll_sections:
        b_roll_prompt = sec.get("b_roll_prompt") or sec.get("label") or sec.get("name") or "footage"
        timing = sec.get("timing", {})
        duration_s = max(6.0, float(timing.get("end_s", 8)) - float(timing.get("start_s", 0)))
        shots = _build_veo_shots(sec, b_roll_prompt, duration_s, visual_bible=visual_bible)
        section_plans.append({
            "section_index": sec.get("index"),
            "section_name": sec.get("name", ""),
            "section_label": sec.get("label", sec.get("name", "")),
            "narration": _extract_narration(sec),
            "b_roll_concept": b_roll_prompt,
            "total_duration_s": duration_s,
            "shots": shots,
        })

    return {
        "date_ist": date_ist,
        "visual_bible": visual_bible,
        "sections": section_plans,
    }


def get_pipeline_status(date_ist: str) -> dict[str, Any]:
    """Return current pipeline status, preferring in-memory state."""
    if _PIPELINE_JOB.get("date_ist") == date_ist:
        job = dict(_PIPELINE_JOB)
        output_path = job.get("output_path")
        return {
            "date_ist": date_ist,
            "status": job.get("status"),
            "progress": job.get("progress", ""),
            "output_path": output_path if output_path and Path(output_path).exists() else None,
            "step": job.get("step"),
            "logs": job.get("logs", []),
            "ffmpeg_pct": job.get("ffmpeg_pct"),
        }
    # Fall back to DB for status after server restart
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT pipeline_status, pipeline_progress, pipeline_output_path, pipeline_step FROM daily_sessions WHERE date_ist=?",
            (date_ist,),
        ).fetchone()
    if row:
        op = row["pipeline_output_path"]
        db_status = row["pipeline_status"]
        # If DB says "running" but no in-memory job, the server restarted mid-run → treat as failed
        if db_status == "running":
            db_status = "failed"
            progress = "Pipeline was interrupted (server restarted). Please retry."
        else:
            progress = row["pipeline_progress"] or ""
        return {
            "date_ist": date_ist,
            "status": db_status,
            "progress": progress,
            "output_path": op if op and Path(op).exists() else None,
            "step": row["pipeline_step"],
        }
    return {"date_ist": date_ist, "status": None, "progress": "", "output_path": None}

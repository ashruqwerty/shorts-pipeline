# F001 — Script Data Format v2

**Status:** Approved  
**Depends on:** nothing (foundation spec)  
**Consumed by:** F002 (LLM gen), F003 (Today screen), F004 (Teleprompter), F005 (Recorder), F007 (FFmpeg)

---

## What this spec defines

The canonical JSON schema for a script, including embedded voice-direction cues.  
Every script in the system — whether statically generated or LLM-produced — must conform to this schema.  
The existing v1 format (`schema_version` absent or `1`) remains in the DB but is superseded; all new writes use v2.

---

## The 6 Sections (fixed, ordered, non-negotiable)

| index | name | label | timing (s) | shot_type | purpose |
|---|---|---|---|---|---|
| 0 | hook | Hook | 0–3 | a_roll | Pattern interrupt, opening statement |
| 1 | context | Context | 3–18 | a_roll | What happened, why it matters now |
| 2 | evidence | Evidence | 18–45 | b_roll | Numbers, sources, timeline checkpoints |
| 3 | story_turn | Story Turn | 45–70 | a_roll | Hidden angle, who gains/loses, what's next |
| 4 | takeaway | Takeaway | 70–86 | a_roll | One actionable insight |
| 5 | cta | CTA | 86–90 | a_roll | Follow/subscribe call-to-action |

`section.index` is the **canonical ordering key** for FFmpeg assembly. Never use upload timestamp for ordering.

---

## Voice Cue Taxonomy

Cues are embedded inline in `section.text` as `[CUE_NAME]`. They are placed immediately **before** the word or phrase they modify.

| Cue | Category | Performer instruction | UI color |
|---|---|---|---|
| `SLOW` | Pace | Slow down, let each word land | `#60A5FA` (blue) |
| `FAST` | Pace | Pick up urgency, forward momentum | `#F97316` (orange) |
| `NORMAL` | Pace | Reset to baseline pace | `#9CA3AF` (gray) |
| `EMPHASIZE` | Weight | Stress this word/phrase hard | `#FBBF24` (yellow) |
| `WHISPER` | Weight | Drop to near-whisper for effect | `#C4B5FD` (violet) |
| `LOUD` | Weight | Raise volume for sharp impact | `#F87171` (red) |
| `HIGH` | Pitch | Raise pitch — curiosity, surprise | `#34D399` (green) |
| `LOW` | Pitch | Drop pitch — authority, gravity | `#6366F1` (indigo) |
| `PAUSE` | Break | Brief silence, 0.5–1 s | `#9CA3AF` (gray) |
| `BEAT` | Break | Dramatic beat, 1.5–2 s | `#4B5563` (dark gray) |
| `BREATHE` | Break | Natural breath point | `#86EFAC` (light green) |
| `EXCITED` | Energy | Energy up, forward lean | `#FB923C` (amber) |
| `SERIOUS` | Energy | Drop energy, gravitas | `#374151` (charcoal) |

**Parsing rule:** `[CUE]` tokens are any `\[([A-Z]+)\]` match in `text`. Unknown tokens are silently ignored by the renderer.

---

## JSON Schema

### Top-level script object

```json
{
  "schema_version": 2,
  "topic": "string — topic_angle from topic_queue",
  "video_title": "string — display title for the video",
  "tone": "energetic | serious | curious",
  "duration_sec": 90,
  "total_word_count": 245,
  "cta": "string — CTA narration (also appears in section index 5)",
  "disclaimer": "string — end-card disclaimer",
  "sections": [ /* array of 6 ScriptSection objects, index 0–5 */ ]
}
```

### ScriptSection object

```json
{
  "index": 0,
  "name": "hook",
  "label": "Hook",
  "timing": {
    "start_s": 0,
    "end_s": 3
  },
  "shot_type": "a_roll",
  "word_count": 12,
  "text": "[SLOW] India's nuclear capacity is about to triple. [PAUSE] [EMPHASIZE] Three plants. One decade.",
  "plain_text": "India's nuclear capacity is about to triple. Three plants. One decade.",
  "cue_summary": ["SLOW", "PAUSE", "EMPHASIZE"],
  "on_screen_text": "Big update in 3 seconds",
  "transition_after": "flash_zoom",
  "b_roll_slot": false,
  "b_roll_prompt": "",
  "proof_overlay": ""
}
```

**Field rules:**
- `text` is the authoritative content — includes inline `[CUE]` tokens.
- `plain_text` is `text` with all `[CUE]` tokens stripped — used for word count, search, and TTS.
- `word_count` = `len(plain_text.split())` — must be recomputed on every script write.
- `total_word_count` on the root = sum of all section `word_count` values.
- `cue_summary` = deduplicated list of cue names found in `text`, ordered by first appearance.
- `timing.start_s` / `timing.end_s` are integers (seconds), not `"MM:SS"` strings.
- `b_roll_slot: true` on section index 2 (evidence) only in the static template; LLM may mark others.

---

## Backend changes required

### `schemas.py`
Add: `ScriptSectionV2`, `ScriptV2` Pydantic models.  
Update: `TeleprompterOut.sections` from `list[dict[str, str]]` to `list[ScriptSectionV2]`.  
Update: `ScriptBundleOut.script` from `dict[str, object]` to `ScriptV2`.

### `storage.py` — `assets` table
Add column: `section_index INTEGER` — nullable, set when the clip is recorded in-app.  
Migration: `ALTER TABLE assets ADD COLUMN section_index INTEGER` (idempotent check on startup).

### `daily.py` — `_build_script_payload()`
Replace v1 static template with a v2-compliant static template.  
Compute `word_count` and `plain_text` for each section.  
Compute `total_word_count` at root level.

---

## Acceptance criteria

- `GET /daily/script` response body matches v2 schema (validated by Pydantic).
- Each section has a correct `word_count` (±0 from `len(plain_text.split())`).
- `total_word_count` equals the sum of all section `word_counts`.
- `cue_summary` on each section contains exactly the cue types present in `text`, no duplicates.
- Existing v1 scripts already in the DB continue to be readable; no migration of old rows required.
- `assets` table has `section_index` column; existing rows have `NULL` for that column.
- No v1 scripts are written after this implementation merges.

---

## Out of scope for F001

- LLM generation (F002)
- Rendering cues in the UI (F004)
- Recording clips (F005)
- FFmpeg assembly (F007)

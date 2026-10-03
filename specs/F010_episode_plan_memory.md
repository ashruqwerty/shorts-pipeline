# F010 — Episode Plan Memory

## Overview
Per-episode persistent script plan for series episodes. When a creator plans a Day's episode via the planning popup, they can apply the agreed-upon plan — it saves to SQLite and persists across sessions. The episode card visually reflects whether a plan has been saved.

## Entry Point
Episode card in the Series draft left panel → "Tap to plan →" → opens `EpisodePlanPopup`.

## Episode Plan Popup Flow

### On Open
1. Popup opens with episode header (day badge, sub-topic, series name, category)
2. If a saved plan exists for this episode → show it at the top in a read-only "Saved Plan" card
3. Gemini auto-generates a planning overview immediately (no user input needed):
   - Hook approach
   - Per-section narrative notes (hook → context → evidence → story_turn → takeaway → CTA)
   - Research checklist (3–5 specific data points to look up)
4. Chat input available for refinement

### Chat Actions
| User says | Gemini does |
|-----------|-------------|
| "Start from founder's POV" | Returns `action: "update"` with full structured plan |
| "Make the hook more shocking" | Returns `action: "update"` with updated hook + plan |
| Questions about the topic | Returns `action: "reply"` with no plan update |
| Off-topic | Returns `action: "rejected"` |

### Apply Plan Button
- Appears whenever Gemini returns `action: "plan"` or `action: "update"` with a structured `plan` object
- Clicking **Apply Plan**:
  1. POSTs `{series_id, day_offset, plan}` to `/api/series/episode/save-plan`
  2. Backend saves structured JSON to `series_items.plan_notes`
  3. Also syncs `topic_angle` and `hook_idea` from the plan
  4. Episode card in left panel immediately shows ✓ badge + hook line preview
  5. Popup stays open (user may continue refining)
- If user closes popup with × while a new plan is pending → plan is auto-applied before close

## Structured Plan Format
```json
{
  "angle": "Founder's POV — Sardar Patel's cooperative gamble",
  "hook": "In 1946, 250 farmers had nothing. Today they own India's biggest food brand.",
  "sections": {
    "hook":        "Open on the 1946 Anand milk crisis — farmers vs. Polson monopoly",
    "context":     "Sardar Patel and Verghese Kurien's cooperative model",
    "evidence":    "13M farmer members, ₹55,000 crore revenue, 36 products",
    "story_turn":  "Not a company — the farmers ARE the shareholders",
    "takeaway":    "Cooperative beats corporate for sustainable rural scale",
    "cta":         "Which brand should I cover next? Comment below."
  },
  "research_checklist": [
    "Amul establishment year and founding farmer count",
    "Latest annual turnover (GCMMF)",
    "Number of farmer members and village cooperatives today",
    "Daily milk procurement volume",
    "Amul market share in key dairy segments"
  ],
  "saved_at": "2026-09-06T10:30:00Z"
}
```

## Episode Card States
| State | Visual |
|-------|--------|
| No plan | "Tap to plan →" in amber |
| Plan saved | Green ✓ "Planned" badge + italic hook line preview |

## Backend

### DB Changes
```sql
-- Migration on startup (ALTER TABLE, safe to run multiple times)
ALTER TABLE series_items ADD COLUMN plan_notes TEXT;
```

### Routes
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/series/episode/plan` | Get/refine planning overview (existing) |
| POST | `/api/series/episode/save-plan` | Explicitly apply and save a plan |

### `plan_series_episode` Updates
- Gemini prompt updated to return `plan` object (structured JSON) when `action` is `"plan"` or `"update"`
- `updated_angle` and `updated_hook` auto-persisted to `series_items` as before
- `plan_notes` is NOT auto-saved — only saved on explicit Apply

### `save_episode_plan` (new function)
```python
def save_episode_plan(series_id, day_offset, plan: dict) -> dict:
    # Saves plan as JSON to series_items.plan_notes
    # Also syncs topic_angle and hook_idea from plan
    # Returns updated series_items row
```

## Key Invariants
- One plan per (series_id, day_offset) — overwritten on each Apply
- plan_notes is isolated per series row — no cross-series conflicts possible since series_items.id is UUID
- Closing popup with pending plan auto-applies it (no data loss on accidental ×)
- plan_notes survives series activation — accessible even after series is queued

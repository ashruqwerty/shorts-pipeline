# F009 — Series Creator

## Overview
A content planning feature that lets the creator define a multi-day thematic series. The user picks a master theme, Gemini generates N daily episode ideas, the creator refines them via chat, then activates the series to queue topics into the pipeline.

## Entry Point
**Series tab** (4th tab in the top nav bar, alongside Today / Tasks / Assets).

## States

### 1. Theme Entry (no draft)
- Text input: master theme (e.g. "Indian Roadside Businesses That Turned Big")
- Day count selector: 5 / 7 / 10 / 14 days (default 10)
- "Generate Series with AI" button
- If an active series exists, shows the active series timeline instead

### 2. Draft Planning (split layout)
- **Left panel**: scrollable list of N episode cards  
  - Day number badge (orange circle)  
  - Sub-topic name, category chip  
  - Topic angle (2-line preview)  
  - "Tap to plan →" affordance (opens F010 episode planning popup)  
  - Green ✓ badge + hook preview if episode has a saved plan (F010)
- **Right panel**: chat to refine the full series  
  - Opening message from AI confirms series + episode count  
  - User can: replace episodes, swap order, adjust tone across all  
  - Guardrailed: only series planning questions accepted  
  - "Updated: Day X" chip appears when episodes change  
- **Activate Series (starts tomorrow)** button at bottom of left panel

### 3. Active Series View (after activation)
- Series name + "ACTIVE" green badge  
- Episode timeline with day numbers  
- "Plan New Series" button to start over

## Guardrail
Off-topic requests (anything not about series planning) return `action: "rejected"` and a clear refusal message.

## Backend

### DB Tables
```sql
series (id, name, day_count, status, created_at, updated_at)
  status: draft | active | superseded

series_items (id, series_id, day_offset, sub_topic, category, topic_angle, hook_idea, plan_notes)
  day_offset: 1–N (1 = tomorrow on activation)
```

### Routes
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/series/generate` | Gemini generates N episodes for a theme |
| POST | `/api/series/chat` | Multi-turn chat to refine the series draft |
| POST | `/api/series/activate` | Queue series into topic_queue + daily_assignment |
| GET  | `/api/series/active` | Return the currently active series |

### Activation Logic
- For each episode, compute `target_date = today + day_offset days`
- Insert a new `topic_queue` row (day_index 9000+N to avoid CSV conflicts)
- `INSERT OR REPLACE` into `daily_assignment` for that date with `series_id` and `series_day_offset`
- Set series `status = 'active'`, supersede any previously active series

### Today Card
`get_today_card()` returns `series_context: {series_id, name, day, total}` when today's topic is part of an active series. Shown as an orange SERIES badge on the Today tab.

## JSON Cleaning
All Gemini responses are passed through `_clean_llm_json()` before `json.loads` to strip trailing commas and comments.

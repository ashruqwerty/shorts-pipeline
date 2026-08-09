# F003 — Today Screen: Full Script Preview

## Goal
At load, the Today tab shows the complete 6-section script so the creator can review narration before entering teleprompter mode. No extra taps required.

## Layout
1. **Topic header card** — category, angle, hook idea, script version
2. **Script preview list** — 6 section cards (scrollable), each with:
   - Label row: `{label} · {start_s}–{end_s}s · {shot_type}`
   - Cue chips: colored pill per cue in `cue_summary`
   - `plain_text` narration body
3. **"Enter Teleprompter Mode" CTA** at bottom of Today tab

## Data flow
- `fetchTeleprompter()` called at startup inside `refreshData()` alongside `fetchToday()`
- Sections stored in state; reused when entering teleprompter (no second fetch)
- When `onOpenTeleprompter` is called, just open the modal; sections already populated

## Types (update)
Replace v1 `TeleprompterSection` with `ScriptSectionV2` matching backend v2:
- `timing: { start_s: number; end_s: number }` (not string `start`/`end`)
- `word_count: number`, `plain_text: string`, `cue_summary: string[]`
- All other v2 fields

## CUE_COLORS (frontend constant)
Match backend `CUE_COLORS` dict exactly:
```
SLOW:#60A5FA  FAST:#F97316  NORMAL:#9CA3AF  EMPHASIZE:#FBBF24
WHISPER:#C4B5FD  LOUD:#F87171  HIGH:#34D399  LOW:#6366F1
PAUSE:#9CA3AF  BEAT:#4B5563  BREATHE:#86EFAC  EXCITED:#FB923C
SERIOUS:#374151
```

## Teleprompter modal fix (v1 → v2 field names)
- `currentSection.start` / `currentSection.end` → `currentSection.timing.start_s` / `currentSection.timing.end_s`
- Display text uses `plain_text` for now (F004 will add inline colored cue rendering)

## Acceptance criteria
1. Today tab renders all 6 section cards at load, no extra tap.
2. Each section card shows: label, timing range, shot type, cue chips (correctly colored), plain text.
3. Teleprompter modal still works; section count matches.
4. No TypeScript errors on v2 field access.

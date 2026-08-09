# F004 — Smart Teleprompter

## Goal
Transform the teleprompter modal into a smart delivery guide: inline voice-cue labels rendered with their taxonomy colors, a timer-driven word-progress bar, and a pace display. Still section-scoped (one section at a time, same 6-step flow).

## Inline cue rendering
Parse `section.text` into segments: narration runs and `[CUE]` tokens.
- Narration runs: normal weight, reading size
- Cue tokens: small bold colored label inline (`SLOW`, `EMPHASIZE`, etc.) using `CUE_COLORS` as background; light cues (EMPHASIZE, BREATHE, HIGH, NORMAL, PAUSE) get dark text, all others white

```
"[SLOW] Big news. [PAUSE] [EMPHASIZE] Here is why."
→  [SLOW]  Big news.  [PAUSE]  [EMPHASIZE]  Here is why.
    ^blue              ^gray     ^yellow (dark text)
```

## Word progress bar
- Timer-based: when a section opens, start a 500ms interval ticker
- `sectionElapsed` (seconds) fills from 0 → `timing.end_s - timing.start_s`
- Progress bar width = `min(100, sectionElapsed / sectionDuration * 100)%`
- Shown as a thin accent bar below the section meta line
- On section advance or modal close: clear the interval

## Section meta line
`Section N/6 · {label} · {start_s}–{end_s}s · {word_count}w`

## Cue tab (bottom of modal)
Row of colored chips for `cue_summary` (same as preview but slightly larger) so user can glance at delivery plan before starting to read.

## Acceptance criteria
1. `[CUE]` tokens render as colored inline labels; no raw bracket text visible.
2. Progress bar fills from 0 to 100% over the section's nominal duration.
3. Bar resets to 0 when advancing to the next section.
4. Timer cleared when modal is closed.
5. TypeScript no-error compile.

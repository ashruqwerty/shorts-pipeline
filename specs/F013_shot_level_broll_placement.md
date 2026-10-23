# F013 — Grounded B-Roll Prompts + Shot-Level Placement

Builds on F012 (section-level audio alignment). F012 fixed *which section* of your recording gets b-roll; this fixes *which exact moment inside that section* each individual shot plays over, and sharpens what each shot actually shows.

## Problem

1. **Prompts aren't grounded in specifics.** Each shot's Veo prompt is written from a cinematic brief (subject, camera, lighting, color grade) but isn't required to depict the literal number or claim from that part of the narration — so a shot for "costs jumped 300%" can come back as generic "stressed businessman" footage instead of something that visually shows the number.
2. **Shots play in fixed, even blocks — not at the sentence they illustrate.** Once a section's real [start, end] window is known (F012), its 1-3 shots are concatenated into one clip and played back sequentially at fixed 8s intervals from the section start. A shot built to depict "transit delays" might play while you're still talking about "cost increases," because nothing ties the shot's position to the sentence it was written for.

## Design

### 1. Grounded prompts

Add an explicit grounding requirement to the Gemini shot-planning prompt (`_build_veo_shots`'s `combined_prompt`): each shot must visually depict the literal number/claim from its source clause (a price board showing the exact figure, a calendar flipping through the exact day range) rather than a generic stand-in image.

### 2. Each shot declares its literal source clause

Extend the per-shot response format with a `DEPICTS:` line — the verbatim (or near-verbatim) clause from the narration that shot illustrates:

```
SHOT 1 — <5-8 word moment label>
DEPICTS: <verbatim clause from the narration this shot illustrates>
<full cinematic prompt paragraph>
```

Parsed into a new `source_text` field per shot (alongside the existing `moment`/`duration_s`/`prompt`). For the single-shot path (`num_shots == 1`), `source_text` is just the section's full `plain_text` — no extra Gemini round-trip needed.

### 3. Shot-level forced alignment

Reuses the exact matching mechanism from F012, scoped one level deeper:
- The sliding-window fuzzy-match core from `_align_sections_to_audio` is extracted into a shared helper, `_fuzzy_match_window(target_words, audio_words, cursor, target_len)`.
- New `_align_shots_to_section(shots, section_words)`: given a section's shots (each with `source_text`) and the slice of the real transcript's words whose timestamps fall inside that section's *already-resolved* (F012) `[start_s, end_s]`, walks the shots in order with a cursor, matching each shot's `source_text` the same way sections are matched against the full transcript. Unmatched shots gap-fill between resolved neighbors, proportioned by `duration_s` (same pattern as F012's section-level gap-fill).

### 4. Shots become independently-placed overlays, not one concatenated block

This is the structural change: a section's b-roll is no longer one file played for the whole section window.

- New `_generate_shots_for_section(section, b_roll_prompt, duration_s, out_dir, log_cb, visual_bible) -> list[dict]` — the shared "plan shots with Gemini, generate them in parallel via Veo" core, extracted out of the current `_generate_ai_broll`. Returns `[{"path", "source_text", "duration_s", "moment"}]` for every shot that generated successfully; no concatenation.
- `_generate_ai_broll` (kept, used only by the B-Roll Test feature which wants one inspectable file) becomes a thin wrapper: calls the shared helper, concatenates the results into one file same as before.
- New `_generate_ai_broll_shots` (used by the real pipeline): calls the shared helper, returns the shot list as-is — each shot stays its own file in the pipeline's `work_dir`.
- `_run_pipeline` builds a flat `broll_placements: list[{"path", "start_s", "end_s"}]` instead of the current `b_roll_map: dict[section_index, path]`:
  - Sections with a manual `b_roll_custom` upload → one placement using the section's F012-aligned `[start_s, end_s]`.
  - Sections with AI-generated b-roll → one placement *per shot*, each using that shot's F013-aligned `[start_s, end_s]` (computed by `_align_shots_to_section` against that section's real audio).
- `_build_ffmpeg_cmd` signature changes from `(a_roll_path, b_roll_map, sections, ...)` to `(a_roll_path, broll_placements, sections, ...)`. The overlay loop simplifies to iterating the flat placement list directly (no more per-section input bookkeeping) — each placement gets its own `setpts` delay + `overlay enable` window exactly as F012 already does, just one level more granular.

### Scope — what doesn't change

- `preview_veo_prompt` / `preview_all_veo_prompts` (zero-cost, pre-recording preview) and `_run_broll_test` are unaffected beyond picking up the new `source_text` field for free (harmless additive field; nothing currently reads it there).
- Script schema, teleprompter, Script Director — untouched.

## Acceptance criteria

1. Generated shot prompts visibly reference the specific number/claim from their `DEPICTS` clause, not generic imagery.
2. Pipeline logs show each shot's resolved real start/end time and confidence, nested under its section's F012 line.
3. In the final video, a 3-shot evidence section shows shot 1 while the cost-increase sentence is spoken, shot 2 while the transit-delay sentence is spoken, etc. — not three even 8-second blocks from the section's start.
4. A shot whose `source_text` doesn't confidently match (ad-lib, Gemini omitted the DEPICTS line) still gets a sane interpolated window rather than crashing or defaulting to section-start placement.

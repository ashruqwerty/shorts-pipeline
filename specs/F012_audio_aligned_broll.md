# F012 — Audio-Aligned B-Roll Timing

## Problem

The b-roll overlay window for each section comes from the script's *planned* timestamps (e.g. `context: 3-18s`, `evidence: 18-45s`) — fixed numbers written when the script text was generated, before anyone recorded anything. A real recording never matches that schedule exactly (pauses, re-takes, slower/faster delivery), so the b-roll for one section ends up playing over audio where the narrator is actually talking about something else. Drift compounds section-to-section.

Separately, each section's AI b-roll is a scripted-duration target split evenly across 1-3 shots and trimmed down from Veo's native 8-second output — so most clips are shorter fragments (e.g. 4-5s) rather than full 8s shots.

## Goal

Anchor b-roll timing to the **real recording** instead of the **scripted plan**, using the Whisper transcript we already generate for captions. Fix the shot-length issue as a direct consequence (no shortening once duration is driven by the real section length).

## Design

### 1. Word-level transcription (was segment-level only)

`_generate_captions_srt` is split into:
- `_transcribe_a_roll(a_roll_path) -> {"segments": [...], "words": [{"word","start","end"}, ...]}` — one Whisper call with `word_timestamps=True`. Captions still come from `segments` (unchanged `.srt` output); `words` is new, used only for alignment.
- `_write_captions_srt(segments, work_dir) -> srt_path` — same SRT-writing logic, now a separate step so the transcript can be reused for alignment before captions are written.

### 2. Forced alignment: `_align_sections_to_audio(sections, words) -> dict[index, {start_s, end_s, confidence}]`

For each section in script order (hook → ... → cta):
1. Normalize the section's known `plain_text` into a word list (lowercase, punctuation stripped).
2. Search forward from a cursor into the real transcript's word list for the best-matching contiguous window — try window lengths from 0.6x-1.8x the section's expected word count, score each candidate with `difflib.SequenceMatcher(None, section_words, window).ratio()`.
3. Keep the best-scoring window. If its score clears a confidence floor (0.35), record the *real* `start_s`/`end_s` from the matched words' own timestamps and advance the cursor past it.
4. If no window clears the floor (heavy ad-libbing, skipped section), leave it unresolved.
5. **Gap-fill pass**: any unresolved section (or consecutive run of them) gets its timing interpolated between the nearest resolved neighbors, proportioned by each unresolved section's share of the *original scripted* duration within that gap. Confidence recorded as `0.0` so it's visible in logs as an estimate, not a real match.

This is a sequential, cursor-advancing search (not global/arbitrary-order), since sections are read in the order they were written — this keeps the search space small and avoids a section matching the wrong occurrence of similar wording elsewhere in the script.

### 3. Pipeline re-ordering (`_run_pipeline`)

Whisper transcription + alignment now run **before** AI b-roll generation (previously after). New order:
1. Resolve assets
2. **Transcribe + align** — compute real per-section timing
3. Replace each section's `timing` with its aligned `{start_s, end_s}` in place (original scripted values kept under a new `scripted_timing` key for logging/debugging only)
4. Generate AI b-roll for sections missing a manual clip — `_broll_clip_duration()` now reads the *aligned* duration
5. Write captions `.srt` from the already-computed transcript (no second Whisper call)
6. FFmpeg assembly — `_build_ffmpeg_cmd` is unchanged; it already reads `sec["timing"]`, which now holds the aligned numbers, so the overlay `enable` window is automatically correct with zero changes to that function

Each section's scripted-vs-actual timing and match confidence is logged via the existing `_update()` progress log, so a run's logs show exactly what was corrected.

### 4. Full 8-second shots (no more trimming)

`_build_veo_shots`: replace the uneven duration-splitting logic with `num_shots = min(3, max(1, ceil(aligned_duration_s / 8)))`, every shot targets a full 8s (`shot_s = [8] * num_shots`). `_generate_single_veo_clip`'s trim step becomes a no-op (target always matches Veo's native 8s output) — left in place defensively, not removed.

Since last session's fix already clamps the overlay window to `min(scripted_end, start + probed_clip_duration)`, shots that run slightly past the real section's end are simply cut off at the boundary rather than bleeding into the next section — no additional change needed there.

### 5. Scope — what does *not* change

- `preview_veo_prompt` / `preview_all_veo_prompts` (zero-cost preview, no recording exists yet) keep using scripted timing — there's no real audio to align against before you've recorded.
- `_run_broll_test` is unaffected by alignment (it doesn't produce a timed overlay, just a standalone test clip) but benefits from the full-8s-shot change via the shared `_build_veo_shots`.
- Script schema, teleprompter, Script Director, Episode Plan Memory — untouched. Sections remain the unit of structure; only the *numbers* attached to b-roll sections at pipeline-run time are corrected.

## Acceptance criteria

1. Running the pipeline on a recording whose real pacing differs from the scripted timing produces b-roll that visibly starts/stops aligned to the matching dialogue, not the old scripted window.
2. Pipeline logs show, per b-roll section, scripted timing vs. resolved actual timing and a confidence score.
3. Every individual Veo shot in the output is a full, untrimmed 8 seconds (verify via `ffprobe` on the per-shot temp files or the concatenated section clip's total duration ≈ `num_shots × 8`).
4. A section read far off-script still produces a reasonable (if approximate) timing window via the gap-fill fallback, rather than crashing or silently keeping the old scripted window.

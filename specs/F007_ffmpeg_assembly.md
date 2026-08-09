# F007 — FFmpeg Assembly

## Goal
Concatenate the 6 section clips (ordered by `section_index`) into a single full-quality mp4 using FFmpeg. Triggered by F006's `POST /api/daily/pipeline/trigger`.

## Implementation: backend/app/pipeline.py (new file)

### `get_today_a_roll_clips(date_ist: str) -> list[dict]`
- Query `assets` table: `WHERE kind = 'a_roll' AND recording_date = date_ist` (or any a_roll if recording_date not set) ORDER BY section_index ASC
- Return list of rows with file_path and section_index

### `assemble_clips(clips: list[dict], output_dir: Path) -> dict`
Concatenate using FFmpeg concat demuxer:

**Step 1** — Write a temp filelist:
```
file '/abs/path/to/section_0.mp4'
file '/abs/path/to/section_1.mp4'
...
```

**Step 2** — Run FFmpeg:
```bash
ffmpeg -f concat -safe 0 -i filelist.txt \
  -c:v libx264 -crf 18 -preset medium \
  -c:a aac -b:a 192k -movflags +faststart \
  -y output.mp4
```
- CRF 18: near-lossless quality
- `-y`: overwrite output without prompting
- Output named: `{date_ist}_assembled.mp4` in `render_final/`

**Step 3** — Check subprocess return code:
- 0 → return `{ status: "ok", output_path: "...", clip_count: N }`
- non-zero → return `{ status: "error", message: stderr_tail }`

**FFmpeg not found** — `FileNotFoundError` on subprocess → return `{ status: "ffmpeg_missing", message: "ffmpeg not found in PATH" }`

## main.py changes
- Import `get_today_a_roll_clips`, `assemble_clips` from `pipeline`
- Add `POST /api/daily/pipeline/trigger` endpoint returning `PipelineTriggerOut`
- Add `PipelineTriggerOut` schema

## Acceptance criteria
1. `POST /api/daily/pipeline/trigger` with uploaded clips → returns `output_path` pointing to an existing mp4.
2. Output mp4 contains all clips in section order.
3. If FFmpeg missing → 200 with `status: "ffmpeg_missing"` (not a 500).
4. If fewer than 6 clips → assembles what's available, returns `clip_count`.

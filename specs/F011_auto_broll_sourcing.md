# F011 — Auto B-Roll Sourcing

## Goal
Automatically source real B-roll footage from the web based on each script section's `b_roll_prompt`, download a short clip, and fall back to manual upload if nothing is found. Source attribution is burned into the top-left of the clip.

## Architecture

```
[script section b_roll_prompt]
        ↓
[Pexels API search]  →  found → download MP4
        ↓ not found
[Pixabay API search] →  found → download MP4
        ↓ not found
[YouTube Data API search]
        ↓ video URL + best timestamp
[yt-dlp: stream & trim clip only (no full download)]
        ↓ not found / all fail
[fallback: b_roll_custom user-uploaded asset]
        ↓
[FFmpeg: trim to exact section duration]
[FFmpeg: drawtext "Source: X" top-left corner]
        ↓
[drop into existing pipeline assembly]
```

## Sources (priority order)

| Priority | Source | API | License | Free? |
|---|---|---|---|---|
| 1 | Pexels | REST API + API key | CC0, commercial OK | Yes |
| 2 | Pixabay | REST API + API key | Pixabay License, commercial OK | Yes |
| 3 | YouTube | YouTube Data API v3 + yt-dlp | Fair use / attribution | Free quota |
| 4 | Manual upload | b_roll_custom asset in DB | User owns | — |

## Attribution watermark
- Position: top-left (x=20, y=20)
- Style: white text, semi-transparent black box background
- Format: `Source: <platform> / <channel or author>`
- FFmpeg drawtext filter applied per clip before compositing

## What needs to be built

### Backend (`daily.py`)
- `search_pexels_video(query, duration_max)` → returns `{url, source_label}` or None
- `search_pixabay_video(query, duration_max)` → returns `{url, source_label}` or None
- `search_youtube_video(query)` → returns `{url, channel, timestamp_hint}` or None
- `download_clip_ytdlp(url, start_s, duration_s, output_path)` → path
- `fetch_auto_broll(b_roll_prompt, section_duration_s, output_path)` → `{path, source_label}` or None
- `_stamp_source(clip_path, source_label, output_path)` → FFmpeg drawtext
- Update `_resolve_pipeline_assets()` to call `fetch_auto_broll` when no manual b_roll found

### Config / .env
- `PEXELS_API_KEY`
- `PIXABAY_API_KEY`
- `YOUTUBE_DATA_API_KEY`

### requirements.txt
- `yt-dlp` (already a dependency via openai-whisper, but add explicitly)
- `requests` (for Pexels/Pixabay REST calls)

## No AI video generation fallback (v1)
Luma / Runway / Sora are paid with per-second costs. Skip for v1. Manual upload is the final fallback.

## Out of scope for v1
- AI-generated video fallback (Luma Dream Machine, Runway Gen-3)
- 12Labs semantic video search
- Reddit / Instagram / TikTok scraping
- Automatic rights verification

## Notes
- yt-dlp clips: use `--download-sections "*start-end"` flag to avoid downloading full videos
- YouTube ToS technically restricts programmatic download; use only for personal/editorial use
- Pexels and Pixabay clips are commercially safe — prefer these first
- Attribution must always be shown even for CC0 content (good practice)

# Current State of the Application

**Scope of this document:** unlike `F001`–`F011` (which are forward-looking design proposals written before each feature was built), this document describes what is **actually implemented and running today**, including drift from those original specs. Where the two disagree, this document — and the code — wins.

Generated: 2026-10-03.

---

## 1. High-level architecture

```
frontend_rn/            Expo React Native app (single-screen, tab-switching UI)
  App.tsx                 All UI + screen state (~2700 lines)
  src/api/client.ts        Thin fetch wrapper over every backend endpoint
  src/types.ts              Shared TS types mirroring backend schemas

backend/
  app/main.py              FastAPI route definitions only — no business logic
  app/daily.py              Everything: DB schema, script generation, Script Director,
                             Series Creator, Episode Plan Memory, visual bible, Veo
                             b-roll generation, FFmpeg assembly, pipeline orchestration
                             (~3000 lines — the entire product lives in this one file)
  app/storage.py            Generic asset table (uploads: a_roll / b_roll_custom)
  app/config.py             Paths, API keys, storage-dir bootstrap
  app/schemas.py            Pydantic response/request models for FastAPI
  app/pipeline.py           DEAD CODE — see §7

local_storage/
  pipeline.db               SQLite — all app state (see §3)
  assets/                   Uploaded + generated media, by kind
  outputs/                  Final rendered {date_ist}_final_edit.mp4 files
```

The backend is a single FastAPI process (`uvicorn`) run locally; the frontend is an Expo app (works in browser via `react-native-web`, or on-device). There is no auth, no multi-user concept, no cloud deployment — this is a single-operator local tool. `API_BASE_URL` defaults to `http://127.0.0.1:8000`.

External services used:
- **Google Gemini** (`gemini-2.5-flash`, via `google-genai` SDK, API-key auth) — script generation, Script Director chat, Series Creator, visual bible extraction, Veo shot planning.
- **Veo 3.1** (`veo-3.1-generate-001`, via `google-genai` SDK, Vertex AI auth) — AI b-roll video generation. Needs `VERTEX_PROJECT` + `VERTEX_LOCATION` env vars and `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON.
- **OpenAI Whisper** (`openai-whisper`, local `tiny` model, CPU) — caption transcription of the a-roll audio.
- **FFmpeg** (external binary on PATH) — all video trim/scale/overlay/concat/encode work.
- YouTube Data API / yt-dlp / youtube-transcript-api — wired up (`F011`) but **currently unreachable code** (see §7).

---

## 2. The core content loop (what the product actually does)

1. **Daily topic assignment** — a 30-day CSV queue (`TOPIC_QUEUE_30_DAYS.csv`) seeds a `topic_queue` table. Each day, `assign_today_if_missing()` picks the next non-recently-used topic and writes a `daily_assignment` row for today's IST date.
2. **Script generation** — Gemini writes a fixed 6-section, 90-second script (hook / context / evidence / story_turn / takeaway / cta) as JSON. Falls back to a deterministic template (`_build_script_payload`) if Gemini is unavailable or fails.
3. **Script editing (optional)** — "Script Director" is a scoped chat agent that proposes section rewrites, which the user applies as a new script version (full version history, revertible).
4. **Recording** — user records/uploads their a-roll (talking-head) video for the day via the in-app recorder or file upload. Stored as asset kind `a_roll`.
5. **B-roll preview (optional, zero-cost)** — "Preview Final Prompts" button computes the visual bible + every section's Veo shot plan via Gemini only, so the user can sanity-check before spending Veo generations.
6. **Pipeline trigger** — one button kicks off the whole assembly in a background thread:
   - Resolve a-roll + any manually-uploaded b-roll clips
   - Compute the **visual entity bible** (one Gemini call, cached per day)
   - Generate AI b-roll for every b-roll section missing a manual clip (Veo, multi-shot, parallelized)
   - Transcribe the a-roll with Whisper → `.srt`
   - Assemble everything with one FFmpeg `filter_complex` command
   - Write `{date_ist}_final_edit.mp4` to `local_storage/outputs/`
7. **Download** — final video fetched via `/api/pipeline/output/download`.

Separately, **Series Creator**: plan a themed multi-day series via chat, optionally plan each episode's narrative beats ("Episode Plan Memory") before generating its script, then "activate" the series to queue future daily assignments.

---

## 3. Data model (SQLite — `local_storage/pipeline.db`)

| Table | Purpose | Key columns |
|---|---|---|
| `topic_queue` | The pool of daily topics (seeded from CSV + series-generated) | `id`, `day_index`, `category`, `topic_angle`, `hook_idea`, `enabled` |
| `daily_assignment` | One row per calendar date (IST) — which topic, status, optional series link | `date_ist` (PK), `topic_id`, `status`, `series_id`, `series_day_offset` |
| `scripts` | Full version history of generated scripts, one date can have many versions | `id`, `date_ist`, `topic_id`, `script_json`, `version`, `created_at` |
| `series` | A Series Creator draft/active/superseded series | `id`, `name`, `day_count`, `status` |
| `series_items` | One episode within a series | `series_id`, `day_offset`, `sub_topic`, `category`, `topic_angle`, `hook_idea`, `plan_notes` (JSON), `script_draft` (JSON) |
| `daily_sessions` | Pipeline job state, persisted so status survives a server restart | `date_ist` (PK), `pipeline_status`, `pipeline_progress`, `pipeline_output_path`, `pipeline_step` |
| `assets` (in `storage.py`, separate `init_db()`) | Every uploaded/generated media file | `id`, `kind`, `topic`, `recording_date`, `section_index`, `file_path` |

`status` lifecycle for `daily_assignment`: `assigned → scripted → recording → uploaded → ready_for_edit` (defined in `ALLOWED_STATUSES`; not all transitions are currently enforced by the UI).

In-memory-only state (lost on server restart, not persisted):
- `_PIPELINE_JOB` — live pipeline progress/logs (falls back to `daily_sessions` table for cross-restart status, but a run in progress during a restart is reported as `failed`)
- `_BROLL_TEST_JOB` — b-roll test job state
- `_VISUAL_BIBLE_CACHE: dict[date_ist, dict]` — the day's visual entity bible, computed once and reused by preview, test, and the real pipeline run
- `_APPLY_TOKENS` — short-lived (10 min) tokens for Script Director "propose → apply" two-step flow

---

## 4. Script schema (schema_version 2)

Each script is:
```jsonc
{
  "schema_version": 2,
  "topic": "...", "video_title": "...", "tone": "energetic",
  "duration_sec": 90, "cta": "...", "disclaimer": "...",
  "total_word_count": 123,
  "sections": [
    {
      "index": 0, "name": "hook", "label": "Hook",
      "timing": {"start_s": 0, "end_s": 3},
      "shot_type": "a_roll" | "b_roll",
      "text": "[SLOW] narration with inline [CUE] tokens",
      "plain_text": "cue tokens stripped — computed server-side",
      "word_count": 7, "cue_summary": ["SLOW"],
      "on_screen_text": "...", "transition_after": "flash_zoom",
      "b_roll_slot": true|false, "b_roll_prompt": "...", "proof_overlay": "..."
    }
  ]
}
```

Fixed 6-section structure, fixed timings (0-3 / 3-18 / 18-45 / 45-70 / 70-86 / 86-90s) — these are **scripted targets**, not necessarily the actual recorded length (see §6, bug #2).

**`shot_type` policy (as of this session's fix):** `hook` and `cta` are always `a_roll`; `context`, `evidence`, `story_turn`, `takeaway` are always `b_roll`. This is now **enforced server-side** by `_enforce_shot_types()`, applied at every script read/write path (generation, cache-read, Script Director apply, revert) — not left to the LLM's discretion, because the LLM was observed to not reliably follow the prompted instruction.

---

## 5. The b-roll generation pipeline (the part most actively worked on)

### 5.1 Visual entity bible
`_compute_visual_bible(date_ist, sections)` — one Gemini call reads **all** section narrations together and extracts **every** recurring visual entity (people, brands, products, locations, objects) it finds, each with a 40-60 word canonical visual description (exact clothing, colors, build, texture, etc.). Parsed from a `ENTITY:/NAME:/DEFINITION:/---` block format. Cached in `_VISUAL_BIBLE_CACHE` per `date_ist` — computed lazily, once, the first time any b-roll operation needs it that day (preview, test, or real pipeline run all share the same cache).

`_visual_bible_block()` formats the bible into a `VISUAL CONSISTENCY GUIDE` string injected verbatim into every downstream Veo prompt, so the same entity renders consistently across every shot and every section that mentions it.

### 5.2 Multi-shot Veo planning
For each b-roll section, `_build_veo_shots()` asks Gemini to split the section's narration into 1-3 directed shots (word count decides 1 vs 2 vs 3), each a full 100-130 word cinematic prompt (subject/action, camera, environment, lighting, color grade, texture), with the visual bible's relevant entity descriptions embedded verbatim. Shot count/duration logic:
- narration < 120 chars → 1 shot
- total duration ≤ 10s → 2 shots
- otherwise → 3 shots, each capped at 8s (Veo's per-generation max)

`BROLL_CLIP_MAX_S = 24.0` (3 shots × 8s) is the real ceiling for how much b-roll footage a section can get; `BROLL_CLIP_MIN_S = 3.0` is the floor. (**Fixed this session** — was hardcoded to `8.0`, a leftover from before multi-shot existed, which silently capped every section's b-roll to ~8s total regardless of how long the section actually ran.)

### 5.3 Generation + assembly
`_generate_ai_broll()`: all shots for a section fire in parallel (`ThreadPoolExecutor`) against Veo 3.1 on Vertex AI. Each Veo call always generates a full 8-second clip; FFmpeg then trims it down to the shot's target duration and normalizes to 1080×1920. Successful shots are concatenated (`ffmpeg concat` demuxer, stream copy) into one b-roll file per section.

### 5.4 Which sections get AI b-roll
Generic filter, not hardcoded per section name: any section where `shot_type == "b_roll"` and `name not in ("hook", "cta")`, and no manually-uploaded `b_roll_custom` asset already covers that `section_index`. Currently that's `context`, `evidence`, `story_turn`, `takeaway` (see §4). The same filter, same `_generate_ai_broll()` call, same visual-bible injection applies uniformly to all of them — there is no special-casing of "evidence" anywhere in the generation path. (The one place that *did* hardcode `"evidence"` — the newspaper-card overlay — is disabled; see §6.)

### 5.5 Zero-cost preview
- `preview_veo_prompt(date_ist, section_index)` — single section's shot plan + bible, Gemini only, no Veo call.
- `preview_all_veo_prompts(date_ist)` — every b-roll section's shot plan + the shared bible in one response. Backs the "Preview Final Prompts" button.

---

## 6. FFmpeg final assembly (`_build_ffmpeg_cmd` + `_run_pipeline`)

Single `filter_complex` graph, 1080×1920 canvas:
1. A-roll scaled/cropped to fill the vertical canvas — this is the base video track for the entire duration.
2. Each b-roll section's clip is scaled/cropped the same way, then overlaid on top of the a-roll **only during that section's `[start_s, end_s]` window** (`overlay=...:enable='between(t,...)'`).
3. Captions burned in from the Whisper `.srt` via the `subtitles` filter with `force_style`.
4. Output muxed with `libx264` (CRF 23, `ultrafast` preset) + AAC audio, 30fps, `yuv420p`.

**Bugs found and fixed this session** (all in this file):
- **B-roll overlay desync/freeze** — the overlay filter played each b-roll clip from its own frame 0 at the main timeline's absolute time 0, not from the section's `start_s`. Combined with the 8s duration cap (§5.2), a clip meant for an 18-45s window would run out almost immediately and then **freeze on its last frame for the rest of the window** (ffmpeg's default `overlay` behavior once an input stream ends). This is what showed up as "a single frozen ship photo covering my face for the whole evidence section." Fixed with a `setpts=PTS+{t0}/TB` delay on each b-roll stream so its own time-zero lands exactly at the section's `start_s`, plus a `ffprobe`-based clamp so the overlay window never extends past however much footage actually exists (reverts cleanly to a-roll instead of freezing if the clip runs short).
- **Final video truncated to the scripted length, cutting off the CTA** — `total_s` (the FFmpeg `-t` trim value) was `max(section.end_s for section in sections)`, i.e. the *scripted* 90s target, not the actual a-roll recording length. If the user talks longer than the script anticipated (observed: 112s actual vs 90s scripted), the real recording — including the CTA — got hard-truncated. Fixed: `total_s` now comes from `ffprobe`-ing the actual a-roll file, falling back to the scripted total only if the probe fails.
- **Captions too bold / wrong color / boxed** — iterated across this session from a large bold black-on-yellow-box style down to the current: `FontSize=8, PrimaryColour=&H00FFFFFF (white), BorderStyle=1, Outline=0, Shadow=0, Bold=0` — plain white text, no background box, no outline, bottom of frame (`MarginV=15`).
- **Newspaper-card overlay disabled** — it was popping onto screen as an unwanted visual artifact during the evidence section. `newspaper_png` is now forced to `None` in `_run_pipeline`, so the whole overlay block is dead at runtime. The Pillow-based generator (`_generate_newspaper_card`) is untouched/still callable if this gets re-enabled later.

---

## 7. Known drift from the original specs / dead code

- **`backend/app/pipeline.py`** (the module `F006`/`F007` describe) is **never imported anywhere** — `main.py` doesn't reference it. The entire real pipeline (`trigger_pipeline`, `_run_pipeline`, `_build_ffmpeg_cmd`) lives in `daily.py` instead. `pipeline.py` is orphaned dead code describing an earlier, much simpler concat-only design that was superseded.
- **`F011` (auto b-roll sourcing from YouTube)** is fully implemented (`_search_youtube`, `_get_video_transcript`, `_find_best_clip_with_gemini[_vision]`, `_download_youtube_clip`, `_fetch_broll_youtube`, plus `PEXELS_API_KEY`/`PIXABAY_API_KEY`/`YOUTUBE_DATA_API_KEY` config) but **`_fetch_broll_youtube` is never called from anywhere** in the current codebase. It was fully superseded by the Veo AI-generation pipeline (§5) and is now unreachable code, not a fallback.
- **`_run_broll_test`'s docstring** says "generate YouTube b-roll for every b_roll section" — it actually calls `_generate_ai_broll` (Veo), and only tests **one** section (`[:1]` slice), not every section. Docstring is stale.
- **Series Creator → daily pipeline handoff gap**: "Episode Plan Memory" (`generate_episode_script`) writes a full planned script into `series_items.script_draft`, but `activate_series()` only queues a `daily_assignment` row pointing at a `topic_id` — it never copies `script_draft` into the `scripts` table. So when that future date actually arrives, `generate_today_script()` finds no existing `scripts` row and generates a **brand-new** script from just the topic/hook, silently discarding the carefully-planned episode script. If you've been using Episode Plan Memory expecting it to carry through, it currently doesn't.
- **`generate_episode_script`** does not call `_enforce_shot_types()` (unlike every other script-writing path). Low priority given the gap above means its output isn't currently consumed by the real pipeline anyway, but worth fixing together if the gap above is ever closed.
- **Script caching**: `generate_today_script(force_regenerate=False)` always returns the latest cached version for the day; a new script is generated by Gemini only on first script-of-the-day, or an explicit "Regenerate Script". Section content (narration/wording) is never auto-refreshed just because, e.g., the `shot_type` policy changed — only `shot_type`/`b_roll_slot`/`b_roll_prompt` get live-patched on every read (`_enforce_shot_types`, applied in-memory, not persisted as a new version) so policy changes apply retroactively without discarding a day's narration.

---

## 8. Frontend (React Native / Expo)

**Stack**: Expo SDK 51, React Native 0.74.5, React 18.2. `react-native-web` is present, so the app also runs in a browser via `expo start --web`. No test script, no lint script. Package name (`shorts-creator-console-rn`) doesn't match the repo/folder name (`shorts_pipeline`/`frontend_rn`) — likely a rename that wasn't fully propagated.

**Architecture**: single-screen app, no navigation library (no React Navigation, no Expo Router). Everything lives in one ~2700-line `App.tsx`. A `feature` state (`"today" | "tasks" | "assets" | "series"`) picks which body renders under a persistent top bar; several `Modal`s (Teleprompter, Script Director, Section Edit, Episode Plan, Topic Picker) layer on top independent of the tab system. State management is plain `useState` (~35+ hooks in one component) with no Redux/Context/reducer; data loading is a single `refreshData()` that fires on mount and after most mutations — no caching layer (no React Query/SWR).

### The four tabs

- **Today** — today's topic card + the full script as section cards (tap to open the single-section Script Director). "Enter Teleprompter Mode" button. Calls `fetchToday`, `fetchTeleprompter`, topic reassignment + script regenerate on topic change.
- **Tasks** — the ops/utility tab: Script regenerate + "Open Script Director" (full chat editor); the **Video Pipeline** card (4-step stepper Assets→Whisper→Newspaper→FFmpeg, 3s-interval status polling, log tail, FFmpeg % bar, download button); a **Veo Shot Plan Preview** card (single-section prompt preview); and the **AI B-Roll** card, which holds both "Preview Final Prompts" (zero-cost, `fetchAllVeoPrompts`) and "Run B-Roll Test" (real Veo call, `startBrollTest`, polled).
- **Assets** — storage summary, upload (kind chips + `expo-document-picker`), and a filterable asset list with download/preview/delete.
- **Series** — Series Creator: generate a themed series by chat, plan/edit episodes (`EpisodePlanPopup`), activate a series into future `daily_assignment` rows, or view the currently active series read-only.

### Teleprompter + recorder

The teleprompter is **not auto-scrolling** — it shows one section at a time at large adjustable font size, manual Previous/Next/Finish navigation, with a per-section elapsed-time progress bar that stops at the cap (doesn't auto-advance or alert). Voice cue tokens (`[SLOW]`, `[EMPHASIZE]`, etc.) are parsed client-side into colored inline badges.

The recorder is embedded in the teleprompter modal, **web-excluded** (`Platform.OS !== "web"` hides it entirely, with no messaging to web users about why). Uses `expo-camera`'s `CameraView` at fixed `videoQuality="2160p"` (4K) / `facing="front"`, no UI to change either. **Each teleprompter section is recorded and uploaded as its own separate clip**, tagged by `section_index`, immediately on pressing stop — no preview/retake confirmation, and a failed recording (no `uri` returned) silently skips the upload with no user-facing error. Finishing the last section chains `updateSessionStatus("uploaded")` → `triggerPipeline()` automatically.

### Script Director / Section Edit

Both are near-identical chat-propose-apply-undo flows (free-text → `chatScript` → diff cards for `propose`/`redesign` actions → "Apply" creates a new script version → 30s "Undo" via `revertScript`), implemented twice with no shared abstraction. Script Director additionally guesses chat scope client-side (`inferScope()`, a fragile keyword match against section names) rather than having the server confirm scope.

### Series Creator / Episode Plan Memory

`EpisodePlanPopup` is the most complex modal — a dynamically-widening 3-panel layout (Agreed Plan / Chat / Script Preview) that opens a planning chat (`planSeriesEpisode`), lets the user apply a plan (`saveEpisodePlan`), then generate a full script from it (`generateEpisodeScript`), with a per-section "Preview Veo Prompt" button. Closing the popup auto-applies any pending plan first so it isn't silently lost.

### B-Roll preview UI

The Visual Entity Bible + per-section Veo shot prompts are shown via a dark navy "Visual Entity Bible" card (every entity name + 40-60 word definition) and purple per-shot cards (moment/duration/full prompt) — this is the UI backing `preview_all_veo_prompts`/`preview_veo_prompt` described in §5.5.

### Things worth fixing (frontend-side findings, not yet acted on)

- **Three separate UI entry points** call essentially the same Veo-prompt-preview capability with independent state and no cross-sync: the Tasks-tab single-section preview, the Tasks-tab "Preview Final Prompts" (all sections), and the Episode Plan popup's per-section preview (for a *series* script, separately cached).
- **`expo-camera` is used throughout `App.tsx` but missing from `package.json`'s `dependencies`** — verified: it *is* physically present in `node_modules` and referenced in `package-lock.json`, so the app currently runs, but a fresh `npm install` reconciled strictly against `package.json` could drop it. Should be added to `package.json` explicitly.
- Poller intervals (`pipelinePollerRef`, `brollPollerRef`) are only cleared when a job reaches `done`/`failed`, not on component unmount (no `useEffect` cleanup) — low-risk in this single-screen app, but inconsistent with the teleprompter's timer, which is cleaned up properly.
- `onFetchAllVeoPrompts()`'s error path uses a bare `alert(...)` — the only place in the file not using inline status text, and `alert` doesn't render reliably on native.
- Changing the topic on the Today tab (`onPickTopic`) always immediately regenerates the script with no confirmation, discarding any in-progress Script Director edits on the old topic.
- The pipeline's "Download Final Edit" button uses an inline `require("react-native")` for `Linking` even though `Linking` is already imported normally at the top of the file and used elsewhere.

---

## 9. Environment / secrets required to run this end-to-end

| Variable | Used for |
|---|---|
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | All Gemini calls (script gen, Script Director, Series Creator, visual bible, Veo shot planning) |
| `VERTEX_PROJECT`, `VERTEX_LOCATION` | Veo 3.1 video generation (Vertex AI) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service-account JSON for Vertex AI auth (resolved to absolute path by `config.py` if relative) |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `YOUTUBE_DATA_API_KEY` | Wired up for F011 but currently dead code (§7) — not required for the live pipeline |
| FFmpeg + ffprobe on PATH | Every video operation |
| `yt-dlp`/`youtube-transcript-api` installed | Only exercised by the currently-unreachable F011 code path |

No `.env.example` currently checked in (git status shows it deleted); real secrets live in `backend/.env`, loaded via `python-dotenv` in `config.py`.

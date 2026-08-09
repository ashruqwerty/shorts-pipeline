# F002 — LLM Script Generation

## Goal
Replace the static `_build_script_payload` template with a live Anthropic Claude call that produces a contextual v2 script for today's topic. The static template remains as a fallback when the API is unavailable.

## Provider & Model
- Library: `anthropic` Python SDK (official, not raw HTTP)
- Model: `claude-opus-5`
- Thinking: `{"type": "adaptive"}` (required for claude-opus-5)
- Streaming: yes, via `.messages.stream()` + `.get_final_message()` (protects against timeout on large outputs)

## Key credential
`ANTHROPIC_API_KEY` in the backend's environment (or `.env`). Also accepted: `ANTHROPIC_AUTH_TOKEN` (fallback for CI/CD pipelines that inject a token).

## System prompt
Adapted from `SCRIPT_PROMPT_PACK.md` master template, updated for v2:
- Audience: India-first business / startup / trade viewers
- 6 fixed sections: hook(0-3s) → context(3-18s) → evidence(18-45s) → story_turn(45-70s) → takeaway(70-86s) → cta(86-90s)
- Inline `[CUE]` voice-direction tokens embedded in `text`; allowed tokens: SLOW FAST NORMAL EMPHASIZE WHISPER LOUD HIGH LOW PAUSE BEAT BREATHE EXCITED SERIOUS
- Output: v2 JSON schema (see below); **do NOT include** `plain_text`, `word_count`, `cue_summary`, `total_word_count` — server computes them

## Output JSON schema (what Claude must emit)
```json
{
  "schema_version": 2,
  "topic": "<string>",
  "video_title": "<string ≤58 chars>",
  "tone": "energetic",
  "duration_sec": 90,
  "cta": "<3–4 sec CTA line>",
  "disclaimer": "<educational disclaimer if finance topic, else empty string>",
  "sections": [
    {
      "index": 0,
      "name": "hook",
      "label": "Hook",
      "timing": {"start_s": 0, "end_s": 3},
      "shot_type": "a_roll",
      "text": "<narration with [CUE] tokens>",
      "on_screen_text": "<bold screen title>",
      "transition_after": "flash_zoom",
      "b_roll_slot": false,
      "b_roll_prompt": "",
      "proof_overlay": ""
    }
    // sections 1–5 follow same shape with their respective fixed timings
  ]
}
```

## Server-side enrichment
After parsing Claude's JSON, call `_enrich_section(s)` on every section to add:
- `plain_text` — `_strip_cues(text)`
- `word_count` — `len(plain_text.split())`
- `cue_summary` — `_cue_summary(text)`

Then compute `total_word_count = sum(s["word_count"] for s in sections)`.

Validate the enriched payload with `ScriptV2(**payload)` before returning.

## Fallback strategy
Any exception (network, parse error, Pydantic validation failure) → return `None` from `_call_llm_for_script` → caller (`generate_today_script`) falls through to `_build_script_payload(assignment)`.

## Call site
`generate_today_script()` in `daily.py`:
```python
payload = _call_llm_for_script(assignment) or _build_script_payload(assignment)
```

## Acceptance criteria
1. `POST /api/daily/script/regenerate` when `ANTHROPIC_API_KEY` is set returns a v2 script with real contextual text (not static boilerplate) and passes `ScriptV2` Pydantic validation.
2. When `ANTHROPIC_API_KEY` is unset, the same endpoint returns the static template (no error).
3. Each section's `plain_text` has no `[CUE]` artifacts; `word_count` matches `len(plain_text.split())`.
4. All 6 sections present with correct `index` values 0–5.

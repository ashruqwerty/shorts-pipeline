# Script Prompt Pack for Daily 90s Shorts

Use these prompts with any LLM. Keep output in structured JSON for automation.

## 1) Master Prompt Template

You are writing a 90-second vertical short script in energetic Hinglish-English business-news style.

Audience:
- India-first viewers interested in startups, markets, trade, geopolitics, and financial freedom.

Constraints:
- 90 seconds total
- Hook in first 3 seconds
- 5 to 7 sections max
- Every section must include one visual instruction
- Include 2 to 4 AI B-roll prompts
- Add factual proof overlays (source + date)
- End with CTA of 3 to 4 seconds only
- If topic is finance/investing, add educational disclaimer
- Include custom_b_roll_slot boolean for each section so user-uploaded clips can override AI clips

Return ONLY valid JSON with this schema:
{
  "topic": "",
  "video_title": "",
  "tone": "energetic",
  "duration_sec": 90,
  "sections": [
    {
      "start": "00:00",
      "end": "00:00",
      "narration": "",
      "on_screen_text": "",
      "shot_type": "a_roll|b_roll",
      "custom_b_roll_slot": false,
      "b_roll_prompt": "",
      "b_roll_prompt_structured": {
        "subject": "",
        "action": "",
        "location": "",
        "camera": "",
        "lens_feel": "",
        "lighting": "",
        "color_mood": "",
        "duration_sec": 0,
        "continuity_tags": [""],
        "forbidden_elements": [""],
        "negative_prompt": ""
      },
      "proof_overlay": "",
      "transition_after": ""
    }
  ],
  "cta": "",
  "thumbnail_text": "",
  "hashtags": {
    "youtube": [""],
    "instagram": [""],
    "facebook": [""]
  },
  "disclaimer": ""
}

## 2) Topic-Specific Prompt Add-ons

### A) Startup Funding Story
Focus on: round size, investor names, founder backstory, business model, why now.

### B) Old Business Story
Focus on: origin year, turning point, near-failure moment, modern relevance.

### C) Trade Story
Focus on: exporter-importer countries, margin bottleneck, policy effect, winner/loser.

### D) Geopolitical Story
Focus on: event timeline, economic impact, supply-chain effect on India.

### E) Supply Chain Company Story
Focus on: one product and the hidden companies enabling each stage.

### F) Unknown Indian Export Product
Focus on: region, export value, global demand, opportunity for entrepreneurs.

### G) Financial Freedom Advice
Focus on: one principle, one numeric example, one actionable step within 24 hours.

## 3) Shot Planning Output Prompt

Convert this script into a creator shot list optimized for phone recording.
Return markdown table with columns:
- clip_no
- duration_sec
- line_to_speak
- gesture_or_expression
- framing
- retake_tip

## 4) B-roll Generation Prompt

Generate 4 short AI video prompts aligned to these script timestamps.
Constraints:
- 9:16 vertical
- realistic or semi-cinematic style
- no copyrighted logos unless editorial style is required
- each clip 1.5 to 3.0 seconds
- include camera movement and lighting notes

Use this strict format for each prompt:
- Intent: what this shot must communicate in story
- Subject: main object/person
- Action: what changes on screen
- Scene and location: where it happens
- Camera: movement + framing
- Lens feel: wide/normal/tele look
- Lighting: time of day + key light style
- Color grade: energetic business-news tone
- Continuity tags: repeatable style labels across clips
- Hard constraints: no wrong country flags, no random brand logos, no text artifacts
- Negative prompt: what must not appear

Example high-accuracy prompt skeleton:
"Vertical 9:16, 2.2s. Intent: show trade bottleneck. Subject: stacked shipping containers at Indian port. Action: crane pauses and queue grows. Camera: slow push-in from chest height, stabilized. Lens feel: 35mm natural perspective. Lighting: overcast daylight, high detail. Color mood: deep navy shadows with cyan highlights. Continuity tags: energetic_news_v1, trade_map_v1. Hard constraints: no visible fictional logos, no incorrect flags, no distorted text. Negative prompt: blur text, fantasy elements, extra limbs, warped cranes."

## 5) Caption Styling Prompt

Generate per-line captions from the final narration.
Constraints:
- max 32 characters per line
- max 2 lines per frame
- highlight numbers, money values, company names
- mark highlight words with <hl> tags

## 6) Metadata Prompt (Platform Adaptation)

Create:
- YouTube Shorts title <= 58 chars
- Instagram caption with hook + 5 hashtags
- Facebook caption concise and factual
- One pinned comment question to trigger engagement

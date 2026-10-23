# Pre-ship testing checklist

Run this before testing any change on your phone — not after you've already discovered it's broken there. Each layer catches a different class of bug; skipping one means that class of bug ships silently.

## 1. Backend smoke tests — fast, free, run constantly

```
cd backend
.venv310\Scripts\python.exe -m pytest tests/test_api_smoke.py
```

No API calls, no cost, ~15 seconds. Catches: broken imports, a route that doesn't start up, a function signature mismatch between `main.py` and `daily.py` — the kind of bug where the server would just crash or 500 on first request. **Run this after every backend change, before anything else.**

## 2. Backend AI-reliability tests — slower, costs real API calls, run before shipping a change to any Gemini-calling function

```
cd backend
.venv310\Scripts\python.exe -m pytest tests/test_gemini_reliability.py -s
```

~2-3 minutes, makes ~17 real Gemini calls. This exists because of a real incident: `generate_series` intermittently threw `Expecting ',' delimiter` errors — Gemini occasionally embeds an unescaped quote inside generated text, which breaks naive `json.loads()` at an unpredictable position. **A function that works when you test it once by hand proves nothing** — this class of bug is non-deterministic by nature. The test suite calls each AI-JSON function multiple times live and fails loudly if even one call produces invalid output.

**Run this whenever you touch:** `generate_series`, `chat_script`, `chat_series`, `plan_series_episode`, `generate_episode_script`, or any new function that asks Gemini to return structured JSON.

**If a test in this file starts failing:** don't just re-run it and hope — that function needs the same fix `generate_series` got. See `_SeriesItemSchema` in `backend/app/daily.py` for the pattern: define a Pydantic model for the expected shape, pass it as `response_schema` with `response_mime_type="application/json"` in the `GenerateContentConfig`, and let the Gemini API itself guarantee valid JSON instead of parsing free-form text.

## 3. Frontend bundle check — fast, free

```
cd frontend_rn
npm run verify:bundle
```

Confirms the app actually compiles for a real native target (Android), not just the web preview you've been using in a browser. Catches import errors, syntax errors, and anything that would make Expo Go show the generic "Sorry about that" crash screen on your phone. **Run this after any `App.tsx` change, before reaching for your phone.**

## 4. Manual device test — the one thing nothing above replaces

None of the above catches a UI that renders but looks wrong, a tap target that doesn't register, a layout that overflows a real phone screen, or anything about the actual on-device experience. Multiple real bugs this session were *only* visible this way:
- A popup sized for desktop that was unusable on phone (automated checks don't know what "unusable" looks like)
- Nested `ScrollView`s intercepting touches on Android specifically — works fine in a browser, breaks in RN's native touch handling
- The in-app camera recorder, which turned out to have never been exercised on any platform at all

**Always do a real walkthrough on your phone** after the automated checks pass — today's script, teleprompter, asset upload, pipeline trigger, Series Creator. Automated tests buy you confidence that the *backend logic* is sound; they don't buy you confidence that the *feature* is good.

## Quick reference

| Change touches... | Run |
|---|---|
| Any backend code | #1 (always) |
| A Gemini/AI-generation function | #1 + #2 |
| `App.tsx` / any frontend code | #3 |
| Anything user-facing | #4, always, no exceptions |

## One-time setup (if these aren't installed yet)

```
cd backend
.venv310\Scripts\python.exe -m pip install -r requirements-dev.txt
```

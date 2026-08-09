# Shorts Pipeline

A self-hosted, AI-powered creator workflow for producing 90-second vertical shorts. Runs entirely on your local machine — no SaaS dependency.

## What it does

1. **Picks today's topic** from a 30-day queue (`TOPIC_QUEUE_30_DAYS.csv`)
2. **Generates a script** via Claude AI (Anthropic API) — 6 sections with embedded voice-direction cues (`[SLOW]`, `[EMPHASIZE]`, `[PAUSE]`, …)
3. **Shows the full script preview** on load so you can review before recording
4. **Smart teleprompter** — inline colored cue labels, section timer progress bar
5. **Section-by-section recorder** — one clip per section, full native resolution; each clip auto-uploads to the backend
6. **FFmpeg assembly** — after all 6 clips are done, automatically concatenates them into a final mp4

---

## Stack

| Layer | Tech |
|---|---|
| Mobile app | React Native + Expo 51 |
| Backend API | FastAPI + SQLite |
| LLM | Anthropic Claude (`claude-opus-5`) |
| Video assembly | FFmpeg |

---

## Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- [FFmpeg](https://ffmpeg.org/download.html) in PATH (for final assembly)
- Anthropic API key (optional — falls back to static template without it)

---

## Setup

### 1. Backend

```bash
cd backend
python -m venv venv
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

pip install -r requirements.txt

# Optional: create .env for AI script generation
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

uvicorn app.main:app --reload
# → API running at http://127.0.0.1:8000
# → Docs at http://127.0.0.1:8000/docs
```

### 2. Mobile app

```bash
cd frontend_rn
npm install

# Set backend URL (default is http://127.0.0.1:8000)
# For physical device on same network, use your machine's local IP:
# EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000

npx expo start
```

Scan the QR code with **Expo Go** (Android / iOS).

---

## Daily workflow

1. Open the app → Today tab shows the full script preview
2. Review the 6 sections and their voice cues
3. Tap **Enter Teleprompter Mode**
4. For each section: tap **● REC** → read aloud → tap **■ STOP**
   - Clip auto-uploads with `section_index`
5. After section 6 → pipeline fires automatically → `local_storage/assets/render_final/` gets the assembled mp4

---

## Topic queue

Edit `TOPIC_QUEUE_30_DAYS.csv` to customize your 30-day content plan:

```
day,category,topic_angle,hook_idea
1,startup_funding,Zepto's dark store playbook,...
2,trade,India's shrimp export surge,...
```

Supported categories: `startup_funding`, `old_business`, `trade`, `geopolitics`, `supply_chain`, `export`, `financial_freedom`

---

## Project structure

```
shorts_pipeline/
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI routes
│   │   ├── daily.py       # Script generation + assignment logic
│   │   ├── pipeline.py    # FFmpeg assembly
│   │   ├── schemas.py     # Pydantic v2 models
│   │   ├── storage.py     # Asset upload/storage
│   │   └── config.py      # Paths + dotenv loader
│   ├── requirements.txt
│   └── .env.example
├── frontend_rn/
│   ├── App.tsx            # Main app (monolithic, all UI)
│   ├── src/
│   │   ├── api/client.ts  # API calls
│   │   └── types.ts       # TypeScript interfaces
│   ├── app.json
│   └── package.json
├── specs/                 # Feature specs (F001–F007)
├── TOPIC_QUEUE_30_DAYS.csv
└── SCRIPT_PROMPT_PACK.md  # LLM prompt templates
```

---

## Voice cue taxonomy

| Cue | Color | Purpose |
|---|---|---|
| `[SLOW]` | `#60A5FA` | Slow down delivery |
| `[FAST]` | `#F97316` | Speed up |
| `[EMPHASIZE]` | `#FBBF24` | Stress this word/phrase |
| `[PAUSE]` | `#9CA3AF` | Brief pause |
| `[BEAT]` | `#4B5563` | Dramatic beat |
| `[BREATHE]` | `#86EFAC` | Take a breath |
| `[WHISPER]` | `#C4B5FD` | Lower voice |
| `[LOUD]` | `#F87171` | Raise voice |
| `[HIGH]` | `#34D399` | Higher pitch |
| `[LOW]` | `#6366F1` | Lower pitch |
| `[EXCITED]` | `#FB923C` | Excited energy |
| `[SERIOUS]` | `#374151` | Serious tone |
| `[NORMAL]` | `#9CA3AF` | Reset to normal |

---

## Contributing

PRs welcome. See `specs/` for feature specs and `SCRIPT_PROMPT_PACK.md` for the LLM prompt design.

## License

MIT

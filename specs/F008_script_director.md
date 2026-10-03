# F008 — Script Director (Conversational Script Editing)

## Overview

A guardrailed, minimal chat panel in the **Tasks** tab that lets the creator direct the AI to edit the current script through natural conversation. Gemini always responds with multiple concrete options, asks a clarifying question after each set, and only commits changes when the creator explicitly taps **Apply**. Off-topic requests are rejected in-line.

---

## Motivation

After a script is generated the creator often knows *something is off* but can't articulate it as a single structured edit. They want to say "make the hook more alarming" or "add the RBI freight data" or "the evidence section is too long". A conversational director with multiple options per turn is faster than re-reading sections manually and more creative than a single-shot regenerate.

---

## User Stories

| # | As a creator I want to… | So that… |
|---|-------------------------|----------|
| 1 | Type "make the hook more shocking" and see **3 concrete alternatives** | I can compare options before picking |
| 2 | Say "rewrite the whole script with a different angle" and get a **full redesign** | I explore a fresh take without losing the current version |
| 3 | Pick an option (or say "combine 1 and 3") and have Gemini ask a clarifying follow-up | The final version is exactly what I had in mind |
| 4 | Tap **Apply** once I'm happy | The new version is saved and I go straight to teleprompter |
| 5 | Tap **Try again** to get 3 new options without losing the conversation | I stay in flow |
| 6 | Be blocked from asking off-topic questions | The tool stays focused |
| 7 | Target a specific section by tapping it in the script preview | Gemini already knows which section I'm talking about |

---

## Feature Scope

### In scope
- Edit any section (tone, angle, data points, cue placement)
- Reorder sections
- Add or delete a section
- "Dig deeper" — research richer data or a fresh angle for a section
- **Section-level prompt** → 3 concrete alternatives + clarifying question
- **Script-level prompt** → full script redesign + Try again (different language/angle each time, like Regenerate but conversational)
- Multi-turn conversation within a session (history carried client-side)
- Guardrails: all non-script-editing requests rejected with redirect examples

### Out of scope (v1)
- Persisting conversation history across sessions
- Branching / saving multiple draft proposals side-by-side
- Audio preview of the proposed change
- Voice input

---

## Suggestion Modes

### Mode A — Section-level (1–2 sections affected)

Gemini returns **exactly 3 alternatives** for the targeted section, numbered clearly. Each alternative is a complete rewrite of that section text (with cues). After the options, Gemini asks one clarifying question to refine further.

```
[Gemini]
Here are 3 alternatives for the Hook:

① [LOUD] One conflict is silently bleeding Indian SMEs dry.
  [PAUSE] ₹4,000 crore a month — and most founders haven't even heard of it.

② [EXCITED] The Red Sea isn't just a geography lesson anymore.
  [PAUSE] [EMPHASIZE] It's the reason your next import order costs 300% more.

③ [SLOW] Imagine a warzone 5,000 km away deciding your business margins today.
  [BEAT] That's not hypothetical. It's happening right now.

Which direction resonates — alarming data, relatable geography, or dramatic stakes?
You can also say "combine 1 and 3" or "try again with a softer tone."
```

User picks → Gemini produces the final version of that section → shows **Apply** button.

---

### Mode B — Script-level (3+ sections or whole-script request)

Gemini returns a **full redesigned script** driven entirely by what the user described in the conversation — the tone, angle, data points, or structural direction they specified. It does not randomly regenerate; it applies the user's stated direction across all sections. The **Try again** button rewrites the same direction differently — same intent, fresh execution (different phrasing, different evidence examples, different cue placement).

```
[Gemini]
Full script redesign — applying your "opportunity angle instead of crisis" direction:

Hook: [EXCITED] The Red Sea crisis is chaos for most businesses.
  [PAUSE] [EMPHASIZE] But for smart Indian exporters, it's an opening.
...
[Shows all 6 sections as collapsible diff cards]

Want me to tweak something specific, or try the same direction with a different entry point?

[Apply (saves as v11)]  [Try again]
```

---

## Clarifying Question Rules

- **Always** end a section-level response with a clarifying question after showing 3 options.
- **Always** end a script-level response with an open question ("want a different angle, or tweak something specific?").
- The clarifying question must be **specific to what was just shown** — not generic. ✓ "Which tone — data-heavy or emotional?" ✗ "Is there anything else?"
- After the user responds to the clarifying question, Gemini either:
  - Produces the final version → shows **Apply** button
  - Or gives a revised set of 3 options if the feedback was direction-level

---

## UI Design

### Entry point
- **Tasks** tab → new card: **"Script Director"**
- Tapping it opens a bottom sheet modal (full height mobile, side panel web)
- Alternatively: tapping any section card in the Today tab script preview opens Director with that section pre-targeted (sends opening context "Focus on: Hook section" to Gemini)

### Chat panel layout
```
┌──────────────────────────────────────────────┐
│  Script Director                  [×] Close   │
│  v9 · 6 sections · Red Sea shipping…          │
│──────────────────────────────────────────────│
│  [Gemini] I have your v9 script (6 sections). │
│  What would you like to change?               │
│                                               │
│  [User] Make the hook more alarming           │
│                                               │
│  [Gemini] Here are 3 alternatives for Hook:  │
│  ① [LOUD] One conflict is silently…          │
│  ② [EXCITED] The Red Sea isn't just…         │
│  ③ [SLOW] Imagine a warzone 5,000 km…        │
│                                               │
│  Which direction — alarming data, relatable   │
│  geography, or dramatic stakes?               │
│                                               │
│  [User] Go with option 2                      │
│                                               │
│  [Gemini] Here's option 2 finalised:          │
│  ┌─ Hook diff card ────────────────────────┐  │
│  │ Before: [EXCITED] A conflict thousands… │  │
│  │ After:  [EXCITED] The Red Sea isn't…   │  │
│  └──────────────────────────────────────────┘  │
│  Does the timing (0–3s) feel right, or         │
│  should I trim it?                            │
│                                               │
│  ┌─────────────────┐  ┌──────────┐           │
│  │  Apply (→ v10)  │  │Try again │           │
│  └─────────────────┘  └──────────┘           │
│──────────────────────────────────────────────│
│  [text input…]                    [Send →]    │
└──────────────────────────────────────────────┘
```

### States
| State | Description |
|-------|-------------|
| `idle` | Waiting for user input |
| `thinking` | Gemini API in-flight — typing indicator (3 animated dots) |
| `options` | 3 alternatives shown, clarifying question visible, no Apply yet |
| `proposal_ready` | Final version ready after user picked/refined — Apply button active |
| `script_redesign` | Full script redesign shown — Apply + Try again both visible |
| `applying` | Saving to DB — brief spinner on Apply button |
| `applied` | Version saved — "Saved as v10" banner + "Open Teleprompter →" shortcut |

### After Apply
- Show "Saved as v10 ✓" inline
- Show "Open Teleprompter →" button that dismisses modal and opens teleprompter
- Conversation history clears (next open starts fresh)

### Try again (Mode B only)
- Sends an implicit follow-up: `"Give me a completely different take — different angle, different language, different narrative structure."`
- New full redesign replaces the previous in the chat

---

## Backend API

### `POST /api/daily/script/chat`

Stateless — client carries full conversation history.

**Request body**
```json
{
  "message": "Make the hook more alarming",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "scope": "section"
}
```

`scope`: `"section"` (1–2 sections) | `"script"` (whole script redesign). The frontend infers this — if the message mentions a specific section name or a targeted section was pre-selected, it's `"section"`. Otherwise `"script"`.

**Response**
```json
{
  "action": "options" | "propose" | "redesign" | "rejected",
  "reply": "<Gemini's text response including the options or clarifying question>",
  "options": null,
  "proposed_sections": [...],
  "apply_token": "tok_abc123",
  "sections_changed": [0],
  "clarifying_question": "Which direction — alarming data, relatable geography, or dramatic stakes?"
}
```

`action` values:
| Value | Meaning |
|-------|---------|
| `options` | 3 section alternatives shown in `reply`, no Apply yet — clarifying question in `clarifying_question` |
| `propose` | Final section version ready — show Apply button |
| `redesign` | Full script redesign in `proposed_sections` — show Apply + Try again |
| `rejected` | Off-topic — `reply` has redirect message |

---

### `POST /api/daily/script/apply`

**Request body**
```json
{ "apply_token": "tok_abc123" }
```

**Response** — `ScriptBundleOut`
```json
{
  "date_ist": "2026-09-05",
  "version": 10,
  "created_at": "2026-09-05T10:32:00Z",
  "script": { ... }
}
```

Token is consumed on use (one-time). Expired or unknown tokens → 400.

---

## Gemini System Prompt (Script Director mode)

```
You are the Script Director — a specialist AI that edits short-form video scripts.

HARD RULE — SCOPE:
You ONLY edit the script below. You refuse ALL other requests.
For any off-topic request return:
{"action":"rejected","reply":"I can only edit this script. Try: 'make the hook punchier', 'add RBI data to evidence', 'rewrite takeaway from an opportunity angle', or 'redesign the whole script'.","proposed_sections":null,"clarifying_question":null}

CURRENT SCRIPT (JSON):
{current_script_json}

MODES:

MODE A — Section-level (user targets 1–2 sections):
- Return exactly 3 numbered alternatives for the targeted section text (with cues).
- After the 3 options, ask exactly 1 specific clarifying question.
- When the user picks/refines, return the final section as a proposal.
- action: "options" for the 3 alternatives turn, "propose" for the final version turn.

MODE B — Script-level (user asks for whole-script change):
- Apply the direction the user described (tone, angle, structure) across all sections.
- Do NOT randomly regenerate — the redesign must reflect exactly what the user asked for.
- action: "redesign"
- End with one open clarifying question.
- If the user says "try again", rewrite the same direction with fresh execution — different phrasing, different evidence examples, different cue placement. Same intent, new draft.

RESPONSE FORMAT — always return ONLY valid JSON, no markdown fences:
{
  "action": "options" | "propose" | "redesign" | "rejected",
  "reply": "<your full response text including numbered options or explanation>",
  "proposed_sections": null | [complete section objects for changed sections only],
  "sections_changed": null | [indices],
  "clarifying_question": "<specific follow-up question, or null if not applicable>"
}

SECTION RULES:
- For a proposal, return COMPLETE section objects. The server merges by index.
- Do NOT return plain_text, word_count, or cue_summary — server computes these.
- Minimum 3 sections must remain if deleting.
- Voice cue tokens (ALL CAPS, square brackets): [SLOW] [FAST] [NORMAL] [EMPHASIZE] [WHISPER] [LOUD] [HIGH] [LOW] [PAUSE] [BEAT] [BREATHE] [EXCITED] [SERIOUS]
- Clarifying questions must be specific to what was just shown — not generic.
```

---

## Backend Implementation Notes

### Token storage (in-memory, local single-user tool)
```python
import secrets, time
_APPLY_TOKENS: dict[str, dict] = {}
TOKEN_TTL_SECONDS = 600

def _store_apply_token(proposed_sections, sections_changed, date_ist) -> str:
    token = "tok_" + secrets.token_hex(8)
    _APPLY_TOKENS[token] = {
        "proposed_sections": proposed_sections,
        "sections_changed": sections_changed,
        "date_ist": date_ist,
        "created_at": time.time(),
    }
    expired = [k for k, v in _APPLY_TOKENS.items()
               if time.time() - v["created_at"] > TOKEN_TTL_SECONDS]
    for k in expired:
        del _APPLY_TOKENS[k]
    return token

def _consume_apply_token(token: str) -> dict | None:
    entry = _APPLY_TOKENS.pop(token, None)
    if entry and time.time() - entry["created_at"] <= TOKEN_TTL_SECONDS:
        return entry
    return None
```

### Merge logic (section-level)
```python
def _merge_sections(base_sections: list, proposed_sections: list) -> list:
    by_index = {s["index"]: s for s in base_sections}
    for proposed in proposed_sections:
        by_index[proposed["index"]] = _enrich_section(proposed)
    return sorted(by_index.values(), key=lambda s: s["index"])
```

### Gemini call (chat endpoint)
- Model: `gemini-2.5-flash`
- Temperature: `1.1` (slightly creative but consistent)
- Use `client.chats.create` + `chat.send_message` (avoids AFC warning)
- System prompt includes `{current_script_json}` — fetch latest script from DB before each call
- History reconstructed from `request.history` list

---

## Frontend Implementation Notes

### New state (added to main App state)
```ts
type ChatMessage = {
  role: "user" | "assistant";
  content: string;                     // display text
  action?: "options" | "propose" | "redesign" | "rejected";
  proposedSections?: ScriptSectionV2[];
  sectionsChanged?: number[];
  applyToken?: string;
  clarifyingQuestion?: string;
};

const [directorOpen, setDirectorOpen] = useState(false);
const [directorTarget, setDirectorTarget] = useState<string | null>(null); // pre-targeted section name
const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
const [chatInput, setChatInput] = useState("");
const [chatThinking, setChatThinking] = useState(false);
```

### Pre-targeting from section tap
In the Today tab script preview, tapping a `SectionPreviewCard` opens Director with:
- `directorTarget` = section name (e.g. "hook")
- First message pre-filled: `"Focus on: Hook — "` (cursor placed after it)

### Scope inference (frontend)
```ts
function inferScope(message: string, target: string | null): "section" | "script" {
  const sectionNames = ["hook", "context", "evidence", "story_turn", "takeaway", "cta"];
  if (target) return "section";
  const lower = message.toLowerCase();
  if (sectionNames.some(n => lower.includes(n))) return "section";
  return "script";
}
```

### New API client functions
```ts
export function chatScript(params: {
  message: string;
  history: { role: string; content: string }[];
  scope: "section" | "script";
}): Promise<ScriptChatResponse> { ... }

export function applyScriptProposal(applyToken: string): Promise<ScriptBundleOut> { ... }
```

### Diff display
- Section-level: before/after card using `InlineCuedText` for new text, struck-through plain text for old
- Script-level redesign: collapsible list of all 6 section diff cards; default collapsed to summary "6 sections redesigned — tap to expand"

---

## My Suggestions (worth considering)

### S1 — "Pick and mix" reply
After seeing 3 options the user can say "combine 1 and 3" or "use the opening of 2 but the ending of 1". Gemini handles this naturally since the options are in the conversation history. No extra plumbing needed — just mention it in the clarifying question placeholder.

### S2 — Pre-target via section tap (already in spec above)
Tapping a section card in the script preview opens Director with that section pre-targeted. Feels like right-clicking a paragraph and choosing "Edit with AI". Low implementation cost (one extra state variable).

### S3 — Undo window after Apply
After applying, show an **Undo** button for 30 seconds that re-saves the previous version as a new version (no destructive delete). Saves the user from going back to Tasks and regenerating if they immediately regret a change.

### S4 — Session recap on close
When the user closes Director after having applied something, show a one-line toast: "Saved as v10 — 2 sections changed (Hook, Evidence)". Confirms the work is done.

---

## Guardrail Examples

| User input | Mode | Action | Response |
|------------|------|--------|----------|
| "Make the hook more alarming" | A | `options` | 3 hook alternatives + clarifying Q |
| "Go with option 2" | A | `propose` | Final hook + Apply button |
| "Combine 1 and 3" | A | `propose` | Merged version + Apply button |
| "Rewrite the whole script — opportunity angle" | B | `redesign` | Full 6-section redesign |
| "Try again" | B | `redesign` | Different angle, different language |
| "Add RBI freight data to evidence" | A | `options` | 3 evidence rewrites with data |
| "Delete the CTA section" | A | `propose` | 5-section script + Apply |
| "What's the capital of France?" | — | `rejected` | Redirect message |
| "Write me a cover letter" | — | `rejected` | Redirect message |
| "The tone feels too academic" | A | `options` | 3 casual rewrites of the heaviest section |

---

## Acceptance Criteria

- [ ] "Script Director" button visible in **Tasks** tab
- [ ] Tapping a section in Today tab opens Director with that section pre-targeted
- [ ] Opening Director shows "I have your v9 script…" with correct version
- [ ] Section-level prompt → exactly 3 numbered alternatives shown + clarifying question
- [ ] Script-level prompt → full redesign shown with Apply + Try again
- [ ] "Try again" on redesign → new full redesign with different language
- [ ] User picks option → final version shown → Apply button active
- [ ] Apply → version saved → "Saved as v10" banner → "Open Teleprompter →" shortcut
- [ ] Closing modal clears conversation (next open starts fresh)
- [ ] Expired/unknown apply token → 400 from backend
- [ ] Off-topic message → `rejected` → redirect shown, no proposal

---

## File Checklist

| File | Change |
|------|--------|
| `backend/app/daily.py` | Add `_store_apply_token`, `_consume_apply_token`, `_merge_sections`, `chat_script`, `apply_script_proposal` |
| `backend/app/main.py` | Add `POST /api/daily/script/chat`, `POST /api/daily/script/apply` |
| `backend/app/schemas.py` | Add `ScriptChatRequest`, `ScriptChatResponse`, `ScriptApplyRequest` |
| `frontend_rn/App.tsx` | Add `ScriptDirectorModal`, `directorOpen/Target/chatHistory` state, handlers |
| `frontend_rn/src/api/client.ts` | Add `chatScript`, `applyScriptProposal` |
| `frontend_rn/src/types.ts` | Add `ChatMessage`, `ScriptChatResponse` |

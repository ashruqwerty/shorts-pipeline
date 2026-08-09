from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, computed_field, field_validator


# ---------------------------------------------------------------------------
# Voice cue taxonomy (F001)
# ---------------------------------------------------------------------------

class VoiceCue(str, Enum):
    SLOW      = "SLOW"
    FAST      = "FAST"
    NORMAL    = "NORMAL"
    EMPHASIZE = "EMPHASIZE"
    WHISPER   = "WHISPER"
    LOUD      = "LOUD"
    HIGH      = "HIGH"
    LOW       = "LOW"
    PAUSE     = "PAUSE"
    BEAT      = "BEAT"
    BREATHE   = "BREATHE"
    EXCITED   = "EXCITED"
    SERIOUS   = "SERIOUS"


CUE_COLORS: dict[str, str] = {
    "SLOW":      "#60A5FA",
    "FAST":      "#F97316",
    "NORMAL":    "#9CA3AF",
    "EMPHASIZE": "#FBBF24",
    "WHISPER":   "#C4B5FD",
    "LOUD":      "#F87171",
    "HIGH":      "#34D399",
    "LOW":       "#6366F1",
    "PAUSE":     "#9CA3AF",
    "BEAT":      "#4B5563",
    "BREATHE":   "#86EFAC",
    "EXCITED":   "#FB923C",
    "SERIOUS":   "#374151",
}

SectionName = Literal[
    "hook", "context", "evidence", "story_turn", "takeaway", "cta"
]

ShotType = Literal["a_roll", "b_roll"]


# ---------------------------------------------------------------------------
# Script v2 section (F001)
# ---------------------------------------------------------------------------

class SectionTiming(BaseModel):
    start_s: int
    end_s: int


class ScriptSectionV2(BaseModel):
    index: int                          # 0–5, canonical FFmpeg ordering key
    name: SectionName
    label: str
    timing: SectionTiming
    shot_type: ShotType
    word_count: int
    text: str                           # narration with inline [CUE] tokens
    plain_text: str                     # narration with [CUE] tokens stripped
    cue_summary: list[str]              # deduplicated cues found in text
    on_screen_text: str
    transition_after: str
    b_roll_slot: bool
    b_roll_prompt: str
    proof_overlay: str


# ---------------------------------------------------------------------------
# Script v2 root (F001)
# ---------------------------------------------------------------------------

class ScriptV2(BaseModel):
    schema_version: Literal[2] = 2
    topic: str
    video_title: str
    tone: str
    duration_sec: int
    total_word_count: int
    cta: str
    disclaimer: str
    sections: list[ScriptSectionV2]


# ---------------------------------------------------------------------------
# API response models
# ---------------------------------------------------------------------------

class AssetOut(BaseModel):
    id: str
    original_name: str
    stored_name: str
    kind: str
    topic: str | None
    recording_date: str | None
    section_index: int | None
    size_bytes: int
    created_at: datetime
    download_url: str
    preview_url: str


class StorageSummary(BaseModel):
    total_files: int
    total_size_bytes: int
    by_kind: dict[str, dict[str, int]]


class DailyStatusUpdate(BaseModel):
    status: str


class DailyAssignOut(BaseModel):
    date_ist: str
    status: str
    topic: dict[str, str]
    overview: dict[str, object]
    script_version: int


class ScriptBundleOut(BaseModel):
    date_ist: str
    version: int
    created_at: str
    script: ScriptV2


class TeleprompterOut(BaseModel):
    date_ist: str
    version: int
    sections: list[ScriptSectionV2]


class PipelineTriggerOut(BaseModel):
    date_ist: str
    clip_count: int
    status: str
    output_path: str | None
    message: str

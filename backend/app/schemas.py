from datetime import datetime
from pydantic import BaseModel


class AssetOut(BaseModel):
    id: str
    original_name: str
    stored_name: str
    kind: str
    topic: str | None
    recording_date: str | None
    section_index: int | None = None
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


class ScriptBundleOut(BaseModel):
    date_ist: str
    version: int
    created_at: str
    script: dict[str, object]


class TeleprompterOut(BaseModel):
    date_ist: str
    version: int
    sections: list[dict[str, object]]


class PipelineTriggerOut(BaseModel):
    date_ist: str
    status: str
    progress: str
    output_path: str | None = None


class PipelineStatusOut(BaseModel):
    date_ist: str
    status: str | None
    progress: str
    output_path: str | None = None
    step: str | None = None
    logs: list[str] = []
    ffmpeg_pct: float | None = None


class ScriptChatMessage(BaseModel):
    role: str
    content: str


class ScriptChatRequest(BaseModel):
    message: str
    history: list[ScriptChatMessage] = []
    scope: str = "section"


class ScriptChatResponse(BaseModel):
    action: str
    reply: str
    proposed_sections: list[dict[str, object]] | None = None
    apply_token: str | None = None
    sections_changed: list[int] | None = None
    clarifying_question: str | None = None


class ScriptApplyRequest(BaseModel):
    apply_token: str


class ScriptRevertRequest(BaseModel):
    date_ist: str
    to_version: int


# ── Series Creator ────────────────────────────────────────────────────────────

class SeriesItemOut(BaseModel):
    day_offset: int
    sub_topic: str
    category: str
    topic_angle: str
    hook_idea: str
    plan_notes: str | None = None
    script_draft: str | None = None


class SeriesDraftOut(BaseModel):
    id: str
    name: str
    day_count: int
    status: str
    items: list[SeriesItemOut]
    created_at: str


class SeriesGenerateRequest(BaseModel):
    theme: str
    day_count: int = 10


class SeriesChatMessage(BaseModel):
    role: str
    content: str


class SeriesChatRequest(BaseModel):
    series_id: str
    message: str
    history: list[SeriesChatMessage] = []


class SeriesChatResponse(BaseModel):
    action: str
    reply: str
    episodes: list[SeriesItemOut] | None = None
    episodes_changed: list[int] | None = None
    clarifying_question: str | None = None


class SeriesActivateRequest(BaseModel):
    series_id: str


class EpisodePlanRequest(BaseModel):
    series_id: str
    day_offset: int
    message: str = ""
    history: list[SeriesChatMessage] = []


class EpisodePlanResponse(BaseModel):
    action: str
    reply: str
    key_points: list[str] | None = None
    updated_angle: str | None = None
    updated_hook: str | None = None
    plan: dict[str, object] | None = None


class EpisodeSavePlanRequest(BaseModel):
    series_id: str
    day_offset: int
    plan: dict[str, object]


class EpisodeGenerateScriptRequest(BaseModel):
    series_id: str
    day_offset: int


class EpisodeScriptOut(BaseModel):
    series_id: str
    day_offset: int
    script: dict[str, object]


class DailyAssignOut(BaseModel):
    date_ist: str
    status: str
    topic: dict[str, str]
    overview: dict[str, object]
    script_version: int
    series_context: dict[str, object] | None = None


# ── B-Roll Test ───────────────────────────────────────────────────────────────

class BRollTestSectionOut(BaseModel):
    section_index: int
    section_name: str
    prompt: str
    duration_s: float
    success: bool
    file_name: str | None = None
    error: str | None = None


class BRollTestStatusOut(BaseModel):
    status: str | None
    date_ist: str | None = None
    results: list[BRollTestSectionOut] = []
    logs: list[str] = []

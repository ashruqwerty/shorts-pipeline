from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path

from .config import UPLOADABLE_ASSET_KINDS, ensure_storage_tree
from .daily import (
    activate_series,
    apply_script_proposal,
    assign_today_if_missing,
    chat_script,
    chat_series,
    generate_series,
    generate_today_script,
    get_active_series,
    get_broll_test_status,
    preview_veo_prompt,
    preview_all_veo_prompts,
    get_pipeline_status,
    get_teleprompter_data,
    get_today_card,
    init_daily_db,
    list_topics,
    plan_series_episode,
    reassign_today_topic,
    revert_script_version,
    generate_episode_script,
    save_episode_plan,
    start_broll_test,
    trigger_pipeline,
    update_today_status,
)
from .schemas import (
    AssetOut,
    BRollTestStatusOut,
    DailyAssignOut,
    DailyStatusUpdate,
    EpisodePlanRequest,
    EpisodePlanResponse,
    EpisodeGenerateScriptRequest,
    EpisodeSavePlanRequest,
    EpisodeScriptOut,
    PipelineStatusOut,
    PipelineTriggerOut,
    ScriptApplyRequest,
    ScriptBundleOut,
    ScriptChatRequest,
    ScriptChatResponse,
    ScriptRevertRequest,
    SeriesActivateRequest,
    SeriesChatRequest,
    SeriesChatResponse,
    SeriesDraftOut,
    SeriesGenerateRequest,
    StorageSummary,
    TeleprompterOut,
)
from .storage import delete_asset, get_asset, init_db, list_assets, save_upload, summary

app = FastAPI(title="Shorts Pipeline API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:8082",
        "http://127.0.0.1:8082",
        "http://localhost:19006",
        "http://127.0.0.1:19006",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event() -> None:
    ensure_storage_tree()
    init_db()
    init_daily_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/asset-kinds")
def asset_kinds() -> dict[str, list[str]]:
    return {"kinds": UPLOADABLE_ASSET_KINDS}


@app.get("/api/daily/today", response_model=DailyAssignOut)
def daily_today() -> DailyAssignOut:
    payload = get_today_card()
    return DailyAssignOut(**payload)


@app.post("/api/daily/assign", response_model=DailyAssignOut)
def daily_assign() -> DailyAssignOut:
    assign_today_if_missing()
    payload = get_today_card()
    return DailyAssignOut(**payload)


@app.post("/api/daily/script/generate", response_model=ScriptBundleOut)
def daily_generate_script() -> ScriptBundleOut:
    bundle = generate_today_script(force_regenerate=False)
    return ScriptBundleOut(**bundle)


@app.post("/api/daily/script/regenerate", response_model=ScriptBundleOut)
def daily_regenerate_script() -> ScriptBundleOut:
    bundle = generate_today_script(force_regenerate=True)
    return ScriptBundleOut(**bundle)


@app.post("/api/daily/session/status")
def daily_status_update(payload: DailyStatusUpdate) -> dict[str, str]:
    try:
        out = update_today_status(payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "date_ist": out["date_ist"],
        "status": out["status"],
        "updated_at": out["updated_at"],
    }


@app.get("/api/daily/teleprompter", response_model=TeleprompterOut)
def daily_teleprompter() -> TeleprompterOut:
    payload = get_teleprompter_data()
    return TeleprompterOut(**payload)


@app.post("/api/pipeline/trigger", response_model=PipelineTriggerOut)
def pipeline_trigger() -> PipelineTriggerOut:
    today = get_today_card()
    try:
        job = trigger_pipeline(today["date_ist"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return PipelineTriggerOut(
        date_ist=today["date_ist"],
        status=job["status"],
        progress=job["progress"],
        output_path=job.get("output_path"),
    )


@app.get("/api/pipeline/status", response_model=PipelineStatusOut)
def pipeline_status() -> PipelineStatusOut:
    today = get_today_card()
    result = get_pipeline_status(today["date_ist"])
    return PipelineStatusOut(**result)


@app.get("/api/pipeline/output/download")
def pipeline_output_download() -> FileResponse:
    today = get_today_card()
    result = get_pipeline_status(today["date_ist"])
    output_path = result.get("output_path")
    if not output_path:
        raise HTTPException(status_code=404, detail="No pipeline output available yet.")
    from pathlib import Path as _Path
    if not _Path(output_path).exists():
        raise HTTPException(status_code=404, detail="Output file not found on disk.")
    filename = f"{today['date_ist']}_final_edit.mp4"
    return FileResponse(path=output_path, filename=filename, media_type="video/mp4")


@app.get("/api/storage/summary", response_model=StorageSummary)
def storage_summary() -> StorageSummary:
    return StorageSummary(**summary())


@app.get("/api/assets", response_model=list[AssetOut])
def get_assets(kind: str | None = None) -> list[AssetOut]:
    rows = list_assets(kind)
    assets = []
    for row in rows:
        assets.append(
            AssetOut(
                id=row["id"],
                original_name=row["original_name"],
                stored_name=row["stored_name"],
                kind=row["kind"],
                topic=row["topic"],
                recording_date=row["recording_date"],
                section_index=row.get("section_index"),
                size_bytes=row["size_bytes"],
                created_at=row["created_at"],
                download_url=f"/api/assets/{row['id']}/download",
                preview_url=f"/api/assets/{row['id']}/file",
            )
        )
    return assets


@app.post("/api/assets/upload", response_model=AssetOut)
async def upload_asset(
    file: UploadFile = File(...),
    kind: str = Form(...),
    topic: str | None = Form(default=None),
    recording_date: str | None = Form(default=None),
    section_index: int | None = Form(default=None),
) -> AssetOut:
    try:
        row = await save_upload(file, kind, topic, recording_date, section_index)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AssetOut(
        id=row["id"],
        original_name=row["original_name"],
        stored_name=row["stored_name"],
        kind=row["kind"],
        topic=row["topic"],
        recording_date=row["recording_date"],
        section_index=row.get("section_index"),
        size_bytes=row["size_bytes"],
        created_at=row["created_at"],
        download_url=f"/api/assets/{row['id']}/download",
        preview_url=f"/api/assets/{row['id']}/file",
    )


@app.get("/api/assets/{asset_id}/download")
def download_asset(asset_id: str) -> FileResponse:
    row = get_asset(asset_id)
    if not row:
        raise HTTPException(status_code=404, detail="Asset not found")

    file_path = Path(row["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")

    return FileResponse(path=file_path, filename=row["original_name"])


@app.get("/api/assets/{asset_id}/file")
def get_asset_file(asset_id: str) -> FileResponse:
    row = get_asset(asset_id)
    if not row:
        raise HTTPException(status_code=404, detail="Asset not found")

    file_path = Path(row["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")

    return FileResponse(path=file_path)


@app.delete("/api/assets/{asset_id}")
def remove_asset(asset_id: str) -> dict[str, str]:
    if not delete_asset(asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"status": "deleted"}


@app.post("/api/daily/script/chat", response_model=ScriptChatResponse)
def daily_script_chat(payload: ScriptChatRequest) -> ScriptChatResponse:
    result = chat_script(
        message=payload.message,
        history=[{"role": m.role, "content": m.content} for m in payload.history],
        scope=payload.scope,
    )
    return ScriptChatResponse(**result)


@app.post("/api/daily/script/apply", response_model=ScriptBundleOut)
def daily_script_apply(payload: ScriptApplyRequest) -> ScriptBundleOut:
    try:
        bundle = apply_script_proposal(payload.apply_token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ScriptBundleOut(**bundle)


@app.post("/api/daily/script/revert", response_model=ScriptBundleOut)
def daily_script_revert(payload: ScriptRevertRequest) -> ScriptBundleOut:
    try:
        bundle = revert_script_version(payload.date_ist, payload.to_version)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ScriptBundleOut(**bundle)


# ── Series Creator ────────────────────────────────────────────────────────────

@app.post("/api/series/generate", response_model=SeriesDraftOut)
def series_generate(payload: SeriesGenerateRequest) -> SeriesDraftOut:
    try:
        series = generate_series(payload.theme, payload.day_count)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SeriesDraftOut(**series)


@app.post("/api/series/chat", response_model=SeriesChatResponse)
def series_chat(payload: SeriesChatRequest) -> SeriesChatResponse:
    result = chat_series(
        series_id=payload.series_id,
        message=payload.message,
        history=[{"role": m.role, "content": m.content} for m in payload.history],
    )
    return SeriesChatResponse(**result)


@app.post("/api/series/activate", response_model=SeriesDraftOut)
def series_activate(payload: SeriesActivateRequest) -> SeriesDraftOut:
    try:
        series = activate_series(payload.series_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SeriesDraftOut(**series)


@app.get("/api/series/active", response_model=SeriesDraftOut | None)
def series_active() -> SeriesDraftOut | None:
    series = get_active_series()
    if not series:
        return None
    return SeriesDraftOut(**series)


@app.post("/api/series/episode/plan", response_model=EpisodePlanResponse)
def series_episode_plan(payload: EpisodePlanRequest) -> EpisodePlanResponse:
    result = plan_series_episode(
        series_id=payload.series_id,
        day_offset=payload.day_offset,
        message=payload.message,
        history=[{"role": m.role, "content": m.content} for m in payload.history],
    )
    return EpisodePlanResponse(**result)


@app.post("/api/series/episode/save-plan", response_model=SeriesDraftOut)
def series_episode_save_plan(payload: EpisodeSavePlanRequest) -> SeriesDraftOut:
    try:
        updated = save_episode_plan(
            series_id=payload.series_id,
            day_offset=payload.day_offset,
            plan=dict(payload.plan),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return SeriesDraftOut(**updated)


@app.post("/api/series/episode/generate-script", response_model=EpisodeScriptOut)
def series_episode_generate_script(payload: EpisodeGenerateScriptRequest) -> EpisodeScriptOut:
    try:
        result = generate_episode_script(series_id=payload.series_id, day_offset=payload.day_offset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return EpisodeScriptOut(**result)


# ── B-Roll Test ───────────────────────────────────────────────────────────────

@app.post("/api/broll/test/start", response_model=BRollTestStatusOut)
def broll_test_start() -> BRollTestStatusOut:
    today = get_today_card()
    job = start_broll_test(today["date_ist"])
    return BRollTestStatusOut(
        status=job.get("status"),
        date_ist=job.get("date_ist"),
        results=[],
        logs=job.get("logs", []),
    )


@app.get("/api/broll/test/status", response_model=BRollTestStatusOut)
def broll_test_status() -> BRollTestStatusOut:
    job = get_broll_test_status()
    results = [
        {
            "section_index": r["section_index"],
            "section_name": r["section_name"],
            "prompt": r["prompt"],
            "duration_s": r["duration_s"],
            "success": r["success"],
            "file_name": r.get("file_name"),
            "error": r.get("error"),
        }
        for r in job.get("results", [])
    ]
    return BRollTestStatusOut(
        status=job.get("status"),
        date_ist=job.get("date_ist"),
        results=results,
        logs=job.get("logs", []),
    )


@app.get("/api/broll/preview-all-prompts")
def broll_preview_all_prompts() -> dict:
    today = get_today_card()
    result = preview_all_veo_prompts(today["date_ist"])
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.post("/api/broll/preview-prompt")
def broll_preview_prompt(body: dict) -> dict:
    today = get_today_card()
    section_index = body.get("section_index")
    if section_index is None:
        raise HTTPException(status_code=400, detail="section_index required")
    result = preview_veo_prompt(today["date_ist"], int(section_index))
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ── Topic Management ──────────────────────────────────────────────────────────

@app.get("/api/daily/topics")
def daily_topics() -> list[dict]:
    return list_topics()


@app.post("/api/daily/reassign")
def daily_reassign(body: dict) -> dict:
    topic_id = body.get("topic_id")
    if not topic_id:
        raise HTTPException(status_code=400, detail="topic_id required")
    try:
        assignment = reassign_today_topic(topic_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {
        "date_ist": assignment["date_ist"],
        "topic_id": assignment["topic_id"],
        "category": assignment["category"],
        "topic_angle": assignment["topic_angle"],
        "hook_idea": assignment.get("hook_idea") or "",
    }

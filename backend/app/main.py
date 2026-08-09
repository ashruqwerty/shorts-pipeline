from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import UPLOADABLE_ASSET_KINDS, ensure_storage_tree
from .daily import (
    assign_today_if_missing,
    generate_today_script,
    get_teleprompter_data,
    get_today_card,
    init_daily_db,
    update_today_status,
)
from .pipeline import assemble_clips, get_today_a_roll_clips
from .schemas import (
    AssetOut,
    DailyAssignOut,
    DailyStatusUpdate,
    PipelineTriggerOut,
    ScriptBundleOut,
    StorageSummary,
    TeleprompterOut,
)
from .storage import delete_asset, get_asset, init_db, list_assets, save_upload, summary

app = FastAPI(title="Shorts Pipeline Local Storage API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:19006",
        "http://127.0.0.1:19006",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@app.on_event("startup")
def startup_event() -> None:
    ensure_storage_tree()
    init_db()
    init_daily_db()


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail="Frontend not found")


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


@app.post("/api/daily/pipeline/trigger", response_model=PipelineTriggerOut)
def daily_pipeline_trigger() -> PipelineTriggerOut:
    from .daily import assign_today_if_missing
    assignment = assign_today_if_missing()
    date_ist = assignment["date_ist"]
    clips = get_today_a_roll_clips(date_ist)
    result = assemble_clips(clips, date_ist)
    return PipelineTriggerOut(
        date_ist=date_ist,
        clip_count=result["clip_count"],
        status=result["status"],
        output_path=result.get("output_path"),
        message=result["message"],
    )


@app.get("/api/daily/teleprompter", response_model=TeleprompterOut)
def daily_teleprompter() -> TeleprompterOut:
    payload = get_teleprompter_data()
    return TeleprompterOut(**payload)


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

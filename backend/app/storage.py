import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import UploadFile

from .config import ASSET_DIRS, DB_PATH, UPLOADABLE_ASSET_KINDS, ensure_storage_tree


def _get_conn() -> sqlite3.Connection:
    ensure_storage_tree()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                kind TEXT NOT NULL,
                topic TEXT,
                recording_date TEXT,
                section_index INTEGER,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                file_path TEXT NOT NULL
            )
            """
        )
        # Idempotent migration: add section_index to tables created before F001
        existing_cols = {
            row[1]
            for row in conn.execute("PRAGMA table_info(assets)").fetchall()
        }
        if "section_index" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN section_index INTEGER")


def _safe_suffix(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if len(suffix) > 10:
        return ""
    return suffix


async def save_upload(
    file: UploadFile,
    kind: str,
    topic: str | None,
    recording_date: str | None,
    section_index: int | None = None,
) -> dict[str, Any]:
    if kind not in UPLOADABLE_ASSET_KINDS:
        raise ValueError(f"Unsupported asset kind: {kind}")

    asset_id = str(uuid.uuid4())
    suffix = _safe_suffix(file.filename or "")
    stored_name = f"{asset_id}{suffix}"
    destination = ASSET_DIRS[kind] / stored_name

    content = await file.read()
    destination.write_bytes(content)
    size_bytes = destination.stat().st_size
    created_at = datetime.now(timezone.utc).isoformat()

    row = {
        "id": asset_id,
        "original_name": file.filename or "unnamed",
        "stored_name": stored_name,
        "kind": kind,
        "topic": topic,
        "recording_date": recording_date,
        "section_index": section_index,
        "size_bytes": size_bytes,
        "created_at": created_at,
        "file_path": str(destination),
    }

    with _get_conn() as conn:
        conn.execute(
            """
            INSERT INTO assets (
                id, original_name, stored_name, kind, topic,
                recording_date, section_index, size_bytes, created_at, file_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["original_name"],
                row["stored_name"],
                row["kind"],
                row["topic"],
                row["recording_date"],
                row["section_index"],
                row["size_bytes"],
                row["created_at"],
                row["file_path"],
            ),
        )

    return row


def list_assets(kind: str | None = None) -> list[dict[str, Any]]:
    query = "SELECT * FROM assets"
    params: tuple[Any, ...] = ()
    if kind:
        query += " WHERE kind = ?"
        params = (kind,)
    query += " ORDER BY created_at DESC"

    with _get_conn() as conn:
        rows = conn.execute(query, params).fetchall()

    return [dict(row) for row in rows]


def get_asset(asset_id: str) -> dict[str, Any] | None:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    return dict(row) if row else None


def delete_asset(asset_id: str) -> bool:
    row = get_asset(asset_id)
    if not row:
        return False

    file_path = Path(row["file_path"])
    if file_path.exists():
        file_path.unlink()

    with _get_conn() as conn:
        conn.execute("DELETE FROM assets WHERE id = ?", (asset_id,))

    return True


def summary() -> dict[str, Any]:
    with _get_conn() as conn:
        total_files = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]
        total_size = conn.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM assets").fetchone()[0]
        rows = conn.execute(
            "SELECT kind, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS size FROM assets GROUP BY kind"
        ).fetchall()

    by_kind: dict[str, dict[str, int]] = {}
    for row in rows:
        by_kind[row["kind"]] = {"count": row["count"], "size_bytes": row["size"]}

    return {
        "total_files": total_files,
        "total_size_bytes": total_size,
        "by_kind": by_kind,
    }

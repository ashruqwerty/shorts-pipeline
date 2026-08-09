import sqlite3
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .config import ASSET_DIRS, DB_PATH, ensure_storage_tree


def _get_conn() -> sqlite3.Connection:
    ensure_storage_tree()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_today_a_roll_clips(date_ist: str) -> list[dict[str, Any]]:
    """Return today's a_roll assets ordered by section_index ASC."""
    with _get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, file_path, section_index, original_name, created_at
            FROM assets
            WHERE kind = 'a_roll' AND (recording_date = ? OR recording_date IS NULL)
            ORDER BY COALESCE(section_index, 999) ASC, created_at ASC
            """,
            (date_ist,),
        ).fetchall()
    return [dict(row) for row in rows]


def assemble_clips(clips: list[dict[str, Any]], date_ist: str) -> dict[str, Any]:
    """
    Concatenate clips into a single mp4 using FFmpeg concat demuxer.
    Returns a result dict with status, output_path, clip_count, message.
    """
    if not clips:
        return {"status": "error", "message": "No clips provided", "clip_count": 0}

    ensure_storage_tree()
    output_dir = ASSET_DIRS["render_final"]
    output_path = output_dir / f"{date_ist}_assembled.mp4"

    # Write temp filelist
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        filelist_path = Path(f.name)
        for clip in clips:
            abs_path = Path(clip["file_path"]).resolve()
            # FFmpeg concat filelist uses forward slashes even on Windows
            f.write(f"file '{abs_path.as_posix()}'\n")

    cmd = [
        "ffmpeg",
        "-f", "concat",
        "-safe", "0",
        "-i", str(filelist_path),
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "medium",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-y",
        str(output_path),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        filelist_path.unlink(missing_ok=True)

        if result.returncode == 0:
            return {
                "status": "ok",
                "output_path": str(output_path),
                "clip_count": len(clips),
                "message": f"Assembled {len(clips)} clips → {output_path.name}",
            }
        else:
            stderr_tail = result.stderr[-600:] if result.stderr else "no stderr"
            return {
                "status": "error",
                "output_path": None,
                "clip_count": len(clips),
                "message": f"FFmpeg exited {result.returncode}: {stderr_tail}",
            }

    except FileNotFoundError:
        filelist_path.unlink(missing_ok=True)
        return {
            "status": "ffmpeg_missing",
            "output_path": None,
            "clip_count": len(clips),
            "message": "ffmpeg not found in PATH — install FFmpeg and ensure it is on PATH",
        }
    except subprocess.TimeoutExpired:
        filelist_path.unlink(missing_ok=True)
        return {
            "status": "error",
            "output_path": None,
            "clip_count": len(clips),
            "message": "FFmpeg timed out after 300s",
        }

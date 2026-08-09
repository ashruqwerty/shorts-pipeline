from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
BASE_DIR = Path(__file__).resolve().parents[2]

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass
LOCAL_STORAGE_DIR = BASE_DIR / "local_storage"
DB_PATH = LOCAL_STORAGE_DIR / "pipeline.db"
TOPIC_QUEUE_PATH = BASE_DIR / "TOPIC_QUEUE_30_DAYS.csv"

# Standardized local directories for media assets.
ASSET_DIRS = {
    "a_roll": LOCAL_STORAGE_DIR / "assets" / "a_roll",
    "b_roll_custom": LOCAL_STORAGE_DIR / "assets" / "b_roll_custom",
    "b_roll_ai": LOCAL_STORAGE_DIR / "assets" / "b_roll_ai",
    "captions": LOCAL_STORAGE_DIR / "assets" / "captions",
    "render_preview": LOCAL_STORAGE_DIR / "assets" / "render_preview",
    "render_final": LOCAL_STORAGE_DIR / "assets" / "render_final",
}

# Restrict manual uploads to user-supplied media only.
UPLOADABLE_ASSET_KINDS = ["a_roll", "b_roll_custom"]


def ensure_storage_tree() -> None:
    LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    for directory in ASSET_DIRS.values():
        directory.mkdir(parents=True, exist_ok=True)

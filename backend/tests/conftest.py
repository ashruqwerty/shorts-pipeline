"""
Shared test setup. Critically: this sets SHORTS_PIPELINE_STORAGE_DIR to an
isolated temp directory BEFORE any `app.*` module is imported, so every test
run gets its own throwaway SQLite DB + asset folders instead of touching the
real local_storage/ the running app actually uses. Never import app.config
or app.daily above this block in any test file.
"""
import os
import tempfile
import pytest

_TEST_STORAGE_DIR = tempfile.mkdtemp(prefix="shorts_pipeline_test_storage_")
os.environ["SHORTS_PIPELINE_STORAGE_DIR"] = _TEST_STORAGE_DIR

from app.config import ensure_storage_tree  # noqa: E402
from app.storage import init_db  # noqa: E402
from app.daily import init_daily_db  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _init_test_db():
    """Runs once per test session — sets up the isolated DB schema."""
    ensure_storage_tree()
    init_db()
    init_daily_db()
    yield


@pytest.fixture
def has_gemini_key() -> bool:
    return bool(os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))

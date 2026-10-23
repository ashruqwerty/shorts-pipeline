"""
Fast, free smoke tests — no Gemini calls, no network, no cost. These exist to
catch the "forgot to wire up an import" / "endpoint doesn't even start up"
class of bug instantly, every time, as opposed to the Gemini reliability tests
which are slower and cost real API calls. Run these constantly; run the
reliability suite before shipping a change that touches an AI-generation path.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_asset_kinds():
    resp = client.get("/api/asset-kinds")
    assert resp.status_code == 200
    assert "a_roll" in resp.json()["kinds"]


def test_daily_today():
    resp = client.get("/api/daily/today")
    assert resp.status_code == 200
    body = resp.json()
    assert "date_ist" in body
    assert "topic" in body


def test_daily_topics():
    resp = client.get("/api/daily/topics")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_storage_summary():
    resp = client.get("/api/storage/summary")
    assert resp.status_code == 200
    assert "total_files" in resp.json()


def test_pipeline_status_no_run_yet():
    # Should respond cleanly even with no pipeline ever triggered — not 500.
    resp = client.get("/api/pipeline/status")
    assert resp.status_code == 200


def test_active_series_none():
    resp = client.get("/api/series/active")
    assert resp.status_code == 200  # null is a valid response, not an error


def test_broll_test_status():
    resp = client.get("/api/broll/test/status")
    assert resp.status_code == 200

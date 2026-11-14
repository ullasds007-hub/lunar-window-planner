from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.routers.lunar import create_lunar_app
from app.services import lunar


def test_invalid_coordinates():
    response = TestClient(create_lunar_app()).get("/surface-windows", params={
        "start": "2026-11-14T00:00:00Z", "end": "2026-11-15T00:00:00Z",
        "lat": 91, "lon": 0,
    })
    assert response.status_code == 422


def test_missing_data(monkeypatch, tmp_path):
    monkeypatch.setattr(lunar, "DATA_FILES", (tmp_path / "missing.bsp",))
    lunar.model.cache_clear()
    response = TestClient(create_lunar_app()).get("/surface-windows", params={
        "start": "2026-11-14T00:00:00Z", "end": "2026-11-15T00:00:00Z",
        "lat": -84.7906, "lon": 29.1957,
    })
    assert response.status_code == 503


def test_athena_horizons_elevations():
    # Reproduction parameters are in lunar-surface/lunar-surface-live/VALIDATION.md.
    if not all(path.is_file() for path in lunar.DATA_FILES):
        pytest.skip("Run python prepare_combined.py to enable the Horizons regression")
    start = datetime(2026, 11, 14, tzinfo=timezone.utc)
    result = lunar.calculate_windows(start, start + timedelta(hours=1),
                                     -84.7906, 29.1957, profile=True)
    timestamp, sun, earth = result["profile"][0]
    assert datetime.fromisoformat(timestamp) == start
    assert sun == pytest.approx(0.878281, abs=0.005)
    assert earth == pytest.approx(-0.153879, abs=0.005)

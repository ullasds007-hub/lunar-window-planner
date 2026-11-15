import os
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
        message = "Run python prepare_combined.py to enable the Horizons regression"
        if os.getenv("LUNAR_REQUIRE_DATA") == "1":
            pytest.fail(message)
        pytest.skip(message)
    start = datetime(2026, 11, 14, tzinfo=timezone.utc)
    result = lunar.calculate_windows(start, start + timedelta(hours=1),
                                     -84.7906, 29.1957, profile=True)
    timestamp, sun, earth = result["profile"][0]
    assert datetime.fromisoformat(timestamp) == start
    assert sun == pytest.approx(0.878281, abs=0.005)
    assert earth == pytest.approx(-0.153879, abs=0.005)


@pytest.mark.parametrize(("start", "end"), [
    ("2026-11-14T00:00:00", "2026-11-15T00:00:00Z"),
    ("2026-11-15T00:00:00Z", "2026-11-14T00:00:00Z"),
    ("2026-11-14T00:00:00Z", "2027-03-15T00:00:00Z"),
])
def test_invalid_dates(start, end):
    response = TestClient(create_lunar_app()).get("/surface-windows", params={
        "start": start, "end": end, "lat": 0, "lon": 0,
    })
    assert response.status_code == 400


def test_combined_comparison_route_and_assets():
    from app.main import create_app

    client = TestClient(create_app())
    assets = "/lunar-surface/assets/"
    for path, script in (
        ("/", None),
        ("/earth", "earth.js"),
        ("/lunar-surface/", "site.js"),
        ("/lunar-surface/compare?example=athena", "compare.js"),
    ):
        response = client.get(path)
        assert response.status_code == 200
        assert f'href="{assets}atlas.css?' in response.text
        assert 'id="theme-toggle"' not in response.text
        assert f'{assets}theme.js' not in response.text
        if script:
            assert f'src="{assets}{script}' in response.text

    for filename in ("atlas.css", "compare.js", "site.js", "earth.js"):
        asset = client.get(assets + filename)
        assert asset.status_code == 200 and asset.content

    earth = client.get("/windows", params={
        "locationId": "not-a-site", "startDate": "2026-11-14",
        "endDate": "2026-11-14", "goal": "moon_viewing",
    })
    assert earth.json()["error"]["code"] == "UNKNOWN_LOCATION"

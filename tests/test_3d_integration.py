"""Route-level regression tests for the optional 3D viewer."""
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.lunar import DATA_FILES

client = TestClient(app)


@pytest.mark.parametrize("page", ["/", "/lunar-surface/compare", "/lunar-surface/", "/earth"])
def test_viewer_launcher(page):
    response = client.get(page)
    assert response.status_code == 200
    assert "assets/sim-launch.js" in response.text


def test_viewer_assets_and_public_config(monkeypatch, tmp_path):
    from simulation3d.sim_api import main as viewer
    monkeypatch.setattr(viewer, "OUT", tmp_path)
    monkeypatch.setenv("LWP_LROC_DOWNLOAD", "1")
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-value-must-not-be-returned")
    assert client.get("/sim/geo/config").json() == {"provider": "osm"}
    assert client.get("/sim/app/").status_code == 200
    assert client.get("/sim/app/js/main.js").status_code == 200
    assert client.get("/sim/assets/moon-meta.json").status_code == 404
    assert client.get("/sim/assets/polar/south/meta.json").status_code == 404
    assert client.get("/sim/assets/site/terrain.json", params={"site": "site04"}).status_code == 404
    assert list(tmp_path.iterdir()) == []
    (tmp_path / "moon_meta.json").write_text('{"fixture":true}', encoding="utf-8")
    assert client.get("/sim/assets/moon-meta.json").json() == {"fixture": True}
    assert client.get("/sim/assets/site/terrain.json", params={"site": "custom", "lunar_lat": 19, "lunar_lon": 61}).status_code == 404


def test_invalid_3d_ranges():
    dates = {"start": "2026-12-14T20:00:00Z", "end": "2026-12-15T02:00:00Z"}
    assert client.get("/lunar-surface/surface-geometry", params={**dates, "samples": 2001}).status_code == 422
    assert client.get("/sim/moon/positions", params={**dates, "end": "2027-01-01T00:00:00Z"}).status_code == 400
    assert client.get("/windows", params={"locationId": "custom", "lat": 91, "lon": 0, "startDate": "2026-12-14", "endDate": "2026-12-14", "goal": "moon_viewing"}).json()["error"]["code"] == "INVALID_LOCATION"


def test_3d_geometry_and_custom_observation():
    if not all(p.is_file() for p in DATA_FILES) and os.environ.get("LUNAR_REQUIRE_DATA") != "1":
        pytest.skip("Run python prepare_combined.py for the astronomy integration checks.")
    dates = {"start": "2026-12-14T20:00:00Z", "end": "2026-12-15T02:00:00Z"}
    sky = client.get("/lunar-surface/surface-sky", params={**dates, "lat": -89.7668, "lon": -171.87, "samples": 7})
    assert sky.status_code == 200, sky.text
    assert len(sky.json()["earth_el"]) == 7
    geom = client.get("/lunar-surface/surface-geometry", params={**dates, "samples": 7})
    assert geom.status_code == 200, geom.text
    assert len(geom.json()["sub_solar_lon"]) == 7
    pos = client.get("/sim/moon/positions", params={**dates, "place": "mysuru", "step_minutes": 10})
    assert pos.status_code == 200, pos.text
    assert len(pos.json()["times_utc"]) >= 2
    windows = client.get("/windows", params={"locationId": "custom", "lat": 12.2958, "lon": 76.6394, "tz": "Asia/Kolkata", "startDate": "2026-12-14", "endDate": "2026-12-14", "goal": "moon_viewing"})
    assert windows.json()["status"] == "ok", windows.text

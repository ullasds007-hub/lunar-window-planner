"""Candidate lunar landing sites and their Sun/Earth elevation series.

Data comes from the verified December 2026 Horizons exports in data/raw when
they cover the requested range; otherwise it is fetched live from the JPL
Horizons API with the same settings (observer on the Moon, airless, az/el)
and cached. A custom lunar latitude/longitude always uses the live API.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Union

from . import horizons_client
from .horizons_reader import read_observer_table

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

# NASA Lunar Surface Data Book, Table A2.1-1 (east-positive longitude)
SITES = {
    "site04": {"name": "Shackleton Rim (Site 04)", "lat": -89.7668, "lon": 188.13},
    "site11": {"name": "de Gerlache Rim 1 (Site 11)", "lat": -88.6834, "lon": 292.0679},
    "site01": {"name": "Connecting Ridge (Site 01)", "lat": -89.4632, "lon": -137.49},
    "sl3": {"name": "Connecting Ridge Extension (SL3)", "lat": -89.0324, "lon": -101.999},
    "site07": {"name": "Peak Near Shackleton (Site 07)", "lat": -88.811, "lon": 123.6901},
    "sl2": {"name": "de Gerlache Rim 2 (SL2)", "lat": -88.23, "lon": -64.6284},
    "haworth": {"name": "Haworth", "lat": -86.7639, "lon": -22.777},
    "site23": {"name": "Malapert Massif (Site 23)", "lat": -85.9948, "lon": -0.23578},
    "site42": {"name": "de Gerlache-Kocher Massif (Site 42)", "lat": -85.8296, "lon": -116.322},
    "site06": {"name": "Nobile Rim 1 (Site 06)", "lat": -85.4381, "lon": 37.36667},
    "site20": {"name": "Leibnitz Beta Plateau (Site 20)", "lat": -85.4266, "lon": 31.74276},
    "dm2": {"name": "Nobile Rim 2 (DM2)", "lat": -83.954, "lon": 58.82206},
    # Historical landing sites, same coordinates as the planner's Compare page presets
    "im1": {"name": "Odysseus (IM-1) landing site", "lat": -80.13, "lon": 1.44},
    "im2": {"name": "Athena (IM-2) landing site", "lat": -84.7906, "lon": 29.1957},
}
CUSTOM_NAME = "Custom lunar location (enter lunar_lat/lunar_lon)"


def coord_text(lat: float, lon_east: float) -> str:
    """-89.7668, 188.13 -> '89.7668°S, 188.13°E (-171.87°)'"""
    def num(x: float) -> str:  # up to 4 decimals, no trailing zeros
        return f"{x:.4f}".rstrip("0").rstrip(".")
    lon_signed = ((lon_east + 180) % 360) - 180
    return (f"{num(abs(lat))}°{'S' if lat < 0 else 'N'}, {num(lon_east % 360)}°E "
            f"({num(lon_signed)}°)")


def label(site_id: str) -> str:
    s = SITES[site_id]
    return f"{s['name']} - {coord_text(s['lat'], s['lon'])}"


DROPDOWN = [label(k) for k in SITES] + [CUSTOM_NAME]


def site_info(site_id: str) -> dict:
    s = SITES[site_id]
    source = ("Planner Compare-page preset (historical landing site)" if site_id in ("im1", "im2")
              else "NASA Lunar Surface Data Book, Table A2.1-1")
    return {"id": site_id, "name": s["name"], "lat": s["lat"], "lon": s["lon"] % 360,
            "coordinates": coord_text(s["lat"], s["lon"]), "source": source}


def custom_site(lat: float, lon: float) -> dict:
    if not -90 <= lat <= 90:
        raise ValueError("lunar_lat must be between -90 and 90")
    if not -180 <= lon <= 360:
        raise ValueError("lunar_lon must be between -180 and 360 (east positive)")
    return {"id": "custom", "name": "Custom lunar location", "lat": lat, "lon": lon % 360,
            "coordinates": coord_text(lat, lon), "source": "user input"}


def resolve(value: str) -> str:
    """Accept a drop-down label, a plain name or an id (case-insensitive); return the id or "custom"."""
    v = value.strip().lower()
    if v in ("custom", CUSTOM_NAME.lower()):
        return "custom"
    for k, s in SITES.items():
        if v in (k, s["name"].lower(), label(k).lower()):
            return k
    raise ValueError(f"unknown landing site {value!r}; choose one of: {', '.join(DROPDOWN)}")


def _floor_hour(t: datetime) -> datetime:
    return t.replace(minute=0, second=0, microsecond=0)


def body_series(site: Union[str, dict], body: str, start: datetime, end: datetime,
                fetch: Callable = horizons_client._http_get_json) -> dict:
    """Hourly az/el of "sun" or "earth" at a site (id or site dict), covering [start, end]."""
    s = site_info(site) if isinstance(site, str) else site
    path = RAW / f"{s['id']}_{body}.txt"
    if s["id"] in SITES and path.exists():
        local = read_observer_table(path)
        if local["times"][0] <= start and local["times"][-1] >= end:
            local["data_source"] = f"saved JPL Horizons export ({path.name})"
            return local
    a = _floor_hour(start)
    b = _floor_hour(end) + (timedelta(hours=1) if end != _floor_hour(end) else timedelta(0))
    data = horizons_client.observer_table(body, "moon", s["lon"], s["lat"], 0.0, a, b, 60, fetch=fetch)
    data["data_source"] = "JPL Horizons API (live, cached)"
    return data

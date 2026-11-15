"""Live access to the JPL Horizons API (https://ssd-api.jpl.nasa.gov/doc/horizons.html).

Used when a request falls outside the saved December 2026 exports, and to
cross-check Skyfield results. Responses are cached as text files in
data/horizons_cache/ so repeated requests do not call JPL again.
"""
from __future__ import annotations

import hashlib
import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .horizons_reader import HorizonsFileError, parse_observer_text

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "horizons_cache"
BODY_IDS = {"sun": "10", "earth": "399", "moon": "301"}
MAX_ROWS = 20_000


def _http_get_json(url: str, timeout: float) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-window-planner/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _fmt(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")


def observer_table(target: str, center_body: str, east_lon_deg: float, lat_deg: float, alt_km: float,
                   start_utc: datetime, stop_utc: datetime, step_minutes: int = 60,
                   refracted: bool = False, timeout: float = 60.0,
                   fetch: Callable[[str, float], dict] = _http_get_json) -> dict:
    """Azimuth/elevation of `target` ("sun"/"earth"/"moon") from a site on `center_body` ("moon"/"earth").

    Returns the parse_observer_text dict plus "query_url". Raises HorizonsFileError on API errors.
    """
    if stop_utc <= start_utc:
        raise ValueError("stop must be after start")
    if (stop_utc - start_utc) / timedelta(minutes=step_minutes) > MAX_ROWS:
        raise ValueError("too many rows requested; use a shorter range or a larger step")
    center_id = BODY_IDS[center_body]
    params = {
        "format": "json",
        "COMMAND": f"'{BODY_IDS[target]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": f"'coord@{center_id}'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{east_lon_deg % 360:.6f},{lat_deg:.6f},{alt_km:.4f}'",
        "START_TIME": f"'{_fmt(start_utc)}'",
        "STOP_TIME": f"'{_fmt(stop_utc)}'",
        "STEP_SIZE": f"'{step_minutes}m'",
        "QUANTITIES": "'4'",
        "APPARENT": "'REFRACTED'" if refracted else "'AIRLESS'",
        "CAL_FORMAT": "'CAL'",
        "TIME_DIGITS": "'MINUTES'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    key = hashlib.sha1(url.encode()).hexdigest()[:20]
    cache = CACHE_DIR / f"{key}.txt"
    if cache.exists():
        text = cache.read_text()
    else:
        try:
            data = fetch(url, timeout)
        except Exception as exc:
            raise HorizonsFileError(f"JPL Horizons request failed: {exc}") from exc
        if "error" in data:
            raise HorizonsFileError(f"JPL Horizons error: {data['error']}")
        text = data.get("result", "")
        if "$$SOE" not in text:
            raise HorizonsFileError(f"JPL Horizons returned no table: {text[:300]}")
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache.write_text(text)
    expected = {"moon": "Moon (301)", "earth": "Earth (399)"}[center_body]
    out = parse_observer_text(text, f"JPL Horizons API ({target} from {center_body})", expected)
    out["query_url"] = url
    return out


def moon_geometry(start_utc: datetime, stop_utc: datetime, step_minutes: int = 60, timeout: float = 60.0,
                  fetch: Callable[[str, float], dict] = _http_get_json) -> dict:
    """Sub-Earth and sub-solar points on the Moon (Moon-fixed east longitude, latitude), from Horizons.

    Observer: Earth geocentre (500@399); target: Moon (301); QUANTITIES 14 (observer sub-point) and
    15 (Sun sub-point). Used to light the 3D Moon from the real Sun direction and place Earth.
    Longitude convention checked: sub-solar longitude minus a south-pole site's longitude reproduces
    the Horizons Sun azimuth at that site (e.g. 111.54 - 188.13 -> 283.41 deg at Site 04).
    """
    if stop_utc <= start_utc:
        raise ValueError("stop must be after start")
    if (stop_utc - start_utc) / timedelta(minutes=step_minutes) > MAX_ROWS:
        raise ValueError("too many rows requested")
    params = {
        "format": "json", "COMMAND": "'301'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'500@399'",
        "START_TIME": f"'{_fmt(start_utc)}'", "STOP_TIME": f"'{_fmt(stop_utc)}'",
        "STEP_SIZE": f"'{step_minutes}m'", "QUANTITIES": "'14,15'", "CAL_FORMAT": "'CAL'",
        "TIME_DIGITS": "'MINUTES'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    cache = CACHE_DIR / f"geom_{hashlib.sha1(url.encode()).hexdigest()[:20]}.txt"
    if cache.exists():
        text = cache.read_text()
    else:
        try:
            data = fetch(url, timeout)
        except Exception as exc:
            raise HorizonsFileError(f"JPL Horizons request failed: {exc}") from exc
        if "error" in data:
            raise HorizonsFileError(f"JPL Horizons error: {data['error']}")
        text = data.get("result", "")
        if "$$SOE" not in text:
            raise HorizonsFileError(f"JPL Horizons returned no table: {text[:300]}")
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache.write_text(text)
    times, rows = [], []
    for row in text.split("$$SOE", 1)[1].split("$$EOE", 1)[0].splitlines():
        if not row.strip():
            continue
        t = datetime.strptime(row[:18].strip(), "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
        vals = [float(x) for x in row[18:].split()[-4:]]
        times.append(t)
        rows.append(vals)
    a = list(zip(*rows)) if rows else [[], [], [], []]
    return {"times": times, "sub_earth_lon": list(a[0]), "sub_earth_lat": list(a[1]),
            "sub_solar_lon": list(a[2]), "sub_solar_lat": list(a[3]),
            "source": "JPL Horizons API (Moon 301 seen from Earth geocentre, quantities 14,15)"}

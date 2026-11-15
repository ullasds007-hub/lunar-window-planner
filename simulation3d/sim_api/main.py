"""Read-only 3D viewer endpoints. Existing planner routes remain authoritative."""
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.services.lunar import LunarDataUnavailable
from ..calculations import lunar_sites, places, sky as mo

app = FastAPI(title="LunaSpan 3D viewer", docs_url=None, redoc_url=None, openapi_url=None)
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "web_assets"
def landing_site(site: str = Query(lunar_sites.DROPDOWN[0],
                                   description="Lunar landing site (latitude, east longitude shown). "
                                               "Choose the custom option to enter lunar_lat / lunar_lon.",
                                   json_schema_extra={"enum": lunar_sites.DROPDOWN}),
                 lunar_lat: float | None = Query(None, ge=-90, le=90,
                                                 description="Only for the custom option. Lunar latitude, north positive (south pole = -90)"),
                 lunar_lon: float | None = Query(None, ge=-180, le=360,
                                                 description="Only for the custom option. Lunar longitude, east positive (0-360 or -180..180)")) -> dict:
    try:
        site_id = lunar_sites.resolve(site)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if site_id != "custom":
        return lunar_sites.site_info(site_id)
    if lunar_lat is None or lunar_lon is None:
        raise HTTPException(400, "Custom lunar location needs lunar_lat and lunar_lon")
    return lunar_sites.custom_site(lunar_lat, lunar_lon)


Body = Literal["moon", "sun"]
TIME_HELP = ("Date/time. Accepts 2026-11-14, 2026-11-14 18:30, 2026-11-14T18:30:00Z or "
             "2026-11-14T18:30:00+05:30. Without an offset it is read in the 'tz' time zone.")




def parse_time(value: str | None, tz: str) -> datetime:
    """Lenient datetime parsing for the docs UI; naive values are taken in `tz`."""
    try:
        zone = ZoneInfo(tz)
    except Exception:
        raise HTTPException(400, f"unknown time zone {tz!r}")
    if value is None or not value.strip():
        return datetime.now(timezone.utc)
    m = _TIME_RE.match(value.strip())
    if not m:
        raise HTTPException(400, f"could not read time {value!r}. {TIME_HELP}")
    y, mo_, d, hh, mm, ss, off = m.groups()
    try:
        dt = datetime(int(y), int(mo_), int(d), int(hh or 0), int(mm or 0), int(ss or 0))
    except ValueError as exc:
        raise HTTPException(400, f"invalid date/time {value!r}: {exc}")
    if off:
        if off.upper() == "Z":
            return dt.replace(tzinfo=timezone.utc)
        sign = 1 if off[0] == "+" else -1
        oh, om = off[1:].replace(":", "")[:2], off[1:].replace(":", "")[2:] or "0"
        if int(oh) > 23 or int(om) > 59:
            raise HTTPException(400, "Invalid UTC offset")
        return dt.replace(tzinfo=timezone(sign * timedelta(hours=int(oh), minutes=int(om))))
    return dt.replace(tzinfo=zone)


_TIME_RE = re.compile(
    r"^(\d{4})-(\d{1,2})-(\d{1,2})"
    r"(?:[T ]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?)?"
    r"\s*(Z|z|[+-]\d{2}:?\d{2})?$")




def observer(place: str = Query(places.PLACES["sriharikota_slp"]["name"],
                                description="Indian launch site, or 'Custom location' to type your own lat/lon.",
                                json_schema_extra={"enum": places.DROPDOWN}),
             lat: float | None = Query(None, ge=-90, le=90, description="Only for place=custom. Latitude, north positive"),
             lon: float | None = Query(None, ge=-180, le=360, description="Only for place=custom. Longitude, east positive"),
             elevation_m: float = Query(0.0, description="Only for place=custom"),
             tz: str = Query("Asia/Kolkata", description="Only for place=custom. IANA time zone")) -> mo.Observer:
    try:
        place_id = places.resolve(place)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if place_id != "custom":
        return places.observer_for(place_id)
    if lat is None or lon is None:
        raise HTTPException(400, "Custom location needs lat and lon")
    try:
        return mo.Observer(lat, lon, elevation_m, tz, "Custom location")
    except Exception as exc:
        raise HTTPException(400, f"invalid observer: {exc}")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LunarDataUnavailable as exc:
        raise HTTPException(503, "Run python prepare_combined.py first.") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/moon/phase", tags=["Moon"])
def moon_phase(time: str | None = Query(None, description=TIME_HELP + " Empty = now.",
                                        examples=["2026-11-14 18:00"]),
               tz: str = Query("UTC", description="Time zone for times without an offset, e.g. Asia/Kolkata")):
    return _call(mo.moon_phase, parse_time(time, tz))


@app.get("/places", tags=["Places"])
def list_places():
    """Preset Indian launch sites with their coordinates and sources."""
    return places.list_places()


@app.get("/lunar-sites", tags=["Lunar sites"])
def list_lunar_sites():
    """Preset lunar landing sites (NASA Lunar Surface Data Book) with coordinates."""
    return [lunar_sites.site_info(k) | {"label": lunar_sites.label(k)} for k in lunar_sites.SITES]


@lru_cache(maxsize=1)
def _tzfinder():
    from timezonefinder import TimezoneFinder
    return TimezoneFinder()


@app.get("/geo/timezone", tags=["Places"])
def geo_timezone(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """IANA time zone for a coordinate (offline lookup with timezonefinder)."""
    tf = _tzfinder()
    tz = tf.timezone_at(lat=lat, lng=lon) or "UTC"
    return {"lat": lat, "lon": lon, "timezone": tz}


@app.get("/{body}/positions")
def positions(body: Body, start: str, end: str,
              step_minutes: int = Query(5, ge=1, le=1440),
              obs: mo.Observer = Depends(observer)):
    a = parse_time(start, obs.timezone).astimezone(timezone.utc)
    b = parse_time(end, obs.timezone).astimezone(timezone.utc)
    if not (1901 <= a.year <= b.year <= 2049 and timedelta(0) < b-a <= timedelta(days=2)):
        raise HTTPException(400, "Choose a positive range of at most two days within 1901–2049.")
    return _call(mo.position_series, obs, body, a, b, step_minutes)


@app.get("/geo/config")
def geo_config():
    # Intentionally no Google API key, environment values, or secret config.
    return {"provider": "osm"}


def asset(filename):
    path = OUT / filename
    if not path.is_file():
        raise HTTPException(404, "No bundled terrain for this site. The elevation calculations are still available.")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/assets/moon/{name}")
def moon_asset(name: Literal["albedo.jpg", "normal.png", "height.png"]):
    return asset("moon_" + name)


@app.get("/assets/moon-meta.json")
def moon_meta():
    return asset("moon_meta.json")


@app.get("/assets/polar/{pole}/{kind}")
def polar_asset(pole: Literal["south", "north"], kind: Literal["height.bin", "albedo.png", "meta.json"]):
    tag = "s" if pole == "south" else "n"
    return asset(f"polar_{tag}.json" if kind == "meta.json" else f"polar_{tag}_{kind}")


@app.get("/assets/site/{kind}")
def site_asset(kind: Literal["terrain.bin", "terrain.json", "albedo.png"], site: dict = Depends(landing_site)):
    key = f"{site['lat']:+.4f}_{site['lon'] % 360:.4f}".replace("+", "p").replace("-", "m").replace(".", "d")
    return asset(f"{key}_{kind}")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/sim/app/")


app.mount("/app", StaticFiles(directory=ROOT / "web", html=True), name="viewer")

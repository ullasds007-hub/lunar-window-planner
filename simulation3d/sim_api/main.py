"""FastAPI backend for Lunar Window Planner.

Run from the project folder:  python -m uvicorn api.main:app --port 8000
Docs page:                    http://127.0.0.1:8000/docs
"""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query

from advanced_analysis import illumination_duration as idur
from advanced_analysis import observation_windows as ow
from advanced_analysis import visibility_scoring as vs
from advanced_analysis.visibility_scoring import Preferences
from pydantic import BaseModel, ConfigDict, Field, model_validator
from advanced_analysis import earth_visibility as ev
from advanced_analysis import lroc_quickmap
from calculations import horizons_client, horizons_reader, landing_windows, lunar_sites, places
from calculations import sky as mo

app = FastAPI(title="Lunar Window Planner API",
              description="Earth-based Moon/Sun observation from Indian launch sites (JPL DE440s via Skyfield), "
                          "lunar landing-site screening (JPL Horizons) and lunar terrain (LROC QuickMap WMS).")


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
        return dt.replace(tzinfo=timezone(sign * timedelta(hours=int(oh), minutes=int(om))))
    return dt.replace(tzinfo=zone)


# 2026-11-12, 2026-1-2, 2026-11-12 6:30, 2026-11-12T06:30:00Z, 2026-11-12 18:30+05:30
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


def _remote(fn, *args, **kwargs):
    """Call something that may reach JPL/LROC: bad input -> 400, service failure -> 502."""
    try:
        return fn(*args, **kwargs)
    except horizons_reader.HorizonsFileError as exc:
        raise HTTPException(502, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except OSError as exc:
        raise HTTPException(502, f"external service unavailable: {exc}")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# ---- Earth-based observation ------------------------------------------------

@app.get("/moon/phase", tags=["Moon"])
def moon_phase(time: str | None = Query(None, description=TIME_HELP + " Empty = now.",
                                        examples=["2026-11-14 18:00"]),
               tz: str = Query("UTC", description="Time zone for times without an offset, e.g. Asia/Kolkata")):
    return _call(mo.moon_phase, parse_time(time, tz))


@app.get("/moon/principal-phases", tags=["Moon"])
def principal_phases(start: str = Query(..., description=TIME_HELP, examples=["2026-11-01"]),
                     end: str = Query(..., description=TIME_HELP, examples=["2026-12-01"]),
                     tz: str = Query("UTC", description="Time zone for input and local output, e.g. Asia/Kolkata")):
    """New, First Quarter, Full and Last Quarter Moon in a date range, plus the nearest
    phase before and after it (phases are about 7.4 days apart, so short ranges often hold none)."""
    return _call(mo.principal_phases_summary, parse_time(start, tz), parse_time(end, tz), tz)


@app.get("/{body}/rise-set", tags=["Moon", "Sun"])
def rise_set(body: Body, day: date, obs: mo.Observer = Depends(observer)):
    return _call(mo.rise_set_transit, obs, body, day)


@app.get("/{body}/positions", tags=["Moon", "Sun"])
def positions(body: Body,
              start: str = Query(..., description=TIME_HELP, examples=["2026-11-14 00:00"]),
              end: str = Query(..., description=TIME_HELP, examples=["2026-11-15 00:00"]),
              step_minutes: int = Query(10, gt=0),
              obs: mo.Observer = Depends(observer)):
    return _call(mo.position_series, obs, body, parse_time(start, obs.timezone),
                 parse_time(end, obs.timezone), step_minutes)


@app.get("/twilight", tags=["Sun"])
def twilight(day: date, obs: mo.Observer = Depends(observer)):
    return _call(mo.twilight_periods, obs, day)


@app.get("/report", tags=["Summary"])
def report(day: date, step_minutes: int = Query(10, gt=0), obs: mo.Observer = Depends(observer)):
    return _call(mo.daily_report, obs, day, step_minutes)


# ---- Illumination duration ---------------------------------------------------

@app.get("/illumination/daylight", tags=["Illumination duration"])
def daylight(start_day: date, days: int = Query(7, ge=1, le=366), obs: mo.Observer = Depends(observer)):
    """Daylight and darkness minutes per local day, with day-to-day change."""
    return _call(idur.earth_daylight, obs, start_day, days)


@app.get("/illumination/moon-observable", tags=["Illumination duration"])
def moon_observable(day: date, max_sun_altitude_deg: float = -6.0, obs: mo.Observer = Depends(observer)):
    """Minutes the Moon is above the horizon, and how many of those are in a dark sky."""
    return _call(idur.moon_observable_duration, obs, day, max_sun_altitude_deg)


@app.get("/illumination/lunar-site", tags=["Illumination duration", "Lunar sites"])
def lunar_site(site: dict = Depends(landing_site),
               start: str = Query("2026-12-01", description=TIME_HELP + " (UTC)"),
               end: str = Query("2026-12-31", description=TIME_HELP + " (UTC). Outside Dec 2026 is fetched from JPL Horizons."),
               use_terrain: bool = Query(False, description="Use an approximate terrain horizon from the LROC QuickMap server")):
    """Sunlit vs dark time at a lunar site (ideal 0 deg horizon, or approximate terrain horizon)."""
    s, e = parse_time(start, "UTC"), parse_time(end, "UTC")
    if e <= s or e - s > timedelta(days=400):
        raise HTTPException(400, "end must be after start and within 400 days")
    data = _remote(lunar_sites.body_series, site, "sun", s, e)
    horizon, hz = _terrain(site) if use_terrain else (None, None)
    out = _call(idur.lunar_surface_illumination, data["times"], data["elevation_deg"],
                data["azimuth_deg"], horizon, s, e)
    out["terrain_horizon"] = _hz_summary(hz)
    out.update(site=site["id"], site_name=site["name"], latitude_deg=site["lat"], east_longitude_deg=site["lon"],
               coordinates=site["coordinates"], data_source=data["data_source"],
               limitation="Approximate terrain horizon (coarse, not validated against LOLA)." if use_terrain
               else "Ideal horizon - terrain not modeled.")
    return out


# ---- Places --------------------------------------------------------------------

@app.get("/places", tags=["Places"])
def list_places():
    """Preset Indian launch sites with their coordinates and sources."""
    return places.list_places()


# ---- Lunar landing sites -------------------------------------------------------

@app.get("/landing/compare", tags=["Lunar sites"])
def landing_compare(site: dict = Depends(landing_site),
                    start: str = Query("2026-12-14 20:00", description=TIME_HELP + " (UTC)"),
                    duration_hours: float = Query(6.0, gt=0, le=72),
                    delay_hours: float = Query(72.0, ge=0, le=24 * 60)):
    """Sun AND Earth above an ideal 0 deg horizon at a lunar site: original vs delayed landing.
    Uses the saved Dec 2026 Horizons exports when they cover the request, otherwise live JPL Horizons."""
    s = parse_time(start, "UTC")
    e = s + timedelta(hours=delay_hours + duration_hours)
    sun = _remote(lunar_sites.body_series, site, "sun", s, e)
    earth = _remote(lunar_sites.body_series, site, "earth", s, e)
    if sun["times"] != earth["times"]:
        raise HTTPException(502, "Sun and Earth series are not aligned")
    out = landing_windows.compare_scenarios(site["id"], site["name"], sun["times"],
                                            sun["elevation_deg"], earth["elevation_deg"], s,
                                            duration_hours, delay_hours)
    out.update(latitude_deg=site["lat"], east_longitude_deg=site["lon"], coordinates=site["coordinates"])
    out["data_source"] = {"sun": sun["data_source"], "earth": earth["data_source"]}
    out["limitation"] = "Ideal horizon - terrain not modeled. Not a power or communications prediction."
    return out


@app.get("/lunar-site/terrain", tags=["Lunar sites"])
def lunar_terrain(site: dict = Depends(landing_site)):
    """Height, slope and permanently-shadowed-region check at a landing site, from the LROC QuickMap WMS server."""
    s = site
    return {
        "site": s["id"], "site_name": s["name"], "latitude_deg": s["lat"], "east_longitude_deg": s["lon"],
        "coordinates": s["coordinates"],
        "terrain": _remote(lroc_quickmap.terrain_at, s["lat"], s["lon"]),
        "permanent_shadow": _remote(lroc_quickmap.psr_at, s["lat"], s["lon"]),
        "map_preview_png": lroc_quickmap.preview_image_url(s["lat"], s["lon"]),
        "quickmap": lroc_quickmap.QUICKMAP,
    }


# ---- Cross-check against JPL Horizons -------------------------------------------

@app.get("/moon/horizons-check", tags=["Moon"])
def horizons_check(time: str | None = Query(None, description=TIME_HELP + " Empty = now."),
                   obs: mo.Observer = Depends(observer)):
    """Moon altitude/azimuth from Skyfield vs the JPL Horizons API for the same place and minute."""
    t = parse_time(time, obs.timezone).astimezone(timezone.utc).replace(second=0, microsecond=0)
    ours = _call(mo.position_at, obs, "moon", t)
    h = _remote(horizons_client.observer_table, "moon", "earth", obs.longitude_deg, obs.latitude_deg,
                obs.elevation_m / 1000, t, t + timedelta(minutes=1), 1, refracted=True)
    jpl_alt, jpl_az = h["elevation_deg"][0], h["azimuth_deg"][0]
    daz = (ours["azimuth_deg"] - jpl_az + 180) % 360 - 180
    return {
        "observer": obs.describe(), "time_utc": ours["time_utc"],
        "skyfield": {"altitude_deg": ours["altitude_deg"], "azimuth_deg": ours["azimuth_deg"]},
        "jpl_horizons": {"altitude_deg": jpl_alt, "azimuth_deg": jpl_az},
        "difference_deg": {"altitude": round(ours["altitude_deg"] - jpl_alt, 4), "azimuth": round(daz, 4)},
        "note": "Both include standard atmospheric refraction. Differences of a few hundredths of a "
                "degree come from different refraction models.",
    }


# ---- Optimal observation windows -------------------------------------------

@app.get("/observation-windows", tags=["Observation windows"])
def observation_windows(night_of: date | None = Query(None, description="Evening date at the place. Empty = tonight."),
                        obs: mo.Observer = Depends(observer)):
    """Best times to observe the Moon on one night. Just pick a place (and optionally a date).

    Everything else is automatic: Moon/Sun positions from JPL DE440s, live Open-Meteo cloud
    cover when a forecast exists (about 16 days ahead), and the default scoring settings
    (Moon at least 15 deg up, Sun below -6 deg, cloud at most 60 %)."""
    day = night_of or datetime.now(obs.tz).date()
    return _call(ow.recommend_windows, obs, day, Preferences(), 5, 20, True)


# ---- Terrain horizon cache ----------------------------------------------------------

_HORIZONS: dict = {}


def _terrain(site: dict):
    key = (round(site["lat"], 5), round(site["lon"], 5))
    if key not in _HORIZONS:
        _HORIZONS[key] = _remote(lroc_quickmap.terrain_horizon, site["lat"], site["lon"])
    hz = _HORIZONS[key]
    return idur.horizon_from_profile(hz["azimuths_deg"], hz["horizon_elevation_deg"]), hz


def _hz_summary(hz):
    if hz is None:
        return None
    e = hz["horizon_elevation_deg"]
    return {k: hz[k] for k in ("search_radius_m", "pixel_m", "site_height_m", "source", "caveat")} | {
        "max_horizon_deg": max(e), "min_horizon_deg": min(e),
        "azimuth_of_max_deg": hz["azimuths_deg"][e.index(max(e))],
        "azimuths_deg": hz["azimuths_deg"], "horizon_elevation_deg": e}


# ---- Earth visibility and communication opportunities ---------------------------------

@app.get("/earth-visibility", tags=["Lunar sites"])
def earth_visibility(site: dict = Depends(landing_site),
                     start: str = Query("2026-12-01", description=TIME_HELP + " (UTC)"),
                     end: str = Query("2026-12-31", description=TIME_HELP + " (UTC). Outside Dec 2026 uses live JPL Horizons."),
                     use_terrain: bool = Query(True, description="Check Earth against an approximate terrain horizon (LROC QuickMap server)"),
                     min_elevation_deg: float = Query(0.0, ge=0, le=30, description="Antenna mask: Earth must be this far above the horizon"),
                     min_window_minutes: float = Query(30.0, ge=1, le=1440, description="Shortest line-of-sight period to list as a DTE window")):
    """When Earth is in direct line of sight from a lunar site, and when terrain blocks it.
    Line of sight is not the same as communication availability."""
    s, e = parse_time(start, "UTC"), parse_time(end, "UTC")
    if e <= s or e - s > timedelta(days=400):
        raise HTTPException(400, "end must be after start and within 400 days")
    data = _remote(lunar_sites.body_series, site, "earth", s, e)
    horizon, hz = _terrain(site) if use_terrain else (None, None)
    out = ev.earth_visibility(data["times"], data["elevation_deg"], data["azimuth_deg"], horizon,
                              min_elevation_deg, min_window_minutes, s, e)
    if out.get("data_status") != "ok":
        raise HTTPException(400, out.get("message", "data problem"))
    out.update(site=site["id"], site_name=site["name"], coordinates=site["coordinates"],
               data_source=data["data_source"], terrain_horizon=_hz_summary(hz),
               relay_satellites="Not modeled: no relay satellite positions are used.")
    return out


# ---- Lunar visibility score (Earth-based observing) -----------------------------------

@app.get("/visibility-score", tags=["Visibility scoring"])
def visibility_score(time: str | None = Query(None, description=TIME_HELP + " Empty = now. Read in the place's time zone."),
                     use_weather: bool = Query(False, description="Include Open-Meteo cloud cover"),
                     illumination_preference: vs.PresetName = Query("any"),
                     full_score_altitude_deg: float = Query(45.0, gt=0, le=90),
                     obs: mo.Observer = Depends(observer)):
    """Quick GET version of /calculate/visibility for a place and time (same scoring engine)."""
    try:
        prefs = Preferences(full_score_altitude_deg=full_score_altitude_deg,
                            illumination_preference=illumination_preference)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return _call(ow.visibility_at, obs, parse_time(time, obs.timezone), prefs, use_weather)


class VisibilityRequest(BaseModel):
    """Either give `place` (+ optional `time`) to compute Moon/Sun values from the Level 1 engine,
    or give moon_altitude_deg, sun_altitude_deg and illumination_percent directly (e.g. from Charts)."""
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [
        {"place": "India - Satish Dhawan Space Centre, Second Launch Pad (Sriharikota, AP)",
         "time": "2026-11-14 19:30", "use_weather": False},
        {"moon_altitude_deg": 52.0, "sun_altitude_deg": -25.0, "illumination_percent": 48.0,
         "cloud_cover_percent": 5.0, "illumination_preference": "terminator_detail"},
    ]})

    place: str | None = Field(None, description="Launch-site name or id from /places (or the custom option)")
    time: str | None = Field(None, description=TIME_HELP + " Empty = now.")
    lat: float | None = Field(None, ge=-90, le=90, description="Only for the custom place")
    lon: float | None = Field(None, ge=-180, le=360, description="Only for the custom place")
    tz: str = Field("UTC", description="Only for the custom place")
    use_weather: bool = Field(False, description="Fetch cloud cover from Open-Meteo for place/time mode")

    moon_altitude_deg: float | None = Field(None, ge=-90, le=90)
    sun_altitude_deg: float | None = Field(None, ge=-90, le=90)
    illumination_percent: float | None = Field(None, ge=0, le=100)
    cloud_cover_percent: float | None = Field(None, ge=0, le=100, description="Omit if no weather data")

    weights: dict[str, float] | None = Field(None, description="e.g. {\"altitude\":0.3,\"darkness\":0.25,\"cloud\":0.25,\"illumination\":0.2}")
    illumination_preference: vs.PresetName = "any"
    illumination_ideal_min: float | None = Field(None, ge=0, le=100, description="Custom preference (overrides preset)")
    illumination_ideal_max: float | None = Field(None, ge=0, le=100)
    illumination_tolerance: float | None = Field(None, ge=0, le=100)
    full_score_altitude_deg: float = Field(45.0, gt=0, le=90)

    @model_validator(mode="after")
    def _one_mode(self):
        direct = [self.moon_altitude_deg, self.sun_altitude_deg, self.illumination_percent]
        if any(v is not None for v in direct):
            if any(v is None for v in direct):
                raise ValueError("direct mode needs moon_altitude_deg, sun_altitude_deg and illumination_percent")
            if self.place is not None:
                raise ValueError("give either place/time or direct values, not both")
        elif self.place is None:
            raise ValueError("give a place (with optional time), or moon_altitude_deg, sun_altitude_deg "
                             "and illumination_percent")
        if self.place is not None and self.cloud_cover_percent is not None and self.use_weather:
            raise ValueError("give cloud_cover_percent or use_weather, not both")
        custom = [self.illumination_ideal_min, self.illumination_ideal_max, self.illumination_tolerance]
        if any(v is not None for v in custom) and any(v is None for v in custom):
            raise ValueError("a custom illumination preference needs illumination_ideal_min, "
                             "illumination_ideal_max and illumination_tolerance")
        if self.weights is not None:
            vs.validate_weights(self.weights)
        return self


@app.post("/calculate/visibility", tags=["Visibility scoring"])
def calculate_visibility(req: VisibilityRequest):
    """Lunar visibility score 0-100 (Level 2, Phase 3). Weights: altitude 30, darkness 25, cloud 25,
    illumination 20 (configurable; re-normalized when weather is missing)."""
    try:
        pref = (vs.IlluminationPreference(req.illumination_ideal_min, req.illumination_ideal_max,
                                          req.illumination_tolerance, "custom")
                if req.illumination_ideal_min is not None else req.illumination_preference)
        if req.place is None:
            out = vs.calculate_visibility(req.moon_altitude_deg, req.sun_altitude_deg, req.illumination_percent,
                                          req.cloud_cover_percent, req.weights, pref, req.full_score_altitude_deg)
            out["mode"] = "direct values"
            return out
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    obs = observer(req.place, req.lat, req.lon, 0.0, req.tz)
    when = parse_time(req.time, obs.timezone)
    try:
        prefs = Preferences(full_score_altitude_deg=req.full_score_altitude_deg,
                            illumination_preference=req.illumination_preference,
                            weights=req.weights or dict(vs.DEFAULT_WEIGHTS))
        out = ow.visibility_at(obs, when, prefs, req.use_weather)
        if req.cloud_cover_percent is not None or not isinstance(pref, str):
            inp = out["inputs"]
            out = {**vs.calculate_visibility(inp["moon_altitude_deg"], inp["sun_altitude_deg"],
                                             inp["illumination_percent"], req.cloud_cover_percent
                                             if req.cloud_cover_percent is not None else inp["cloud_cover_percent"],
                                             req.weights, pref, req.full_score_altitude_deg),
                   **{k: out[k] for k in ("observer", "time", "moon_azimuth_deg", "sky_condition",
                                          "weather", "level1_source")}}
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    out["mode"] = "computed from Level 1 engine"
    return out


# ---- Web experience: data + assets ------------------------------------------------------

from pathlib import Path as _Path  # noqa: E402

from fastapi.responses import FileResponse, RedirectResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from sim_api import assets as web_assets  # noqa: E402

_WEB_DIR = _Path(__file__).resolve().parents[1] / "web"


@app.get("/lunar-sites", tags=["Lunar sites"])
def list_lunar_sites():
    """Preset lunar landing sites (NASA Lunar Surface Data Book) with coordinates."""
    return [lunar_sites.site_info(k) | {"label": lunar_sites.label(k)} for k in lunar_sites.SITES]


@app.get("/lunar-site/sky", tags=["Lunar sites"])
def lunar_site_sky(site: dict = Depends(landing_site),
                   start: str = Query("2026-12-14 00:00", description=TIME_HELP + " (UTC)"),
                   end: str = Query("2026-12-21 00:00", description=TIME_HELP + " (UTC)")):
    """Hourly Sun and Earth azimuth/elevation at a lunar site (JPL Horizons; saved file or live API)."""
    s, e = parse_time(start, "UTC"), parse_time(end, "UTC")
    if e <= s or e - s > timedelta(days=60):
        raise HTTPException(400, "end must be after start and within 60 days")
    sun = _remote(lunar_sites.body_series, site, "sun", s, e)
    earth = _remote(lunar_sites.body_series, site, "earth", s, e)
    if sun["times"] != earth["times"]:
        raise HTTPException(502, "Sun and Earth series are not aligned")
    keep = [i for i, t in enumerate(sun["times"]) if s - timedelta(hours=1) <= t <= e + timedelta(hours=1)]
    pick = lambda arr: [round(arr[i], 5) for i in keep]  # noqa: E731
    return {
        "site": site, "times_utc": [sun["times"][i].strftime("%Y-%m-%dT%H:%M:%SZ") for i in keep],
        "sun_az": pick(sun["azimuth_deg"]), "sun_el": pick(sun["elevation_deg"]),
        "earth_az": pick(earth["azimuth_deg"]), "earth_el": pick(earth["elevation_deg"]),
        "data_source": {"sun": sun["data_source"], "earth": earth["data_source"]},
    }


@app.get("/moon/geometry", tags=["Lunar sites"])
def moon_geometry(start: str = Query("2026-12-14 00:00", description=TIME_HELP + " (UTC)"),
                  end: str = Query("2026-12-21 00:00", description=TIME_HELP + " (UTC)"),
                  step_minutes: int = Query(60, ge=10, le=1440)):
    """Sub-solar and sub-Earth points on the Moon (JPL Horizons), for lighting the 3D globe."""
    s, e = parse_time(start, "UTC"), parse_time(end, "UTC")
    if e - s > timedelta(days=60):
        raise HTTPException(400, "range must be within 60 days")
    g = _remote(horizons_client.moon_geometry, s, e, step_minutes)
    g["times"] = [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in g["times"]]
    return g


@app.get("/assets/moon/{name}", tags=["Assets"], include_in_schema=False)
def moon_asset(name: Literal["albedo.jpg", "normal.png", "height.png"]):
    files = _remote(web_assets.build_global)
    return FileResponse(files[name], headers={"Cache-Control": "public, max-age=86400"})


@app.get("/assets/moon-meta.json", tags=["Assets"], include_in_schema=False)
def moon_meta():
    _remote(web_assets.build_global)
    return FileResponse(web_assets.OUT / "moon_meta.json", media_type="application/json")


@app.get("/assets/polar/{pole}/{kind}", tags=["Assets"], include_in_schema=False)
def polar_asset(pole: Literal["south", "north"], kind: Literal["height.bin", "albedo.png", "meta.json"]):
    f = _remote(web_assets.build_polar, pole)
    path = {"height.bin": f["bin"], "albedo.png": f["albedo"], "meta.json": f["meta"]}[kind]
    media = {"height.bin": "application/octet-stream", "albedo.png": "image/png", "meta.json": "application/json"}[kind]
    return FileResponse(path, media_type=media, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/assets/site/{kind}", tags=["Assets"], include_in_schema=False)
def site_asset(kind: Literal["terrain.bin", "terrain.json", "albedo.png"], site: dict = Depends(landing_site)):
    f = _remote(web_assets.build_site, site["lat"], site["lon"])
    path = {"terrain.bin": f["bin"], "terrain.json": f["meta"], "albedo.png": f["albedo"]}[kind]
    media = {"terrain.bin": "application/octet-stream", "terrain.json": "application/json",
             "albedo.png": "image/png"}[kind]
    return FileResponse(path, media_type=media, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("app/")   # relative: works when mounted under a prefix


if _WEB_DIR.exists():
    app.mount("/app", StaticFiles(directory=str(_WEB_DIR), html=True), name="web")


# ---- Geography: location search configuration and time zones (Observe from Earth) -------------

import os as _os  # noqa: E402
from functools import lru_cache as _lru_cache  # noqa: E402


@_lru_cache(maxsize=1)
def _tzfinder():
    from timezonefinder import TimezoneFinder
    return TimezoneFinder()


@app.get("/geo/config", tags=["Places"])
def geo_config():
    """Which map/search provider the browser should use.

    Set GOOGLE_MAPS_API_KEY (Maps JavaScript API + Places API enabled, HTTP-referrer restricted) on the
    server to use Google Maps and Google place search. Without it, the page uses OpenStreetMap: Photon
    search (photon.komoot.io) and OpenStreetMap tiles, which need no key.
    """
    key = _os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    return {"provider": "google" if key else "osm", "google_maps_key": key or None}


@app.get("/geo/timezone", tags=["Places"])
def geo_timezone(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """IANA time zone for a coordinate (offline lookup with timezonefinder)."""
    tf = _tzfinder()
    tz = tf.timezone_at(lat=lat, lng=lon) or "UTC"
    return {"lat": lat, "lon": lon, "timezone": tz}

"""Illumination duration: how long a place receives direct sunlight.

Two modes:
  * Earth observer   daylight/darkness per local day from Skyfield, plus how
                     long the Moon is above the horizon (and in a dark sky).
  * Lunar surface    sunlit/dark time at a lunar site from the Horizons Sun
                     elevation series, optionally against a terrain horizon
                     profile (from advanced_analysis.terrain_shadow).

D_light = sum of sunlit intervals. On an ordinary day that equals
T_sunset - T_sunrise; summing intervals also covers polar day/night and days
with two sunsets, where that simple difference breaks.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional, Sequence

import numpy as np
from skyfield import almanac

from calculations import landing_windows as lw
from calculations.sky import Observer, _altaz, _local_day, _sky, rise_set_transit


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------
# Earth observer
# --------------------------------------------------------------------------

def earth_daylight(obs: Observer, start_day: date, days: int = 1) -> dict:
    """Daylight and darkness minutes for each local day, and the day-to-day change."""
    if not 1 <= days <= 366:
        raise ValueError("days must be between 1 and 366")
    rows, prev = [], None
    for i in range(days):
        d = start_day + timedelta(days=i)
        s, e = _local_day(obs, d)
        day_len = int(round((e - s).total_seconds() / 60))  # 1380/1500 on DST change days
        r = rise_set_transit(obs, "sun", d)
        light = r["above_horizon_minutes"]
        rows.append({
            "date_local": d.isoformat(),
            "sunrise": r["rise"][0] if r["rise"] else None,
            "sunset": r["set"][0] if r["set"] else None,
            "daylight_minutes": light,
            "darkness_minutes": day_len - light,
            "change_vs_previous_day_minutes": None if prev is None else light - prev,
            "note": r["note"],
        })
        prev = light
    return {"observer": obs.describe(), "days": rows,
            "definition": "daylight = Sun's upper limb above a flat sea-level horizon, with refraction"}


def moon_observable_duration(obs: Observer, day: date, max_sun_altitude_deg: float = -6.0,
                             step_minutes: int = 5) -> dict:
    """How long the Moon is above the horizon on a local day, and how much of that is in a dark sky.

    "Dark sky" = Sun altitude at or below max_sun_altitude_deg (default -6, end of civil twilight).
    """
    ts, eph = _sky()
    r = rise_set_transit(obs, "moon", day)
    up_minutes = r["above_horizon_minutes"]
    dark_up, illum = 0.0, []
    for iv in r["above_horizon_intervals"]:
        a = datetime.fromisoformat(iv["start"]["utc"].replace("Z", "+00:00"))
        b = datetime.fromisoformat(iv["end"]["utc"].replace("Z", "+00:00"))
        n = max(2, int((b - a).total_seconds() // (step_minutes * 60)) + 1)
        t = ts.linspace(ts.from_datetime(a), ts.from_datetime(b), n)
        sun_alt = _altaz(obs, "sun", t)[0]
        dt = (b - a).total_seconds() / 60 / (n - 1)
        # trapezoid on the dark indicator
        dark = (sun_alt <= max_sun_altitude_deg).astype(float)
        dark_up += float(np.sum((dark[:-1] + dark[1:]) / 2) * dt)
        illum.extend((almanac.fraction_illuminated(eph, "moon", t) * 100).tolist())
    return {
        "date_local": day.isoformat(),
        "moon_above_horizon_minutes": up_minutes,
        "moon_up_in_dark_sky_minutes": int(round(dark_up)),
        "dark_sky_definition": f"Sun altitude <= {max_sun_altitude_deg} deg",
        "mean_illumination_percent_while_up": round(float(np.mean(illum)), 1) if illum else None,
        "moonrise": r["rise"], "moonset": r["set"], "note": r["note"],
    }


# --------------------------------------------------------------------------
# Lunar surface
# --------------------------------------------------------------------------

def horizon_from_profile(azimuths_deg: Sequence[float], elevations_deg: Sequence[float]) -> Callable:
    """Make horizon(az) by periodic linear interpolation of a terrain horizon profile."""
    az = np.asarray(azimuths_deg, float) % 360
    el = np.asarray(elevations_deg, float)
    order = np.argsort(az)
    az, el = az[order], el[order]
    return lambda a: np.interp(np.asarray(a, float) % 360, az, el, period=360)


def lunar_surface_illumination(times: Sequence[datetime], sun_elevation_deg: Sequence[float],
                               sun_azimuth_deg: Optional[Sequence[float]] = None,
                               horizon: Optional[Callable] = None,
                               start_utc: Optional[datetime] = None,
                               end_utc: Optional[datetime] = None) -> dict:
    """Sunlit vs dark time at a lunar site.

    Without `horizon`: ideal 0 deg horizon (Sun centre above 0 deg).
    With `horizon` (callable az -> terrain horizon elevation, needs sun_azimuth_deg):
    sunlit when Sun elevation > terrain horizon in the Sun's direction.
    Crossings are linearly interpolated between samples (hourly for our exports).
    """
    times = list(times)
    if not times:
        raise ValueError("empty series")
    elev = np.asarray(sun_elevation_deg, float)
    if horizon is not None:
        if sun_azimuth_deg is None:
            raise ValueError("sun_azimuth_deg is required with a terrain horizon")
        elev = elev - horizon(np.asarray(sun_azimuth_deg, float))
        model = "terrain_horizon_profile"
    else:
        model = lw.HORIZON_MODEL
    start = start_utc or times[0]
    end = end_utc or times[-1]
    try:
        lw._window_indices(times, list(elev), list(elev), start, end)
    except lw.CalculationError as exc:
        return {"data_status": exc.status, "message": str(exc)}

    lit = lw.above_horizon_intervals(times, elev.tolist(), start, end)
    total = (end - start).total_seconds() / 60
    lit_min = sum((b - a).total_seconds() for a, b in lit) / 60
    dark = []
    cur = start
    for a, b in lit:
        if a > cur:
            dark.append((cur, a))
        cur = b
    if cur < end:
        dark.append((cur, end))

    daily = {}
    for a, b in lit:
        t = a
        while t < b:
            nxt = min(b, datetime(t.year, t.month, t.day, tzinfo=timezone.utc) + timedelta(days=1))
            daily[t.date().isoformat()] = daily.get(t.date().isoformat(), 0) + (nxt - t).total_seconds() / 60
            t = nxt
    d = start.date()
    daily_rows = []
    while datetime(d.year, d.month, d.day, tzinfo=timezone.utc) < end:
        daily_rows.append({"date_utc": d.isoformat(), "sunlit_minutes": int(round(daily.get(d.isoformat(), 0)))})
        d += timedelta(days=1)

    longest = lambda ivs: max(((b - a).total_seconds() / 60 for a, b in ivs), default=0)  # noqa: E731
    return {
        "data_status": lw.OK,
        "start_utc": _iso(start), "end_utc": _iso(end),
        "horizon_model": model,
        "method": lw.METHOD,
        "sunlit_minutes": int(round(lit_min)),
        "dark_minutes": int(round(total - lit_min)),
        "sunlit_fraction": round(lit_min / total, 4),
        "longest_sunlit_minutes": int(round(longest(lit))),
        "longest_dark_minutes": int(round(longest(dark))),
        "sunlit_intervals": [{"start_utc": _iso(a), "end_utc": _iso(b),
                              "minutes": int(round((b - a).total_seconds() / 60))} for a, b in lit],
        "daily": daily_rows,
    }

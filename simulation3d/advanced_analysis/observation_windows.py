"""Recommend the best Moon-observation windows for one night.

Steps:
  1. Sample the night (local noon to next local noon) every step_minutes.
  2. Compute Moon altitude/azimuth/illumination and Sun altitude (Skyfield).
  3. Optionally add hourly cloud cover (Open-Meteo), interpolated to samples.
  4. Score each sample (visibility_scoring).
  5. Join consecutive eligible samples into windows; sharpen window edges
     caused by the Moon-altitude or Sun-altitude limits with SciPy's brentq
     root finder, so edges are exact rather than rounded to the step.
  6. Rank windows by "score-hours" (mean score x duration in hours).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

import numpy as np
from scipy.optimize import brentq
from skyfield import almanac

from calculations.sky import Observer, _altaz, _sky, _stamp

from . import weather as wx
from .visibility_scoring import Preferences, calculate_visibility, score_samples, sky_condition


def _margin_fn(obs: Observer, prefs: Preferences, t_start_tt: float):
    """Continuous constraint margin (>0 when both altitude limits pass), as f(minutes from start)."""
    ts, _ = _sky()

    def f(minutes: float) -> float:
        t = ts.tt_jd(t_start_tt + minutes / 1440)
        moon = _altaz(obs, "moon", t)[0] - prefs.min_moon_altitude_deg
        sun = prefs.max_sun_altitude_deg - _altaz(obs, "sun", t)[0]
        return float(min(moon, sun))
    return f


def recommend_windows(obs: Observer, night_of: date, prefs: Optional[Preferences] = None,
                      step_minutes: int = 5, min_duration_minutes: int = 20,
                      use_weather: bool = False,
                      cloud_source: Callable = wx.cloud_cover) -> dict:
    prefs = prefs or Preferences()
    if not 1 <= step_minutes <= 60:
        raise ValueError("step_minutes must be 1..60")
    ts, eph = _sky()
    tz = obs.tz
    start = datetime(night_of.year, night_of.month, night_of.day, 12, tzinfo=tz).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    n = int(24 * 60 / step_minutes) + 1
    minutes = np.arange(n) * step_minutes
    t = ts.from_datetimes([start + timedelta(minutes=int(m)) for m in minutes])

    moon_alt, moon_az, _ = _altaz(obs, "moon", t)
    sun_alt = _altaz(obs, "sun", t)[0]
    illum = almanac.fraction_illuminated(eph, "moon", t) * 100

    weather = {"status": "not_requested", "message": "", "source": None}
    cloud = None
    if use_weather:
        w = cloud_source(obs.latitude_deg, obs.longitude_deg, start, end)
        weather = {k: w.get(k) for k in ("status", "message", "source")}
        if w["status"] == "ok":
            wt = np.array([(x - start).total_seconds() / 60 for x in w["times"]])
            cloud = np.interp(minutes, wt, w["cloud_cover_percent"])

    s = score_samples(moon_alt, moon_az, illum, sun_alt, cloud, prefs)
    elig, score = s["eligible"], s["score"]

    # runs of eligible samples
    runs, i = [], 0
    while i < n:
        if elig[i]:
            j = i
            while j + 1 < n and elig[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1

    margin = _margin_fn(obs, prefs, t[0].tt)

    def edge(a_idx: int, b_idx: int) -> float:
        """Refine the boundary between samples a_idx and b_idx (one eligible, one not)."""
        fa, fb = margin(minutes[a_idx]), margin(minutes[b_idx])
        if fa * fb < 0:
            return brentq(margin, minutes[a_idx], minutes[b_idx], xtol=0.05)
        # boundary from a discrete constraint (azimuth, illumination, clouds): use the eligible sample
        return float(minutes[b_idx] if elig[b_idx] else minutes[a_idx])

    windows = []
    for i, j in runs:
        m0 = edge(i - 1, i) if i > 0 else float(minutes[i])
        m1 = edge(j, j + 1) if j < n - 1 else float(minutes[j])
        dur = m1 - m0
        if dur < min_duration_minutes:
            continue
        seg = score[i:j + 1]
        peak = i + int(np.argmax(moon_alt[i:j + 1]))
        windows.append({
            "start": _stamp(ts.tt_jd(t[0].tt + m0 / 1440), tz),
            "end": _stamp(ts.tt_jd(t[0].tt + m1 / 1440), tz),
            "duration_minutes": int(round(dur)),
            "mean_score": round(float(seg.mean()), 3),
            "score_hours": round(float(seg.mean()) * dur / 60, 3),
            "moon_altitude_range_deg": [round(float(moon_alt[i:j + 1].min()), 1),
                                        round(float(moon_alt[i:j + 1].max()), 1)],
            "highest_moon_at": _stamp(t[peak], tz),
            "mean_illumination_percent": round(float(illum[i:j + 1].mean()), 1),
            "mean_cloud_cover_percent": None if cloud is None else round(float(cloud[i:j + 1].mean()), 1),
        })
    windows.sort(key=lambda w: w["score_hours"], reverse=True)

    # hourly table like the planning example (time, Moon altitude, sky condition ...)
    per_hour = max(1, 60 // step_minutes)
    table = []
    for k in range(0, n, per_hour):
        table.append({
            "time": _stamp(t[k], tz),
            "moon_altitude_deg": round(float(moon_alt[k]), 1),
            "moon_azimuth_deg": round(float(moon_az[k]), 1),
            "sky_condition": sky_condition(float(sun_alt[k])),
            "illumination_percent": round(float(illum[k]), 1),
            "cloud_cover_percent": None if cloud is None else round(float(cloud[k]), 0),
            "score": round(float(score[k]), 3),
            "visibility_score": s["results"][k]["visibility_score"],
            "rating": s["results"][k]["rating"],
            "suitable_for_window": bool(elig[k]),
            "not_suitable_because": s["reasons"][k] or None,
        })

    best = windows[0] if windows else None
    return {
        "observer": obs.describe(),
        "night_of_local": night_of.isoformat(),
        "preferences": prefs.as_dict(),
        "weather": weather,
        "recommended_window": best,
        "all_windows": windows,
        "hourly": table,
        "summary": ("No suitable window this night with these preferences."
                    if best is None else
                    f"Best: {best['start']['local'][11:16]}-{best['end']['local'][11:16]} local "
                    f"({best['duration_minutes']} min, mean score {best['mean_score']})."),
        "limitations": "Flat horizon assumed; local obstructions only via azimuth_ranges. "
                       + ("Weather not included." if cloud is None else "Cloud cover is a forecast."),
    }


def visibility_at(obs: Observer, when: datetime, prefs: Optional[Preferences] = None,
                  use_weather: bool = False, cloud_source: Callable = wx.cloud_cover) -> dict:
    """Visibility score (0-100) at one moment, from Level 1 outputs (Skyfield) and optional Open-Meteo clouds."""
    prefs = prefs or Preferences()
    ts, eph = _sky()
    w_utc = when.astimezone(timezone.utc)
    t = ts.from_datetime(w_utc)
    moon_alt, moon_az, _ = (float(x) for x in _altaz(obs, "moon", t))
    sun_alt = float(_altaz(obs, "sun", t)[0])
    illum = float(almanac.fraction_illuminated(eph, "moon", t) * 100)

    weather = {"status": "not_requested", "message": "", "source": None}
    cloud = None
    if use_weather:
        w = cloud_source(obs.latitude_deg, obs.longitude_deg, w_utc - timedelta(hours=1), w_utc + timedelta(hours=1))
        weather = {k: w.get(k) for k in ("status", "message", "source")}
        if w["status"] == "ok":
            wt = np.array([(x - w_utc).total_seconds() for x in w["times"]])
            cloud = [float(np.interp(0.0, wt, w["cloud_cover_percent"]))]

    out = calculate_visibility(moon_alt, sun_alt, illum, None if cloud is None else cloud[0],
                               prefs.weights, prefs.illumination_preference, prefs.full_score_altitude_deg)
    out.update({
        "observer": obs.describe(),
        "time": _stamp(t, obs.tz),
        "moon_azimuth_deg": round(moon_az, 2),
        "sky_condition": sky_condition(sun_alt),
        "weather": weather,
        "level1_source": "calculations/sky.py (Skyfield, JPL DE440s): apparent altitude with standard refraction",
    })
    return out

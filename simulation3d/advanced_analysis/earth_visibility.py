"""Earth visibility (direct-to-Earth line of sight) from a lunar surface location.

Computes, from Horizons Earth azimuth/elevation at the site:
  * Earth elevation and azimuth over time
  * whether Earth is above the ideal 0 deg horizon
  * whether Earth clears the terrain horizon in its direction (optional profile)
  * an optional antenna elevation mask (e.g. 5 deg above the horizon)
  * visibility intervals, total and longest durations, and terrain-blocked time
  * potential direct-to-Earth (DTE) line-of-sight windows

IMPORTANT: line of sight is NOT communication availability. Real links also
depend on antenna pointing and gain, transmitter power, ground-station
schedules (e.g. Deep Space Network), and relay satellites, which are not
modeled here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Optional, Sequence

import numpy as np

from calculations import landing_windows as lw


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _intervals(times, clearance, start, end):
    """Intervals where clearance (deg) > 0, linear interpolation between samples."""
    return lw.above_horizon_intervals(times, list(clearance), start, end)


def _minutes(ivs) -> float:
    return sum((b - a).total_seconds() for a, b in ivs) / 60


def earth_visibility(times: Sequence[datetime], earth_elevation_deg: Sequence[float],
                     earth_azimuth_deg: Sequence[float], horizon: Optional[Callable] = None,
                     min_elevation_deg: float = 0.0, min_window_minutes: float = 30.0,
                     start_utc: Optional[datetime] = None, end_utc: Optional[datetime] = None) -> dict:
    times = list(times)
    el = np.asarray(earth_elevation_deg, float)
    az = np.asarray(earth_azimuth_deg, float)
    start, end = start_utc or times[0], end_utc or times[-1]
    try:
        lw._window_indices(times, list(el), list(az), start, end)
    except lw.CalculationError as exc:
        return {"data_status": exc.status, "message": str(exc)}

    terrain = horizon(az) if horizon is not None else np.zeros_like(el)
    mask = np.maximum(terrain, 0.0) if horizon is None else terrain  # terrain can sit below 0 deg
    ideal_iv = _intervals(times, el - 0.0, start, end)
    terrain_iv = _intervals(times, el - terrain, start, end)
    los_iv = _intervals(times, el - mask - min_elevation_deg, start, end)

    total = (end - start).total_seconds() / 60
    los_min = _minutes(los_iv)
    windows = [{"start_utc": _iso(a), "end_utc": _iso(b), "minutes": int(round((b - a).total_seconds() / 60))}
               for a, b in los_iv if (b - a).total_seconds() / 60 >= min_window_minutes]
    sel = [(t >= start) and (t <= end) for t in times]
    return {
        "data_status": lw.OK,
        "start_utc": _iso(start), "end_utc": _iso(end),
        "horizon_model": "terrain_horizon_profile" if horizon is not None else lw.HORIZON_MODEL,
        "min_elevation_deg": min_elevation_deg,
        "earth_visible_minutes": int(round(los_min)),
        "earth_hidden_minutes": int(round(total - los_min)),
        "visible_fraction": round(los_min / total, 4),
        "longest_visible_minutes": int(round(max(((b - a).total_seconds() / 60 for a, b in los_iv), default=0))),
        "above_ideal_horizon_minutes": int(round(_minutes(ideal_iv))),
        "blocked_by_terrain_minutes": int(round(max(_minutes(ideal_iv) - _minutes(terrain_iv), 0)))
        if horizon is not None else None,
        "earth_elevation_range_deg": [round(float(el[sel].min()), 3), round(float(el[sel].max()), 3)],
        "earth_azimuth_range_deg": [round(float(az[sel].min()), 2), round(float(az[sel].max()), 2)],
        "line_of_sight_intervals": [{"start_utc": _iso(a), "end_utc": _iso(b),
                                     "minutes": int(round((b - a).total_seconds() / 60))} for a, b in los_iv],
        "potential_dte_windows": windows,
        "min_window_minutes": min_window_minutes,
        "series": {
            "times_utc": [_iso(t) for t, k in zip(times, sel) if k],
            "earth_elevation_deg": [round(float(x), 4) for x, k in zip(el, sel) if k],
            "earth_azimuth_deg": [round(float(x), 3) for x, k in zip(az, sel) if k],
            "terrain_horizon_deg": [round(float(x), 3) for x, k in zip(terrain, sel) if k],
        },
        "important": "Line of sight is not communication availability: antenna pointing, equipment, "
                     "ground-station schedules and relay satellites are not modeled.",
    }

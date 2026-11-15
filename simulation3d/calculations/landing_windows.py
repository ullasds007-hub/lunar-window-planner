"""Ideal-horizon Sun/Earth simultaneous-visibility calculations.

Owner: Member 3 (calculations). Pure functions: no file I/O, no UI strings.

Input contract (from data_loader.py, one site):
    times        sequence of timezone-aware UTC datetimes, strictly increasing
    sun_elev     sequence of floats (deg), same length; None/NaN = missing
    earth_elev   sequence of floats (deg), same length; None/NaN = missing

Conventions (document these in docs/methodology.md):
    * A body is visible when elevation > 0 deg (strict). A sample exactly at 0
      is a boundary point with zero duration.
    * Between adjacent samples elevation is assumed to change linearly, so a
      0 deg crossing is estimated by linear interpolation.
    * Interval start/end times are rounded to the nearest whole minute, and
      every duration is computed from those rounded times, so
      total_overlap_minutes always equals the sum of the interval durations
      (and the chart shades exactly what the total reports).
    * Missing data is never treated as "below horizon": the window is
      rejected with a data_status instead.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence

METHOD = "hourly samples with linear zero-crossing interpolation"
HORIZON_MODEL = "ideal_0_degree"

# data_status values
OK = "ok"
OUT_OF_RANGE = "out_of_range"        # window not fully inside the data coverage
MISSING_DATA = "missing_data"        # gap in timestamps or a missing value in window
INVALID_INPUT = "invalid_input"      # bad arguments / misaligned series

Interval = tuple[datetime, datetime]


class CalculationError(ValueError):
    """Raised internally; converted to a data_status in public results."""

    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------
# Low-level helpers
# --------------------------------------------------------------------------

def _is_missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def _round_minute(t: datetime) -> datetime:
    return (t + timedelta(seconds=30)).replace(second=0, microsecond=0)


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_utc(t: datetime, name: str) -> datetime:
    if not isinstance(t, datetime) or t.tzinfo is None:
        raise CalculationError(INVALID_INPUT, f"{name} must be a timezone-aware UTC datetime")
    return t.astimezone(timezone.utc)


def visible_fraction(a: float, b: float) -> tuple[float, float]:
    """Part of one sample step [0, 1] where elevation > 0, given endpoint values a, b.

    Returns (f0, f1); f0 == f1 means not visible in this step.
    """
    if a > 0 and b > 0:
        return 0.0, 1.0
    if a <= 0 and b <= 0:
        return 0.0, 0.0
    crossing = -a / (b - a)  # a and b have different signs here, so b != a
    return (0.0, crossing) if a > 0 else (crossing, 1.0)


def merge_intervals(intervals: Sequence[Interval]) -> list[Interval]:
    """Merge touching/overlapping intervals and drop zero-length ones."""
    out: list[Interval] = []
    for s, e in sorted(i for i in intervals if i[1] > i[0]):
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def intersect_intervals(a: Sequence[Interval], b: Sequence[Interval]) -> list[Interval]:
    """Intersection of two sorted, merged interval lists."""
    out, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        s, e = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if e > s:
            out.append((s, e))
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return out


def above_horizon_intervals(times: Sequence[datetime], elev: Sequence[float],
                            start: datetime, end: datetime) -> list[Interval]:
    """Intervals within [start, end] where elevation > 0, using linear interpolation.

    `times`/`elev` must cover [start, end] with no missing values (checked by
    the caller via _window_indices).
    """
    pieces = []
    for k in range(len(times) - 1):
        t0, t1 = times[k], times[k + 1]
        if t1 <= start or t0 >= end:
            continue
        f0, f1 = visible_fraction(elev[k], elev[k + 1])
        if f1 > f0:
            step = t1 - t0
            s, e = t0 + step * f0, t0 + step * f1
            s, e = max(s, start), min(e, end)
            if e > s:
                pieces.append((s, e))
    return merge_intervals(pieces)


def _window_indices(times: Sequence[datetime], sun, earth,
                    start: datetime, end: datetime) -> tuple[int, int]:
    """Validate coverage and return (i0, i1) sample indices bracketing [start, end]."""
    n = len(times)
    if n < 2 or len(sun) != n or len(earth) != n:
        raise CalculationError(INVALID_INPUT, "times, sun and earth series must have equal length >= 2")
    if end <= start:
        raise CalculationError(INVALID_INPUT, "analysis window must have positive duration")
    if start < times[0] or end > times[-1]:
        raise CalculationError(
            OUT_OF_RANGE,
            f"window {_iso(start)} to {_iso(end)} is outside data coverage "
            f"{_iso(times[0])} to {_iso(times[-1])}")

    # nominal cadence = most common step in the series
    steps = [times[k + 1] - times[k] for k in range(n - 1)]
    if any(s <= timedelta(0) for s in steps):
        raise CalculationError(INVALID_INPUT, "timestamps must be strictly increasing")
    cadence = max(set(steps), key=steps.count)

    i0 = max(k for k in range(n) if times[k] <= start)
    i1 = min(k for k in range(n) if times[k] >= end)
    for k in range(i0, i1):
        if times[k + 1] - times[k] != cadence:
            raise CalculationError(
                MISSING_DATA, f"timestamp gap between {_iso(times[k])} and {_iso(times[k + 1])}")
    for k in range(i0, i1 + 1):
        if _is_missing(sun[k]) or _is_missing(earth[k]):
            raise CalculationError(MISSING_DATA, f"missing elevation value at {_iso(times[k])}")
    return i0, i1


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

def calculate_window(site_id: str, site_name: str,
                     times: Sequence[datetime], sun_elev: Sequence[float],
                     earth_elev: Sequence[float], start_utc: datetime,
                     duration_hours: float = 6.0, scenario: str = "original") -> dict:
    """Simultaneous Sun+Earth ideal-horizon visibility for one site and window.

    Returns the agreed handoff dict. On problems, data_status != "ok",
    overlap fields are None (never 0) and "message" explains why.
    """
    result = {
        "site_id": site_id,
        "site_name": site_name,
        "scenario": scenario,
        "start_utc": None,
        "end_utc": None,
        "timestamps_utc": [],
        "sun_elevation_deg": [],
        "earth_elevation_deg": [],
        "sun_visible_intervals": [],
        "earth_visible_intervals": [],
        "overlap_intervals": [],
        "total_overlap_minutes": None,
        "data_status": OK,
        "message": "",
        "method": METHOD,
        "horizon_model": HORIZON_MODEL,
    }
    try:
        start = _require_utc(start_utc, "start_utc")
        if not duration_hours or duration_hours <= 0:
            raise CalculationError(INVALID_INPUT, "duration_hours must be > 0")
        end = start + timedelta(hours=duration_hours)
        result["start_utc"], result["end_utc"] = _iso(start), _iso(end)
        times = [_require_utc(t, "times") for t in times]
        i0, i1 = _window_indices(times, sun_elev, earth_elev, start, end)
    except CalculationError as exc:
        result.update(data_status=exc.status, message=str(exc))
        return result

    sl = slice(i0, i1 + 1)
    t, s, e = times[sl], [float(v) for v in sun_elev[sl]], [float(v) for v in earth_elev[sl]]
    sun_iv = above_horizon_intervals(t, s, start, end)
    earth_iv = above_horizon_intervals(t, e, start, end)
    overlap = intersect_intervals(sun_iv, earth_iv)

    def fmt(ivs):
        rows = []
        for a, b in ivs:
            a, b = _round_minute(a), _round_minute(b)
            if b > a:
                rows.append({"start_utc": _iso(a), "end_utc": _iso(b),
                             "duration_minutes": int((b - a).total_seconds() // 60)})
        return rows

    result.update(
        timestamps_utc=[_iso(x) for x in t],
        sun_elevation_deg=s,
        earth_elevation_deg=e,
        sun_visible_intervals=fmt(sun_iv),
        earth_visible_intervals=fmt(earth_iv),
        overlap_intervals=fmt(overlap),
    )
    result["total_overlap_minutes"] = sum(r["duration_minutes"] for r in result["overlap_intervals"])
    return result


def compare_scenarios(site_id: str, site_name: str,
                      times: Sequence[datetime], sun_elev: Sequence[float],
                      earth_elev: Sequence[float], start_utc: datetime,
                      duration_hours: float = 6.0, delay_hours: float = 72.0) -> dict:
    """Original vs delayed window for one site.

    difference_minutes = delayed - original, or None if either window is not ok.
    """
    original = calculate_window(site_id, site_name, times, sun_elev, earth_elev,
                                start_utc, duration_hours, "original")
    delayed_start = (start_utc + timedelta(hours=delay_hours)
                     if isinstance(start_utc, datetime) else start_utc)
    delayed = calculate_window(site_id, site_name, times, sun_elev, earth_elev,
                               delayed_start, duration_hours, f"delayed_{delay_hours:g}h")
    both_ok = original["data_status"] == OK and delayed["data_status"] == OK
    return {
        "site_id": site_id,
        "site_name": site_name,
        "delay_hours": delay_hours,
        "original": original,
        "delayed": delayed,
        "difference_minutes": (delayed["total_overlap_minutes"] - original["total_overlap_minutes"])
        if both_ok else None,
        "data_status": OK if both_ok else (original["data_status"] if original["data_status"] != OK
                                           else delayed["data_status"]),
    }


def format_duration(minutes: Optional[int]) -> str:
    """Convenience for the UI: 214 -> '3 h 34 min'; None -> 'data unavailable'."""
    if minutes is None:
        return "data unavailable"
    sign = "-" if minutes < 0 else ""
    m = abs(int(minutes))
    return f"{sign}{m // 60} h {m % 60:02d} min"

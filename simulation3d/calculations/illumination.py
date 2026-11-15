"""Moon illuminated fraction (geocentric)."""
from datetime import datetime, timedelta, timezone

from skyfield import almanac

from .sky import _sky, _to_utc, moon_phase

__all__ = ["moon_illumination", "illumination_series"]


def moon_illumination(when: datetime) -> dict:
    """Illuminated percentage and waxing/waning at an instant."""
    p = moon_phase(when)
    return {k: p[k] for k in ("time_utc", "illumination_percent", "trend", "phase_name")}


def illumination_series(start: datetime, end: datetime, step_hours: float = 6) -> dict:
    """Illuminated percentage from start to end at a fixed step (default every 6 h)."""
    if step_hours <= 0:
        raise ValueError("step_hours must be > 0")
    ts, eph = _sky()
    s, e = _to_utc(start), _to_utc(end)
    if e <= s:
        raise ValueError("end must be after start")
    n = int((e - s) / timedelta(hours=step_hours)) + 1
    if n > 20000:
        raise ValueError("too many samples; increase step_hours")
    times = [s + timedelta(hours=step_hours * i) for i in range(n)]
    f = almanac.fraction_illuminated(eph, "moon", ts.from_datetimes(times))
    return {"times_utc": [t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") for t in times],
            "illumination_percent": [round(float(x) * 100, 2) for x in f]}

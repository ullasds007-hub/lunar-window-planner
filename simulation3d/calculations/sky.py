"""Earth-based Moon and Sun observation calculations (Skyfield + JPL DE440s).

Separate from calculations.py, which handles the lunar-surface landing windows.
This module answers: "From a place on Earth, where are the Moon and Sun, and
when is it dark enough to observe?"

All public functions return plain JSON-friendly dicts. Times are ISO 8601,
given both in UTC ("..._utc") and in the observer's local time zone
("..._local").

Conventions (document in docs/methodology.md):
  * Ephemeris: JPL DE440s via Skyfield. Downloaded once to data/ephemeris/.
  * A "day" is local midnight to the next local midnight in the observer's
    time zone (DST-aware).
  * Rise/set: Skyfield find_risings/find_settings, which use the body's
    apparent radius and standard atmospheric refraction (upper limb on a
    sea-level horizon). Terrain and observer height above the horizon are
    ignored.
  * Altitude/azimuth: apparent, topocentric, with standard refraction.
    Azimuth is measured clockwise from true north.
  * Phase: "phase_cycle_deg" is the Moon-minus-Sun geocentric ecliptic
    longitude (0 = New, 90 = First Quarter, 180 = Full, 270 = Last Quarter).
    "phase_angle_deg" is the Sun-Moon-Earth angle (180 = New, 0 = Full).
    Phase names: New/First Quarter/Full/Last Quarter within +-7.5 deg of the exact phase
    (about +-0.6 day); crescent or gibbous otherwise.
  * Twilight: Sun centre altitude thresholds -0.833 (sunrise/sunset),
    -6 (civil), -12 (nautical), -18 (astronomical).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from skyfield import almanac
from skyfield.api import Loader, wgs84

EPHEMERIS_FILE = "de440s.bsp"
EPHEMERIS_DIR = Path(os.environ.get("LWP_EPHEMERIS_DIR") or Path(__file__).resolve().parents[1] / "data" / "ephemeris")

PHASE_NAMES = [
    "New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
    "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent",
]
TWILIGHT_STATES = {
    0: "astronomical_night",
    1: "astronomical_twilight",
    2: "nautical_twilight",
    3: "civil_twilight",
    4: "day",
}


# --------------------------------------------------------------------------
# Setup
# --------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _sky():
    load = Loader(str(EPHEMERIS_DIR), verbose=False)
    eph = load(EPHEMERIS_FILE)
    ts = load.timescale(builtin=True)
    return ts, eph


@dataclass(frozen=True)
class Observer:
    """A place on Earth. Latitude north-positive, longitude east-positive."""
    latitude_deg: float
    longitude_deg: float
    elevation_m: float = 0.0
    timezone: str = "UTC"
    name: str = ""

    def __post_init__(self):
        if not -90 <= self.latitude_deg <= 90:
            raise ValueError("latitude_deg must be between -90 and 90")
        if not -180 <= self.longitude_deg <= 360:
            raise ValueError("longitude_deg must be between -180 and 360")
        ZoneInfo(self.timezone)  # raises if unknown

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def topos(self):
        return wgs84.latlon(self.latitude_deg, self.longitude_deg, elevation_m=self.elevation_m)

    def vector(self):
        _, eph = _sky()
        return eph["earth"] + self.topos

    def describe(self) -> dict:
        return {"name": self.name, "latitude_deg": self.latitude_deg,
                "longitude_deg": self.longitude_deg, "elevation_m": self.elevation_m,
                "timezone": self.timezone}


def _body(name: str):
    _, eph = _sky()
    return eph[{"moon": "moon", "sun": "sun"}[name]]


def _to_utc(when: datetime) -> datetime:
    if when.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return when.astimezone(timezone.utc)


def _t(when: datetime):
    ts, _ = _sky()
    return ts.from_datetime(_to_utc(when))


def _stamp(t, tz: ZoneInfo) -> dict:
    dt = (t.utc_datetime() + timedelta(microseconds=500_000)).replace(microsecond=0)
    return {"utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "local": dt.astimezone(tz).isoformat()}


def _local_day(obs: Observer, day: date) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, tzinfo=obs.tz)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=obs.tz)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


# --------------------------------------------------------------------------
# 1 + 2. Moon phase and illumination
# --------------------------------------------------------------------------

PRINCIPAL_WINDOW_DEG = 7.5   # +-7.5 deg of cycle (~+-0.6 day) counts as New / Quarter / Full


def phase_name(cycle_deg: float) -> str:
    """Almanac-style name: principal phases only near their exact instant, otherwise crescent/gibbous."""
    c = cycle_deg % 360
    for centre, name in ((0, "New Moon"), (90, "First Quarter"), (180, "Full Moon"), (270, "Last Quarter"), (360, "New Moon")):
        if abs(c - centre) <= PRINCIPAL_WINDOW_DEG:
            return name
    if c < 90:
        return "Waxing Crescent"
    if c < 180:
        return "Waxing Gibbous"
    if c < 270:
        return "Waning Gibbous"
    return "Waning Crescent"


def moon_phase(when: datetime) -> dict:
    """Phase name, phase angles, illuminated percentage and waxing/waning at an instant.

    Geocentric (the same for every observer on Earth to within a fraction of a percent).
    """
    _, eph = _sky()
    t = _t(when)
    cycle = float(almanac.moon_phase(eph, t).degrees) % 360
    angle = float(almanac.phase_angle(eph, "moon", t).degrees)
    illum = float(almanac.fraction_illuminated(eph, "moon", t)) * 100
    return {
        "time_utc": _stamp(t, timezone.utc)["utc"],
        "phase_name": phase_name(cycle),
        "phase_cycle_deg": round(cycle, 2),
        "phase_angle_deg": round(angle, 2),
        "illumination_percent": round(illum, 1),
        "trend": "waxing" if cycle < 180 else "waning",
        "age_fraction": round(cycle / 360, 4),
    }


def principal_phases(start: datetime, end: datetime) -> list[dict]:
    """Exact instants of New, First Quarter, Full and Last Quarter between start and end."""
    if _to_utc(end) <= _to_utc(start):
        raise ValueError("end must be after start")
    ts, eph = _sky()
    times, phases = almanac.find_discrete(_t(start), _t(end), almanac.moon_phases(eph))
    names = ["New Moon", "First Quarter", "Full Moon", "Last Quarter"]
    return [{"phase_name": names[int(p)], "time_utc": _stamp(t, timezone.utc)["utc"]}
            for t, p in zip(times, phases)]


def principal_phases_summary(start: datetime, end: datetime, tz: str = "UTC") -> dict:
    """Principal phases in [start, end] plus the nearest one before and after, so the
    answer is never just an empty list. Times are given in UTC and in `tz`."""
    zone = ZoneInfo(tz)
    s, e = _to_utc(start), _to_utc(end)
    inside = principal_phases(s, e)
    before = principal_phases(s - timedelta(days=9), s)       # phases are ~7.4 days apart
    after = principal_phases(e, e + timedelta(days=9))

    def local(row):
        t = datetime.fromisoformat(row["time_utc"].replace("Z", "+00:00"))
        return {**row, "time_local": t.astimezone(zone).isoformat()}

    if inside:
        msg = f"{len(inside)} principal phase(s) in this range."
    else:
        msg = "No principal phase (New, First Quarter, Full, Last Quarter) falls in this range."
        if before and after:
            msg += (f" The range lies between {before[-1]['phase_name']} and {after[0]['phase_name']}.")
    return {
        "range_start_utc": s.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "range_end_utc": e.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": tz,
        "phases_in_range": [local(r) for r in inside],
        "previous_phase": local(before[-1]) if before else None,
        "next_phase": local(after[0]) if after else None,
        "phase_at_start": moon_phase(s)["phase_name"],
        "message": msg,
    }


# --------------------------------------------------------------------------
# 3 + 5. Rise, set, transit, time above horizon (Moon and Sun)
# --------------------------------------------------------------------------

def _altaz(obs: Observer, body_name: str, t):
    alt, az, dist = obs.vector().at(t).observe(_body(body_name)).apparent().altaz("standard")
    return alt.degrees, az.degrees, dist.km


def _up_intervals(obs: Observer, body_name: str, t0, t1):
    """Return (risings, settings, intervals_above_horizon) inside [t0, t1].

    risings/settings: lists of Skyfield Times for events that actually occur.
    The state at t0 is inferred from the next real event (setting first =>
    already up), so it uses exactly the same horizon definition as the events.
    """
    ts, _ = _sky()
    o, b = obs.vector(), _body(body_name)
    horizon_end = ts.tt_jd(t1.tt + 2.0)
    rt, ry = almanac.find_risings(o, b, t0, horizon_end)
    st, sy = almanac.find_settings(o, b, t0, horizon_end)
    events = sorted([(float(t.tt), 1, t) for t, ok in zip(rt, ry) if ok] +
                    [(float(t.tt), 0, t) for t, ok in zip(st, sy) if ok])

    if events:
        up = events[0][1] == 0
    else:  # never rises or never sets in the next days: polar day/night, circumpolar Moon
        up = bool(_altaz(obs, body_name, t0)[0] > 0)

    intervals, cur_start = [], (t0 if up else None)
    for tt, kind, t in events:
        if tt >= t1.tt:
            break
        if kind == 1 and cur_start is None:
            cur_start = t
        elif kind == 0 and cur_start is not None:
            intervals.append((cur_start, t))
            cur_start = None
    if cur_start is not None:
        intervals.append((cur_start, t1))

    in_window = lambda t: t0.tt <= t.tt < t1.tt  # noqa: E731
    rises = [t for _, k, t in events if k == 1 and in_window(t)]
    sets = [t for _, k, t in events if k == 0 and in_window(t)]
    return rises, sets, intervals, up


def rise_set_transit(obs: Observer, body_name: str, day: date) -> dict:
    """Rise, set and upper transit of "moon" or "sun" on a local calendar day.

    Rise or set may be missing on a given day (the Moon skips roughly one rise
    and one set each month; polar day/night for the Sun). In that case the
    value is None and "note" explains why.
    """
    ts, _ = _sky()
    s, e = _local_day(obs, day)
    t0, t1 = ts.from_datetime(s), ts.from_datetime(e)
    tz = obs.tz
    rises, sets, intervals, up_at_start = _up_intervals(obs, body_name, t0, t1)
    transits = almanac.find_transits(obs.vector(), _body(body_name), t0, t1)

    above = sum((b.tt - a.tt) for a, b in intervals) * 1440
    notes = []
    if not rises and not sets:
        notes.append(f"{body_name} {'stays above' if up_at_start else 'stays below'} the horizon all day")
    else:
        if not rises:
            notes.append(f"no {body_name}rise on this local date")
        if not sets:
            notes.append(f"no {body_name}set on this local date")

    tr = None
    if len(transits):
        t = transits[0]
        tr = {**_stamp(t, tz), "altitude_deg": round(float(_altaz(obs, body_name, t)[0]), 2)}

    return {
        "body": body_name,
        "date_local": day.isoformat(),
        "rise": [_stamp(t, tz) for t in rises] or None,
        "set": [_stamp(t, tz) for t in sets] or None,
        "transit": tr,
        "above_horizon_minutes": int(round(above)),
        "above_horizon_intervals": [{"start": _stamp(a, tz), "end": _stamp(b, tz)} for a, b in intervals],
        "note": "; ".join(notes),
    }


# --------------------------------------------------------------------------
# 4 + 5. Altitude/azimuth time series (for the Charts module)
# --------------------------------------------------------------------------

def position_series(obs: Observer, body_name: str, start: datetime, end: datetime,
                    step_minutes: int = 10) -> dict:
    """Altitude and azimuth of "moon" or "sun" at a fixed step, start to end inclusive."""
    if step_minutes <= 0:
        raise ValueError("step_minutes must be > 0")
    ts, _ = _sky()
    s, e = _to_utc(start), _to_utc(end)
    if e <= s:
        raise ValueError("end must be after start")
    n = int((e - s).total_seconds() // (step_minutes * 60)) + 1
    if n > 20000:
        raise ValueError("too many samples; increase step_minutes")
    t = ts.from_datetimes([s + timedelta(minutes=step_minutes * i) for i in range(n)])
    alt, az, dist = _altaz(obs, body_name, t)
    out = {
        "body": body_name,
        "step_minutes": step_minutes,
        "times_utc": [x.strftime("%Y-%m-%dT%H:%M:%SZ") for x in t.utc_datetime()],
        "altitude_deg": np.round(alt, 3).tolist(),
        "azimuth_deg": np.round(az, 3).tolist(),
        "distance_km": np.round(dist, 0).tolist(),
    }
    if body_name == "moon":
        _, eph = _sky()
        out["illumination_percent"] = np.round(
            almanac.fraction_illuminated(eph, "moon", t) * 100, 2).tolist()
    return out


def position_at(obs: Observer, body_name: str, when: datetime) -> dict:
    alt, az, dist = _altaz(obs, body_name, _t(when))
    return {"body": body_name, "time_utc": _to_utc(when).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "altitude_deg": round(float(alt), 3), "azimuth_deg": round(float(az), 3),
            "distance_km": round(float(dist))}


# --------------------------------------------------------------------------
# 6. Twilight and darkness
# --------------------------------------------------------------------------

def twilight_periods(obs: Observer, day: date) -> dict:
    """Day / civil / nautical / astronomical twilight / night intervals on a local day,
    plus "moon-free dark" intervals: astronomical night while the Moon is below the horizon.
    """
    ts, eph = _sky()
    s, e = _local_day(obs, day)
    t0, t1 = ts.from_datetime(s), ts.from_datetime(e)
    tz = obs.tz
    f = almanac.dark_twilight_day(eph, obs.topos)
    times, states = almanac.find_discrete(t0, t1, f)

    bounds = [t0] + list(times) + [t1]
    state_seq = [int(f(t0))] + [int(x) for x in states]
    periods, totals = [], {v: 0 for v in TWILIGHT_STATES.values()}
    for a, b, st in zip(bounds[:-1], bounds[1:], state_seq):
        if b.tt <= a.tt:
            continue
        name = TWILIGHT_STATES[st]
        mins = (b.tt - a.tt) * 1440
        totals[name] += mins
        periods.append({"state": name, "start": _stamp(a, tz), "end": _stamp(b, tz),
                        "minutes": int(round(mins))})

    # astronomical night minus Moon-up time
    night = [(a.tt, b.tt) for a, b, st in zip(bounds[:-1], bounds[1:], state_seq) if st == 0 and b.tt > a.tt]
    _, _, moon_up, _ = _up_intervals(obs, "moon", t0, t1)
    moon_up = [(a.tt, b.tt) for a, b in moon_up]
    dark = []
    for ns, ne in night:
        cur = ns
        for ms, me in sorted(moon_up):
            if me <= cur or ms >= ne:
                continue
            if ms > cur:
                dark.append((cur, ms))
            cur = max(cur, me)
        if cur < ne:
            dark.append((cur, ne))
    dark_out = [{"start": _stamp(ts.tt_jd(a), tz), "end": _stamp(ts.tt_jd(b), tz),
                 "minutes": int(round((b - a) * 1440))} for a, b in dark if b > a]

    return {
        "date_local": day.isoformat(),
        "periods": periods,
        "minutes_by_state": {k: int(round(v)) for k, v in totals.items()},
        "moon_free_dark_intervals": dark_out,
        "moon_free_dark_minutes": sum(d["minutes"] for d in dark_out),
    }


# --------------------------------------------------------------------------
# Combined daily report
# --------------------------------------------------------------------------

def daily_report(obs: Observer, day: date, step_minutes: int = 10) -> dict:
    """Everything for one local day, in one dict for the API / UI."""
    s, e = _local_day(obs, day)
    local_midnight = datetime(day.year, day.month, day.day, tzinfo=obs.tz)
    return {
        "observer": obs.describe(),
        "date_local": day.isoformat(),
        "ephemeris": "JPL DE440s via Skyfield",
        "moon_phase_at_local_midnight": moon_phase(local_midnight),
        "moon_phase_at_local_noon": moon_phase(local_midnight + timedelta(hours=12)),
        "moon": rise_set_transit(obs, "moon", day),
        "sun": rise_set_transit(obs, "sun", day),
        "twilight": twilight_periods(obs, day),
        "moon_series": position_series(obs, "moon", s, e, step_minutes),
        "sun_series": position_series(obs, "sun", s, e, step_minutes),
    }

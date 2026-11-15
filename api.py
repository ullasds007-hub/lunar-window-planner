"""FastAPI wrapper around moon_observation.py.

Run:  uvicorn api:app --reload
Docs: http://127.0.0.1:8000/docs
"""
from datetime import date, datetime, timezone
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi.staticfiles import StaticFiles

from fastapi import Depends, FastAPI, HTTPException, Query

import moon_observation as mo

app = FastAPI(title="Lunar Window Planner - Moon observation API",
              description="Moon and Sun positions, phases, rise/set and twilight for an observer on Earth "
                          "(JPL DE440s via Skyfield). Datetimes must include a UTC offset, e.g. 2026-11-14T12:00:00Z.")

Body = Literal["moon", "sun"]


def observer(lat: float = Query(..., ge=-90, le=90, description="Latitude, north positive"),
             lon: float = Query(..., ge=-180, le=360, description="Longitude, east positive"),
             elevation_m: float = 0.0,
             tz: str = Query("UTC", description="IANA time zone, e.g. Asia/Kolkata"),
             name: str = "") -> mo.Observer:
    try:
        return mo.Observer(lat, lon, elevation_m, tz, name)
    except Exception as exc:
        raise HTTPException(400, f"invalid observer: {exc}")


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
    v = value.strip().replace(" ", "T", 1)
    if v.endswith(("Z", "z")):
        v = v[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        raise HTTPException(400, f"could not read time {value!r}. {TIME_HELP}")
    return dt if dt.tzinfo else dt.replace(tzinfo=zone)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/moon/phase")
def moon_phase(time: str | None = Query(None, description=TIME_HELP + " Empty = now.",
                                        examples=["2026-11-14 18:00"]),
               tz: str = Query("UTC", description="Time zone for times without an offset, e.g. Asia/Kolkata")):
    return _call(mo.moon_phase, parse_time(time, tz))


@app.get("/moon/principal-phases")
def principal_phases(start: str = Query(..., description=TIME_HELP, examples=["2026-11-01"]),
                     end: str = Query(..., description=TIME_HELP, examples=["2026-12-01"]),
                     tz: str = "UTC"):
    return _call(mo.principal_phases, parse_time(start, tz), parse_time(end, tz))


@app.get("/{body}/rise-set")
def rise_set(body: Body, day: date, obs: mo.Observer = Depends(observer)):
    return _call(mo.rise_set_transit, obs, body, day)


@app.get("/{body}/positions")
def positions(body: Body,
              start: str = Query(..., description=TIME_HELP, examples=["2026-11-14 00:00"]),
              end: str = Query(..., description=TIME_HELP, examples=["2026-11-15 00:00"]),
              step_minutes: int = Query(10, gt=0),
              obs: mo.Observer = Depends(observer)):
    return _call(mo.position_series, obs, body, parse_time(start, obs.timezone),
                 parse_time(end, obs.timezone), step_minutes)


@app.get("/twilight")
def twilight(day: date, obs: mo.Observer = Depends(observer)):
    return _call(mo.twilight_periods, obs, day)


@app.get("/report")
def report(day: date, step_minutes: int = Query(10, gt=0), obs: mo.Observer = Depends(observer)):
    return _call(mo.daily_report, obs, day, step_minutes)

from datetime import time, timedelta
from pathlib import Path
from fastapi.responses import FileResponse
from skyfield import almanac

@app.get('/', include_in_schema=False)
def website():
    return FileResponse(Path(__file__).with_name('index.html'))

@app.get('/windows')
def windows(locationId: str, startDate: date, endDate: date, goal: str):
    def error(code, message):
        return {'status':'error','error':{'code':code,'message':message}}
    if locationId != 'mysuru':
        return error('UNKNOWN_LOCATION','Choose Mysuru.')
    if goal not in ('moon_viewing','dark_sky'):
        return error('INVALID_GOAL','Choose Moon viewing or Dark sky.')
    days = (endDate-startDate).days+1
    if days < 1:
        return error('INVALID_DATE_RANGE','Last night cannot be before the first.')
    if days > 31:
        return error('RANGE_TOO_LONG','Choose up to 31 nights.')
    zone = ZoneInfo('Asia/Kolkata')
    try:
        ts, eph = mo._sky()
        observer = mo.Observer(12.2958,76.6394,0,'Asia/Kolkata').vector()
        def qualifies(t):
            at = observer.at(t)
            moon = at.observe(eph['moon']).apparent().altaz()[0].degrees
            sun = at.observe(eph['sun']).apparent().altaz()[0].degrees
            return (moon >= 10) & (sun <= -6) if goal == 'moon_viewing' else (moon < 0) & (sun <= -18)
        qualifies.step_days = 1/1440
        rows = []
        for i in range(days):
            night = startDate+timedelta(days=i)
            a = datetime.combine(night,time(12),zone)
            b = datetime.combine(night+timedelta(days=1),time(12),zone)
            t0,t1 = map(ts.from_datetime,(a,b))
            changes, states = almanac.find_discrete(t0,t1,qualifies)
            opened = a if qualifies(t0) else None
            seq = 0
            for point,on in [*(zip(changes.utc_datetime(),states)),(b,False)]:
                if on:
                    opened = point
                elif opened is not None:
                    if point > opened:
                        seq += 1
                        rows.append(dict(id=f'{night}-{seq}',date=str(night),start=opened.astimezone(zone).isoformat(),end=point.astimezone(zone).isoformat(),score=None))
                    opened = None
        best = max(rows,key=lambda w: datetime.fromisoformat(w['end'])-datetime.fromisoformat(w['start']),default=None)
        return dict(status='ok',result=dict(timeZone=zone.key,bestWindowId=best['id'] if best else None,windows=rows))
    except Exception:
        import logging
        logging.exception('Window calculation failed')
        return error('CALCULATION_FAILED','Could not calculate windows. Check the server log and retry.')
app.mount(
    "/user-guide",
    StaticFiles(directory=Path(__file__).resolve().parent / "user-guide", html=True),
    name="user-guide",
)
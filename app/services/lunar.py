"""Smooth-horizon lunar elevation and window calculations."""
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "lunar-surface" / "lunar-surface-live"
DATA_FILES = (
    DATA_DIR / "data" / "ephemeris" / "de440s.bsp",
    DATA_DIR / "moon_080317.tf",
    DATA_DIR / "pck00008.tpc",
    DATA_DIR / "moon_pa_de421_1900-2050.bpc",
)


class LunarDataUnavailable(RuntimeError):
    """A required model input is not installed."""


@lru_cache(maxsize=1)
def model():
    missing = [path.name for path in DATA_FILES if not path.is_file()]
    if missing:
        raise LunarDataUnavailable("Required astronomy files are missing. Run python prepare_combined.py.")
    from skyfield.api import Loader, PlanetaryConstants, load_file

    load = Loader(str(DATA_DIR))
    ts=load.timescale()
    eph=load_file(str(DATA_FILES[0]))
    pc=PlanetaryConstants()
    pc.read_text(load('moon_080317.tf'))
    pc.read_text(load('pck00008.tpc'))
    pc.read_binary(load('moon_pa_de421_1900-2050.bpc'))
    return ts,eph,pc,pc.build_frame_named('MOON_ME_DE421')

def calculate_windows(start: datetime, end: datetime, lat: float, lon: float, profile: bool = False):
    if start.utcoffset() is None or end.utcoffset() is None:
        raise ValueError("Include a UTC offset for both dates.")
    a, b = (dt.astimezone(timezone.utc) for dt in (start, end))
    if not (0 < (b-a).total_seconds() <= 60*86400 and 1901 <= a.year <= b.year <= 2049):
        raise ValueError("Choose a date range of up to 60 days within 1901–2049.")
    ts,eph,pc,frame=model()
    from skyfield.almanac import find_discrete
    site=eph['moon']+pc.build_latlon_degrees(frame,lat,lon)
    t0,t1=map(ts.from_datetime,(a,b))
    def state(t):
        here=site.at(t)
        sun=here.observe(eph['sun']).apparent().altaz()[0].degrees>0
        earth=here.observe(eph['earth']).apparent().altaz()[0].degrees>0
        return sun.astype(int)+2*earth.astype(int)
    state.step_days=1/144
    times,values=find_discrete(t0,t1,state)
    rows=[[],[],[],[]]; left=a; flag=int(state(t0))
    for right,next_flag in [*zip(times.utc_datetime(),values),(b,0)]:
        right=min(right,b)
        if right>left:
            for row,on in zip(rows,(flag&1,not flag&1,flag&2,flag==3)):
                if on:
                    s,z=left.isoformat(),right.isoformat()
                    if row and row[-1][1]==s: row[-1][1]=z
                    else: row.append([s,z])
            left=right
        flag=int(next_flag)
    result = {'rows': rows}
    if profile:
        count = 241
        dates = [a + (b-a)*i/(count-1) for i in range(count)]
        here = site.at(ts.from_datetimes(dates))
        sun = here.observe(eph['sun']).apparent().altaz()[0].degrees
        earth = here.observe(eph['earth']).apparent().altaz()[0].degrees
        result['profile'] = [[d.isoformat(), float(s), float(e)]
                             for d,s,e in zip(dates,sun,earth)]
    return result


def _utc_range(start: datetime, end: datetime):
    if start.utcoffset() is None or end.utcoffset() is None:
        raise ValueError("Include a UTC offset for both dates.")
    a, b = (dt.astimezone(timezone.utc) for dt in (start, end))
    if not (0 < (b-a).total_seconds() <= 60*86400 and 1901 <= a.year <= b.year <= 2049):
        raise ValueError("Choose a date range of up to 60 days within 1901–2049.")
    return a, b


def _sample_times(a, b, samples):
    samples = max(2, min(int(samples), 2000))
    return [a + (b-a)*i/(samples-1) for i in range(samples)]


def sky_track(start: datetime, end: datetime, lat: float, lon: float, samples: int = 0):
    """Sun and Earth azimuth/elevation (deg) at a lunar site, smooth horizon, same frame as the windows.

    Default sampling: hourly (capped at 2000 points)."""
    a, b = _utc_range(start, end)
    ts, eph, pc, frame = model()
    dates = _sample_times(a, b, samples or (b-a).total_seconds()/3600 + 1)
    site = eph['moon'] + pc.build_latlon_degrees(frame, lat, lon)
    here = site.at(ts.from_datetimes(dates))
    s_alt, s_az, _ = here.observe(eph['sun']).apparent().altaz()
    e_alt, e_az, _ = here.observe(eph['earth']).apparent().altaz()
    r = lambda arr: [round(float(v), 5) for v in arr]  # noqa: E731
    return {"times": [d.isoformat() for d in dates], "sun_az": r(s_az.degrees), "sun_el": r(s_alt.degrees),
            "earth_az": r(e_az.degrees), "earth_el": r(e_alt.degrees),
            "model": "Skyfield DE440s, MOON_ME_DE421 frame, smooth horizon (same as surface-windows)"}


def subpoints(start: datetime, end: datetime, samples: int = 0):
    """Sub-solar and sub-Earth points on the Moon (MOON_ME_DE421 lon/lat, deg) for lighting a 3D globe."""
    a, b = _utc_range(start, end)
    ts, eph, pc, frame = model()
    dates = _sample_times(a, b, samples or (b-a).total_seconds()/3600 + 1)
    t = ts.from_datetimes(dates)
    out = {"times": [d.isoformat() for d in dates]}
    for name in ("sun", "earth"):
        lat, lon, _ = (eph[name] - eph['moon']).at(t).frame_latlon(frame)
        out[f"sub_{'solar' if name == 'sun' else 'earth'}_lat"] = [round(float(v), 5) for v in lat.degrees]
        out[f"sub_{'solar' if name == 'sun' else 'earth'}_lon"] = [round(float(v) % 360, 5) for v in lon.degrees]
    out["model"] = "Skyfield DE440s, MOON_ME_DE421 frame (geometric directions from the Moon's centre)"
    return out

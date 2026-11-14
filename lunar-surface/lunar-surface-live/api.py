from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from skyfield.api import Loader, load_file, PlanetaryConstants
from skyfield.almanac import find_discrete
from functools import lru_cache
app=FastAPI()
ROOT=Path(__file__).resolve().parent
load = Loader(str(ROOT))
@lru_cache(maxsize=1)
def model():
    ts=load.timescale()
    eph=load_file(str(ROOT/'data/ephemeris/de440s.bsp'))
    pc=PlanetaryConstants()
    pc.read_text(load('moon_080317.tf'))
    pc.read_text(load('pck00008.tpc'))
    pc.read_binary(load('moon_pa_de421_1900-2050.bpc'))
    return ts,eph,pc,pc.build_frame_named('MOON_ME_DE421')
@app.get('/')
def home():
    return FileResponse(ROOT/'index.html')
@app.get('/surface-windows')
def windows(start:datetime,end:datetime,lat:float=Query(ge=-90,le=90),lon:float=Query(ge=-180,le=180)):
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(400,'Include UTC offsets.')
    a,b=[x.astimezone(timezone.utc) for x in (start,end)]
    if not (0<(b-a).total_seconds()<=60*86400 and 1901<=a.year<=b.year<=2049):
        raise HTTPException(400,'Choose up to 60 days within 1901–2049.')
    try:
        ts,eph,pc,frame=model()
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
        return {'rows':rows}
    except Exception as exc:
        raise HTTPException(503,f'Lunar model could not run: {exc}') from exc

"""Combined planner entry point."""
import os
import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from api import app as earth
from app.routers.lunar import create_lunar_app

ROOT = Path(__file__).resolve().parents[1]


def create_simulation_app():
    """3D simulation (simulation3d/), served at /sim/app/. Uses the same de440s.bsp as the planners."""
    sim_dir = ROOT / "simulation3d"
    os.environ.setdefault("LWP_EPHEMERIS_DIR", str(ROOT / "data" / "ephemeris"))
    if str(sim_dir) not in sys.path:
        sys.path.append(str(sim_dir))          # appended: never shadows the planners' own modules
    from sim_api.main import app as simulation
    return simulation

def create_app():
    app = FastAPI(title="Lunar Window Planner")

    @app.get("/", include_in_schema=False)
    def home():
        return FileResponse(ROOT / "app" / "templates" / "home.html", headers={"Cache-Control": "no-cache"})

    @app.get("/earth", include_in_schema=False)
    def observe():
        return FileResponse(ROOT / "app" / "templates" / "earth.html", headers={"Cache-Control": "no-cache"})

    app.mount("/lunar-surface", create_lunar_app())
    app.mount("/sim", create_simulation_app())
    app.mount("/", earth)
    return app

app = create_app()

"""Combined planner entry point."""
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from api import app as earth
from app.routers.lunar import create_lunar_app

ROOT = Path(__file__).resolve().parents[1]

def create_app():
    app = FastAPI(title="Lunar Window Planner")

    @app.get("/", include_in_schema=False)
    def home():
        return FileResponse(ROOT / "app" / "templates" / "home.html", headers={"Cache-Control": "no-cache"})

    @app.get("/earth", include_in_schema=False)
    def observe():
        return FileResponse(ROOT / "app" / "templates" / "earth.html", headers={"Cache-Control": "no-cache"})

    app.mount("/lunar-surface", create_lunar_app())
    from simulation3d.sim_api.main import app as simulation

    app.mount("/sim", simulation)
    app.mount("/", earth)
    return app

app = create_app()

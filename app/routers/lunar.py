"""HTTP and page routes for the lunar-surface planner."""
from datetime import datetime
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.services import lunar

PACKAGE = Path(__file__).resolve().parents[1]
logger = logging.getLogger(__name__)


def create_lunar_app() -> FastAPI:
    surface = FastAPI(title="Lunar Surface Planner")
    surface.mount("/assets", StaticFiles(directory=PACKAGE / "static"), name="lunar-assets")

    @surface.get("/", include_in_schema=False)
    def home():
        return FileResponse(PACKAGE / "templates" / "site.html", headers={"Cache-Control": "no-cache"})

    @surface.get("/compare", include_in_schema=False)
    def compare_page():
        return FileResponse(PACKAGE / "templates" / "compare.html", headers={"Cache-Control": "no-cache"})

    @surface.get("/surface-windows")
    def windows(start: datetime, end: datetime,
                lat: float = Query(ge=-90, le=90),
                lon: float = Query(ge=-180, le=180),
                profile: bool = False):
        try:
            return lunar.calculate_windows(start, end, lat, lon, profile)
        except lunar.LunarDataUnavailable as exc:
            logger.warning("Lunar data not installed")
            raise HTTPException(503, "The lunar calculation engine is not ready.") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            logger.exception("Lunar window calculation failed")
            raise HTTPException(500, "The lunar calculation failed. Try again later.") from exc

    return surface

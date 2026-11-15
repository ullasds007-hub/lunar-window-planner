"""Serve the Earth and lunar-surface planners on the same port."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from api import app

surface_file = (
    Path(__file__).resolve().parent
    / "lunar-surface" / "lunar-surface-live" / "api.py"
)
spec = spec_from_file_location("lunar_surface_backend", surface_file)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load the lunar-surface backend: {surface_file}")

surface = module_from_spec(spec)
spec.loader.exec_module(surface)
app.mount("/lunar-surface", surface.app, name="lunar-surface")


# Keep existing Earth endpoints and the mounted lunar planner. Only the
# combined homepage changes; the original Earth entry point still works.
from fastapi.responses import FileResponse

_root = Path(__file__).resolve().parent

@app.get("/earth", include_in_schema=False)
def earth_page():
    return FileResponse(_root / "index.html")

@app.get("/", include_in_schema=False)
def landing_page():
    return FileResponse(_root / "landing.html")

# The original Earth homepage was registered first. Give the new route priority.
app.router.routes.insert(0, app.router.routes.pop())

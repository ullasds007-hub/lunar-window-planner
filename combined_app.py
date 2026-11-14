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

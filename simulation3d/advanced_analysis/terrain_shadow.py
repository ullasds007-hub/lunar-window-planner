"""Terrain shadow and darkness estimation on a digital elevation model (DEM).

STATUS: algorithm implemented and tested on synthetic terrain only. It has NOT
been run or validated on real LOLA data yet. Do not present results as
terrain-validated until a LOLA tile has been loaded and checked against
published illumination maps (e.g. LOLA/LRO south-pole illumination products).

Grid conventions (important when feeding real data):
  * dem[row, col] = elevation in metres; row 0 is the TOP of the grid.
  * pixel_m = ground size of one pixel in metres (square pixels).
  * "grid azimuth" = degrees clockwise from grid-up (decreasing row).
    On a polar stereographic LOLA tile, grid-up is NOT local north and the
    offset varies across the tile. Convert the Sun's local azimuth to grid
    azimuth for the chosen projection before calling these functions.
  * Lunar curvature is included: a point at distance d drops by d^2 / (2R),
    R = 1737.4 km.
"""
from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np
from scipy.ndimage import map_coordinates

MOON_RADIUS_M = 1_737_400.0


def slope_aspect(dem: np.ndarray, pixel_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Slope (deg from horizontal) and aspect (grid azimuth the slope faces, downhill; NaN when flat)."""
    dem = np.asarray(dem, float)
    dz_drow, dz_dcol = np.gradient(dem, pixel_m)
    slope = np.degrees(np.arctan(np.hypot(dz_drow, dz_dcol)))
    # downhill vector in (east=+col, up=-row) components
    east, up = -dz_dcol, dz_drow
    aspect = np.degrees(np.arctan2(east, up)) % 360
    aspect[np.hypot(east, up) < 1e-12] = np.nan
    return slope, aspect


def _direction(grid_azimuth_deg: float) -> tuple[float, float]:
    a = np.radians(grid_azimuth_deg)
    return -np.cos(a), np.sin(a)  # (d_row, d_col) per pixel step


def horizon_profile(dem: np.ndarray, pixel_m: float, row: int, col: int,
                    azimuths_deg: Sequence[float] = tuple(range(0, 360, 2)),
                    max_distance_m: float = 50_000.0, observer_height_m: float = 0.0) -> dict:
    """Terrain horizon elevation angle around one DEM pixel.

    Returns per-azimuth horizon elevation (deg) and whether the ray reached the
    DEM edge before max_distance_m (horizon then possibly underestimated).
    """
    dem = np.asarray(dem, float)
    z0 = dem[row, col] + observer_height_m
    n = int(max_distance_m // pixel_m)
    steps = np.arange(1, n + 1, dtype=float)
    d = steps * pixel_m
    drop = d ** 2 / (2 * MOON_RADIUS_M)
    elev, truncated = [], []
    for az in azimuths_deg:
        dr, dc = _direction(az)
        r, c = row + dr * steps, col + dc * steps
        inside = (r >= 0) & (r <= dem.shape[0] - 1) & (c >= 0) & (c <= dem.shape[1] - 1)
        if not inside.any():
            elev.append(-90.0)
            truncated.append(True)
            continue
        z = map_coordinates(dem, [r[inside], c[inside]], order=1)
        ang = np.degrees(np.arctan2(z - z0 - drop[inside], d[inside]))
        elev.append(float(max(ang.max(), -90.0)))
        truncated.append(not inside.all())
    return {"azimuths_deg": list(map(float, azimuths_deg)), "horizon_elevation_deg": elev,
            "truncated_by_dem_edge": truncated, "azimuth_frame": "grid"}


def shadow_map(dem: np.ndarray, pixel_m: float, sun_elevation_deg: float, sun_grid_azimuth_deg: float,
               max_distance_m: float = 20_000.0) -> dict:
    """Which pixels see the Sun's centre over the terrain.

    lit[r, c] is True when no terrain toward the Sun rises above the Sun's
    elevation. Pixels whose ray leaves the DEM early are flagged "uncertain"
    (terrain outside the tile could still shadow them).
    """
    dem = np.asarray(dem, float)
    rows, cols = np.indices(dem.shape, dtype=float)
    dr, dc = _direction(sun_grid_azimuth_deg)
    max_angle = np.full(dem.shape, -np.inf)
    reached_edge = np.zeros(dem.shape, bool)
    for k in range(1, int(max_distance_m // pixel_m) + 1):
        r, c = rows + dr * k, cols + dc * k
        inside = (r >= 0) & (r <= dem.shape[0] - 1) & (c >= 0) & (c <= dem.shape[1] - 1)
        reached_edge |= ~inside
        if not inside.any():
            break
        d = k * pixel_m
        z = map_coordinates(dem, [np.clip(r, 0, dem.shape[0] - 1), np.clip(c, 0, dem.shape[1] - 1)], order=1)
        ang = np.degrees(np.arctan2(z - dem - d * d / (2 * MOON_RADIUS_M), d))
        max_angle = np.where(inside, np.maximum(max_angle, ang), max_angle)
    lit = max_angle < sun_elevation_deg
    return {"lit": lit, "uncertain": reached_edge & lit, "lit_fraction": float(lit.mean()),
            "max_terrain_angle_deg": max_angle}


def permanent_shadow(dem: np.ndarray, pixel_m: float,
                     sun_positions: Iterable[tuple[float, float]],
                     max_distance_m: float = 20_000.0) -> dict:
    """Pixels shadowed for every (sun_elevation_deg, sun_grid_azimuth_deg) given.

    With sun positions sampled over a full lunar year (precession cycle for a
    rigorous answer), this approximates Permanently Shadowed Regions (PSRs).
    Also returns the fraction of the given Sun positions that light each pixel.
    """
    count, total = None, 0
    for elev, az in sun_positions:
        lit = shadow_map(dem, pixel_m, elev, az, max_distance_m)["lit"]
        count = lit.astype(int) if count is None else count + lit
        total += 1
    if not total:
        raise ValueError("no sun positions given")
    return {"permanently_shadowed": count == 0, "lit_fraction_of_positions": count / total,
            "positions_used": total}

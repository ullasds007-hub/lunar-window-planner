"""Lunar terrain data from LROC's public WMS server (wms.im-ldi.com).

This is the map server behind LROC QuickMap (https://quickmap.lroc.asu.edu).
QuickMap itself has no documented data API; its WMS returns numeric rasters
(32-bit TIFF) and answers point queries (GetFeatureInfo) for vector layers.

Used here:
  luna_wac_dtm_numeric_meters_absolute  LROC WAC GLD100-derived topography, metres
                                        from the Moon's centre (radius). GLD100's
                                        nominal coverage is 79S-79N, so values at
                                        the pole come from the server's polar fill
                                        and are NOT verified against LOLA here.
  luna_psr_81s                          LOLA permanently shadowed regions, 90S-81S
                                        (Mazarico et al. 2011), polygons >= ~10 km^2

Moon Trek (trek.nasa.gov) was checked as well: it serves picture tiles (WMTS
PNG/JPG) only, with no numeric point data, so it is not used for calculations.
"""
from __future__ import annotations

import io
import math
import re
import urllib.parse
import urllib.request
from typing import Callable

import numpy as np

WMS = "https://wms.im-ldi.com/"
DTM_LAYER = "luna_wac_dtm_numeric_meters_absolute"
PSR_LAYER = "luna_psr_81s"
MOON_REFERENCE_RADIUS_M = 1_737_400.0
QUICKMAP = "https://quickmap.lroc.asu.edu"


def _http_get(url: str, timeout: float) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-window-planner/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")


def _bbox(lat: float, lon: float, half_m: float) -> tuple[float, float, float, float, float, float]:
    """Lon/lat box of +-half_m metres around a point; returns bbox + metres per degree lon/lat."""
    m_per_deg_lat = math.pi * MOON_REFERENCE_RADIUS_M / 180
    m_per_deg_lon = m_per_deg_lat * max(math.cos(math.radians(lat)), 1e-6)
    dlat, dlon = half_m / m_per_deg_lat, min(half_m / m_per_deg_lon, 179.0)
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat, m_per_deg_lon, m_per_deg_lat


def _wms_url(**kw) -> str:
    base = {"SERVICE": "WMS", "VERSION": "1.1.1", "SRS": "EPSG:4326", "STYLES": ""}
    return WMS + "?" + urllib.parse.urlencode(base | kw)


def terrain_at(lat: float, east_lon: float, half_window_m: float = 600.0, pixels: int = 13,
               timeout: float = 60.0, get: Callable = _http_get) -> dict:
    """Height (m above the 1737.4 km sphere), local slope and relief around a lunar point."""
    from PIL import Image  # pillow decodes the 32-bit float TIFF

    if pixels % 2 == 0 or pixels < 3:
        raise ValueError("pixels must be odd and >= 3")
    x0, y0, x1, y1, mlon, mlat = _bbox(lat, east_lon, half_window_m)
    url = _wms_url(REQUEST="GetMap", LAYERS=DTM_LAYER, BBOX=f"{x0},{y0},{x1},{y1}",
                   WIDTH=pixels, HEIGHT=pixels, FORMAT="image/tiff; mode=32bit")
    body, ctype = get(url, timeout)
    if "tiff" not in ctype:
        raise ValueError(f"LROC WMS did not return elevation data: {body[:200]!r}")
    radius = np.array(Image.open(io.BytesIO(body)), dtype=float)
    if radius.shape != (pixels, pixels) or not np.isfinite(radius).all() or radius.min() < 1.70e6:
        raise ValueError("LROC WMS elevation tile has missing or invalid values")
    h = radius - MOON_REFERENCE_RADIUS_M
    dx = (x1 - x0) * mlon / pixels   # metres per pixel, east-west
    dy = (y1 - y0) * mlat / pixels   # metres per pixel, north-south
    dz_dy, dz_dx = np.gradient(h, dy, dx)
    c = pixels // 2
    slope = math.degrees(math.atan(math.hypot(dz_dx[c, c], dz_dy[c, c])))
    return {
        "latitude_deg": lat, "east_longitude_deg": east_lon,
        "height_m": round(float(h[c, c]), 1),
        "height_reference": "metres above a 1737.4 km sphere",
        "slope_deg": round(slope, 2),
        "slope_baseline_m": round(2 * max(dx, dy), 1),
        "local_relief_m": round(float(h.max() - h.min()), 1),
        "window_m": round(2 * half_window_m),
        "pixel_size_m": [round(dx, 1), round(dy, 1)],
        "source": f"LROC WMS layer {DTM_LAYER} (QuickMap server)",
        "caveat": "WAC GLD100-derived; polar values not validated against LOLA",
        "query_url": url,
    }


def psr_at(lat: float, east_lon: float, timeout: float = 60.0, get: Callable = _http_get) -> dict:
    """Is the point inside a mapped permanently shadowed region (PSR)?"""
    x0, y0, x1, y1, *_ = _bbox(lat, east_lon, 50.0)
    url = _wms_url(REQUEST="GetFeatureInfo", LAYERS=PSR_LAYER, QUERY_LAYERS=PSR_LAYER,
                   BBOX=f"{x0},{y0},{x1},{y1}", WIDTH=3, HEIGHT=3, X=1, Y=1, INFO_FORMAT="text/yaml")
    body, _ = get(url, timeout)
    text = body.decode("utf-8", "replace")
    if PSR_LAYER not in text:
        raise ValueError(f"unexpected LROC WMS reply: {text[:200]!r}")
    features = []
    for block in re.split(r"\n- ", text)[1:]:
        f = dict(re.findall(r"^\s*(PSR_ID|area|latitude|longitude):\s*(\S+)", block, flags=re.M))
        if f:
            features.append({"psr_id": f.get("PSR_ID"),
                             "area_km2": float(f["area"]) if "area" in f else None,
                             "center_latitude_deg": float(f["latitude"]) if "latitude" in f else None,
                             "center_longitude_deg": float(f["longitude"]) if "longitude" in f else None})
    return {"in_psr": bool(features), "psr": features,
            "source": f"LROC WMS layer {PSR_LAYER} (LOLA PSRs, Mazarico et al. 2011)",
            "note": "Only PSRs of roughly 10 km^2 or larger are mapped; small cold traps may be missed.",
            "query_url": url}


def local_dtm(lat: float, east_lon: float, radius_m: float = 25_000.0, pixels: int = 251,
              timeout: float = 120.0, get: Callable = _http_get) -> dict:
    """Square terrain grid (metres above the 1737.4 km sphere) centred on a lunar point.

    Uses the server's AUTO:42003 orthographic projection centred on the point, so
    the grid is in metres with grid-up = local north at the centre (checked: from
    Site 04, Shackleton's low floor appears at bearing ~257 deg, as geometry predicts).
    """
    from PIL import Image

    url = _wms_url(REQUEST="GetMap", LAYERS=DTM_LAYER, SRS=f"AUTO:42003,9001,{east_lon % 360},{lat}",
                   BBOX=f"{-radius_m},{-radius_m},{radius_m},{radius_m}",
                   WIDTH=pixels, HEIGHT=pixels, FORMAT="image/tiff; mode=32bit")
    body, ctype = get(url, timeout)
    if "tiff" not in ctype:
        raise ValueError(f"LROC WMS did not return elevation data: {body[:200]!r}")
    radius = np.array(Image.open(io.BytesIO(body)), dtype=float)
    if radius.shape != (pixels, pixels) or not np.isfinite(radius).all() or radius.min() < 1.70e6:
        raise ValueError("LROC WMS terrain grid has missing or invalid values")
    return {"dem": radius - MOON_REFERENCE_RADIUS_M, "pixel_m": 2 * radius_m / pixels,
            "center": (pixels // 2, pixels // 2), "query_url": url}


def terrain_horizon(lat: float, east_lon: float, radius_m: float = 25_000.0, pixels: int = 251,
                    step_deg: float = 1.0, get: Callable = _http_get) -> dict:
    """Terrain horizon elevation angle all around a lunar point (azimuth clockwise from north)."""
    from .terrain_shadow import horizon_profile

    g = local_dtm(lat, east_lon, radius_m, pixels, get=get)
    r, c = g["center"]
    az = np.arange(0.0, 360.0, step_deg)
    prof = horizon_profile(g["dem"], g["pixel_m"], r, c, azimuths_deg=az, max_distance_m=radius_m)
    return {
        "azimuths_deg": prof["azimuths_deg"],
        "horizon_elevation_deg": [round(e, 3) for e in prof["horizon_elevation_deg"]],
        "search_radius_m": radius_m,
        "pixel_m": round(g["pixel_m"], 1),
        "site_height_m": round(float(g["dem"][r, c]), 1),
        "source": f"LROC WMS layer {DTM_LAYER} (QuickMap server), orthographic grid centred on the site",
        "caveat": "Coarse WAC-derived terrain (~200 m pixels here); ridges beyond the search radius and small "
                  "features are missed. Not validated against LOLA. Use as an estimate only.",
        "query_url": g["query_url"],
    }


def preview_image_url(lat: float, east_lon: float, half_window_m: float = 5000.0,
                      layer: str = "luna_wac_dtm_hillshade", size: int = 512) -> str:
    """PNG map of the area around a site from the LROC WMS, for the charts/map view."""
    x0, y0, x1, y1, *_ = _bbox(lat, east_lon, half_window_m)
    return _wms_url(REQUEST="GetMap", LAYERS=layer, BBOX=f"{x0},{y0},{x1},{y1}",
                    WIDTH=size, HEIGHT=size, FORMAT="image/png")

"""Visual assets for the web experience, built from real lunar data and cached on disk.

Global Moon (equirectangular, longitude -180..180 left to right, north up):
  albedo.jpg   LROC WAC 643 nm normalized reflectance (shadow-free brightness), polar
               rows de-streaked by a median blend above 78 deg latitude.
  normal.png   tangent-space normal map derived from LROC WAC GLD100 heights
               (exaggerated x NORMAL_GAIN so relief reads at globe scale).
  height.png   8-bit displacement map from the same heights.

Local terrain per lunar site (orthographic grid centred on the site, grid-up = north):
  <site>_terrain.bin   float32 heights, metres above the 1737.4 km sphere, row 0 = north
  <site>_terrain.json  grid size, pixel size, site height
  <site>_albedo.png    WAC normalized reflectance in the same projection (no-data filled)

Source server: LROC WMS (wms.im-ldi.com), the server behind LROC QuickMap.
"""
from __future__ import annotations

import io
import json
import threading
from pathlib import Path

import numpy as np

from advanced_analysis import lroc_quickmap as lq

OUT = Path(__file__).resolve().parents[1] / "data" / "web_assets"
ALBEDO_LAYER = "luna_wac_normalized_reflectance"
HEIGHT_LAYER = lq.DTM_LAYER
NORMAL_GAIN = 6.0
_LOCK = threading.Lock()


def _get(url: str, timeout: float = 300.0) -> tuple[bytes, str]:
    return lq._http_get(url, timeout)


def _wms(**kw) -> str:
    return lq._wms_url(**kw)


def _img(body: bytes):
    from PIL import Image
    return Image.open(io.BytesIO(body))


# ---------------------------------------------------------------------------------------------
# Global Moon
# ---------------------------------------------------------------------------------------------

def _destreak_poles(a: np.ndarray, start_deg: float = 76.0, full_deg: float = 82.0) -> np.ndarray:
    from scipy.ndimage import median_filter
    h = a.shape[0]
    lat = 90 - (np.arange(h) + 0.5) * 180 / h
    w = np.clip((np.abs(lat) - start_deg) / (full_deg - start_deg), 0, 1)[:, None]
    smooth = median_filter(a, size=(9, 3), mode="wrap")
    return a * (1 - w) + smooth * w


def _fill_nodata(a: np.ndarray, threshold: float = 8.0, size: int = 31, wrap: bool = False) -> np.ndarray:
    """Replace no-data pixels (near 0) with the local mean of valid neighbours."""
    from scipy.ndimage import uniform_filter
    valid = a > threshold
    if valid.all():
        return a
    mode = "wrap" if wrap else "reflect"
    fill = np.median(a[valid]) if valid.any() else 140.0
    num = uniform_filter(np.where(valid, a, 0.0), size, mode=mode)
    den = uniform_filter(valid.astype(float), size, mode=mode)
    local = np.where(den > 0.05, num / np.maximum(den, 1e-6), fill)
    return np.where(valid, a, local)


def build_global(width: int = 4096) -> dict:
    from PIL import Image
    OUT.mkdir(parents=True, exist_ok=True)
    files = {k: OUT / f"moon_{k}" for k in ("albedo.jpg", "normal.png", "height.png")}
    if all(f.exists() for f in files.values()):
        return {k: str(v) for k, v in files.items()}

    body, ctype = _get(_wms(REQUEST="GetMap", LAYERS=ALBEDO_LAYER, SRS="EPSG:4326", BBOX="-180,-90,180,90",
                            WIDTH=width, HEIGHT=width // 2, FORMAT="image/png"))
    if "image" not in ctype:
        raise ValueError(f"albedo request failed: {body[:200]!r}")
    a = np.asarray(_img(body).convert("L"), dtype=float)
    a = _fill_nodata(a, wrap=True)          # permanently shadowed floors have no reflectance data
    a = _destreak_poles(a)
    a = np.clip((a - 25) / (235 - 25), 0, 1) ** 0.95 * 235 + 12      # gentle tone curve, keeps maria dark
    Image.fromarray(a.astype(np.uint8)).save(files["albedo.jpg"], quality=90)

    hw = width // 2
    body, ctype = _get(_wms(REQUEST="GetMap", LAYERS=HEIGHT_LAYER, SRS="EPSG:4326", BBOX="-180,-90,180,90",
                            WIDTH=hw, HEIGHT=hw // 2, FORMAT="image/tiff; mode=32bit"))
    if "tiff" not in ctype:
        raise ValueError(f"height request failed: {body[:200]!r}")
    h = np.asarray(_img(body), dtype=float) - lq.MOON_REFERENCE_RADIUS_M
    rows, cols = h.shape
    lat = np.radians(90 - (np.arange(rows) + 0.5) * 180 / rows)[:, None]
    m_lat = np.pi * lq.MOON_REFERENCE_RADIUS_M / rows                      # metres per row
    m_lon = 2 * np.pi * lq.MOON_REFERENCE_RADIUS_M / cols * np.maximum(np.cos(lat), 0.03)
    dh_e = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * m_lon)
    dh_n = np.zeros_like(h)
    dh_n[1:-1] = (h[:-2] - h[2:]) / (2 * m_lat)                             # row 0 is north
    dh_e, dh_n = np.clip(dh_e * NORMAL_GAIN, -3, 3), np.clip(dh_n * NORMAL_GAIN, -3, 3)
    n = np.stack([-dh_e, -dh_n, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(files["normal.png"])
    hn = (h - h.min()) / (h.max() - h.min())
    Image.fromarray((hn * 255).astype(np.uint8)).save(files["height.png"])
    (OUT / "moon_meta.json").write_text(json.dumps({
        "albedo_layer": ALBEDO_LAYER, "height_layer": HEIGHT_LAYER, "height_min_m": float(h.min()),
        "height_max_m": float(h.max()), "normal_gain": NORMAL_GAIN}))
    return {k: str(v) for k, v in files.items()}


# ---------------------------------------------------------------------------------------------
# Local site terrain
# ---------------------------------------------------------------------------------------------

def site_key(lat: float, lon: float) -> str:
    return f"{lat:+.4f}_{lon % 360:.4f}".replace("+", "p").replace("-", "m").replace(".", "d")


def build_site(lat: float, lon: float, radius_m: float = 15000.0, pixels: int = 257,
               albedo_px: int = 1024) -> dict:
    from PIL import Image
    from scipy.ndimage import uniform_filter
    OUT.mkdir(parents=True, exist_ok=True)
    key = site_key(lat, lon)
    f_bin, f_meta, f_alb = OUT / f"{key}_terrain.bin", OUT / f"{key}_terrain.json", OUT / f"{key}_albedo.png"
    with _LOCK:
        if not (f_bin.exists() and f_meta.exists() and f_alb.exists()):
            g = lq.local_dtm(lat, lon, radius_m, pixels)
            g["dem"].astype("<f4").tofile(f_bin)
            r, c = g["center"]
            f_meta.write_text(json.dumps({
                "rows": pixels, "cols": pixels, "pixel_m": g["pixel_m"], "size_m": 2 * radius_m,
                "site_height_m": float(g["dem"][r, c]), "lat": lat, "lon": lon % 360,
                "source": f"LROC WMS {HEIGHT_LAYER} (QuickMap server), orthographic grid centred on site",
                "caveat": "WAC GLD100-derived heights; coarse near the pole and not validated against LOLA."}))
            body, ctype = _get(_wms(REQUEST="GetMap", LAYERS=ALBEDO_LAYER,
                                    SRS=f"AUTO:42003,9001,{lon % 360},{lat}",
                                    BBOX=f"{-radius_m},{-radius_m},{radius_m},{radius_m}",
                                    WIDTH=albedo_px, HEIGHT=albedo_px, FORMAT="image/png"))
            if "image" not in ctype:
                raise ValueError(f"site albedo request failed: {body[:200]!r}")
            a = _fill_nodata(np.asarray(_img(body).convert("L"), dtype=float))   # PSR floors: no data
            Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(f_alb)
    return {"bin": f_bin, "meta": f_meta, "albedo": f_alb}


# ---------------------------------------------------------------------------------------------
# Polar caps (orthographic grids centred on each pole) - avoids the equirectangular pole pinch
# ---------------------------------------------------------------------------------------------
# Orientation verified for the south grid: Shackleton's depression appears at atan2(x, y) = 128.7 deg
# against its 129.2 deg E longitude, i.e. x = R cos(lat) sin(lon), y = R cos(lat) cos(lon).

POLAR_HALF_M = 312_000.0          # covers the cap poleward of ~79.6 deg


def build_polar(pole: str = "south", n: int = 513, albedo_px: int = 2048) -> dict:
    from PIL import Image
    OUT.mkdir(parents=True, exist_ok=True)
    tag = {"south": "s", "north": "n"}[pole]
    lat0 = -90 if pole == "south" else 90
    f_bin, f_alb, f_meta = OUT / f"polar_{tag}_height.bin", OUT / f"polar_{tag}_albedo.png", OUT / f"polar_{tag}.json"
    with _LOCK:
        if not (f_bin.exists() and f_alb.exists() and f_meta.exists()):
            srs = f"AUTO:42003,9001,0,{lat0}"
            bbox = f"{-POLAR_HALF_M},{-POLAR_HALF_M},{POLAR_HALF_M},{POLAR_HALF_M}"
            body, ctype = _get(_wms(REQUEST="GetMap", LAYERS=HEIGHT_LAYER, SRS=srs, BBOX=bbox,
                                    WIDTH=n, HEIGHT=n, FORMAT="image/tiff; mode=32bit"))
            if "tiff" not in ctype:
                raise ValueError(f"polar height request failed: {body[:200]!r}")
            h = np.asarray(_img(body), dtype=float) - lq.MOON_REFERENCE_RADIUS_M
            h.astype("<f4").tofile(f_bin)
            body, ctype = _get(_wms(REQUEST="GetMap", LAYERS=ALBEDO_LAYER, SRS=srs, BBOX=bbox,
                                    WIDTH=albedo_px, HEIGHT=albedo_px, FORMAT="image/png"))
            if "image" not in ctype:
                raise ValueError(f"polar albedo request failed: {body[:200]!r}")
            a = _fill_nodata(np.asarray(_img(body).convert("L"), dtype=float), size=41)
            a = np.clip((a - 25) / (235 - 25), 0, 1) ** 0.95 * 235 + 12     # same tone curve as the globe
            Image.fromarray(a.astype(np.uint8)).save(f_alb)
            f_meta.write_text(json.dumps({"pole": pole, "n": n, "half_m": POLAR_HALF_M,
                                          "projection": "orthographic centred on the pole, lon 0 up",
                                          "mapping": "x = R cos(lat) sin(lon), y = R cos(lat) cos(lon) (south)"}))
    return {"bin": f_bin, "albedo": f_alb, "meta": f_meta}

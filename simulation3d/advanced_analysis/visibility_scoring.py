"""Lunar Visibility Scoring Module (Level 2 - Phase 3).

Rule-based score from 0 to 100 for observing the Moon from Earth.

    V = sum_i  w_i' * S_i          S_i = component score, 0..100
                                    w_i' = w_i / sum(w_j for available components j)

Components and default weights (configurable):

    Moon altitude      30 %   S_A = 100 * clip(h_moon / 45 deg, 0, 1)
    Sky darkness       25 %   S_D = 100 * clip(-h_sun / 18 deg, 0, 1)
    Cloud cover        25 %   S_C = 100 - cloud_cover_percent           (optional)
    Moon illumination  20 %   S_I = 100 inside the preferred range of % lit,
                                    falling linearly to 0 at `tolerance`
                                    percentage points outside it

Rules:
  * Moon altitude <= 0 deg  ->  "Not Observable", visibility score 0.
  * Moon altitude >= 45 deg ->  full altitude score (45 deg is configurable).
  * Sun altitude <= -18 deg ->  full darkness score (astronomical night);
    Sun at or above 0 deg   ->  0 darkness.
  * Cloud cover 0 %         ->  full cloud score.
  * Weather missing         ->  cloud component dropped and the remaining
    weights re-normalised to sum to 1; reported in "data_completeness".

Ratings: 80-100 Excellent, 60-<80 Good, 40-<60 Moderate, <40 Poor,
Moon at or below the horizon: Not Observable.

Assumptions (documented, adjustable):
  * Linear ramps. Altitude: the atmosphere's effect falls off strongly with
    height (airmass ~ 1/sin h); a linear ramp to 45 deg is a simple proxy.
  * Darkness uses the Sun's geometric altitude; it ignores moonlight and
    light pollution.
  * Illumination preference depends on the observer's goal (crater detail
    near the terminator vs. full disk); presets are provided, default "any".
  * Astronomy alone cannot establish actual visibility: without weather data
    the score describes geometry only and says so.

Inputs come from the Level 1 module (calculations/sky.py: Moon/Sun altitude,
illumination) and advanced_analysis/weather.py (Open-Meteo cloud cover).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal, Optional, Sequence

import numpy as np

COMPONENTS = ("altitude", "darkness", "cloud", "illumination")
DEFAULT_WEIGHTS = {"altitude": 0.30, "darkness": 0.25, "cloud": 0.25, "illumination": 0.20}
FULL_ALTITUDE_DEG = 45.0
FULL_DARKNESS_SUN_DEG = -18.0
ZERO_DARKNESS_SUN_DEG = 0.0

# name: (ideal_min %, ideal_max %, tolerance % points)
ILLUMINATION_PRESETS = {
    "any": (0.0, 100.0, 0.0),             # every phase is acceptable
    "terminator_detail": (20.0, 80.0, 20.0),  # crescents to gibbous: long shadows show relief
    "quarter": (35.0, 65.0, 25.0),
    "full_disk": (90.0, 100.0, 20.0),
    "thin_crescent": (2.0, 25.0, 15.0),
}

PresetName = Literal["any", "terminator_detail", "quarter", "full_disk", "thin_crescent"]
assert set(PresetName.__args__) == set(ILLUMINATION_PRESETS)

RATINGS = [(80.0, "Excellent"), (60.0, "Good"), (40.0, "Moderate"), (0.0, "Poor")]
NOT_OBSERVABLE = "Not Observable"


# --------------------------------------------------------------------------
# Validation helpers
# --------------------------------------------------------------------------

def _check(name: str, value, lo: float, hi: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number, got {value!r}")
    if not np.isfinite(v):
        raise ValueError(f"{name} must be a finite number")
    if not lo <= v <= hi:
        raise ValueError(f"{name} must be between {lo:g} and {hi:g}, got {v:g}")
    return v


@dataclass(frozen=True)
class IlluminationPreference:
    ideal_min: float = 0.0
    ideal_max: float = 100.0
    tolerance: float = 0.0
    name: str = "any"

    def __post_init__(self):
        _check("ideal_min", self.ideal_min, 0, 100)
        _check("ideal_max", self.ideal_max, 0, 100)
        _check("tolerance", self.tolerance, 0, 100)
        if self.ideal_min > self.ideal_max:
            raise ValueError("ideal_min must not exceed ideal_max")

    @classmethod
    def preset(cls, name: str) -> "IlluminationPreference":
        if name not in ILLUMINATION_PRESETS:
            raise ValueError(f"unknown illumination preference {name!r}; choose from {list(ILLUMINATION_PRESETS)}")
        lo, hi, tol = ILLUMINATION_PRESETS[name]
        return cls(lo, hi, tol, name)


def _as_preference(p) -> IlluminationPreference:
    if p is None:
        return IlluminationPreference.preset("any")
    if isinstance(p, IlluminationPreference):
        return p
    if isinstance(p, str):
        return IlluminationPreference.preset(p)
    raise ValueError("illumination preference must be a preset name or IlluminationPreference")


def validate_weights(weights: Optional[dict]) -> dict:
    w = dict(DEFAULT_WEIGHTS if weights is None else weights)
    unknown = set(w) - set(COMPONENTS)
    if unknown:
        raise ValueError(f"unknown weight(s) {sorted(unknown)}; allowed: {list(COMPONENTS)}")
    for k in COMPONENTS:
        w.setdefault(k, 0.0)
        _check(f"weight '{k}'", w[k], 0, 1e6)
    if sum(w.values()) <= 0:
        raise ValueError("weights must have a positive total")
    return {k: float(w[k]) for k in COMPONENTS}


# --------------------------------------------------------------------------
# Component scores (each 0..100)
# --------------------------------------------------------------------------

def calculate_altitude_score(moon_altitude_deg: float, full_score_altitude_deg: float = FULL_ALTITUDE_DEG) -> float:
    """0 at or below the horizon, 100 at or above full_score_altitude_deg, linear in between."""
    h = _check("moon_altitude_deg", moon_altitude_deg, -90, 90)
    full = _check("full_score_altitude_deg", full_score_altitude_deg, 1e-6, 90)
    if h <= 0:
        return 0.0
    return round(100.0 * min(h / full, 1.0), 2)


def calculate_darkness_score(sun_altitude_deg: float) -> float:
    """0 with the Sun at or above the horizon, 100 at or below -18 deg (astronomical night)."""
    s = _check("sun_altitude_deg", sun_altitude_deg, -90, 90)
    span = ZERO_DARKNESS_SUN_DEG - FULL_DARKNESS_SUN_DEG
    return round(100.0 * float(np.clip((ZERO_DARKNESS_SUN_DEG - s) / span, 0.0, 1.0)), 2)


def calculate_cloud_score(cloud_cover_percent: Optional[float]) -> Optional[float]:
    """100 for a clear sky, 0 for full overcast; None when no weather data."""
    if cloud_cover_percent is None:
        return None
    c = _check("cloud_cover_percent", cloud_cover_percent, 0, 100)
    return round(100.0 - c, 2)


def calculate_illumination_score(illumination_percent: float, preference=None) -> float:
    """100 inside the preferred illuminated-% range; linear drop to 0 at `tolerance` outside it."""
    i = _check("illumination_percent", illumination_percent, 0, 100)
    p = _as_preference(preference)
    distance = max(p.ideal_min - i, 0.0, i - p.ideal_max)
    if distance == 0:
        return 100.0
    if p.tolerance == 0:
        return 0.0
    return round(100.0 * max(0.0, 1.0 - distance / p.tolerance), 2)


def rating(score: float, observable: bool = True) -> str:
    if not observable:
        return NOT_OBSERVABLE
    return next(label for limit, label in RATINGS if score >= limit)


# --------------------------------------------------------------------------
# Combined score
# --------------------------------------------------------------------------

def calculate_visibility(moon_altitude_deg: float, sun_altitude_deg: float, illumination_percent: float,
                         cloud_cover_percent: Optional[float] = None, weights: Optional[dict] = None,
                         illumination_preference=None,
                         full_score_altitude_deg: float = FULL_ALTITUDE_DEG) -> dict:
    """Visibility score 0..100 with components, rating and data completeness. Raises ValueError on bad input."""
    w = validate_weights(weights)
    pref = _as_preference(illumination_preference)
    comp = {
        "altitude": calculate_altitude_score(moon_altitude_deg, full_score_altitude_deg),
        "darkness": calculate_darkness_score(sun_altitude_deg),
        "cloud": calculate_cloud_score(cloud_cover_percent),
        "illumination": calculate_illumination_score(illumination_percent, pref),
    }
    available = [k for k in COMPONENTS if comp[k] is not None and w[k] > 0]
    missing = [k for k in COMPONENTS if comp[k] is None]
    w_avail = sum(w[k] for k in available)
    norm = {k: (w[k] / w_avail if k in available else 0.0) for k in COMPONENTS}

    observable = float(moon_altitude_deg) > 0
    raw = sum(norm[k] * comp[k] for k in available)
    score = round(raw, 2) if observable else 0.0

    return {
        "visibility_score": score,
        "rating": rating(score, observable),
        "observable": observable,
        "components": {
            k: {"score": comp[k], "weight": w[k], "normalized_weight": round(norm[k], 4),
                "contribution": None if comp[k] is None else round(norm[k] * comp[k], 2)}
            for k in COMPONENTS
        },
        "data_completeness": {
            "weather_available": comp["cloud"] is not None,
            "components_used": available,
            "components_missing": missing,
            "weight_coverage_percent": round(100 * w_avail / sum(w.values()), 1),
            "weights_renormalized": bool(missing),
            "note": None if not missing else
            "Weather data unavailable: cloud weight removed and remaining weights re-normalized. "
            "Astronomy alone cannot establish actual visibility.",
        },
        "inputs": {
            "moon_altitude_deg": round(float(moon_altitude_deg), 4),
            "sun_altitude_deg": round(float(sun_altitude_deg), 4),
            "illumination_percent": round(float(illumination_percent), 3),
            "cloud_cover_percent": None if cloud_cover_percent is None else round(float(cloud_cover_percent), 2),
            "weights": w,
            "illumination_preference": asdict(pref),
            "full_score_altitude_deg": float(full_score_altitude_deg),
        },
        "formula": "V = sum(w_i' * S_i), w_i' = weights re-normalized over available components",
    }


# --------------------------------------------------------------------------
# Time-series use (observation windows, charts)
# --------------------------------------------------------------------------

@dataclass
class Preferences:
    """Hard limits for recommending windows, plus the scoring settings above."""
    min_moon_altitude_deg: float = 15.0
    full_score_altitude_deg: float = FULL_ALTITUDE_DEG
    max_sun_altitude_deg: float = -6.0
    illumination_min: float = 0.0
    illumination_max: float = 100.0
    azimuth_ranges: Optional[list[tuple[float, float]]] = None
    max_cloud_cover_percent: float = 60.0
    illumination_preference: str = "any"
    weights: dict = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))

    def __post_init__(self):
        _check("min_moon_altitude_deg", self.min_moon_altitude_deg, -5, 89)
        _check("full_score_altitude_deg", self.full_score_altitude_deg, 1e-6, 90)
        if not 0 <= self.illumination_min <= self.illumination_max <= 100:
            raise ValueError("need 0 <= illumination_min <= illumination_max <= 100")
        _as_preference(self.illumination_preference)
        self.weights = validate_weights(self.weights)

    def as_dict(self) -> dict:
        return asdict(self)


def sky_condition(sun_alt_deg: float) -> str:
    if sun_alt_deg > -0.833:
        return "Day"
    if sun_alt_deg > -6:
        return "Civil twilight"
    if sun_alt_deg > -12:
        return "Nautical twilight"
    if sun_alt_deg > -18:
        return "Astronomical twilight"
    return "Dark"


def _in_ranges(az: np.ndarray, ranges) -> np.ndarray:
    ok = np.zeros(az.shape, bool)
    for a, b in ranges:
        a, b = a % 360, b % 360
        ok |= ((az >= a) & (az <= b)) if a <= b else ((az >= a) | (az <= b))
    return ok


def score_samples(moon_alt: Sequence[float], moon_az: Sequence[float], illumination: Sequence[float],
                  sun_alt: Sequence[float], cloud_cover: Optional[Sequence[float]],
                  prefs: Preferences) -> dict:
    """Score many moments with calculate_visibility, plus the hard limits used for window finding.

    "score" is visibility_score / 100 for moments that pass every hard limit, else 0.
    """
    ma, mz, il, sa = (np.asarray(x, float) for x in (moon_alt, moon_az, illumination, sun_alt))
    cc = None if cloud_cover is None else np.asarray(cloud_cover, float)

    checks = [
        ("Moon below horizon", ma > 0),
        ("Moon too low", ma >= prefs.min_moon_altitude_deg),
        ("Sky too bright", sa <= prefs.max_sun_altitude_deg),
        ("Illumination outside preference", (il >= prefs.illumination_min) & (il <= prefs.illumination_max)),
    ]
    if prefs.azimuth_ranges:
        checks.append(("Moon in blocked direction", _in_ranges(mz % 360, prefs.azimuth_ranges)))
    if cc is not None:
        checks.append(("Too cloudy", cc <= prefs.max_cloud_cover_percent))
    eligible = np.ones(ma.shape, bool)
    reasons = np.array([""] * ma.size, dtype=object)
    for label, ok in checks:
        reasons[(~ok) & (reasons == "")] = label
        eligible &= ok

    results = [calculate_visibility(float(np.clip(ma[k], -90, 90)), float(np.clip(sa[k], -90, 90)),
                                    float(np.clip(il[k], 0, 100)),
                                    None if cc is None else float(np.clip(cc[k], 0, 100)),
                                    prefs.weights, prefs.illumination_preference, prefs.full_score_altitude_deg)
               for k in range(ma.size)]
    vis = np.array([r["visibility_score"] for r in results])
    return {"eligible": eligible, "score": np.where(eligible, vis / 100, 0.0), "visibility_score": vis,
            "results": results, "reasons": reasons.tolist(), "weather_included": cc is not None}


def breakdown(s: dict, k: int) -> dict:
    """Full result for sample k, with the window-finding verdict added."""
    r = dict(s["results"][k])
    r["suitable_for_window"] = bool(s["eligible"][k])
    r["not_suitable_because"] = s["reasons"][k] or None
    return r

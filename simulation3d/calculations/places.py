"""Preset observer places: rocket launch sites in India and the USA.

Coordinates are those recorded for each site's Wikipedia page (Indian sites
checked against the raw page source; US sites via the Wikipedia API's
recorded coordinates), retrieved 2026-11-14. No page states an elevation, so
0 m is used; all sites are coastal.
"""
from __future__ import annotations

from enum import Enum

from .sky import Observer

WIKI = "https://en.wikipedia.org/wiki/"

PLACES = {
    # ---- India (time zone Asia/Kolkata) ----
    "sriharikota_flp": {
        "name": "India - Satish Dhawan Space Centre, First Launch Pad (Sriharikota, AP)",
        "lat": 13.7333, "lon": 80.2347, "tz": "Asia/Kolkata", "country": "India",
        "source": WIKI + "Satish_Dhawan_Space_Centre"},
    "sriharikota_slp": {
        "name": "India - Satish Dhawan Space Centre, Second Launch Pad (Sriharikota, AP)",
        "lat": 13.7199, "lon": 80.2305, "tz": "Asia/Kolkata", "country": "India",
        "source": WIKI + "Satish_Dhawan_Space_Centre"},
    "kulasekarapattinam": {
        "name": "India - SSLV Launch Complex (Kulasekarapattinam, TN)",
        "lat": 8.36123, "lon": 78.01572, "tz": "Asia/Kolkata", "country": "India",
        "source": WIKI + "SSLV_Launch_Complex"},
    "thumba_terls": {
        "name": "India - Thumba Equatorial Rocket Launching Station (Thiruvananthapuram, KL)",
        "lat": 8.54278, "lon": 76.85889, "tz": "Asia/Kolkata", "country": "India",
        "source": WIKI + "Thumba_Equatorial_Rocket_Launching_Station"},
    "abdul_kalam_island": {
        "name": "India - Abdul Kalam Island launch complex (Bhadrak, OD)",
        "lat": 20.75778, "lon": 87.08389, "tz": "Asia/Kolkata", "country": "India",
        "source": WIKI + "Abdul_Kalam_Island"},
    "chandipur_itr": {
        "name": "India - Integrated Test Range (Chandipur, Balasore, OD)",
        "lat": 21.437, "lon": 87.016, "tz": "Asia/Kolkata", "country": "India",
        "source": WIKI + "Integrated_Test_Range"},
    "mysuru": {
        "name": "India - Mysuru (Earth planner location)",
        "lat": 12.2958, "lon": 76.6394, "tz": "Asia/Kolkata", "country": "India",
        "source": "Same coordinates as the Earth Observation Planner (api.py, Observer(12.2958, 76.6394))"},
    # ---- USA ----
    "ksc_lc39a": {
        "name": "USA - NASA Kennedy Space Center, Launch Complex 39A (Florida)",
        "lat": 28.60833333, "lon": -80.60444444, "tz": "America/New_York", "country": "USA",
        "source": WIKI + "Kennedy_Space_Center_Launch_Complex_39A"},
    "ksc_lc39b": {
        "name": "USA - NASA Kennedy Space Center, Launch Complex 39B (Florida)",
        "lat": 28.62722222, "lon": -80.62083333, "tz": "America/New_York", "country": "USA",
        "source": WIKI + "Kennedy_Space_Center_Launch_Complex_39B"},
    "ccsfs_slc40": {
        "name": "USA - Cape Canaveral Space Launch Complex 40 (Florida)",
        "lat": 28.5619, "lon": -80.5772, "tz": "America/New_York", "country": "USA",
        "source": WIKI + "Cape_Canaveral_Space_Launch_Complex_40"},
    "ccsfs_slc41": {
        "name": "USA - Cape Canaveral Space Launch Complex 41 (Florida)",
        "lat": 28.58333333, "lon": -80.58305556, "tz": "America/New_York", "country": "USA",
        "source": WIKI + "Cape_Canaveral_Space_Launch_Complex_41"},
    "vandenberg_slc4": {
        "name": "USA - Vandenberg Space Launch Complex 4 (California)",
        "lat": 34.633, "lon": -120.613, "tz": "America/Los_Angeles", "country": "USA",
        "source": WIKI + "Vandenberg_Space_Launch_Complex_4"},
    "wallops_mars": {
        "name": "USA - NASA Wallops / Mid-Atlantic Regional Spaceport (Virginia)",
        "lat": 37.84333333, "lon": -75.47805556, "tz": "America/New_York", "country": "USA",
        "source": WIKI + "Mid-Atlantic_Regional_Spaceport"},
}

# Enum of ids (kept for code that imports it); the API drop-down shows the names below.
Place = Enum("Place", {k: k for k in PLACES} | {"custom": "custom"}, type=str)

CUSTOM_NAME = "Custom location (enter lat/lon)"
DROPDOWN = [p["name"] for p in PLACES.values()] + [CUSTOM_NAME]

# Names used before the country prefix was added still resolve.
_OLD_NAMES = {p["name"].split(" - ", 1)[1].lower(): k for k, p in PLACES.items() if p["country"] == "India"}
_OLD_NAMES |= {
    "satish dhawan space centre - first launch pad (sriharikota, ap)": "sriharikota_flp",
    "satish dhawan space centre - second launch pad (sriharikota, ap)": "sriharikota_slp",
}


def resolve(value: str) -> str:
    """Accept a display name or an id (case-insensitive); return the id, or "custom"."""
    v = value.strip().lower()
    if v in ("custom", CUSTOM_NAME.lower()):
        return "custom"
    for k, p in PLACES.items():
        if v in (k, p["name"].lower()):
            return k
    if v in _OLD_NAMES:
        return _OLD_NAMES[v]
    raise ValueError(f"unknown place {value!r}; choose one of: {', '.join(DROPDOWN)}")


def observer_for(place_id: str) -> Observer:
    p = PLACES[place_id]
    return Observer(p["lat"], p["lon"], 0.0, p["tz"], p["name"])


def list_places() -> list[dict]:
    return [{"id": k, "name": v["name"], "country": v["country"], "latitude_deg": v["lat"],
             "longitude_deg": v["lon"], "elevation_m": 0.0, "timezone": v["tz"], "source": v["source"]}
            for k, v in PLACES.items()]

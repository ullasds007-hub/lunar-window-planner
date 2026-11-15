"""Hourly cloud cover from the Open-Meteo forecast API (free, no API key).

Coverage: roughly 92 days in the past to 16 days ahead. Outside that range we
return status "unavailable" without calling the service, and the planner falls
back to astronomy-only scoring. Only latitude/longitude and dates are sent.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

URL = "https://api.open-meteo.com/v1/forecast"
PAST_DAYS, FUTURE_DAYS = 92, 16


def _http_get_json(url: str, timeout: float) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-window-planner/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def cloud_cover(lat: float, lon: float, start_utc: datetime, end_utc: datetime,
                now: Optional[datetime] = None, timeout: float = 10.0,
                fetch: Callable[[str, float], dict] = _http_get_json) -> dict:
    """{"status", "times" (UTC datetimes), "cloud_cover_percent", "source", "message"}."""
    now = now or datetime.now(timezone.utc)
    base = {"source": "Open-Meteo forecast API (https://open-meteo.com)", "times": [], "cloud_cover_percent": []}
    if start_utc < now - timedelta(days=PAST_DAYS) or end_utc > now + timedelta(days=FUTURE_DAYS):
        return {**base, "status": "unavailable",
                "message": f"weather forecast covers about {PAST_DAYS} days back to {FUTURE_DAYS} days ahead"}
    q = urllib.parse.urlencode({
        "latitude": round(lat, 4), "longitude": round(lon, 4), "hourly": "cloud_cover", "timezone": "UTC",
        "start_date": (start_utc - timedelta(hours=1)).date().isoformat(),
        "end_date": (end_utc + timedelta(hours=1)).date().isoformat(),
    })
    try:
        data = fetch(f"{URL}?{q}", timeout)
        hourly = data["hourly"]
        times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in hourly["time"]]
        cc = hourly["cloud_cover"]
    except Exception as exc:  # network, HTTP or format problem
        return {**base, "status": "unavailable", "message": f"weather request failed: {exc}"}
    pairs = [(t, float(c)) for t, c in zip(times, cc) if c is not None]
    if not pairs:
        return {**base, "status": "unavailable", "message": "no cloud cover values returned"}
    return {**base, "status": "ok", "message": "",
            "times": [p[0] for p in pairs], "cloud_cover_percent": [p[1] for p in pairs]}

"""Reader for JPL Horizons observer tables (azimuth/elevation).

Reads both the saved exports in data/raw (many columns) and the compact
tables the Horizons API returns with QUANTITIES='4' (azimuth, elevation only).
Interim helper: the team's data_loader.py remains the authoritative loader for
the app's raw files; swap this out when it lands.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


class HorizonsFileError(ValueError):
    pass


def parse_observer_text(text: str, label: str = "Horizons output",
                        expected_center: Optional[str] = "Moon (301)") -> dict:
    """Parse a Horizons observer table. Refuses a wrong observer body when expected_center is set."""
    m_target = re.search(r"Target body name:\s*(.+?)\s{2,}", text)
    m_center = re.search(r"Center body name:\s*(.+?)\s{2,}", text)
    m_geo = re.search(r"Center geodetic\s*:\s*([-\d.E+]+),\s*([-\d.E+]+),\s*([-\d.E+]+)", text)
    if not (m_target and m_center and m_geo):
        raise HorizonsFileError(f"{label}: missing Horizons header fields")
    center = m_center.group(1).strip()
    if expected_center and center != expected_center:
        raise HorizonsFileError(f"{label}: observer is {center!r}, not {expected_center!r}")
    if "$$SOE" not in text or "$$EOE" not in text:
        raise HorizonsFileError(f"{label}: no $$SOE/$$EOE data block")

    lines = text.splitlines()
    header = next((l for l in lines if "Azi" in l and "Elev" in l and "Date" in l), None)
    if header is None:
        raise HorizonsFileError(f"{label}: no azimuth/elevation columns")
    # When Elev is the last header column (API replies with QUANTITIES='4') the numbers run past
    # the header text, so read to the end of the row; otherwise stop where the Elev column ends.
    end = None if header.rstrip().endswith("Elev") else header.index("Elev") + len("Elev")

    times, az, elev, bad = [], [], [], []
    for row in text.split("$$SOE", 1)[1].split("$$EOE", 1)[0].splitlines():
        if not row.strip():
            continue
        try:
            t = datetime.strptime(row[:18].strip(), "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
            # the two numbers that end at the Elev column are azimuth and elevation
            a, e = (float(x) for x in row[:end].split()[-2:])
        except ValueError:
            bad.append(row[:40])
            continue
        times.append(t)
        az.append(a)
        elev.append(e)
    if bad:
        raise HorizonsFileError(f"{label}: {len(bad)} unreadable rows, first: {bad[0]!r}")
    return {
        "target": m_target.group(1).strip(),
        "center": center,
        "east_longitude_deg": float(m_geo.group(1)),
        "latitude_deg": float(m_geo.group(2)),
        "altitude_km": float(m_geo.group(3)),
        "times": times,
        "azimuth_deg": az,
        "elevation_deg": elev,
        "source_file": label,
    }


def read_observer_table(path: str | Path, expected_center: Optional[str] = "Moon (301)") -> dict:
    return parse_observer_text(Path(path).read_text(), Path(path).name, expected_center)

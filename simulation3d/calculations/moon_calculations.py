"""Moon phase, rise/set/transit and sky position for an observer on Earth."""
from datetime import date, datetime

from .sky import Observer, moon_phase, phase_name, position_at, position_series, principal_phases, rise_set_transit

__all__ = ["Observer", "moon_phase", "phase_name", "principal_phases",
           "moon_rise_set", "moon_position", "moon_positions"]


def moon_rise_set(obs: Observer, day: date) -> dict:
    """Moonrise, moonset, transit and minutes above the horizon on a local day."""
    return rise_set_transit(obs, "moon", day)


def moon_position(obs: Observer, when: datetime) -> dict:
    return position_at(obs, "moon", when)


def moon_positions(obs: Observer, start: datetime, end: datetime, step_minutes: int = 10) -> dict:
    """Altitude/azimuth (+ illumination) time series for the Charts module."""
    return position_series(obs, "moon", start, end, step_minutes)

"""Sun rise/set/transit, position and twilight for an observer on Earth."""
from datetime import date, datetime

from .sky import TWILIGHT_STATES, Observer, position_at, position_series, rise_set_transit, twilight_periods

__all__ = ["Observer", "TWILIGHT_STATES", "sun_rise_set", "sun_position", "sun_positions", "twilight_periods"]


def sun_rise_set(obs: Observer, day: date) -> dict:
    """Sunrise, sunset, solar transit and minutes above the horizon on a local day."""
    return rise_set_transit(obs, "sun", day)


def sun_position(obs: Observer, when: datetime) -> dict:
    return position_at(obs, "sun", when)


def sun_positions(obs: Observer, start: datetime, end: datetime, step_minutes: int = 10) -> dict:
    return position_series(obs, "sun", start, end, step_minutes)

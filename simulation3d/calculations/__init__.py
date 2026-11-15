"""Calculation package.

  landing_windows   lunar-surface Sun/Earth ideal-horizon overlap (landing screening)
  sky               shared Skyfield core for Earth-based observation
  moon_calculations Moon phase, rise/set/transit, position
  sun_calculations  Sun rise/set/transit, position, twilight
  illumination      Moon illuminated fraction

Backward compatibility: the landing-window API that used to live in the
top-level calculations.py is re-exported here, so existing code such as
`import calculations; calculations.calculate_window(...)` keeps working.
"""
from .landing_windows import (  # noqa: F401
    HORIZON_MODEL, INVALID_INPUT, METHOD, MISSING_DATA, OK, OUT_OF_RANGE,
    CalculationError, above_horizon_intervals, calculate_window, compare_scenarios,
    format_duration, intersect_intervals, merge_intervals, visible_fraction,
)

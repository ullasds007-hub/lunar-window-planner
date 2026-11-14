# JPL Horizons elevation cross-check

Observer: Athena (IM-2) landing coordinates, latitude -84.7906°,
longitude 29.1957° east. Time: 2026-11-14 00:00 UTC.

| Body | JPL Horizons elevation | Planner display |
| --- | ---: | ---: |
| Sun | +0.878281° | +0.88° |
| Earth | -0.153879° | -0.15° |

Both values agree at the planner's displayed precision. The Sun is above
the smooth horizon and Earth's center is slightly below it at this instant.

## Reproduce

Use the [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html).
Request an observer ephemeris (`EPHEM_TYPE=OBSERVER`) with
`CENTER=coord@301`, `COORD_TYPE=GEODETIC`, `SITE_COORD=29.1957,-84.7906,0`,
`TLIST=2026-11-14 00:00`, `TIME_TYPE=UT`, `QUANTITIES=4`, and
`APPARENT=AIRLESS`. Run once with `COMMAND=10` for the Sun and once with
`COMMAND=399` for Earth. Compare the elevation column.

This checks one site and timestamp, not the full timeline, local terrain,
solar power output, or radio-link reliability.

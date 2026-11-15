# Lunar Window Planner — release criteria

## Product
Lead with lunar landing-site planning. Keep Earth-based observing as a separate tool. Use “Compare landing sites”, “Analyze one site”, and “Observe from Earth”. Label the main metric “Sun and Earth above the horizon at the same time”; show both totals and their difference. Use UTC throughout surface results and explicit east-positive longitude. Do not label geometric visibility as available power or a working communications link.

## Structure
The current combined entry point imports the Earth app and loads a nested lunar API by file path. Migrate incrementally to a normal Python package with an explicit application factory and separate routers and calculation services. Target: app/main.py, app/routers/, app/services/, app/templates/, app/static/, tests/, docs/. Keep existing URLs and query parameters stable. Separate downloaded kernels from source code. Add setup and data-preparation instructions to the root README.

## Science and provenance
Document the JPL DE440s kernel and lunar orientation inputs used by the calculations, their versions and coordinate conventions. Record reproducible JPL Horizons reference cases with inputs, expected values and tolerances. Check both Sun and Earth elevations at multiple sites and times, including horizon crossings. Verify historical preset coordinates against their source. Moon Trek or QuickMap can support site context, but map links do not make the calculations terrain-aware. Only claim terrain-aware predictions after implementing and validating a terrain horizon model.

## Release gate
- Clean checkout can install dependencies, fetch required data and start with documented commands.
- Automated tests cover API contracts, known reference cases, missing kernels, invalid dates and coordinates.
- Desktop and narrow-screen browser tests cover compare, slider, share-link restoration in a fresh session and matching CSV.
- Production readiness checks required kernels and actual calculation availability.
- Deploy only after those checks pass; verify a shared URL on a second device.
